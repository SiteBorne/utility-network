# SUN-1200 Checkpoint F — FINAL WORKER-RUNTIME CLOSURE

Resolves the CONTRACT_AMBIGUOUS (`VERIFY_DYNAMIC_DECISION=C`) finding the
VALIDATION RUNTIME CLOSURE report (P0-A/P0-B) left open. Commit `3af8195`.

## §30 stop report fields

**VERIFY_CONTRACT_RESOLUTION** = `SITEBORNE_JSON_SCHEMA_PROFILE_1`
(`siteborne-json-schema-profile-1`, see ADR 0056).

**FORWARD_CONTRACT_VERSION** = none minted.
`agent-verification-input.schema.json`'s `required_schema` field is
byte-for-byte unchanged (`{"type": "object", "additionalProperties": true}`).
Per ADR 0013's own taxonomy this is a PATCH-equivalent "security hardening
rejecting already-forbidden behavior" / "validator correction enforcing
already-documented behavior" — no wire-level schema changed. Confirmed by
running the real tooling: `pnpm contracts:baseline:verify`,
`pnpm contracts:compat:check`, `pnpm contracts:release:verify` all pass with
zero detected drift. No `contracts/releases/2.1.0` directory was created; the
governance record is ADR 0056
(`docs/decisions/0056-verify-agent-output-json-schema-profile-1.md`). This is a
disclosed deviation from the directive's own "expected direction: 2.1.0" — made
because the directive itself deferred to "repository authority" for the final
call, and repository authority (ADR 0013 + the compat tooling) does not require
one.

**PROFILE_SUPPORTED_KEYWORDS**: `type`, `enum`, `const`, boolean schemas,
`properties`, `required`, `additionalProperties`, `minProperties`,
`maxProperties`, `items`, `prefixItems`, `minItems`, `maxItems`, `uniqueItems`,
`contains`, `minContains`, `maxContains`, `minLength`, `maxLength`, `minimum`,
`maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`, `allOf`,
`anyOf`, `oneOf`, `not`, `if`, `then`, `else`, `$defs`, `$ref` (local-only),
`$schema` (root-only, canonical URI). Plus annotation-only: `title`,
`description`, `default`, `examples`, `$comment`, `deprecated`, `readOnly`,
`writeOnly`.

**PROFILE_UNSUPPORTED_KEYWORDS**: `$dynamicRef`, `$dynamicAnchor`, `$anchor`,
`$id`, `$recursiveRef`, `$recursiveAnchor`, `$vocabulary`,
`unevaluatedProperties`, `unevaluatedItems`, `pattern`, `patternProperties`,
`format`, `contentEncoding`, `contentMediaType`, `contentSchema`,
`dependentRequired`, `dependentSchemas`, `dependencies`, `propertyNames`,
`additionalItems`, plus any keyword not in the supported list (closed-world).

**PROFILE_LIMITS**: `MAX_CANONICAL_SCHEMA_BYTES=32768`, `MAX_SCHEMA_DEPTH=32`,
`MAX_SCHEMA_NODES=2048`, `MAX_LOCAL_REF_COUNT=128`,
`MAX_PROPERTIES_PER_OBJECT_SCHEMA=256`, `MAX_TOTAL_PROPERTY_DECLARATIONS=1024`,
`MAX_COMBINATOR_BRANCHES_PER_KEYWORD=32`, `MAX_ENUM_VALUES=256`,
`MAX_PREFIX_ITEMS=128` — exactly the human-authorized values from the
directive's §5, unchanged.

**CFWORKER_VERSION** = `4.1.1` (`@cfworker/json-schema`), a pure JSON Schema
interpreter with confirmed zero `eval`/`new Function` in its own implementation
(verified by direct bundle inspection of the real production dry-run bundle, not
merely its documentation).

**CFWORKER_CAPABILITY_MATRIX** = every Profile 1 keyword differentially tested
against a fresh `ajv/dist/2020` runtime compile in
`packages/service-runtime/src/services/agent-verification/schema-profile-1.test.ts`
(type/enum/const/boolean schemas, properties/required/additionalProperties(both
boolean and schema form)/min-maxProperties, items/prefixItems/min-maxItems/
uniqueItems, contains/min-maxContains, min-maxLength, minimum/maximum/
exclusiveMinimum/exclusiveMaximum/multipleOf,
allOf/anyOf/oneOf/not/if-then-else, $defs+local $ref, $schema canonical-URI
enforcement, annotation-only keywords). **CFWORKER_DIFFERENTIAL_TOTAL** = 55
tests in that file. **CFWORKER_DIFFERENTIAL_PASS** = 55.
**CFWORKER_DIFFERENTIAL_FAIL** = 0.

