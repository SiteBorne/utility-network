# Document Worker Local Benchmarks

`services/modal-worker/scripts/benchmark.py` (`pnpm document-worker:benchmark`).
Local development evidence only — **not** Modal performance, and not run as a
mandatory CI gate (timing is host-dependent and would make CI flaky).

## Methodology

Each fixture case is run `repeats=5` times in the same process (so the OCR
engine's one-time model-load cost is paid once, matching how a warm Modal
container would behave, not a cold one). Reports min/max/mean/median elapsed
milliseconds — never a single-run number presented as if it were a stable
percentile.

## Representative local measurements (this environment, Apple Silicon, CPU)

| Case                    | Median  | Notes                               |
| ----------------------- | ------- | ----------------------------------- |
| Native-text PDF, 1 page | ~2 ms   | pdfplumber, no OCR                  |
| Small table PDF, 1 page | ~4 ms   | pdfplumber table detection          |
| OCR image (PNG)         | ~635 ms | RapidOCR inference, warm engine     |
| Scanned PDF page (OCR)  | ~880 ms | includes page-to-image render + OCR |

First OCR call in a process additionally pays ~0.5-1s for RapidOCR model load
(not reflected above — the benchmark harness's `repeats` amortizes it away;
`document-worker:test`'s first OCR test in a run pays it directly).

## Interpreting results

These numbers describe _this worker's own CPU-bound processing time_ only. They
exclude: artifact retrieval latency (an `InMemoryArtifactAccessor` in these
benchmarks — a real R2-backed accessor would add network time), Modal
cold-start/container-scheduling overhead (SUN-0400B), and any
composition-layer/PCC-wrapping cost outside this worker's boundary.
