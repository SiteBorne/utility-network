# SITEBORNE Utility Network - ADR 0028: Document Worker Resource Bounds

## Context

The document worker processes caller-influenced binary input (PDF/PNG/JPEG
bytes). Every extraction stage needs explicit bounds so a malformed or
adversarial input cannot cause unbounded memory/CPU consumption.

## Decision

Bounds are split into two tiers:

**Frozen-contract bounds**
(`schemas/common/authorized-artifact-reference.schema.json`,
`schemas/services/document-evidence-input.schema.json`), enforced first and
cross-checked against the schema files at test time
(`tests/document/test_frozen_bounds.py`, so a future schema change is caught
rather than silently diverging):

- `size_bytes` / `declared_byte_length`: 1 – 10,485,760 bytes (10 MiB).
- `page_count` / `maximum_pages`: 1 – 10.
- `media_type`: exactly `application/pdf`, `image/png`, `image/jpeg`.

**Worker-local bounds** (`document/models.py`, this worker's own defense in
depth, not present in the frozen contract):

- `MAX_IMAGE_DIMENSION_PX = 12000`, `MAX_IMAGE_PIXELS = 64_000_000`
  (decompression-bomb guard; enforced in `document/images.py` before
  `Image.load()` fully decodes, and independently via
  `PIL.Image.MAX_IMAGE_PIXELS`).
- `MAX_TEXT_BLOCKS_PER_PAGE`, `MAX_TABLES_PER_PAGE`, `MAX_TABLE_ROWS`,
  `MAX_TABLE_COLS`, `MAX_CELL_TEXT_LENGTH`, `MAX_PAGE_TEXT_LENGTH`.
- `timeout_ms`: default 60,000, hard cap 300,000 — checked at two points in
  `pipeline.py::_execute_inner` (after artifact validation, after extraction).
  This is a best-effort wall-clock check between pipeline stages, not a
  preemptive interrupt — a single pathological page's extraction call is not
  itself interrupted mid-flight. A hard preemptive timeout
  (signal/subprocess-based) is a documented gap, not a false guarantee — see the
  report's Limitations section.

Validation runs in order: request-shape validation → artifact retrieval bound
(`ArtifactAccessor.read_bounded(max_bytes=...)`) → retrieved-bytes validation
(size/hash/media-type) → page-count bound (PDF inspection, before any per-page
extraction) → per-page/per-table/per-cell bounds during extraction. Every bound
violation is a specific `FailureCode` (`BYTE_LIMIT_EXCEEDED`,
`PAGE_LIMIT_EXCEEDED`, `IMAGE_DIMENSION_LIMIT_EXCEEDED`,
`RESULT_LIMIT_EXCEEDED`), never a bare exception.

## Status

Accepted

## Consequences

- `tests/document/test_adversarial.py` proves a decompression-bomb PNG, an
  oversized-dimension image, a truncated PDF, and a document exceeding the
  frozen page limit all fail safely and deterministically with a specific,
  closed `FailureCode` rather than an unhandled exception or unbounded resource
  use.
- The two-checkpoint wall-clock timeout is real but coarse; a document whose
  single-page extraction itself hangs (e.g. a pathological OCR input) is not
  preemptively killed by this worker today. Production activation should pair
  this with an outer, infrastructure-level timeout (Modal's own `timeout=`
  parameter, already set on `modal_app.py::process_document`).
