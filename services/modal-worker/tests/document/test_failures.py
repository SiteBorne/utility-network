from __future__ import annotations

from modal_worker.document.failures import RETRYABLE, SAFE_MESSAGE, STAGE, FailureCode, WorkerError


def test_every_failure_code_has_retryable_stage_and_message() -> None:
    for code in FailureCode:
        assert code in RETRYABLE, f"{code} missing from RETRYABLE"
        assert code in STAGE, f"{code} missing from STAGE"
        assert code in SAFE_MESSAGE, f"{code} missing from SAFE_MESSAGE"
        assert isinstance(RETRYABLE[code], bool)
        assert isinstance(STAGE[code], str) and STAGE[code]
        assert isinstance(SAFE_MESSAGE[code], str) and SAFE_MESSAGE[code]
        # No stack-trace-shaped safe message.
        assert "Traceback" not in SAFE_MESSAGE[code]
        assert "line " not in SAFE_MESSAGE[code]


def test_worker_error_exposes_classified_fields() -> None:
    err = WorkerError(FailureCode.TIMEOUT, detail="internal diagnostic, not client-safe")
    assert err.code == FailureCode.TIMEOUT
    assert err.retryable is True
    assert err.stage == "extraction"
    assert "internal diagnostic" not in err.safe_message


def test_failure_code_enum_is_closed() -> None:
    values = {c.value for c in FailureCode}
    assert values == {
        "invalid_request",
        "unsupported_media_type",
        "declared_hash_mismatch",
        "byte_limit_exceeded",
        "page_limit_exceeded",
        "image_dimension_limit_exceeded",
        "malformed_document",
        "encrypted_document",
        "extraction_failed",
        "ocr_failed",
        "table_extraction_failed",
        "timeout",
        "result_limit_exceeded",
        "artifact_unavailable",
        "artifact_unauthorized",
        "internal_consistency_failure",
        "dependency_unavailable",
    }
