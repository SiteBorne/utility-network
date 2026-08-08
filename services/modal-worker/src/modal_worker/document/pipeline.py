"""Top-level document-processing pipeline orchestration.

authorized artifact reference -> input validation -> byte/media validation ->
document hash -> document inspection -> page enumeration -> page
classification -> native extraction -> OCR when required -> table
extraction -> normalization -> evidence locator generation -> per-page
hashing -> bounded extraction result -> internal verification.

This module imports only from within `document/` and from `pdfplumber`,
`pypdf`, `PIL` (via pdf.py/images.py/ocr.py) — never `modal`. See
modal_app.py for the deployment wrapper.
"""

from __future__ import annotations

import time
from datetime import UTC, datetime

from .artifacts import ArtifactAccessor
from .failures import FailureCode, WorkerError
from .hashing import content_hash
from .images import open_bounded_image
from .locators import make_text_locator
from .models import (
    DocumentMetadata,
    ExtractionMethod,
    FailureInfo,
    Metrics,
    PageClassification,
    PageResult,
    PageWarning,
    TextBlock,
    WorkerRequest,
    WorkerResult,
    WorkerStatus,
)
from .ocr import get_engine
from .pdf import process_pdf
from .validation import validate_bytes, validate_request
from .verification import verify_result

WORKER_VERSION = "1.0.0"
PDF_ENGINE_NAME = "pdfplumber+pypdf"
PDF_ENGINE_VERSION = "0.11+6.0"


def execute(request: WorkerRequest, accessor: ArtifactAccessor) -> WorkerResult:
    """The single public entry point. Never raises — every failure path is
    caught and returned as a classified WorkerResult(status=failed).
    """
    start = time.monotonic()
    try:
        return _execute_inner(request, accessor, start)
    except WorkerError as exc:
        return _failed_result(request.job_id, exc, start)
    except Exception as exc:  # last-resort backstop; still classified, never a raw traceback
        return _failed_result(
            request.job_id,
            WorkerError(FailureCode.INTERNAL_CONSISTENCY_FAILURE, f"unclassified exception: {exc}"),
            start,
        )


def _failed_result(job_id: str, exc: WorkerError, start: float) -> WorkerResult:
    return WorkerResult(
        job_id=job_id,
        status=WorkerStatus.FAILED,
        failure=FailureInfo(
            code=exc.code,
            message=exc.safe_message,
            retryable=exc.retryable,
            stage=exc.stage,
            partial_result_available=False,
        ),
        metrics=Metrics(
            input_bytes=0,
            page_count=0,
            native_pages=0,
            ocr_pages=0,
            table_heavy_pages=0,
            elapsed_ms=(time.monotonic() - start) * 1000,
            extracted_characters=0,
            table_count=0,
            table_cell_count=0,
            output_bytes=0,
            warnings_count=0,
        ),
    )


def _execute_inner(request: WorkerRequest, accessor: ArtifactAccessor, start: float) -> WorkerResult:
    validate_request(request)

    data = accessor.read_bounded(request.artifact_reference.artifact_id, request.maximum_bytes)
    validate_bytes(data, request)

    if _elapsed_ms(start) > request.timeout_ms:
        raise WorkerError(FailureCode.TIMEOUT, "timeout exceeded during artifact validation")

    if request.declared_media_type == "application/pdf":
        pages = process_pdf(
            data,
            ocr_policy=request.ocr_policy,
            table_policy=request.table_policy,
            maximum_pages=request.maximum_pages,
        )
    else:
        pages = [_process_single_image_page(data, request)]

    if _elapsed_ms(start) > request.timeout_ms:
        raise WorkerError(FailureCode.TIMEOUT, "timeout exceeded during extraction")

    document = DocumentMetadata(
        sha256=content_hash(data),
        byte_length=len(data),
        media_type=request.declared_media_type,
        page_count=len(pages),
        processing_timestamp=datetime.now(UTC).isoformat(),
        extraction_engine=PDF_ENGINE_NAME,
        extraction_engine_version=PDF_ENGINE_VERSION,
        ocr_engine="rapidocr" if any(p.ocr_used for p in pages) else None,
        ocr_engine_version=(
            getattr(get_engine(), "_version", "unknown") if any(p.ocr_used for p in pages) else None
        ),
    )

    verify_result(document, pages)

    limitations: list[str] = []
    if any(p.classification == PageClassification.UNSUPPORTED_OR_UNREADABLE for p in pages):
        limitations.append("one or more pages could not be classified or read")
    if any(p.truncated for p in pages):
        limitations.append("one or more pages had truncated extraction output")

    metrics = _compute_metrics(data, pages, start)

    warnings = [
        PageWarning(page=p.page_number, code="page_warning", message=w) for p in pages for w in p.warnings
    ]

    status = WorkerStatus.PARTIAL if warnings or limitations else WorkerStatus.SUCCESS

    return WorkerResult(
        job_id=request.job_id,
        status=status,
        document=document,
        pages=pages,
        warnings=warnings,
        limitations=limitations[:20],
        metrics=metrics,
        provenance=[
            f"artifact:{request.artifact_reference.artifact_id}",
            f"engine:{PDF_ENGINE_NAME}:{PDF_ENGINE_VERSION}",
        ],
    )


