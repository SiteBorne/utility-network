# Implementation Plan: `verify_agent_output.v2` / CDP Production Execution Composition

Derived from the approved design:
[2026-08-22-verify-v2-cdp-production-execution-composition-design.md](../specs/2026-08-22-verify-v2-cdp-production-execution-composition-design.md).
SUN-1214. TDD-first. Every task: failing test -> minimal implementation ->
passing test -> neighboring regression -> commit.

Interfaces below were read directly from current source, not assumed:

- `RegisteredService.productionEnabled` is **typed as the literal `false`**
  (`packages/service-runtime/src/registry.ts`) and `ServiceRegistry.register`
  throws if it isn't exactly `false` ("production activation is out of SUN-0600
  scope"). This is a permanently-scoped, unrelated older gate — every registry
  entry in this codebase, fixture or production-executing, must set
  `productionEnabled: false` and
  `implementationStatus: 'local_fixture_verified'`. This has nothing to do with
  whether the _execution_ is real; it is purely this registry's own vocabulary.
  Task 5 below registers the real service this way, deliberately, and documents
  why in a code comment so nobody "fixes" it into a type error later.
- `KeyRecord.environment: 'test' | 'production'`
  (`packages/verification/ src/receipt/key-registry.ts`) — already supports a
  real `'production'` classification; no type change needed.
- `ServiceExecutor = (input: unknown, ctx: {job_id, request_id}) => Promise<ExecutorOutcome>`
  (`x402-service.ts`) — the exact function shape Task 6's executor must match.
- `executeLocalService(registry, serviceId, input, context): Promise<ServiceExecutionResult>`
  (`packages/service-runtime/src/ dispatcher.ts`).

## Task 0 — implementation isolation

```bash
git worktree add ../siteborne-sun1214 -b sun1214-verify-v2-cdp-production-composition
cd ../siteborne-sun1214
git rev-parse HEAD   # record as IMPLEMENTATION_START_HEAD
```

```
IMPLEMENTATION_START_HEAD = <recorded at execution time, expected a82301c...>
IMPLEMENTATION_WORKTREE = ../siteborne-sun1214
```

All subsequent commands run inside this worktree. `wrangler.toml`'s known
transient-diff exclusion convention is preserved (this checkpoint touches no
config).

## Task 1 — production signer: known-vector round-trip (TDD)

**File:** `packages/service-runtime/src/pcc/production-signer.test.ts` (new)
**Interface under test:**
`buildProductionSigner(rawPrivateKeyHex: string, keyId: string): Promise<{signer: Signer; registry: KeyRegistry}>`
in new file `packages/service-runtime/src/pcc/production-signer.ts`.

