# SUN-1200 Checkpoint F — Human-Authorized Mainnet Bootstrap (incident + remediation)

**Starting HEAD:** `87d1b55` **Classification:** capability complete, production
not activated — `SUN-1200` remains `BLOCKED_EXTERNAL — MARKET_DEMAND`. **No
bootstrap payment has occurred.** This checkpoint documents two real cutover
attempts, both rolled back, and the remediation that followed the second.

## ADR 0055 post-bootstrap classification

Read literally, not inferred: **A — SINGLE_BOOTSTRAP_THEN_DISABLE.** Condition
10 states "this ADR authorizes exactly one bounded action, not an ongoing
exception"; the frozen interpretation section states `EXECUTABLE_VERIFIED`
remains `false` after any bootstrap action; the Consequences section states "No
production mutation, payment, or transaction is authorized by this ADR itself."
There is no textual basis for a supervised window or continuous production —
both are directly contradicted by condition 10.

## Credential residual-risk acceptance

The user explicitly authorized reusing the existing, previously-exposed CDP
Secret API Key for this bounded bootstrap rather than rotating it first:

```
USER_APPROVES_REUSED_CDP_KEY_FOR_BOUNDED_MAINNET_BOOTSTRAP=true
CDP_CREDENTIAL_ROTATION_COMPLETED=false
CREDENTIAL_EXPOSURE_REMEDIATED=false
```

Explicit residual-risk acceptance, not remediation — recorded as such, not
misrepresented.

## Seller reconciliation

`0x7f44a2dd237938F18632d4CcA40f4c690295E6E1` confirmed as the canonical
seller/`payTo` via real, read-only `cdp.evm.getAccount`/`cdp.evm.listAccounts`
calls (performed by the user; this agent has no credential access). Reused
directly from Checkpoint E's own reconciliation — unchanged this checkpoint.

## Buyer preflight

Controlled buyer `0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99` (distinct from
seller, previously confirmed as the historical controlled test payer). Real,
read-only Base-mainnet `balanceOf`/`getBalance` calls (no credentials needed —
public RPC): initial balance 0 atomic USDC (insufficient, checkpoint stopped per
its own rule); after the user funded it, 13260 atomic native USDC
(0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913) — sufficient against the 9000
atomic bootstrap amount. ETH balance 0.00001 (irrelevant for the `exact` scheme:
the buyer only signs an off-chain EIP-3009 authorization; the CDP facilitator
broadcasts and pays gas).

## Cutover attempt 1

`wrangler.toml` cutover diff (5 non-secret vars) applied locally, verified exact
via `git diff`, all local gates green, version
`ea5bffed-ce0d-48f0-9eb1-747056166f35` deployed at 100%. First unsigned request
to `web_context_verified.v2` returned **HTTP 500**, not a 402. Rolled back
immediately to `a4ada936-a434-4522-a8af-41c57170f4e4`, confirmed restored.
**Zero payment signatures, zero settlements, zero transactions.**

Initial hypothesis (ambient `process.env` unavailable) was investigated and
**rejected** on further evidence: `nodejs_compat_populate_process_env` is
enabled by default for compatibility dates ≥ 2025-04-01 (confirmed via two
independent Cloudflare documentation fetches) and explicitly includes secrets —
the failed version's compatibility date (2026-08-05) was well past that
threshold. **Root cause classification: B —
AMBIENT_PROCESS_ENV_SHOULD_HAVE_BEEN_AVAILABLE.** The explicit-credential-
binding fix (commit `572c2bd`, made and proven correct in isolation) was
retained regardless — consuming a declared `Env` dependency explicitly is
correct architecture independent of the open question — but a second candidate
built on that fix alone was **not sufficient**.

## Cutover attempt 2

Candidate `70ffa517-d926-4f01-814d-12bf8788a896` (containing the credential-
binding fix) deployed at 100%, all pre-checks green. The unsigned
`web_context_verified.v2` request **again returned HTTP 500.** Live
`wrangler tail` log capture, started before the request per the directive's own
instruction, captured the real exception:

