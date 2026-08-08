from __future__ import annotations

import pytest
from pydantic import ValidationError

from modal_worker.document import execute
from modal_worker.document.failures import FailureCode
from modal_worker.document.models import ArtifactReference, WorkerRequest

from .conftest import build_request


def test_valid_request_is_accepted(native_text_pdf: bytes) -> None:
    request, accessor = build_request(native_text_pdf, "application/pdf")
    result = execute(request, accessor)
    assert result.status.value == "success"


def test_wrong_service_id_rejected_by_model() -> None:
    with pytest.raises(ValidationError):
        WorkerRequest(
            job_id="j",
            request_id="r",
            service_id="wrong_service.v1",  # type: ignore[arg-type]
            contract_release="1.0.0",
            input_schema_hash="sha256:" + "0" * 64,
            artifact_reference=ArtifactReference(
                artifact_id="a", media_type="application/pdf", size_bytes=10
            ),
            declared_media_type="application/pdf",
            declared_byte_length=10,
            declared_sha256="sha256:" + "0" * 64,
        )


def test_media_type_mismatch_rejected(native_text_pdf: bytes) -> None:
    request, accessor = build_request(
        native_text_pdf, "application/pdf", declared_media_type="image/png"
    )
    result = execute(request, accessor)
    assert result.status.value == "failed"
    assert result.failure is not None
    assert result.failure.code == FailureCode.INVALID_REQUEST


def test_declared_hash_mismatch_rejected(native_text_pdf: bytes) -> None:
    request, accessor = build_request(
        native_text_pdf, "application/pdf", declared_sha256="sha256:" + "a" * 64
    )
    # declared_sha256 differs from artifact_reference.content_hash -> invalid_request
    result = execute(request, accessor)
    assert result.status.value == "failed"
    assert result.failure is not None
    assert result.failure.code == FailureCode.INVALID_REQUEST


def test_byte_length_mismatch_rejected(native_text_pdf: bytes) -> None:
    request, accessor = build_request(
        native_text_pdf, "application/pdf", declared_byte_length=len(native_text_pdf) + 5
    )
    result = execute(request, accessor)
    assert result.status.value == "failed"
    assert result.failure is not None
    assert result.failure.code == FailureCode.INVALID_REQUEST


def test_page_limit_over_frozen_bound_rejected_by_model() -> None:
    with pytest.raises(ValidationError):
        WorkerRequest(
            job_id="j",
            request_id="r",
            service_id="document_evidence_json.v1",
            contract_release="1.0.0",
            input_schema_hash="sha256:" + "0" * 64,
            artifact_reference=ArtifactReference(
                artifact_id="a", media_type="application/pdf", size_bytes=10
            ),
            declared_media_type="application/pdf",
            declared_byte_length=10,
            declared_sha256="sha256:" + "0" * 64,
            maximum_pages=11,
        )


def test_unsupported_media_type_rejected_by_model() -> None:
    with pytest.raises(ValidationError):
        ArtifactReference(artifact_id="a", media_type="application/msword", size_bytes=10)  # type: ignore[arg-type]


def test_unknown_field_rejected() -> None:
    with pytest.raises(ValidationError):
        WorkerRequest.model_validate(
            {
                "job_id": "j",
                "request_id": "r",
                "service_id": "document_evidence_json.v1",
                "contract_release": "1.0.0",
                "input_schema_hash": "sha256:" + "0" * 64,
                "artifact_reference": {"artifact_id": "a", "media_type": "application/pdf", "size_bytes": 10},
                "declared_media_type": "application/pdf",
                "declared_byte_length": 10,
                "declared_sha256": "sha256:" + "0" * 64,
                "arbitrary_command": "rm -rf /",
            }
        )


def test_artifact_not_registered_is_artifact_unavailable(native_text_pdf: bytes) -> None:
    request, accessor = build_request(native_text_pdf, "application/pdf", artifact_id="registered")
    request = request.model_copy(
        update={"artifact_reference": request.artifact_reference.model_copy(update={"artifact_id": "not-registered"})}
    )
    result = execute(request, accessor)
    assert result.status.value == "failed"
    assert result.failure is not None
    assert result.failure.code == FailureCode.ARTIFACT_UNAVAILABLE


def test_validate_request_is_called_before_any_extraction(native_text_pdf: bytes) -> None:
    """Proves validation runs before artifact retrieval/extraction: an invalid
    request never even reaches accessor.read_bounded."""
    request, accessor = build_request(
        native_text_pdf, "application/pdf", declared_byte_length=len(native_text_pdf) + 1
    )
    calls = []
    original = accessor.read_bounded

    def counting_read(*args: object, **kwargs: object) -> bytes:
        calls.append(1)
        return original(*args, **kwargs)  # type: ignore[arg-type]

    accessor.read_bounded = counting_read  # type: ignore[method-assign]
    result = execute(request, accessor)
    assert result.status.value == "failed"
    assert calls == [], "extraction path must not run when validate_request() fails"
