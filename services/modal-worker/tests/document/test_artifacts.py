from __future__ import annotations

import pytest

from modal_worker.document.artifacts import InMemoryArtifactAccessor
from modal_worker.document.failures import FailureCode, WorkerError


def test_register_and_read_bounded() -> None:
    accessor = InMemoryArtifactAccessor()
    accessor.register("a1", b"hello", "application/pdf")
    assert accessor.exists("a1") is True
    assert accessor.read_bounded("a1", max_bytes=100) == b"hello"


def test_unknown_artifact_raises_unavailable() -> None:
    accessor = InMemoryArtifactAccessor()
    with pytest.raises(WorkerError) as exc_info:
        accessor.read_bounded("missing", max_bytes=100)
    assert exc_info.value.code == FailureCode.ARTIFACT_UNAVAILABLE


def test_oversized_artifact_raises_byte_limit_exceeded() -> None:
    accessor = InMemoryArtifactAccessor()
    accessor.register("a1", b"x" * 1000, "application/pdf")
    with pytest.raises(WorkerError) as exc_info:
        accessor.read_bounded("a1", max_bytes=10)
    assert exc_info.value.code == FailureCode.BYTE_LIMIT_EXCEEDED


def test_metadata_reports_hash_and_length() -> None:
    accessor = InMemoryArtifactAccessor()
    accessor.register("a1", b"hello", "application/pdf")
    meta = accessor.get_metadata("a1")
    assert meta is not None
    assert meta.byte_length == 5
    assert meta.content_hash.startswith("sha256:")


def test_metadata_none_for_unknown() -> None:
    accessor = InMemoryArtifactAccessor()
    assert accessor.get_metadata("missing") is None
