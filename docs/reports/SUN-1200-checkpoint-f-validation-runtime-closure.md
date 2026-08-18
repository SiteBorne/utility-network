# SUN-1200 Checkpoint F — VALIDATION RUNTIME CLOSURE

Closes the two P0 blockers the checkpoint F incident-2 remediation report
(`SUN-1200-checkpoint-f-mainnet-bootstrap.md`) disclosed but did not fix:
**P0-A** (output-schema verification still did request-time AJV compilation +
runtime fs-based schema loading) and **P0-B** (`verify_agent_output.v2` accepts
a buyer-supplied dynamic schema that cannot use ordinary build-time
precompilation). Commit `d6c0810`.

## P0-A — output-schema precompilation (CLOSED)

**Root finding.** `SchemaVerifier`
(`packages/verification/src/verifiers/schema-verifier.ts`), reached from every
real paid service's post-execution PCC step via
`packages/service-runtime/src/pcc/verify-and-sign.ts`, called
`getAjv().getSchema(schemaId)` — and `getAjv()` (`schema-registry.ts`) built its
single Ajv instance via runtime `readFileSync`/`readdirSync` over
`schemas/common`/`schemas/services`, registering and JIT-compiling every schema
on first use. This is the same request-time-eval class of risk that caused
checkpoint F's second mainnet cutover 500
(`EvalError: Code generation from strings disallowed for this context`) in
`x402-service.ts` — just not yet triggered in production, because no real
settlement has completed end-to-end under the new production payment wiring.

`getSchemasDir()`'s path
(`join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'schemas')`)
is also computed relative to the module's own bundled location, which does not
survive esbuild single-file bundling, and `schemas/` is not declared as a Worker
asset in `wrangler.toml`. Per this checkpoint's own correction: this is **not**
asserted as "`node:fs` doesn't work on Workers" (it does, under this repo's
`nodejs_compat` compatibility flag/date) — classified
`UNPROVEN_BUNDLE_PATH_DEPENDENCY`: an unproven, structurally fragile path
computation, not a blanket capability absence.

**Fix.** Extended the existing
`apps/edge-api/scripts/generate-input-validators.mts` generator (one generator
owns both input and output static schemas, per directive) with
`generateOutputModuleSource()`: loads the same canonical schema set `getAjv()`
loads, with the same Ajv options/meta-schema registration, and emits
AJV-standalone precompiled validators
(`src/generated/output-validators.generated.js`) plus an `outputValidatorsById`
lookup map keyed by each schema's real `$id`.

