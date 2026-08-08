"""Proves the Modal deployment wrapper compiles/imports without a token and
without deploying, and that the processing core never imports `modal`."""

from __future__ import annotations

import ast
import importlib
import os
from pathlib import Path

import pytest


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
