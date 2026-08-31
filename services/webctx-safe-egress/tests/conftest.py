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

    def http_response(self) -> bytes:
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
