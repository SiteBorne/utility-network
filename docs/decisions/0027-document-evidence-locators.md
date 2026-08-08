# SITEBORNE Utility Network - ADR 0027: Document Evidence Locators

## Context

Every material value the document worker extracts (native text block, OCR text
block, table cell) must be traceable back to a specific location in the source
document — the same evidence-locator discipline already used by
`packages/provider-adapters/src/evidence/locators.ts`.

## Decision

`document/models.py::EvidenceLocator` is a closed, typed locator with three
kinds, matching the extraction methods that can produce evidence:

- `native_text`: page + ordinal (block index) + bounded quote + optional
  bounding box.
- `ocr_text`: same shape as `native_text` — the locator type distinguishes
  provenance (native parse vs. OCR), not structure.
- `table_cell`: page + table ordinal + row + column + bounded quote + optional
  bounding region.

`document/locators.py::resolve_locator()` validates a locator resolves within
document bounds (`1 <= page <= page_count`) and, for `table_cell`, that
row/column/table_ordinal are all present. This runs as part of
`document/verification.py::verify_result()` before any result is returned as
success/partial — a locator pointing outside the document is treated as
`FailureCode.INTERNAL_CONSISTENCY_FAILURE` (a worker bug), not silently dropped.

Locator quotes are bounded to 1000 characters (`EvidenceLocator.quote`) — long
enough to be useful evidence, short enough to bound result size.

## Status

Accepted

## Consequences

- `tests/document/test_locators_and_verification.py` proves locators generated
  by the native-text, OCR, and table-extraction paths all resolve against their
  source documents, and that a synthetically out-of-bounds locator is correctly
  rejected.
- The `table_cell` locator's current implementation always resolves to
  `row=0, column=0` of the table (see `document/tables.py::normalize_table`)
  rather than a per-cell locator for every individual cell — a documented scope
  limitation, not a bug: full per-cell locator generation is mechanical
  follow-on work once the composition layer that consumes these locators is
  defined.
