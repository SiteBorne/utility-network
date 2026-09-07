"""SUN-1221E5Q6G §8/§9/§12/§13 — executor-level RED scenarios, using
`fetch_pinned` mocked at the executor's import site (transport itself is
proven separately, with a real TLS server, in test_transport_pinning.py).
"""

from __future__ import annotations

from unittest.mock import patch

from webctx_safe_egress.executor import execute
from webctx_safe_egress.schemas import WebctxFetchRequest
from webctx_safe_egress.security.dns_resolve import ResolvedAddress
from webctx_safe_egress.transport import RawResponse


def request(target_url: str, **overrides) -> WebctxFetchRequest:
    return WebctxFetchRequest(
        correlation_id="test-correlation-id",
        target_url=target_url,
        retrieval_mode="direct",
        deadline_ms=overrides.pop("deadline_ms", 5000),
        max_response_bytes=overrides.pop("max_response_bytes", 65536),
        single_hop=overrides.pop("single_hop", False),
        approved_headers=overrides.pop("approved_headers", {}),
    )


def resolver_returning(*answers: ResolvedAddress):
    def _resolve(hostname: str) -> list[ResolvedAddress]:
        return list(answers)

    return _resolve


class TestPrivateTargetRejectedBeforeConnect:
    """SUN-1221E5Q6G §8 RED."""

    def test_private_ip_literal_never_reaches_transport(self):
        with patch("webctx_safe_egress.executor.fetch_pinned") as mock_fetch:
            result = execute(request("http://127.0.0.1/"))
        assert result.result_class == "failure"
        assert result.reason_code == "WEBCTX_URL_VALIDATION_FAILED"
        mock_fetch.assert_not_called()

    def test_private_dns_answer_never_reaches_transport(self):
        with patch("webctx_safe_egress.executor.fetch_pinned") as mock_fetch:
            result = execute(
                request("https://internal.example/"),
                resolver=resolver_returning(ResolvedAddress("10.0.0.5", 4)),
            )
        assert result.result_class == "failure"
        assert result.reason_code == "WEBCTX_SSRF_BLOCKED"
        mock_fetch.assert_not_called()


class TestMixedDnsRejectedBeforeConnect:
    """SUN-1221E5Q6G §9 RED."""

    def test_mixed_answers_never_reach_transport(self):
        with patch("webctx_safe_egress.executor.fetch_pinned") as mock_fetch:
            result = execute(
                request("https://mixed.example/"),
                resolver=resolver_returning(ResolvedAddress("8.8.8.8", 4), ResolvedAddress("10.0.0.1", 4)),
            )
        assert result.result_class == "failure"
        assert result.reason_code == "WEBCTX_SSRF_BLOCKED"
        mock_fetch.assert_not_called()


class TestRedirectToPrivateTargetRejected:
    """SUN-1221E5Q6G §12 RED — the first hop succeeds and returns a 302 to a
    private target; the redirect must be rejected before any second
    transport call."""

    def test_redirect_location_pointing_at_private_ip_rejected(self):
        first_hop = RawResponse(status=302, headers={"location": "http://127.0.0.1/admin"}, body=b"", truncated=False)
        with patch("webctx_safe_egress.executor.fetch_pinned") as mock_fetch:
            mock_fetch.return_value = first_hop
            result = execute(
                request("https://public.example/"),
                resolver=resolver_returning(ResolvedAddress("8.8.8.8", 4)),
            )
        assert result.result_class == "failure"
        assert result.reason_code == "WEBCTX_REDIRECT_POLICY_BLOCKED"
        # Exactly one transport call: the first (successful) hop. The
        # redirect target was rejected before a second connection attempt.
        assert mock_fetch.call_count == 1

    def test_redirect_without_location_header_rejected(self):
        first_hop = RawResponse(status=302, headers={}, body=b"", truncated=False)
        with patch("webctx_safe_egress.executor.fetch_pinned") as mock_fetch:
            mock_fetch.return_value = first_hop
            result = execute(
                request("https://public.example/"),
                resolver=resolver_returning(ResolvedAddress("8.8.8.8", 4)),
            )
        assert result.result_class == "failure"
        assert result.reason_code == "WEBCTX_REDIRECT_POLICY_BLOCKED"