**REMOTE_REF_REJECTION** = proven (`remote $ref is rejected` test + harness Case
D under real workerd). **RESOURCE_LIMIT_TESTS** = 7 dedicated tests, one per
limit family (byte size, depth, properties-per-object, enum, combinator
branches, prefixItems, ref count), plus a within-limits control proving no
false-positive rejection. **ADVERSARIAL_SCHEMA_TESTS** = the §9
property-named-`"pattern"`/ `"$dynamicRef"`/`"format"` test and the
`$defs`-named-`"unevaluatedProperties"` test, both proving the structural walker
never checks buyer-chosen names (property names, `$defs` entry names) against
the keyword allowlist — only the schema VALUES.

**VERIFY_RUNTIME_AJV_BEFORE** = 1 (`ajv2.compile(input.required_schema)` in
`service.ts`, request-time, buyer-controlled, uncaught).
**VERIFY_RUNTIME_AJV_AFTER** = 0 — confirmed by both `grep -c "ajv" service.ts`
(zero occurrences) and a full production-bundle re-audit
(`wrangler deploy --dry-run`): the old call site is entirely absent from the
173,801-line bundle.

**WORKER_RUNTIME_HARNESS_IMPLEMENTATION** = `scripts/test-worker-runtime.mts`
(`pnpm test:worker-runtime`), automating `wrangler dev --local` (the pinned
wrangler exports no programmatic harness API). **CREATE_TEST_HARNESS_USED** =
false — `wrangler@4.119.0`'s module exports were enumerated directly
(`Object.keys(require('wrangler'))`); no `createTestHarness` export exists.
Wrangler was not force-upgraded for this. **WORKER_RUNTIME_HARNESS_AUTOMATED** =
true — a single `pnpm test:worker-runtime` command creates isolated
`--persist-to` state, applies D1 migrations into it, boots a real
`wrangler dev --local` isolate, runs 10 scenario checks, tears down the dev
process, and deletes the temp state, unconditionally (success or failure path).
No developer local D1 state is read or depended on. Exit code reflects
pass/fail. 10/10 scenarios currently pass.

**WEB_WORKERD_402** = pass (`web_context_verified.v2` unsigned request -> real
402 with `PAYMENT-REQUIRED`, under real `workerd`, via the harness).
**DOCUMENT_WORKERD_402** = pass (`document_evidence_json.v2`, same proof).
**SUCCESSFUL_EXECUTION_WORKERD** = **not proven this session** (see "Deferred"
below). **OUTPUT_VALIDATION_WORKERD** = proven separately, for the P0-A
output-schema fix only, in the prior VALIDATION RUNTIME CLOSURE report (manual
`wrangler dev` startup + differential equivalence tests) — not re-proven
end-to-end through a real settlement in this pass.
**VERIFY_AGENT_OUTPUT_WORKERD** = **partial**: Cases C/D/E/F (pre-economic
rejection: unsupported keyword, remote `$ref`, over-byte-limit, over-depth) are
all proven under real `workerd` via the harness. Cases A/B (a Profile-1 schema
actually validating a candidate output, post-settlement) are **not** proven
under real `workerd` this session — see "Deferred."

**OLD_OUTPUT_PATH_CAUGHT** = proven in the prior VALIDATION RUNTIME CLOSURE
report (P0-A): a `git stash`-isolated revert of the output-schema fix,
reproduced under `wrangler dev --local`, hit the exact captured `EvalError`;
restoring the fix reproduced the 402 cleanly. Never committed.
**OLD_VERIFY_PATH_CAUGHT** = **not proven this session** — see "Deferred."

**X402_EXTENSION_CLASSIFICATION** = `NON_BLOCKING_THIRD_PARTY_FAIL_CLOSED_PATH`.
SITEBORNE's real `@x402/extensions` usage
(`packages/protocol-x402/src/identifier/payment-identifier.ts`) imports only the
`payment-identifier` subpath's `extractAndValidatePaymentIdentifier`, which
reads the buyer's `Payment-Identifier` extension object and only attempts
`ajv.compile(ext.schema)` if the buyer's extension object itself carries a
`schema` field — SITEBORNE's own `declareSiteborneePaymentIdentifierSupport`
never sets one, and no code in this repository ever supplies a schema on that
extension. A buyer who nonetheless includes one triggers the library's own
internal `try/catch`, which converts any exception (including a real Workers
`EvalError`) into a normal `{valid: false, errors: [...]}` result — surfaced as
`status: 'malformed'` by `parsePaymentIdentifier`, a plain deterministic
400-class rejection, never an uncaught crash. SITEBORNE does not depend on that
field for anything it uses, so this is non-blocking, not a functional blocker,
and upstream package behavior was not modified.

