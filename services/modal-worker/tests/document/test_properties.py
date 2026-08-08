"""Real Hypothesis property tests (not example-based tests relabeled)."""

from __future__ import annotations

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from modal_worker.document.failures import RETRYABLE, STAGE, FailureCode
from modal_worker.document.hashing import (
    canonical_hash,
    canonical_json_bytes,
    content_hash,
    normalize_text,
)
from modal_worker.document.models import MAX_CELL_TEXT_LENGTH, MAX_TABLE_COLS, MAX_TABLE_ROWS
from modal_worker.document.tables import normalize_table

settings.register_profile(
    "document_worker",
    max_examples=50,
    suppress_health_check=[HealthCheck.too_slow, HealthCheck.data_too_large],
)
settings.load_profile("document_worker")


@given(st.binary(max_size=2000))
def test_property_content_hash_deterministic(data: bytes) -> None:
    assert content_hash(data) == content_hash(data)


@given(st.binary(min_size=1, max_size=1000), st.binary(min_size=1, max_size=1000))
def test_property_changed_bytes_change_hash(a: bytes, b: bytes) -> None:
    if a != b:
        assert content_hash(a) != content_hash(b)


@given(st.text(max_size=500))
def test_property_normalize_text_is_idempotent(text: str) -> None:
    once = normalize_text(text)
    twice = normalize_text(once)
    assert once == twice


@given(
    st.dictionaries(
        st.text(min_size=1, max_size=10, alphabet=st.characters(whitelist_categories=("Ll", "Nd"))),
        st.integers(min_value=-1000, max_value=1000),
        max_size=8,
    )
)
def test_property_canonical_json_independent_of_dict_insertion_order(d: dict[str, int]) -> None:
    reversed_d = dict(reversed(list(d.items())))
    assert canonical_json_bytes(d) == canonical_json_bytes(reversed_d)
    assert canonical_hash(d) == canonical_hash(reversed_d)


@given(
    st.lists(
        st.lists(st.text(max_size=20), min_size=1, max_size=5),
        min_size=1,
        max_size=20,
    )
)
def test_property_table_normalization_respects_row_bound(rows: list[list[str]]) -> None:
    table = normalize_table(page=1, table_ordinal=0, raw_rows=rows, bbox=None)  # type: ignore[arg-type]
    assert len(table.rows) + 1 <= MAX_TABLE_ROWS + 1  # headers + rows


@given(st.lists(st.text(max_size=30), min_size=1, max_size=20))
def test_property_table_normalization_respects_column_bound(header_row: list[str]) -> None:
    rows: list[list[str | None]] = [[cell for cell in header_row]]
    table = normalize_table(page=1, table_ordinal=0, raw_rows=rows, bbox=None)
    assert len(table.headers) <= MAX_TABLE_COLS


@given(st.text(min_size=MAX_CELL_TEXT_LENGTH + 1, max_size=MAX_CELL_TEXT_LENGTH + 500))
def test_property_table_cell_text_is_bounded(long_text: str) -> None:
    rows: list[list[str | None]] = [["header"], [long_text]]
    table = normalize_table(page=1, table_ordinal=0, raw_rows=rows, bbox=None)
    for row in table.rows:
        for cell in row:
            assert len(cell) <= MAX_CELL_TEXT_LENGTH
    assert table.truncated is True


def test_property_failure_enum_is_closed_over_retryable_and_stage() -> None:
    # Not a Hypothesis property (no generator needed) but a completeness
    # invariant kept alongside the other properties in this file.
    for code in FailureCode:
        assert code in RETRYABLE
        assert code in STAGE
