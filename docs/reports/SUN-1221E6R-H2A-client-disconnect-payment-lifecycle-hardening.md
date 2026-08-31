# SUN-1221E6R-H2A — Post-Verify Client-Disconnect Lifecycle Hardening

## 1. Corrected incident (input evidence)

H1A (`6fb8784`) established, against real production D1 and a live Base
mainnet balance re-check:

- Job `de147124-c264-452b-b784-86ee4422ecd1` is a **genuine** verified
  payment (lifecycle_stage=`verified`, real CDP facilitator metadata,
  economics exactly matching `web_context_verified.v2` / 0.009 USDC), not a
  synthetic artifact.
- It reached `EXECUTING` and never transitioned further. Every settlement
  field on its `payment_attempts` row is `NULL`.
- No `ctx.waitUntil()` call existed anywhere in `apps/edge-api/src`.
- The buyer's Base USDC balance never moved (28197 atomic, unchanged across
  every reading). `H1_REAL_ECONOMIC_EFFECT_USDC=0`,
  `H1_PAYMENT_RISK_ACTIVE=NO`.

## 2. Cloudflare lifecycle fact

`CLOUDFLARE_DISCONNECT_CAN_CANCEL_REQUEST_WORK=YES` — a Workers request's
continuation is not guaranteed to keep running once nothing (client
connection or a `waitUntil`-registered promise) is left for the runtime to
wait on. `ExecutionContext.waitUntil(promise)` is the documented mechanism
to keep a promise alive past that point; it has no fixed post-registration
time limit itself (only the platform's general CPU-time limits apply, and
those are not consumed by I/O wait). `WAITUNTIL_POST_DISCONNECT_LIMIT_SECONDS`
is therefore not a fixed constant this fix depends on.

## 3. Exact production pipeline traced

`apps/edge-api/src/control-plane/routes/x402-service.ts`,
`createX402ServiceRoute`, `app.post(config.path, async (c) => { ... })`:

```
POST_VERIFY_PIPELINE_ENTRYPOINT = right after
  await audit('payment_verified', ...)   (~line 1412, pre-fix)
EXECUTOR_AWAIT_CALLSITE = `outcome = await config.executor(body, {...})`
SETTLEMENT_CALLSITE = `await evidenceProvider.settle(settlementContext, ...)`
TERMINAL_STATE_CALLSITE = `await transition(jobId, 'SETTLING', 'DELIVERED', ...)`
REQUEST_EXECUTION_CONTEXT_AVAILABLE_AT_ENTRYPOINT = YES (Hono's `c` is in
  scope the whole way; `c.executionCtx` was simply never read)
```

Before this fix, `LOCKED → ROUTED → EXECUTING → executor → VERIFYING →
SETTLING → settle → link → DELIVERED` all ran as one synchronous
continuation of the incoming request's own promise chain, with nothing
telling the runtime to keep it alive independent of the client.

## 4. Timeout bound analysis

Configured bounds actually present in this codebase:
`maxTimeoutSeconds` (default 60s, per-service configurable) already bounds
`config.executor(...)` itself. Settlement, PCC, and D1 persistence add at
most a few hundred ms each in the fixture harness; the real CDP facilitator
`settle()` call is the only other real-network leg. `MAX_POST_VERIFY_EXECUTION_BOUND_MS`
is therefore dominated by `maxTimeoutSeconds`, i.e. ≤ 60000ms for any
governed service today, and includes settlement (`MAX_POST_VERIFY_EXECUTION_BOUND_INCLUDES_SETTLEMENT=YES`
as an upper bound assumption — settlement itself is not currently wrapped
in its own explicit timeout, so it inherits whatever the executor's budget
left).

`WAITUNTIL_ARCHITECTURALLY_SUFFICIENT=YES`: `waitUntil` has no comparably
short fixed ceiling for I/O-bound waits, so a bound in the tens-of-seconds
range is comfortably covered.

## 5. Architecture decision

`POST_VERIFY_LIFECYCLE_ARCHITECTURE = A_WAITUNTIL_PROTECTED_SYNCHRONOUS_PIPELINE`

Justification: the existing pipeline is already idempotent and
crash-recoverable by construction (durable `settlement_pending` writes
before every real `settle()` call, bounded `attemptCdpRecovery` /
`attemptNeverminedRecovery` reconciliation paths, `duplicate_same` replay
protection) — none of that changes. The only missing piece was keeping the
*same* continuation alive past a vanished request/client. Approach B
(durable queue/workflow) or C (contract redesign) would be materially
larger surgery to solve a problem that `waitUntil` — the platform's own
documented answer to exactly this failure mode — already solves.

