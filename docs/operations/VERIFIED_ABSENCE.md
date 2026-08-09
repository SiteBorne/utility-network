# Verified Absence (SUN-0600)

See [ADR 0038](../decisions/0038-verified-absence-and-partial-result-policy.md)
for the full rationale. This document is the operational summary.

## The invariant

A claim may only be marked verified-absent (`buildVerifiedAbsentClaim`,
`packages/service-runtime/src/claims/builder.ts`) when it carries at least one
evidence item that itself documents the bounded search scope actually performed.
A source/provider failure — `not_found`, `retryable_failure`, `policy_blocked`,
`source_changed`, a timeout, or an empty response — is never, by itself,
sufficient to construct a verified-absence claim.

```ts
// Throws — no absence-proof evidence supplied.
buildVerifiedAbsentClaim({
  seed,
  predicate: 'has_open_enforcement_action',
  absenceEvidenceIds: [],
});

// Valid — the evidence item itself documents what was searched.
const searchEvidence = buildEvidence({
  seed,
  sourceUri: 'https://www.federalregister.gov/documents/search?...',
  retrievedAtIso,
  contentHash,
  mediaType: 'application/json',
  locator: { type: 'json_pointer', value: '/results' },
});
buildVerifiedAbsentClaim({
  seed,
  predicate: 'has_open_enforcement_action',
  absenceEvidenceIds: [searchEvidence.evidence_id],
});
```

## Two independent enforcement layers

1. **This package's builder** refuses to construct the claim at all without
   absence-proof evidence.
2. **SUN-0500's `provenance_verifier`** independently blocks any
   `source_changed`/`policy_blocked` evidence item from backing a
   `verified_absent` claim, regardless of what this package does — even if a
   future bug in this package's own logic tried to smuggle a failure-derived
   absence claim through, the mesh would still catch it and fail closed.

## Current scope

No SUN-0600 service currently emits a verified-absence claim end-to-end —
`company_evidence_graph.v1`'s current field groups (`identity`,
`sec_submissions`/`recent_filings`, `website_evidence`) don't perform a genuine
bounded-absence search; `regulatory_mentions` (Federal Register absence, per the
master directive's example) is one of the field groups deferred to a future
increment (see [LOCAL_SERVICES.md](LOCAL_SERVICES.md)'s scope table). The
builder's guard and its downstream mesh enforcement are both implemented and
tested now so that a future field group cannot accidentally regress this
invariant when it is added.
