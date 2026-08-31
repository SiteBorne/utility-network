"""SUN-1221E5Q6G — URL/redirect-chain validation, ported literally from
`packages/provider-adapters/src/policy/network-policy.ts`'s `validateUrl` /
`validateRedirectChain` (`DEFAULT_NETWORK_POLICY`, read in full this
checkpoint)."""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urlsplit

from .ip_classify import (
    extract_ipv4_mapped_address,
    is_link_local,
    is_loopback,
    is_multicast,
    is_private_ip,
    is_reserved,
)

_IPV4_LITERAL = re.compile(r"^(\d{1,3}\.){3}\d{1,3}$")


@dataclass(frozen=True)
class NetworkPolicy:
    allow_private_ips: bool = False
    allow_loopback: bool = False
    allow_link_local: bool = False
    allow_multicast: bool = False
    allow_reserved: bool = False
    allowed_ports: tuple[int, ...] = (80, 443)
    blocked_ports: tuple[int, ...] = (22, 23, 25, 110, 143, 993, 995, 3306, 5432, 6379, 27017)
    max_redirects: int = 10
    allowed_schemes: tuple[str, ...] = ("http", "https")


DEFAULT_NETWORK_POLICY = NetworkPolicy()


@dataclass(frozen=True)
class ValidationResult:
    valid: bool
    reason: str | None = None


def validate_url(url: str, policy: NetworkPolicy = DEFAULT_NETWORK_POLICY) -> ValidationResult:
    """Ports network-policy.ts:88-157 `validateUrl`."""
    parts = urlsplit(url)
    scheme = parts.scheme
    if scheme not in policy.allowed_schemes:
        return ValidationResult(False, f"Scheme {scheme}: not allowed")

    if parts.port is not None:
        port = parts.port
    else:
        port = 443 if scheme == "https" else 80
    if port in policy.blocked_ports:
        return ValidationResult(False, f"Port {port} is blocked")
    if policy.allowed_ports and port not in policy.allowed_ports:
        return ValidationResult(False, f"Port {port} not in allowed list")

    # `urlsplit(...).hostname` already lowercases and strips IPv6 brackets
    # (Python stdlib), so no manual bracket-stripping is needed here — unlike
    # the TS source, which must strip WHATWG URL's retained brackets itself
    # (network-policy.ts:109-112).
    hostname = parts.hostname or ""
    if hostname in ("localhost", "localhost.localdomain"):
        return ValidationResult(False, "Hostname localhost not allowed")

    literal = hostname
    is_ipv4 = bool(_IPV4_LITERAL.match(literal))
    is_ipv6 = ":" in literal

    if is_ipv4:
        if not policy.allow_loopback and is_loopback(literal):
            return ValidationResult(False, "Loopback IP not allowed")
        if not policy.allow_private_ips and is_private_ip(literal):
            return ValidationResult(False, "Private IP not allowed")
        if not policy.allow_link_local and is_link_local(literal):
            return ValidationResult(False, "Link-local IP not allowed")
        if not policy.allow_multicast and is_multicast(literal):
            return ValidationResult(False, "Multicast IP not allowed")
        if not policy.allow_reserved and is_reserved(literal):
            return ValidationResult(False, "Reserved IP not allowed")
    elif is_ipv6:
        normalized = literal.lower()
        mapped_ipv4 = extract_ipv4_mapped_address(normalized)
        if mapped_ipv4:
            # Python's `urlsplit(...).hostname` strips IPv6 brackets (unlike
            # WHATWG's `URL.hostname`, which retains them — see
            # network-policy.ts:109's own comment). Replace the BRACKETED
            # form so the substituted bare IPv4 literal doesn't inherit
            # stray brackets `urlsplit` would then reject as malformed.
            return validate_url(url.replace(f"[{hostname}]", mapped_ipv4), policy)
        if not policy.allow_loopback and is_loopback(normalized):
            return ValidationResult(False, "Loopback IP not allowed")
        if not policy.allow_private_ips and is_private_ip(normalized):
            return ValidationResult(False, "Private IP not allowed")
        if not policy.allow_link_local and is_link_local(normalized):
            return ValidationResult(False, "Link-local IP not allowed")
        if not policy.allow_multicast and is_multicast(normalized):
            return ValidationResult(False, "Multicast IP not allowed")

    return ValidationResult(True)


def validate_redirect_chain(
    urls: list[str], policy: NetworkPolicy = DEFAULT_NETWORK_POLICY
) -> ValidationResult:
    """Ports network-policy.ts:159-182 `validateRedirectChain`."""
    if len(urls) > policy.max_redirects:
        return ValidationResult(False, f"Redirect chain exceeds maximum of {policy.max_redirects}")

    seen: set[str] = set()
    for u in urls:
        if u in seen:
            return ValidationResult(False, "Redirect loop detected")
        seen.add(u)
        result = validate_url(u, policy)
        if not result.valid:
            return ValidationResult(False, f"Redirect target invalid: {result.reason}")

    return ValidationResult(True)
