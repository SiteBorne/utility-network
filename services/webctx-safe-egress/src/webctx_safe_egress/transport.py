"""SUN-1221E5Q6G — IP-pinned HTTP/1.1 transport.

The one property every other guarantee in this service depends on: the TCP
connection is dialed against the *validated* IP address (never a hostname —
`socket.create_connection` never performs a second DNS lookup when given a
literal IP string), while TLS SNI and certificate hostname verification use
the *original* request hostname (via `server_hostname=`, which
`ssl.SSLContext.wrap_socket` uses both to build the ClientHello's SNI
extension and, when `context.check_hostname` is True — the default for
`ssl.create_default_context()` — to verify the presented certificate
against). There is no code path between DNS validation and the TCP `connect`
call that performs a second hostname resolution.
"""

from __future__ import annotations

import socket
import ssl
import time
from dataclasses import dataclass


class ResponseTooLargeError(Exception):
    pass


class TransportTimeoutError(Exception):
    pass


class TransportConnectError(Exception):
    pass


class MalformedResponseError(Exception):
    pass


@dataclass(frozen=True)
class RawResponse:
    status: int
    headers: dict[str, str]
    body: bytes
    truncated: bool


def _read_until(sock: socket.socket | ssl.SSLSocket, terminator: bytes, deadline: float, max_bytes: int) -> bytes:
    buf = b""
    while terminator not in buf:
        if time.monotonic() > deadline:
            raise TransportTimeoutError("timed out reading response headers")
        if len(buf) > max_bytes:
            raise ResponseTooLargeError("response headers exceeded bound before terminator")
        chunk = sock.recv(4096)
        if not chunk:
            raise MalformedResponseError("connection closed before headers completed")
        buf += chunk
    return buf


def fetch_pinned(
    *,
    validated_ip: str,
    original_hostname: str,
    port: int,
    scheme: str,
    request_line: str,
    headers: dict[str, str],
    deadline_ms: int,
    max_response_bytes: int,
    connect_timeout_s: float = 10.0,
) -> RawResponse:
    """Performs exactly one HTTP/1.1 request/response over a connection
    dialed by IP (never hostname), with TLS (for `scheme == 'https'`) SNI and
    certificate verification bound to `original_hostname`.

    Deliberately hand-rolled rather than delegated to a general-purpose HTTP
    library's own connection-pooling/retry machinery, precisely so this
    function is the single, auditable place the dial-by-IP /
    verify-by-hostname property is proven, not something that could silently
    regress behind an abstraction that re-resolves on retry or redirect.
    """
    deadline = time.monotonic() + (deadline_ms / 1000.0)

    raw_sock = socket.socket(socket.AF_INET if _looks_ipv4(validated_ip) else socket.AF_INET6, socket.SOCK_STREAM)
    raw_sock.settimeout(connect_timeout_s)
    try:
        raw_sock.connect((validated_ip, port))
    except OSError as err:
        raw_sock.close()
        raise TransportConnectError(f"connect to {validated_ip}:{port} failed: {err}") from err

    if scheme == "https":
        ctx = ssl.create_default_context()
        try:
            sock: socket.socket | ssl.SSLSocket = ctx.wrap_socket(raw_sock, server_hostname=original_hostname)
        except ssl.SSLError as err:
            raw_sock.close()
            raise TransportConnectError(f"TLS handshake to {original_hostname} via {validated_ip} failed: {err}") from err
    else:
        sock = raw_sock

    sock.settimeout(max(0.001, deadline - time.monotonic()))

    header_lines = "\r\n".join(f"{k}: {v}" for k, v in headers.items())
    request_bytes = f"{request_line}\r\n{header_lines}\r\n\r\n".encode()

    try:
        sock.sendall(request_bytes)

        raw = _read_until(sock, b"\r\n\r\n", deadline, max_response_bytes)
        head, _, rest = raw.partition(b"\r\n\r\n")
        lines = head.split(b"\r\n")
        status_line = lines[0].decode("latin-1", errors="replace")
        parts = status_line.split(" ", 2)
        if len(parts) < 2 or not parts[1].isdigit():
            raise MalformedResponseError(f"malformed status line: {status_line!r}")
        status = int(parts[1])

        parsed_headers: dict[str, str] = {}
        for line in lines[1:]:
            if b":" not in line:
                continue
            k, _, v = line.partition(b":")
            parsed_headers[k.decode("latin-1").strip().lower()] = v.decode("latin-1").strip()

        body = bytearray(rest)
        truncated = False
        content_length = parsed_headers.get("content-length")
        target_len = int(content_length) if content_length and content_length.isdigit() else None

        while True:
            if target_len is not None and len(body) >= target_len:
                break
            if len(body) >= max_response_bytes:
                truncated = True
                break
            if time.monotonic() > deadline:
                raise TransportTimeoutError("timed out reading response body")
            try:
                chunk = sock.recv(4096)
            except TimeoutError as err:
                raise TransportTimeoutError("timed out reading response body") from err
            if not chunk:
                break
            body.extend(chunk)

        return RawResponse(
            status=status,
            headers=parsed_headers,
            body=bytes(body[:max_response_bytes]),
            truncated=truncated,
        )
    finally:
        sock.close()


def _looks_ipv4(ip: str) -> bool:
    return ip.count(".") == 3 and ":" not in ip
