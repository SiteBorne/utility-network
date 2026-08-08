"""PDF processing pipeline.

Native text and deterministic table extraction: pdfplumber (line/character-
geometry based, no ML model, no model download, sub-second per page).
OCR (scanned/mixed pages only, per ocr_policy): RapidOCR via ocr.py, on a
page image rendered by pdfplumber/pypdfium2's built-in renderer.
Encryption/structural-validity detection: pypdf.

See docs/decisions/0026-local-ocr-engine.md for why this stack was chosen
over Docling's full ML pipeline (empirically ~90x slower and less reliable
on this worker's fixture corpus, without a corresponding accuracy benefit
for the simple/clean documents this bound-and-verify pipeline targets).
"""

from __future__ import annotations

import io

import pdfplumber
from pypdf import PdfReader
from pypdf.errors import PdfReadError

from .failures import FailureCode, WorkerError
from .hashing import content_hash, normalize_text
from .locators import make_text_locator
from .models import (
    MAX_PAGES,
    MAX_TABLES_PER_PAGE,
    ExtractionMethod,
    OcrPolicy,
    OcrResult,
    PageResult,
    TablePolicy,
    TextBlock,
)
from .ocr import get_engine
from .pages import PageSignals, classify_page
from .tables import normalize_table


def inspect_pdf(data: bytes) -> PdfReader:
    """Structural inspection before expensive processing. Raises
    ENCRYPTED_DOCUMENT / MALFORMED_DOCUMENT / PAGE_LIMIT_EXCEEDED as
    appropriate. Never attempts to bypass encryption.
    """
    try:
        reader = PdfReader(io.BytesIO(data))
    except PdfReadError as exc:
        raise WorkerError(FailureCode.MALFORMED_DOCUMENT, str(exc)) from exc
    except Exception as exc:
        raise WorkerError(FailureCode.MALFORMED_DOCUMENT, str(exc)) from exc

    if reader.is_encrypted:
        # Do not attempt password bypass, brute force, or an empty-password
        # probe beyond what pypdf itself performs to *detect* encryption.
        raise WorkerError(FailureCode.ENCRYPTED_DOCUMENT, "PDF is encrypted")

    try:
        page_count = len(reader.pages)
    except Exception as exc:
        raise WorkerError(FailureCode.MALFORMED_DOCUMENT, str(exc)) from exc

    if page_count == 0:
        raise WorkerError(FailureCode.MALFORMED_DOCUMENT, "zero pages")
    if page_count > MAX_PAGES:
        raise WorkerError(FailureCode.PAGE_LIMIT_EXCEEDED, f"{page_count} > {MAX_PAGES}")

    return reader


def process_pdf(
    data: bytes,
    ocr_policy: OcrPolicy,
    table_policy: TablePolicy,
    maximum_pages: int,
) -> list[PageResult]:
    inspect_pdf(data)  # validates encryption/page-count/structure up front

    results: list[PageResult] = []
    try:
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            pages = pdf.pages[:maximum_pages]
            for idx, page in enumerate(pages, start=1):
                results.append(_process_page(page, idx, ocr_policy, table_policy))
    except WorkerError:
        raise
    except Exception as exc:
        raise WorkerError(FailureCode.EXTRACTION_FAILED, str(exc)) from exc

    return results


