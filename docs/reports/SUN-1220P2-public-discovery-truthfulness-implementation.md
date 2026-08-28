# SUN-1220P2 — Public Discovery Truthfulness Implementation

TDD + regression + commit only. No D1 write, no Worker upload, no
deployment, no traffic shift, no live candidate request, no live 402, no
payment, no settlement.

## Evidence chain

```
SUN1220P_FAILURE_EVIDENCE_COMMIT_SHA=fc68e14fce2dc44f91c10718ab858ad61c3d296f
SUN1220P1_DESIGN_EVIDENCE_COMMIT_SHA=664427d0ceb16af000052e85bf0aeb3ed4c044c4
```

## RED proof

New test file `apps/edge-api/tests/discovery-truthfulness.test.ts` was
written first and run against the unmodified (stashed-back-to-`fc68e14`)
source. 5 of 15 tests failed exactly as predicted — every case exercising
the *candidate-active* state (the known-good/isolation/no-D1-write cases
already passed unmodified, as expected):

```
FAIL apps/edge-api/tests/discovery-truthfulness.test.ts > ... > B: candidate-equivalent gates ... → catalog production_enabled=true
  AssertionError: expected false to be true
FAIL ... > E (protocol_status): candidate-equivalent gates → protocol_status="production"
  AssertionError: expected 'preproduction' to be 'production'
FAIL ... > /services/verify_agent_output.v2 agrees with /catalog for the same env
  AssertionError: expected false to be true
FAIL ... agent-card discovery truthfulness ... > D: candidate-equivalent gates → agent-card productionEnabled=true
  AssertionError: expected false to be true
FAIL ... cross-surface coherence ... > U: for every ADR-0055-gate permutation, /catalog and agent-card never disagree
  AssertionError: expected false to be true

Test Files  1 failed | 1 passed (2)
     Tests  5 failed | 10 passed (15)
```

```
CATALOG_TDD_RED_PROVEN=YES
AGENT_CARD_TDD_RED_PROVEN=YES
DISCOVERY_COHERENCE_TDD_RED_PROVEN=YES
```

## Runtime authority reused (no duplicated gate logic)

```
RUNTIME_AVAILABILITY_AUTHORITY=production-payment.ts: isProductionPaymentAuthorized(resolveProductionAuthorizationInput(env)) [ADR-0055 4/4], checkProductionBindingsPresent(env) [CDP/seller binding presence] — both pre-existing, unmodified, reused verbatim
DISCOVERY_EFFECTIVE_STATUS_RESOLVER=resolveVerifyAgentOutputV2CdpEffectiveDiscoveryStatus (new, production-payment.ts) — composes the above plus a new isVerifyAgentOutputV2CdpRouteFlagEnabled(env) helper (extracted from production-verify-v2-cdp-route.ts's own inline two-flag check) and a synchronous PAID_RECEIPT_SIGNING_* presence check
DUPLICATED_GATE_LOGIC=NO
```

`production-verify-v2-cdp-route.ts`'s two-flag check (`PAID_ROUTES_ENABLED`
+ `VERIFY_V2_CDP_ROUTE_ENABLED`) was extracted, not duplicated: the real
route module now calls `isVerifyAgentOutputV2CdpRouteFlagEnabled(c.env)`
instead of its own inline comparison — byte-identical short-circuit order
and literal comparisons, proven unchanged by `test:worker-runtime`'s
existing PHASE 8 truth-table (States A–D) passing unmodified.

The discovery resolver deliberately does **not** call
`resolveProductionCdpEvidenceProvider`/attempt a live CDP account lookup —
that is a real network call to an external service, and this resolver runs
on every public, unauthenticated `/catalog`/agent-card request. Making
discovery pay for a live CDP round trip per visitor would itself be a new,
unreviewed live-call surface this checkpoint's own `NO LIVE CDP CALL`
boundary forbids. Runtime route execution remains the sole authority for
whether a request actually succeeds economically; this resolver only
governs what discovery is permitted to *claim*.

## D1 non-mutation

