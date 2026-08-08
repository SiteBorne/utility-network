# SITEBORNE Utility Network — ADR 0025: Document Worker Boundary (SUN-0400A)

## Context

`document_evidence_json.v1` needs a document-processing capability (native PDF
text, OCR, table extraction) that will eventually run on Modal. SUN-0400A builds
that capability without any Modal credential, so its correctness can be
established and tested entirely locally, independent of when a Modal deployment
token becomes available (SUN-0400B).

## Decision

The document-processing core lives in
`services/modal-worker/src/modal_worker/document/` and never imports `modal`.
Its single public entry point is
`execute(request: WorkerRequest, accessor: ArtifactAccessor) -> WorkerResult`
(`document/pipeline.py`), which never raises — every failure path returns a
classified `WorkerResult(status="failed", failure=FailureInfo(...))`.

Pipeline: authorized artifact reference → input validation → byte/media
validation → document hash → document inspection (encryption/page-count) → page
enumeration → page classification → native extraction → OCR when required →
table extraction → normalization → evidence locator generation → per-page
hashing → bounded extraction result → internal verification.

`WorkerRequest`/`WorkerResult` (`document/models.py`) are the worker's own
contract, bound to the frozen `document_evidence_json.v1` release
(`contract_release`, `input_schema_hash` fields) but distinct from it —
SUN-0400A produces a worker-level extraction result, not the PCC-wrapped service
response; a later composition layer maps one to the other (see
`to_frozen_page_classification`/`to_frozen_extraction_method` in
`document/models.py` for the exact vocabulary mapping).

Artifact access is via an injected `ArtifactAccessor` protocol
(`document/artifacts.py`), mirroring the `ArtifactStore` pattern already used in
`packages/provider-adapters` and `apps/edge-api/src/control-plane/artifacts`. No
code path in `document/` accepts an arbitrary filesystem path from request input
— only a pre-registered `artifact_id`.

## Status

Accepted

## Consequences

- The document-processing core is fully testable (170+ deterministic local
  tests) without a Modal account, and its correctness is independent of
  SUN-0400B's timeline.
- `modal_app.py` (the one module allowed to import `modal`) is a thin wrapper
  that delegates entirely to `execute()` — see ADR 0029.
- See ADR 0026 (OCR engine), ADR 0027 (evidence locators), ADR 0028 (resource
  bounds), and `docs/operations/LOCAL_DOCUMENT_WORKER.md`.
