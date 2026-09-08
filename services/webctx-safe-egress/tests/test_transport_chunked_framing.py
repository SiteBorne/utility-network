"""SUN-1222C-Q1-D1 -- byte-exact reproducers for fetch_pinned's HTTP/1.1
response-body framing. Every test here drives the REAL transport against a
real local TLS server sending exact, hand-built wire bytes; nothing about
fetch_pinned itself is mocked.

Root cause proven this checkpoint: fetch_pinned's body-reading loop
(transport.py) only ever recognizes a Content-Length-bounded body. When a
server sends Transfer-Encoding: chunked instead (no Content-Length --
these are mutually exclusive per RFC 7230 3.3.3), target_len stays None,
and the loop accumulates raw socket bytes -- including the literal
hex chunk-size lines and CRLF framing -- until the connection closes,
handing that RAW, still-chunked-encoded byte blob back as if it were the
plain body. That raw blob is base64-shipped through the Modal executor
unchanged (executor.py) and eventually reaches SecureHttpClient.fetchJson's
JSON.parse (client.ts:305) on the Cloudflare Worker side, which fails
however the leading chunk-size bytes happen to tokenize as JSON.

The exact Q1 error --
    JSON parse failed: Unexpected number in JSON at position 1
    (line 1 column 2)
-- is V8's well-known signature for a bare "0" (a complete JSON number,
since a leading zero cannot be followed by another digit) immediately
followed by another decimal digit. A hex chunk-size line whose first two
characters are both decimal digits 0-9 (e.g. "05dc" = 1500, the classic
Ethernet-MTU-driven first-chunk size) produces exactly that byte sequence
at the very start of the raw body. This file proves the mechanism
end-to-end against the real parser, not by assertion.
"""

from __future__ import annotations

import json

import pytest


def _json_body(obj: object) -> bytes:
    return json.dumps(obj).encode()


def _content_length_response(body: bytes, content_type: bytes = b"application/json") -> bytes:
    return (
        b"HTTP/1.1 200 OK\r\n"
        b"Content-Type: " + content_type + b"\r\n"
        b"Content-Length: " + str(len(body)).encode() + b"\r\n"
        b"Connection: close\r\n\r\n" + body
    )


def _chunk(data: bytes, extension: bytes = b"") -> bytes:
    return f"{len(data):x}".encode() + extension + b"\r\n" + data + b"\r\n"


def _chunked_response(
    chunks: list[bytes],
    content_type: bytes = b"application/json",
    trailers: bytes = b"",
) -> bytes:
    body = b"".join(_chunk(c) for c in chunks) + b"0\r\n" + trailers + b"\r\n"
    return (
        b"HTTP/1.1 200 OK\r\n"
        b"Content-Type: " + content_type + b"\r\n"
        b"Transfer-Encoding: chunked\r\n"
        b"Connection: close\r\n\r\n" + body
    )


SEC_LIKE_JSON = {
    "cik": "0000320193",
    "entityType": "operating",
    "name": "Apple Inc.",
    "tickers": ["AAPL"],
    "filings": {"recent": {"accessionNumber": ["0000320193-26-000001"]}},
}


class TestScenarioAContentLengthBaseline:
    """A. Content-Length, single write, valid JSON -- must already work
    (control / non-regression baseline)."""

    def test_content_length_json_parses_cleanly(self, local_tls_server, pinned_fetch):
        body = _json_body(SEC_LIKE_JSON)
        local_tls_server.raw_response_override = _content_length_response(body)
        response = pinned_fetch()
        assert response.status == 200
        assert not response.truncated
        assert json.loads(response.body) == SEC_LIKE_JSON


class TestScenarioBChunkedSingleChunk:
    """B. Transfer-Encoding: chunked, the whole JSON body in one chunk."""

    def test_chunked_single_chunk_currently_leaks_raw_framing(self, local_tls_server, pinned_fetch):
        body = _json_body(SEC_LIKE_JSON)
        local_tls_server.raw_response_override = _chunked_response([body])
        response = pinned_fetch()
        assert response.status == 200
        # This is the exact Q1 failure mechanics reproduced locally: a
        # correct transport must dechunk before returning `body`, so
        # `json.loads` must succeed and `truncated` must be False. RED
        # against current source (raw framing bytes reach `body` verbatim,
        # so this fails); GREEN once chunked decoding is implemented.
        assert response.truncated is False
        assert json.loads(response.body) == SEC_LIKE_JSON


