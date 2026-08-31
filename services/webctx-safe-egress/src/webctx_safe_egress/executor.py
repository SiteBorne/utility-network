"""SUN-1221E5Q6G §5/§14 — the authoritative executor security algorithm.

Every hop (the initial request AND every redirect target) independently runs
the full sequence: parse -> scheme/port/userinfo validation -> hostname
normalization -> DNS resolution -> per-address classification -> fail-closed
rejection of any unsafe/mixed answer -> select one validated address ->
IP-pinned connect -> TLS SNI/cert bound to the *original* hostname -> bounded
request/response -> redirect handling. Nothing here trusts a
previously-computed decision for a *different* URL — a redirect is a brand
new target, revalidated from scratch (§17/§18 of the directive).
"""

from __future__ import annotations

import base64
import time
from dataclasses import dataclass
from urllib.parse import urljoin, urlsplit

from .schemas import RedirectHop, WebctxFetchFailure, WebctxFetchRequest, WebctxFetchSuccess
from .security.dns_resolve import Resolver, resolve_safe_address, system_resolver
from .security.url_validate import DEFAULT_NETWORK_POLICY, NetworkPolicy, validate_url
from .transport import (
    MalformedResponseError,
    RawResponse,
    ResponseTooLargeError,
    TransportConnectError,
    TransportTimeoutError,
    fetch_pinned,
)

_REDIRECT_STATUSES = {301, 302, 303, 307, 308}


class ExecutorFailure(Exception):
    def __init__(self, reason_code: str, stage: str, message: str):
        super().__init__(message)
        self.reason_code = reason_code
        self.stage = stage
        self.message = message


def _reject_userinfo(url: str) -> None:
    """Deliberate strengthening beyond the literal TS port (directive §5
    step 4): `network-policy.ts`'s `validateUrl` never checks for embedded
    `user:pass@host` credentials. Rejecting them here can only make this
    executor MORE restrictive than SafeSocket, never less — a URL SafeSocket
    would have accepted and this executor rejects is a false negative in the
    conservative direction, not a security regression."""
    netloc = urlsplit(url).netloc
    if "@" in netloc:
        raise ExecutorFailure(
            "WEBCTX_URL_VALIDATION_FAILED", "url_validation", "userinfo/credentials in URL are not allowed"
        )


def _resolve_and_pick(hostname: str, resolver: Resolver) -> str:
    if _is_ip_literal(hostname):
        # validate_url already classified literal IPs; no DNS step needed
        # for an IP target, mirroring socket-http-client.ts's
        # `isIpLiteral(hostname) ? hostname : await this.resolveOrThrow(...)`.
        return hostname
    resolution = resolve_safe_address(hostname, resolver)
    if not resolution.safe or resolution.selected_address is None:
        raise ExecutorFailure(
            "WEBCTX_DNS_RESOLUTION_FAILED" if resolution.reason == "dns_resolution_returned_no_answers"
            else "WEBCTX_SSRF_BLOCKED",
            "dns_resolution",
            resolution.reason or "dns resolution failed safety policy",
        )
    return resolution.selected_address.ip


def _is_ip_literal(hostname: str) -> bool:
    import ipaddress

    try:
        ipaddress.ip_address(hostname)
        return True
    except ValueError:
        return False


@dataclass
class HopResult:
    raw: RawResponse
    final_url: str
    scheme: str
    hostname: str
    port: int


