"""Local development benchmark harness. Not a CI gate — reports real
measurements from repeated local runs; never fabricates p50/p95 from a
single run. See docs/operations/DOCUMENT_BENCHMARKS.md.
"""

from __future__ import annotations

import json
import statistics
import time
from pathlib import Path

from modal_worker.document.models import OcrPolicy
from modal_worker.local_runner import run_file

FIXTURES_DIR = Path(__file__).parent.parent / "fixtures"

CASES = [
    ("native_text_pdf", FIXTURES_DIR / "pdf" / "native_text_one_page.pdf", OcrPolicy.FORBIDDEN),
    ("ocr_image", FIXTURES_DIR / "images" / "text.png", OcrPolicy.IF_NEEDED),
    ("small_table_pdf", FIXTURES_DIR / "pdf" / "single_table.pdf", OcrPolicy.FORBIDDEN),
    ("mixed_scanned_pdf", FIXTURES_DIR / "pdf" / "scanned_page.pdf", OcrPolicy.IF_NEEDED),
]


def run_benchmark(repeats: int = 5) -> dict[str, object]:
    results: dict[str, object] = {}
    for name, path, ocr_policy in CASES:
        elapsed_ms: list[float] = []
        last_result = None
        for _ in range(repeats):
            start = time.perf_counter()
            last_result = run_file(path, ocr_policy=ocr_policy)
            elapsed_ms.append((time.perf_counter() - start) * 1000)

        assert last_result is not None
        results[name] = {
            "input_bytes": path.stat().st_size,
            "repeats": repeats,
            "elapsed_ms": {
                "min": round(min(elapsed_ms), 2),
                "max": round(max(elapsed_ms), 2),
                "mean": round(statistics.mean(elapsed_ms), 2),
                "median": round(statistics.median(elapsed_ms), 2),
            },
            "pages": last_result.document.page_count if last_result.document else 0,
            "extracted_characters": last_result.metrics.extracted_characters if last_result.metrics else 0,
            "status": last_result.status.value,
        }
    return results


def main() -> None:
    results = run_benchmark()
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
