# A2A Agent Card JWS Interoperability Note (Agenstry) — 2026-09-25

## Summary

A third-party directory (Agenstry) reported a JWS signature verification
failure (0/10) for the SITEBORNE Agent Card at
`https://utility.siteborne.net/.well-known/agent-card.json`. Direct
verification of the live artifact using the official `@a2a-js/sdk@1.0.1`
`verifyAgentCardSignature` implementation against the live JWKS
(`kid=siteborne-agent-card-2026-08`, ES256/P-256) **succeeds**. This note
documents what is proven versus what remains unverified about the
discrepancy.

## Proven (this repository, `packages/protocol-a2a`)

- Signing and verification both go through the official SDK
  (`generateAgentCardSignature` / `verifyAgentCardSignature`) with no
  custom canonicalization layer. `SITEBORNE_PREVERIFY_NORMALIZATION=NONE`
  — `verifyAgentCardAgainstTrustedJwks` passes the card directly to the SDK
  verifier with no transformation.
- Regression evidence (`packages/protocol-a2a/src/__tests__/agent-card-presence-sensitivity.test.ts`,
  9/9 passing, deterministic local fixture + ephemeral test-only ES256 key,
  no network dependency):
  - Object key order (top-level and nested) is **insensitive** — reordering
    keys anywhere in the card does not break verification. Consistent with
    RFC 8785 (JCS) canonicalization.
  - JSON whitespace/formatting (compact vs. pretty-printed, round-tripped
    through `JSON.parse`/`JSON.stringify`) is **insensitive**.
  - Field **presence** is signature-sensitive: adding a field that was
    absent at signing time (even set to a "default-looking" value like
    `false`), removing a field that was explicitly present at signing time
    (even if `false`), or changing an explicit field's value, all break
    verification.

## Interoperability implication

The proven behavior above means: **any verifier that reconstructs or
normalizes the Agent Card object before canonicalizing it — for example by
materializing schema defaults for absent optional fields, or by stripping
fields whose value equals what it considers a "default" (such as an
explicit `false`) — will canonicalize a different payload than the one that
was actually signed, and the signature will fail even though the original
artifact is valid.**

The Agenstry failure is **consistent with** a verifier normalizing semantic
field presence before verification. This is not proven to be the actual
cause: Agenstry's internal transformation has not been directly observed.

## Explicitly not proven

- `AGENSTRY_EXACT_NORMALIZATION=UNVERIFIED` — we have not observed
  Agenstry's implementation or the exact payload it canonicalizes.
- Whether Agenstry's snapshot reflects the same Agent Card bytes served at
  the time this note was written (deployed source is not yet
  cryptographically bound to a specific commit; see the separate PCC/source
  provenance work).

## Findings that remain separate

`SITEBORNE_SIGNER_DEFECT=NO`. No SITEBORNE signing, canonicalization,
Agent Card generation, or JWKS code was changed as part of this
investigation. This is unrelated to the confirmed PCC finalization
schema-gating defect (`packages/service-runtime/src/pcc/verify-and-sign.ts`),
which is tracked and fixed separately.

## Suggested next step

If Agenstry can share the exact object their verifier canonicalizes (or
their canonicalization implementation), a direct byte-level comparison
against the signed payload would let `AGENSTRY_EXACT_NORMALIZATION` move
from `UNVERIFIED` to `PROVEN`.