def _fetch_one_hop(
    url: str,
    *,
    policy: NetworkPolicy,
    resolver: Resolver,
    deadline_ms_remaining: int,
    max_response_bytes: int,
) -> HopResult:
    _reject_userinfo(url)

    validation = validate_url(url, policy)
    if not validation.valid:
        raise ExecutorFailure("WEBCTX_URL_VALIDATION_FAILED", "url_validation", validation.reason or "invalid URL")

    parts = urlsplit(url)
    hostname = parts.hostname or ""
    scheme = parts.scheme
    port = parts.port or (443 if scheme == "https" else 80)

    validated_ip = _resolve_and_pick(hostname, resolver)

    request_line = f"GET {parts.path or '/'}{'?' + parts.query if parts.query else ''} HTTP/1.1"
    headers = {
        "host": hostname,
        "user-agent": "SITEBORNE-webctx-safe-egress/1",
        "accept-encoding": "identity",
        "connection": "close",
    }

    try:
        raw = fetch_pinned(
            validated_ip=validated_ip,
            original_hostname=hostname,
            port=port,
            scheme=scheme,
            request_line=request_line,
            headers=headers,
            deadline_ms=deadline_ms_remaining,
            max_response_bytes=max_response_bytes,
        )
    except TransportConnectError as err:
        raise ExecutorFailure("WEBCTX_UPSTREAM_CONNECTION_FAILED", "connect", str(err)) from err
    except TransportTimeoutError as err:
        raise ExecutorFailure("WEBCTX_TIMEOUT", "response_read", str(err)) from err
    except ResponseTooLargeError as err:
        raise ExecutorFailure("WEBCTX_RESPONSE_TOO_LARGE", "response_read", str(err)) from err
    except MalformedResponseError as err:
        raise ExecutorFailure("WEBCTX_HTTP_PREMATURE_EOF", "response_read", str(err)) from err

    return HopResult(raw=raw, final_url=url, scheme=scheme, hostname=hostname, port=port)


def execute(
    request: WebctxFetchRequest,
    *,
    policy: NetworkPolicy = DEFAULT_NETWORK_POLICY,
    resolver: Resolver = system_resolver,
) -> WebctxFetchSuccess | WebctxFetchFailure:
    started = time.monotonic()

    def elapsed_ms() -> int:
        return int((time.monotonic() - started) * 1000)

    redirect_chain: list[RedirectHop] = []
    current_url = request.target_url
    visited_urls: list[str] = []

    try:
        for _hop in range(policy.max_redirects + 1):
            visited_urls.append(current_url)
            redirect_validation = None
            if len(visited_urls) > 1:
                from .security.url_validate import validate_redirect_chain

                redirect_validation = validate_redirect_chain(visited_urls, policy)
                if not redirect_validation.valid:
                    raise ExecutorFailure(
                        "WEBCTX_REDIRECT_POLICY_BLOCKED", "redirect", redirect_validation.reason or "redirect rejected"
                    )

            remaining_ms = request.deadline_ms - elapsed_ms()
            if remaining_ms <= 0:
                raise ExecutorFailure("WEBCTX_TIMEOUT", "response_read", "deadline exceeded before hop started")

            hop = _fetch_one_hop(
                current_url,
                policy=policy,
                resolver=resolver,
                deadline_ms_remaining=remaining_ms,
                max_response_bytes=request.max_response_bytes,
            )

            if hop.raw.status in _REDIRECT_STATUSES and not request.single_hop:
                location = hop.raw.headers.get("location")
                if not location:
                    raise ExecutorFailure(
                        "WEBCTX_REDIRECT_POLICY_BLOCKED", "redirect", "redirect status with no Location header"
                    )
                redirect_chain.append(RedirectHop(url=current_url, status=hop.raw.status))
                current_url = urljoin(current_url, location)
                continue

            return WebctxFetchSuccess(
                http_status=hop.raw.status,
                final_url=hop.final_url,
                redirect_chain=redirect_chain,
                headers=dict(hop.raw.headers),
                content_base64=base64.b64encode(hop.raw.body).decode("ascii"),
                content_type=hop.raw.headers.get("content-type"),
                truncated=hop.raw.truncated,
                elapsed_ms=elapsed_ms(),
            )

        raise ExecutorFailure(
            "WEBCTX_REDIRECT_POLICY_BLOCKED", "redirect", f"exceeded maximum of {policy.max_redirects} redirects"
        )
    except ExecutorFailure as failure:
        return WebctxFetchFailure(
            reason_code=failure.reason_code,  # type: ignore[arg-type]
            stage=failure.stage,  # type: ignore[arg-type]
            message=failure.message,
            elapsed_ms=elapsed_ms(),
        )
