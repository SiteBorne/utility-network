"""Evidence locator generation and resolution.

Mirrors packages/provider-adapters/src/evidence/locators.ts's pattern:
deterministic, typed locators that always point back into document/page
bounds — never a locator that points outside the extracted document.
"""

from __future__ import annotations

from .failures import FailureCode, WorkerError
from .models import BoundingBox, EvidenceLocator


def make_text_locator(
    locator_type: str, page: int, ordinal: int, text: str, bbox: BoundingBox | None = None
) -> EvidenceLocator:
    quote = text[:1000]
    return EvidenceLocator(
        locator_type=locator_type,  # type: ignore[arg-type]
        page=page,
        ordinal=ordinal,
        quote=quote,
        bbox=bbox,
    )


def make_table_cell_locator(
    page: int, table_ordinal: int, row: int, column: int, cell_text: str, bbox: BoundingBox | None = None
) -> EvidenceLocator:
    return EvidenceLocator(
        locator_type="table_cell",
        page=page,
        ordinal=table_ordinal,
        quote=cell_text[:1000],
        bbox=bbox,
        table_ordinal=table_ordinal,
        row=row,
        column=column,
    )


def resolve_locator(locator: EvidenceLocator, page_count: int) -> None:
    """Validates a locator resolves within document bounds. Raises
    WorkerError(INTERNAL_CONSISTENCY_FAILURE) if it does not — a locator
    pointing outside the document is a worker bug, not a client error.
    """
    if not (1 <= locator.page <= page_count):
        raise WorkerError(
            FailureCode.INTERNAL_CONSISTENCY_FAILURE,
            f"locator page {locator.page} outside document bounds (1..{page_count})",
        )
    if locator.locator_type == "table_cell":
        if locator.row is None or locator.column is None or locator.table_ordinal is None:
            raise WorkerError(
                FailureCode.INTERNAL_CONSISTENCY_FAILURE,
                "table_cell locator missing row/column/table_ordinal",
            )