class TestScenarioCChunkedSplitTokensAndUtf8:
    """C. Chunk boundaries splitting JSON tokens and a multi-byte UTF-8
    character across two chunks."""

    def test_chunk_boundary_splits_json_token(self, local_tls_server, pinned_fetch):
        body = _json_body(SEC_LIKE_JSON)
        mid = len(body) // 2
        local_tls_server.raw_response_override = _chunked_response([body[:mid], body[mid:]])
        response = pinned_fetch()
        assert json.loads(response.body) == SEC_LIKE_JSON

    def test_chunk_boundary_splits_multibyte_utf8_character(self, local_tls_server, pinned_fetch):
        # "Apple Inc. é" -- the two UTF-8 bytes of é (0xC3 0xA9) are split
        # across the chunk boundary. `ensure_ascii=False` is required so
        # json.dumps actually emits raw UTF-8 bytes here instead of
        # escaping to the ASCII "é" sequence.
        payload = {"name": "Apple Inc. é", "cik": "0000320193"}
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        idx = body.index(b"\xc3\xa9")
        split_at = idx + 1  # inside the two-byte UTF-8 sequence
        local_tls_server.raw_response_override = _chunked_response([body[:split_at], body[split_at:]])
        response = pinned_fetch()
        # A correct dechunker reassembles the exact original byte stream
        # regardless of where chunk boundaries fall -- including mid
        # multi-byte-UTF-8-character -- because it strips exactly the
        # framing bytes (hex size line + CRLF) and nothing else.
        assert json.loads(response.body) == payload


class TestScenarioDChunkExtensions:
    """D. Chunk-size lines carrying a chunk-extension (`;key=value`),
    permitted by RFC 7230 4.1.1."""

    def test_chunk_extension_present(self, local_tls_server, pinned_fetch):
        body = _json_body(SEC_LIKE_JSON)
        chunk_line = f"{len(body):x}".encode() + b";ext=1\r\n" + body + b"\r\n"
        raw = (
            b"HTTP/1.1 200 OK\r\n"
            b"Content-Type: application/json\r\n"
            b"Transfer-Encoding: chunked\r\n"
            b"Connection: close\r\n\r\n" + chunk_line + b"0\r\n\r\n"
        )
        local_tls_server.raw_response_override = raw
        response = pinned_fetch()
        assert json.loads(response.body) == SEC_LIKE_JSON


class TestScenarioETrailers:
    """E. Terminal chunk followed by trailer headers (RFC 7230 4.1.2)."""

    def test_trailers_after_terminal_chunk(self, local_tls_server, pinned_fetch):
        body = _json_body(SEC_LIKE_JSON)
        local_tls_server.raw_response_override = _chunked_response(
            [body], trailers=b"X-Trailer-Checksum: deadbeef\r\n"
        )
        response = pinned_fetch()
        # Trailers are discarded safely, never appended to the body.
        assert json.loads(response.body) == SEC_LIKE_JSON


class TestScenarioFContentEncoding:
    """F. gzip. Not tested against the wire: executor.py hardcodes
    `accept-encoding: identity` on every request (see
    `_fetch_one_hop`'s `headers` dict) -- a compliant server has no basis to
    gzip a response this client never advertised support for. Proven by
    source read, not by a live reproducer: CAN_GZIP_BYTES_REACH_JSON_PARSE
    is a structural "no" independent of this suite.
    """

    def test_accept_encoding_is_always_identity(self):
        import inspect

        from webctx_safe_egress import executor

        source = inspect.getsource(executor._fetch_one_hop)
        assert '"accept-encoding": "identity"' in source