```
D1_SCHEMA_CHANGE=NO
D1_DATA_WRITE=NO
```

Neither `services.ts`'s `create`/`updateProductionEnabled` nor any
migration/seed file was touched. Test `R/S` asserts zero `INSERT`/`UPDATE`/
`DELETE` calls reach the fake D1 across every gate-state combination
exercised by `/catalog`. `updateProductionEnabled` still has zero runtime
callers, exactly as SUN-1220P1 found it.

## Architecture implemented

`catalog.ts`'s `overlayEffectiveDiscoveryStatus` and `card.ts`'s
`buildX402ExtensionParams` both fully **determine** (not merely raise) the
served `production_enabled`/`production_ready`/`protocol_status`/
`productionEnabled` for `verify_agent_output.v2` from
`resolveVerifyAgentOutputV2CdpEffectiveDiscoveryStatus`'s boolean result —
in both directions. This is a deliberate strengthening over the original
SUN-1220P1 design sketch (which only raised a false floor): a mid-
implementation regression test (`N2`) proved that "raise only" lets a
hypothetically-drifted D1 row with `production_enabled=1` leak through
unchanged on a known-good-equivalent (gates-off) request — reproducing
exactly the contradiction SUN-1220P1 §7 proved unsafe for a direct D1
write, just moved one layer up. Fully determining the value in both
directions closes that hole without needing D1 to ever be trustworthy on
its own.

`card.ts`'s `productionEnabled` is injected via a new optional
`effectiveProductionStatusByServiceId` parameter threaded from
`CreateSiteborneA2aOptions` (`types.ts`) through
`createSiteborneA2aHonoApp` (`transport.ts`) to
`buildUnsignedSiteborneAgentCard`/`buildX402ExtensionParams` (`card.ts`) —
mirroring the existing `signingIdentity` injection pattern exactly.
`packages/protocol-a2a` still never reads `env`, D1, or any secret itself;
`apps/edge-api/src/routes/a2a.ts` computes the boolean from the real gates
and injects it. Omitting the option (every caller before this checkpoint)
preserves the prior byte-identical `false` default — proven by the
pre-existing `card.test.ts` passing completely unmodified.

`a2a.ts`'s module-level app cache (`cachedA2aAppPromise`) previously keyed
only on nothing (rebuilt once, ever, per isolate). Its cache key now also
covers the computed `verifyAgentOutputV2Active` boolean (alongside the
existing signing-identity fields) — within one real Worker version/isolate
`env` never changes mid-isolate so this is a no-op behavior change in
production, but it makes multiple env states correctly observable within
one test process (proven by the cross-surface coherence test `U`, which
exercises 64 gate permutations against the same imported `app` singleton).

## Known-good / candidate truth table (observed)

```
KNOWN_GOOD_CATALOG_PRODUCTION_ENABLED=false
CANDIDATE_CATALOG_PRODUCTION_ENABLED=true
KNOWN_GOOD_AGENT_CARD_PRODUCTION_ENABLED=false
CANDIDATE_AGENT_CARD_PRODUCTION_ENABLED=true
CANDIDATE_AGENT_CARD_PROTOCOL_STATUS=production (via /catalog and /services/<id>; the agent card itself does not emit protocol_status, confirmed unchanged from SUN-1220P1 §4)
CATALOG_AND_AGENT_CARD_AGREE=YES (test U: 64/64 ADR-0055-gate-permutation cases agree)
CATALOG_AND_SERVICE_DETAIL_AGREE=YES
```

## Other-surface scope (per SUN-1220P1 §14)

```
OPENAPI_CHANGE_REQUIRED=NO (no per-service production-flag field exists in the OpenAPI document)
MCP_DISCOVERY_CHANGE_REQUIRED=NO (SUN-1220P1 left MCP discovery UNPROVEN/untraced; no contradictory availability assertion was proven for it, so per §14's own instruction not to change surfaces merely for symmetry, it is left untouched this checkpoint — flagged as a follow-up trace, not assumed safe or unsafe)
READY_CHANGE_REQUIRED=NO (`production_services_enabled` is a distinct field with its own semantics, unaffected)
```