`schema-registry.ts` gained a module-level override registry
(`setPrecompiledOutputValidators`/`getPrecompiledOutputValidator`), set exactly
once at real Worker module-load time in `paid-services.ts` (mirroring the a2a
executor's already-proven-safe startup-eval pattern — a deliberate, disclosed
low-blast-radius design choice over threading validator injection through the
full `SchemaVerifier`/ `buildStandardVerifiers`/`verify-and-sign.ts` call
chain). `schema-verifier.ts` checks the override first, falling back to the
unchanged `getAjv()` path for every non-Worker caller (local scripts, this
package's own tests — zero behavior change for them). `getOutputSchemaId` now
derives the `$id` statically from this repo's uniform
`https://siteborne.net/schemas/services/<file>` convention instead of a runtime
file read — proven, not assumed, by `schema-registry-precompiled.test.ts`
against every real output schema file's actual committed `$id`.

**Equivalence proof.**
`apps/edge-api/tests/output-validators-generated-equivalence.test.ts` (8 tests)
proves the generated validators agree exactly with a fresh `getAjv()`-based
runtime validator for all 4 output schemas across: a schema-valid representative
`document_evidence_json.v1` PCC output, missing required field, wrong type, an
unexpected/additional property inside a closed extension object, a nested
invalid member, an enum failure, and structural garbage against every known
service_id's output schema.

**Runtime proof.** `wrangler d1 migrations apply siteborne-utility --local` then
`wrangler dev --local`: the real Worker booted cleanly under real `workerd` with
the new `setPrecompiledOutputValidators` wiring at module top level
(paid-services.ts) — zero exceptions in the tail log. An unsigned request to
`/v1/company/evidence-graph` correctly returned the real 402 challenge with no
`PAYMENT-SIGNATURE` constructed and no CDP network call made. **Not proven under
this session:** a full successful-execution-through-output-validation request
under real `workerd` (§16) — `SchemaVerifier` only runs _after_ a real
settlement completes, and this Worker's local `wrangler dev` instance is wired
with the real production CDP facilitator client and real seller wallet
(`wrangler.toml`'s still-uncommitted cutover diff), so driving a request past
settlement here would require either a real financial transaction (prohibited)
or a dedicated test-only deterministic-provider entrypoint, which was not built
in this session (see "Deferred" below).

## P0-B — `verify_agent_output.v2` dynamic schema (DECISION PRESENTED, NOT IMPLEMENTED)

`contracts/releases/1.0.0/schemas/services/agent-verification-input.schema.json`'s
`required_schema` field is `{"type": "object", "additionalProperties": true}` —
completely unconstrained at the contract level: no draft restriction, no
feature-scope limit, no format/`$ref`/size/depth bound anywhere in governing
authority.
`docs/decisions/0039-underspecified-frozen-fields-and-browser-rendered-deferral.md`
confirms this is a deliberate SUN-0600 design decision: `schema_valid` is
explicitly "a real, per-request ajv compile against the buyer-supplied
`required_schema`," not an oversight.

**`VERIFY_DYNAMIC_DECISION = C — CONTRACT_AMBIGUOUS`.** Per this checkpoint's
own explicit instruction ("If B, C or D: DO NOT implement a major architecture
or semantic change automatically... STOP after completing the static-output fix
and present the exact decision"), no further action was taken:
`@cfworker/json-schema` was not evaluated, no differential
JSON-Schema-test-suite corpus was run, no Cloudflare Worker Loader/Dynamic
Worker fallback was designed or implemented. This remains a real, disclosed,
unresolved P0 for `verify_agent_output.v2` specifically — if that route is ever
production-enabled with paid traffic, a buyer-supplied `required_schema` will
still trigger a request-time `ajv.compile()`, and per the bundle audit below,
that specific call site has no request-time-eval safety net.

## Production bundle re-audit (execution-reachability, not textual presence)

`wrangler deploy --dry-run --outdir /tmp/bundle-audit-p0a` (172,399-line single
bundle). `grep -c "new Function("` → **1**; bare `eval(` → **0**. Every
`.compile(`/`new Ajv` call site was traced individually:

| Location                                                                                                                                      | Classification                                                                                                                                  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AJV's own internal `_compile` (the sole `new Function(` occurrence)                                                                           | Library-internal, reachable only via the call sites below                                                                                       | Not itself a call site                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `packages/protocol-a2a/src/executor.ts` module top level                                                                                      | `STARTUP_ONLY_ALLOWED`                                                                                                                          | Unchanged, untouched, real `/a2a` route already proves this safe empirically. Per directive §20, not modified.                                                                                                                                                                                                                                                                                                                                                              |
| `service-runtime/agent-verification/service.ts` (`ajv2.compile(input.required_schema)`)                                                       | `REQUEST_RUNTIME`, **P0-B**, unresolved by design (see above)                                                                                   | Buyer-controlled schema; no try/catch around the compile in this call site                                                                                                                                                                                                                                                                                                                                                                                                  |
| `packages/verification/src/schema-registry.ts` (`getAjv()`)                                                                                   | `REQUEST_RUNTIME` path now **bypassed** for the real Worker via the P0-A override registry; still the real behavior for every non-Worker caller | Fixed this checkpoint                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `x402-service.ts` input schema compile                                                                                                        | Fixed in the prior checkpoint-F commit (`572c2bd`/`bcf7cd7`)                                                                                    | Not reachable at request time any more                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `@x402/extensions/payment-identifier`'s `validatePaymentIdentifier` (`ajv.compile(ext.schema)`)                                               | `REQUEST_RUNTIME`, **newly identified this audit**, third-party dependency, buyer-suppliable `schema` field on the Payment-Identifier extension | **Self-contained**: the library wraps its own `ajv.compile`/`validate` call in a `try/catch` and converts any exception (including a real Workers `EvalError`) into a normal `{valid: false, errors: [...]}` result, which `parsePaymentIdentifier` reports as `status: 'malformed'`. Confirmed by reading the vendored source directly (`node_modules/@x402/extensions/dist/cjs/payment-identifier/index.js`) — not a crash risk, not touched, disclosed for completeness. |
| `zod@4.4.3`'s internal JIT codegen (`const F = Function; ... new F(...)`, used pervasively across this repo's request-time schema validation) | Initially flagged by execution-reachability audit; **confirmed non-blocking**                                                                   | Zod's own `allowsEval` runtime probe (`node_modules/zod/v4/core/util.js`) explicitly detects the Cloudflare Workers `navigator` global and self-disables its JIT fastpath before ever attempting `new Function`, falling back to its slow, eval-free interpreted parser. This is exactly why this textually-invisible-to-`grep "new Function("` call site never surfaced as an incident despite being on the hot path of nearly every request.                              |

**`PRODUCTION_BUNDLE_REQUEST_RUNTIME_EVAL_BLOCKERS` (uncaught, crash-causing,
request-reachable): zero**, after this checkpoint's fix — with the one
disclosed, by-design exception of P0-B's `verify_agent_output.v2` dynamic
schema, which remains open per the CONTRACT_AMBIGUOUS decision above.

## Regression

- `pnpm schemas:check` — pass (both generated files up to date).
- `pnpm secrets:scan` — pass, no leaks.
- `pnpm check` (full monorepo gate: format, lint, typecheck, all unit/
  integration tests, PCC/services/OpenAPI/contracts/migrations/D1/
  control-plane/adapters/document-worker/verification/services-runtime/
  x402/mcp/a2a/nevermined checks, secrets scan) — **exit 0**.
- `pnpm security:release` (semgrep, OSV-Scanner, Trivy, Schemathesis, chaos,
  load) — **all green**: semgrep 0 findings; OSV 0 critical; Trivy 0 blocking
  critical/high vulnerabilities, 0 misconfigurations; Schemathesis 1512/1512
  generated cases passed; chaos 18/18; load 7/7.

## Production state (read-only reconciliation)

- `wrangler versions list` / `wrangler deployments list`: current deployment is
  **100% `a4ada936-a434-4522-a8af-41c57170f4e4`** (the disabled/rollback-safe
  version) — unchanged from the last checkpoint-F rollback. No version upload,
  no deploy performed this session.
- `GET /` → 200. `GET /.well-known/agent-card.json` → 200.
  `POST /v1/company/evidence-graph` (unsigned) → **404** — the paid payment
  surface remains structurally disabled in production, exactly as expected.

## Deferred (honestly disclosed, not fabricated as complete)

- **Automated `test:worker-runtime` harness (§14)** — an isolated, scripted
  `wrangler dev --local` lifecycle (temp D1 state, migrate, boot, synthetic
  requests, teardown) was **not built** this session. Manual
  `wrangler dev --local` runs were used instead (same pattern that caught and
  proved the original incident-2 fix), which is real, reproducible evidence but
  not yet CI-wired automation.
- **Full successful-execution-through-output-validation proof under real
  `workerd` (§16)** — not performed. Doing this safely requires a dedicated
  test-only entrypoint with injected deterministic providers (no production-only
  backdoor shipped in the real artifact); the currently-running local
  `wrangler dev` instance is wired with real production CDP credentials and the
  real seller wallet, so driving a request past real settlement there risks an
  actual financial transaction — categorically out of bounds. Only the
  pre-settlement 402 challenge was exercised.
- **Durable release-invariant / CI gate (§21)** — not added. No automated gate
  yet blocks a future production version upload on
  `test:worker-runtime`/successful-execution-through-output-validation passing,
  because neither of those checks exists as automation yet.

None of the above blocks P0-A's correctness (proven via differential equivalence
tests + manual real-`workerd` startup/402 proof + full
`pnpm check`/`pnpm security:release` regression); they are scope not completed
in this pass and must not be read as done.

## Standing hard boundaries (unchanged, still in effect)

No version upload. No deploy. No paid routes enabled beyond the already-existing
local `wrangler.toml` diff (still uncommitted, still never deployed). No
`PAYMENT-SIGNATURE` constructed. No settlement, no transaction, at any point in
this session. **Do not authorize another candidate upload from this checkpoint's
work alone** — P0-B remains open by design, and §14/§16/§21 remain genuinely
unfinished.
