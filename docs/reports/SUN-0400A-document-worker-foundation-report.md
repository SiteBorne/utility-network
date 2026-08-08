# SUN-0400A — Credential-Independent Document Processing Worker Foundation — Report

## Summary

Implements a credential-independent document-processing core
(`services/modal-worker/src/modal_worker/document/`) for the future
`document_evidence_json.v1` service: native PDF text extraction, deterministic
table extraction, local OCR, page classification, evidence locators, content
hashing, a closed failure taxonomy, internal result verification, and a Modal
deployment wrapper that imports/compiles without credentials or deployment. No
Modal token was requested, used, or required at any point. No live deployment
occurred. Production remains disabled.

## Architecture decision: Docling evaluated and not used for the primary pipeline

The completion plan directed evaluating Docling as the primary extraction
framework. It was installed and tested against this worker's own fixture corpus
(not assumed to work): its full pipeline took ~90 seconds per trivial document
(dominated by ML layout-model loading, not extraction) and its table-structure
model did not detect a simple synthetic table fixture on two independent
attempts. Both findings are empirical, not theoretical — see
[ADR 0026](../decisions/0026-local-ocr-engine.md) for the exact reproduction.

The primary pipeline instead uses **pdfplumber** (deterministic,
line/geometry-based, no ML model) for native text and table extraction, and
**RapidOCR** (the same library Docling itself bundles, invoked directly) for
OCR. This is faster (single-digit milliseconds for native/table PDFs, sub-second
for OCR) and, on this worker's fixture corpus, more reliable than routing
everything through Docling's full ML pipeline. Docling is not a runtime
dependency of the shipped worker.

## Package paths

- Python package: `services/modal-worker/src/modal_worker/document/`
- Worker request model: `document/models.py::WorkerRequest`
- Worker result model: `document/models.py::WorkerResult`
- Processing pipeline: `document/pipeline.py::execute()`
- PDF integration: `document/pdf.py` (pdfplumber + pypdf)
- OCR abstraction: `document/ocr.py` (RapidOCR, torch engine, v3.9.2)
- Table extraction: `document/tables.py`
- Page classification: `document/pages.py`
- Artifact accessor: `document/artifacts.py`
- Locator implementation: `document/locators.py`
- Hash/canonicalization: `document/hashing.py`
- Failure taxonomy: `document/failures.py`
- Internal verification: `document/verification.py`
- Local runner (CLI, no `modal` import): `local_runner.py`
- Modal wrapper (the only file importing `modal`): `modal_app.py`

## Test results

`pnpm document-worker:test` — **81 passed, 0 failed, 0 skipped**, ~6-7s wall
time, zero real network calls, zero real sleeping.

| Suite                                                            | File                                | Count |
| ---------------------------------------------------------------- | ----------------------------------- | ----- |
| Request/model validation                                         | `test_request_validation.py`        | 10    |
| PDF extraction (native/table/OCR/malformed/encrypted/page-limit) | `test_pdf_processing.py`            | 11    |
| Image (PNG/JPEG/OCR/malformed/mismatch)                          | `test_images.py`                    | 6     |
| Hashing/canonicalization                                         | `test_hashing.py`                   | 8     |
| Locators + internal verification                                 | `test_locators_and_verification.py` | 8     |
| Failure taxonomy completeness                                    | `test_failures.py`                  | 3     |
| Frozen-schema bound cross-checks                                 | `test_frozen_bounds.py`             | 4     |
| Artifact accessor                                                | `test_artifacts.py`                 | 5     |
| Hypothesis properties                                            | `test_properties.py`                | 7     |
| Adversarial inputs                                               | `test_adversarial.py`               | 7     |
| Modal wrapper import/no-modal-in-core                            | `test_modal_wrapper.py`             | 3     |
| Pre-existing health/config (unchanged)                           | `test_health_config.py`             | 7     |
| **Existing PCC/contracts (unaffected)**                          | (root `python:test:pcc`)            | 91    |

Existing modal-worker `test_health_config.py` (7 tests, unchanged from before
SUN-0400A) is included in the 81 total above, not double-counted elsewhere.

### Hypothesis properties (`test_properties.py`)

**7 real `@given` properties**, `max_examples=50` each (registered profile
`document_worker`) = up to 350 generated cases per run. Not example tests
relabeled — every one uses a `hypothesis.strategies` generator. No fixed seed
pinned (a failing case reports its own reproduction seed via Hypothesis's
standard failure output). Zero skipped, zero failures at time of this report.

Covers: content-hash determinism, content-hash sensitivity to byte changes,
`normalize_text` idempotence, canonical-JSON independence from dict insertion
order, table row-count bound enforcement, table column-count bound enforcement,
table cell-text length bound enforcement (with truncation flag verification). A
completeness check over `FailureCode` is also included in this file (not itself
a generator-driven property, kept alongside the others for cohesion).

### Adversarial tests (`test_adversarial.py`)

Decompression-bomb PNG (20000x20000 bilevel image), truncated/corrupt PDF
header, zero-byte document (rejected by pydantic's own `size_bytes>=1` before
the worker runs), a 9-blank-page PDF (proves page enumeration stays bounded and
correct at just under the 10-page limit), zero-width/RTL-control Unicode
characters through `normalize_text` (must not raise, must be idempotent),
magic-byte media-type sniffing catching a mislabeled file, and an
oversized-dimension (13000px) image independently of its declared size.

