"""SUN-1221E5Q6G — safe DNS resolution, ported from
`packages/provider-adapters/src/http/safe-dns-resolve.ts`'s `resolveSafeAddress`.

Deliberate difference from the TS source: the TS client queries a fixed
Cloudflare DoH endpoint (`cloudflare-dns.com`) because it runs *inside* a
Cloudflare Worker and needs a resolver reachable from that sandbox. This
executor runs off-Cloudflare specifically so it is not coupled to Cloudflare
at all — it resolves directly via the host's own resolver
(`socket.getaddrinfo`), injected behind `Resolver` so tests can supply a
deterministic double (this is exactly what makes the DNS-rebinding test in
§10 of the SUN-1221E5Q6G directive provable: a test resolver can return one
answer on the first call and a different one on a later call, then the test
asserts the executor never calls it again after the initial safety
decision — see `executor.py`, which resolves exactly once per hop and reuses
the selected address for both TLS SNI/cert validation and the TCP dial).

The fail-closed semantics (zero answers -> unsafe; ANY prohibited answer in a
mixed set -> the WHOLE resolution is unsafe) are ported byte-for-byte from
safe-dns-resolve.ts:110-129.
"""

from __future__ import annotations

import socket
from dataclasses import dataclass
from typing import Protocol

from .ip_classify import is_prohibited_address


@dataclass(frozen=True)
class ResolvedAddress:
    ip: str
    family: int  # 4 or 6


@dataclass(frozen=True)
class SafeDnsResolution:
    safe: bool
    selected_address: ResolvedAddress | None = None
    reason: str | None = None
    all_answers: tuple[ResolvedAddress, ...] = ()
    prohibited_answers: tuple[ResolvedAddress, ...] = ()


class Resolver(Protocol):
    def __call__(self, hostname: str) -> list[ResolvedAddress]: ...


def system_resolver(hostname: str) -> list[ResolvedAddress]:
    """Real resolution via the host's own resolver — returns every A/AAAA
    candidate (not just the first), exactly as the TS DoH query does."""
    try:
        infos = socket.getaddrinfo(hostname, None, proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        return []
    seen: set[tuple[str, int]] = set()
    out: list[ResolvedAddress] = []
    for family, _type, _proto, _canon, sockaddr in infos:
        ip = str(sockaddr[0])
        fam = 4 if family == socket.AF_INET else 6 if family == socket.AF_INET6 else None
        if fam is None or (ip, fam) in seen:
            continue
        seen.add((ip, fam))
        out.append(ResolvedAddress(ip=ip, family=fam))
    return out


def resolve_safe_address(hostname: str, resolver: Resolver = system_resolver) -> SafeDnsResolution:
    """Ports safe-dns-resolve.ts:97-130 `resolveSafeAddress`."""
    all_answers = resolver(hostname)

    if not all_answers:
        return SafeDnsResolution(safe=False, reason="dns_resolution_returned_no_answers")

    prohibited = tuple(a for a in all_answers if is_prohibited_address(a.ip, a.family))
    if prohibited:
        return SafeDnsResolution(
            safe=False,
            reason="prohibited_or_mixed_dns_answer",
            all_answers=tuple(all_answers),
            prohibited_answers=prohibited,
        )

    return SafeDnsResolution(
        safe=True,
        selected_address=all_answers[0],
        all_answers=tuple(all_answers),
    )
