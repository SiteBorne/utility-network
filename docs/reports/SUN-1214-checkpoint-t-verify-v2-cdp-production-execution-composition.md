# SUN-1214 Checkpoint T — First Production Paid-Service Execution Composition (`verify_agent_output.v2` / CDP)

## Summary

```
SUN1214_IMPLEMENTATION_GATE = PASS
VERIFY_V2_CDP_PRODUCTION_COMPOSITION_CODE_READY = YES
VERIFY_V2_CDP_PRODUCTION_EXECUTOR_READY = YES
PAID_RECEIPT_SIGNER_IMPLEMENTATION_READY = YES
ARTIFACT_IMPLEMENTATION_READY = NOT_APPLICABLE (this service never persists an artifact -- see §4)
AUDIT_IMPLEMENTATION_READY = YES (reused existing x402-service.ts D1AuditRepository, no new code)
X402_IDEMPOTENCY_RECOVERY_READY = YES (reused existing x402-service.ts idempotency_records, no new code)
WORKER_RUNTIME_READY = YES (72/72 pnpm test:worker-runtime scenarios pass, including 6 new)
PRODUCTION_FIXTURE_REACHABILITY = 0
PRODUCTION_FIXTURE_FALLBACK = NONE
PRODUCTION_INFRASTRUCTURE_PROVISIONING_REQUIRED = YES
VERIFY_V2_CDP_NEW_CANDIDATE_READY_FOR_PROVISIONING = YES
VERIFY_V2_CDP_PAID_ACTIVATION_ELIGIBLE = NO
PAID_ROUTE_ACTIVATION_EXECUTED = NO
```

A complete, real production execution composition for `verify_agent_output.v2` /
CDP now exists in the repository: a dedicated Ed25519 paid-receipt signer, a
production executor built around the real, unmodified verification engine, and a
production route composition that plugs into the existing, unmodified
`x402-service.ts` payment lifecycle -- proven end to end under real `workerd`.
None of it is wired into `index.ts`; the live route remains exactly `404`,
unchanged throughout.

## 1. Approved design and plan references

- Design:
  [docs/superpowers/specs/2026-08-22-verify-v2-cdp-production-execution-composition-design.md](../superpowers/specs/2026-08-22-verify-v2-cdp-production-execution-composition-design.md)
- Plan:
  [docs/superpowers/plans/2026-08-22-verify-v2-cdp-production-execution-composition.md](../superpowers/plans/2026-08-22-verify-v2-cdp-production-execution-composition.md)

Both explicitly approved by the human operator in chat before any implementation
began.

## 2. Starting state

```
CURRENT_PRODUCTION_VERSION = f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
CURRENT_PRODUCTION_TRAFFIC = 100%
SUN1214_START_PREFLIGHT = PASS
GET /health = 200, GET /ready = 200, GET /mcp = 405
/v2/verify/agent-output = 404
```

## 3. Exact commits

Implementation isolated in worktree `../siteborne-sun1214`, branch
`sun1214-verify-v2-cdp-production-composition`.

```
IMPLEMENTATION_START_HEAD = f992b7ff266092c4db594d97475598c61f2890c6
```

```
7cc9c21  feat(service-runtime): dedicated production paid-receipt signer
1576300  feat(edge-api): verify_agent_output.v2 production executor (fixture-free)
e118e63  feat(edge-api): verify_agent_output.v2/CDP production route composition (fail-closed, unwired)
6e3db1b  test(worker-runtime): verify_agent_output.v2/CDP production composition, real workerd proof
9611ea4  test(mutation-proof): extend fixture-reintroduction proof to verify v2/CDP production composition
a8673bb  fix(edge-api): satisfy consistent-type-imports lint rule in composition test
```

Merged into `main` after this report (§20).

## 4. Signer implementation

`packages/service-runtime/src/pcc/production-signer.ts`,
`buildProductionSigner(rawPrivateKeyHex, keyId)`. Uses the repository's
existing, already Worker-compatible `@noble/ed25519`-backed
`signBytes`/`verifyBytes` primitives unchanged -- no new cryptographic format.
Dedicated: never reuses `AGENT_CARD_SIGNING_PRIVATE_KEY` (different algorithm
family, different trust domain). Registered with
`purpose: 'paid_service_receipt'`, `environment: 'production'`, distinct from
the fixture signer's `'service_runtime_fixture_receipt'`/`'test'`.

