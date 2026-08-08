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

import modal

from .document import ArtifactAccessor, ArtifactMetadata, execute
from .document.models import WorkerRequest, WorkerResult

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
    """
    request = WorkerRequest.model_validate_json(request_json)
    accessor: ArtifactAccessor = _ModalArtifactAccessor()
    result: WorkerResult = execute(request, accessor)
    return result.model_dump_json()
