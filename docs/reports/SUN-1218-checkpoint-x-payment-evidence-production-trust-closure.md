# SUN-1218 Checkpoint X — Production Payment-Evidence Trust Closure + Verify v2/CDP Single-Route Activation

Status: **complete.** Implementation approved and executed via TDD across 8
tasks. No Cloudflare mutation of any kind. No real payment, settlement, or
economic effect. Live production unchanged throughout.

## 1. Starting production state

```
START_HEAD = 0de7946a836c10fda5fd1585e28bde4f78813601
CURRENT_PRODUCTION_VERSION = f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
CURRENT_PRODUCTION_TRAFFIC = 100%
GET /health = 200, GET /ready = 200, GET /mcp = 405
12/12 paid REST routes = 404
SUN1218_START_PREFLIGHT = PASS
```

## 2. Synthetic evidence root cause (recap, from the approved design)

`resolveProductionCdpEvidenceProvider`'s fallback to `{evidenceMode: 'fixture'}`
was unconditional — it never distinguished a genuine Cloudflare production
deployment from a local/test run, so any real deployment with
`PAID_ROUTES_ENABLED=true` and no ADR-0055 authorization would silently mount a
working, fixture-evidenced route rather than refusing to mount.

## 3. Trust-policy authority

`isTrustClassAllowed` and `canAdvanceToVerified`/`canAdvanceToSettled`
(`packages/protocol-x402/src/evidence/*`) were **not modified** — they already
correctly reject `synthetic_fixture` under `'production'` mode. The gap was
entirely upstream, in what evidence mode/provider the composition constructed.

## 4. CDP evidence authority

`CdpPaymentEvidenceProvider`
(`apps/edge-api/src/control-plane/evidence/cdp-provider.ts`) already existed,
fully implemented, since SUN-0700B checkpoint 1 — never touched by this
checkpoint.
`buildCdpSellerAddressLookup`/`buildProductionCdpAccountLookupClientFactory`
(`production-payment.ts`) also already existed, fully implemented and fully
tested, since SUN-1200 checkpoints C/D — discovered during planning (§0 of the
implementation plan), narrowing the approved file list: `production-payment.ts`
required **zero** modification.

## 5. Selected architecture (as implemented)

Approach A (production provider only, no production fallback), refined per your
CRITICAL FAIL-CLOSED REFINEMENT: binding presence is **not** used as a second
implicit "test mode" discriminator. Instead:

```ts
// verify-agent-output-v2-cdp-composition.ts
if (explicitTestEvidenceOverride) {
  cdpEvidence = explicitTestEvidenceOverride;
} else {
  const resolved = await resolveProductionCdpEvidenceProvider(...);
  if (resolved.evidenceMode !== 'production') {
    return { unavailable: true, reason: '...' };
  }
  cdpEvidence = resolved;
}
```

```
PRODUCTION_EVIDENCE_SELECTION = real provider OR unavailable   (never real provider OR synthetic fallback)
TEST_EVIDENCE_SELECTION       = explicitly injected controlled test provider (never inferred from ENVIRONMENT, secret presence/absence, or provider-construction failure)
```

`explicitTestEvidenceOverride` is a new, narrowly-typed, optional third
parameter. The real production route module
(`production-verify-v2-cdp-route.ts`) **never supplies it** — passes exactly two
arguments, unchanged. The only file that does is
`worker-runtime-test-entrypoint.ts` (never imported by `index.ts`, proven by the
existing bundle-isolation checks), which now explicitly passes
`{ evidenceMode: 'fixture' }` instead of relying on an implicit fallback.

## 6. Payment/evidence state machine

Unchanged (`x402-service.ts`, frozen). Traced during design: service execution
and PCC receipt signing happen **before** evidence acquisition; a durable
pre-settle draft is written **before** `evidenceProvider.settle()` is ever
called; the settlement trust-class gate is evaluated before any response is
returned as a success. This machinery already provided the safe-recovery
property this checkpoint needed — zero new recovery code was required.

## 7. Recovery matrix

Unchanged from the approved design (§6 of the design spec) —
`CAN_SETTLEMENT_SUCCEED_BEFORE_EVIDENCE_EXISTS=NO`, confirmed structurally, not
re-derived here.

## 8. Signer/evidence correlation

Unchanged. `PAID_RECEIPT_SIGNING_*` (SUN-1215) and the payment-evidence layer
remain fully separate proofs, correlated via
`quote_id`/`requirement_id`/`payment_identifier`/`receipt_id`/`verification_evidence_hash`
— all pre-existing repository identifiers, no new correlation field added.

## 9. Activation model — implemented

Two-level gate on the verify route:

```ts
if (c.env?.PAID_ROUTES_ENABLED !== 'true') return c.notFound();
if (c.env?.VERIFY_V2_CDP_ROUTE_ENABLED !== 'true') return c.notFound();
```