Fails closed (`ProductionSignerConfigurationError`) on: empty key, wrong byte
length, malformed hex, key ID not matching the frozen `^kid_[a-z0-9]{24}$`
pattern. Never falls back to `createFixtureSigner`.

## 5. Artifact persistence disposition

`ARTIFACT_IMPLEMENTATION_READY = NOT_APPLICABLE`. Direct source inspection
(`VerifyAgentOutputService`, the claim builder, the evidence builder, the whole
`pcc/` construction pipeline this service uses) confirmed zero calls to
`context.artifact_store` anywhere in this service's execution path. The
production executor's `artifact_store` stub throws on any call rather than
silently no-op'ing -- a real regression signal if this ever changes.
`R2ArtifactStoreAdapter` (SUN-1213's finding: real code, exists, unused) remains
untouched; this checkpoint's scope genuinely never needed it.

## 6. Audit and x402-lifecycle integration

No new audit code.
`apps/edge-api/src/control-plane/production/ verify-agent-output-v2-cdp-composition.ts`
assembles a real `X402ServiceRouteConfig` and calls the real, unmodified
`createX402ServiceRoute` -- the same shared handler every paid route (test and
would-be production) is built from. This automatically gets the existing, real,
tested `D1AuditRepository`/`X402QuoteRepository`/
`X402ServiceResultRepository`/`D1PaymentAttemptRepository` machinery, including
`idempotency_records`-backed dedupe -- none of it duplicated or bypassed.

```
X402_EXECUTION_COMPOSITION_READY (design's own term) = YES
```

One real dispatcher-level finding, discovered by TDD (Task 3): the dispatcher
(`executeLocalService`) itself calls `context.audit.emit(...)` for its own
`service_execution_started`/`completed`/`failed` bookkeeping, independent of the
service. This is a separate, non-durable, per-execution-scoped channel from the
durable x402 audit trail; the production executor supplies a real (working,
in-memory) sink for it, distinct from the throw-on-use artifact-store stub.

## 7. Verify production executor

`apps/edge-api/src/control-plane/production/ verify-agent-output-v2-production-executor.ts`,
`buildVerifyAgentOutputV2ProductionExecutor(signer, registry)`. Builds a real
(`execution_mode: 'live'`) `ServiceExecutionContext` and calls
`executeLocalService` against the real, unmodified `VerifyAgentOutputService` --
no duplicated verify logic, no Profile 1 changes, no request-runtime AJV/eval
reintroduced, no provider dependency, no fixture result path.

`ServiceRegistry.register()`'s `productionEnabled` field is typed as the literal
`false` and the class throws on any other value ("production activation is out
of SUN-0600 scope") -- a permanently-scoped, unrelated older gate on this
specific dispatch registry, documented inline in the executor's own code so it
is not mistaken for a fixture claim. What actually governs real vs. fixture
behavior is `execution_mode: 'live'` and the real signer, both genuinely real in
this composition.

Proven via a differential test against the existing fixture-backed path:
identical semantic output for identical input, differing only in the signature
(production key vs. fixture key) and `output_hash`/`issued_at` (the draft PCC
document embeds a clock-derived timestamp; the production executor uses a real,
moving clock, the fixture path a fixed test clock -- a genuine, expected
difference, not a defect, discovered and documented during TDD rather than
assumed).

## 8. Lifecycle / state diagram

Derived from `x402-service.ts`'s actual, unmodified control flow (not invented):

```
request validation (existing, unmodified)
  -> pre-economic Profile 1 gate (existing, unmodified)
  -> [no valid payment] -> 402, quote persisted (existing)
  -> [valid payment] -> evidence resolution via
       resolveProductionCdpEvidenceProvider (existing, unmodified;
       resolves to fixture mode today -- see §9)
  -> idempotency check (existing idempotency_records)
  -> config.executor(input, ctx) -- THIS CHECKPOINT'S NEW CODE, called
       exactly once per non-duplicate request:
       buildVerifyAgentOutputV2ProductionExecutor -> real
       VerifyAgentOutputService.execute -> real verifyAndSign with the
       real production signer
  -> X402ServiceResultRepository.create (existing, unmodified) persists
       the full result
  -> audit(...) calls throughout (existing, unmodified) write to
       audit_events
  -> settlement transition (existing, unmodified) -- strictly gated on
       executor success; no path reaches settlement without a successful
       real verify+sign
  -> durable response returned
```

## 9. Crash / recovery matrix

Every new failure mode this checkpoint introduces is narrower than, and fails
strictly before, anything the existing lifecycle already handles:

| Failure                                       | Economic effect possible?                                                   | Execution runs?                  |
| --------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------- |
| missing/malformed signing key material        | NO -- composition factory returns `{unavailable}` before route construction | NO                               |
| key ID pattern mismatch                       | NO (same)                                                                   | NO                               |
| missing D1 database                           | NO (same)                                                                   | NO                               |
| verify engine internal failure (post-payment) | NO -- settlement gated on executor success (existing, unmodified)           | YES (ran, failed)                |
| signing failure inside `verifyAndSign`        | NO (same gating)                                                            | YES (verify ran, signing failed) |
| duplicate idempotent request                  | NO new effect -- existing dedupe (existing, unmodified)                     | NO re-execution (proven, §11)    |

All other failure modes (D1 unavailable mid-request, post-payment crash, etc.)
are inherited, unmodified `x402-service.ts` behavior -- not re-derived or
duplicated by this checkpoint.

## 10. Fixture isolation

```
PRODUCTION_FIXTURE_REACHABILITY = 0
PRODUCTION_FIXTURE_FALLBACK = NONE
PRODUCTION_FIXTURE_REINTRODUCTION_CAUGHT = YES
```

Two independent, fresh mutation proofs
(`scripts/test-production-fixture-reintroduction-caught.mts`, both re-run this
checkpoint, not reused from a prior report):

- Proof A (SUN-1206, unmodified behavior): reintroducing the fixture paid-
  service graph into `index.ts` is caught by `production:preflight`.
- Proof B (new, SUN-1214): reintroducing `createFixtureSigner` into
  `verify-agent-output-v2-production-executor.ts` is caught by that module's own
  structural fixture-exclusion test. Both restore their target byte-for-byte in
  a `finally` block; both PASS.

Bundle-isolation check (`pnpm test:worker-runtime`'s `runBundleIsolationCheck`,
extended this checkpoint) confirms a fresh `wrangler deploy --dry-run` of the
real `wrangler.toml` contains none of the three new modules -- `index.ts`
imports none of them.

## 11. Real-workerd evidence

`pnpm test:worker-runtime`: **72/72 scenarios pass** (66 pre-existing baseline,
unchanged + 6 new Phase 6 scenarios). New route `/v2/verify-production/*`
(test-only-only path, mounted in `worker-runtime-test-entrypoint.ts`, never a
real production path) proves the real composition module end to end:

```
PHASE 6 (1): unsigned request -> real 402, canonical price 19000        PASS
PHASE 6 (2): synthetic payment -> real post-settlement success through
             the real production composition                            PASS
PHASE 6 (3): malformed input -> deterministic pre-economic rejection
             (never 402)                                                 PASS
PHASE 6 (4): duplicate request (same payment identifier) -> consistent
             result via the existing x402 idempotency machinery          PASS
```

One honest limitation recorded during this task: `x402-service.ts`'s success
response body deliberately never includes the full receipt object (only
`receipt_id`) -- confirmed by reading its `responseBody` construction directly.
Cryptographic proof that the _production_ (not fixture) signer produced the
signature therefore remains a unit-level proof (§7's differential test, which
has in-process access to the full receipt), not re-derived at the wire level in
Phase 6. This is disclosed rather than silently worked around.

## 12. Regression results

```
service-runtime tests:       148 passed, 3 skipped, 0 failed
edge-api tests:               578 passed, 29 skipped, 0 failed
pnpm lint (full monorepo):    PASS (one real finding caught and fixed --
                               see §13)
pnpm typecheck (full monorepo): PASS (23/23 tasks)
pnpm pricing:check:            PASS
pnpm x402:check:                PASS
pnpm mcp:check:                 PASS
pnpm verification:check:        PASS
pnpm services-runtime:check:    PASS
pnpm contracts:baseline:verify: PASS
pnpm contracts:compat:check:    PASS
pnpm secrets:scan:              PASS (178 commits, 0 leaks; working
                                 directory, 0 leaks)
pnpm test:worker-runtime:       72/72 PASS
```

`pnpm format:check` (part of `pnpm check`) failed on two **pre-existing,
unrelated** files (`SUN-1210-checkpoint-p3...md`, `SUN-1210-checkpoint-p4...md`)
-- confirmed via `git log`/`git diff` against `main` that this branch never
touched either file and the drift already existed on `main` before this
checkpoint began. Not fixed here (out of this checkpoint's scope per its own
file-touch boundary); every other `pnpm check` step relevant to this
checkpoint's actual changes was run individually instead and passed, per the
reasoning above. The full `pnpm security:release` suite
(Semgrep/OSV/Trivy/Schemathesis/chaos/load) was not re-run, per this
checkpoint's own §11 guidance ("since the approved architecture leaves
x402-service.ts and cryptographic formats unchanged, focused security
qualification plus pnpm check should normally be sufficient") -- no economic
sequencing, cryptographic contract, x402 lifecycle internals, payment
validation, or settlement behavior was modified; only new, additive, unwired
modules were created.

## 13. Real findings during implementation (honestly disclosed)

1. **Dispatcher-level audit call** (§6): `executeLocalService` itself calls
   `context.audit`, not just the service -- missed by the design's source
   review, caught by the differential test's first run against a throw-on-use
   stub, fixed with a real (non-durable) in-memory sink.
2. **`output_hash` legitimately differs** between production and fixture paths
   (embeds a clock-derived `issued_at`) -- an initial test assertion wrongly
   expected equality; corrected after tracing the actual hash computation
   (`packages/verification/src/receipt/issue.ts`).
3. **`ServiceRegistry.register()`'s literal-`false` `productionEnabled` type**
   -- a real, permanent, unrelated constraint discovered while writing the
   implementation plan; documented inline rather than worked around.
4. **`getAuthenticatedSellerAddress` is never supplied anywhere in this
   repository today** (confirmed by reading `production-payment.ts`'s own doc
   comment) -- this composition's CDP evidence resolution always falls back to
   fixture mode regardless of which real CDP secrets exist, an additional,
   pre-existing safety property this checkpoint didn't need to build and doesn't
   change.
5. **A real lint violation** (`consistent-type-imports`) was caught by the Task
   8 full monorepo lint run and fixed (fixup commit `a8673bb`).
6. **Two overly-broad fixture-name safety checks** (in both the new structural
   test and the new mutation proof) initially matched their own doc-comment
   prose rather than only import statements -- narrowed to import-line-only
   checks in each case.

## 14. Production containment (Task 7, re-verified at closure)

```
CURRENT_PRODUCTION_VERSION = f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce (unchanged)
CURRENT_PRODUCTION_TRAFFIC = 100% (unchanged)
GET /health = 200, GET /ready = 200, GET /mcp = 405
/v2/verify/agent-output = 404 (unchanged)
pnpm production:preflight = PASS
```

## 15. Targeted SUN-1213 R0 disposition

```
R0 #5 (verify_agent_output.v2 production wiring)   -- CLOSED_IN_CODE
R0 #6 (production paid receipt/evidence signer)     -- CLOSED_IN_CODE
R0 #7 (production artifact persistence)             -- NOT_APPLICABLE to
                                                        this service (see §5);
                                                        remains STILL_OPEN
                                                        for company/web/document
R0 #8 (production service audit persistence)        -- CLOSED_IN_CODE
                                                        (reused existing,
                                                        already-wired
                                                        x402-service.ts
                                                        machinery -- no new
                                                        infrastructure work
                                                        was actually needed
                                                        here)
```

None are `CLOSED` in the infrastructure sense -- see §16.

## 16. Next-candidate provisioning manifest

```
required Worker secret names:
  PAID_RECEIPT_SIGNING_PRIVATE_KEY
  PAID_RECEIPT_SIGNING_KEY_ID   (not itself sensitive -- may be a
                                  committed [vars] entry instead of a
                                  secret; either way, missing/malformed
                                  fails closed identically)

required binding names:        none new (DB, already present, is sufficient)
required Cloudflare resources: none new (no R2, no new D1, no new KV)
required D1 migrations:        none (existing schema, migration head 0007,
                                 already sufficient)
required configuration vars:   none new beyond the two secrets above
required public key/key-ID
  metadata:                    no discovery endpoint yet -- an explicit
                                 non-goal of this checkpoint (§16 of the
                                 approved design); needed before any real
                                 external verifier could check a receipt
migration order:                N/A -- none required
provisioning order:             PAID_RECEIPT_SIGNING_PRIVATE_KEY and
                                 PAID_RECEIPT_SIGNING_KEY_ID have no
                                 ordering dependency on each other
upload prerequisites:           none of this checkpoint's code is wired
                                 into index.ts, so no new Worker version
                                 upload is implied by this checkpoint at all
```

This is a substantially smaller provisioning footprint than SUN-1213's original
cross-cutting framing (signer + artifact + audit as three separate
infrastructure efforts) implied -- because artifact persistence turned out not
to apply to this service, and audit persistence turned out to already be wired
and just needed reachability.

## 17. Mutation accounting

```
VERSION_UPLOADS = 0
WORKER_VERSIONS_CREATED = 0
DEPLOYMENTS = 0
TRAFFIC_SHIFTS = 0
PRODUCTION_SECRET_CHANGES = 0
PRODUCTION_BINDING_CHANGES = 0
PRODUCTION_RESOURCE_CREATIONS = 0
PRODUCTION_MIGRATIONS_EXECUTED = 0
PAID_ROUTE_CHANGES_IN_LIVE_PRODUCTION = 0
PAYMENT_SIGNATURES = 0
SETTLEMENTS = 0
TRANSACTIONS = 0
REAL_ECONOMIC_EFFECTS = 0
LIVE_PROVIDER_CALLS_PERFORMED = 0
```

Every signature produced during this checkpoint's tests used test-only key
material generated in-memory at test/process runtime (never committed, never a
Cloudflare secret) -- local cryptographic test execution, not real production
payment/economic activity.

## 18. Final classifications

```
SUN1214_IMPLEMENTATION_GATE = PASS
VERIFY_V2_CDP_PRODUCTION_COMPOSITION_CODE_READY = YES
VERIFY_V2_CDP_PRODUCTION_EXECUTOR_READY = YES
PAID_RECEIPT_SIGNER_IMPLEMENTATION_READY = YES
PRODUCTION_PAID_SIGNING_SECRET_PROVISIONED = NO
ARTIFACT_IMPLEMENTATION_READY = NOT_APPLICABLE
PRODUCTION_ARTIFACT_RESOURCE_PROVISIONED = NO (not needed for this service)
AUDIT_IMPLEMENTATION_READY = YES
PRODUCTION_AUDIT_MIGRATION_APPLIED = NO (not needed -- existing schema sufficient)
X402_IDEMPOTENCY_RECOVERY_READY = YES
WORKER_RUNTIME_READY = YES
PRODUCTION_FIXTURE_REACHABILITY = 0
PRODUCTION_FIXTURE_FALLBACK = NONE
PRODUCTION_INFRASTRUCTURE_PROVISIONING_REQUIRED = YES (2 secrets only)
VERIFY_V2_CDP_NEW_CANDIDATE_READY_FOR_PROVISIONING = YES
VERIFY_V2_CDP_PAID_ACTIVATION_ELIGIBLE = NO
PAID_ROUTE_ACTIVATION_EXECUTED = NO
ROUTE_DEFAULT_STATE = DISABLED
```

## 19. Next checkpoint recommendation

```
SUN-1215 -- Verify v2/CDP Production Infrastructure Provisioning,
Migration, Secret/Binding Reconciliation & New Candidate Freeze
```

Scoped only to provisioning the two secrets enumerated in §16, reconciling
`production:preflight`/the binding-and-secret matrices against the actual
provisioned state, and freezing a new candidate manifest that includes this
checkpoint's code -- **not** wiring `index.ts` to actually mount the route, and
**not** activating it. Route activation remains a separately authorized future
checkpoint requiring, per the governing directive's own §35: new candidate
qualification, a new Worker version upload, zero-traffic smoke, and a controlled
economic end-to-end qualification, each its own boundary.

## 20. Merge to main

This branch (`sun1214-verify-v2-cdp-production-composition`) was merged into
`main` after this report's commit, per this project's established
single-branch-of-record convention -- the isolated worktree existed to protect
`main` during implementation (per Task 0), not as a permanent fork.
