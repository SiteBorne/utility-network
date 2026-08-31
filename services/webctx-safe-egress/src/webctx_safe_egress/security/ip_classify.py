"""SUN-1221E5Q6G — pure IP-address classification, ported literally from
`packages/provider-adapters/src/policy/network-policy.ts` (read in full during
this checkpoint, not reimplemented from memory — see the equivalence matrix
in docs/reports/SUN-1221E5Q6G-safe-egress-implementation.md for the exact
line-by-line mapping).

Deliberately does NOT use Python's `ipaddress.IPv4Address.is_private` /
`.is_reserved` etc. — those stdlib properties cover a *different* rule set
(e.g. `is_private` includes 100.64.0.0/10 CGNAT, which the TS source does
NOT block) and would silently diverge from the policy this service exists to
port faithfully. Every range below is the exact CIDR equivalent of one of
network-policy.ts's regexes.
"""

from __future__ import annotations

import ipaddress

IpAddress = ipaddress.IPv4Address | ipaddress.IPv6Address

# network-policy.ts:27-41 `isPrivateIp` (ranges also independently covered by
# the more specific classifiers below, but validateUrl ORs all of them, so
# the exact function boundary doesn't matter for the pass/fail decision).
_PRIVATE_V4 = (
    ipaddress.ip_network("10.0.0.0/8"),  # /^10\./
    ipaddress.ip_network("192.168.0.0/16"),  # /^192\.168\./
    ipaddress.ip_network("172.16.0.0/12"),  # /^172\.(1[6-9]|2[0-9]|3[0-1])\./
    ipaddress.ip_network("127.0.0.0/8"),  # /^127\./
    ipaddress.ip_network("169.254.0.0/16"),  # /^169\.254\./
    ipaddress.ip_network("224.0.0.0/4"),  # /^22[4-9]\./ + /^23[0-9]\./ (224-239)
    ipaddress.ip_network("240.0.0.0/4"),  # /^24[0-9]\./ + /^25[0-5]\./ (240-255)
)
# fc00::/7 (RFC 4193 unique-local) -- network-policy.ts:38-40's
# /^f[cd][0-9a-f]{0,2}:/i, ported as the proper CIDR block rather than the
# string-prefix regex (a deliberate strengthening: the regex only checks the
# first hex group's leading chars, the CIDR check is exact and covers every
# address the regex was trying to approximate plus edge cases it could miss;
# see the equivalence matrix's SEMANTIC_MATCH notes).
_PRIVATE_V6 = (ipaddress.ip_network("fc00::/7"),)

# network-policy.ts:45-47 `isLoopback`
_LOOPBACK_V4 = ipaddress.ip_network("127.0.0.0/8")

# network-policy.ts:49-51 `isLinkLocal`
_LINK_LOCAL_V4 = ipaddress.ip_network("169.254.0.0/16")
_LINK_LOCAL_V6 = ipaddress.ip_network("fe80::/10")

# network-policy.ts:53-55 `isMulticast`
_MULTICAST_V4 = ipaddress.ip_network("224.0.0.0/4")  # 22[4-9]./23[0-9].
_MULTICAST_V6 = ipaddress.ip_network("ff00::/8")

# network-policy.ts:57-59 `isReserved`
_RESERVED_V4 = (
    ipaddress.ip_network("0.0.0.0/8"),  # /^0\./
    ipaddress.ip_network("240.0.0.0/4"),  # /^24[0-9]\./ + /^25[0-5]\./
)


def _addr(ip: str) -> IpAddress:
    return ipaddress.ip_address(ip)


def extract_ipv4_mapped_address(ip: str) -> str | None:
    """Ports network-policy.ts:67-86 `extractIpv4MappedAddress` — recovers the
    embedded IPv4 address from an IPv4-mapped IPv6 literal (::ffff:0:0/96),
    or None if `ip` is not IPv4-mapped."""
    try:
        addr = ipaddress.IPv6Address(ip)
    except (ipaddress.AddressValueError, ValueError):
        return None
    mapped = addr.ipv4_mapped
    return str(mapped) if mapped is not None else None


def is_private_ip(ip: str) -> bool:
    """Ports network-policy.ts:25-43 `isPrivateIp`."""
    addr = _addr(ip)
    if isinstance(addr, ipaddress.IPv4Address):
        return any(addr in net for net in _PRIVATE_V4)
    if addr == ipaddress.IPv6Address("::1"):
        return True
    return any(addr in net for net in _PRIVATE_V6)


def is_loopback(ip: str) -> bool:
    """Ports network-policy.ts:45-47 `isLoopback`."""
    addr = _addr(ip)
    if isinstance(addr, ipaddress.IPv4Address):
        return addr in _LOOPBACK_V4
    return addr == ipaddress.IPv6Address("::1")


def is_link_local(ip: str) -> bool:
    """Ports network-policy.ts:49-51 `isLinkLocal`."""
    addr = _addr(ip)
    if isinstance(addr, ipaddress.IPv4Address):
        return addr in _LINK_LOCAL_V4
    return addr in _LINK_LOCAL_V6


def is_multicast(ip: str) -> bool:
    """Ports network-policy.ts:53-55 `isMulticast`."""
    addr = _addr(ip)
    if isinstance(addr, ipaddress.IPv4Address):
        return addr in _MULTICAST_V4
    return addr in _MULTICAST_V6


def is_reserved(ip: str) -> bool:
    """Ports network-policy.ts:57-59 `isReserved`."""
    addr = _addr(ip)
    if isinstance(addr, ipaddress.IPv4Address):
        return any(addr in net for net in _RESERVED_V4)
    return False  # TS `isReserved` only ever matches IPv4 patterns.


def is_prohibited_address(ip: str, family: int) -> bool:
    """Ports safe-dns-resolve.ts:41-47 `isProhibitedResolvedIp` — recurses
    into the embedded IPv4 check for IPv4-mapped IPv6 first, exactly as the
    TS source does."""
    if family == 6:
        mapped = extract_ipv4_mapped_address(ip.lower())
        if mapped is not None:
            return is_prohibited_address(mapped, 4)
    return is_loopback(ip) or is_private_ip(ip) or is_link_local(ip) or is_multicast(ip) or is_reserved(ip)
