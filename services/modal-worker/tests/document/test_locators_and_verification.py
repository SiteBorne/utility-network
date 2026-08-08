from __future__ import annotations

import pytest

from modal_worker.document import execute
from modal_worker.document.failures import FailureCode, WorkerError
from modal_worker.document.locators import make_text_locator, resolve_locator
from modal_worker.document.models import DocumentMetadata, PageClassification, PageResult
from modal_worker.document.verification import verify_result

from .conftest import build_request


def test_native_text_locator_resolves(native_text_pdf: bytes) -> None:
    request, accessor = build_request(native_text_pdf, "application/pdf")
    result = execute(request, accessor)
    locator = result.pages[0].text_blocks[0].locator
    resolve_locator(locator, page_count=len(result.pages))  # must not raise


def test_table_cell_locator_resolves(single_table_pdf: bytes) -> None:
    request, accessor = build_request(single_table_pdf, "application/pdf")
    result = execute(request, accessor)
    locator = result.pages[0].tables[0].locator
    resolve_locator(locator, page_count=len(result.pages))


def test_locator_pointing_outside_page_bounds_fails() -> None:
    bad = make_text_locator("native_text", page=99, ordinal=0, text="x")
    with pytest.raises(WorkerError) as exc_info:
        resolve_locator(bad, page_count=3)
    assert exc_info.value.code == FailureCode.INTERNAL_CONSISTENCY_FAILURE


def test_ocr_text_locator_resolves(scanned_page_pdf: bytes) -> None:
    request, accessor = build_request(scanned_page_pdf, "application/pdf")
    result = execute(request, accessor)
    for block in result.pages[0].text_blocks:
        resolve_locator(block.locator, page_count=len(result.pages))


def _make_page(page_number: int, page_hash: str = "sha256:" + "a" * 64) -> PageResult:
    return PageResult(
        page_number=page_number,
        page_hash=page_hash,
        classification=PageClassification.BLANK,
        classification_reasons=[],
        extraction_method="none",  # type: ignore[arg-type]
    )


def test_verify_result_detects_duplicate_page_ordinal() -> None:
    doc = DocumentMetadata(
        sha256="sha256:" + "0" * 64,
        byte_length=10,
        media_type="application/pdf",
        page_count=2,
        processing_timestamp="2026-01-01T00:00:00Z",
        extraction_engine="test",
        extraction_engine_version="0",
    )
    pages = [_make_page(1), _make_page(1)]
    with pytest.raises(WorkerError) as exc_info:
        verify_result(doc, pages)
    assert exc_info.value.code == FailureCode.INTERNAL_CONSISTENCY_FAILURE


def test_verify_result_detects_page_count_mismatch() -> None:
    doc = DocumentMetadata(
        sha256="sha256:" + "0" * 64,
        byte_length=10,
        media_type="application/pdf",
        page_count=5,
        processing_timestamp="2026-01-01T00:00:00Z",
        extraction_engine="test",
        extraction_engine_version="0",
    )
    pages = [_make_page(1)]
    with pytest.raises(WorkerError) as exc_info:
        verify_result(doc, pages)
    assert exc_info.value.code == FailureCode.INTERNAL_CONSISTENCY_FAILURE


def test_verify_result_accepts_complete_sequence() -> None:
    doc = DocumentMetadata(
        sha256="sha256:" + "0" * 64,
        byte_length=10,
        media_type="application/pdf",
        page_count=3,
        processing_timestamp="2026-01-01T00:00:00Z",
        extraction_engine="test",
        extraction_engine_version="0",
    )
    pages = [_make_page(1), _make_page(2), _make_page(3)]
    verify_result(doc, pages)  # must not raise