```
Error compiling schema, function code: ...
EvalError: Code generation from strings disallowed for this context
```

**SECOND_CUTOVER_FAILURE_CONFIRMED=true**,
**SECOND_FAILURE_CLASSIFICATION=WORKERS_RUNTIME_DYNAMIC_CODE_GENERATION_VIOLATION**,
**SECOND_FAILURE_COMPONENT=AJV schema compiler**,
**SECOND_FAILURE_OPERATION=request-time schema compilation**,
**SECOND_FAILURE_HTTP_STATUS=500**. Rolled back immediately to
`a4ada936-a434-4522-a8af-41c57170f4e4`, confirmed restored (an initial
propagation-lag 500 window resolved to a consistent 404 after ~15s — verified
with 5 consecutive checks). **This is a genuinely separate incident from attempt
1** — not conflated: the credential-binding fix is unrelated to schema
compilation, and neither incident's root cause explains the other.

## Exact AJV call path (traced)

Unsigned request → outer Worker router (`index.ts`, cached-on-first-request
`buildPaidServicesApp`) → `createX402ServiceRoute` (`x402-service.ts:361-362`,
**before this fix**) →
`new Ajv2020({strict:false}).compile(config.inputSchema)`. Because
`buildPaidServicesApp` is only constructed lazily, the first time a given paid
route is reached in a Worker isolate's lifetime, this compilation happened
**during request handling**, not true Worker startup — and real Cloudflare
Workers reject dynamic code generation (`new Function(...)`, which AJV's
`.compile()` uses internally) specifically during request handling, while
permitting it during startup (module top-level evaluation) — confirmed directly
against current Cloudflare documentation. `config.inputSchema` is always exactly
one of `BUNDLED_SERVICE_INPUT_SCHEMAS`'s four unique, frozen, build-time-known
schemas (never per-request data) — genuinely precompilable.

### Full production-Worker Ajv occurrence audit

