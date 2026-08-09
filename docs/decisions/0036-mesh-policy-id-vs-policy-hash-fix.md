# SITEBORNE Utility Network — ADR 0036: `verification.policy` Is a Policy ID, Not a Hash (SUN-0600 fix to SUN-0500)

## Context

While building SUN-0600's `verifyAndSign` composition (`packages/service-runtime`), which is the first code to actually run `runMesh` and embed its `verdict.verification` block into a document validated against the real frozen output schema via ajv, schema validation failed on `verification.policy`. The frozen schema
(`schemas/proof-carrying-context.schema.json#/definitions/verification`) types
that field as `$ref: '#/definitions/policy_id'`
(`^pol_[a-z0-9]{24}$`), but SUN-0500's `mesh.ts::runMesh` populated it with
`options.policyHash` — a `sha256:...`-shaped string, since `MeshOptions` only
carried one policy-identifying value and used it for both the frozen
`verification.policy` field and (conceptually) the receipt's separate
`policy_hash` field.

SUN-0500's own tests never caught this because none of them fed a
real, mesh-produced `MeshVerdict.verification` block through ajv against the
frozen schema — `schema-verifier.test.ts` validates hand-built fixture
documents (`src/tests/fixtures.ts`), and `mesh.test.ts`/`properties.test.ts`
assert on `verdict.decision`/`verdict.verification.*` field values directly,
never round-tripping the verdict back through ajv. This is a real bug in
SUN-0500's own (non-frozen) code, not a frozen-schema defect — the frozen
schema is internally correct; `mesh.ts` was writing the wrong kind of value
into a field the schema already correctly types.

## Decision

`MeshOptions.policyHash` renamed to `MeshOptions.policyId`, documented as
requiring the frozen `policy_id` shape. Callers now pass a `pol_`-prefixed
id (e.g. `packages/service-runtime`'s deterministic ID generator) rather
than a hash. `VerificationContext.policy_hash` (a real hash, used for
receipt binding — see `packages/verification/src/receipt/issue.ts`) is
unaffected; it was already correct and is a distinct value from
`verification.policy`, which the frozen schema treats as an identifier, not
a content hash.

All SUN-0500 tests, fixtures, and scripts updated accordingly
(`POLICY_ID = 'pol_' + '0'.repeat(24)` alongside the existing
`POLICY_HASH` constant, or replacing it where `POLICY_HASH` became unused).
Full `packages/verification` test suite (76 tests), property suite (3
tests), and fixture-matrix regression gate re-verified green after the fix.

## Status

Accepted (fix landed during SUN-0600, not a new SUN-0500 acceptance —
SUN-0500's ledger acceptance record is unchanged; this ADR documents the
fix itself).
