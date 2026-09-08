"""SUN-1221E5Q6G — real local TLS server fixture, used to prove
`transport.fetch_pinned`'s dial-by-IP / SNI-and-cert-by-hostname behavior
against Python's actual `ssl` module (not a mock of it) — the single most
security-critical property in this service."""

from __future__ import annotations

import socket
import ssl
import subprocess
import tempfile
import threading
from dataclasses import dataclass
from pathlib import Path

import pytest


@dataclass
class LocalTlsServer:
    port: int
    cert_hostname: str
    response_body: bytes = b"hello from local tls test server\n"
    # SUN-1222C-Q1-D1 — when set, the server sends these exact bytes
    # verbatim instead of `http_response()`'s fixed Content-Length shape,
    # so tests can construct byte-exact HTTP/1.1 responses (chunked framing,
    # chunk extensions, trailers, truncation, non-JSON status/media-type)
    # against the REAL `fetch_pinned` transport -- no mock of the parser
    # itself, only control over what bytes arrive on the wire.
    raw_response_override: bytes | None = None

    def http_response(self) -> bytes:
        if self.raw_response_override is not None:
            return self.raw_response_override
        body = self.response_body
        return (
            b"HTTP/1.1 200 OK\r\n"
            b"Content-Type: text/plain\r\n"
            b"Content-Length: " + str(len(body)).encode() + b"\r\n"
            b"Connection: close\r\n\r\n" + body
        )


def _generate_self_signed_cert(hostname: str, out_dir: Path) -> tuple[Path, Path]:
    key_path = out_dir / "key.pem"
    cert_path = out_dir / "cert.pem"
    subprocess.run(
        [
            "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
            "-keyout", str(key_path), "-out", str(cert_path),
            "-days", "1", "-subj", f"/CN={hostname}",
            "-addext", f"subjectAltName=DNS:{hostname}",
        ],
        check=True,
        capture_output=True,
    )
    return cert_path, key_path


@pytest.fixture
def local_tls_server():
    """Starts a real TLS server on 127.0.0.1 with a self-signed cert issued
    for `cert-hostname.invalid`, and returns a `LocalTlsServer` describing
    it. The caller controls what `server_hostname` it connects with, to
    prove both the matching-hostname success path and the
    mismatched-hostname rejection path against real `ssl` verification."""
    with tempfile.TemporaryDirectory() as tmp:
        cert_hostname = "cert-hostname.invalid"
        cert_path, key_path = _generate_self_signed_cert(cert_hostname, Path(tmp))

        server_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        server_ctx.load_cert_chain(certfile=str(cert_path), keyfile=str(key_path))

        raw = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        raw.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        raw.bind(("127.0.0.1", 0))
        raw.listen(5)
        port = raw.getsockname()[1]

        info = LocalTlsServer(port=port, cert_hostname=cert_hostname)
        stop = threading.Event()

        def serve():
            raw.settimeout(0.5)
            while not stop.is_set():
                try:
                    conn, _ = raw.accept()
                except TimeoutError:
                    continue
                try:
                    tls_conn = server_ctx.wrap_socket(conn, server_side=True)
                    tls_conn.recv(4096)  # discard request
                    tls_conn.sendall(info.http_response())
                    tls_conn.close()
                except (ssl.SSLError, OSError):
                    pass  # expected for the mismatched-hostname test: client aborts handshake

        thread = threading.Thread(target=serve, daemon=True)
        thread.start()
        try:
            yield info
        finally:
            stop.set()
            thread.join(timeout=2)
            raw.close()


def _trusting_context_factory(ca_file: str):
    """SUN-1222C-Q1-D1 -- shared with `test_transport_pinning.py`'s own
    local copy of the same helper (not imported from there, to avoid this
    fixture reaching into a test module); trusts exactly the one real
    peer certificate probed from the live local server, nothing broader."""

    def factory():
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ctx.load_verify_locations(cafile=ca_file)
        ctx.check_hostname = True
        ctx.verify_mode = ssl.CERT_REQUIRED
        return ctx

    return factory


@pytest.fixture
def pinned_fetch(local_tls_server, monkeypatch):
    """SUN-1222C-Q1-D1 — same real-TLS-server trust setup every test in
    `test_transport_pinning.py` repeats inline, factored into one fixture so
    the byte-exact framing reproducers below can each be a single `call()`,
    with the exact real X.509 trust chain (not a mock) established once.
    Returns a callable: `call(max_response_bytes=65536, deadline_ms=5000) ->
    RawResponse`, invoking the real, unmodified `fetch_pinned` against
    whatever `local_tls_server.raw_response_override` a test has set.
    """
    import socket as _socket
    import tempfile
    from pathlib import Path

    from webctx_safe_egress.transport import fetch_pinned

    with tempfile.TemporaryDirectory() as tmp:
        probe_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        probe_ctx.check_hostname = False
        probe_ctx.verify_mode = ssl.CERT_NONE

        raw = _socket.create_connection(("127.0.0.1", local_tls_server.port), timeout=2)
        tls = probe_ctx.wrap_socket(raw, server_hostname=local_tls_server.cert_hostname)
        der = tls.getpeercert(binary_form=True)
        tls.close()
        cert_path = Path(tmp) / "peer.pem"
        cert_path.write_bytes(ssl.DER_cert_to_PEM_cert(der).encode())

        monkeypatch.setattr(
            "webctx_safe_egress.transport.ssl.create_default_context",
            _trusting_context_factory(str(cert_path)),
        )

        def call(*, max_response_bytes: int = 65536, deadline_ms: int = 5000):
            return fetch_pinned(
                validated_ip="127.0.0.1",
                original_hostname=local_tls_server.cert_hostname,
                port=local_tls_server.port,
                scheme="https",
                request_line="GET / HTTP/1.1",
                headers={"host": local_tls_server.cert_hostname, "connection": "close"},
                deadline_ms=deadline_ms,
                max_response_bytes=max_response_bytes,
            )

        yield call