def _process_single_image_page(data: bytes, request: WorkerRequest) -> PageResult:
    from .models import OcrPolicy, OcrResult

    image = open_bounded_image(data)
    width, height = image.size

    ocr_used = False
    ocr_result: OcrResult | None = None
    normalized_text = ""
    text_blocks: list[TextBlock] = []
    extraction_method = ExtractionMethod.NONE

    if request.ocr_policy in (OcrPolicy.IF_NEEDED, OcrPolicy.REQUIRED):
        try:
            ocr_page = get_engine().extract_page(image)
            if ocr_page.text.strip():
                from .hashing import normalize_text

                normalized_text = normalize_text(ocr_page.text)
                extraction_method = ExtractionMethod.OCR
                locator = make_text_locator("ocr_text", 1, 0, normalized_text)
                text_blocks.append(TextBlock(ordinal=0, text=normalized_text[:200_000], locator=locator))
                ocr_used = True
                ocr_result = OcrResult(
                    engine="rapidocr",
                    engine_version=getattr(get_engine(), "_version", "unknown"),
                    language="en",
                    mean_confidence=ocr_page.mean_confidence,
                )
        except WorkerError:
            if request.ocr_policy == OcrPolicy.REQUIRED:
                raise

    classification = PageClassification.SCANNED_IMAGE if ocr_used else PageClassification.BLANK
    page_hash = content_hash(normalized_text.encode("utf-8")) if normalized_text else content_hash(data)

    return PageResult(
        page_number=1,
        page_hash=page_hash,
        classification=classification,
        classification_reasons=["single-page image input"],
        extraction_method=extraction_method,
        normalized_text=normalized_text[:200_000],
        text_blocks=text_blocks,
        tables=[],
        ocr_used=ocr_used,
        ocr_result=ocr_result,
        truncated=False,
        width=float(width),
        height=float(height),
        warnings=[],
    )


def _elapsed_ms(start: float) -> float:
    return (time.monotonic() - start) * 1000


def _compute_metrics(data: bytes, pages: list[PageResult], start: float) -> Metrics:
    native_pages = sum(1 for p in pages if p.classification == PageClassification.NATIVE_TEXT)
    ocr_pages = sum(1 for p in pages if p.ocr_used)
    table_heavy_pages = sum(1 for p in pages if p.classification == PageClassification.TABLE_HEAVY)
    extracted_characters = sum(len(p.normalized_text) for p in pages)
    table_count = sum(len(p.tables) for p in pages)
    table_cell_count = sum(len(t.rows) * max(len(t.headers), 1) for p in pages for t in p.tables)
    warnings_count = sum(len(p.warnings) for p in pages)

    output_bytes = sum(len(p.normalized_text.encode("utf-8")) for p in pages)

    return Metrics(
        input_bytes=len(data),
        page_count=len(pages),
        native_pages=native_pages,
        ocr_pages=ocr_pages,
        table_heavy_pages=table_heavy_pages,
        elapsed_ms=_elapsed_ms(start),
        extracted_characters=extracted_characters,
        table_count=table_count,
        table_cell_count=table_cell_count,
        output_bytes=output_bytes,
        warnings_count=warnings_count,
    )
