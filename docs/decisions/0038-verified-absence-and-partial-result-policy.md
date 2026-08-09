# SITEBORNE Utility Network — ADR 0038: Verified-Absence and Partial-Result Policy (SUN-0600)

## Context

The master directive and the SUN-0600 execution instructions both require that
"verified absence" never arise from a mere provider/source failure —
`not_found`, `retryable_failure`, `policy_blocked`, `source_changed`, a timeout,
or an empty result must stay distinguishable from an authoritative, scoped
absence finding. Similarly, a partial result must never overstate its own
completeness.

## Decision

**Verified absence.** SUN-0600's shared claim builder
(`src/claims/builder.ts::buildVerifiedAbsentClaim`) throws if called with zero
`absenceEvidenceIds` — a verified-absent claim can only be constructed alongside
evidence that itself documents the search scope performed. No service in this
increment currently exercises a bounded-absence scenario that satisfies this
(company evidence's SEC/website field groups return `empty`/`unavailable` on
failure, not absence — see `company-evidence/service.ts`), so
`buildVerifiedAbsentClaim` is implemented and unit-tested directly
(`src/claims/builder.test.ts`) and its downstream mesh behavior is covered by
`packages/verification/src/tests/claim-evidence-verifier.test.ts` (SUN-0500),
but it is not yet invoked by a SUN-0600 service end-to-end; the guard exists so
a future field group implementing a genuine bounded-absence search (e.g., "no
matching Federal Register record for query X over interval Y") cannot
accidentally construct an absence claim from a plain fetch failure. Provider
result classes (`not_found`, `retryable_failure`, `policy_blocked`,
`source_changed`) are mapped through `pcc/candidate-conversion.ts`'s
`accessibility_status` bridge (see that file's doc comment) into the mesh's
disqualification set, and `provenance_verifier` (SUN-0500) independently blocks
a `source_changed`/ `policy_blocked` evidence item from ever backing a
`verified_absent` claim — a second, independent enforcement layer, not just this
package's own discipline.

**Partial results.** Every service reports `result_class: 'partial'` whenever
`supported_fields < requested_fields` (company evidence, document evidence) —
computed directly from the same `completeness` block embedded in the PCC
document and checked for consistency by SUN-0500's `completeness_verifier`, not
a separate, potentially-diverging service-side claim. A field group a service
could not populate is reported `status: 'unavailable'` in the extension payload
with a truthful `limitations` entry (e.g., "field group ... is not implemented
in this increment"), never silently omitted or marked complete. `missing_fields`
in the completeness block always reflects requested-but-unsupported field
groups/pages/claims. No mandatory verifier failure (SUN-0500) can be overridden
by a service's own completeness bookkeeping — the mesh decision is computed
independently from the same underlying claims/evidence, and a
`fail`/`quarantined` mesh decision always forces
`result_class: 'internal_verification_failed'` regardless of what the service's
own partial/complete accounting says.

## Status

Accepted (SUN-0600). A concrete bounded-absence field group (e.g. Federal
Register search-window absence) is not implemented in this increment —
`buildVerifiedAbsentClaim`'s guard is exercised by unit tests, not yet by an
end-to-end service scenario.
