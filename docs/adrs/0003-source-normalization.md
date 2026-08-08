# SITEBORNE Utility Network - ADR 0003: Authoritative Source Normalization

## Context

Each provider returns data in its own native shape (SEC EDGAR's nested
`filings.recent.*` parallel arrays, OpenAlex's `results`/`meta` envelope,
Crossref's `message`/`items` envelope, GitHub's per-endpoint REST shapes,
Federal Register's `results`/`meta` pagination). Adapters must normalize these
into a single closed result-and-observation model without fabricating data the
source did not provide.

## Decision

- Every adapter's `execute()` returns an `AdapterResult<T>` with a closed
  `resultClass` enum (`success`, `partial`, `not_found`, `policy_blocked`,
  `invalid_request`, `rate_limited`, `retryable_failure`, `permanent_failure`,
  `source_changed`, `quarantined`, `verified_absent_candidate`).
- Every successful result carries one or more `SourceObservation`s: a
  `contentHash` of the raw response, `evidence_locators` (JSON pointers, text
  quotes, or CSS selectors back to the source), a `transformation_history` of
  named provenance steps, and explicit `limitations`/`warnings` rather than
  silently dropping caveats.
- Absence is never fabricated as a value: SEC financial facts are stored as the
  exact source string (`String(fact.val)`), not re-parsed through binary
  floating point; empty result sets return `success` with zero items and an
  explicit `"No results found"` / `"No facts found matching criteria"`
  limitation rather than `not_found`, since the source responded and simply had
  nothing matching the filter.
- Filter semantics are consistent across every adapter: an empty allow-list
  array (`concepts: []`, `taxonomies: []`, `forms: []`) means "no filter,"
  matching the existing `forms` convention; a non-empty array restricts to
  exactly the named values. (An earlier version of the SEC company-facts adapter
  treated an empty `concepts`/`taxonomies` array as "no concept/taxonomy
  matches," discarding every fact; this was corrected — see
  `docs/reports/SUN-0300-public-data-adapters-report.md`.)

## Status

Accepted

## Consequences

- Callers can distinguish "the source has no more filings" from "the request
  failed" from "the source's shape changed unexpectedly" (`source_changed`, see
  ADR 0005) without inspecting provider-specific error codes.
- Every normalized value is traceable back to a specific byte range or JSON
  pointer in the original response, which is required for the evidence locators
  the wider PCC service contracts depend on.
