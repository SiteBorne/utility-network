"""Deterministic page classification.

No LLM. Classification uses explicit, measurable signals extracted from the
PDF page structure (native character count, embedded image coverage,
detected table count). Every classification records the signals that
produced it, so the decision is auditable and repeatable.
"""

from __future__ import annotations

from dataclasses import dataclass

from .models import PageClassification

# Thresholds are deliberately simple and documented, not tuned against a
# proprietary corpus — see docs/decisions/0025-document-worker-boundary.md.
MIN_CHARS_FOR_NATIVE_TEXT = 20
MIN_CHARS_FOR_BLANK = 1
IMAGE_COVERAGE_FOR_SCANNED = 0.6  # image bbox area / page area
IMAGE_COVERAGE_FOR_MIXED = 0.05


@dataclass(frozen=True)
class PageSignals:
    char_count: int
    image_count: int
    image_coverage_ratio: float  # 0.0..1.0+ (can exceed 1.0 if images overlap)
    table_count: int
    is_page_readable: bool  # False for corrupt/unparseable page structure


def classify_page(signals: PageSignals) -> tuple[PageClassification, list[str]]:
    reasons: list[str] = []

    if not signals.is_page_readable:
        reasons.append("page structure could not be parsed")
        return PageClassification.UNSUPPORTED_OR_UNREADABLE, reasons

    if signals.char_count < MIN_CHARS_FOR_BLANK and signals.image_count == 0 and signals.table_count == 0:
        reasons.append(f"char_count={signals.char_count} < {MIN_CHARS_FOR_BLANK}, no images, no tables")
        return PageClassification.BLANK, reasons

    if signals.table_count > 0 and signals.char_count < MIN_CHARS_FOR_NATIVE_TEXT * 3:
        reasons.append(f"table_count={signals.table_count} dominates page content")
        return PageClassification.TABLE_HEAVY, reasons

    if signals.char_count >= MIN_CHARS_FOR_NATIVE_TEXT and signals.image_coverage_ratio < IMAGE_COVERAGE_FOR_MIXED:
        reasons.append(
            f"char_count={signals.char_count} >= {MIN_CHARS_FOR_NATIVE_TEXT}, "
            f"image_coverage={signals.image_coverage_ratio:.3f} < {IMAGE_COVERAGE_FOR_MIXED}"
        )
        return PageClassification.NATIVE_TEXT, reasons

    if signals.image_coverage_ratio >= IMAGE_COVERAGE_FOR_SCANNED and signals.char_count < MIN_CHARS_FOR_NATIVE_TEXT:
        reasons.append(
            f"image_coverage={signals.image_coverage_ratio:.3f} >= {IMAGE_COVERAGE_FOR_SCANNED}, "
            f"char_count={signals.char_count} < {MIN_CHARS_FOR_NATIVE_TEXT}"
        )
        return PageClassification.SCANNED_IMAGE, reasons

    reasons.append(
        f"char_count={signals.char_count}, image_coverage={signals.image_coverage_ratio:.3f} "
        "did not meet a single-category threshold"
    )
    return PageClassification.MIXED, reasons
