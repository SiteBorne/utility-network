"""Credential-independent document-processing worker core (SUN-0400A).

Pure processing code — this package and everything it imports from must
never import `modal`. The Modal deployment wrapper lives in
`modal_worker.modal_app`, one layer above this package.
"""

from .artifacts import ArtifactAccessor, ArtifactMetadata, InMemoryArtifactAccessor
from .failures import FailureCode, WorkerError
from .models import WorkerRequest, WorkerResult, WorkerStatus
from .pipeline import execute

__all__ = [
    "ArtifactAccessor",
    "ArtifactMetadata",
    "InMemoryArtifactAccessor",
    "FailureCode",
    "WorkerError",
    "WorkerRequest",
    "WorkerResult",
    "WorkerStatus",
    "execute",
]
