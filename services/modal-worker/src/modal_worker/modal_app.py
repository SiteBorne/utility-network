"""Modal deployment wrapper. SUN-0400A scope: this module must import and
compile without a Modal token/credential and without deploying anything.
SUN-0400B (blocked_external) owns actually running `modal deploy` and the
live invocation/verification that follows.

Only this module (and, transitively, `modal` itself) may import the `modal`
package. `modal_worker.document` and everything it imports from must never
depend on `modal` — that separation is what makes the core testable without
Modal installed and lets a future deployment target change without
touching the processing logic.
"""

from __future__ import annotations

import base64
import binascii

import modal
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .document import ArtifactAccessor, ArtifactMetadata, InMemoryArtifactAccessor, execute
from .document.hashing import content_hash
from .document.models import (
    MAX_DOCUMENT_BYTES,
    ArtifactReference,
    OcrPolicy,
    TablePolicy,
    WorkerRequest,
    WorkerResult,
)

APP_NAME = "siteborne-document-worker"

# Compiles without deploying: `modal.App(...)`, `modal.Image...` and
# `@app.function(...)` are all local Python object construction / decorator
# application. No network call, no credential, happens at import time.
app = modal.App(APP_NAME)

image = modal.Image.debian_slim(python_version="3.12").pip_install(
    "pydantic>=2.7",
    "pypdf>=6.0,<7",
    "pdfplumber>=0.11,<1",
    "pillow>=12.0,<13",
    "rapidocr>=3.9,<4",
    "torch>=2.0",
    "fastapi>=0.110",
)


class _ModalArtifactAccessor:
    """Placeholder R2-backed accessor. SUN-0400A does not implement live R2
    access (that requires production Cloudflare credentials, out of scope —
    see docs/decisions/0029-modal-wrapper-separation.md). This class exists
    so the deployment wrapper's shape is complete and type-checks; its
    methods are intentionally unimplemented until SUN-0400B/production
    activation defines the real R2 binding.
    """

    def exists(self, artifact_id: str) -> bool:  # pragma: no cover - not exercised until SUN-0400B
        raise NotImplementedError("live artifact access requires SUN-0400B (Modal deployment) or later")

    def get_metadata(self, artifact_id: str) -> ArtifactMetadata | None:  # pragma: no cover
        raise NotImplementedError("live artifact access requires SUN-0400B (Modal deployment) or later")

    def read_bounded(self, artifact_id: str, max_bytes: int) -> bytes:  # pragma: no cover
        raise NotImplementedError("live artifact access requires SUN-0400B (Modal deployment) or later")


@app.function(image=image, timeout=300, max_containers=3)
def process_document(request_json: str) -> str:  # pragma: no cover - requires live Modal deployment
    """Deployed entry point. Not exercised locally — see SUN-0400B. Kept
    trivial and delegating entirely to the credential-independent core so
    there is no processing logic to diverge between local and deployed
    execution.

    Requires the R2-backed `_ModalArtifactAccessor` above, which is
    unimplemented pending SUN-0400B's production Cloudflare credentials/R2
    binding — callable only via Modal's own SDK (`.remote()`), which
    Cloudflare Workers cannot use. `process_document_http` below is the
    Worker-reachable entry point and does NOT depend on this function or
    on `_ModalArtifactAccessor`.
    """
    request = WorkerRequest.model_validate_json(request_json)
    accessor: ArtifactAccessor = _ModalArtifactAccessor()
    result: WorkerResult = execute(request, accessor)
    return result.model_dump_json()


class DocumentWorkerHttpRequest(BaseModel):
    """SUN-1222B-S3R — the Worker-reachable HTTP request contract for
    `document_evidence_json.v2`. Deliberately does NOT use
    `ArtifactReference`/`_ModalArtifactAccessor` (the R2-backed path
    `process_document` above depends on and SUN-0400B has not yet
    deployed) — instead mirrors `local_runner.py`'s own
    `InMemoryArtifactAccessor` pattern exactly (`run_file`'s
    `accessor.register(artifact_id, data, media_type)`), just receiving
    the bytes over HTTP (base64-encoded JSON) instead of from a local
    file. This is a real, already-exercised code path (every
    `service.test.ts`/`local_runner.py` invocation already goes through
    `InMemoryArtifactAccessor`), not a new, unproven one — no R2 binding,
    no storage service, and no new artifact-lifecycle design is required
    for this endpoint to be genuinely functional once deployed.
    """

    model_config = ConfigDict(extra="forbid")

    job_id: str = Field(min_length=1, max_length=128)
    request_id: str = Field(min_length=1, max_length=128)
    media_type: str
    content_base64: str
    ocr_policy: str = "if_needed"
    table_policy: str = "extract"


