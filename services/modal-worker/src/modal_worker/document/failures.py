"""Closed, deterministic failure taxonomy for the document-processing worker.

Mirrors the pattern already established in
packages/provider-adapters/src/errors.ts (a closed result-class union with a
typed error carrying a stable code): every failure the worker can produce is
one of a fixed set of enum values, never a bare exception message leaked to
a caller.
"""

from __future__ import annotations

from enum import Enum


class FailureCode(str, Enum):
    """Closed set of worker failure classifications.

    Adding a new value here is a deliberate, reviewed change — callers are
    expected to exhaustively handle this enum (see WorkerStatus / the
    completeness test in tests/document/test_failures.py).
    """

    INVALID_REQUEST = "invalid_request"
    UNSUPPORTED_MEDIA_TYPE = "unsupported_media_type"
    DECLARED_HASH_MISMATCH = "declared_hash_mismatch"
    BYTE_LIMIT_EXCEEDED = "byte_limit_exceeded"
    PAGE_LIMIT_EXCEEDED = "page_limit_exceeded"
    IMAGE_DIMENSION_LIMIT_EXCEEDED = "image_dimension_limit_exceeded"
    MALFORMED_DOCUMENT = "malformed_document"
    ENCRYPTED_DOCUMENT = "encrypted_document"
    EXTRACTION_FAILED = "extraction_failed"
    OCR_FAILED = "ocr_failed"
    TABLE_EXTRACTION_FAILED = "table_extraction_failed"
    TIMEOUT = "timeout"
    RESULT_LIMIT_EXCEEDED = "result_limit_exceeded"
    ARTIFACT_UNAVAILABLE = "artifact_unavailable"
    ARTIFACT_UNAUTHORIZED = "artifact_unauthorized"
    INTERNAL_CONSISTENCY_FAILURE = "internal_consistency_failure"
    DEPENDENCY_UNAVAILABLE = "dependency_unavailable"


# Whether a failure is safe to retry as-is (same request, same artifact).
# Transient/dependency-shaped failures are retryable; anything that reflects
# a property of the input itself is not (retrying would reproduce it).
RETRYABLE: dict[FailureCode, bool] = {
    FailureCode.INVALID_REQUEST: False,
    FailureCode.UNSUPPORTED_MEDIA_TYPE: False,
    FailureCode.DECLARED_HASH_MISMATCH: False,
    FailureCode.BYTE_LIMIT_EXCEEDED: False,
    FailureCode.PAGE_LIMIT_EXCEEDED: False,
    FailureCode.IMAGE_DIMENSION_LIMIT_EXCEEDED: False,
    FailureCode.MALFORMED_DOCUMENT: False,
    FailureCode.ENCRYPTED_DOCUMENT: False,
    FailureCode.EXTRACTION_FAILED: False,
    FailureCode.OCR_FAILED: True,
    FailureCode.TABLE_EXTRACTION_FAILED: True,
    FailureCode.TIMEOUT: True,
    FailureCode.RESULT_LIMIT_EXCEEDED: False,
    FailureCode.ARTIFACT_UNAVAILABLE: True,
    FailureCode.ARTIFACT_UNAUTHORIZED: False,
    FailureCode.INTERNAL_CONSISTENCY_FAILURE: False,
    FailureCode.DEPENDENCY_UNAVAILABLE: True,
}

# Which processing stage each failure is expected to originate from — for
# audit/observability, not behavior.
STAGE: dict[FailureCode, str] = {
    FailureCode.INVALID_REQUEST: "validation",
    FailureCode.UNSUPPORTED_MEDIA_TYPE: "validation",
    FailureCode.DECLARED_HASH_MISMATCH: "validation",
    FailureCode.BYTE_LIMIT_EXCEEDED: "validation",
    FailureCode.PAGE_LIMIT_EXCEEDED: "validation",
    FailureCode.IMAGE_DIMENSION_LIMIT_EXCEEDED: "validation",
    FailureCode.MALFORMED_DOCUMENT: "inspection",
    FailureCode.ENCRYPTED_DOCUMENT: "inspection",
    FailureCode.EXTRACTION_FAILED: "extraction",
    FailureCode.OCR_FAILED: "ocr",
    FailureCode.TABLE_EXTRACTION_FAILED: "table_extraction",
    FailureCode.TIMEOUT: "extraction",
    FailureCode.RESULT_LIMIT_EXCEEDED: "normalization",
    FailureCode.ARTIFACT_UNAVAILABLE: "artifact_access",
    FailureCode.ARTIFACT_UNAUTHORIZED: "artifact_access",
    FailureCode.INTERNAL_CONSISTENCY_FAILURE: "verification",
    FailureCode.DEPENDENCY_UNAVAILABLE: "extraction",
}

# Client-safe messages. Never include exception internals, stack traces, or
# document content here.
SAFE_MESSAGE: dict[FailureCode, str] = {
    FailureCode.INVALID_REQUEST: "The request did not satisfy the worker request contract.",
    FailureCode.UNSUPPORTED_MEDIA_TYPE: "The declared media type is not supported.",
    FailureCode.DECLARED_HASH_MISMATCH: "The document content hash did not match the declared hash.",
    FailureCode.BYTE_LIMIT_EXCEEDED: "The document exceeds the configured byte-size limit.",
    FailureCode.PAGE_LIMIT_EXCEEDED: "The document exceeds the configured page-count limit.",
    FailureCode.IMAGE_DIMENSION_LIMIT_EXCEEDED: "The image exceeds the configured dimension limit.",
    FailureCode.MALFORMED_DOCUMENT: "The document could not be parsed.",
    FailureCode.ENCRYPTED_DOCUMENT: "The document is encrypted and cannot be processed without authorized credentials.",
    FailureCode.EXTRACTION_FAILED: "Document extraction failed.",
    FailureCode.OCR_FAILED: "OCR processing failed.",
    FailureCode.TABLE_EXTRACTION_FAILED: "Table extraction failed.",
    FailureCode.TIMEOUT: "Processing exceeded the configured timeout.",
    FailureCode.RESULT_LIMIT_EXCEEDED: "The extraction result exceeds configured output bounds.",
    FailureCode.ARTIFACT_UNAVAILABLE: "The referenced artifact could not be retrieved.",
    FailureCode.ARTIFACT_UNAUTHORIZED: "The referenced artifact is not authorized for this request.",
    FailureCode.INTERNAL_CONSISTENCY_FAILURE: "The extraction result failed internal consistency verification.",
    FailureCode.DEPENDENCY_UNAVAILABLE: "A required processing dependency is unavailable.",
}


class WorkerError(Exception):
    """Base exception for all classified worker failures.

    Every raise site in the document/ package must raise a WorkerError (or a
    subclass) with a FailureCode — never a bare Exception/ValueError that
    would otherwise propagate a raw traceback to a caller.
    """

    def __init__(self, code: FailureCode, detail: str | None = None) -> None:
        self.code = code
        self.detail = detail  # internal diagnostic only; never returned to callers
        super().__init__(f"{code.value}: {detail or SAFE_MESSAGE[code]}")

    @property
    def safe_message(self) -> str:
        return SAFE_MESSAGE[self.code]

    @property
    def retryable(self) -> bool:
        return RETRYABLE[self.code]

    @property
    def stage(self) -> str:
        return STAGE[self.code]
