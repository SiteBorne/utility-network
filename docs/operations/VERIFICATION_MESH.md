# Verification Mesh (SUN-0500)

## What it is

`packages/verification` runs a deterministic, dependency-aware, fail-closed set
of verifiers against a candidate service result and produces a PCC-shaped
`verification` block plus a `VerificationDecision`
(`pass | conditional | fail | quarantined`). It is **not** a voting system — see
[ADR 0031](../decisions/0031-mesh-non-voting-fail-closed-aggregation.md).

## The verifier set

Exactly the eight verifiers named in the master directive §21, plus one derived
from a second normative requirement (independent reproduction) — see
[ADR 0030](../decisions/0030-verification-mesh-boundary.md) for the full
derivation:

| Verifier                          | Mandatory in                       | Depends on                      |
| --------------------------------- | ---------------------------------- | ------------------------------- |
| `schema_verifier`                 | standard, independent_reproduction | —                               |
| `evidence_accessibility_verifier` | standard, independent_reproduction | schema_verifier                 |
| `claim_evidence_verifier`         | standard, independent_reproduction | evidence_accessibility_verifier |
| `freshness_verifier`              | standard, independent_reproduction | schema_verifier                 |
| `completeness_verifier`           | standard, independent_reproduction | evidence_accessibility_verifier |
| `cross_source_verifier`           | standard, independent_reproduction | claim_evidence_verifier         |
| `provenance_verifier`             | standard, independent_reproduction | schema_verifier                 |
| `prompt_injection_verifier`       | standard, independent_reproduction | schema_verifier                 |
| `reproduction_verifier`           | independent_reproduction only      | claim_evidence_verifier         |

`buildStandardVerifiers()` and `buildReproductionVerifiers(reproduction)`
(`src/index.ts`) construct the appropriate set.

## Running it

```ts
import {
  runMesh,
  buildContext,
  createTestClock,
  buildStandardVerifiers,
} from '@siteborne/verification';

const context = buildContext({ clock: createTestClock(), mode: 'standard' });
const verdict = await runMesh(buildStandardVerifiers(), candidate, context, {
  policyHash: await hashPolicy(loadPolicy()),
});
// verdict.decision, verdict.verification (frozen PCC shape), verdict.results, verdict.waves
```

`runMesh` executes verifiers in dependency "waves"
(`src/graph.ts::computeWaves`) — verifiers with no edge between them run in
parallel via `Promise.all`; each wave only starts after every verifier in
earlier waves has completed. Every verifier call is wrapped in a per-verifier
timeout (`context.budget.perVerifierTimeoutMs`, default 5000ms from
`governance/VERIFICATION_POLICY.yaml`); a timeout or any thrown exception is
converted into a fail-closed `VerificationResult` (`rule_id: 'verifier_timeout'`
or `'verifier_exception'`) rather than escaping `runMesh` — see
`src/mesh.ts::runVerifier`.

## Policy

`governance/VERIFICATION_POLICY.yaml` is the single source of truth for which
verifier IDs are mandatory per mode, timeouts, and limits. It is Zod-validated
(`src/policy.ts`) and cross-checked against the actual verifier code by
`scripts/verify-policy.ts` (`pnpm verification:policy:verify`) — the policy
document and the verifier set can never silently diverge.

## Commands

```bash
pnpm verification:test              # unit + integration tests
pnpm verification:test:property     # fast-check property tests (non-voting guarantee)
pnpm verification:fixtures:verify   # runs fixtures/candidates/*.json through the real mesh
pnpm verification:policy:verify     # policy Zod-validation + code/policy cross-check
pnpm verification:benchmark         # local timing benchmark, no network
pnpm verification:check             # everything above, plus lint/typecheck/format
```

## See also

- [VERIFICATION_RECEIPTS.md](VERIFICATION_RECEIPTS.md)
- [KEY_ROTATION.md](KEY_ROTATION.md)
- [INDEPENDENT_REPRODUCTION.md](INDEPENDENT_REPRODUCTION.md)
