"""Deterministic table normalization from pdfplumber's extracted tables."""

from __future__ import annotations

from .failures import FailureCode, WorkerError
from .hashing import canonical_hash
from .locators import make_table_cell_locator
from .models import (
    MAX_CELL_TEXT_LENGTH,
    MAX_TABLE_COLS,
    MAX_TABLE_ROWS,
    BoundingBox,
    ExtractionMethod,
    Table,
)


def normalize_table(
    page: int,
    table_ordinal: int,
    raw_rows: list[list[str | None]],
    bbox: tuple[float, float, float, float] | None,
) -> Table:
    """raw_rows: pdfplumber's extract_tables() row format — list of rows, each a
    list of cell strings (or None for an empty cell). Row/column order from
    pdfplumber is already stable (top-to-bottom, left-to-right); we preserve it.
    """
    if not raw_rows:
        raise WorkerError(FailureCode.TABLE_EXTRACTION_FAILED, "empty table")

    truncated = False
    rows = raw_rows
    if len(rows) > MAX_TABLE_ROWS:
        rows = rows[:MAX_TABLE_ROWS]
        truncated = True

    max_cols = max((len(r) for r in rows), default=0)
    if max_cols > MAX_TABLE_COLS:
        rows = [r[:MAX_TABLE_COLS] for r in rows]
        truncated = True

    normalized_rows: list[list[str]] = []
    for row in rows:
        normalized_row: list[str] = []
        for cell in row:
            text = "" if cell is None else str(cell)
            if len(text) > MAX_CELL_TEXT_LENGTH:
                text = text[:MAX_CELL_TEXT_LENGTH]
                truncated = True
            normalized_row.append(text)
        normalized_rows.append(normalized_row)

    headers = normalized_rows[0] if normalized_rows else []
    body_rows = normalized_rows[1:] if len(normalized_rows) > 1 else []

    table_hash = canonical_hash({"page": page, "table_ordinal": table_ordinal, "rows": normalized_rows})

    bbox_model = (
        BoundingBox(left=bbox[0], top=bbox[1], right=bbox[2], bottom=bbox[3]) if bbox is not None else None
    )
    locator = make_table_cell_locator(
        page=page,
        table_ordinal=table_ordinal,
        row=0,
        column=0,
        cell_text=normalized_rows[0][0] if normalized_rows and normalized_rows[0] else "",
        bbox=bbox_model,
    )

    return Table(
        page=page,
        table_ordinal=table_ordinal,
        headers=headers,
        rows=body_rows,
        bbox=bbox_model,
        extraction_method=ExtractionMethod.NATIVE,
        table_hash=table_hash,
        truncated=truncated,
        locator=locator,
    )
