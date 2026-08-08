# SITEBORNE Utility Network — ADR 0032: Canonical Receipt Binding (SUN-0500)

## Context

`schemas/proof-carrying-context.schema.json#/definitions/receipt` defines the
frozen PCC receipt shape (`output_hash`, `canonicalization_algorithm`,
`policy_hash`, `schema_hash`, `signature_algorithm`, `signing_key_id`,
`signature`, `signed_at`). SUN-0500's receipt needs to bind more than that — the
job/service/contract identity, the exact verifier set and their results, and the
evidence set — so a receipt is tamper-evident against every input that fed the
decision, not only the output.

## Decision

`packages/verification/src/receipt/models.ts::ReceiptPreimage` extends the
frozen `receipt` shape with: `job_id`, `request_id`, `service_id`,
`service_version`, `contract_release`, `pcc_schema_release`, `pcc_schema_hash`,
`input_hash`, `evidence_hash`, `verifier_set_hash`, `decision`, `completeness`,
`verification_mode`, `limitations`. All fields use the frozen
`canonicalization_algorithm: 'RFC8785-JCS'` and `signature_algorithm: 'Ed25519'`
values as literal types, not free strings — a receipt claiming a different
algorithm cannot type-check.

The preimage is reused directly as (part of) a PCC document's `receipt` block by
a later composition layer rather than being a parallel, incompatible format —
`ReceiptPreimage`'s field names and the frozen schema's field names are
identical where they overlap.

`evidence_hash` and `verifier_set_hash` (`receipt/identity.ts`) are each a
canonical hash of a **sorted** list of per-item hashes:
`hashCanonical(sortedListOf(hashCanonical(item)))`. Sorting before hashing means
the identity is independent of evidence/verifier registration order — two runs
of the same mesh over the same candidate produce the same `verifier_set_hash`
even if verifier registration order differs (see ADR 0031 on wave-based, not
registration-order, execution).

`receipt_id` (`computeReceiptId`) is `rcpt_` followed by a 24-hex-char prefix of
`hashCanonical(preimage)` — computed over every bound field **except**
`signature` itself (a signature cannot be part of its own signed identity). Two
`issueReceipt` calls over identical verification material (including
`request_id`, which is part of the context and therefore part of the preimage)
produce the same `receipt_id`; any single-field mutation to bound material
changes it. `receipt/verifier.ts::verifyReceipt` recomputes `receipt_id` from
the received preimage and rejects on mismatch (`receipt_id_mismatch`) before
even attempting signature verification — receipt-identity tampering is caught
independent of whether the attacker also forges a matching signature.

## Status

Accepted (SUN-0500).