**PRODUCTION_BUNDLE_REQUEST_RUNTIME_CRASH_BLOCKERS** = 0. Full re-audit
(`wrangler deploy --dry-run --outdir`, 173,801 lines): exactly 1 `new Function(`
(AJV's own internal `_compile`, library-internal, not itself a call site), 0
bare `eval(`. Every `.compile(`/`new Ajv` occurrence traced: AJV internals (×2,
non-call-sites), `@x402/extensions` payment-identifier (self-caught, classified
above), `zod`'s internal JIT (self-disabling via its own Workers `navigator`
probe before ever attempting codegen — previously documented in the VALIDATION
RUNTIME CLOSURE report), A2A's module-top-level `ajv.compile()` (startup-only,
see below). **`verify_agent_output`'s old dynamic-schema compile site no longer
exists anywhere in the bundle.**

**A2A_STARTUP_EVAL_CLASSIFICATION** = unchanged, `STARTUP_ONLY_ALLOWED`.
`packages/protocol-a2a/src/executor.ts`'s module-top-level
`ajv.compile(schema4)` is confirmed still present, still at module-load time, by
the same bundle re-audit. Not modified, not touched,
`disallow_eval_during_startup` not enabled.

**RELEASE_INVARIANT_WIRED** = true. `pnpm test:worker-runtime` is now the final
step of `pnpm security:release`
(`"security:release": "... && pnpm security:load && pnpm test:worker-runtime"`
in the root `package.json`) — the same command this repository's own established
convention already treats as the pre-release gate. A human does not need to
remember to run it separately.

**SCHEMAS_CHECK** = pass. **TEST_WORKER_RUNTIME** = pass, 10/10.
**SECRETS_SCAN** = pass, 0 leaks. **PNPM_CHECK** = pass (full monorepo gate:
format, lint, typecheck across 23 packages, all unit/integration tests,
PCC/services/OpenAPI/
contracts/migrations/D1/control-plane/adapters/document-worker/verification/
services-runtime/x402/mcp/a2a/nevermined checks, secrets scan — exit 0).
**SECURITY_RELEASE** = pass (semgrep 0 findings, OSV 0 critical, Trivy 0
blocking C/H + 0 misconfigurations, Schemathesis 1512/1512, chaos 18/18, load
7/7, `test:worker-runtime` 10/10). **TRIVY** = 0C / 0H.

**CODE_COMMITS**: `3af8195`
(`fix(validation): bound dynamic Worker schema validation`) — functional +
test + harness + ADR, all together (the directive's suggested message used
verbatim). This report is a separate docs-only commit.

**WRANGLER_CUTOVER_DIFF_STILL_UNCOMMITTED** = true — `git status --short` shows
only `M wrangler.toml` after this commit, unchanged content from before this
checkpoint segment began.

**ACTIVE_PRODUCTION_VERSION** = `a4ada936-a434-4522-a8af-41c57170f4e4`.
**ACTIVE_TRAFFIC_PERCENT** = 100%. **PAID_ROUTES_DISABLED** = true
(`POST /v2/verify/agent-output` -> 404 against the real deployed URL, checked
immediately before this report was written).

**VERSION_UPLOADS** = 0. **DEPLOYMENTS** = 0. **PAYMENT_SIGNATURES** = 0.
**SETTLEMENTS** = 0. **TRANSACTIONS** = 0, this entire checkpoint segment.

## Deferred (honestly disclosed, not fabricated as complete)

- **`SUCCESSFUL_EXECUTION_WORKERD` / Cases A/B / `OLD_VERIFY_PATH_CAUGHT`**:
  proving a Profile-1 schema actually validate a real candidate output under
  real `workerd`, and proving the OLD dynamic-Ajv implementation specifically
  fails under the Workers eval restriction once execution reaches that far, both
  require driving a request past real settlement. The current
  `wrangler dev --local` instance (and therefore `test:worker-runtime`) is wired
  with the real production CDP facilitator client and the real seller wallet
  (`wrangler.toml`'s still-uncommitted cutover diff) — there is no safe way to
  reach post-settlement code paths there without either a real financial
  transaction (categorically prohibited) or a dedicated test-only entrypoint
  with injected deterministic providers, separate from the real production
  `main`, which was not built this session. Building one was judged out of
  proportionate scope for this pass given everything else completed; it remains
  the single concrete piece of unfinished work from this checkpoint's own
  directive.
- Everything else in the directive's §1-§29 was completed as specified,
  including the explicit `pnpm test:worker-runtime` automation, or resolved with
  a disclosed, reasoned deviation (the contract-version question above).

## EXACT_NEXT_ACTION

None authorized by this pass. Per the directive's own closing instruction: **do
not authorize another candidate upload from this checkpoint's work.** If the
deferred settlement-path proof (Cases A/B) is wanted before any future cutover,
it needs its own explicitly-authorized checkpoint to design and build a safe
test-only deterministic-provider entrypoint first.