`VERIFY_V2_CDP_ROUTE_ENABLED?: string` added to `Env` (optional, additive). The
`/v1/*` and `/v2/*` wildcards in `index.ts` (7 unsupported, non-nevermined
routes) are now **unconditional** `c.notFound()` — no flag check at all,
resolving the activation-flag contradiction identified during design review.
`/v1/nevermined/*` and `/v2/nevermined/*` (a genuinely separate, untouched flag)
are unaffected and unmodified.

## 10. Implementation commits (8, each independently revertable)

```
84d1f20 feat(edge-api): SUN-1218 Tasks 1+2 — wire real seller-address lookup, fail closed on synthetic fallback
5c8b0a9 feat(edge-api): SUN-1218 Task 3 — VERIFY_V2_CDP_ROUTE_ENABLED route-specific activation gate
a3ab165 fix(edge-api): SUN-1218 Task 4 — unsupported /v1/* and /v2/* routes stay 404 regardless of PAID_ROUTES_ENABLED
a0dc6bd test(edge-api): SUN-1218 update pre-existing regression tests for the corrected activation model
aca1bdf test(edge-api): SUN-1218 Task 5 — Proof D, synthetic evidence reintroduction mutation proof
37894cf test(edge-api): SUN-1218 Tasks 6+7 — real-workerd two-gate qualification, bundle proof
8417609 chore(edge-api): SUN-1218 Task 8 — prettier formatting pass
```

(Tasks 1+2 were implemented as one coherent change — the fail-closed check
requires the explicit-override escape hatch to exist simultaneously, or Phase
6's own real-workerd proof would have broken mid-implementation.)

17 files changed, 975 insertions(+), 252 deletions(-).

## 11. Workerd evidence (real, not simulated)

`pnpm test:worker-runtime`: **88/88 scenarios passed** (up from 80
pre-SUN-1218). New Phase 8 proves the frozen 12-route truth table against the
REAL production entrypoint, zero live CDP calls:

| State | Global | Route                       | Result                                               |
| ----- | ------ | --------------------------- | ---------------------------------------------------- |
| A     | false  | false                       | 12/12 → 404                                          |
| B     | true   | false                       | 12/12 → 404                                          |
| C     | false  | true                        | 12/12 → 404                                          |
| D     | true   | true (no real CDP bindings) | verify → 503 (governed pre-economic); other 11 → 404 |

Phase 7 (pre-existing, updated) now proves the real entrypoint fails closed to
503 — never a payment challenge, never a silent fixture success — when both
gates are true but no real CDP bindings exist. Phase 6 (unchanged) continues to
prove the full 402 → real post-settlement success flow through the identical
SUN-1214 composition, via the test-only entrypoint's explicit evidence injection
— the underlying x402/signer/receipt pipeline is unaffected by this checkpoint.

## 12. Mutation proofs

All four fixture-reintroduction proofs pass in one run
(`scripts/test-production-fixture-reintroduction-caught.mts`):

```
[fixture-reintroduction-proof A] PASS
[fixture-reintroduction-proof B] PASS
[fixture-reintroduction-proof C] PASS
[fixture-reintroduction-proof D] PASS
```

Proof D (new): disables the composition's own fail-closed check
(`if (resolved.evidenceMode !== 'production')` → `if (false)`), requires the
composition's own behavioral test to catch it (2 of 3 tests correctly fail
against the mutant), restores byte-for-byte (hash-verified).

```
PRODUCTION_SYNTHETIC_EVIDENCE_REINTRODUCTION_CAUGHT=YES
```

## 13. Bundle proof

Real `wrangler versions upload --dry-run` bundle confirmed to contain
`buildCdpSellerAddressLookup`/`buildProductionCdpAccountLookupClientFactory`
(genuinely reachable, not merely present in source).
`FIXTURE_RUNTIME_REACHABILITY` gate updated: hard-bypass markers remain 0;
Finding B (`synthetic_fixture`) reclassified from "standing, unresolved R0" to
"fail-closed, proven, reachable only via the explicit test-only override" —
`STRING_MARKER_PRESENT` (informational) still shows the literal text present
(dead-code + the legitimate, explicit test-only path), correctly distinguished
from `FIXTURE_RUNTIME_REACHABILITY` (the real gate, now passing).

```
PRODUCTION_SYNTHETIC_PAYMENT_EVIDENCE_REACHABILITY=0
```

## 14. Production containment (throughout implementation)

Verified read-only, repeatedly, during and after implementation:
`f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce` @ 100%, `GET /health` → 200, 12/12 paid
routes → 404. Zero deployments, zero version uploads, zero secret/binding
changes.

## 15. Remaining provisioning needs

None for this checkpoint's own scope. Future provisioning (ADR-0055's 4 gates
being deliberately set) remains a distinct, future, explicitly human-authorized
action.

## 16. Final blocker status

See §32 classification block below — `PAYMENT_EVIDENCE_R0_STANDING=NO`.

## 17. Next candidate requirements

