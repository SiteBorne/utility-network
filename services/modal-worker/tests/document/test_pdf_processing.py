from __future__ import annotations

from modal_worker.document import execute
from modal_worker.document.failures import FailureCode
from modal_worker.document.models import OcrPolicy, PageClassification, TablePolicy

from .conftest import build_request


def test_native_text_pdf_extracts_text(native_text_pdf: bytes) -> None:
    request, accessor = build_request(native_text_pdf, "application/pdf")
    result = execute(request, accessor)
    assert result.status.value == "success"
    assert result.pages[0].classification == PageClassification.NATIVE_TEXT
    assert "Native Text Document" in result.pages[0].normalized_text
    assert result.pages[0].extraction_method.value == "native"


def test_multi_page_pdf_has_deterministic_page_ordering(multi_page_pdf: bytes) -> None:
    request, accessor = build_request(multi_page_pdf, "application/pdf")
    result = execute(request, accessor)
    assert result.status.value == "success"
    assert [p.page_number for p in result.pages] == [1, 2, 3]
    for i, page in enumerate(result.pages, start=1):
        assert f"page {i} of 3" in page.normalized_text


def test_blank_page_classified_blank(blank_pdf: bytes) -> None:
    request, accessor = build_request(blank_pdf, "application/pdf", ocr_policy=OcrPolicy.FORBIDDEN)
    result = execute(request, accessor)
    assert result.status.value == "success"
    assert result.pages[0].classification == PageClassification.BLANK


def test_malformed_pdf_fails_safely(malformed_pdf: bytes) -> None:
    request, accessor = build_request(malformed_pdf, "application/pdf")
    result = execute(request, accessor)
    assert result.status.value == "failed"
    assert result.failure is not None
    assert result.failure.code == FailureCode.MALFORMED_DOCUMENT
    assert "Traceback" not in result.failure.message


def test_encrypted_pdf_not_bypassed(encrypted_pdf: bytes) -> None:
    request, accessor = build_request(encrypted_pdf, "application/pdf")
    result = execute(request, accessor)
    assert result.status.value == "failed"
    assert result.failure is not None
    assert result.failure.code == FailureCode.ENCRYPTED_DOCUMENT


def test_over_page_limit_pdf_rejected(over_page_limit_pdf: bytes) -> None:
    request, accessor = build_request(over_page_limit_pdf, "application/pdf", maximum_pages=10)
    result = execute(request, accessor)
    assert result.status.value == "failed"
    assert result.failure is not None
    assert result.failure.code == FailureCode.PAGE_LIMIT_EXCEEDED


def test_single_table_extracted(single_table_pdf: bytes) -> None:
    request, accessor = build_request(single_table_pdf, "application/pdf", table_policy=TablePolicy.EXTRACT)
    result = execute(request, accessor)
    assert result.status.value == "success"
    tables = result.pages[0].tables
    assert len(tables) == 1
    assert tables[0].headers == ["Name", "Age", "City"]
    assert len(tables[0].rows) == 5


def test_multi_table_page_extracts_both_tables_in_order(multi_table_pdf: bytes) -> None:
    request, accessor = build_request(multi_table_pdf, "application/pdf")
    result = execute(request, accessor)
    assert result.status.value == "success"
    tables = result.pages[0].tables
    assert len(tables) == 2
    assert [t.table_ordinal for t in tables] == [0, 1]
    assert tables[0].headers == ["A", "B"]
    assert tables[1].headers == ["X", "Y", "Z"]


def test_table_policy_skip_does_not_extract_tables(single_table_pdf: bytes) -> None:
    request, accessor = build_request(single_table_pdf, "application/pdf", table_policy=TablePolicy.SKIP)
    result = execute(request, accessor)
    assert result.status.value == "success"
    assert result.pages[0].tables == []


def test_scanned_page_uses_ocr(scanned_page_pdf: bytes) -> None:
    request, accessor = build_request(scanned_page_pdf, "application/pdf", ocr_policy=OcrPolicy.IF_NEEDED)
    result = execute(request, accessor)
    assert result.status.value == "success"
    page = result.pages[0]
    assert page.ocr_used is True
    assert "Scanned Page OCR Text" in page.normalized_text
    assert page.ocr_result is not None
    assert page.ocr_result.engine == "rapidocr"


def test_ocr_forbidden_does_not_run_ocr_even_when_page_needs_it(scanned_page_pdf: bytes) -> None:
    request, accessor = build_request(scanned_page_pdf, "application/pdf", ocr_policy=OcrPolicy.FORBIDDEN)
    result = execute(request, accessor)
    assert result.status.value in ("success", "partial")
    assert result.pages[0].ocr_used is False


def test_content_hash_stable_across_repeated_processing(native_text_pdf: bytes) -> None:
    request1, accessor1 = build_request(native_text_pdf, "application/pdf")
    request2, accessor2 = build_request(native_text_pdf, "application/pdf")
    result1 = execute(request1, accessor1)
    result2 = execute(request2, accessor2)
    assert result1.document is not None and result2.document is not None
    assert result1.document.sha256 == result2.document.sha256
    assert result1.pages[0].page_hash == result2.pages[0].page_hash
