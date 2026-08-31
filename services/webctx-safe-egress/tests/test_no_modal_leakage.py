"""SUN-1221E5Q6G — mirrors ADR 0029's structural guarantee for
services/modal-worker: exactly one file may import `modal`, so everything
else stays testable without Modal installed and without credentials, and
proves this executor's security/transport core has zero coupling to the
Modal SDK itself."""

import ast
from pathlib import Path

SRC_DIR = Path(__file__).resolve().parent.parent / "src" / "webctx_safe_egress"
ALLOWED_MODAL_IMPORTER = "app.py"


def test_only_app_module_imports_modal():
    offenders = []
    for py_file in SRC_DIR.rglob("*.py"):
        if py_file.name == ALLOWED_MODAL_IMPORTER:
            continue
        tree = ast.parse(py_file.read_text(), filename=str(py_file))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import) and any(a.name == "modal" or a.name.startswith("modal.") for a in node.names):
                offenders.append(str(py_file))
            if isinstance(node, ast.ImportFrom) and node.module and (node.module == "modal" or node.module.startswith("modal.")):
                offenders.append(str(py_file))
    assert not offenders, f"modal imported outside app.py: {offenders}"


def test_app_imports_without_modal_credentials(monkeypatch):
    """Mirrors modal_worker's own `test_modal_app_imports_without_
    credentials`: constructing the App/Image/decorator stack is pure local
    object construction at import time -- no network call, no credential
    check, no deployment."""
    monkeypatch.delenv("MODAL_TOKEN_ID", raising=False)
    monkeypatch.delenv("MODAL_TOKEN_SECRET", raising=False)

    import importlib

    from webctx_safe_egress import app as app_module

    importlib.reload(app_module)
    assert app_module.app.name == "siteborne-webctx-safe-egress"


def test_dedicated_app_identity_distinct_from_ocr_app():
    from webctx_safe_egress.app import APP_NAME

    assert APP_NAME != "siteborne-document-worker"
    assert APP_NAME == "siteborne-webctx-safe-egress"
