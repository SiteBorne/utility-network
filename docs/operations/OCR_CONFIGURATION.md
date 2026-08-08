# OCR Configuration

See [ADR 0026](../decisions/0026-local-ocr-engine.md) for why RapidOCR was
selected over Docling's full pipeline.

## Engine

`services/modal-worker/src/modal_worker/document/ocr.py::RapidOcrEngine` wraps
`rapidocr.RapidOCR`, configured to use the `torch` inference engine for
detection, classification, and recognition stages:

```python
RapidOCR(params={
    "Det.engine_type": EngineType.TORCH,
    "Cls.engine_type": EngineType.TORCH,
    "Rec.engine_type": EngineType.TORCH,
})
```

The engine instance is process-global and lazily constructed (`get_engine()`) —
model loading (~0.5-1s) happens once per process; inference is then <1s per page
image.

## Model weights

RapidOCR downloads ~30 MB of model weights (PP-OCRv6 detection + recognition,
PP-OCRv4 classification) from `modelscope.cn` on first use, cached to
`.venv/lib/.../rapidocr/models/`. This is a one-time, environment-local download
— never committed to the repository, never re-downloaded on subsequent runs
(`.venv` is gitignored). CI runners that don't persist `.venv` between runs will
re-download this ~30MB on each run; this is a known, accepted latency cost of
the default `pnpm python:install`, not something document-worker tests trigger
repeatedly per test.

## Policy (`ocr_policy` field on `WorkerRequest`)

- `forbidden`: OCR never runs, even on a page classified as needing it. A
  warning is recorded
  (`"OCR would improve extraction but ocr_policy=forbidden"`) but the page is
  not failed.
- `if_needed` (default): OCR runs only on pages classified `scanned_image` or
  `mixed`. A native-text page never pays the OCR cost.
- `required`: OCR runs whenever the page needs it, and a failure to OCR is a
  hard failure (`FailureCode.OCR_FAILED`) rather than a soft warning.

## Known limitation

`language_hints` on the frozen `document-evidence-input.schema.json` are
accepted by `WorkerRequest` but not yet wired to RapidOCR's language selection —
every OCR call currently uses `language="en"` regardless of the request's hints.
RapidOCR's PP-OCR models are primarily tuned for Latin-script + CJK text;
non-Latin-script accuracy has not been evaluated against this worker's fixture
corpus (which is entirely English/Latin text). Tracked as follow-on work, not
silently assumed to work.