## Ruff / mypy

`pnpm document-worker:lint` — clean. `pnpm document-worker:typecheck`
(`mypy --strict` across `src/`, `tests/`, `scripts/`) — clean, 36 source files.
Two `# type: ignore[union-attr]` comments in `ocr.py` are documented inline
(rapidocr's stub types declare a union of partial-pipeline outputs; this worker
always runs the full det+cls+rec pipeline, so the narrower runtime type is
guaranteed but not expressible without the ignore).

## Modal wrapper

`modal_app.py` imports and constructs `modal.App(...)` / `modal.Image...` /
`@app.function(...)` successfully with `MODAL_TOKEN_ID`/`MODAL_TOKEN_SECRET`
explicitly unset (`test_modal_app_imports_without_credentials`). No
`modal deploy` was run; no live invocation occurred; no production resource was
created. `test_document_package_never_imports_modal` parses every file under
`document/` with Python's `ast` module and asserts none imports `modal` — a
structural, executable guarantee (see
[ADR 0029](../decisions/0029-modal-wrapper-separation.md)).

## Fixture corpus

`services/modal-worker/fixtures/` — 9 PDF + 6 image fixtures, ~76 KB total, all
programmatically generated (`scripts/generate_fixtures.py`, reportlab + Pillow),
no downloaded/uncontrolled documents. See
[DOCUMENT_FIXTURES.md](../operations/DOCUMENT_FIXTURES.md) for the full
inventory and regeneration instructions.

## Benchmark

`pnpm document-worker:benchmark` — see
[DOCUMENT_BENCHMARKS.md](../operations/DOCUMENT_BENCHMARKS.md) for methodology
and representative local numbers (median ~2ms native-text PDF, ~880ms
scanned-page OCR on this development machine). Not a CI gate; not a Modal
performance claim.

## Resource limits — implemented and tested

Frozen-contract bounds (10 MiB, 10 pages, 3 media types) cross-checked against
the actual schema JSON files at test time (`test_frozen_bounds.py`), not
hardcoded blindly. Worker-local bounds (image dimensions/pixels, table
rows/cols/cell length, text-block/table counts) are enforced and exercised by
both example tests and Hypothesis properties.

## Failure taxonomy — closed and tested

17 `FailureCode` values (matching the completion plan's list exactly), each with
a `retryable` flag, a `stage`, and a client-safe message —
`test_failures.py::test_every_failure_code_has_retryable_stage_and_message`
fails the build if any is incomplete. No test asserts on a raw exception message
or stack trace ever reaching a `FailureInfo`.

## Partial-result and internal-verification semantics

A result with any page warning or limitation is `status: partial`, never
silently reported as `success`. `verification.py::verify_result()` runs before
any success/partial result is returned and checks: document page-count
consistency, no duplicate page ordinals, a complete 1..N page sequence, no
duplicate table IDs, and every locator resolves within document bounds. A
verification failure becomes `FailureCode.INTERNAL_CONSISTENCY_FAILURE`, never a
silently-accepted success.

## Known limitations (honest, not silently assumed away)

- **No hard preemptive timeout.** `timeout_ms` is checked at pipeline-stage
  boundaries (before extraction, after extraction), not via a preemptive
  interrupt — a single pathological page's extraction call is not itself killed
  mid-flight. Production should pair this with Modal's own container-level
  `timeout=` (already set in `modal_app.py`). See ADR 0028.
- **Table cell locators resolve to a single representative cell** (row 0,
  column 0) per table, not one locator per cell. Documented in ADR 0027 as
  scope, not a defect.
- **`language_hints` from the frozen input schema are accepted but not wired to
  OCR language selection** — every OCR call uses `language="en"`. See
  `docs/operations/OCR_CONFIGURATION.md`.
- **No live R2-backed `ArtifactAccessor`.**
  `modal_app.py::_ModalArtifactAccessor` is a typed placeholder whose methods
  raise `NotImplementedError` — building a real one requires production
  Cloudflare R2 credentials, out of SUN-0400A's scope (and SUN-0400B's, per the
  source directive's ordering).
- **Fixture-corpus regeneration is not guaranteed byte-identical** across
  reportlab/Pillow version bumps (only content-identical, which is what the
  tests actually assert). Documented in `DOCUMENT_FIXTURES.md`.
- **RapidOCR downloads ~30MB of model weights on first use** from
  `modelscope.cn`, cached in `.venv` (gitignored, never committed). Not a
  "gigabytes" download, but a real first-use network dependency, disclosed
  rather than hidden.

## Classification

- Document-processing core: `fixture_verified` (81/81 local tests passing, zero
  real network calls in the default test run).
- OCR: `fixture_verified` (RapidOCR, local, tested against synthetic OCR
  fixtures).
- Table extraction: `fixture_verified` (pdfplumber, tested against single-table
  and multi-table fixtures).
- Modal wrapper: `scaffolded` — imports/compiles/type-checks without
  credentials; not deployed; not live-verified. SUN-0400B owns deployment and
  live verification.
- Production activation: not implemented, not requested, remains disabled.
