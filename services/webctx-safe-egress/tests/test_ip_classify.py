"""SUN-1221E5Q6G §6 — security policy equivalence matrix, as executable
tests. Every case here corresponds to a row in the equivalence matrix in
docs/reports/SUN-1221E5Q6G-safe-egress-implementation.md."""

from webctx_safe_egress.security.ip_classify import (
    extract_ipv4_mapped_address,
    is_link_local,
    is_loopback,
    is_multicast,
    is_private_ip,
    is_prohibited_address,
    is_reserved,
)


class TestIPv4Private:
    def test_10_slash_8(self):
        assert is_private_ip("10.1.2.3")

    def test_192_168(self):
        assert is_private_ip("192.168.1.1")

    def test_172_16_slash_12_boundaries(self):
        assert is_private_ip("172.16.0.1")
        assert is_private_ip("172.31.255.255")
        assert not is_private_ip("172.15.255.255")
        assert not is_private_ip("172.32.0.1")

    def test_public_ip_not_private(self):
        assert not is_private_ip("8.8.8.8")
        assert not is_private_ip("1.1.1.1")


class TestLoopback:
    def test_ipv4_loopback(self):
        assert is_loopback("127.0.0.1")
        assert is_loopback("127.255.255.255")

    def test_ipv6_loopback(self):
        assert is_loopback("::1")

    def test_public_not_loopback(self):
        assert not is_loopback("8.8.8.8")


class TestLinkLocal:
    def test_ipv4_link_local(self):
        assert is_link_local("169.254.1.1")

    def test_ipv6_link_local(self):
        assert is_link_local("fe80::1")

    def test_public_not_link_local(self):
        assert not is_link_local("8.8.8.8")


class TestMulticast:
    def test_ipv4_multicast_range(self):
        assert is_multicast("224.0.0.1")
        assert is_multicast("239.255.255.255")
        assert not is_multicast("223.255.255.255")
        assert not is_multicast("240.0.0.1")

    def test_ipv6_multicast(self):
        assert is_multicast("ff00::1")


class TestReserved:
    def test_ipv4_reserved(self):
        assert is_reserved("0.0.0.1")
        assert is_reserved("240.0.0.1")
        assert is_reserved("255.255.255.255")

    def test_public_not_reserved(self):
        assert not is_reserved("8.8.8.8")


class TestCGNATNotBlockedByDefault:
    """SITEBORNE's SafeSocket policy does NOT block 100.64.0.0/10 (CGNAT) --
    confirmed by direct read of network-policy.ts, which has no rule for it.
    This executor must match that exact policy, not Python stdlib's broader
    `ipaddress.is_private` (which DOES flag CGNAT) -- a divergence here would
    make the Python port MORE restrictive than SafeSocket, silently breaking
    parity."""

    def test_cgnat_range_not_flagged_by_any_classifier(self):
        ip = "100.64.0.1"
        assert not is_private_ip(ip)
        assert not is_loopback(ip)
        assert not is_link_local(ip)
        assert not is_multicast(ip)
        assert not is_reserved(ip)


class TestIPv4MappedIPv6:
    def test_dotted_form_extracts_embedded_ipv4(self):
        assert extract_ipv4_mapped_address("::ffff:192.168.1.1") == "192.168.1.1"

    def test_hex_group_form_extracts_embedded_ipv4(self):
        # ::ffff:c0a8:101 == ::ffff:192.168.1.1
        assert extract_ipv4_mapped_address("::ffff:c0a8:101") == "192.168.1.1"

    def test_non_mapped_returns_none(self):
        assert extract_ipv4_mapped_address("2606:4700::1") is None

    def test_prohibited_address_recurses_into_mapped_ipv4(self):
        assert is_prohibited_address("::ffff:127.0.0.1", 6)
        assert not is_prohibited_address("::ffff:8.8.8.8", 6)


class TestProhibitedAddressUnion:
    def test_public_ipv4_not_prohibited(self):
        assert not is_prohibited_address("8.8.8.8", 4)

    def test_private_ipv4_prohibited(self):
        assert is_prohibited_address("10.0.0.1", 4)

    def test_public_ipv6_not_prohibited(self):
        assert not is_prohibited_address("2606:4700::1111", 6)

    def test_private_ipv6_ula_prohibited(self):
        assert is_prohibited_address("fd00::1", 6)