| File                                                                                                                        | Call                                                                                                                                                                                                  | Classification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/edge-api/src/control-plane/routes/x402-service.ts`                                                                    | `new Ajv2020().compile(config.inputSchema)`                                                                                                                                                           | **REQUEST_RUNTIME — the confirmed cause. Fixed this checkpoint.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `packages/protocol-a2a/src/executor.ts`                                                                                     | `new Ajv2020(...)` + `.compile()` at module top level                                                                                                                                                 | STARTUP_ONLY — proven safe empirically (the real deployed `/a2a` route has returned correct responses throughout this entire session); genuinely fine under Workers' startup-eval allowance. Not touched.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `packages/service-runtime/src/services/agent-verification/service.ts`                                                       | `ajv.compile(input.required_schema)`                                                                                                                                                                  | REQUEST_RUNTIME, but **structurally unprecompilable** — `required_schema` is genuine buyer-supplied per-request data for `verify_agent_output`, not a static repository artifact. **Not fixed this checkpoint — flagged as an open risk below, per the directive's own §7 instruction to report rather than paper over.**                                                                                                                                                                                                                                                                                                                                |
| `packages/verification/src/schema-registry.ts` (`getAjv()`)                                                                 | `ajv.addSchema(...)` + lazy compile on first `ajv.getSchema(id)` via `schema-verifier.ts`, reached from `verify-and-sign.ts` — the shared post-execution step **every one of the four services** runs | REQUEST_RUNTIME, reachable on the **first successful execution of any service** in a Worker isolate. **Not fixed this checkpoint.** Also uses `node:fs.readFileSync`/`readdirSync` to load schema files from a `schemas/` directory at runtime — Cloudflare Workers have no real filesystem for arbitrary reads not explicitly bundled, so this is very likely **also broken for an entirely separate reason**, independent of the eval restriction. **Flagged as a second, P0, unresolved risk below — this is structurally fixable the same way as the input-schema fix (output schemas are equally static/frozen), but that work has not been done.** |
| `packages/protocol-mcp/src/frozen-contracts.test.ts`, `packages/protocol-x402/src/bazaar/{roundtrip,frozen-inputs}.test.ts` | `new Ajv(...)`                                                                                                                                                                                        | Test-only files, never part of any deployed bundle.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

**⚠️ Neither of the two flagged, unfixed risks above has ever actually been
exercised in a real deployed Worker** — no real payment has ever settled
successfully against this repository's production deployment, and
`verify_agent_output` has never been reached in production either. They are
disclosed as structural risks discovered during this audit, not as proven
incidents (unlike the `x402-service.ts` cause, which is directly evidenced by
two live 500 responses and a captured exception).

## Remediation implemented

`apps/edge-api/scripts/generate-input-validators.mts` (new): generates
standalone, pre-compiled AJV validator functions at **build time** from the four
unique `BUNDLED_SERVICE_INPUT_SCHEMAS`, via `ajv/dist/standalone`. Output:
`apps/edge-api/src/generated/input-validators.generated.js` (machine- generated,
never hand-edited, excluded from Prettier/ESLint), keyed by schema `$id`.
`x402-service.ts` now looks up the precompiled validator by
`config.inputSchema.$id` instead of calling `Ajv.compile()` at all — **zero
runtime AJV construction/compilation on the real paid-route request path.**
Fails closed at construction time (same discipline as every other
construction-time check in this function) if a caller ever supplies a schema
with no precompiled entry and no explicit `config.inputValidator` (a new,
deliberately explicit, test-only escape hatch — real production callers never
set it; only ad-hoc test schemas unrelated to any real service use it).

`pnpm generate:input-validators` / `pnpm schemas:generate` (regenerate) and
`pnpm generate:input-validators:check` / `pnpm schemas:check` (drift check —
regenerates in memory and byte-compares against the committed file) — wired into
root `pnpm check`. A stale generated validator now fails `pnpm check`.

## Schema-equivalence proof

`apps/edge-api/tests/input-validators-generated-equivalence.test.ts` (21 tests):
for every one of the four frozen input schemas, a battery of valid and invalid
payloads (missing required fields, wrong primitive types, pattern/format
violations, `additionalProperties` violations, non-object payloads) is run
through both a fresh runtime `new Ajv2020().compile(schema)` validator and the
generated standalone validator — both must agree on every case. All pass.

## Real-runtime proof (real workerd, real bundler)

An automated `@cloudflare/vitest-pool-workers`-based regression suite was built
(`apps/edge-api/vitest.workerd.config.ts`,
`apps/edge-api/wrangler.workerd-test.toml`,
`apps/edge-api/tests/workerd/input-schema-validation.workerd-test.ts`) — this
genuinely executes inside real `workerd` via Miniflare, unlike every other test
file in this repository (which call `app.request(...)` as a plain in-process
Hono fetch handler in Node.js/V8, never inside an actual Workers isolate —
exactly why ~600 existing tests never caught this incident). **This suite is
currently blocked by a real, identified third-party tooling limitation**, not by
anything about the fix: the newest `@cloudflare/vitest-pool-workers` release
compatible with this repository's pinned `vitest@3.2.7` (`0.12.0` — every
version ≥0.13.0 requires `vitest@^4.1.0`, a repo-wide upgrade out of scope here)
has its own Miniflare module loader hit a CJS/ESM interop bug on AJV's internal
`require("./refs/data.json")` (`SyntaxError: Unexpected token ':'`), independent
of and unrelated to the actual production defect. **Not wired into
`pnpm check`** (it does not currently pass) — kept as real, valuable,
partially-working infrastructure for a future session once vitest is upgraded,
with an honest doc comment explaining the blocker.

**In its place, direct verification via `wrangler dev --local`** — the exact
same bundler and real `workerd` binary the actual
`wrangler deploy`/`versions upload` pipeline uses, sidestepping
vitest-pool-workers' tooling entirely:

- **Old code** (`git stash` of just this checkpoint's `x402-service.ts` change,
  isolating the test to only this one fix): unsigned `web_context_verified.v2`
  request → **HTTP 500**, with the exact same captured exception as the live
  incident (`Error compiling schema, function code: ...`) — the failure
  reproduces deterministically outside of production too.
- **Fixed code** (restored): the same request → **HTTP 402**, correct
  `payTo`/`amount`/network fields. `document_evidence_json.v2` → 402, `upto`
  scheme. A malformed request (missing required field) → 400, not 500 — the
  standalone validator correctly rejects invalid input too. `/health`
  unaffected.

This is real, reproducible, fail-then-pass evidence against the genuine runtime
restriction that caused both live incidents.

## Production bundle audit

`wrangler deploy --dry-run --outdir` on the real committed source: **one**
`new Function(` occurrence in the entire 162,310-line bundle, **zero** bare
`eval(`. Traced to AJV's own internal `_compile` machinery — reachable only via
the two flagged, unfixed risks above (`verify_agent_output`'s dynamic schema,
and output-schema verification), never via the incident's actual cause
(`x402-service.ts`'s input-schema compile), which is now completely eliminated
from the bundle's reachable request path.

## Startup-eval flag assessment

`allow_eval_during_startup` is Workers' **implicit default** (no explicit flag
needed) — confirmed directly against Cloudflare documentation: `eval`/
`new Function` are permitted during Worker startup (module top-level evaluation)
and forbidden during request processing. **Not safe to enable
`disallow_eval_during_startup`** right now: `protocol-a2a/executor.ts` still has
a legitimate, real, module-top-level Ajv compile that this hardening flag would
break. Recorded as optional future hardening, contingent on that startup path
also being precompiled — not attempted this checkpoint.

## Security regression

`pnpm check` (format, lint, typecheck, full test suite including the new
schema-equivalence suite, `schemas:check` drift check, contracts,
governance/state/tasks validate, secrets:scan) and `pnpm security:release`
(Semgrep 0, OSV critical=0, Trivy 0C/0H, Chaos, Load) both green after the
remediation — including the new `@cloudflare/vitest-pool-workers`/`workerd`/
`esbuild`/`sharp` dev dependencies this checkpoint introduced.

## Economic / customer truth

`PAYMENT_SIGNATURES_CREATED=0`, `BUYER_SIGNATURES_CREATED=0`,
`CDP_SETTLEMENTS=0`, `SUCCESSFUL_ECONOMIC_SETTLEMENTS=0`,
`PRODUCTION_TRANSACTIONS=0`, `CONTROLLED_BOOTSTRAP_PAYMENTS=0`,
`NEVERMINED_CALLS=0` throughout every attempt this checkpoint. No customer,
market-demand, or revenue evidence increment of any kind.

## Post-bootstrap production state

No bootstrap payment ever occurred — this checkpoint's classification question
(§15's A/B/C branching) does not yet apply; it becomes relevant only once a
bootstrap payment actually succeeds. Active production version:
`a4ada936-a434-4522-a8af-41c57170f4e4` @ 100% (Checkpoint E's disabled state,
unchanged). Paid routes: structural 404. Nevermined:
`BLOCKED_EXTERNAL_PROVIDER`, unaffected, zero calls throughout.

## Remaining blockers before any further cutover attempt

1. **P0 — output-schema verification** (`schema-registry.ts`/
   `verify-and-sign.ts`, reached after every real service execution for all four
   services): same request-time AJV compilation risk as the fixed input-schema
   case, PLUS a likely-separate `node:fs` reachability problem in a real Worker
   bundle. Structurally fixable the same way (AJV standalone precompilation of
   the frozen output schemas); not done this checkpoint.
2. **Disclosed, structurally unfixable** — `verify_agent_output`'s buyer-
   supplied `required_schema` genuinely cannot be precompiled; needs its own
   design decision (e.g., a bounded/sandboxed runtime validation strategy, or
   accepting this service specifically stays request-time-compiled with some
   other mitigation) before this service can safely reach production.
3. Real CDP credential rotation (explicitly deferred, not remediation).
4. A fresh candidate build incorporating fix #1 above, re-proven the same way
   this checkpoint proved fix #0 (`wrangler dev` fail-then-pass, ideally also
   the blocked `workerd` vitest suite once vitest is upgraded).
5. Re-run the full bounded cutover sequence from Checkpoint F's own §1 onward
   once 1-4 are satisfied.
