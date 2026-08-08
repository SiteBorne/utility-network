from __future__ import annotations

import uuid
from pathlib import Path

import pytest

from modal_worker.document import InMemoryArtifactAccessor
from modal_worker.document.hashing import content_hash
from modal_worker.document.models import ArtifactReference, OcrPolicy, TablePolicy, WorkerRequest

FIXTURES_DIR = Path(__file__).parent.parent.parent / "fixtures"
PDF_DIR = FIXTURES_DIR / "pdf"
IMG_DIR = FIXTURES_DIR / "images"


def build_request(
    data: bytes,
    media_type: str,
    artifact_id: str = "test-artifact",
    ocr_policy: OcrPolicy = OcrPolicy.IF_NEEDED,
    table_policy: TablePolicy = TablePolicy.EXTRACT,
    maximum_pages: int = 10,
    declared_media_type: str | None = None,
    declared_byte_length: int | None = None,
    declared_sha256: str | None = None,
) -> tuple[WorkerRequest, InMemoryArtifactAccessor]:
    accessor = InMemoryArtifactAccessor()
    accessor.register(artifact_id, data, media_type)
    request = WorkerRequest(
        job_id=str(uuid.uuid4()),
        request_id=str(uuid.uuid4()),
        service_id="document_evidence_json.v1",
        contract_release="1.0.0",
        input_schema_hash="sha256:" + "0" * 64,
        artifact_reference=ArtifactReference(
            artifact_id=artifact_id,
            media_type=media_type,  # type: ignore[arg-type]
            size_bytes=len(data),
            content_hash=content_hash(data),
        ),
        declared_media_type=declared_media_type or media_type,  # type: ignore[arg-type]
        declared_byte_length=declared_byte_length if declared_byte_length is not None else len(data),
        declared_sha256=declared_sha256 or content_hash(data),
        ocr_policy=ocr_policy,
        table_policy=table_policy,
        maximum_pages=maximum_pages,
    )
    return request, accessor


@pytest.fixture(scope="session")
def native_text_pdf() -> bytes:
    return (PDF_DIR / "native_text_one_page.pdf").read_bytes()


@pytest.fixture(scope="session")
def multi_page_pdf() -> bytes:
    return (PDF_DIR / "native_text_multi_page.pdf").read_bytes()


@pytest.fixture(scope="session")
def blank_pdf() -> bytes:
    return (PDF_DIR / "blank_page.pdf").read_bytes()


@pytest.fixture(scope="session")
def single_table_pdf() -> bytes:
    return (PDF_DIR / "single_table.pdf").read_bytes()


@pytest.fixture(scope="session")
def multi_table_pdf() -> bytes:
    return (PDF_DIR / "multi_table.pdf").read_bytes()


@pytest.fixture(scope="session")
def scanned_page_pdf() -> bytes:
    return (PDF_DIR / "scanned_page.pdf").read_bytes()


@pytest.fixture(scope="session")
def encrypted_pdf() -> bytes:
    return (PDF_DIR / "encrypted.pdf").read_bytes()


@pytest.fixture(scope="session")
def malformed_pdf() -> bytes:
    return (PDF_DIR / "malformed.pdf").read_bytes()


@pytest.fixture(scope="session")
def over_page_limit_pdf() -> bytes:
    return (PDF_DIR / "over_page_limit.pdf").read_bytes()


@pytest.fixture(scope="session")
def png_text() -> bytes:
    return (IMG_DIR / "text.png").read_bytes()


@pytest.fixture(scope="session")
def jpeg_text() -> bytes:
    return (IMG_DIR / "text.jpg").read_bytes()


@pytest.fixture(scope="session")
def blank_image() -> bytes:
    return (IMG_DIR / "blank.png").read_bytes()


@pytest.fixture(scope="session")
def malformed_image() -> bytes:
    return (IMG_DIR / "malformed.png").read_bytes()
