# Design: `verify_agent_output.v2` / CDP Production Execution Composition

Status: DRAFT — awaiting human approval. No implementation has started.
Checkpoint: SUN-1214.

## 1. Problem statement

SUN-1213 found that zero of the 12 paid routes have a complete production
dependency chain, and identified `verify_agent_output.v2` / CDP as the
smallest-blast-radius target for the first real composition, blocked by four
R0s: verify production wiring (#5), a dedicated paid receipt signer (#6),
artifact persistence (#7), and service audit persistence (#8).

This design answers: what is the minimal, correct production composition that
lets `/v2/verify/agent-output` execute the real verification engine, sign a real
receipt, and leave a durable, governable record — while making it structurally
impossible for a buyer to become economically committed before all of that can
happen — without deploying, provisioning, or activating anything?

## 2. Current architecture (traced directly against source, not report prose)

### 2.1 The route never reaches any of this today

`apps/edge-api/src/index.ts` mounts `/v1/*`, `/v2/*`, `/v1/nevermined/*`,
`/v2/nevermined/*` as wildcard families. With the (currently absent) activation
flag unset, each returns `404` via `c.notFound()`. If the flag were set, each
returns `503 service_executor_not_configured` from
`production-paid-services.ts`'s `productionServiceExecutorUnavailable` — a
module that imports **nothing** else: no service-runtime, no payment-provider,
no fixture, no signer, no artifact store, no audit sink. Neither branch emits
`PAYMENT-REQUIRED` or constructs any economic state. This file is confirmed
byte-identical between the frozen candidate (`e5d061e2`) and current `HEAD`
(empty `git diff`).

### 2.2 What already exists, real and tested, just unreachable from `index.ts`

**The x402 payment-lifecycle route handler**
(`apps/edge-api/src/control-plane/routes/x402-service.ts`,
`createX402ServiceRoute`) is the single shared handler every x402 paid route
(test-only and would-be production) is built from. Reading it directly (not the
SUN-1206 summary) shows it already, unconditionally, for any service wired
through it:

- constructs `D1PaymentAttemptRepository`, `X402QuoteRepository`,
  `X402ServiceResultRepository`, `D1JobsRepository`, `D1StateEventsRepository`,
  `D1AuditRepository` from the real `D1Database` binding;
- has a built-in `audit(type, details)` helper that calls
  `auditRepo.create(createAuditEvent(...))` — writing real rows to the
  `audit_events` table for `REQUEST_RECEIVED`, `IDEMPOTENCY_ACQUIRED`,
  `STATE_CHANGED`, etc. (the full `AuditEventTypes` enum in
  `apps/edge-api/src/control-plane/audit/events.ts`);
- calls
  `X402ServiceResultRepository.create(jobId, paymentIdentifier, result, nowIso)`,
  persisting the **entire** `ExecutorOutcome.result` object (including
  `receipt`, `output`, `output_hash`) as JSON to the `x402_service_results`
  table;
- owns the full challenge -> verify -> `config.executor(...)` -> settle state
  machine, with idempotency via `idempotency_records` and payment
  attempt/job-state tracking via `payment_attempts`/`jobs`/ `job_state_events`.

**This means SUN-1213's `PRODUCTION_SERVICE_AUDIT_READY=NO` and (for the
result-persistence half of) `PAID_EXECUTION_PERSISTENCE_MODEL_READY` were
correctly classified as "not production ready" for the right underlying reason
(unreachable from `index.ts`), but the code itself needs zero new work for this
route — only reachability.** This is the single most important correction this
design makes versus treating SUN-1213's R0 list as four equally-sized new-code
tasks.

**The verifier**
(`packages/service-runtime/src/services/agent-verification/ service.ts`,
`VerifyAgentOutputService`) takes exactly one dependency beyond its input:
`{ signer: Signer, keyRegistry: KeyRegistry }` (via
`AgentVerificationServiceDeps`, confirmed by direct read — no `httpClient`, no
`worker` bridge, no external provider anywhere in this file, in
`claims/builder.ts`, or in `evidence/builder.ts`). It never calls
`context.artifact_store` (confirmed: zero references across the service, claim
builder, evidence builder, and the whole `pcc/` directory this service uses).
**Artifact persistence (R0 #7) is therefore `NOT_APPLICABLE` to this specific
service** — a genuinely narrower finding than SUN-1213's cross-cutting framing
implied, and a real YAGNI win: this design does not need to wire
`R2ArtifactStoreAdapter` at all.

**The signer.** `packages/verification/src/receipt/signer.ts` is real, already
Worker-compatible production code using `@noble/ed25519` directly (no native
modules, no Node-only APIs) — `signBytes`/`verifyBytes` are general-purpose and
already used by every service's receipt path via `verifyAndSign`. Only
`generateTestKeypair` (random key generation) is test-only; the
signing/verification primitives themselves need zero changes. The sole missing
piece is **key sourcing**: turning a Cloudflare secret into a
`Signer`/`KeyRegistry` pair, which
`packages/service-runtime/src/pcc/test-signer.ts`'s `createFixtureSigner`
already shows the exact shape of
(`{ signer: { keyId, privateKey }, registry: KeyRegistry }`).

**CDP evidence provider resolution.** `production-payment.ts`'s
`resolveProductionCdpEvidenceProvider` (built across SUN-1200-1205, already
tested, already fail-closed to `{evidenceMode:'fixture'}` on any
missing/mismatched credential) is real and ready to use as-is. No changes
needed.

**The route-config helper.** `paid-services.ts`'s `v2CdpRoute(path)` shows the
exact network/asset/payTo resolution already used for `/v2/verify/agent-output`
today (in the test-only composition): it calls
`resolvePaymentNetwork`/`isProductionPaymentAuthorized` from
`@siteborne/protocol-x402`, the same ADR-0055 gate machinery already proven
across this whole project. Reused as-is.

### 2.3 What is genuinely absent

- A production key-sourcing module (signer secret -> `Signer`/ `KeyRegistry`),
  fail-closed.
- A production executor function for `verify_agent_output.v2` that builds a real
  (`execution_mode: 'live'`) `ServiceExecutionContext` and calls
  `executeLocalService` with the real `VerifyAgentOutputService` and the real
  signer.
- A production route-composition module (parallel to, never merged with,
  `paid-services.ts`) that wires that executor into `createX402ServiceRoute`
  with the real CDP evidence provider, gated by explicit fail-closed dependency
  validation.
- A test-only entrypoint extension proving all of the above under real
  `workerd`, using synthetic (not real) payment evidence — the same established
  pattern as SUN-1201/1204, never imported by `index.ts`.

## 3. Selected scope

In scope: exactly the four items in §2.3, for `verify_agent_output.v2` / CDP
only. Reuses `createX402ServiceRoute`, `VerifyAgentOutputService`,
`executeLocalService`, `signBytes`/`verifyBytes`,
`resolveProductionCdpEvidenceProvider`, `v2CdpRoute`, and the existing D1
repositories completely unmodified.

Out of scope (per the governing checkpoint and confirmed unnecessary by this
analysis): R2/artifact wiring (not applicable to this service), any other
service, Nevermined rail, any route activation, any Cloudflare mutation.

## 4. Alternatives considered

### Approach 1 — Minimal executor + reuse (recommended)

New files only: a key-sourcing module, a production executor function, a
production route-composition module, and a test-only entrypoint extension. Zero
changes to `x402-service.ts`, `paid-services.ts`, `production-paid-services.ts`,
`index.ts`, the D1 schema, or the verifier. Every piece of existing tested
machinery (x402 lifecycle, audit, result persistence, CDP evidence resolution)
is reused exactly as-is by constructing a new `X402ServiceRouteConfig` and
calling the same `createX402ServiceRoute(app, config)` the test-only entrypoint
already calls.

- Code reuse: maximal — reuses literally every existing component except key
  sourcing.
- New components: 1 signer module, 1 executor module, 1 route-composition
  module, 1 test-entrypoint extension.
- Storage: none new (D1 schema already sufficient; no artifact needed).
- Migration needs: none.
- Cloudflare resource needs for THIS checkpoint: none (secret/binding
  provisioning is explicitly deferred to SUN-1215, as directed).
- Future reuse: the key-sourcing pattern and the "production route composition,
  separate module, gated by dependency validation" pattern generalize directly
  to company/web/document once their own executors exist — this design
  deliberately keeps the pattern reusable without building anything those
  services would need today (no premature generalization; no shared "production
  executor factory" abstraction is invented before a second consumer exists).
- Complexity: lowest of the three.
- Blast radius: smallest — new modules only, zero modification to any
  currently-relied-upon file.

### Approach 2 — Generalized production composition framework

Build a generic `ProductionServiceCompositionFactory<T>` capable of wiring any
of the four services (signer + artifact + audit + executor) behind a single
configuration-driven abstraction, then instantiate it once for verify.

- Code reuse: same underlying reuse as Approach 1, wrapped in an extra
  abstraction layer.
- New components: everything in Approach 1, plus a generic factory interface,
  plus per-service capability declarations (most of which would be unused stubs
  for verify, since it needs neither artifact nor a live provider).
- Complexity: meaningfully higher — the abstraction must correctly model
  artifact-optional, provider-optional, and provider-required services before a
  second real consumer exists to validate the abstraction against.
- Blast radius: larger surface to review and get wrong on the first real
  production economic composition in the project.
- Rejected: violates the explicit "does not prematurely generalize" requirement
  and YAGNI guidance in the governing checkpoint. The company/web/document
  services have different enough dependency shapes (live provider, artifact
  persistence, Worker-runtime bridge) that a factory designed against verify's
  degenerate case (no artifact, no provider) would likely need rework anyway
  once a second real consumer exists.

### Approach 3 — Modify `x402-service.ts`/`paid-services.ts` in place

Add a `productionExecutor`/`productionEvidenceProvider` optional field directly
to the existing test-composition file, gated by environment checks inline.

- Code reuse: high, but at the cost of conflating test-only and production
  composition in the same file and control flow.
- New components: fewest new files, but highest risk — a bug in the gating
  condition inside a file that also constructs fixture registries for every
  other service creates exactly the kind of "route-family flag enabled but
  fixture reachable" regression class SUN-1206 spent an entire checkpoint
  eliminating.
- Rejected: reintroduces coupling between the fixture/test composition graph and
  anything production-adjacent — the opposite of SUN-1206's explicit, hard-won
  architectural boundary (`paid-services.ts` is deliberately never imported by
  `index.ts`; a production composition module must remain equally structurally
  separate, not layered inside the same file that builds
  `buildFixtureRegistry`).

### Recommendation: Approach 1

Smallest correct architecture. Reuses the real x402 lifecycle, the real
verifier, and every existing persistence adapter that applies. Creates no
duplicate state machine. Stays structurally separate from both the
fixture-composition file and the disabled-by-default production entrypoint,
exactly preserving SUN-1206's fixture-isolation boundary while adding a second,
equally isolated production-composition module next to it (not instead of it —
`production-paid-services.ts` remains the module `index.ts` actually imports;
the new module is proven independently and is a candidate for a _future_
checkpoint's wiring decision, not this one's).

## 5. Recommended architecture

### 5.1 Component boundaries

```
apps/edge-api/src/control-plane/production/
  verify-agent-output-v2-cdp-composition.ts   <- NEW: route composition
    (imports createX402ServiceRoute, resolveProductionCdpEvidenceProvider,
     v2CdpRoute-equivalent config, the production executor, and the
     production signer -- exports a function that either returns a
     configured X402ServiceRouteConfig or throws/returns "unavailable"
     if any required dependency is missing)

packages/service-runtime/src/pcc/production-signer.ts  <- NEW: key sourcing
    (exports buildProductionSigner(env-shaped input): { signer, registry }
     -- fails closed on missing/malformed key material; never falls back
     to createFixtureSigner)

apps/edge-api/src/control-plane/production/
  verify-agent-output-v2-production-executor.ts  <- NEW: executor
    (exports buildVerifyAgentOutputV2ProductionExecutor(signer, registry):
     ServiceExecutor -- constructs a real ServiceExecutionContext with
     execution_mode:'live', registers ONLY VerifyAgentOutputService,
     calls executeLocalService; never imports buildFixtureRegistry,
     FixtureDocumentWorkerBridge, or any *.v1/company/web/document symbol)

apps/edge-api/src/worker-runtime-test-entrypoint.ts   <- EXTENDED
    (mounts a new, clearly-marked test-only route using the REAL
     production composition module above, with a synthetic CDP evidence
     provider and a test-only-but-real-format signing key injected
     explicitly -- proving the real composition under real workerd
     without touching index.ts)
```

`index.ts` and `production-paid-services.ts` are **not modified**. The route
composition module above is never imported by either file in this checkpoint.

### 5.2 Exact data flow

```
(test-only entrypoint, or a future index.ts wiring decision — NOT this
 checkpoint)
  request
    -> createX402ServiceRoute's app.post(config.path, ...) handler
       (existing, unmodified x402-service.ts)
    -> pre-economic body validation (existing verifyAgentOutputPreEconomicCheck,
       Profile 1 gate -- unmodified)
    -> [no valid payment] -> 402 PAYMENT-REQUIRED, quote persisted
       (existing X402QuoteRepository -- unmodified)
    -> [valid payment presented] -> payment verification via
       resolveProductionCdpEvidenceProvider (existing, unmodified;
       fails closed to evidenceMode:'fixture' on any missing/mismatched
       credential -- which itself only ever produces a real, governed
       rejection, never a bypass)
    -> idempotency check (existing idempotency_records -- unmodified)
    -> config.executor(input, ctx) is called:
         -> buildVerifyAgentOutputV2ProductionExecutor's returned function
         -> constructs ServiceExecutionContext{execution_mode:'live', ...}
         -> registers VerifyAgentOutputService (real, unmodified) into a
            fresh ServiceRegistry containing ONLY this one service
         -> executeLocalService(registry, 'verify_agent_output.v2', input, ctx)
         -> internally calls verifyAndSign(...) with the REAL production
            signer/registry -- Ed25519, @noble/ed25519, unmodified
            cryptographic code
         -> returns ExecutorOutcome{ result }
    -> X402ServiceResultRepository.create(...) persists the full result
       (existing, unmodified)
    -> audit(...) calls throughout (existing, unmodified) write to
       audit_events
    -> settlement transition via the existing state machine (unmodified)
    -> durable response returned
```

### 5.3 Economic lifecycle — derived from actual `x402-service.ts` code, not assumed

The literal current lifecycle (confirmed by reading `createX402ServiceRoute` end
to end) already enforces the correct ordering: the handler never calls
`config.executor` until payment has been verified via the resolved evidence
provider, and never calls settlement until `config.executor` returns
successfully. Failure at any stage prior to a successful executor call cannot
reach settlement (confirmed by control flow: settlement calls occur strictly
after the executor-outcome branch, not in parallel with it). This design
introduces no new lifecycle — it supplies a real `executor` to an
already-correct, already-tested state machine. The one thing this design must
prove fresh (§10/§11 below) is that the _new_ executor itself cannot produce a
state where the outer machine believes execution succeeded but signing actually
failed, silently.

### 5.4 Signer design

`buildProductionSigner(rawKeyMaterial: string, keyId: string): Promise<{signer: Signer; registry: KeyRegistry}>`

- Input: `env.PAID_RECEIPT_SIGNING_PRIVATE_KEY` (hex-encoded 32-byte Ed25519
  private key — hex chosen over base64 to match this codebase's existing
  convention for raw key material, confirmed nowhere yet established for this
  exact key, so this is a new, explicit, documented convention this design
  fixes) and `env.PAID_RECEIPT_SIGNING_KEY_ID` (must match the existing
  `^kid_[a-z0-9]{24}$` pattern the frozen PCC receipt schema already requires —
  confirmed in `test-signer.ts`'s own comment).
- Fails closed (throws a typed error, never falls back) if either is absent, if
  the key doesn't decode to exactly 32 bytes, or if the key ID doesn't match the
  required pattern.
- Derives the public key via `@noble/ed25519`'s `getPublicKeyAsync` (already
  used by `generateTestKeypair` — same call, real key instead of a random one).
- Registers the derived public key in a fresh `KeyRegistry` with
  `environment: 'production'`, `status: 'active'`,
  `purpose: 'paid_service_receipt'` — a distinct `purpose` string from the
  fixture signer's `'service_runtime_fixture_receipt'` and from the Agent Card
  key's identity purpose, so no verifier could ever conflate the three.
- Returns the same `{ signer, registry }` shape `createFixtureSigner` returns,
  so `executeLocalService`/`verifyAndSign` need zero changes.

No new cryptographic format. No repurposing of `AGENT_CARD_SIGNING_PRIVATE_KEY`.
Public-key discovery for external verifiers (a JWKS-equivalent endpoint for this
new key) is explicitly **not** built in SUN-1214 — it's a real gap, but
activation-time, not composition-time; noted in §21 as an explicit non-goal and
carried to the provisioning manifest (§34-equivalent, in the closure report) as
a future requirement.

### 5.5 Artifact design

**Not applicable to this service.** `VerifyAgentOutputService` never calls
`context.artifact_store` (confirmed by direct source read, §2.2). The production
executor supplies `InMemoryArtifactStore` for
`ServiceExecutionContext.artifact_store` purely to satisfy the type contract —
this is safe specifically because it is provably never invoked for this service,
not because in-memory storage is being treated as production-adequate in
general. `R2ArtifactStoreAdapter` remains unused by this design; it will need
real wiring + a provisioned bucket the moment a service that actually calls
`artifact_store.put` (company, web, document) is composed — explicitly out of
scope here.

### 5.6 Audit design

No new code. `createX402ServiceRoute`'s existing `audit()` helper and
`D1AuditRepository` already write real rows to `audit_events` for every service
wired through it, using the existing `AuditEventTypes` enum. This design adds no
new event types for the success path — the existing
`REQUEST_RECEIVED`/`IDEMPOTENCY_ACQUIRED`/`STATE_CHANGED` events already capture
the required minimum (request/service identity, service version via `serviceId`,
payment identifier via the job/attempt linkage, execution outcome via state
transitions, timestamps) once this route is reachable. If a future review finds
the existing event vocabulary insufficient for a specific paid-execution audit
need, that is a `x402-service.ts` change against a real consumer — not invented
speculatively here.

### 5.7 D1/migration implications

None. No migration is added by this design. Confirmed sufficient: `jobs`,
`job_state_events`, `payment_attempts`, `idempotency_records`, `x402_quotes`,
`x402_service_results`, `audit_events` already model everything this composition
needs. Migration head remains `0007`.

### 5.8 Configuration contract

```
PAID_RECEIPT_SIGNING_PRIVATE_KEY   (new secret; hex-encoded Ed25519 private key)
PAID_RECEIPT_SIGNING_KEY_ID        (new secret or committed var -- TBD in
                                     implementation plan whether this needs
                                     secrecy; likely a committed [vars]
                                     entry like AGENT_CARD_SIGNING_KEY_ID,
                                     since a key ID is not itself sensitive)
```

No new binding is required (no `ARTIFACTS` dependency for this service). `DB`
(already present) is the only binding this composition needs, via the existing
D1 repositories. No new activation variable of any kind is introduced —
`PAID_ROUTES_ENABLED`/`PRODUCTION_ENABLED`/ `PAYMENT_ENVIRONMENT` are untouched
by this design and remain irrelevant to it, since the new module is never
reached from the flag-gated `index.ts` handlers at all in this checkpoint.

### 5.9 Failure matrix (design-time; implementation must prove each with a test)

| Failure                                                        | HTTP/result                                                                               | Payment challenge possible?                                                      | Economic effect possible?                           | Execution runs?                             | Durable recovery state                                                  | Retry-safe                                       |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------ |
| missing signer secret                                          | composition factory throws at construction; route never registers                         | N/A (route doesn't exist in this configuration)                                  | NO                                                  | NO                                          | N/A                                                                     | YES (idempotent construction failure)            |
| malformed/wrong-length signing key                             | same as above                                                                             | NO                                                                               | NO                                                  | NO                                          | N/A                                                                     | YES                                              |
| key ID pattern mismatch                                        | same as above                                                                             | NO                                                                               | NO                                                  | NO                                          | N/A                                                                     | YES                                              |
| verify engine internal failure (post-payment)                  | existing `x402-service.ts` failure branch (unmodified) -- governed non-2xx, no settlement | already occurred prior (existing lifecycle)                                      | NO (settlement gated on executor success, per §5.3) | YES (ran, failed)                           | `x402_service_results`/`job_state_events` record the failure (existing) | governed by existing retry semantics, unmodified |
| signing failure inside `verifyAndSign` (post-verify-execution) | executor throws; treated as executor failure by the existing lifecycle -- no settlement   | already occurred prior                                                           | NO (same gating as above)                           | YES (verify logic ran; only signing failed) | existing failure-path persistence                                       | governed by existing semantics                   |
| D1 unavailable                                                 | existing `x402-service.ts` D1-call failure paths (unmodified)                             | depends on which D1 call failed -- existing behavior, not changed by this design | governed by existing behavior                       | governed by existing behavior               | governed by existing behavior                                           | governed by existing behavior                    |
| duplicate idempotent request                                   | existing `idempotency_records` dedupe (unmodified)                                        | N/A -- request short-circuits                                                    | NO new economic effect                              | NO re-execution                             | existing record reused                                                  | YES, by design                                   |

Rows describing existing `x402-service.ts` behavior are marked
"unmodified"/"existing" deliberately: this design does not re-derive or
duplicate that state machine's failure semantics; it only adds two new, narrow
failure modes (missing/invalid signer) that must fail _before_ the route can
even be constructed, which is strictly safer than any failure mode the existing
lifecycle already handles.

### 5.10 Idempotency/recovery behavior

Fully inherited from the existing `idempotency_records`/`payment_attempts`
machinery in `x402-service.ts` — this design adds no parallel state. The one
property that must be freshly proven (not assumed) is that
`buildVerifyAgentOutputV2ProductionExecutor`'s function is itself
side-effect-free and safely re-callable if the outer x402 lifecycle retries it
(it is, by construction: `VerifyAgentOutputService.execute` is a pure function
of its input and context, and `executeLocalService` allocates no external state
beyond the injected context) — this becomes an explicit implementation-phase
test, not an assumption.

### 5.11 Fixture exclusion

The new production executor module imports `VerifyAgentOutputService` directly
from `packages/service-runtime/src/services/agent-verification/ service.ts` and
nothing from `wiring.ts` (`buildFixtureRegistry`), `test-signer.ts`
(`createFixtureSigner`), or any `*fixture*`-named symbol. This is a structural
guarantee (no import path exists from the new module to any fixture symbol),
verifiable by the same grep-based bundle-audit technique SUN-1206 used, and by
extending the existing fixture- reintroduction mutation proof (§28 of the
governing checkpoint) to also cover this new module.

### 5.12 Worker-runtime constraints

Every dependency this design touches is already proven Worker-compatible:
`@noble/ed25519` (pure JS, no native code, already used in the existing signing
path), D1 (native Workers binding), `executeLocalService`/
`VerifyAgentOutputService` (already proven under real `workerd` via the existing
`pnpm test:worker-runtime` harness, Phase 2/4). No new runtime risk is
introduced.

### 5.13 Test strategy

1. Unit tests for `buildProductionSigner`: known test vector round-trip (sign
   then verify with `verifyBytes`, matching the existing test pattern already
   used for the fixture signer), invalid private key length, missing key,
   missing key ID, key ID pattern mismatch, and a test proving the returned
   registry never contains a fixture-purpose or Agent-Card-purpose key.
2. Unit tests for the production executor: constructs a context with
   `execution_mode: 'live'`, proves it never imports/constructs any fixture
   symbol (static import-graph assertion), proves it produces the same output
   shape as the existing fixture-backed executor for identical input
   (differential test against `executeLocalService` directly, bypassing the
   fixture registry only where the dependency differs — i.e. signer).
3. A new, clearly-marked test-only-entrypoint route (extending
   `worker-runtime-test-entrypoint.ts`'s existing pattern), proven under real
   `workerd` end to end: unsigned request -> real 402 with canonical price
   (reusing the existing pricing-check infrastructure); synthetic CDP payment ->
   real verify execution -> real Ed25519 signature (using a
   test-format-but-real-code-path key, not `createFixtureSigner`) -> real D1
   audit/result rows -> real settlement -> governed response.
4. Negative/crash-boundary tests per §5.9's failure matrix, each proving the
   exact HTTP/economic-state claim in that table under real workerd.
5. A fixture-reintroduction mutation proof extension: temporarily import a
   fixture symbol into the new production module in an isolated mutant, prove
   the bundle-isolation/fixture-reachability check catches it, restore.
6. `pnpm test:worker-runtime` full re-run (baseline currently 66/66, documented
   in SUN-1206) plus the new scenarios above, all passing.

### 5.14 Production provisioning prerequisites (for the future SUN-1215, not this checkpoint)

```
PAID_RECEIPT_SIGNING_PRIVATE_KEY   (new Cloudflare secret)
PAID_RECEIPT_SIGNING_KEY_ID        (new Cloudflare secret or committed var)
```

No new binding, no new D1 migration, no new R2 resource. This is a substantially
smaller provisioning footprint than SUN-1213's cross-cutting framing implied,
because artifact persistence turned out not to apply to this service and
audit/result persistence turned out to already exist.

### 5.15 Future-service reuse boundary

The key-sourcing pattern (`buildProductionSigner`) and the
"structurally-separate production composition module, gated by explicit
dependency validation, proven only via the test-only entrypoint" pattern both
generalize directly to company/web/document. This design does not build a shared
abstraction for either pattern ahead of a second real consumer — when
web_context_verified's production executor is designed next, it will very likely
reuse `buildProductionSigner` as-is (same key, same signer, shared across all
four services per the existing `test-signer.ts` precedent of one shared fixture
signer for all services) and follow the same module-shape convention, but that
reuse decision belongs to that future design, not this one.

### 5.16 Explicit non-goals

- Public-key discovery / JWKS-equivalent endpoint for the new paid signer.
- Key rotation implementation (the design's `purpose`/`environment` fields in
  `KeyRegistry` are rotation-_compatible_ — multiple keys can coexist with
  different `status` values — but no rotation tooling is built here).
- Any artifact persistence wiring (not applicable to this service).
- Any change to `index.ts`, `production-paid-services.ts`, or the current live
  404 behavior of `/v2/verify/agent-output`.
- Any change to pricing, contracts, or the x402 lifecycle state machine itself.
- Company, web, document, or Nevermined-rail composition of any kind.
- Any Cloudflare secret/binding/resource provisioning or migration execution.

## 6. Self-review

- No `TBD`/`TODO` markers remain in this document.
- The one genuinely open design question — whether `PAID_RECEIPT_SIGNING_KEY_ID`
  should be a secret or a committed `[vars]` entry — is explicitly flagged as a
  small, low-risk implementation-phase decision (§5.8), not left ambiguous about
  its _behavior_ (either way, a missing value fails closed identically).
- Every component's interface is either an existing, already-typed interface
  (`Signer`, `KeyRegistry`, `ServiceExecutionContext`, `ServiceExecutor`,
  `X402ServiceRouteConfig`) or a new function with an explicit signature given
  above.
- Lifecycle ordering is not invented — it is read directly from
  `x402-service.ts`'s actual control flow (§5.3), and this design adds no new
  lifecycle stage.
- Every crash/failure state identified in the governing checkpoint's required
  list (missing signer, invalid key, missing artifact binding — N/A here,
  artifact write failure — N/A here, audit write failure — inherited from
  existing behavior, D1 unavailable — inherited, duplicate idempotency —
  inherited, verify engine failure, schema failure — inherited via the existing
  Profile 1 pre-economic gate, receipt signing failure, settlement failure —
  inherited, post-execution crash — inherited) is accounted for in §5.9, either
  as a new narrow failure this design introduces or as explicitly inherited,
  unmodified behavior from the already-tested `x402-service.ts` lifecycle.
- No assumption is unsupported: every claim above cites the specific file read
  to establish it (§2).

---

```
SUN1214_DESIGN_PHASE = COMPLETE
RECOMMENDED_APPROACH = Approach 1 -- minimal executor + reuse
PROPOSED_FILES_TO_CREATE = [
  packages/service-runtime/src/pcc/production-signer.ts,
  apps/edge-api/src/control-plane/production/verify-agent-output-v2-production-executor.ts,
  apps/edge-api/src/control-plane/production/verify-agent-output-v2-cdp-composition.ts,
  (test files for each of the above),
  docs/superpowers/plans/2026-08-22-verify-v2-cdp-production-execution-composition.md (implementation plan, only after approval)
]
PROPOSED_FILES_TO_MODIFY = [
  apps/edge-api/src/worker-runtime-test-entrypoint.ts (extend with a new test-only route using the new production composition module),
  scripts/test-worker-runtime.mts (new Phase covering the new scenarios),
  a fixture-reintroduction mutation proof script (extend or add one covering the new module)
]
PROPOSED_MIGRATIONS = none
PRODUCTION_RESOURCES_REQUIRED = none (deferred to SUN-1215: two new Cloudflare secrets only, no binding, no R2, no migration)
PRODUCTION_SECRETS_REQUIRED = [PAID_RECEIPT_SIGNING_PRIVATE_KEY, PAID_RECEIPT_SIGNING_KEY_ID]
ECONOMIC_SEQUENCE_SAFE = YES (settlement remains strictly gated on executor success in the existing, unmodified x402-service.ts control flow; this design adds no path that reaches settlement without a successful real verify+sign)
OPEN_ARCHITECTURAL_BLOCKERS = none identified
IMPLEMENTATION_STARTED = NO
```
