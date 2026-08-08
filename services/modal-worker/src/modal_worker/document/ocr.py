"""Typed local OCR abstraction.

Backend selection (documented in docs/decisions/0026-local-ocr-engine.md):
RapidOCR, using its `torch` inference engine (already required transitively;
no cloud API, no credential, fully local). Selected empirically: Docling's
full ML layout+OCR pipeline took ~90s/document on trivial fixtures in this
environment (dominated by layout-model load, not actual OCR) and its
table-structure model did not reliably detect simple synthetic table
fixtures; RapidOCR invoked directly on rendered page images is <1s/page
after the one-time engine load and produces text + per-line confidence.

The OCR engine instance is process-global and lazily constructed (model
loading is the expensive part; inference is fast) — see `get_engine()`.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Protocol

from PIL import Image

from .failures import FailureCode, WorkerError

logging.getLogger("RapidOCR").setLevel(logging.WARNING)

OCR_ENGINE_NAME = "rapidocr"
OCR_LANGUAGE_DEFAULT = "en"


@dataclass(frozen=True)
class OcrLine:
    text: str
    confidence: float
    bbox: tuple[float, float, float, float] | None  # left, top, right, bottom


@dataclass(frozen=True)
class OcrPageResult:
    lines: list[OcrLine]
    engine: str
    engine_version: str
    language: str

    @property
    def text(self) -> str:
        return "\n".join(line.text for line in self.lines)

    @property
    def mean_confidence(self) -> float | None:
        if not self.lines:
            return None
        return sum(line.confidence for line in self.lines) / len(self.lines)


class OcrEngine(Protocol):
    def extract_page(self, image: Image.Image, language: str = OCR_LANGUAGE_DEFAULT) -> OcrPageResult: ...


_engine_singleton: RapidOcrEngine | None = None


class RapidOcrEngine:
    """Thin, typed wrapper around rapidocr.RapidOCR. Deterministic preprocessing
    is delegated to RapidOCR's own bounded internal pipeline; we bound the
    input image dimensions before calling it (see images.py / pdf.py).
    """

    def __init__(self) -> None:
        try:
            from rapidocr import EngineType, RapidOCR

            self._engine = RapidOCR(
                params={
                    "Det.engine_type": EngineType.TORCH,
                    "Cls.engine_type": EngineType.TORCH,
                    "Rec.engine_type": EngineType.TORCH,
                }
            )
            import rapidocr

            self._version = getattr(rapidocr, "__version__", "unknown")
        except Exception as exc:  # pragma: no cover - exercised via dependency_unavailable tests
            raise WorkerError(FailureCode.DEPENDENCY_UNAVAILABLE, f"rapidocr unavailable: {exc}") from exc

    def extract_page(self, image: Image.Image, language: str = OCR_LANGUAGE_DEFAULT) -> OcrPageResult:
        try:
            import numpy as np

            result = self._engine(np.array(image.convert("RGB")))
        except Exception as exc:
            raise WorkerError(FailureCode.OCR_FAILED, str(exc)) from exc

        if result is None or not getattr(result, "txts", None):
            return OcrPageResult(lines=[], engine=OCR_ENGINE_NAME, engine_version=self._version, language=language)

        lines: list[OcrLine] = []
        # We always run det+cls+rec (see __init__), so result is a full
        # RapidOCROutput with .txts/.scores at runtime; mypy sees the union
        # of possible partial-pipeline output types rapidocr's stubs declare.
        txts = result.txts or ()  # type: ignore[union-attr]
        scores = result.scores or [1.0] * len(txts)  # type: ignore[union-attr]
        boxes = getattr(result, "boxes", None)
        for i, text in enumerate(txts):
            bbox = None
            if boxes is not None and i < len(boxes):
                pts = boxes[i]
                xs = [p[0] for p in pts]
                ys = [p[1] for p in pts]
                bbox = (float(min(xs)), float(min(ys)), float(max(xs)), float(max(ys)))
            lines.append(OcrLine(text=str(text), confidence=float(scores[i]), bbox=bbox))

        return OcrPageResult(lines=lines, engine=OCR_ENGINE_NAME, engine_version=self._version, language=language)


def get_engine() -> RapidOcrEngine:
    global _engine_singleton
    if _engine_singleton is None:
        _engine_singleton = RapidOcrEngine()
    return _engine_singleton
