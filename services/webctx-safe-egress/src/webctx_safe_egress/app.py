"""SUN-1221E5Q6G — Modal deployment wrapper. Mirrors ADR 0029's discipline
(`services/modal-worker/src/modal_worker/modal_app.py`): exactly one module
in this package may `import modal`, so `security/`, `transport.py`,
`executor.py`, and `schemas.py` stay fully testable without Modal installed
and without any credential present (proven by
`tests/test_app_imports_without_credentials.py`, which unsets
`MODAL_TOKEN_ID`/`MODAL_TOKEN_SECRET` before importing this module — object
construction/decorator application at import time performs no network call
and requires no credential).

A DEDICATED App identity, distinct from `siteborne-document-worker`
(`services/modal-worker`) — SUN-1221E5Q6G explicitly forbids reusing the OCR
app's identity or credentials (`REUSE_EXISTING_OCR_MODAL_APP=NO`,
`REUSE_EXISTING_MODAL_OCR_CREDENTIALS=NO`).

`requires_proxy_auth=True` (real Modal SDK 1.5.3 API, confirmed by direct
inspection of `modal/_partial_function.py::_fastapi_endpoint` this
checkpoint, not assumed): Modal's platform rejects any request missing or
presenting the wrong `Modal-Key`/`Modal-Secret` header pair *before* this
process's code ever runs — that enforcement point is outside this
repository's code entirely, which is exactly why `EXECUTOR_RECEIVES_PAYMENT_
MATERIAL=NO`/`EXECUTOR_ECONOMIC_CAPABILITY=0` are structural properties, not
promises: nothing in this file even has the ability to authenticate a caller
by any means other than Modal's own platform-enforced proxy-auth token pair.
"""

from __future__ import annotations

import modal
from fastapi import Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from .executor import execute
from .schemas import WebctxFetchRequest

APP_NAME = "siteborne-webctx-safe-egress"
FUNCTION_NAME = "fetch"

app = modal.App(APP_NAME)

image = modal.Image.debian_slim(python_version="3.12").pip_install("pydantic>=2.7", "fastapi>=0.110")


@app.function(image=image, timeout=35, max_containers=10)
@modal.fastapi_endpoint(method="POST", requires_proxy_auth=True, docs=False)
async def fetch(payload: dict[str, object], request: Request) -> JSONResponse:  # pragma: no cover - requires live Modal deployment
    """Deployed entry point. Bounded, delegating entirely to `execute()` so
    there is no processing logic to diverge between local (`executor.py`,
    fully unit-tested) and deployed execution — same discipline
    `modal_worker.modal_app.process_document` already established.

    Application-level schema validation (`WebctxFetchRequest`, `extra=
    "forbid"`) is defense-in-depth alongside Modal's platform-level
    `requires_proxy_auth` gate — this endpoint would reject a malformed body
    even if it were somehow reached without going through that gate.
    """
    try:
        parsed = WebctxFetchRequest.model_validate(payload)
    except ValidationError as err:
        return JSONResponse(status_code=400, content={"result_class": "failure", "reason_code": "WEBCTX_URL_VALIDATION_FAILED", "stage": "url_validation", "message": f"malformed request: {err.error_count()} field error(s)", "elapsed_ms": 0})

    result = execute(parsed)
    return JSONResponse(status_code=200, content=result.model_dump())
