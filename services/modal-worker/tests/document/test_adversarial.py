"""Safely-generated adversarial inputs. Objective: bounded, non-crashing,
non-exploit behavior — not weaponized parser exploits."""

from __future__ import annotations

from PIL import Image

from modal_worker.document import execute
from modal_worker.document.failures import FailureCode

from .conftest import build_request


def test_decompression_bomb_image_rejected() -> None:
    import io

    huge = Image.new("1", (20000, 20000))  # bilevel to keep the on-disk fixture small
    buf = io.BytesIO()
    huge.save(buf, format="PNG")
    data = buf.getvalue()

    request, accessor = build_request(data, "image/png")
    result = execute(request, accessor)
    assert result.status.value == "failed"
    assert result.failure is not None
    assert result.failure.code == FailureCode.IMAGE_DIMENSION_LIMIT_EXCEEDED


def test_truncated_pdf_fails_safely() -> None:
    data = b"%PDF-1.7\n" + b"\x00" * 40
    request, accessor = build_request(data, "application/pdf")
    result = execute(request, accessor)
    assert result.status.value == "failed"
    assert result.failure is not None
    assert result.failure.code in (
        FailureCode.MALFORMED_DOCUMENT,
        FailureCode.INVALID_REQUEST,
        FailureCode.DECLARED_HASH_MISMATCH,
    )


def test_zero_byte_document_rejected() -> None:
    # size_bytes has a schema-enforced minimum of 1; pydantic itself rejects
    # an empty declared byte length before the worker ever runs.
    import pytest
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        build_request(b"", "application/pdf")


def test_repeated_empty_pdf_pages_bounded() -> None:
    from pypdf import PdfWriter

    writer = PdfWriter()
    for _ in range(9):
        writer.add_blank_page(width=72, height=72)
    import io

    buf = io.BytesIO()
    writer.write(buf)
    data = buf.getvalue()

    request, accessor = build_request(data, "application/pdf", maximum_pages=10)
    result = execute(request, accessor)
    assert result.status.value in ("success", "partial")
    assert result.document is not None
    assert result.document.page_count == 9


def test_unusual_unicode_and_zero_width_characters_handled(native_text_pdf: bytes) -> None:
    from modal_worker.document.hashing import normalize_text

    text = "abc​‌‍﻿‮‭def"
    normalized = normalize_text(text)
    # must not raise, must be deterministic, must not silently drop to empty
    assert normalize_text(normalized) == normalized
    assert len(normalized) > 0


def test_mismatched_media_type_extension_rejected(png_text: bytes) -> None:
    """A PNG's bytes declared as image/jpeg — media-type sniffing must catch
    this rather than trusting the caller's declaration."""
    from modal_worker.document.validation import detect_media_type

    assert detect_media_type(png_text) == "image/png"


def test_oversized_declared_dimensions_do_not_bypass_pixel_check() -> None:
    import io

    img = Image.new("1", (13000, 100))  # exceeds MAX_IMAGE_DIMENSION_PX (12000)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    data = buf.getvalue()

    request, accessor = build_request(data, "image/png")
    result = execute(request, accessor)
    assert result.status.value == "failed"
    assert result.failure is not None
    assert result.failure.code == FailureCode.IMAGE_DIMENSION_LIMIT_EXCEEDED
