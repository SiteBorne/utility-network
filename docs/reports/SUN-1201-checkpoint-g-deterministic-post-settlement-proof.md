# SUN-1201 Checkpoint G — Deterministic Post-Settlement Worker-Runtime Proof

Closes the three proofs SUN-1200 checkpoint F left genuinely deferred:
`SUCCESSFUL_EXECUTION_WORKERD`, `verify_agent_output` Cases A/B through real
post-settlement execution, and `OLD_VERIFY_PATH_CAUGHT`. Implementation commit
`98f0556`. This report is committed separately.

## Repository

- `START_HEAD` = `d07722e` (SUN-1200 checkpoint F final closure report)
- `END_HEAD` = `98f0556` (this checkpoint's implementation commit; this report
  commits on top)
- Implementation commit: `98f0556`
- Closure-report commit: (this file's own commit, immediately following)
- Working-tree state at every checkpoint boundary: clean except the known
  transient `wrangler.toml` diff
- Known transient diff state: unchanged content throughout (confirmed via
  `git diff wrangler.toml` before and after this checkpoint's work)

## Architecture

**`DETERMINISTIC_SETTLEMENT_TEST_SEAM`**: a new file,
`apps/edge-api/src/worker-runtime-test-entrypoint.ts`, plus
`wrangler.worker-runtime-test.toml`. Calls the exact same, real, unmodified
`buildPaidServicesApp` (`control-plane/routes/paid-services.ts`) the real
production Worker calls — same Hono app construction, same route mounting, same
`x402-service.ts`, same Profile 1 pre-economic gate, same `verify_agent_output`
service, same `verifyAndSign`/SchemaVerifier output-validation path. The only
difference from production: `evidenceMode: 'fixture'` and a
`new FixturePaymentEvidenceProvider()` are hard-coded directly in this file's
source — never read from any `env` binding, header, query parameter, cookie, or
D1/KV/R2 value. This matches the directive's own preferred pattern #1 ("separate
test-only Worker entrypoint that imports the real application/service path but
injects a deterministic fake provider unavailable from the production
entrypoint").

**`PRODUCTION_REACHABILITY`** = **none**. The real production entrypoint
(`apps/edge-api/src/index.ts`, the file `wrangler.toml`'s `main` field actually
points at) has zero import of `worker-runtime-test-entrypoint.ts` anywhere —
confirmed by direct source inspection (`grep` across `apps/edge-api/src` for any
reference, zero matches outside the test-only files themselves) and by the
bundle-isolation proof below.

**`PRODUCTION_BUNDLE_CONTAINS_TEST_PROVIDER`** = **false**. Two independent
proofs: (1) `scripts/test-worker-runtime.mts`'s own automated bundle-isolation
check runs a fresh `wrangler deploy --dry-run` of the REAL `wrangler.toml` and
greps the resulting bundle for both the test entrypoint's own source-chunk
comment (`worker-runtime-test-entrypoint`) and its distinctive runtime marker
string (`SUN-1201-WORKER-RUNTIME-TEST-ENTRYPOINT-b7f2c4`) — zero matches for
either, every run. (2) Manually re-confirmed via a fresh, independent
`wrangler deploy --dry-run --outdir` immediately before writing this report
(173,815-line bundle):
`grep -c "worker-runtime-test-entrypoint\|SUN-1201-WORKER-RUNTIME-TEST-ENTRYPOINT"`
→ **0**. `FixturePaymentEvidenceProvider` itself (a real, non-test symbol
`@siteborne/protocol-x402` already exports and the real production code already
imports for its own `resolvePaymentEvidenceProvider` fallback machinery) IS
present in the production bundle — this is pre-existing, already-audited
behavior from before this checkpoint (see checkpoint E/F reports'
"production-disabled gate" tests: `resolvePaymentEvidenceProvider` throws
`ProductionEvidenceProviderNotConfiguredError` in `'production'` mode unless the
supplied provider's `providerKind === 'external'`, decided on that field alone,
never `instanceof` — a fixture provider can never satisfy it no matter how it is
wrapped). Distinct from this checkpoint's own new seam, which additionally is
not reachable via any import path from the real entrypoint at all.

**`REQUEST_CONTROLLED_BYPASS_PATHS`** = **none found**. The test-only seam's
`evidenceMode`/`evidenceProvider` values are literal source constants in
`worker-runtime-test-entrypoint.ts`, never parameters. No HTTP body, query
string, header, cookie, environment variable, or D1/KV/R2 value selects it in
the real production Worker, because the real production Worker's code graph
never reaches this file at all.

**`REAL_PAYMENT_DEPENDENCIES_USED`** = **none**.
`FixturePaymentEvidenceProvider` produces exclusively
`synthetic_fixture`-trust-class evidence (`@siteborne/protocol-x402`'s own doc
comment) — no network call, no facilitator, no credential, ever, in either phase
of this checkpoint's harness.

## Deferred-proof closure

**`SUCCESSFUL_EXECUTION_WORKERD` = YES.** `scripts/test-worker-runtime.mts`
Phase 2, automated: a real 402 → real (synthetic) payment → real post-settlement
`verify_agent_output` service execution → real Profile 1 output validation →
real receipt/PSL generation, all inside real `workerd` (`wrangler dev --local`,
isolated `--persist-to` state, the real
`x402-service.ts`/`paid-services.ts`/`service.ts` code, only the payment
evidence provider swapped for the structurally-isolated fixture). Observed: HTTP
200, `result_class: "success"`, real `receipt_id`, real `link_id`.

**`CASE_A_WORKERD_POST_SETTLEMENT` = PASS.** Governing definition recovered
directly from
`packages/service-runtime/src/services/agent-verification/service.ts`'s own
logic (not inferred, not redefined): a Profile-1-supported `required_schema` + a
`candidate_output` that satisfies it → `result_class: 'success'`,
`output.outcome: 'pass'`. Confirmed live under real `workerd`:
`status=200 result_class=success outcome=pass`, with `requirement_results`
showing `schema_check: passed=true`.

**`CASE_B_WORKERD_POST_SETTLEMENT` = PASS.** Same schema, a `candidate_output`
that violates it. Per `x402-service.ts`'s own real, unmodified route logic (read
directly, not altered by this checkpoint): the paid route only returns 200 when
`outcome.result.result_class === 'success'` — a service result of `'partial'`
(this service's genuine outcome when its own `schema_valid` deterministic
requirement truthfully fails, confirmed via `service.ts`'s own
outcome-computation logic) is surfaced as `502 service_execution_failed`, never
billed as a successful 200. Confirmed live under real `workerd`:
`status=502 {"error":"service_execution_failed","message":"result_class=partial"}`.
This is the real, governing behavior — not something this checkpoint invented,
and not the "200 with a truthful-failure body" shape one might guess from the
informal Checkpoint F directive text alone; the actual governing code was read
and followed exactly.

**`OLD_VERIFY_PATH_CAUGHT` = YES**, with an important, honestly-reported nuance.
`scripts/test-old-verify-path-caught.mts`: verified the working tree was clean
(only the known `wrangler.toml` diff) before doing anything, overwrote
`service.ts` with the exact historical, pre-checkpoint-F `schema_valid`
implementation (a real, request-time `Ajv2020.compile()`, reconstructed from
this repository's own prior commit, not invented), ran the real Case A scenario
against it under real `workerd`, and required a regression. **Empirical finding,
not assumed**: the historical implementation already wrapped its `ajv.compile()`
call in its own `try/catch` — a standalone smoke test (a bare fetch handler
doing nothing but `new Ajv2020().compile()` on this exact schema, no surrounding
try/catch) confirms the underlying
`EvalError: Code generation from strings disallowed for this context` genuinely
IS thrown by real `workerd` for this schema, every request — but at this
specific call site, it is silently caught and converted into
`{ passed: false, details: "required_schema failed to compile: ..." }`, never an
unhandled exception. This differs from `x402-service.ts`'s original incident
(uncaught, a real 500). The mutation proof's judged criterion was corrected
accordingly: not "does the exact EvalError string appear in the HTTP response"
(it doesn't — the route-level 502 handler only surfaces `result_class=partial`,
not the buried `requirement_results[].details`), but "does Case A stop reaching
`result_class: 'success'`" (it does: 200 → 502 under the mutant). Restoration
was unconditional (a `finally` block); the restored code was re-verified to pass
Case A again, and
`git diff -- packages/service-runtime/src/services/agent-verification/service.ts`
was confirmed empty afterward. The mutant was never committed.

## Newly discovered risks (must not be under-reported)

**`X402_EXTENSION_CLASSIFICATION` reclassified:
`NON_BLOCKING_THIRD_PARTY_FAIL_CLOSED_PATH` (checkpoint F) →
`FUNCTIONAL_BLOCKER` (this checkpoint).** While constructing Phase 2's buyer
payload, echoing the server-declared `payment-identifier` extension's `schema`
field back (exactly what `packages/protocol-x402`'s own
`buildBuyerPaymentIdentifierExtensions` helper does — the official,
SITEBORNE-provided buyer-side convenience function) caused every real paid
request to fail with `400 malformed_payment_signature`, even for a structurally
valid Payment Identifier. Root cause: `@x402/extensions`'
`validatePaymentIdentifier` does a real, request-time `ajv.compile(ext.schema)`,
self-caught into `{valid: false}` on any exception under real `workerd`'s eval
restriction — poisoning a validation that would otherwise have passed.
Checkpoint F classified this as non-blocking specifically because "SITEBORNE
does not depend on that buyer-suppliable extension schema" — that premise is now
disproven: SITEBORNE's own official buyer helper depends on it, unavoidably, by
echoing the full declared extension object. Per the directive's own explicit
classification rule ("If SITEBORNE DOES depend on it: classify
FUNCTIONAL_BLOCKER and STOP before release"), this is now classified
`FUNCTIONAL_BLOCKER`. **Not fixed in this checkpoint** — modifying
`@x402/extensions`' upstream behavior is explicitly out of this checkpoint's
scope ("do not modify upstream package behavior casually," "do not overbuild").
This checkpoint's own harness routes around it by constructing buyer payloads
that omit the echoed `schema` field (a legitimate protocol variant, disclosed in
`scripts/test-worker-runtime.mts`'s own doc comment). **Any future production
cutover must resolve this first** — as currently written, a real buyer using
SITEBORNE's own official client library would have every payment rejected under
real `workerd`.

**Second, previously-missed request-time-eval call site (found and fixed, this
checkpoint).** `packages/service-runtime/src/pcc/verify-and-sign.ts`'s
post-finalization output-schema re-check called `getAjv().getSchema(schemaId)`
directly and unconditionally — bypassing SUN-1200 checkpoint F (P0-A)'s
precompiled-validator override registry entirely (that fix only covered
`schema-verifier.ts`'s call site). This was the actual root cause of Phase 2's
first debugging session returning `EvalError` for a request that omitted the
payment-identifier schema (routing past the first defect and into this second
one). Fixed with the identical, already-established pattern
(`getPrecompiledOutputValidator` first, `getAjv()` fallback for non-Worker
callers). Re-audited via a full production bundle dry-run: confirmed present and
correct, zero remaining unconditional `getAjv()` calls on the real Worker's
post-settlement path.

## Economic safety

`VERSION_UPLOADS=0` `DEPLOYMENTS=0` `PAYMENT_SIGNATURES=0` `SETTLEMENTS=0`
`TRANSACTIONS=0` — against real infrastructure, for this entire checkpoint.
Every "payment signature"/"settlement" constructed in this checkpoint's
harnesses is synthetic
(`payload: {synthetic_signature: "synthetic:buyer-fixture"}`,
`trust_class: "synthetic_fixture"` evidence from
`FixturePaymentEvidenceProvider`), against the structurally-isolated test-only
seam, never Coinbase/x402 production settlement infrastructure, never a real
wallet or credential.

## Schema/security invariants

- `VERIFY_RUNTIME_AJV` = 0 request-time occurrences reachable from the real
  Worker (confirmed by source grep of `service.ts` and by the full production
  bundle re-audit below).
- `SITEBORNE_JSON_SCHEMA_PROFILE_1` — unchanged, untouched, still the sole
  interpreter for `required_schema`; Case A/B both used the real Profile 1 code
  path, never a substitute.
- Pre-economic invalid-schema behavior — unchanged: Phase 1's Cases C-F
  (unsupported keyword / remote `$ref` / byte-limit / depth-limit) all still
  fail with a deterministic 400 before any 402, verified again this checkpoint
  under real `workerd`.
- Normal unsigned behavior — unchanged: Phase 1 re-verifies
  `web_context_verified.v2`/`document_evidence_json.v2` unsigned requests still
  receive a real 402 with `PAYMENT-REQUIRED`, on the REAL `wrangler.toml`
  config, proving the new test-only seam changes nothing observable about the
  real production Worker's normal behavior.
- Production runtime crash blockers — 0. Full bundle re-audit (below): exactly 1
  `new Function(` (AJV's own internal `_compile`, unreachable from any real
  request path), 0 bare `eval(`.

## Regression

| Gate                                                                                                                                                                   | Result                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused tests (`schema-profile-1.test.ts`)                                                                                                                             | 55/55 pass                                                                                                                                    |
| `packages/service-runtime` full suite                                                                                                                                  | all pass (part of the 274 below)                                                                                                              |
| `apps/edge-api` x402/paid-routes tests                                                                                                                                 | all pass (part of the 274 below)                                                                                                              |
| Combined vitest run (`packages/service-runtime apps/edge-api/tests/x402-service-route.test.ts apps/edge-api/tests/paid-routes-mounting.test.ts packages/verification`) | **33 files / 274 tests, all pass**                                                                                                            |
| `pnpm test:worker-runtime`                                                                                                                                             | **15/15 scenarios pass** (Phase 1 + Phase 2 + bundle isolation)                                                                               |
| `pnpm schemas:check`                                                                                                                                                   | pass, both generated files up to date                                                                                                         |
| `pnpm typecheck` (whole repo)                                                                                                                                          | 23/23 tasks pass                                                                                                                              |
| `pnpm lint` (whole repo)                                                                                                                                               | 16/16 tasks pass                                                                                                                              |
| `pnpm secrets:scan`                                                                                                                                                    | pass, 0 leaks                                                                                                                                 |
| `pnpm check` (full monorepo gate)                                                                                                                                      | **exit 0**                                                                                                                                    |
| `pnpm security:release` (semgrep/OSV/Trivy/Schemathesis/chaos/load/test:worker-runtime)                                                                                | **exit 0**, Trivy 0C/0H                                                                                                                       |
| `pnpm contracts:baseline:verify` / `compat:check` / `release:verify`                                                                                                   | all pass (invoked as part of `pnpm check`; no schema files touched this checkpoint)                                                           |
| Production bundle audit (request-time dynamic codegen)                                                                                                                 | 1 `new Function(` total (AJV internal, unreachable), 0 bare `eval(`, verify_agent_output's old dynamic compile absent, test entrypoint absent |
| Mutation proof (`OLD_VERIFY_PATH_CAUGHT`)                                                                                                                              | PASS -- mutant caught (200→502), restoration verified clean                                                                                   |

All failures: **none** this checkpoint. Nothing pre-existing broke; nothing was
silently skipped.

## Remaining work

**`GENUINELY_DEFERRED`**: none from this checkpoint's own three target proofs —
all three (`SUCCESSFUL_EXECUTION_WORKERD`, Case A, Case B,
`OLD_VERIFY_PATH_CAUGHT`) are closed. The `test:worker-runtime` harness is not
wired into a CI system external to this repository's own `pnpm` scripts (no such
CI exists in this repository to wire into); it is wired into
`pnpm security:release`, this repository's own established release gate.

**`NEWLY_DISCOVERED_RISKS`**: (1)
`X402_EXTENSION_CLASSIFICATION = FUNCTIONAL_BLOCKER` — SITEBORNE's own official
buyer helper (`buildBuyerPaymentIdentifierExtensions`) produces payloads that
are rejected under real `workerd` due to a third-party dependency's self-caught
but incorrect `ajv.compile()` call. **Must be resolved before any future
production cutover** — not resolved in this checkpoint, out of scope by the
checkpoint's own instructions. (2) `verify-and-sign.ts`'s second,
previously-missed `getAjv()` call site — found and fixed in this checkpoint;
disclosed here as a reminder that the original P0-A audit (checkpoint F) was
incomplete, and any future schema-related refactor in this codebase should
re-check for other unconditional `getAjv()` call sites the override registry
doesn't cover.

**`CONTRACT_AMBIGUITIES`**: none newly introduced. `VERIFY_DYNAMIC_DECISION=C`
(the `verify_agent_output.v2` dynamic-schema contract question) was already
resolved by ADR 0056 in the prior checkpoint; not reopened or altered here.

## Standing hard boundaries (unchanged, still in effect)

No version upload, no deploy, no route enablement, no secret modification, no
production D1/KV/R2 mutation, no payment signature, no real settlement, no real
transaction, at any point in this checkpoint. Production confirmed unchanged
immediately before writing this report: 100% at
`a4ada936-a434-4522-a8af-41c57170f4e4`, `GET /` → 200, unsigned
`POST /v2/verify/agent-output` → 404. **This checkpoint does not authorize the
next checkpoint and does not authorize any candidate upload** — resolving the
newly-discovered `FUNCTIONAL_BLOCKER` finding above is a prerequisite for that,
and is explicit, separate future work.
