# Service Partial Results (SUN-0600)

See [ADR 0038](../decisions/0038-verified-absence-and-partial-result-policy.md)
for the full rationale. This document is the operational summary.

## When a result is `partial`

A service returns `result_class: 'partial'` whenever
`completeness.supported_fields < completeness.requested_fields` — computed from
the same completeness block embedded in the PCC document and cross-checked by
SUN-0500's `completeness_verifier`. Concretely:

- `company_evidence_graph.v1`: any requested field group that resolved to
  `unavailable` or `empty` (unresolved CIK, unimplemented field group, or a
  dependency failure) lowers `supported_fields`.
- `document_evidence_json.v1`: `processed_pages < total_pages` lowers
  `supported_fields`; `missing_fields` names the unprocessed page range.
- `web_context_verified.v1`: currently binary (a single `canonical_text` field)
  — a fetch failure means `result_class` becomes
  `internal_verification_failed`/`source_changed` rather than `partial`, since
  there is no finer-grained field decomposition for a single-page fetch in this
  increment.
- `verify_agent_output.v1`: `result_class: 'partial'` when the mesh passes but
  not every claim/deterministic-requirement in the buyer's
  `verification_contract` was satisfied — `outcome: 'conditional'` in the
  extension payload names which.

## What can never happen

- A mandatory SUN-0500 verifier's blocking failure can never be overridden by a
  service's own completeness bookkeeping — `result_class` becomes
  `internal_verification_failed` regardless of what the service computed for
  `supported_fields`/`requested_fields` (see `verifyAndSign`'s
  `signed.verdict.decision` check in every service's `execute()`).
- `missing_fields` is never empty when a claim relies on evidence the mesh would
  classify as disqualified — SUN-0500's `completeness_verifier` independently
  blocks this ("completeness cannot be overstated").
- No field group, page, or claim is silently dropped from `limitations` when it
  could not be populated — every truthful gap is named explicitly (see ADR
  0037/0039's "recognized but unavailable, not fabricated" pattern).
