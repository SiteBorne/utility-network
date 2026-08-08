# SITEBORNE Utility Network — ADR 0030: Verification Mesh Boundary (SUN-0500)

## Context

The master directive
(`docs/source/SITEBORNE_UTILITY_NETWORK_MASTER_DIRECTIVE.md`, §21
"Verification") specifies exactly nine verification components:

```
- Schema verifier
- Evidence-accessibility verifier
- Claim-to-evidence verifier
- Freshness verifier
- Completeness verifier
- Cross-source verifier
- Provenance verifier
- Prompt-injection verifier
- Receipt signer
A deterministic failure cannot be overruled by a model.
```

Eight of these are verifiers proper; the ninth ("Receipt signer") is not a
verifier at all — it signs the verdict a verifier set already reached. SUN-0500
also needs a ninth verifier-shaped component, `reproduction_verifier`, because
the frozen PCC schema (`schemas/proof-carrying-context.schema.json`) and
`governance/VERIFICATION_POLICY.yaml`'s `independent_reproduction` mode require
an execution mode where a candidate's claims are compared against an
independently reproduced result — a capability the eight directive-named
verifiers do not provide on their own. This is not "nine arbitrary verifiers to
satisfy a count": it is the eight directive-named verifiers, unmodified, plus
one additional verifier derived from a second normative requirement (independent
reproduction), documented here rather than left implicit.

## Decision

`packages/verification/src/verifiers/` implements exactly:

1. `schema_verifier` — validates candidate output against its frozen output
   schema (via ajv against the actual `schemas/**` artifacts, not a hand-written
   copy).
2. `evidence_accessibility_verifier` — every evidence item is not disqualified
   (`source_changed`/`policy_blocked`/`quarantined`/failure classes), has a
   locator, and every claim's `evidence_ids` resolve to real evidence.
3. `claim_evidence_verifier` — every material claim has ≥1 evidence_id;
   `verified_absent` claims require absence-proof evidence, not merely zero
   evidence.
4. `freshness_verifier` — a [0,1] score from evidence `retrieved_at` vs. the
   freshness requirement; missing `retrieved_at` scores as stale, never fresh by
   default.
5. `completeness_verifier` — recomputes and cross-checks the candidate's
   declared completeness block for internal consistency and against disqualified
   evidence (completeness cannot be overstated).
6. `cross_source_verifier` — flags disagreement between sibling claims sharing a
   subject/predicate but citing different evidence.
7. `provenance_verifier` — evidence carries a recognized authorization
   classification and result_class; disqualified evidence can never back a
   `verified_absent` claim.
8. `prompt_injection_verifier` — reuses
   `packages/provider-adapters/src/html/injection-signals.ts`'s deterministic
   rule set (not a second, divergent implementation) to scan claim/output text.
9. `reproduction_verifier` — only mandatory in `independent_reproduction` mode
   (see ADR 0034); `skipped_by_policy` in `standard` mode.

`receipt signer` is implemented as `packages/verification/src/receipt/`, not as
a tenth `Verifier` — it consumes a `MeshVerdict` after the mesh has already
reached a decision (see ADR 0032, ADR 0033).

Every verifier returns the closed `VerificationResult` union
(`packages/verification/src/types.ts`) and never throws to its caller — the mesh
boundary (`mesh.ts::runVerifier`) converts any escaping exception or
per-verifier timeout into a fail-closed result, mirroring the closed-result
pattern already established in `packages/provider-adapters` and
`services/modal-worker`.

## Status

Accepted (SUN-0500).
