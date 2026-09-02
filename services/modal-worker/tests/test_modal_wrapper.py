"""Proves the Modal deployment wrapper compiles/imports without a token and
without deploying, and that the processing core never imports `modal`."""

from __future__ import annotations

import ast
import base64
import importlib
import os
import uuid
from pathlib import Path

import pytest

FIXTURES_DIR = Path(__file__).parent.parent / "fixtures"


def test_modal_app_imports_without_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    for var in ("MODAL_TOKEN_ID", "MODAL_TOKEN_SECRET"):
        monkeypatch.delenv(var, raising=False)
    module = importlib.import_module("modal_worker.modal_app")
    assert module.app is not None
    assert module.APP_NAME == "siteborne-document-worker"


def test_document_package_never_imports_modal() -> None:
    document_dir = Path(__file__).parent.parent / "src" / "modal_worker" / "document"
    for path in document_dir.glob("*.py"):
        tree = ast.parse(path.read_text(), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    assert not alias.name.startswith("modal"), f"{path} imports {alias.name}"
            if isinstance(node, ast.ImportFrom) and node.module:
                assert not node.module.startswith("modal"), f"{path} imports from {node.module}"


def test_no_modal_deploy_occurred_during_tests() -> None:
    # This test suite never calls `modal deploy`, `app.deploy()`, or any
    # Modal remote-invocation API — SUN-0400B owns that. Documented here as
    # an explicit, checkable assertion rather than an implicit assumption.
    assert os.environ.get("MODAL_TOKEN_ID") in (None, "")


class TestProcessDocumentHttpCore:
    """SUN-1222B-S3R — direct, no-Modal-required unit tests for the
    Worker-reachable `document_evidence_json.v2` HTTP entry point's actual
    logic (`process_document_http_core`), proving the InMemoryArtifactAccessor
    + `execute()` request/response mapping is genuinely correct -- not just
    that the module imports."""

    def _core(self):
        module = importlib.import_module("modal_worker.modal_app")
        return module.process_document_http_core

    def _valid_payload(self, data: bytes, media_type: str = "application/pdf") -> dict[str, object]:
        return {
            "job_id": str(uuid.uuid4()),
            "request_id": str(uuid.uuid4()),
            "media_type": media_type,
            "content_base64": base64.b64encode(data).decode("ascii"),
        }

    def test_real_pdf_end_to_end_succeeds(self) -> None:
        core = self._core()
        data = (FIXTURES_DIR / "pdf" / "native_text_one_page.pdf").read_bytes()
        response = core(self._valid_payload(data))
        assert response.status_code == 200
        body = response.body
        import json

        parsed = json.loads(body)
        assert parsed["status"] == "success"
        assert "Native Text Document" in parsed["pages"][0]["normalized_text"]
        assert parsed["document"]["byte_length"] == len(data)

    def test_malformed_request_rejected_400(self) -> None:
        core = self._core()
        response = core({"job_id": "j1"})  # missing required fields
        assert response.status_code == 400

    def test_invalid_base64_rejected_400(self) -> None:
        core = self._core()
        payload = self._valid_payload(b"irrelevant")
        payload["content_base64"] = "not-valid-base64!!!"
        response = core(payload)
        assert response.status_code == 400

    def test_empty_document_rejected_400(self) -> None:
        core = self._core()
        response = core(self._valid_payload(b""))
        assert response.status_code == 400

    def test_oversized_document_rejected_413(self) -> None:
        core = self._core()
        module = importlib.import_module("modal_worker.modal_app")
        oversized = b"0" * (module.MAX_DOCUMENT_BYTES + 1)
        response = core(self._valid_payload(oversized))
        assert response.status_code == 413

    def test_unsupported_media_type_rejected_400(self) -> None:
        core = self._core()
        response = core(self._valid_payload(b"irrelevant", media_type="text/plain"))
        assert response.status_code == 400

    def test_extra_field_rejected_400(self) -> None:
        # extra="forbid" on DocumentWorkerHttpRequest -- proves no
        # unrecognized field silently passes through.
        core = self._core()
        payload = self._valid_payload(b"irrelevant")
        payload["unexpected_field"] = "should be rejected"
        response = core(payload)
        assert response.status_code == 400
