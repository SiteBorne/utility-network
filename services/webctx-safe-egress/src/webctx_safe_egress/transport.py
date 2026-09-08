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


# SUN-1222C-Q1-D1 — RFC 7230 §4.1 bounded chunked-transfer-coding decoder.
# `fetch_pinned`'s body-reading loop previously recognized ONLY
# `Content-Length`; a `Transfer-Encoding: chunked` response (Content-Length
# and Transfer-Encoding are mutually exclusive per §3.3.3 — a chunked
# response never carries Content-Length) fell through to the
# connection-close-delimited path, which accumulated the RAW wire bytes —
# hex chunk-size lines, CRLF framing, chunk extensions, trailers — as
# though they were the body itself. That raw blob was base64-shipped
# through the Modal executor unchanged and reached
# `SecureHttpClient.fetchJson`'s `JSON.parse` on the Cloudflare Worker
# side, which failed on whatever the leading chunk-size bytes happened to
# tokenize as (the real Q1 failure: "Unexpected number in JSON at position
# 1" — V8's signature for a bare "0" immediately followed by another
# decimal digit, exactly what a hex chunk-size line like "05dc" produces).
class _ChunkedBodyReader:
    """Stateful reader over the same recv() stream `fetch_pinned` already
    owns. Bounded: enforces `max_response_bytes` on the DECODED payload
    (never buffers an unbounded amount before checking), rejects malformed
    framing instead of silently returning corrupt/partial data, and
    discards chunk extensions and trailers safely without letting either
    smuggle bytes into the returned body.
    """

    def __init__(self, sock: socket.socket | ssl.SSLSocket, initial: bytes, deadline: float, max_response_bytes: int):
        self._sock = sock
        self._buf = initial
        self._deadline = deadline
        self._max_response_bytes = max_response_bytes

    def _fill(self) -> None:
        if time.monotonic() > self._deadline:
            raise TransportTimeoutError("timed out reading chunked response body")
        try:
            chunk = self._sock.recv(4096)
        except TimeoutError as err:
            raise TransportTimeoutError("timed out reading chunked response body") from err
        if not chunk:
            raise MalformedResponseError("connection closed mid-chunked-stream (no terminal chunk received)")
        self._buf += chunk

    def _read_line(self) -> bytes:
        """Reads one CRLF-terminated line (the line itself, without the
        CRLF), growing the buffer as needed. Used for chunk-size lines and
        trailer header lines — both are header-shaped, so bounded the same
        way `_read_until` bounds header reads."""
        while b"\r\n" not in self._buf:
            if len(self._buf) > _MAX_CHUNK_LINE_BYTES:
                raise MalformedResponseError("chunk-size/trailer line exceeded bound before CRLF")
            self._fill()
        line, _, rest = self._buf.partition(b"\r\n")
        self._buf = rest
        return line

    def _read_exact(self, n: int) -> bytes:
        while len(self._buf) < n:
            self._fill()
        data, self._buf = self._buf[:n], self._buf[n:]
        return data

    def read_body(self) -> tuple[bytes, bool]:
        out = bytearray()
        truncated = False
        while True:
            size_line = self._read_line()
            # Chunk extensions (`;key=value`) are permitted after the size
            # and before CRLF (RFC 7230 §4.1.1) — discard them; only the
            # hex size digits before any `;` are meaningful.
            hex_size = size_line.split(b";", 1)[0].strip()
            try:
                size = int(hex_size, 16)
            except ValueError as err:
                raise MalformedResponseError(f"malformed chunk-size line: {size_line!r}") from err
            if size == 0:
                break
            if len(out) + size > self._max_response_bytes:
                # Read and discard only up to the bound, then stop — never
                # allocate unbounded memory for an over-large chunk.
                remaining = self._max_response_bytes - len(out)
                if remaining > 0:
                    out.extend(self._read_exact(remaining))
                truncated = True
                # Still must drain this chunk's own trailing CRLF and the
                # rest of the stream is no longer needed — the connection
                # will be closed by the caller's `finally: sock.close()`.
                break
            data = self._read_exact(size)
            out.extend(data)
            terminator = self._read_exact(2)
            if terminator != b"\r\n":
                raise MalformedResponseError("chunk data not terminated by CRLF")
        if not truncated:
            # Trailers: zero or more header-shaped lines, terminated by an
            # empty line. Bounded the same way chunk-size lines are.
            trailer_bytes = 0
            while True:
                line = self._read_line()
                trailer_bytes += len(line)
                if trailer_bytes > _MAX_TRAILER_BYTES:
                    raise MalformedResponseError("trailer section exceeded bound")
                if line == b"":
                    break
        return bytes(out), truncated


_MAX_CHUNK_LINE_BYTES = 4096
_MAX_TRAILER_BYTES = 16384


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

        # SUN-1222C-Q1-D1 — Content-Length and Transfer-Encoding: chunked
        # are mutually exclusive (RFC 7230 §3.3.3); a chunked response
        # never carries Content-Length, so this branch must come first and
        # be checked independently, not folded into the Content-Length
        # length-bound loop below.
        transfer_encoding = parsed_headers.get("transfer-encoding", "").lower()
        if "chunked" in [enc.strip() for enc in transfer_encoding.split(",")]:
            reader = _ChunkedBodyReader(sock, bytes(rest), deadline, max_response_bytes)
            decoded_body, truncated = reader.read_body()
            return RawResponse(
                status=status,
                headers=parsed_headers,
                body=decoded_body,
                truncated=truncated,
            )

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
