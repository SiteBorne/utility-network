# SITEBORNE Utility Network - ADR 0026: Local Document Extraction and OCR Engine Selection

## Context

The SUN-0400A completion plan directed evaluating Docling as the primary
document-extraction framework, backed by a Docling-supported local OCR engine.
Docling was installed and empirically tested against this worker's own fixture
corpus before committing to it.

## What was tried

`docling>=2.118` installed cleanly (network access available in this
environment) and its default full pipeline (RT-DETR layout model + TableFormer
table-structure model + bundled RapidOCR) **did** successfully extract native
text from a one-page PDF — but:

- **~90 seconds** to process a trivial one-page PDF, dominated by ML layout/OCR
  model loading (not actual extraction) — unacceptable given this worker's own
  bounded-timeout requirement (default 60s, hard cap 300s) applies per document,
  not per model-load.
- Its **TableFormer table-structure model did not detect a simple
  ReportLab-generated bordered table** on two independent attempts (default
  pipeline and an explicit `do_table_structure=True` configuration) — cells were
  extracted as ordinary text items, not a `TableItem`. This is a real accuracy
  limitation on exactly the kind of clean, simple document this worker's
  fixture-first test strategy depends on being reliable.
- It downloads ~30MB of RapidOCR model weights from `modelscope.cn` and a
  layout-detection checkpoint from HuggingFace on first use — small in absolute
  terms, but an implicit network dependency at first invocation that the
  completion plan explicitly cautioned against ("prevent acceptance tests from
  silently downloading gigabytes").

## Decision

- **Native PDF text + deterministic table extraction: `pdfplumber`**
  (line/character-geometry based, no ML model, no model download). Verified
  against the same synthetic table fixture Docling failed on —
  `pdfplumber.Page.find_tables()` detected it correctly and deterministically in
  under a millisecond.
- **OCR: `RapidOCR`** (the same library Docling itself bundles), invoked
  directly on page images rendered by `pdfplumber`/`pypdfium2`, using its
  `torch` inference engine. Selected because it is the library Docling already
  depends on for OCR (satisfying "Docling-supported" in spirit), fully local, no
  cloud API, no credential. Standalone invocation is <1s/page after the one-time
  engine load (vs. Docling's ~90s/document full-pipeline overhead for the same
  OCR capability), because it skips the layout-detection and table-structure
  models entirely when only OCR text is needed.
- **Encryption/structural-validity detection: `pypdf`.**

Docling itself is **not** a runtime dependency of this worker (removed from
`pyproject.toml`'s `dependencies` after this evaluation) — its ML-based
layout/table detection did not clear the accuracy bar on this worker's own
fixtures and its overhead did not fit the latency budget. This is a documented,
evidence-based substitution, not an assumption or a preference for "sounding
more capable."

## OCR configuration

- Engine: RapidOCR, `torch` backend for det/cls/rec (already required
  transitively; avoids an additional `onnxruntime` dependency).
- Language: `en` (default; language_hints from the frozen input schema are
  accepted by `WorkerRequest` but not yet wired to engine-level language
  selection — see Limitations in
  `docs/reports/SUN-0400A-document-worker-foundation-report.md`).
- Deterministic preprocessing: delegated to RapidOCR's own bounded internal
  pipeline; this worker bounds input image dimensions (`MAX_IMAGE_DIMENSION_PX`,
  `MAX_IMAGE_PIXELS`) before ever calling it.
- Confidence: engine-provided per-line confidence is surfaced
  (`OcrResult.mean_confidence`); this worker never fabricates a confidence score
  when the engine does not provide one.

## Status

Accepted

## Consequences

- Document processing in this worker is fast (single-digit milliseconds for
  native-text/table PDFs, sub-second for OCR pages) and has no runtime network
  dependency once RapidOCR's small model files are cached locally
  (`.venv/lib/.../rapidocr/models/`, ~30MB, downloaded once).
- Should a future increment need Docling's specific ML-layout capabilities
  (multi-column reading order, complex nested tables, chart/formula extraction),
  it can be reintroduced behind the same `document/pdf.py` interface without
  touching `WorkerRequest`/`WorkerResult` — the pipeline boundary was designed
  for this.
