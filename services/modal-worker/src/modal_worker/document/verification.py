"""Internal result verification.

Runs before a WorkerResult is ever returned as success/partial. An
internal-verification failure downgrades the result to `failed` with
FailureCode.INTERNAL_CONSISTENCY_FAILURE — it must never be silently
swallowed into a reported success.
"""

from __future__ import annotations

from .failures import FailureCode, WorkerError
from .locators import resolve_locator
from .models import DocumentMetadata, PageResult


def verify_result(document: DocumentMetadata, pages: list[PageResult]) -> None:
    if document.page_count != len(pages):
        raise WorkerError(
            FailureCode.INTERNAL_CONSISTENCY_FAILURE,
            f"document.page_count={document.page_count} != len(pages)={len(pages)}",
        )

    seen_pages: set[int] = set()
    seen_table_ids: set[tuple[int, int]] = set()

    for page in pages:
        if page.page_number in seen_pages:
            raise WorkerError(
                FailureCode.INTERNAL_CONSISTENCY_FAILURE,
                f"duplicate page ordinal {page.page_number}",
            )
        seen_pages.add(page.page_number)

        for block in page.text_blocks:
            resolve_locator(block.locator, len(pages))

        for table in page.tables:
            table_id = (table.page, table.table_ordinal)
            if table_id in seen_table_ids:
                raise WorkerError(
                    FailureCode.INTERNAL_CONSISTENCY_FAILURE,
                    f"duplicate table id {table_id}",
                )
            seen_table_ids.add(table_id)
            resolve_locator(table.locator, len(pages))

    expected_pages = set(range(1, len(pages) + 1))
    if seen_pages != expected_pages:
        raise WorkerError(
            FailureCode.INTERNAL_CONSISTENCY_FAILURE,
            f"page ordinals {sorted(seen_pages)} are not a complete 1..N sequence",
        )
