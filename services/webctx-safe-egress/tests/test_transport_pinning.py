"""SUN-1221E5Q6G §7/§11 — real (not mocked) proof of IP-pinned dial + SNI/
certificate-hostname-verification bound to the ORIGINAL hostname, against a
real local TLS server and Python's actual `ssl` module.

Both tests connect to `127.0.0.1` (a validated IP, standing in for a
DNS-resolved address that is NOT the server's certificate name — exactly the
shape every real request takes: dial an IP, verify a hostname). The CA is
trusted via a monkeypatched `ssl.create_default_context` so the only
variable under test is hostname MATCHING, not chain-of-trust; production
`fetch_pinned` itself is exercised completely unmodified.
"""

from __future__ import annotations

import ssl

import pytest

from webctx_safe_egress.transport import TransportConnectError, fetch_pinned


def _trusting_context_factory(ca_file: str):
    def factory():
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ctx.load_verify_locations(cafile=ca_file)
        ctx.check_hostname = True
        ctx.verify_mode = ssl.CERT_REQUIRED
        return ctx

    return factory


class TestPinnedDialAndSniHostnameMatch:
    def test_matching_hostname_succeeds_and_dials_ip_not_hostname(self, local_tls_server, monkeypatch):
        # Prove the CA file actually exists and was used to sign the live
        # server's cert by trusting exactly it, nothing broader.
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmp:
            # Re-derive the same cert file path the fixture generated is not
            # exposed directly; instead fetch the live cert via a probe
            # connection and trust it directly (still real X.509 material,
            # still real `ssl` verification -- not a mock).
            probe_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            probe_ctx.check_hostname = False
            probe_ctx.verify_mode = ssl.CERT_NONE
            import socket as _socket

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

            response = fetch_pinned(
                validated_ip="127.0.0.1",
                original_hostname=local_tls_server.cert_hostname,  # MATCHES the cert
                port=local_tls_server.port,
                scheme="https",
                request_line="GET / HTTP/1.1",
                headers={"host": local_tls_server.cert_hostname, "connection": "close"},
                deadline_ms=5000,
                max_response_bytes=65536,
            )
            assert response.status == 200
            assert response.body == local_tls_server.response_body


class TestTlsHostnameMismatchRejected:
    """SUN-1221E5Q6G §11 RED — the destination IP serves a certificate for a
    DIFFERENT hostname than the one this request is for. Must fail, proving
    certificate hostname verification is bound to `original_hostname`, not
    silently skipped."""

    def test_mismatched_hostname_rejected(self, local_tls_server, monkeypatch):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmp:
            probe_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            probe_ctx.check_hostname = False
            probe_ctx.verify_mode = ssl.CERT_NONE
            import socket as _socket

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

            with pytest.raises(TransportConnectError):
                fetch_pinned(
                    validated_ip="127.0.0.1",
                    original_hostname="attacker-controlled-wrong-host.invalid",  # MISMATCHES
                    port=local_tls_server.port,
                    scheme="https",
                    request_line="GET / HTTP/1.1",
                    headers={"host": "attacker-controlled-wrong-host.invalid", "connection": "close"},
                    deadline_ms=5000,
                    max_response_bytes=65536,
                )


class TestResponseSizeBound:
    """SUN-1221E5Q6G §27 — response-too-large must truncate rather than
    consume unbounded memory/bandwidth, against the same real TLS server."""

    def test_response_larger_than_bound_is_truncated(self, local_tls_server, monkeypatch):
        import tempfile
        from pathlib import Path

        local_tls_server.response_body = b"x" * 10_000

        with tempfile.TemporaryDirectory() as tmp:
            probe_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            probe_ctx.check_hostname = False
            probe_ctx.verify_mode = ssl.CERT_NONE
            import socket as _socket

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

            response = fetch_pinned(
                validated_ip="127.0.0.1",
                original_hostname=local_tls_server.cert_hostname,
                port=local_tls_server.port,
                scheme="https",
                request_line="GET / HTTP/1.1",
                headers={"host": local_tls_server.cert_hostname, "connection": "close"},
                deadline_ms=5000,
                max_response_bytes=1000,
            )
            assert response.truncated
            assert len(response.body) <= 1000
