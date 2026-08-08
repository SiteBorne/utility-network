"""Worker-level request/result models.

These are the document-processing *worker's* internal contract — not the
PCC-wrapped `document_evidence_json.v1` service response. A later service
composition layer (not part of SUN-0400A) maps `WorkerResult` into the
frozen `schemas/services/document-evidence-output.schema.json` extension
payload (see `to_frozen_page_classification` / `to_frozen_extraction_method`
below for the exact mapping of the closed vocabularies this worker uses to
the closed vocabularies the frozen schema uses).

All models are strict (`extra="forbid"`) — no unknown fields survive
round-tripping through validation, matching the closed-schema pattern used
throughout this repository (provider-adapters manifests, PCC schema).
"""

from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .failures import FailureCode

# --- Frozen-contract-derived bounds (schemas/services/document-evidence-input.schema.json,
# schemas/common/authorized-artifact-reference.schema.json). These are read from the frozen
# schema at test time (tests/document/test_frozen_bounds.py) to catch drift; the literals below
# are their current values.
MAX_DOCUMENT_BYTES = 10_485_760  # 10 MiB
MAX_PAGES = 10
ALLOWED_MEDIA_TYPES = ("application/pdf", "image/png", "image/jpeg")

# Worker-local bounds (not in the frozen contract — this worker's own defense in depth).
MAX_IMAGE_DIMENSION_PX = 12_000
MAX_IMAGE_PIXELS = 64_000_000  # decompression-bomb guard, independent of declared byte size
MAX_TEXT_BLOCKS_PER_PAGE = 500
MAX_TABLES_PER_PAGE = 20
MAX_TABLE_ROWS = 500
MAX_TABLE_COLS = 100
MAX_CELL_TEXT_LENGTH = 4_000
MAX_PAGE_TEXT_LENGTH = 200_000
DEFAULT_TIMEOUT_MS = 60_000
MAX_TIMEOUT_MS = 300_000


class ProcessingMode(str, Enum):
    STANDARD = "standard"


class OcrPolicy(str, Enum):
    FORBIDDEN = "forbidden"
    IF_NEEDED = "if_needed"
    REQUIRED = "required"


class TablePolicy(str, Enum):
    SKIP = "skip"
    EXTRACT = "extract"


class ArtifactReference(BaseModel):
    """Mirrors schemas/common/authorized-artifact-reference.schema.json."""

    model_config = ConfigDict(extra="forbid")

    artifact_id: str = Field(max_length=512)
    media_type: Literal["application/pdf", "image/png", "image/jpeg"]
    size_bytes: int = Field(ge=1, le=MAX_DOCUMENT_BYTES)
    page_count: int | None = Field(default=None, ge=1, le=MAX_PAGES)
    content_hash: str | None = Field(default=None, pattern=r"^sha256:[a-f0-9]{64}$")
    authorization: Literal["public", "buyer_authorized"] | None = None


class WorkerRequest(BaseModel):
    """The worker's own request contract, bound to the frozen service-contract release."""

    model_config = ConfigDict(extra="forbid")

    job_id: str = Field(min_length=1, max_length=128)
    request_id: str = Field(min_length=1, max_length=128)
    service_id: Literal["document_evidence_json.v1"]
    service_version: Literal["v1"] = "v1"
    contract_release: str = Field(min_length=1, max_length=32)
    input_schema_hash: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")
    artifact_reference: ArtifactReference
    declared_media_type: Literal["application/pdf", "image/png", "image/jpeg"]
    declared_byte_length: int = Field(ge=1, le=MAX_DOCUMENT_BYTES)
    declared_sha256: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")
    processing_mode: ProcessingMode = ProcessingMode.STANDARD
    maximum_pages: int = Field(default=MAX_PAGES, ge=1, le=MAX_PAGES)
    maximum_bytes: int = Field(default=MAX_DOCUMENT_BYTES, ge=1, le=MAX_DOCUMENT_BYTES)
    ocr_policy: OcrPolicy = OcrPolicy.IF_NEEDED
    table_policy: TablePolicy = TablePolicy.EXTRACT
    timeout_ms: int = Field(default=DEFAULT_TIMEOUT_MS, ge=1, le=MAX_TIMEOUT_MS)

    @field_validator("artifact_reference")
    @classmethod
    def _artifact_matches_declared(cls, v: ArtifactReference, info: object) -> ArtifactReference:
        return v


class PageClassification(str, Enum):
    """Worker-internal page classification (richer than the frozen output enum)."""

    NATIVE_TEXT = "native_text"
    SCANNED_IMAGE = "scanned_image"
    MIXED = "mixed"
    TABLE_HEAVY = "table_heavy"
    BLANK = "blank"
    UNSUPPORTED_OR_UNREADABLE = "unsupported_or_unreadable"


class ExtractionMethod(str, Enum):
    NATIVE = "native"
    OCR = "ocr"
    HYBRID = "hybrid"
    NONE = "none"