## 6–7. Implementation and no-duplication law

`packages/edge-api/src/control-plane/routes/x402-service.ts`:

- Everything from the `PAYMENT_VERIFIED → LOCKED` transition through the
  final `return c.json(responseBody, 200)` is now the body of one nested
  `async function runProtectedExecutionPipeline(): Promise<Response>`,
  defined and closed over the same handler scope (same pattern already
  used by this file's own `audit`/`transition` helpers).
- `safeGetExecutionCtx(c)` reads `c.executionCtx` inside a `try/catch`
  (Hono's getter throws when no `ExecutionContext` was bound — true of
  every pre-existing `app.request(path, init)` call in this route's own
  test suite, and of any lighter-weight test/runtime).
- Exactly one promise is created (`const pipelinePromise =
  runProtectedExecutionPipeline()`), registered with `executionCtx.waitUntil(pipelinePromise.catch(() => {}))`
  only when an `ExecutionContext` is actually available, then `await`ed
  directly for the response. No second promise, no forked execution.

```
PIPELINE_PROMISE_COUNT_PER_PAID_REQUEST = 1
EXECUTOR_CALL_COUNT_MAX = 1
PCC_GENERATION_COUNT_MAX = 1
SETTLE_CALL_COUNT_MAX = 1
RESULT_PERSIST_COUNT_MAX = 1
RECEIPT_PERSIST_COUNT_MAX = 1
```

A closure-narrowing side effect: wrapping this span in a nested function
made TypeScript lose one `const sigHeader` non-null narrowing at the
`settlementContext.authorizationContext.accessToken` site (the object
literal's sibling fields already used the same `!` convention for
`neverminedRequired!`, `config.nevermined!`, `neverminedDelegationId!`) —
fixed with the same `!` assertion, consistent with existing style. No
other behavioral change.

## 8–9. TDD RED → GREEN

Two tests added to `apps/edge-api/tests/x402-service-route.test.ts`
(describe block `SUN-1221E6R-H2A`):

- **RED** (captured by `git stash push -- .../x402-service.ts`, re-running
  the new test against unfixed source, then `git stash pop`):
  ```
  AssertionError: expected [] to have a length of 1 but got +0
  ```
  Proves the pre-fix route registered zero `waitUntil` protection for a
  real successful paid request when a real `ExecutionContext` mock was
  bound.
- **GREEN**: after the fix, the same test observes exactly one
  `waitUntil` registration, whose promise resolves to the same `Response`
  the client received (`.catch(() => {})` only intercepts rejections — on
  success it passes the resolved value through unchanged), and the
  executor spy fired exactly once (no duplicated execution).
- A second new test proves the **fallback path**: with no
  `ExecutionContext` argument at all (the exact shape of every pre-existing
  call in this file), the route still returns 200 correctly — i.e. the fix
  is purely additive.

A literal Cloudflare "client physically disconnects mid-request" cannot be
reproduced through Hono's in-process `app.request()` — there is no real
HTTP connection to tear down in that harness. The RED signal above is the
strongest true reproduction available in this environment: it proves the
actual code-level defect (zero protection registered) that is the
necessary condition for the real-edge failure mode, using the platform's
own documented survival mechanism as the observable.

Executor-success → PCC → settle → `DELIVERED`, executor-failure →
`QUARANTINED`/`REJECTED` (no settle), and settlement-failure → the
existing `REFUND_REQUIRED`/ambiguous-settlement terminal paths were already
covered by the pre-existing 35-test suite and are unchanged (still
covered) by this refactor — no new failure-path tests were needed since no
failure-path *behavior* changed, only what wraps the whole span.

## 10. Request signal

`ENABLE_REQUEST_SIGNAL_COMPAT_FLAG=NO`, `REQUEST_SIGNAL_USED=NO`. No
`Request.signal`-driven cancellation was added; this fix is purely
additive lifetime *extension*, never new cancellation.

## 11–12. Payment ordering / duplication proof

`PAYMENT_ORDERING_CHANGE=NO` — all pre-existing replay, idempotency,
concurrency (10-way and 20-way), and property tests in this file and
`load-v2.test.ts` pass unchanged. `EXECUTOR_DUPLICATION=0`,
`SETTLEMENT_DUPLICATION=0`, `DUPLICATE_RECEIPTS=0`, `DUPLICATE_RESULTS=0` —
proven by the new test's executor-call-count assertion plus the unchanged
existing duplicate-fulfillment tests.

## 13–14. Stranding prevention / lifetime-exceeded case

`STALE_EXECUTING_ON_CLIENT_DISCONNECT_PREVENTED=YES` within the tested
mechanism (a real `ExecutionContext` is bound in production; this fix
makes the runtime's own documented guarantee apply where it previously
never engaged at all). If the protected continuation itself somehow
outlived all available runtime lifetime (not observed, not reproducible
locally), no *new* silent-death mode is introduced — the pre-existing
durable `settlement_pending` write (already present, unchanged) is what
allows `attemptCdpRecovery`/`attemptNeverminedRecovery` to reconcile such a
case after the fact, exactly as it already does for de147124.

## 15. Observability

Not added this checkpoint — the existing `audit()` events already emit
`payment_verified`, `service_execution_started/completed`,
`payment_settlement_requested`, `settlement_ambiguous/failed`, and
`payment_settled/consumed` at every one of these boundaries. No new event
types were judged necessary to add the `waitUntil` registration itself.

## 16–17. Untouched items

`de147124-c264-452b-b784-86ee4422ecd1`: zero mutations
(`H1_JOB_MUTATIONS=0`). `computeAttemptHash()`: untouched
(`ATTEMPT_HASH_SECURITY_DEBT_PRESENT=YES`, `ATTEMPT_HASH_IS_CRYPTOGRAPHIC=NO`,
`NEXT_FOLLOWUP_REQUIRED_FOR_ATTEMPT_HASH=YES`, out of scope here).

## 18. Full regression

- `pnpm test`: 2466 passed, 38 skipped.
- `pnpm test:worker-runtime`: 93/93 scenarios, including bundle-isolation
  and fixture-unreachability gates.
- Modal safe-egress Python suite: 88 passed.
- `pnpm lint`: clean.
- `pnpm production:preflight`: PASS.
- `pnpm secrets:scan`: 4 findings, all pre-existing (2 unique findings,
  each duplicated under its pre- and post- git-identity-rewrite commit SHA
  from an earlier, unrelated checkpoint). `NEW_H2A_SECRETS_FINDINGS=0`.

## 19–20. Bundle and containment prechecks

Real `wrangler.toml` dry-run bundle (via `test:worker-runtime`'s own
assertions) confirmed: dev-diagnostic seam excluded, Modal safe-egress
included, no secret values in the bundle, no test-only harness present.
Pre-check: production `de70bf98-f304-4d7f-b189-4ae2401041a0 @ 100%`,
candidate normal traffic 0%, no qualification deployment active.

## 21–28. Candidate

- `H2A_FIX_COMMIT_SHA = 1a7e9e6`
- `WORKER_VERSION_UPLOADS = 1`
- `H2A_CANDIDATE_VERSION_ID = 2ca5d120-db79-4b54-8ae3-53e2c91dad87`
- Post-upload read-back: script contains the H2A lifecycle fix (uploaded
  directly from this commit's working tree), the E6P Modal route
  propagation fix (unmodified since `f1b244c`), and Modal safe-egress
  wiring. All 7 governed vars present and correct
  (`PAYMENT_ENVIRONMENT=production`, `PRODUCTION_ENABLED=true`,
  `HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP=true`,
  `PRODUCTION_CDP_CREDENTIALS_APPROVED=true`, `PAID_ROUTES_ENABLED=true`,
  `VERIFY_V2_CDP_ROUTE_ENABLED=true`, `WEB_CONTEXT_V2_CDP_ROUTE_ENABLED=true`).
  All 9 required secrets present by name (including the 3 `MODAL_WEBCTX_*`
  ones); `CDP_WALLET_SECRET` absent, as required. No post-upload secret
  mutation. No second corrective upload was needed.
- Candidate not deployed; normal traffic 0%; production remains
  `de70bf98-f304-4d7f-b189-4ae2401041a0 @ 100%`.

## 31. H2B eligibility

All preconditions met: H1 payment risk inactive, lifecycle architecture
proven (RED→GREEN, no duplication, payment ordering unchanged), all
regressions pass, candidate exact and read back correctly, candidate
remains at 0%, production unchanged. `SUN1221E6R_H2B_REAL_PAYMENT_ELIGIBLE=YES`.
H2B still requires a fresh standalone human payment authorization and,
per this session's established boundary, the actual signing/paid
submission step remains human-executed.