def _process_page(page: object, page_number: int, ocr_policy: OcrPolicy, table_policy: TablePolicy) -> PageResult:
    warnings: list[str] = []

    try:
        chars = page.chars  # type: ignore[attr-defined]
        images = page.images  # type: ignore[attr-defined]
        width = float(page.width)  # type: ignore[attr-defined]
        height = float(page.height)  # type: ignore[attr-defined]
        native_text = page.extract_text() or ""  # type: ignore[attr-defined]
    except Exception as exc:
        raise WorkerError(FailureCode.EXTRACTION_FAILED, f"page {page_number}: {exc}") from exc

    page_area = max(width * height, 1.0)
    image_area = 0.0
    for img in images:
        w = max(float(img.get("x1", 0)) - float(img.get("x0", 0)), 0.0)
        h = max(float(img.get("y1", 0)) - float(img.get("y0", 0)), 0.0)
        image_area += w * h
    image_coverage_ratio = image_area / page_area

    tables_found = []
    if table_policy == TablePolicy.EXTRACT:
        try:
            found = page.find_tables()  # type: ignore[attr-defined]
        except Exception as exc:
            warnings.append(f"table detection failed: {exc}")
            found = []
        tables_found = found[:MAX_TABLES_PER_PAGE]
        if len(found) > MAX_TABLES_PER_PAGE:
            warnings.append(f"table count {len(found)} truncated to {MAX_TABLES_PER_PAGE}")

    signals = PageSignals(
        char_count=len(chars),
        image_count=len(images),
        image_coverage_ratio=image_coverage_ratio,
        table_count=len(tables_found),
        is_page_readable=True,
    )
    classification, reasons = classify_page(signals)

    text_blocks: list[TextBlock] = []
    normalized_text = ""
    extraction_method = ExtractionMethod.NONE
    ocr_result: OcrResult | None = None
    ocr_used = False

    needs_ocr = classification.value in ("scanned_image", "mixed") or (
        classification.value == "native_text" and False
    )
    do_ocr = needs_ocr and ocr_policy in (OcrPolicy.IF_NEEDED, OcrPolicy.REQUIRED)
    if needs_ocr and ocr_policy == OcrPolicy.FORBIDDEN:
        warnings.append("OCR would improve extraction but ocr_policy=forbidden")

    if native_text.strip():
        normalized_text = normalize_text(native_text)
        extraction_method = ExtractionMethod.NATIVE
        locator = make_text_locator("native_text", page_number, 0, normalized_text)
        text_blocks.append(TextBlock(ordinal=0, text=normalized_text[:200_000], locator=locator))

    if do_ocr:
        try:
            image = page.to_image(resolution=150).original  # type: ignore[attr-defined]
            ocr_page = get_engine().extract_page(image)
            if ocr_page.text.strip():
                ocr_text = normalize_text(ocr_page.text)
                extraction_method = (
                    ExtractionMethod.HYBRID if extraction_method == ExtractionMethod.NATIVE else ExtractionMethod.OCR
                )
                locator = make_text_locator("ocr_text", page_number, len(text_blocks), ocr_text)
                text_blocks.append(TextBlock(ordinal=len(text_blocks), text=ocr_text[:200_000], locator=locator))
                normalized_text = (normalized_text + "\n" + ocr_text).strip() if normalized_text else ocr_text
                ocr_used = True
                ocr_result = OcrResult(
                    engine="rapidocr",
                    engine_version=getattr(get_engine(), "_version", "unknown"),
                    language="en",
                    mean_confidence=ocr_page.mean_confidence,
                )
        except WorkerError as exc:
            if ocr_policy == OcrPolicy.REQUIRED:
                raise
            warnings.append(f"OCR failed (non-fatal, ocr_policy={ocr_policy.value}): {exc.safe_message}")

    normalized_tables = []
    for i, t in enumerate(tables_found):
        try:
            rows = t.extract()
            normalized_tables.append(normalize_table(page_number, i, rows, t.bbox))
        except WorkerError as exc:
            warnings.append(f"table {i} extraction failed: {exc.safe_message}")

    page_hash = content_hash((normalized_text + "".join(t.table_hash for t in normalized_tables)).encode("utf-8"))

    return PageResult(
        page_number=page_number,
        page_hash=page_hash,
        classification=classification,
        classification_reasons=reasons,
        extraction_method=extraction_method,
        normalized_text=normalized_text[:200_000],
        text_blocks=text_blocks,
        tables=normalized_tables,
        ocr_used=ocr_used,
        ocr_result=ocr_result,
        truncated=False,
        width=width,
        height=height,
        warnings=warnings,
    )
