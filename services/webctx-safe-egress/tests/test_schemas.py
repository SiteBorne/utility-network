"""SUN-1221E5Q6G §16/§17 — application-level request schema validation
(defense-in-depth alongside Modal's platform-enforced `requires_proxy_auth`,
which rejects unauthenticated/wrong-credential requests before this
service's code runs at all — not something a unit test in this repository
can exercise; see test_no_modal_leakage.py's structural proof that the
endpoint declares `requires_proxy_auth=True`)."""

import ast
from pathlib import Path

import pytest
from pydantic import ValidationError

from webctx_safe_egress.schemas import WebctxFetchRequest


def valid_payload(**overrides) -> dict:
    payload = {
        "correlation_id": "abc-123",
        "target_url": "https://example.com/",
        "retrieval_mode": "direct",
        "deadline_ms": 5000,
        "max_response_bytes": 65536,
    }
    payload.update(overrides)
    return payload


def test_valid_payload_accepted():
    req = WebctxFetchRequest.model_validate(valid_payload())
    assert req.target_url == "https://example.com/"


def test_missing_required_field_rejected():
    payload = valid_payload()
    del payload["target_url"]
    with pytest.raises(ValidationError):
        WebctxFetchRequest.model_validate(payload)


def test_unsupported_retrieval_mode_rejected():
    with pytest.raises(ValidationError):
        WebctxFetchRequest.model_validate(valid_payload(retrieval_mode="rendered"))


def test_unsupported_request_version_rejected():
    with pytest.raises(ValidationError):
        WebctxFetchRequest.model_validate(valid_payload(request_version=2))


def test_oversized_target_url_rejected():
    with pytest.raises(ValidationError):
        WebctxFetchRequest.model_validate(valid_payload(target_url="https://example.com/" + "a" * 3000))


def test_oversized_max_response_bytes_rejected():
    with pytest.raises(ValidationError):
        WebctxFetchRequest.model_validate(valid_payload(max_response_bytes=100_000_000))


def test_excessive_deadline_rejected():
    with pytest.raises(ValidationError):
        WebctxFetchRequest.model_validate(valid_payload(deadline_ms=999_999))


def test_extra_fields_rejected():
    with pytest.raises(ValidationError):
        WebctxFetchRequest.model_validate(valid_payload(unexpected_field="anything"))


def test_malformed_body_type_rejected():
    with pytest.raises(ValidationError):
        WebctxFetchRequest.model_validate("not a dict at all")


class TestProxyAuthDeclared:
    """Structural proof (not a live-request test — Modal's platform enforces
    this before app code runs): the deployed endpoint declares
    `requires_proxy_auth=True`."""

    def test_fastapi_endpoint_declares_requires_proxy_auth_true(self):
        app_py = Path(__file__).resolve().parent.parent / "src" / "webctx_safe_egress" / "app.py"
        tree = ast.parse(app_py.read_text())
        found = False
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and _is_fastapi_endpoint_call(node):
                for kw in node.keywords:
                    if kw.arg == "requires_proxy_auth":
                        assert isinstance(kw.value, ast.Constant) and kw.value.value is True
                        found = True
        assert found, "no modal.fastapi_endpoint(requires_proxy_auth=True) call found in app.py"


def _is_fastapi_endpoint_call(node: ast.Call) -> bool:
    func = node.func
    if isinstance(func, ast.Attribute) and func.attr == "fastapi_endpoint":
        return True
    if isinstance(func, ast.Name) and func.id == "fastapi_endpoint":
        return True
    return False
