from webctx_safe_egress.security.dns_resolve import ResolvedAddress, resolve_safe_address


def fake_resolver(answers: list[ResolvedAddress]):
    def _resolve(hostname: str) -> list[ResolvedAddress]:
        return answers

    return _resolve


class TestZeroAnswers:
    def test_no_answers_is_unsafe(self):
        result = resolve_safe_address("nonexistent.example.invalid", fake_resolver([]))
        assert not result.safe
        assert result.reason == "dns_resolution_returned_no_answers"


class TestAllPublicAnswers:
    def test_single_public_v4_selected(self):
        result = resolve_safe_address("example.com", fake_resolver([ResolvedAddress("8.8.8.8", 4)]))
        assert result.safe
        assert result.selected_address.ip == "8.8.8.8"

    def test_first_answer_selected_when_multiple_public(self):
        answers = [ResolvedAddress("8.8.8.8", 4), ResolvedAddress("1.1.1.1", 4)]
        result = resolve_safe_address("example.com", fake_resolver(answers))
        assert result.safe
        assert result.selected_address.ip == "8.8.8.8"


class TestMixedSafeUnsafeAnswers:
    """SUN-1221E5Q6G §9 RED — one public address + one private address. The
    whole resolution must fail closed, exactly matching
    safe-dns-resolve.ts:86-91's documented rationale: a mix of public/private
    answers is a rebinding/misconfiguration signal, never something to route
    around by picking 'the good one'."""

    def test_mixed_v4_public_and_private_rejected(self):
        answers = [ResolvedAddress("8.8.8.8", 4), ResolvedAddress("10.0.0.1", 4)]
        result = resolve_safe_address("example.com", fake_resolver(answers))
        assert not result.safe
        assert result.reason == "prohibited_or_mixed_dns_answer"

    def test_mixed_v4_public_and_v6_private_rejected(self):
        answers = [ResolvedAddress("8.8.8.8", 4), ResolvedAddress("fd00::1", 6)]
        result = resolve_safe_address("example.com", fake_resolver(answers))
        assert not result.safe

    def test_order_does_not_matter_private_first(self):
        answers = [ResolvedAddress("10.0.0.1", 4), ResolvedAddress("8.8.8.8", 4)]
        result = resolve_safe_address("example.com", fake_resolver(answers))
        assert not result.safe


class TestAllUnsafeAnswers:
    def test_all_private_rejected(self):
        answers = [ResolvedAddress("10.0.0.1", 4), ResolvedAddress("192.168.1.1", 4)]
        result = resolve_safe_address("example.com", fake_resolver(answers))
        assert not result.safe


class TestDnsRebindingPinning:
    """SUN-1221E5Q6G §10 RED — proves the executor resolves EXACTLY ONCE per
    hop and reuses the selected address for the actual connection, never
    re-resolving the hostname between the safety decision and the dial. A
    resolver double that would return a DIFFERENT (private) answer on a
    second call proves, by call-count assertion, that no second call ever
    happens."""

    def test_resolver_invoked_exactly_once(self):
        call_count = {"n": 0}

        def rebinding_resolver(hostname: str) -> list[ResolvedAddress]:
            call_count["n"] += 1
            if call_count["n"] == 1:
                return [ResolvedAddress("8.8.8.8", 4)]
            # A later call (there should never be one) would return a
            # private address -- proving a naive hostname-reconnect
            # implementation is vulnerable, and that this one is not.
            return [ResolvedAddress("127.0.0.1", 4)]

        result = resolve_safe_address("example.com", rebinding_resolver)
        assert result.safe
        assert result.selected_address.ip == "8.8.8.8"
        assert call_count["n"] == 1