def to_frozen_page_classification(c: PageClassification) -> str:
    """Maps this worker's classification to the frozen output schema's closed enum
    (schemas/services/document-evidence-output.schema.json ->
    page_classifications[].classification: native_text | ocr | table_heavy | image_only | unsupported).
    """
    mapping = {
        PageClassification.NATIVE_TEXT: "native_text",
        PageClassification.SCANNED_IMAGE: "ocr",
        PageClassification.MIXED: "ocr",
        PageClassification.TABLE_HEAVY: "table_heavy",
        PageClassification.BLANK: "image_only",
        PageClassification.UNSUPPORTED_OR_UNREADABLE: "unsupported",
    }
    return mapping[c]


def to_frozen_extraction_method(m: ExtractionMethod) -> str:
    return m.value  # identical vocabulary: native | ocr | hybrid | none


class BoundingBox(BaseModel):
    model_config = ConfigDict(extra="forbid")

    left: float
    top: float
    right: float
    bottom: float


class EvidenceLocator(BaseModel):
    model_config = ConfigDict(extra="forbid")

    locator_type: Literal["native_text", "ocr_text", "table_cell"]
    page: int = Field(ge=1)
    ordinal: int = Field(ge=0)
    quote: str = Field(max_length=1000)
    bbox: BoundingBox | None = None
    table_ordinal: int | None = Field(default=None, ge=0)
    row: int | None = Field(default=None, ge=0)
    column: int | None = Field(default=None, ge=0)


class TextBlock(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ordinal: int = Field(ge=0)
    text: str = Field(max_length=MAX_PAGE_TEXT_LENGTH)
    bbox: BoundingBox | None = None
    locator: EvidenceLocator


class Table(BaseModel):
    model_config = ConfigDict(extra="forbid")

    page: int = Field(ge=1)
    table_ordinal: int = Field(ge=0)
    headers: list[str] = Field(default_factory=list)
    rows: list[list[str]]
    bbox: BoundingBox | None = None
    extraction_method: ExtractionMethod
    table_hash: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")
    truncated: bool = False
    locator: EvidenceLocator


class OcrResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    engine: str
    engine_version: str
    language: str
    mean_confidence: float | None = Field(default=None, ge=0, le=1)


class PageWarning(BaseModel):
    model_config = ConfigDict(extra="forbid")

    page: int = Field(ge=1)
    code: str
    message: str
    severity: Literal["low", "medium", "high"] = "low"


class PageResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    page_number: int = Field(ge=1)
    page_hash: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")
    classification: PageClassification
    classification_reasons: list[str] = Field(default_factory=list)
    extraction_method: ExtractionMethod
    normalized_text: str = Field(default="", max_length=MAX_PAGE_TEXT_LENGTH)
    text_blocks: list[TextBlock] = Field(default_factory=list)
    tables: list[Table] = Field(default_factory=list)
    ocr_used: bool = False
    ocr_result: OcrResult | None = None
    truncated: bool = False
    width: float | None = None
    height: float | None = None
    warnings: list[str] = Field(default_factory=list)


class DocumentMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sha256: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")
    byte_length: int = Field(ge=1)
    media_type: str
    page_count: int = Field(ge=0)
    processing_timestamp: str
    extraction_engine: str
    extraction_engine_version: str
    ocr_engine: str | None = None
    ocr_engine_version: str | None = None
    processing_policy_version: str = "1.0.0"


class Metrics(BaseModel):
    model_config = ConfigDict(extra="forbid")

    input_bytes: int = Field(ge=0)
    page_count: int = Field(ge=0)
    native_pages: int = Field(ge=0)
    ocr_pages: int = Field(ge=0)
    table_heavy_pages: int = Field(ge=0)
    elapsed_ms: float = Field(ge=0)
    extracted_characters: int = Field(ge=0)
    table_count: int = Field(ge=0)
    table_cell_count: int = Field(ge=0)
    output_bytes: int = Field(ge=0)
    warnings_count: int = Field(ge=0)


class FailureInfo(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: FailureCode
    message: str
    retryable: bool
    stage: str
    partial_result_available: bool = False


class WorkerStatus(str, Enum):
    SUCCESS = "success"
    PARTIAL = "partial"
    FAILED = "failed"


class WorkerResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    worker_result_version: str = "1.0.0"
    job_id: str
    status: WorkerStatus
    document: DocumentMetadata | None = None
    pages: list[PageResult] = Field(default_factory=list)
    warnings: list[PageWarning] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list, max_length=20)
    metrics: Metrics | None = None
    provenance: list[str] = Field(default_factory=list)
    failure: FailureInfo | None = None

    @field_validator("limitations")
    @classmethod
    def _bounded_limitation_length(cls, v: list[str]) -> list[str]:
        for item in v:
            if len(item) > 256:
                raise ValueError("limitation string exceeds 256 characters")
        return v
