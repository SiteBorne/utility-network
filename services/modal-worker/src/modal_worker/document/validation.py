"""Pre-processing validation: request shape, media type, declared hash, bounds.

All validation in this module runs before any expensive extraction work
(before Docling is ever invoked), matching the provider-adapters pattern of
"validation occurs before network access."
"""

from __future__ import annotations

from .failures import FailureCode, WorkerError
from .hashing import content_hash
from .models import MAX_DOCUMENT_BYTES, MAX_PAGES, WorkerRequest


def validate_request(request: WorkerRequest) -> None:
    """Raises WorkerError(INVALID_REQUEST) for any cross-field inconsistency
    that pydantic's per-field validation cannot express (pydantic already
    enforces per-field bounds/pattern/enum constraints at construction time).
    """
    if request.artifact_reference.media_type != request.declared_media_type:
        raise WorkerError(
            FailureCode.INVALID_REQUEST,
            "artifact_reference.media_type does not match declared_media_type",
        )
    if request.artifact_reference.size_bytes != request.declared_byte_length:
        raise WorkerError(
            FailureCode.INVALID_REQUEST,
            "artifact_reference.size_bytes does not match declared_byte_length",
        )
    if request.artifact_reference.content_hash is not None and (
        request.artifact_reference.content_hash != request.declared_sha256
    ):
        raise WorkerError(
            FailureCode.INVALID_REQUEST,
            "artifact_reference.content_hash does not match declared_sha256",
        )
    if request.declared_byte_length > MAX_DOCUMENT_BYTES:
        raise WorkerError(FailureCode.BYTE_LIMIT_EXCEEDED, str(request.declared_byte_length))
    if request.maximum_pages > MAX_PAGES:
        raise WorkerError(FailureCode.INVALID_REQUEST, "maximum_pages exceeds the frozen contract bound")


def validate_bytes(data: bytes, request: WorkerRequest) -> None:
    """Validates the actual retrieved bytes against the request's declarations.
    Runs after artifact retrieval, before extraction.
    """
    if len(data) > request.maximum_bytes:
        raise WorkerError(
            FailureCode.BYTE_LIMIT_EXCEEDED,
            f"{len(data)} bytes > maximum_bytes={request.maximum_bytes}",
        )
    if len(data) != request.declared_byte_length:
        raise WorkerError(
            FailureCode.INVALID_REQUEST,
            f"retrieved {len(data)} bytes != declared_byte_length={request.declared_byte_length}",
        )
    actual_hash = content_hash(data)
    if actual_hash != request.declared_sha256:
        raise WorkerError(
            FailureCode.DECLARED_HASH_MISMATCH,
            f"actual={actual_hash} declared={request.declared_sha256}",
        )
    media_type = detect_media_type(data)
    if media_type != request.declared_media_type:
        raise WorkerError(
            FailureCode.UNSUPPORTED_MEDIA_TYPE,
            f"detected={media_type} declared={request.declared_media_type}",
        )


def detect_media_type(data: bytes) -> str | None:
    """Magic-byte sniffing, independent of the caller's declared media type —
    the declared type must never be trusted on its own (see validate_bytes).
    """
    if data.startswith(b"%PDF-"):
        return "application/pdf"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    return None