## Other-route isolation

```
OTHER_11_PAID_ROUTES_DISCOVERY_CHANGED_TO_ACTIVE=NO
OTHER_11_PAID_ROUTES_RUNTIME_CHANGED=NO
NEVERMINED_DISCOVERY_CHANGED_TO_ACTIVE=NO
NEVERMINED_RUNTIME_CHANGED=NO
```

Test `P` proves `company_evidence_graph.v1`'s row is untouched under
candidate-equivalent gates; the overlay guard (`service_id !==
OVERLAY_SERVICE_ID`) is itself covered by mutation proof #8 (widening the
guard to match every service is caught).

## Economic execution path

```
ECONOMIC_EXECUTION_PATH_CHANGED=NO
PAID_ROUTE_COMPOSITION_CHANGED=NO
SUN1220J_O1_BUYER_CLIENT_CHANGED=NO
```

`verify-agent-output-v2-cdp-composition.ts`, `x402-service.ts`,
`production-paid-services.ts`, the signer, receipt path, and evidence
provider resolution are byte-unchanged (`git diff --stat` below touches
exactly 7 files, none of them). `production-verify-v2-cdp-route.ts`'s
change is a pure extraction of its existing two-flag comparison into a
shared helper — same literal comparisons, same short-circuit order — and
`test:worker-runtime`'s PHASE 7/8 truth table (which directly exercises
this route's activation logic under real workerd) passed unchanged,
proving no behavioral drift.

```
git diff --stat (this checkpoint's implementation commit):
 apps/edge-api/src/control-plane/config/production-payment.ts        | 72 +++++++++++++++++
 apps/edge-api/src/control-plane/routes/catalog.ts                   | 96 +++++++++++++++++----
 apps/edge-api/src/control-plane/routes/production-verify-v2-cdp-route.ts | 22 +++---
 apps/edge-api/src/routes/a2a.ts                                     | 61 ++++++++++++--
 packages/protocol-a2a/src/card.ts                                   | 20 ++++-
 packages/protocol-a2a/src/transport.ts                              |  4 +-
 packages/protocol-a2a/src/types.ts                                  | 12 +++
```

Every changed runtime file classifies as:
- `production-payment.ts`: **SHARED_RUNTIME_GATE_HELPER_REUSE** (additive exports only)
- `catalog.ts`: **DISCOVERY_SERIALIZATION**
- `production-verify-v2-cdp-route.ts`: **SHARED_RUNTIME_GATE_HELPER_REUSE** (behavior-preserving extraction, proven via unchanged PHASE 7/8 worker-runtime results)
- `a2a.ts`, `card.ts`, `transport.ts`, `types.ts`: **DISCOVERY_CONTEXT**

None classify as payment settlement, payment evidence, receipt signing,
paid executor, buyer signing, D1 migration/write path, or route activation
*semantics* (only the activation gate's code location moved, not its
behavior).

## Paid-E2E evidence transfer

```
CURRENT_PAID_E2E_EVIDENCE_REMAINS_VALID=YES
REAL_PAID_E2E_MUST_BE_REPEATED_AFTER_DISCOVERY_FIX=NO
```

The actual diff (above) touches only discovery serialization/context and
one behavior-preserving extraction of an existing route-activation gate
check — no line in `verify-agent-output-v2-cdp-composition.ts`,
`x402-service.ts`, the signer, or the evidence provider changed. SUN-1220O's
on-chain settlement (`0x612efe6f...eaec5a2`) remains valid, unaffected
evidence that the payment/execution path itself is correct.

## Mutation proof

`scripts/test-discovery-truthfulness-mutation-caught.mts` — 10 deliberate
mutations, each applied to production source, tested, then restored
byte-for-byte (SHA-256 verified in a `finally` block regardless of
outcome):

