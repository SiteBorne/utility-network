"""Artifact accessor abstraction.

Mirrors the ArtifactStore interface pattern already established in
packages/provider-adapters/src/types.ts (put/getMetadata/getContent/exists)
and apps/edge-api/src/control-plane/artifacts — an injected accessor, never
a direct filesystem path from untrusted request input.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from .failures import FailureCode, WorkerError
from .hashing import content_hash


@dataclass(frozen=True)
class ArtifactMetadata:
    artifact_id: str
    media_type: str
    byte_length: int
    content_hash: str
    authorization: str  # "public" | "buyer_authorized"


class ArtifactAccessor(Protocol):
    """Injected artifact access. No implementation of this protocol may accept
    an arbitrary filesystem path supplied directly by request input — only a
    pre-registered/pre-authorized artifact_id.
    """

    def exists(self, artifact_id: str) -> bool: ...

    def get_metadata(self, artifact_id: str) -> ArtifactMetadata | None: ...

    def read_bounded(self, artifact_id: str, max_bytes: int) -> bytes:
        """Reads up to max_bytes. Raises WorkerError(BYTE_LIMIT_EXCEEDED) if the
        artifact is larger than max_bytes; WorkerError(ARTIFACT_UNAVAILABLE) if
        it does not exist; WorkerError(ARTIFACT_UNAUTHORIZED) if access is denied.
        """
        ...


@dataclass
class InMemoryArtifactAccessor:
    """Local/test implementation. Fixture tests register controlled artifact IDs
    mapped to fixture bytes — never arbitrary filesystem paths from request input.
    """

    _store: dict[str, tuple[bytes, str, str]] = field(default_factory=dict)
    # artifact_id -> (bytes, media_type, authorization)

    def register(self, artifact_id: str, data: bytes, media_type: str, authorization: str = "public") -> None:
        self._store[artifact_id] = (data, media_type, authorization)

    def exists(self, artifact_id: str) -> bool:
        return artifact_id in self._store

    def get_metadata(self, artifact_id: str) -> ArtifactMetadata | None:
        entry = self._store.get(artifact_id)
        if entry is None:
            return None
        data, media_type, authorization = entry
        return ArtifactMetadata(
            artifact_id=artifact_id,
            media_type=media_type,
            byte_length=len(data),
            content_hash=content_hash(data),
            authorization=authorization,
        )

    def read_bounded(self, artifact_id: str, max_bytes: int) -> bytes:
        entry = self._store.get(artifact_id)
        if entry is None:
            raise WorkerError(FailureCode.ARTIFACT_UNAVAILABLE, f"unknown artifact_id={artifact_id!r}")
        data, _media_type, authorization = entry
        if authorization not in ("public", "buyer_authorized"):
            raise WorkerError(FailureCode.ARTIFACT_UNAUTHORIZED, f"artifact_id={artifact_id!r}")
        if len(data) > max_bytes:
            raise WorkerError(
                FailureCode.BYTE_LIMIT_EXCEEDED,
                f"artifact_id={artifact_id!r} is {len(data)} bytes > max {max_bytes}",
            )
        return data