class TestRedirectLoopAndLimit:
    def test_redirect_loop_rejected(self):
        def looping(*a, **kw):
            return RawResponse(status=302, headers={"location": "https://public.example/a"}, body=b"", truncated=False)

        with patch("webctx_safe_egress.executor.fetch_pinned", side_effect=looping):
            result = execute(
                request("https://public.example/a"),
                resolver=resolver_returning(ResolvedAddress("8.8.8.8", 4)),
            )
        assert result.result_class == "failure"
        assert result.reason_code == "WEBCTX_REDIRECT_POLICY_BLOCKED"

    def test_too_many_redirects_rejected(self):
        calls = {"n": 0}

        def counting(*a, **kw):
            calls["n"] += 1
            return RawResponse(
                status=302, headers={"location": f"https://public.example/{calls['n']}"}, body=b"", truncated=False
            )

        with patch("webctx_safe_egress.executor.fetch_pinned", side_effect=counting):
            result = execute(
                request("https://public.example/0"),
                resolver=resolver_returning(ResolvedAddress("8.8.8.8", 4)),
            )
        assert result.result_class == "failure"
        assert result.reason_code == "WEBCTX_REDIRECT_POLICY_BLOCKED"


class TestSuccessfulRedirectChain:
    def test_valid_redirect_then_success(self):
        responses = [
            RawResponse(status=301, headers={"location": "https://public.example/b"}, body=b"", truncated=False),
            RawResponse(status=200, headers={"content-type": "text/plain"}, body=b"hi", truncated=False),
        ]

        def side_effect(*a, **kw):
            return responses.pop(0)

        with patch("webctx_safe_egress.executor.fetch_pinned", side_effect=side_effect):
            result = execute(
                request("https://public.example/a"),
                resolver=resolver_returning(ResolvedAddress("8.8.8.8", 4)),
            )
        assert result.result_class == "success"
        assert result.http_status == 200
        assert len(result.redirect_chain) == 1
        assert result.final_url == "https://public.example/b"


class TestCloudflareHostedTargetNotSpecialCased:
    """SUN-1221E5Q6G §13 — Cloudflare's *Worker socket* prohibition on
    outbound TCP to Cloudflare's own IP ranges (SUN-1221E5Q6E) is a
    Cloudflare-Workers-runtime-specific restriction, not a general internet
    safety rule, and must NOT have been copied into this executor. A
    Cloudflare-owned public IP (from the real, published range) must pass
    every classifier exactly like any other public address."""

    def test_cloudflare_owned_public_ip_not_prohibited(self):
        from webctx_safe_egress.security.ip_classify import is_prohibited_address

        # 104.16.0.1 is inside Cloudflare's published 104.16.0.0/13 (verified
        # live against cloudflare.com/ips-v4 in SUN-1221E5Q6E).
        assert not is_prohibited_address("104.16.0.1", 4)

    def test_cloudflare_owned_ip_passes_dns_resolution_safety_check(self):
        # `fetch_pinned` is mocked below -- a real (unmocked) call here would
        # attempt a genuine live network connection to a real Cloudflare IP
        # during unit tests, which this suite must never do.
        with patch("webctx_safe_egress.executor.fetch_pinned") as mock_fetch:
            mock_fetch.return_value = RawResponse(status=200, headers={}, body=b"ok", truncated=False)
            result = execute(
                request("https://cloudflare-hosted.example/"),
                resolver=resolver_returning(ResolvedAddress("104.16.0.1", 4)),
            )
        assert result.result_class == "success"
        assert mock_fetch.call_args.kwargs["validated_ip"] == "104.16.0.1"


class TestSingleHopMode:
    """SUN-1221E5Q6G — `single_hop=True` is what `ModalSafeEgressClient`
    sets on every call, so `SecureHttpClient`'s own Worker-side redirect
    loop (packages/provider-adapters/src/http/client.ts) continues to own
    the multi-hop sequence, independently revalidating each redirect target
    itself before ever asking this executor to fetch it again."""

    def test_redirect_returned_verbatim_not_followed(self):
        first_hop = RawResponse(
            status=302, headers={"location": "https://public.example/b"}, body=b"", truncated=False
        )
        with patch("webctx_safe_egress.executor.fetch_pinned") as mock_fetch:
            mock_fetch.return_value = first_hop
            result = execute(
                request("https://public.example/a", single_hop=True),
                resolver=resolver_returning(ResolvedAddress("8.8.8.8", 4)),
            )
        assert result.result_class == "success"
        assert result.http_status == 302
        assert result.headers.get("location") == "https://public.example/b"
        assert mock_fetch.call_count == 1  # never follows the redirect itself

    def test_private_target_still_rejected_before_connect_in_single_hop_mode(self):
        with patch("webctx_safe_egress.executor.fetch_pinned") as mock_fetch:
            result = execute(request("http://127.0.0.1/", single_hop=True))
        assert result.result_class == "failure"
        assert result.reason_code == "WEBCTX_URL_VALIDATION_FAILED"
        mock_fetch.assert_not_called()


