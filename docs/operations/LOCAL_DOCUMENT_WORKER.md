# Local Document Worker Guide

Scope: `services/modal-worker/src/modal_worker/document/` (SUN-0400A). See
[ADR 0025](../decisions/0025-document-worker-boundary.md) for the design.

## Running locally

```bash
cd services/modal-worker
.venv/bin/python -m modal_worker.local_runner path/to/file.pdf
.venv/bin/python -m modal_worker.local_runner path/to/image.png --ocr-policy required
```

Prints the `WorkerResult` as JSON and exits non-zero on `status: failed`.

## Root commands

```bash
pnpm document-worker:test              # pytest, ~7s, 81 tests
pnpm document-worker:typecheck         # mypy --strict
pnpm document-worker:lint              # ruff
pnpm document-worker:fixtures:verify   # fixture manifest completeness
pnpm document-worker:modal-import-check # modal_app.py imports w/o credentials
pnpm document-worker:check             # all of the above except fixtures:verify
pnpm document-worker:benchmark         # local timing measurements (not a CI gate)
```

## Pipeline

```
authorized artifact reference (ArtifactAccessor)
        ↓ validate_request() — cross-field checks, before any I/O
byte/media validation (validate_bytes() — declared hash/size/media-type)
        ↓
document hash (sha256:<hex>, content_hash())
        ↓
document inspection (pdf.py::inspect_pdf — encryption/page-count/structure)
        ↓
page enumeration + classification (pages.py::classify_page)
        ↓
native extraction (pdfplumber) → OCR when required (ocr.py, RapidOCR) →
table extraction (pdfplumber + tables.py)
        ↓
normalization (hashing.py::normalize_text) + evidence locators (locators.py)
        ↓
per-page hashing
        ↓
bounded WorkerResult
        ↓
internal verification (verification.py::verify_result) — must pass before
returning success/partial
```

## Extending the pipeline

- New extraction capability: add it inside `pdf.py`/`images.py`, keep the public
  shape (`PageResult`) the same. Never import `modal` from anywhere under
  `document/` — see [ADR 0029](../decisions/0029-modal-wrapper-separation.md).
- New failure mode: add a `FailureCode` value in `failures.py`, and an entry in
  all three of `RETRYABLE`/`STAGE`/`SAFE_MESSAGE` —
  `tests/document/test_failures.py::test_every_failure_code_has_retryable_stage_and_message`
  fails the build if any is missing.
- New bound: add it to `models.py`, enforce it at the earliest possible stage,
  and add a corresponding adversarial test.