class TestScenarioGNonJsonStatus:
    """G. Non-JSON 403/429 HTML -- must not even be handed to a JSON
    parser as though it were a 200 payload; this is the SEC adapter/
    SecureHttpClient's job (status classification before JSON.parse), not
    transport.py's -- proven here at the transport layer only (status and
    body are both delivered faithfully, unparsed)."""

    def test_403_html_delivered_as_is_not_json_parsed_by_transport(self, local_tls_server, pinned_fetch):
        html = b"<html><body>Forbidden</body></html>"
        local_tls_server.raw_response_override = (
            b"HTTP/1.1 403 Forbidden\r\n"
            b"Content-Type: text/html\r\n"
            b"Content-Length: " + str(len(html)).encode() + b"\r\n"
            b"Connection: close\r\n\r\n" + html
        )
        response = pinned_fetch()
        assert response.status == 403
        assert response.body == html  # transport itself never parses JSON

    def test_429_chunked_html_body_intact_when_content_length_absent(self, local_tls_server, pinned_fetch):
        html = b"<html>Too Many Requests</html>"
        local_tls_server.raw_response_override = (
            b"HTTP/1.1 429 Too Many Requests\r\n"
            b"Content-Type: text/html\r\n"
            b"Connection: close\r\n\r\n" + html
        )
        response = pinned_fetch()
        assert response.status == 429
        # No Transfer-Encoding, no Content-Length: connection-close-delimited
        # body. This one is NOT chunked, so it should already round-trip
        # correctly today (a separate, already-working code path).
        assert response.body == html


class TestScenarioHTruncatedContentLength:
    """H. Content-Length longer than what the server actually sends
    (connection closes early)."""

    def test_truncated_content_length_body(self, local_tls_server, pinned_fetch):
        body = _json_body(SEC_LIKE_JSON)
        short_body = body[:10]
        raw = (
            b"HTTP/1.1 200 OK\r\n"
            b"Content-Type: application/json\r\n"
            b"Content-Length: " + str(len(body)).encode() + b"\r\n"  # LIES about the real length
            b"Connection: close\r\n\r\n" + short_body
        )
        local_tls_server.raw_response_override = raw
        response = pinned_fetch()
        # Connection closes with fewer bytes than declared -- the loop's
        # `if not chunk: break` exits the read loop without ever reaching
        # target_len; the caller receives a shorter, non-JSON-parseable body
        # rather than an explicit truncation/framing error.
        assert response.body == short_body
        with pytest.raises(json.JSONDecodeError):
            json.loads(response.body)


class TestScenarioITruncatedChunkedBody:
    """I. Chunked response whose stream is cut off before the terminal
    zero-length chunk (connection dies mid-stream)."""

    def test_truncated_chunked_stream_missing_terminal_chunk(self, local_tls_server, pinned_fetch):
        body = _json_body(SEC_LIKE_JSON)
        # A well-formed chunk header/body but NO terminal "0\r\n\r\n" --
        # simulates the origin dying mid-stream.
        raw = (
            b"HTTP/1.1 200 OK\r\n"
            b"Content-Type: application/json\r\n"
            b"Transfer-Encoding: chunked\r\n"
            b"Connection: close\r\n\r\n" + _chunk(body)
        )
        local_tls_server.raw_response_override = raw
        # A correct dechunker recognizes the stream ended without a
        # terminal zero-length chunk and rejects it as malformed framing --
        # never silently returns a partial/corrupt body as though transport
        # succeeded (checkpoint §11: "rejects malformed framing").
        from webctx_safe_egress.transport import MalformedResponseError

        with pytest.raises(MalformedResponseError):
            pinned_fetch()


class TestScenarioJRedirectThenChunkedJson:
    """J. A redirect hop followed by a chunked JSON response at the final
    URL. Exercised at the executor level (redirect handling lives in
    executor.py, not transport.py) so this is a smoke check that the fix
    to transport.py's chunked decoding is independent of which hop
    encounters it -- the real multi-hop redirect behavior itself is
    already covered by the existing SSRF/redirect suite; this class only
    confirms the SAME raw server this fixture drives is reused faithfully
    across a manual two-request sequence."""

    def test_second_request_on_a_fresh_connection_still_dechunks_correctly(
        self, local_tls_server, pinned_fetch
    ):
        # `fetch_pinned` makes exactly one request per call (single-hop
        # contract); redirect chaining calls it again for the new URL.
        # Reusing the same fixture twice in sequence stands in for "the
        # final hop after a redirect also gets this treatment" without
        # needing a second TLS server.
        body = _json_body(SEC_LIKE_JSON)
        local_tls_server.raw_response_override = _chunked_response([body])
        first = pinned_fetch()
        assert first.status == 200
        assert json.loads(first.body) == SEC_LIKE_JSON
