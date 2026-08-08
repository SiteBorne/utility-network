from __future__ import annotations

from modal_worker.document import execute
from modal_worker.document.failures import FailureCode
from modal_worker.document.models import OcrPolicy

from .conftest import build_request


def test_png_ocr_extracts_text(png_text: bytes) -> None:
    request, accessor = build_request(png_text, "image/png")
    result = execute(request, accessor)
    assert result.status.value == "success"
    assert result.pages[0].ocr_used is True
    assert "PNG OCR Text" in result.pages[0].normalized_text


def test_jpeg_ocr_extracts_text(jpeg_text: bytes) -> None:
    request, accessor = build_request(jpeg_text, "image/jpeg")
    result = execute(request, accessor)
    assert result.status.value == "success"
    assert result.pages[0].ocr_used is True
    assert "JPEG OCR Text" in result.pages[0].normalized_text


def test_blank_image_produces_no_ocr_text(blank_image: bytes) -> None:
    request, accessor = build_request(blank_image, "image/png")
    result = execute(request, accessor)
    assert result.status.value == "success"
    assert result.pages[0].normalized_text == ""


def test_malformed_image_fails_safely(malformed_image: bytes) -> None:
    request, accessor = build_request(malformed_image, "image/png")
    result = execute(request, accessor)
    assert result.status.value == "failed"
    assert result.failure is not None
    assert result.failure.code == FailureCode.MALFORMED_DOCUMENT


def test_image_ocr_forbidden_skips_ocr(png_text: bytes) -> None:
    request, accessor = build_request(png_text, "image/png", ocr_policy=OcrPolicy.FORBIDDEN)
    result = execute(request, accessor)
    assert result.status.value == "success"
    assert result.pages[0].ocr_used is False
    assert result.pages[0].normalized_text == ""


def test_declared_media_type_mismatch_with_actual_bytes_rejected(png_text: bytes) -> None:
    # Bytes are a real PNG but the request declares image/jpeg.
    request, accessor = build_request(
        png_text, "image/png", declared_media_type="image/jpeg", artifact_id="mismatched"
    )
    # artifact_reference.media_type still says png -> caught at validate_request as invalid_request
    result = execute(request, accessor)
    assert result.status.value == "failed"
    assert result.failure is not None
    assert result.failure.code == FailureCode.INVALID_REQUEST
