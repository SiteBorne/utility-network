from __future__ import annotations

from modal_worker.document.hashing import (
    canonical_hash,
    canonical_json_bytes,
    content_hash,
    normalize_text,
)


def test_raw_source_hash_stable() -> None:
    data = b"hello world"
    assert content_hash(data) == content_hash(data)


def test_one_byte_change_produces_different_hash() -> None:
    a = content_hash(b"hello world")
    b = content_hash(b"hello worle")
    assert a != b


def test_content_hash_format() -> None:
    h = content_hash(b"x")
    assert h.startswith("sha256:")
    assert len(h) == len("sha256:") + 64


def test_normalize_text_crlf_to_lf() -> None:
    assert normalize_text("a\r\nb\rc\n") == "a\nb\nc\n"


def test_normalize_text_stable() -> None:
    text = "Line one  \nLine two\t\n"
    assert normalize_text(text) == normalize_text(normalize_text(text))


def test_canonical_json_key_order_independent() -> None:
    a = canonical_json_bytes({"b": 1, "a": 2})
    b = canonical_json_bytes({"a": 2, "b": 1})
    assert a == b


def test_canonical_hash_key_order_independent() -> None:
    a = canonical_hash({"z": [1, 2], "a": {"nested": True}})
    b = canonical_hash({"a": {"nested": True}, "z": [1, 2]})
    assert a == b


def test_canonical_hash_sensitive_to_value_change() -> None:
    a = canonical_hash({"cell": "Alice"})
    b = canonical_hash({"cell": "Bob"})
    assert a != b
