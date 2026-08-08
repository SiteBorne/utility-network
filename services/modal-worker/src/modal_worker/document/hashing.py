"""Deterministic hashing and canonical serialization.

Mirrors the sha256:<hex> convention already used by
packages/provider-adapters/src/evidence/source-observation.ts
(computeContentHash) and by the frozen schemas
(authorized-artifact-reference.schema.json's content_hash pattern
`^sha256:[a-f0-9]{64}$`).
"""

from __future__ import annotations

import hashlib
import json
import unicodedata
from typing import Any


def sha256_hex(data: bytes) -> str:
    """Raw SHA-256 hex digest, no prefix."""
    return hashlib.sha256(data).hexdigest()


def content_hash(data: bytes) -> str:
    """`sha256:<hex>` form, matching the frozen contract's content_hash pattern."""
    return f"sha256:{sha256_hex(data)}"


def normalize_text(text: str) -> str:
    """Deterministic text normalization prior to hashing.

    - Unicode NFC normalization (stable across platforms/locales).
    - CRLF/CR -> LF (explicit newline policy).
    - Trailing whitespace stripped per line; no other whitespace collapsing
      (extracted text is evidence — do not lossily rewrite it).
    """
    normalized = unicodedata.normalize("NFC", text)
    normalized = normalized.replace("\r\n", "\n").replace("\r", "\n")
    lines = [line.rstrip() for line in normalized.split("\n")]
    return "\n".join(lines)


def normalized_text_hash(text: str) -> str:
    return content_hash(normalize_text(text).encode("utf-8"))


def canonical_json_bytes(value: Any) -> bytes:
    """Deterministic JSON serialization for hashing structured data.

    - Object keys sorted (order-independent).
    - No insignificant whitespace.
    - No NaN/Infinity (would be non-canonical/non-interoperable).
    - No locale-sensitive formatting (json.dumps is locale-independent).

    This intentionally does not implement full RFC 8785 JCS (the PCC
    canonicalization standard used at the service-contract layer) — this
    worker produces its own intermediate result, not a PCC document. Later
    composition into a PCC document is where JCS canonicalization applies.
    """
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")


def canonical_hash(value: Any) -> str:
    return content_hash(canonical_json_bytes(value))