1. Remove candidate runtime overlay from catalog — caught
2. Hardcode agent-card `productionEnabled: false` again — caught
3. Hardcode agent-card `productionEnabled: true` globally — caught
4. Ignore master gate (`PAID_ROUTES_ENABLED`) in the shared flag helper — caught
5. Ignore route-specific gate (`VERIFY_V2_CDP_ROUTE_ENABLED`) — caught
6. Skip the ADR-0055 authorization check entirely — caught
7. Drop the signing-key presence check — caught
8. Widen the overlay guard to match every service — caught
9. OR the effective status with the static D1 value instead of overriding — caught
10. Introduce a stray D1 write inside the discovery GET handler — caught

```
DISCOVERY_TRUTHFULNESS_MUTATION_PROOF=PASS (10/10 caught, final restored-source re-run: PASS)
```

## Regression

```
lint: PASS (16/16 packages)
typecheck: PASS (23/23 packages)
test: PASS — 2227 passed, 37 skipped (up from 2211 pre-SUN-1220P; +14 new discovery-truthfulness cases, +1 N2, +1 net elsewhere)
test:worker-runtime: PASS — 88/88 scenarios (PHASE 7/8 route-gate truth table unchanged)
production:preflight: PASS
secrets:scan: 1 pre-existing finding (public on-chain address in docs/reports/SUN-1220O-first-real-paid-e2e.md, commit 322852a, predates this checkpoint — same known false positive flagged in SUN-1220P's own report) — zero new findings introduced by this checkpoint's changes
```

## Worker bundle safety

`test:worker-runtime`'s dry-run build (real `wrangler.toml`, real
workerd) exercises `index.ts`'s real entrypoint, which mounts `catalog.ts`
and `a2a.ts` unconditionally — both changed files are therefore
necessarily present in the bundle exercised by every PHASE 7/8 scenario
that passed above.

```
DISCOVERY_OVERLAY_PRESENT_IN_WORKER=YES (implied by PHASE 7/8 passing against the real dry-run bundle, which includes catalog.ts/a2a.ts unconditionally)
BUYER_SIGNING_CODE_REACHABILITY=0 (unchanged — no line in the signing/evidence path was touched)
CDP_WALLET_SECRET_RUNTIME_REACHABILITY=0 (unchanged)
PRODUCTION_FIXTURE_REACHABILITY=0 (unchanged — worker-runtime's own FIXTURE_RUNTIME_REACHABILITY check passed)
PRODUCTION_SYNTHETIC_PAYMENT_EVIDENCE_REACHABILITY=0 (unchanged)
```

## Production containment (read-only, before and after)

```
CURRENT_PRODUCTION_VERSION=f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
CURRENT_PRODUCTION_TRAFFIC=100%
candidate absent from active deployment
```

Unchanged throughout this checkpoint — no deployment, no version upload,
no traffic shift was performed.

## Candidate consequence

```
HISTORICAL_PAID_CANDIDATE_REUSABLE_FOR_NEW_CANARY=NO
NEW_DISCOVERY_FIXED_CANDIDATE_REQUIRED=YES
SUN1220O_PAID_E2E_EVIDENCE_REMAINS_VALID=YES
REAL_PAID_E2E_MUST_BE_REPEATED=NO
```

`a0055146-d358-40d4-b0af-52eccc56c8ef` becomes historical for any future
canary (Worker source changed); it remains permanent evidence that the
payment/execution path settles correctly. A new immutable candidate
carrying this discovery fix will be required for the next canary attempt —
not performed in this checkpoint.

## Mutation accounting

```
D1_SCHEMA_CHANGES=0
D1_WRITES=0
WORKER_VERSIONS_CREATED=0
DEPLOYMENTS=0
TRAFFIC_SHIFTS=0
LIVE_CANDIDATE_REQUESTS=0
LIVE_402_REQUESTS=0
LIVE_SIGN_TYPED_DATA_CALLS=0
EIP3009_AUTHORIZATIONS_CREATED=0
PAYMENT_SIGNATURES_CREATED=0
LIVE_PAID_REQUESTS=0
SETTLEMENTS=0
TRANSACTIONS=0
REAL_ECONOMIC_EFFECTS=0
```