def _document_worker_http_error(status_code: int, code: str, message: str) -> JSONResponse:
    """Mirrors `webctx_safe_egress.app.fetch`'s own error-shape convention:
    a structured, never-throw JSON error body, distinguishable from a
    successful `WorkerResult` by the caller."""
    return JSONResponse(
        status_code=status_code,
        content={"result_class": "failure", "reason_code": code, "message": message},
    )


def process_document_http_core(payload: dict[str, object]) -> JSONResponse:
    """SUN-1222B-S3R — the actual request/response logic for the
    Worker-reachable `document_evidence_json.v2` entry point, extracted
    from the `@modal.fastapi_endpoint`-decorated function below so it is
    directly unit-testable without Modal installed or any live deployment
    (mirrors why `modal_worker.document` itself never imports `modal`) --
    see `test_modal_wrapper.py::TestProcessDocumentHttpCore` for full
    coverage: request validation, base64/size/media-type/policy
    rejection, and a real end-to-end `execute()` call against a real tiny
    PDF fixture, all exercised directly.

    Delegates entirely to the credential-independent core (`execute()`)
    so there is no processing logic to diverge between local
    (`local_runner.py`, fully unit-tested) and deployed execution — the
    same discipline `process_document`/`webctx_safe_egress.app.fetch`
    already establish.
    """
    try:
        parsed = DocumentWorkerHttpRequest.model_validate(payload)
    except ValidationError as err:
        return _document_worker_http_error(
            400, "DOCWORKER_REQUEST_VALIDATION_FAILED", f"malformed request: {err.error_count()} field error(s)"
        )

    try:
        data = base64.b64decode(parsed.content_base64, validate=True)
    except (binascii.Error, ValueError):
        return _document_worker_http_error(
            400, "DOCWORKER_INVALID_BASE64", "content_base64 is not valid base64"
        )

    if len(data) == 0:
        return _document_worker_http_error(400, "DOCWORKER_EMPTY_DOCUMENT", "decoded document is empty")
    if len(data) > MAX_DOCUMENT_BYTES:
        return _document_worker_http_error(
            413,
            "DOCWORKER_BYTE_LIMIT_EXCEEDED",
            f"decoded document is {len(data)} bytes, exceeds the {MAX_DOCUMENT_BYTES}-byte contract limit",
        )
    if parsed.media_type not in ("application/pdf", "image/png", "image/jpeg"):
        return _document_worker_http_error(
            400, "DOCWORKER_UNSUPPORTED_MEDIA_TYPE", f"unsupported media_type: {parsed.media_type!r}"
        )

    try:
        ocr_policy = OcrPolicy(parsed.ocr_policy)
        table_policy = TablePolicy(parsed.table_policy)
    except ValueError as err:
        return _document_worker_http_error(400, "DOCWORKER_INVALID_POLICY", str(err))

    artifact_id = f"http/{parsed.job_id}"
    accessor = InMemoryArtifactAccessor()
    accessor.register(artifact_id, data, parsed.media_type)
    digest = content_hash(data)

    request = WorkerRequest(
        job_id=parsed.job_id,
        request_id=parsed.request_id,
        service_id="document_evidence_json.v1",
        contract_release="1.0.0",
        input_schema_hash="sha256:" + "0" * 64,
        artifact_reference=ArtifactReference(
            artifact_id=artifact_id,
            media_type=parsed.media_type,  # type: ignore[arg-type]
            size_bytes=len(data),
            content_hash=digest,
        ),
        declared_media_type=parsed.media_type,  # type: ignore[arg-type]
        declared_byte_length=len(data),
        declared_sha256=digest,
        ocr_policy=ocr_policy,
        table_policy=table_policy,
    )

    result: WorkerResult = execute(request, accessor)
    return JSONResponse(status_code=200, content=result.model_dump(mode="json"))


@app.function(image=image, timeout=300, max_containers=3)
@modal.fastapi_endpoint(method="POST", requires_proxy_auth=True, docs=False)
async def process_document_http(payload: dict[str, object]) -> JSONResponse:  # pragma: no cover - trivial delegation, requires live Modal deployment
    """SUN-1222B-S3R — the Worker-reachable deployed entry point for
    `document_evidence_json.v2`, mirroring `webctx_safe_egress.app.fetch`'s
    exact `@modal.fastapi_endpoint(method="POST", requires_proxy_auth=True,
    docs=False)` pattern (real Modal SDK API — Modal's platform rejects any
    request missing/presenting the wrong `Modal-Key`/`Modal-Secret` header
    pair before this code ever runs, the same structural guarantee
    `webctx_safe_egress` already relies on). Trivial delegation to
    `process_document_http_core` — see that function's own doc comment for
    why the actual logic lives there instead of here.
    """
    return process_document_http_core(payload)