1. Failing test: generate a real Ed25519 keypair via `@noble/ed25519` directly
   in the test (not via `generateTestKeypair`, to keep this test independent of
   the fixture-signer module), hex-encode the private key, call
   `buildProductionSigner(hexKey, 'kid_' + 24 valid chars)`, assert the returned
   `signer.privateKey` round-trips through `signBytes`/ `verifyBytes` against
   the independently-derived public key, and assert
   `registry.get(keyId).environment === 'production'` and
   `.purpose === 'paid_service_receipt'`. Expected failure reason:
   `Cannot find module '.../production-signer'` (file doesn't exist yet).
2. Minimal implementation: `production-signer.ts` — decode hex to `Uint8Array`,
   call `ed.getPublicKeyAsync`, construct `Signer = {keyId, privateKey}`,
   construct `KeyRegistry`,
   `.register({key_id: keyId, algorithm: 'Ed25519', public_key, status: 'active', valid_from: new Date().toISOString(), purpose: 'paid_service_receipt', environment: 'production'})`,
   return `{signer, registry}`.
3. Verify: `pnpm --filter @siteborne/service-runtime test production-signer`
   green.

## Task 2 — production signer: fail-closed misconfiguration (TDD)

Same test file, additional cases, each a separate `it(...)`:

- missing/empty `rawPrivateKeyHex` -> failing test asserts
  `buildProductionSigner('', keyId)` rejects with a specific error class
  (`ProductionSignerConfigurationError`, new, exported); implement the guard;
  verify.
- wrong-length key (not exactly 32 bytes after hex decode) -> rejects with the
  same error class, distinct message; implement; verify.
- malformed hex (non-hex characters) -> rejects; implement; verify.
- `keyId` not matching `^kid_[a-z0-9]{24}$` -> rejects; implement; verify.
- **negative control**: assert `buildProductionSigner` never imports or calls
  `createFixtureSigner`/`generateTestKeypair` (static import-graph assertion via
  reading the compiled module's own import list, or a simple `grep`-based test
  asserting the source file contains no `test-signer` or `generateTestKeypair`
  reference) — implemented as part of this task, verified once, not repeated per
  sub-case.

Verify: full `production-signer.test.ts` green,
`pnpm --filter @siteborne/service-runtime typecheck` clean. **Commit boundary
1**: `feat(service-runtime): dedicated production paid-receipt signer`.

## Task 3 — production executor: differential output test (TDD)

**File:**
`apps/edge-api/src/control-plane/production/verify-agent-output-v2-production-executor.test.ts`
(new) **Interface under test:**
`buildVerifyAgentOutputV2ProductionExecutor(signer: Signer, registry: KeyRegistry): ServiceExecutor`
in new file
`apps/edge-api/src/control-plane/production/verify-agent-output-v2-production-executor.ts`.

1. Failing test: construct a production signer via a real (in-test) Ed25519
   keypair (reusing Task 1's helper), call
   `buildVerifyAgentOutputV2ProductionExecutor(signer, registry)`, invoke the
   returned function with a known-good `verify_agent_output.v2` input (reuse the
   existing frozen input/output fixture from `@siteborne/protocol-x402`'s
   `frozenInputExample`/`frozenOutputExample` if its shape matches this service,
   else the service's own existing test fixture), and assert:
   - `result.result_class === 'success'`;
   - `result.receipt` verifies against the registry's public key via the
     existing `packages/verification` verifier (`verifyBytes`/receipt
     verification helper — reuse existing);
   - the output matches what the SAME input produces through the existing
     fixture-backed path (`buildFixtureRegistry` + `executeLocalService`) for
     every field except `receipt`/signature-dependent fields (the verification
     _logic_ output must be identical; only the signature differs because the
     key differs). Expected failure reason: module doesn't exist yet.
2. Minimal implementation: construct `ServiceExecutionContext` with
   `execution_mode: 'live'`, `artifact_store: new InMemoryArtifactStore()`
   (documented inline: safe because `VerifyAgentOutputService` never calls it —
   cite the design doc section), `audit`: a no-op-shaped `ServiceAuditEventSink`
   (the _real_ audit path is `x402-service.ts`'s own `D1AuditRepository`,
   external to this executor — this context-level `audit` field is a different,
   per-service-execution-only channel the verify service itself never calls
   either, confirmed in the design; a minimal in-memory implementation satisfies
   the type without claiming durability it doesn't provide here), a real
   `clock`, and a `budget: DEFAULT_SERVICE_BUDGET`. Register ONLY
   `VerifyAgentOutputService` (`productionEnabled: false`,
   `implementationStatus: 'local_fixture_verified'` — see the plan header's note
   on why) into a fresh `ServiceRegistry`. Call
   `executeLocalService(registry, 'verify_agent_output.v2', input, context)`,
   map the result to `ExecutorOutcome`.
3. Verify: differential test green.
4. **Structural fixture-exclusion test** (same file): assert (via reading the
   executor module's own source text in the test, i.e. a same-repo static check,
   not an external tool) that it contains no reference to
   `buildFixtureRegistry`, `createFixtureSigner`, `FixtureDocumentWorkerBridge`,
   or `createTestArtifactStore`/`createTestServiceAuditSink`/ `createTestClock`.
   Implement nothing further (already true by construction); this test exists to
   catch future regressions.

Verify:
`pnpm --filter @siteborne/edge-api test verify-agent-output-v2-production-executor`
green. **Commit boundary 2**:
`feat(edge-api): verify_agent_output.v2 production executor (fixture-free)`.

## Task 4 — production route composition: config assembly + fail-closed construction (TDD)

**File:**
`apps/edge-api/src/control-plane/production/verify-agent-output-v2-cdp-composition.test.ts`
(new) **Interface under test:**
`buildVerifyAgentOutputV2CdpProductionRouteConfig(env: Pick<Env, 'PAID_RECEIPT_SIGNING_PRIVATE_KEY' | 'PAID_RECEIPT_SIGNING_KEY_ID' | 'SELLER_WALLET_ADDRESS' | 'CDP_API_KEY_ID' | 'CDP_API_KEY_SECRET' | ...>, db: D1Database): Promise<X402ServiceRouteConfig | { unavailable: true; reason: string }>`
in new file
`apps/edge-api/src/control-plane/production/verify-agent-output-v2-cdp-composition.ts`.

1. Failing test: call the function with a fully-populated fake `env`
   (real-shaped test key material) and a test D1 handle; assert it returns a
   well-formed `X402ServiceRouteConfig` with
   `serviceId === 'verify_agent_output.v2'`,
   `path === '/v2/verify/agent-output'`, `executor` set to the Task 3 executor,
   `evidenceProvider` set via `resolveProductionCdpEvidenceProvider` (existing,
   unmodified — reused exactly), and the correct pricing/schema-hash fields
   matching the existing values already used in `paid-services.ts` for this
   exact service (copy verbatim: `pricingKey: 'verify_agent_output_standard'`,
   `contractRelease: '2.0.0'`, the two schema hashes, `pccDependency: '1.1.0'`).
   Expected failure reason: module doesn't exist yet.
2. Minimal implementation: assemble the config; delegate network/asset/ payTo
   resolution to the same `resolvePaymentNetwork`/
   `isProductionPaymentAuthorized`/`resolvePaymentAsset` calls
   `paid-services.ts`'s `v2CdpRoute` already uses (import directly from
   `@siteborne/protocol-x402`, do not re-derive).
3. Verify green.
4. **Fail-closed tests**, each its own `it(...)`:
   - missing `PAID_RECEIPT_SIGNING_PRIVATE_KEY` -> returns
     `{unavailable: true, reason: ...}` (never throws an unhandled exception,
     never falls back to a fixture signer) — write failing test, implement
     guard, verify;
   - missing `PAID_RECEIPT_SIGNING_KEY_ID` -> same;
   - malformed key (delegates to Task 2's `ProductionSignerConfigurationError`,
     caught here and converted to the same `{unavailable: true}` shape) — write
     failing test, implement catch, verify;
   - missing `DB` (no D1 handle) -> `{unavailable: true}` — write failing test,
     implement guard, verify.
5. **Negative control**: assert the returned config's `executor` is
   reference-identical to Task 3's factory output for a given signer/ registry
   pair (proving no second, parallel executor construction path exists).

Verify: full test file green, `pnpm --filter @siteborne/edge-api typecheck`
clean. **Commit boundary 3**:
`feat(edge-api): verify_agent_output.v2/CDP production route composition (fail-closed, unwired)`.

## Task 5 — x402/idempotency integration proof under real workerd (TDD)

**File (extend, don't replace):**
`apps/edge-api/src/worker-runtime-test-entrypoint.ts`

1. Failing test (in `scripts/test-worker-runtime.mts`, new Phase 6): mount a new
   route family `/v2/verify-production/*` in the test entrypoint, **before** the
   existing `/v2/*` catch-all (route order matters, matching the file's existing
   convention), built by calling
   `buildVerifyAgentOutputV2CdpProductionRouteConfig` with a
   **test-format-but-real-code-path** signing key (a real, randomly
   generated-once-per-process 32-byte Ed25519 key, hex-encoded, held only in
   this test file's module scope — never `createFixtureSigner`, never committed,
   never resembling a real secret) and a **synthetic** CDP evidence provider
   (`FixturePaymentEvidenceProvider`, the same pre-existing, already-safe
   production constructor every other phase already uses — not a new seam), then
   calling `createX402ServiceRoute(app, config)` with that assembled config,
   mounted on a fresh Hono app cached the same way `/v2/nevermined/*` is cached
   in this file. Add Phase 6 scenarios to `scripts/test-worker-runtime.mts`:
   - unsigned request -> real 402 with the canonical price (reuse the existing
     pricing-assertion pattern from Phase 4);
   - synthetic payment -> real verify execution -> **real Ed25519 signature**
     (assert the receipt's signature verifies against the test-process public
     key using `packages/verification`'s existing verifier, not merely that a
     signature-shaped field is present) -> real
     `x402_service_results`/`audit_events` D1 rows (query the isolated D1
     instance directly after the request, assert rows exist with the correct
     `service_id`/`payment_identifier`);
   - malformed input -> deterministic pre-economic rejection (never 402),
     reusing the existing Profile 1 gate unmodified;
   - duplicate request with the same idempotency key -> asserts exactly one
     execution occurred (no duplicate D1 row, no duplicate signature) — this is
     the idempotency/recovery proof required by the design. Expected failure
     reason: route doesn't exist in the test entrypoint yet, scenarios fail
     with 404.
2. Minimal implementation: the entrypoint mount + the four scenarios.
3. Verify: `pnpm test:worker-runtime` full run green, including the existing 66
   baseline scenarios (must remain unaffected) plus the new Phase 6 scenarios
   (exact count recorded in the closure report).
4. **Bundle isolation extension**: extend the existing
   `runBundleIsolationCheck()` in `scripts/test-worker-runtime.mts` to also grep
   the real `wrangler.toml` dry-run bundle for
   `verify-agent-output-v2-cdp-composition`/
   `verify-agent-output-v2-production-executor`/`production-signer` module-chunk
   comments and the test entrypoint's own marker — all expected zero matches
   (proving the new production-composition modules are exactly as unreachable
   from the real bundle as the test entrypoint itself, even though they are
   _production_-shaped code, because nothing in `index.ts` imports them yet).

**Commit boundary 4**:
`test(worker-runtime): verify_agent_output.v2/CDP production composition, real workerd proof`.

## Task 6 — fixture-reintroduction mutation proof extension (TDD)

**File (extend):** `scripts/test-production-fixture-reintroduction-caught.mts`

1. Failing test (the mutation proof itself, run manually first to confirm it
   currently only covers `index.ts`): add a second mutation target — temporarily
   edit `verify-agent-output-v2-production-executor.ts` to import
   `buildFixtureRegistry`/`createFixtureSigner` and use it instead of the real
   signer, run Task 3's structural fixture-exclusion test (from Task 3, step 4)
   against the mutant, require it to fail (proving that test would catch a real
   regression), restore the file byte-for-byte in a `finally` block (existing
   established pattern from every prior mutation-proof script in this repo),
   re-verify the test passes again, confirm `git diff` is empty afterward.
2. This task adds no new "implementation" — it proves Task 3's own
   negative-control test is a genuine regression-catcher, per the project's
   established mutation-proof discipline.

Verify: `npx tsx scripts/test-production-fixture-reintroduction-caught.mts`
exits 0, prints
`PRODUCTION_FIXTURE_REINTRODUCTION_CAUGHT (verify v2 composition) = YES`,
confirms clean tree. **Commit boundary 5**:
`test(mutation-proof): extend fixture-reintroduction proof to verify v2/CDP production composition`.

## Task 7 — production-containment checks (no new code; verification only)

Run and record, at this checkpoint of the plan and again at the end:

```bash
pnpm production:preflight   # must remain PASS, unchanged behavior
curl -s -o /dev/null -w '%{http_code}\n' https://utility.siteborne.net/v2/verify/agent-output   # must remain 404
```

No implementation task in this plan touches `index.ts`,
`production-paid-services.ts`, or `wrangler.toml`, so this is a
verification-only task confirming that fact rather than a task that could
plausibly fail for a code reason — still run and recorded, per the governing
checkpoint's explicit requirement not to assume.

## Task 8 — full regression matrix

```bash
pnpm --filter @siteborne/service-runtime test
pnpm --filter @siteborne/edge-api test
pnpm --filter @siteborne/verification test    # unmodified, confirms no accidental regression
pnpm test:worker-runtime                       # full, including new Phase 6
pnpm pricing:check
pnpm contracts:compat:check
pnpm typecheck
pnpm lint
pnpm format:check
npx tsx scripts/test-production-fixture-reintroduction-caught.mts
npx tsx scripts/test-x402-blocker-caught.mts        # unmodified area, confirms no regression
npx tsx scripts/test-old-verify-path-caught.mts     # unmodified area, confirms no regression
```

`pnpm check`/`pnpm security:release` full suites are **not** re-run per this
checkpoint's own §30/§28-style guidance (run enough to validate claims, not the
entire expensive suite absent a contradiction) — this touched surface is narrow
(three new files plus two extended test/proof files, zero modification to
`index.ts`, `x402-service.ts`, `paid-services.ts`, or any D1 schema), so the
focused matrix above is proportionate. If any focused result contradicts an
existing accepted invariant, stop and re-scope before continuing, per
governing-checkpoint policy.

**Commit boundary 6** (if the report itself needs a separate commit from the
implementation, per this project's established two-commit convention —
implementation commit(s) above, then a closure-report commit): the SUN-1214
evidence report.

## Task summary / dependency order

```
Task 0 (worktree)
  -> Task 1 (signer happy path) -> Task 2 (signer fail-closed)
       -> Task 3 (executor, depends on a working signer)
            -> Task 4 (route composition, depends on executor + signer)
                 -> Task 5 (workerd integration, depends on composition)
                      -> Task 6 (mutation proof, depends on Task 3's negative control existing)
                           -> Task 7 (containment checks, independent, can run any time after Task 0)
                                -> Task 8 (full regression, depends on everything above)
```

Tasks 1-2 and Task 7 have no hard dependency on each other and could run in
parallel; everything else is a strict chain, matching the design's own component
dependency graph (signer -> executor -> composition -> workerd proof -> mutation
proof -> regression).

## Commit boundaries (summary)

1. `feat(service-runtime): dedicated production paid-receipt signer`
2. `feat(edge-api): verify_agent_output.v2 production executor (fixture-free)`
3. `feat(edge-api): verify_agent_output.v2/CDP production route composition (fail-closed, unwired)`
4. `test(worker-runtime): verify_agent_output.v2/CDP production composition, real workerd proof`
5. `test(mutation-proof): extend fixture-reintroduction proof to verify v2/CDP production composition`
6. `docs(reports): SUN-1214 checkpoint T closure report`

Each commit lands only after its task's tests pass and neighboring regressions
(the immediately-prior commit boundary's own test suite, at minimum) are
re-verified green.