class TestApprovedHeaderForwarding:
    """SUN-1222C-Q1R6 — closes the SUN-1222C-Q1R5 gap: an approved caller
    header must actually reach the outbound request the executor makes,
    overriding this executor's own default of the same name; anything not
    on the allowlist (enforced upstream by `WebctxFetchRequest`'s own
    validator, so it can never even reach `execute()`) must never appear."""

    def test_approved_user_agent_overrides_default(self):
        with patch("webctx_safe_egress.executor.fetch_pinned") as mock_fetch:
            mock_fetch.return_value = RawResponse(status=200, headers={}, body=b"ok", truncated=False)
            result = execute(
                request(
                    "https://public.example/",
                    approved_headers={"user-agent": "SITEBORNE hello@siteborne.com"},
                ),
                resolver=resolver_returning(ResolvedAddress("8.8.8.8", 4)),
            )
        assert result.result_class == "success"
        sent_headers = mock_fetch.call_args.kwargs["headers"]
        assert sent_headers["user-agent"] == "SITEBORNE hello@siteborne.com"

    def test_no_approved_headers_keeps_default_user_agent(self):
        with patch("webctx_safe_egress.executor.fetch_pinned") as mock_fetch:
            mock_fetch.return_value = RawResponse(status=200, headers={}, body=b"ok", truncated=False)
            execute(
                request("https://public.example/"),
                resolver=resolver_returning(ResolvedAddress("8.8.8.8", 4)),
            )
        sent_headers = mock_fetch.call_args.kwargs["headers"]
        assert sent_headers["user-agent"] == "SITEBORNE-webctx-safe-egress/1"

    def test_conditional_get_headers_forwarded(self):
        with patch("webctx_safe_egress.executor.fetch_pinned") as mock_fetch:
            mock_fetch.return_value = RawResponse(status=304, headers={}, body=b"", truncated=False)
            execute(
                request(
                    "https://public.example/",
                    approved_headers={"if-none-match": '"abc123"', "if-modified-since": "Wed, 21 Oct 2015 07:28:00 GMT"},
                ),
                resolver=resolver_returning(ResolvedAddress("8.8.8.8", 4)),
            )
        sent_headers = mock_fetch.call_args.kwargs["headers"]
        assert sent_headers["if-none-match"] == '"abc123"'
        assert sent_headers["if-modified-since"] == "Wed, 21 Oct 2015 07:28:00 GMT"

    def test_reserved_keys_are_never_overridable_even_if_smuggled_in(self):
        """Defense-in-depth: even if `_RESERVED_HEADER_KEYS` were somehow
        reached with a reserved key (the schema validator should already
        make this unreachable via the public API), the executor's own merge
        must still refuse to let it override host/connection/accept-encoding."""
        from webctx_safe_egress.executor import _RESERVED_HEADER_KEYS, _fetch_one_hop
        from webctx_safe_egress.security.url_validate import DEFAULT_NETWORK_POLICY

        assert {"host", "connection", "accept-encoding"} == set(_RESERVED_HEADER_KEYS)

        with patch("webctx_safe_egress.executor.fetch_pinned") as mock_fetch:
            mock_fetch.return_value = RawResponse(status=200, headers={}, body=b"ok", truncated=False)
            _fetch_one_hop(
                "https://public.example/",
                policy=DEFAULT_NETWORK_POLICY,
                resolver=resolver_returning(ResolvedAddress("8.8.8.8", 4)),
                deadline_ms_remaining=5000,
                max_response_bytes=65536,
                approved_headers={"host": "attacker.example", "connection": "keep-alive"},
            )
        sent_headers = mock_fetch.call_args.kwargs["headers"]
        assert sent_headers["host"] == "public.example"
        assert sent_headers["connection"] == "close"