## Final stop packet

```
SUN1220P2_DISCOVERY_TRUTHFULNESS_IMPLEMENTATION=PASS
SUN1220P1_DESIGN_EVIDENCE_COMMIT_SHA=664427d0ceb16af000052e85bf0aeb3ed4c044c4
SUN1220P2_IMPLEMENTATION_COMMIT_SHA=<recorded after commit, see repository log>
CATALOG_TDD_RED_PROVEN=YES
AGENT_CARD_TDD_RED_PROVEN=YES
DISCOVERY_COHERENCE_TDD_RED_PROVEN=YES
RUNTIME_AVAILABILITY_AUTHORITY=production-payment.ts (isProductionPaymentAuthorized/resolveProductionAuthorizationInput, checkProductionBindingsPresent, isVerifyAgentOutputV2CdpRouteFlagEnabled)
DISCOVERY_EFFECTIVE_STATUS_RESOLVER=resolveVerifyAgentOutputV2CdpEffectiveDiscoveryStatus
DUPLICATED_GATE_LOGIC=NO
D1_SCHEMA_CHANGE=NO
D1_DATA_WRITE=NO
KNOWN_GOOD_CATALOG_PRODUCTION_ENABLED=false
CANDIDATE_CATALOG_PRODUCTION_ENABLED=true
KNOWN_GOOD_AGENT_CARD_PRODUCTION_ENABLED=false
CANDIDATE_AGENT_CARD_PRODUCTION_ENABLED=true
CANDIDATE_AGENT_CARD_PROTOCOL_STATUS=production (via /catalog; agent card itself carries no protocol_status field)
CATALOG_AND_AGENT_CARD_AGREE=YES
CATALOG_AND_SERVICE_DETAIL_AGREE=YES
OPENAPI_CHANGE_REQUIRED=NO
MCP_DISCOVERY_CHANGE_REQUIRED=NO (untraced this checkpoint; not assumed safe)
READY_CHANGE_REQUIRED=NO
OTHER_11_PAID_ROUTES_DISCOVERY_CHANGED_TO_ACTIVE=NO
OTHER_11_PAID_ROUTES_RUNTIME_CHANGED=NO
NEVERMINED_DISCOVERY_CHANGED_TO_ACTIVE=NO
NEVERMINED_RUNTIME_CHANGED=NO
ECONOMIC_EXECUTION_PATH_CHANGED=NO
PAID_ROUTE_COMPOSITION_CHANGED=NO
SUN1220J_O1_BUYER_CLIENT_CHANGED=NO
DISCOVERY_TRUTHFULNESS_MUTATION_PROOF=PASS
TESTS=2227 passed, 37 skipped
WORKER_RUNTIME=88/88
PRODUCTION_PREFLIGHT=PASS
SECRETS_SCAN=1 pre-existing finding (predates this checkpoint, same false positive already disclosed in SUN-1220P), 0 new
CURRENT_PAID_E2E_EVIDENCE_REMAINS_VALID=YES
REAL_PAID_E2E_MUST_BE_REPEATED_AFTER_DISCOVERY_FIX=NO
HISTORICAL_PAID_CANDIDATE_REUSABLE_FOR_NEW_CANARY=NO
NEW_DISCOVERY_FIXED_CANDIDATE_REQUIRED=YES
D1_WRITES=0
WORKER_VERSIONS_CREATED=0
DEPLOYMENTS=0
TRAFFIC_SHIFTS=0
LIVE_402_REQUESTS=0
LIVE_SIGN_TYPED_DATA_CALLS=0
PAYMENT_SIGNATURES_CREATED=0
LIVE_PAID_REQUESTS=0
SETTLEMENTS=0
TRANSACTIONS=0
REAL_ECONOMIC_EFFECTS=0
NEW_DISCOVERY_FIXED_CANDIDATE_UPLOAD_ELIGIBLE=YES
```

Not deployed. Not uploaded. SUN-1220O not repeated. Canary not restarted.
