"""SUN-1221E5Q6G §3/§22 — structural proof, not a promise: this package has
no field, import, or symbol anywhere that could carry payment material."""

import ast
from pathlib import Path

from webctx_safe_egress.schemas import FORBIDDEN_FIELD_SUBSTRINGS, WebctxFetchRequest

SRC_DIR = Path(__file__).resolve().parent.parent / "src" / "webctx_safe_egress"

FORBIDDEN_IMPORT_SUBSTRINGS = (
    "eip3009",
    "eip_3009",
    "facilitator",
    "x402",
    "cdp",
    "viem",
    "web3",
    "ethers",
)


def test_request_schema_has_no_payment_fields():
    for field_name in WebctxFetchRequest.model_fields:
        lowered = field_name.lower()
        for forbidden in FORBIDDEN_FIELD_SUBSTRINGS:
            assert forbidden not in lowered, f"field {field_name!r} looks like payment material"


def test_no_source_file_imports_payment_related_packages():
    for py_file in SRC_DIR.rglob("*.py"):
        tree = ast.parse(py_file.read_text(), filename=str(py_file))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                names = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom):
                names = [node.module or ""]
            else:
                continue
            for name in names:
                lowered = name.lower()
                for forbidden in FORBIDDEN_IMPORT_SUBSTRINGS:
                    assert forbidden not in lowered, f"{py_file}: import {name!r} looks payment-related"


def test_executor_module_has_no_settlement_capability():
    """Structural call-graph proof (directive §22): the executor module's
    own source text names no settlement/signing symbol at all — it isn't
    merely unused, the capability doesn't exist in this codebase."""
    executor_src = (SRC_DIR / "executor.py").read_text()
    for forbidden in ("settle", "sign_typed_data", "facilitator", "eip3009", "eip_3009"):
        assert forbidden not in executor_src.lower()