Any future candidate freezing this source (SUN-1219+) starts from a genuinely
different, corrected architecture than `f39acc84-...` (SUN-1216's frozen
candidate, which still contains the pre-SUN-1218 silent-fixture-fallback
behavior). `NEW_CANDIDATE_REQUIRED=YES`.

## 18. Full regression gate

| Check                                                                                                                                  | Result                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `pnpm lint`                                                                                                                            | 16/16 tasks PASS                                                                     |
| `pnpm typecheck`                                                                                                                       | 23/23 tasks PASS                                                                     |
| `pnpm test`                                                                                                                            | 2168 passed, 0 failed, 38 skipped                                                    |
| `pnpm test:worker-runtime`                                                                                                             | 88/88                                                                                |
| fixture-reintroduction mutation proofs                                                                                                 | A/B/C/D all PASS                                                                     |
| `pnpm pricing:check` / `x402:check` / `verification:check` / `services-runtime:check` / `mcp:check` / `a2a:check` / `nevermined:check` | all PASS                                                                             |
| `pnpm contracts:baseline:verify` / `compat:check` / `release:verify`                                                                   | all PASS                                                                             |
| `pnpm migrations:verify`                                                                                                               | PASS                                                                                 |
| `pnpm production:preflight`                                                                                                            | PASS                                                                                 |
| `pnpm format:check`                                                                                                                    | only the 2 pre-existing, unrelated SUN-1210 report files (documented since SUN-1214) |
| `pnpm secrets:scan`                                                                                                                    | 0 leaks (196 commits + working tree)                                                 |

---

## SUN-1218 FINAL CLASSIFICATION

```
SUN1218_IMPLEMENTATION_GATE=PASS

PAYMENT_EVIDENCE_R0_STANDING=NO

PRODUCTION_PAYMENT_EVIDENCE_READY=YES
PRODUCTION_SYNTHETIC_PAYMENT_EVIDENCE_REACHABILITY=0
PRODUCTION_SYNTHETIC_EVIDENCE_REINTRODUCTION_CAUGHT=YES

PAID_RECEIPT_PUBLIC_KEY_DISCOVERY_READY=NO
PUBLIC_KEY_DISCOVERY_BLOCKS_PAID_QUALIFICATION=NO

GLOBAL_PAID_FLAG_APPROVED_FOR_SINGLE_ROUTE_LAUNCH=YES (as one of two required gates, never alone)
VERIFY_V2_CDP_ROUTE_SPECIFIC_GATE_READY=YES
MASTER_KILL_SWITCH_PRESERVED=YES
UNSUPPORTED_ROUTES_REMAIN_404_WHEN_MASTER_TRUE=YES
TWELVE_ROUTE_TRUTH_TABLE=PASS

SELLER_ADDRESS_PRODUCTION_WIRING_READY=YES
LIVE_CDP_PROVIDER_CALLS=0

VERIFY_V2_CDP_CONTROLLED_PAID_QUALIFICATION_CODE_READY=YES

REAL_PAID_E2E_PROVEN=NO
BOUND_SIGNER_CLOUDFLARE_EXECUTION_PROVEN=NO

PAID_ROUTE_ACTIVATION_EXECUTED=NO
NEW_CANDIDATE_REQUIRED=YES

FUTURE_PRODUCTION_ACTIVATION_PREREQUISITES=[
  "ADR-0055's 4 human-authorization gates (PAYMENT_ENVIRONMENT=production, PRODUCTION_ENABLED=true, HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP=true, PRODUCTION_CDP_CREDENTIALS_APPROVED=true) -- a deliberate, one-time, bounded human bootstrap exception (docs/decisions/0055-human-authorized-production-bootstrap-exception.md), never automated by any checkpoint",
  "PAID_RECEIPT_PUBLIC_KEY_DISCOVERY_READY=NO, classified R1 (release-quality improvement, not an activation blocker) -- no endpoint added this checkpoint, carried forward separately",
  "PAID_ROUTES_ENABLED and VERIFY_V2_CDP_ROUTE_ENABLED both remain unset in real production -- their eventual setting is itself a future, explicit, human-authorized action (SUN-1219+)",
  "A well-formed SELLER_WALLET_ADDRESS and a real authenticated CDP account behind it -- required for buildCdpSellerAddressLookup to ever resolve successfully in real production; not exercised live by this checkpoint (zero live CDP calls, per boundary)"
]

WORKER_VERSIONS_CREATED=0
DEPLOYMENTS=0
TRAFFIC_SHIFTS=0
PRODUCTION_SECRET_CHANGES=0
PRODUCTION_BINDING_CHANGES=0
PRODUCTION_MIGRATIONS=0
REAL_PAYMENT_EVENTS=0
REAL_SETTLEMENTS=0
REAL_TRANSACTIONS=0
REAL_ECONOMIC_EFFECTS=0

FINAL_PRODUCTION_VERSION=f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
FINAL_PRODUCTION_TRAFFIC=100%
```

No stop conditions triggered. SUN-1218 is complete.
