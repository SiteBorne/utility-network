# SUN-1213 Checkpoint S — Paid-Service Production Capability Inventory, Activation Blocker Map & No-Mutation Readiness Classification

## Summary

```
PAID_SERVICES_PRODUCTION_READY = NO
PAID_ROUTE_ACTIVATION_ELIGIBLE = NO
ACTIVATION_STRATEGY = NONE_READY
PRODUCTION_FIXTURE_REACHABILITY = 0
PRODUCTION_FIXTURE_FALLBACK = NONE
MCP_CAN_BYPASS_PAID_ROUTE_DISABLEMENT = NO
```

Zero of the 12 paid route configurations have a complete, green production
dependency chain. This is not a new finding: SUN-1206 (three days prior, same
frozen candidate, same source) already established this precisely, and this
checkpoint's independent, code-level re-verification confirms it still holds and
refines several classifications with more precision than SUN-1206's summary
alone provided. No repository, config, or production change was made. This
report is evidence and planning only.

## 1. Starting production state (§2)

```
CURRENT_PRODUCTION_VERSION = f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce  ✓
CURRENT_PRODUCTION_TRAFFIC = 100%  ✓
KNOWN_GOOD_ROLLBACK_VERSION = a4ada936-a434-4522-a8af-41c57170f4e4 (retained, not active)
GET /health = 200
GET /ready  = 200
GET /mcp    = 405
12/12 paid REST routes = 404
previews_enabled = false

SUN1213_START_PREFLIGHT = PASS  (pnpm production:preflight)
```

All matched expectations exactly. The stray local SUN-1212 telemetry watcher
mentioned in the handoff was already stopped before this checkpoint began; no
Cloudflare mutation resulted from it.

## 2. Repository authority (§3)

```
START_HEAD (full SHA) = 5e29fc46bb36464f4223e564c3980ec913b116d6
WORKING_TREE = CLEAN
```

Read directly: SUN-1206, SUN-1208, SUN-1209, SUN-1210 P4, SUN-1211, SUN-1212
reports; `production-paid-services.ts`; `index.ts`; the D1 migrations directory;
`packages/service-runtime/src/context.ts`;
`apps/edge-api/src/control-plane/artifacts/store.ts`; the MCP transport and
server (`packages/protocol-mcp/src/server.ts`, `mcp.ts`); the signer tree
(`packages/service-runtime/src/pcc/`).

Per this checkpoint's own instruction not to rely on summaries alone, every
major SUN-1206 claim below was independently re-checked against current source
(not merely re-quoted), and several were refined with more precision than the
original summary carried.

**Confirmed unchanged since SUN-1206**
(`git diff cd4a250c...HEAD -- apps/edge-api/src/control-plane/routes/production-paid-services.ts apps/edge-api/src/index.ts`
is empty): the production entrypoint's paid-route disposition is exactly what
SUN-1206 described. No paid-service architecture change has occurred in any
checkpoint since (SUN-1207 preview containment, SUN-1208 preupload revalidation,
SUN-1209 upload, SUN-1210 zero-traffic smoke, SUN-1211 canary, SUN-1212
promotion all left this code untouched).

## 3. 12-route inventory (§4)

| #   | Route                                   | Rail       | Service/version           | Live behavior (verified §1) |
| --- | --------------------------------------- | ---------- | ------------------------- | --------------------------- |
| 1   | `/v1/company/evidence-graph`            | CDP/x402   | company_evidence_graph.v1 | 404 (flag absent)           |
| 2   | `/v1/web/context`                       | CDP/x402   | web_context_verified.v1   | 404                         |
| 3   | `/v1/document/evidence-json`            | CDP/x402   | document_evidence_json.v1 | 404                         |
| 4   | `/v1/verify/agent-output`               | CDP/x402   | verify_agent_output.v1    | 404                         |
| 5   | `/v2/company/evidence-graph`            | CDP/x402   | company_evidence_graph.v2 | 404                         |
| 6   | `/v2/web/context`                       | CDP/x402   | web_context_verified.v2   | 404                         |
| 7   | `/v2/document/evidence-json`            | CDP/x402   | document_evidence_json.v2 | 404                         |
| 8   | `/v2/verify/agent-output`               | CDP/x402   | verify_agent_output.v2    | 404                         |
| 9   | `/v2/nevermined/company/evidence-graph` | Nevermined | company_evidence_graph.v2 | 404                         |
| 10  | `/v2/nevermined/web/context`            | Nevermined | web_context_verified.v2   | 404                         |
| 11  | `/v2/nevermined/document/evidence-json` | Nevermined | document_evidence_json.v2 | 404                         |
| 12  | `/v2/nevermined/verify/agent-output`    | Nevermined | verify_agent_output.v2    | 404                         |

8 unique service/version identities (4 services x v1/v2, with v2 dual-railed
across CDP and Nevermined) map to 12 route configurations, matching the
repository's own `PRODUCTION_PAID_SERVICE_ROUTES` constant in
`production-paid-services.ts` exactly (12 entries).

**Route exposure and fail-closed gate (§5.A)**, verified directly in
`apps/edge-api/src/index.ts`:

```
route exists?                     YES (all 12, mounted as wildcard families)
activation flag?                  PAID_ROUTES_ENABLED / NEVERMINED_ROUTES_ENABLED
default state?                    absent -> both families 404
flag absent behavior?             c.notFound() (404), before any economics
flag enabled but no executor?     productionServiceExecutorUnavailable() -> 503
                                   service_executor_not_configured, before economics
can request reach economics
  before executor readiness?      NO -- neither branch emits PAYMENT-REQUIRED
                                   or PAYMENT-RESPONSE; index.ts imports no
                                   payment-provider, service-runtime, fixture,
                                   signer, artifact-store, or audit-sink symbol
                                   for the paid-route handlers at all
```

```
UNSUPPORTED_SERVICE_PREPAYMENT_FAIL_CLOSED = YES
UNSUPPORTED_SERVICE_CAN_SETTLE = NO
```

## 4. Service-specific capability analysis (§6)

### company_evidence_graph

```
COMPANY_PRODUCTION_EXECUTOR_READY = NO
```

A service orchestrator and provider-adapter interface exist in
`packages/service-runtime`, extensively tested (per SUN-1206's regression
ledger: 145/145 service-runtime tests, 170+6 provider-adapter tests). The only
company-evidence data source ever exercised in tests is fixture SEC submissions
JSON, imported by the now-removed production `paid-services.ts` path -- never by
`index.ts`. No live company-data provider composition (constructor, credential,
production wiring) exists anywhere in the current production entrypoint. Fixture
SEC data is explicitly distinguished from any live evidence source and is
unreachable in production.

### web_context_verified

```
WEB_HTTP_PRODUCTION_EXECUTOR_READY = NO
WEB_RENDERED_PRODUCTION_EXECUTOR_READY = NO
```

Direct HTTP orchestration and SSRF guards exist and are tested, but -- like
every other service -- are only reachable through the disabled
`paid-services.ts` module, never `index.ts`. `env.BROWSER` (Browser Rendering)
is a declared binding with zero source dereferences anywhere in the live request
path (confirmed by grep across `apps/edge-api/src`), so rendered mode has no
production composition at all, independent of the plain-HTTP question. Neither
mode is collapsed into a single classification.

### document_evidence_json

```
DOCUMENT_PRODUCTION_EXECUTOR_READY = NO
```

The document worker bridge
(`packages/service-runtime/src/services/ document-evidence/worker-bridge.ts`)
has only a `FixtureDocumentWorkerBridge` production-reachable implementation
(removed from `index.ts`'s import graph) and a local Python subprocess bridge
used for `services/modal-worker`'s own test/integration suite -- neither is
Worker-runtime compatible for direct inline execution. SUN-1206 additionally
found the Modal live artifact accessor raises `NotImplementedError`. Nothing in
this checkpoint's source review found evidence that changed since.

### verify_agent_output

```
VERIFY_PRODUCTION_EXECUTOR_READY = NO
```

This is the most-hardened service in the whole project (SITEBORNE JSON Schema
Profile 1, the pre-economic schema gate, the eval-free `@cfworker/json-schema`
interpreter, extensive differential/adversarial testing across SUN-1200-1205) --
but hardening the _verification engine_ is not the same claim as a complete paid
_production execution composition_. The deterministic verification engine itself
is real and Worker-compatible; what's still absent is the same missing
composition every other service lacks: a production receipt signer, and
production artifact/audit persistence, wired into a route `index.ts` actually
calls.

## 5. Receipt / proof signing (§7)

```
PAID_RECEIPT_SIGNER_READY = NO
```

Exhaustive search (`find packages/service-runtime/src -iname "*signer*"`) found
exactly one signer implementation in the entire service-runtime package:
`packages/service-runtime/src/pcc/test-signer.ts` (`createFixtureSigner`) -- a
deterministic Ed25519 test key, explicitly fixture/test-only, unreachable from
production. There is no second, production-grade Ed25519 (or any) paid-evidence
signer anywhere in the repository.

SITEBORNE does have exactly one real production signing key in Cloudflare today:
`AGENT_CARD_SIGNING_PRIVATE_KEY`, an ES256 (P-256) JWK used exclusively for A2A
Agent Card identity signing (`resolveAgentCardSigningIdentity`), a completely
different purpose, algorithm family, and trust boundary from a paid-service
PCC/receipt signature. Repurposing it would conflate two independent security
domains and was correctly not done.

**Missing signer/key infrastructure, exactly:**

- a production Ed25519 (or whatever algorithm the PCC/receipt spec requires)
  signing key, provisioned and bound as a Cloudflare secret distinct from
  `AGENT_CARD_SIGNING_PRIVATE_KEY`;
- a production signer abstraction implementation (parallel to
  `createFixtureSigner`, but reading the real secret);
- a public-key discovery mechanism for verifiers (paid-receipt equivalent of
  `/.well-known/jwks.json`, which today only publishes the Agent Card key);
- a key-rotation model and key ID scheme for the new key family.

## 6. Artifact persistence (§8)

```
PRODUCTION_ARTIFACT_PERSISTENCE_READY = NO
```

Refining SUN-1206's summary with direct source evidence: there are **two**
`ArtifactStore` implementations, not zero.
`apps/edge-api/src/control-plane/artifacts/store.ts` contains both
`InMemoryArtifactStore` (non-durable, process-lifetime only) and a genuinely
production-shaped `R2ArtifactStoreAdapter` (constructor takes a real `R2Bucket`,
computes SHA-256 content hashes, stores `authorization-class`/`retention-class`
custom metadata). However:

```
artifact generated?              only by the disabled paid-service path -- N/A today
artifact store abstraction?      YES (ArtifactStore interface)
production implementation?       YES, EXISTS (R2ArtifactStoreAdapter) but UNUSED
Cloudflare binding/resource?     ABSENT -- `ARTIFACTS` R2 binding is commented
                                  out in wrangler.toml (`# binding = "ARTIFACTS"`,
                                  since SUN-0800B checkpoint 3, R2 dashboard
                                  enablement never completed)
retention policy?                modeled in the adapter's custom metadata
                                  scheme, never exercised end-to-end
content addressing/checksum?     YES, implemented (SHA-256, `computeHash`)
retrieval path?                  implemented in the adapter, unreachable
ownership/access control?        not evaluated -- moot while unreachable
```

`index.ts` constructs only `new InMemoryArtifactStore()` -- the R2 adapter is
never imported by the production entrypoint at all. Even if it were imported,
there is no bound R2 resource to construct it with. This is a genuinely more
precise finding than "no complete artifact/audit composition is wired": the
_code_ for a real store exists and appears well-formed; what's missing is (a)
production wiring and (b) the actual R2 bucket provisioning that was deferred
all the way back at SUN-0800B checkpoint 3.

## 7. Audit persistence (§9)

```
PRODUCTION_SERVICE_AUDIT_READY = NO
```

`audit_events` and `security_events` D1 tables exist (migration `0001`) with
real, tested repository code
(`apps/edge-api/src/control-plane/repositories/d1/quota-audit-security.ts`,
`acquisition.ts`, `payment-attempts.ts`) -- but, exactly like the artifact
store, this repository layer is invoked by the D1 integration tests and by
non-paid-execution control-plane paths (job dispatch, quota, security events),
never by any paid-service execution flow, because the paid-service execution
flow itself does not exist in production. There is no correlation of a
successful charged request to a payment identifier, service result
classification, or receipt reference anywhere reachable from `index.ts`, because
no charged request can currently occur at all.

> Can a successful charged request currently leave a durable, governable audit
> record? **No — because no successful charged request can currently occur in
> production**, not because the audit schema/repository layer is itself broken.
> The two facts are related but distinct, and worth keeping separate for whoever
> scopes SUN-1214.

## 8. Persistence / idempotency model (§13/§15)

```
PAID_EXECUTION_PERSISTENCE_MODEL_READY = PRESENT_BUT_NOT_PRODUCTION_READY
ECONOMIC_IDEMPOTENCY_READY = PRESENT_BUT_NOT_PRODUCTION_READY
```

This is the most important nuance this checkpoint adds beyond SUN-1206.
Migration head remains `0007`
(`2ef2a881f21ecae8e13b2dc47060d214502322e7b427453616d8bf227a0256be`, matching
SUN-1206 exactly), with real durable tables for exactly this purpose:
`payment_attempts`, `x402_quotes`, `x402_service_results`,
`idempotency_records`, `payment_quotes`, `quota_reservations`, `job_artifacts`,
`queue_dispatches`, `audit_events`, `security_events`. Real repository code
(`apps/edge-api/src/control-plane/repositories/d1/payment-attempts.ts`,
`x402-quotes.ts`, `idempotency.ts`, `acquisition.ts`) reads and writes them, and
`apps/edge-api/src/control-plane/routes/x402-service.ts` -- the shared x402
challenge/verify/settle protocol handler used across every paid-route test
harness in this project (SUN-1201-1204) -- genuinely calls into
`payment_attempts` and `x402_service_results`.

**But `x402-service.ts` is never imported by `index.ts`.** The production
entrypoint's paid-route handlers stop at
`productionServiceExecutorUnavailable()` before ever constructing an
x402-service route, so this real, tested, D1-backed payment-lifecycle
persistence layer -- including its idempotency-record mechanism, which is
exactly the duplicate-charge/duplicate-execution defense §13 asks about -- is
currently inert in production, not because it's broken, but because nothing in
the real request path ever reaches it.

**Exact unresolved duplicate-charge / duplicate-execution risk:** none is
currently exercisable, because no execution path exists to duplicate. The risk
that must be re-verified once a service executor is wired in is whether
`idempotency_records` correctly dedupes (a) repeated settlement attempts against
the same payment identifier and (b) repeated service execution after a
post-payment crash/retry -- both are modeled in the schema and exercised in
`x402-service.ts`'s own test suite (per SUN-1206's regression ledger, 504/504
x402 tests), but have never been exercised end-to-end through an actual
paid-service executor, because that executor doesn't exist yet.

## 9. CDP/x402 rail (§10)

```
CDP_RAIL_PRODUCTION_READY = NO
```

Challenge generation, payment verification, payment-identifier handling,
settlement flow, replay/idempotency control, and canonical pricing are all
independently implemented and heavily tested (SUN-1200-1205: `x402-service.ts`,
`protocol-x402` package, `production-payment.ts`'s
`resolveProductionCdpEvidenceProvider`/`checkProductionBindingsPresent`, proven
fail-closed to `{evidenceMode:'fixture'}` on any missing/mismatched credential).
All 4/4 required CDP secrets exist by name in the live Cloudflare account
(`AGENT_CARD_SIGNING_PRIVATE_KEY`, `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`,
`NVM_API_KEY` -- confirmed via `wrangler versions view` during SUN-1212).

The blocking gap is not the CDP payment machinery itself -- it is that nothing
in this rail is reachable from `index.ts` at all, for the same reason as every
other component in this report: the production paid-route handlers never
construct an x402-service route, a CDP evidence provider, or a service executor.
Governed ordering
(`route readiness -> economic challenge -> payment authorization -> executable service -> result -> settlement -> durable evidence/audit`)
is correctly enforced _within the tested, non-production module graph_
(SUN-1201/1204's worker-runtime harness proves this ordering under real
workerd), but that graph is deliberately never imported by production. There is
no point in the current production path where economics can succeed while
service delivery cannot, because economics cannot be reached at all -- this is
the correct, fail-closed state, not a partial/unsafe one.

## 10. Nevermined rail (§11)

```
NEVERMINED_PRODUCTION_ENVIRONMENT_READY = NO
NEVERMINED_RAIL_PRODUCTION_READY = NO
```

`NVM_API_KEY` is present as a real Cloudflare secret and `NVM_ENVIRONMENT` is
committed as `"sandbox"` in `wrangler.toml`'s `[vars]` (both confirmed live
during SUN-1205/SUN-1212 work). Per
`packages/protocol-nevermined/src/config.ts`'s `resolveNeverminedConfig`,
`NVM_ENVIRONMENT` must be exactly `'sandbox'` -- `'live'` is explicitly,
permanently rejected regardless of any other configuration, per the standing
Nevermined-live hard-disable established across SUN-1000-series checkpoints.
Secret presence is explicitly not equated with production readiness here: a
sandbox environment is a testnet-equivalent surface by design, and no
configuration path in this codebase currently permits real production economic
operation over Nevermined regardless of what secrets exist. As with CDP, the
deeper blocker (no service executor reachable from `index.ts`) applies equally
to this rail.

## 11. Pricing authority (§12)

```
PRICE_AUTHORITY_READY = YES (as designed; unreachable in production, same as everything else)
PRICE_DRIFT = NONE
```

`governance/RISK_LIMITS.yaml` remains the single governance source;
`packages/pricing/src/service-prices.ts`'s `EMBEDDED_PRICING` constant is the
actual bundled-Worker source (since `import.meta.url`-relative reads don't
survive esbuild bundling); `pnpm pricing:check`
(`scripts/check-embedded-pricing-drift.mts`, wired into `pnpm check` since
SUN-1203) automatically fails on any divergence. This layer is real, tested, and
would already correctly govern prices the moment a service executor existed to
consult it. No price was changed by this checkpoint.

## 12. Worker-runtime compatibility (§16)

```
WORKER_RUNTIME_PRODUCTION_DEPENDENCIES_READY = NO
```

The one unambiguous, unresolved Worker-runtime blocker across all four services
is `document_evidence_json`: its only implementations are a local Python
subprocess bridge (Node/Python-only, `child_process`-class dependency, cannot
run in `workerd`) and Modal remote-call code whose live artifact accessor raises
`NotImplementedError`. This is a real, structural Worker-compatibility gap, not
a wiring gap alone -- closing it requires a genuine Worker-compatible
document-processing bridge (fetch-based Modal invocation, or an alternative),
not just import-graph rewiring.

The other three services' orchestration code (`company_evidence_graph`,
`web_context_verified`, `verify_agent_output`) was already proven Worker-
compatible under real `workerd` via the test-only entrypoint across
SUN-1201-1204 (`pnpm test:worker-runtime`, 66/66 as of SUN-1206's ledger) --
their blocker is production wiring/signer/persistence, not runtime compatibility
per se.

## 13. Failure-state matrix (§14)

For every route today, the entire failure-state space collapses to two outcomes,
both pre-economic and both proven under real `workerd` (SUN-1206's
`LIVE_EXECUTION_WORKERD_MATRIX`, 12/12 each):

| Trigger                                | HTTP/result                           | Economic effect possible? | Provider call possible? | Service work performed? | Retry safe?            | Durable recovery state? |
| -------------------------------------- | ------------------------------------- | ------------------------- | ----------------------- | ----------------------- | ---------------------- | ----------------------- |
| route flag absent (current live state) | 404                                   | NO                        | NO                      | NO                      | YES (idempotent no-op) | N/A -- nothing recorded |
| route flag mistakenly enabled          | 503 `service_executor_not_configured` | NO                        | NO                      | NO                      | YES (idempotent no-op) | N/A -- nothing recorded |

Every other failure mode listed in §14 of the governing directive (provider
timeout, artifact persistence failure, receipt signing failure, post-payment
execution failure, post-execution settlement failure, Nevermined entitlement
denial, etc.) is currently **not applicable** in production -- not because it
was tested and found safe, but because the code paths that could produce those
failures are unreachable. This is the correct fail-closed state for today, but
it means **none of those failure modes have been re-validated against a real
production executor**, since none exists yet; they were proven correct only in
the test-only, non-production module graph. Any future service-executor wiring
must re-prove this exact failure matrix against the real composition before
activation, not assume the earlier test-only proofs still apply unchanged.

**No R0 currently exists in the failure matrix** because no failure state
capable of charging without deliverable/auditable output is reachable at all in
production.

## 14. MCP bypass analysis (§19)

```
MCP_CAN_BYPASS_PAID_ROUTE_DISABLEMENT = NO
```

Verified directly in `packages/protocol-mcp/src/server.ts`: the
`defaultBoundary: McpServiceExecutionBoundary` used by
`apps/edge-api/src/routes/mcp.ts` (the real production MCP route)
unconditionally returns
`{ outcome: 'payment_required', code: 'payment_required' }` for every tool
invocation -- this is a hardcoded default, entirely independent of
`PAID_ROUTES_ENABLED`/ `NEVERMINED_ROUTES_ENABLED`, and does not consult, call,
or fall through to `production-paid-services.ts` or any REST paid-route handler
at all. MCP has its own, separate, independently fail-closed boundary; it
neither depends on nor can circumvent the REST paid-route flags. Confirmed live
during SUN-1212 (discovery listed 6 tools correctly; no tool invocation was
attempted, and none would have succeeded past `payment_required` regardless).

```
tool maps to which service/rail?          all 4 SITEBORNE service tools map
                                            1:1 to the same 4 services; a 5th
                                            tool (siteborne_get_quote) and a
                                            6th (siteborne_get_service_health)
                                            are quote/health only, never execute
can invocation reach economics now?       NO (payment_required unconditionally)
what happens without payment?             payment_required, no execution
what happens with hypothetical valid
  payment?                                cannot occur -- MCP has no payment-
                                            acceptance path at all in production;
                                            it is discovery/quote-only today
does structural service-unavailability
  gate still protect it?                  YES, redundantly -- MCP's own
                                            default boundary is independently
                                            fail-closed even before REST's gate
                                            would matter
can MCP bypass REST activation
  controls?                               NO
```

## 15. Activation dependency graph (§20)

```
route enabled
  |
  v
production service executor        <- ABSENT for all 4 services (§4)
  |-- live provider(s)              <- ABSENT (company: no live data source;
  |                                    web: HTTP orchestration exists but
  |                                    unwired, rendered mode entirely absent;
  |                                    document: Worker-incompatible bridge;
  |                                    verify: engine exists, unwired)
  |-- receipt signer                <- ABSENT (§5; only a fixture signer exists)
  |-- artifact persistence          <- ABSENT in production (§6; R2 adapter
  |                                    code exists but unwired and unbound)
  |-- audit persistence             <- ABSENT in production (§7; D1 schema/
  |                                    repos exist but unreachable)
  |-- idempotency/recovery state    <- PRESENT AS DESIGN, UNREACHABLE (§8;
  |                                    real D1 schema + x402-service.ts logic,
  |                                    never imported by index.ts)
  |__ Worker-compatible runtime     <- 3/4 services proven compatible in the
                                       test-only graph; document service
                                       genuinely incompatible today (§12)
  |
  v
economic rail readiness
  |-- CDP/x402                      <- machinery real and tested, unreachable
  |                                    from production (§9)
  |__ Nevermined                    <- machinery real, sandbox-only by design,
                                       unreachable from production (§10)
```

Every node under "production service executor" is the actual, single governing
blocker: nothing downstream of it matters until it exists, because nothing
downstream is reachable without it.

## 16. Minimum-safe activation condition (§21)

```
ROUTE_ELIGIBLE =
  executor_ready              (route-specific production composition exists
                                and is Worker-compatible end to end)
  AND provider_ready          (every external dependency has a real,
                                credentialed, Worker-compatible production
                                implementation)
  AND signer_ready            (a real production PCC/receipt signing key
                                and signer abstraction exist, distinct from
                                the Agent Card identity key)
  AND persistence_ready       (artifact store is durable -- R2-backed,
                                bound, and wired -- not in-memory)
  AND audit_ready             (audit/security-event repositories are
                                genuinely called by the executor, not merely
                                reachable by unrelated control-plane paths)
  AND idempotency_ready       (the existing D1 idempotency/x402 persistence
                                layer is actually imported and exercised by
                                the production route, and its dedupe
                                behavior is re-proven against the real
                                composition, not assumed from earlier
                                test-only proofs)
  AND runtime_compatible       (proven under real workerd, not merely typed)
  AND economic_rail_ready      (CDP or Nevermined, per route, reachable end
                                to end from the real production entrypoint)
  AND fixture_unreachable      (PRODUCTION_FIXTURE_REACHABILITY stays 0
                                after wiring -- the executor must be a real
                                composition, never a fixture fallback)
  AND failure_matrix_safe      (every failure state in §13 above is
                                re-proven against the real composition, not
                                inherited from the test-only graph)
```

This is offered as the governing activation criterion for SUN-1214 and beyond.
Every term above is currently `NO` or `UNREACHABLE` for all 12 routes; none is a
small residual gap.

## 17. Per-route readiness table (§22)

| Route                                   | Executor | Provider                        | Signer | Artifact | Audit  | Persistence | Idempotency | Worker runtime                             | Economic rail              | Fail-closed | Fixture-free | **Ready** |
| --------------------------------------- | -------- | ------------------------------- | ------ | -------- | ------ | ----------- | ----------- | ------------------------------------------ | -------------------------- | ----------- | ------------ | --------- |
| `/v1/company/evidence-graph`            | ABSENT   | ABSENT                          | ABSENT | ABSENT   | ABSENT | UNREACHABLE | UNREACHABLE | READY (test-only proof)                    | UNREACHABLE                | YES         | YES          | **NO**    |
| `/v1/web/context`                       | ABSENT   | PARTIAL (HTTP only, unwired)    | ABSENT | ABSENT   | ABSENT | UNREACHABLE | UNREACHABLE | READY (test-only proof)                    | UNREACHABLE                | YES         | YES          | **NO**    |
| `/v1/document/evidence-json`            | ABSENT   | ABSENT                          | ABSENT | ABSENT   | ABSENT | UNREACHABLE | UNREACHABLE | **NOT READY** (Worker-incompatible bridge) | UNREACHABLE                | YES         | YES          | **NO**    |
| `/v1/verify/agent-output`               | ABSENT   | N/A (deterministic engine only) | ABSENT | ABSENT   | ABSENT | UNREACHABLE | UNREACHABLE | READY (test-only proof)                    | UNREACHABLE                | YES         | YES          | **NO**    |
| `/v2/company/evidence-graph`            | ABSENT   | ABSENT                          | ABSENT | ABSENT   | ABSENT | UNREACHABLE | UNREACHABLE | READY (test-only proof)                    | UNREACHABLE                | YES         | YES          | **NO**    |
| `/v2/web/context`                       | ABSENT   | PARTIAL (HTTP only, unwired)    | ABSENT | ABSENT   | ABSENT | UNREACHABLE | UNREACHABLE | READY (test-only proof)                    | UNREACHABLE                | YES         | YES          | **NO**    |
| `/v2/document/evidence-json`            | ABSENT   | ABSENT                          | ABSENT | ABSENT   | ABSENT | UNREACHABLE | UNREACHABLE | **NOT READY**                              | UNREACHABLE                | YES         | YES          | **NO**    |
| `/v2/verify/agent-output`               | ABSENT   | N/A                             | ABSENT | ABSENT   | ABSENT | UNREACHABLE | UNREACHABLE | READY (test-only proof)                    | UNREACHABLE                | YES         | YES          | **NO**    |
| `/v2/nevermined/company/evidence-graph` | ABSENT   | ABSENT                          | ABSENT | ABSENT   | ABSENT | UNREACHABLE | UNREACHABLE | READY (test-only proof)                    | UNREACHABLE (sandbox-only) | YES         | YES          | **NO**    |
| `/v2/nevermined/web/context`            | ABSENT   | PARTIAL                         | ABSENT | ABSENT   | ABSENT | UNREACHABLE | UNREACHABLE | READY (test-only proof)                    | UNREACHABLE (sandbox-only) | YES         | YES          | **NO**    |
| `/v2/nevermined/document/evidence-json` | ABSENT   | ABSENT                          | ABSENT | ABSENT   | ABSENT | UNREACHABLE | UNREACHABLE | **NOT READY**                              | UNREACHABLE (sandbox-only) | YES         | YES          | **NO**    |
| `/v2/nevermined/verify/agent-output`    | ABSENT   | N/A                             | ABSENT | ABSENT   | ABSENT | UNREACHABLE | UNREACHABLE | READY (test-only proof)                    | UNREACHABLE (sandbox-only) | YES         | YES          | **NO**    |

`Ready=YES` for zero rows. `Fail-closed` and `Fixture-free` are the two columns
that are uniformly green -- correctly, since that's the entire point of
SUN-1206's work.

## 18. Per-service blocker list (§23)

```
PSVC-R0-001
service: company_evidence_graph (all versions/rails)
missing: production live company-data provider composition
file/module: packages/service-runtime (provider-adapter interfaces exist,
  no production constructor); apps/edge-api/src/control-plane/routes/
  production-paid-services.ts (no executor at all)
impact: no company evidence can be produced in production; activating this
  route today would either fail 100% of requests after payment (worse than
  current 404) or require reintroducing fixture data (explicitly forbidden)
closure proof: real, credentialed, workerd-compatible production data
  source wired to a genuine executor, proven under real workerd against
  the actual composition (not the test-only graph)

PSVC-R0-002
service: web_context_verified (HTTP mode, all versions/rails)
missing: production executor wiring (orchestration/SSRF code itself is
  real and tested)
file/module: production-paid-services.ts; index.ts's paid-route handlers
impact: same as PSVC-R0-001, less severe since the underlying logic exists
closure proof: wire the existing tested HTTP orchestration into a real
  production executor, with signer/artifact/audit, proven under real
  workerd against the actual composition

PSVC-R0-003
service: web_context_verified (rendered mode, all versions/rails)
missing: Browser Rendering (`env.BROWSER`) production wiring entirely --
  zero source dereferences anywhere in the live request path
file/module: no file exists yet
impact: rendered-mode paid execution has no implementation to even wire
closure proof: a genuine Browser-Rendering-backed executor, proven under
  real workerd, plus resource/cost controls

PSVC-R0-004
service: document_evidence_json (all versions/rails)
missing: Worker-compatible document processing bridge
file/module: packages/service-runtime/src/services/document-evidence/
  worker-bridge.ts (fixture only); services/modal-worker (Python
  subprocess, not Worker-runtime compatible)
impact: paid document execution cannot complete in a Cloudflare Worker at
  all -- this is the one service with a genuine runtime-compatibility gap,
  not merely a wiring gap
closure proof: real Worker-compatible (fetch-based) Modal invocation or
  equivalent, proven under real workerd through the production composition,
  including the Modal live artifact accessor (currently raises
  NotImplementedError)

PSVC-R0-005
service: verify_agent_output (all versions/rails)
missing: production executor wiring around an otherwise-qualified
  deterministic verification engine
file/module: production-paid-services.ts; index.ts's paid-route handlers
impact: lowest-severity of the four in engineering terms (the hard
  verification/Profile-1 problem is already solved and heavily hardened),
  but still R0 because no production executor exists to invoke it
closure proof: wire the existing Profile 1 engine into a real production
  executor with signer/artifact/audit, proven under real workerd

PSVC-R0-006 (cross-cutting, all 12 routes)
service: all
missing: production PCC/receipt signer (Ed25519 or equivalent), distinct
  from the Agent Card ES256 key
file/module: packages/service-runtime/src/pcc/ (only test-signer.ts exists)
impact: no route can produce a genuine, verifiable paid-service receipt
  regardless of every other blocker being closed
closure proof: real production signer implementation + provisioned key +
  public-key discovery endpoint + rotation model, proven via real-workerd
  signature verification against the actual production key material

PSVC-R0-007 (cross-cutting, all 12 routes)
service: all
missing: durable production artifact persistence wiring
file/module: apps/edge-api/src/control-plane/artifacts/store.ts
  (R2ArtifactStoreAdapter exists, unused); wrangler.toml (ARTIFACTS R2
  binding commented out since SUN-0800B checkpoint 3)
impact: no service result can durably persist; InMemoryArtifactStore is
  process-lifetime only and unsuitable for any paid, auditable result
closure proof: provision the R2 bucket, uncomment/bind ARTIFACTS, wire
  R2ArtifactStoreAdapter into the real executor, prove real put/get/
  content-hash round-trips under real workerd with a real R2 binding

PSVC-R0-008 (cross-cutting, all 12 routes)
service: all
missing: production audit-sink wiring for paid execution specifically
file/module: apps/edge-api/src/control-plane/repositories/d1/
  quota-audit-security.ts (real, but only called by non-paid-execution
  control-plane paths today)
impact: a successful charged request would leave no durable, governable
  audit trail correlating payment identifier, service result, and receipt
closure proof: wire the existing audit-events D1 repository into the real
  executor's success/failure paths, prove real D1 writes under real workerd
```

## 19. Rail blocker list (§24)

```
CDP_R0_BLOCKERS = [
  same PSVC-R0-006/007/008 (signer/artifact/audit) apply identically to
  the CDP rail, since they are shared, service-independent infrastructure
  -- no CDP-specific rail blocker exists beyond "no service executor
  exists to consult it"; the x402 payment machinery itself
  (challenge/verify/settle/idempotency) is already real, tested, and
  would work correctly the moment an executor called into it
]

NEVERMINED_R0_BLOCKERS = [
  NVM-R0-001: NVM_ENVIRONMENT is permanently pinned to "sandbox" by
    resolveNeverminedConfig's hard-disable of "live" -- this is a
    deliberate, standing safety decision from the SUN-1000 series, not an
    oversight, and reversing it is explicitly out of SUN-1213's (and any
    inventory checkpoint's) scope; it requires its own separately
    authorized checkpoint if ever revisited,
  same PSVC-R0-006/007/008 apply identically to the Nevermined rail as
    well, for the same reason as CDP
]
```

Keeping these separate matters exactly as the directive anticipated: a service
could in principle become technically executable (signer, artifact, audit,
executor all wired) while the Nevermined rail specifically remains unsafe to
activate (sandbox-only), even though the CDP rail for that same service would be
eligible. No such split currently exists in practice because the cross-cutting
infrastructure (signer/artifact/audit) blocks every route on every rail equally
today -- but the distinction is worth preserving for SUN-1214's scoping.

## 20. Activation strategy (§25)

```
ACTIVATION_STRATEGY = NONE_READY
```

No route qualifies for any activation grouping today. When cross-cutting
infrastructure (signer, artifact, audit -- PSVC-R0-006/007/008) is eventually
closed, the smallest independently qualified blast radius would be
`BY_SERVICE_AND_RAIL`: activate `verify_agent_output.v2` on the CDP rail first
(lowest remaining engineering risk -- the deterministic engine is already the
most hardened component in the repository), not all 12 at once, and not even all
4 services on one rail at once, since `document_evidence_json` carries a genuine
runtime-compatibility blocker none of the other three share.

## 21. Recommended implementation sequence (§26)

```
1. Production PCC/receipt signer (PSVC-R0-006) -- blocks every route
   equally; no route can be considered even partially ready without it.
   Can proceed in parallel with #2/#3.
2. Production artifact persistence (PSVC-R0-007) -- R2 bucket provisioning
   is an external action (dashboard enablement), independent of #1 and #3;
   can proceed in parallel.
3. Production audit-sink wiring (PSVC-R0-008) -- pure wiring of already-
   real D1 repository code; can proceed in parallel with #1/#2.
4. Pick the single smallest service/rail to wire an executor for first --
   recommend verify_agent_output.v2 / CDP, since its core logic is already
   the most mature and it has no runtime-compatibility gap. Depends on
   #1-#3 being closed first (or closed together as part of the same
   composition work).
5. Re-prove the full failure matrix (§13) against the real composition
   under real workerd -- depends on #4.
6. Re-prove economic-rail ordering and idempotency end-to-end through the
   real executor (not the test-only graph) -- depends on #4/#5.
7. A controlled, real paid economic end-to-end qualification (smallest
   possible real transaction, fully governed) -- depends on #1-#6.
8. Route activation for that one service/rail only -- depends on #7,
   requires its own separately authorized checkpoint.
9. Repeat #4-#8 for the next service (web_context_verified HTTP mode is
   the next-least-risky, having no runtime-compatibility gap).
10. document_evidence_json and web_context_verified rendered mode remain
    last, since both carry genuine runtime-compatibility work (#4 of §12)
    beyond wiring alone -- Browser Rendering composition and a
    Worker-compatible document bridge, respectively.
```

Tasks #1-#3 are the only ones parallelizable with each other; everything from #4
onward is a hard dependency chain per service.

## 22. Fixture reachability re-verification (§17/§28)

`git diff` between the frozen candidate commit and `HEAD` for
`production-paid-services.ts`/`index.ts` is empty (re-confirmed this checkpoint,
matching the same check already performed independently during SUN-1211). Direct
inspection of `index.ts`'s import list confirms zero fixture, test-signer,
test-artifact-store, or test-audit-sink symbols anywhere in the file -- the only
paid-route-adjacent import is `productionServiceExecutorUnavailable`, a module
that itself imports no service-runtime, provider, fixture, signer, worker
bridge, artifact store, or audit sink (confirmed by reading
`production-paid-services.ts` directly, which is 41 lines and contains exactly
the route list, the status constant, and the 503 handler).

```
PRODUCTION_FIXTURE_REACHABILITY = 0
PRODUCTION_FIXTURE_FALLBACK = NONE
PRODUCTION_RUNTIME_FIXTURE_MARKERS = 0
```

No regression. The full expensive release security suite
(`pnpm security:release`) was not re-run, per §28's own instruction not to
repeat it absent a contradiction -- none was found; source is byte-identical to
SUN-1206's last full run of that suite.

## 23. Current-production safety recheck (§29)

Re-run at closure:

```
GET /health = 200
GET /ready  = 200
GET /mcp    = 405
12/12 paid routes = 404
pnpm production:preflight = PASS
CURRENT_PRODUCTION_TRAFFIC = 100% (candidate f4f20676..., unchanged)
```

No deployment mutation occurred at any point in this checkpoint.

## 24. Final classifications (§30)

```
PAID_SERVICES_PRODUCTION_READY = NO
COMPANY_PRODUCTION_EXECUTOR_READY = NO
WEB_HTTP_PRODUCTION_EXECUTOR_READY = NO
WEB_RENDERED_PRODUCTION_EXECUTOR_READY = NO
DOCUMENT_PRODUCTION_EXECUTOR_READY = NO
VERIFY_PRODUCTION_EXECUTOR_READY = NO
PAID_RECEIPT_SIGNER_READY = NO
PRODUCTION_ARTIFACT_PERSISTENCE_READY = NO
PRODUCTION_SERVICE_AUDIT_READY = NO
PAID_EXECUTION_PERSISTENCE_MODEL_READY = PRESENT_BUT_NOT_PRODUCTION_READY
ECONOMIC_IDEMPOTENCY_READY = PRESENT_BUT_NOT_PRODUCTION_READY
WORKER_RUNTIME_PRODUCTION_DEPENDENCIES_READY = NO
CDP_RAIL_PRODUCTION_READY = NO
NEVERMINED_RAIL_PRODUCTION_READY = NO
MCP_CAN_BYPASS_PAID_ROUTE_DISABLEMENT = NO
PRODUCTION_FIXTURE_REACHABILITY = 0
PRODUCTION_FIXTURE_FALLBACK = NONE
ACTIVATION_STRATEGY = NONE_READY
PAID_ROUTE_ACTIVATION_ELIGIBLE = NO
```

Per §31 of the governing directive: since zero routes have a fully green
production dependency chain, the next checkpoint must be implementation, not
activation.

## 25. Blocker packet (§32)

```
R0_BLOCKERS = [
  PSVC-R0-001 (company evidence provider, all rails),
  PSVC-R0-002 (web HTTP executor wiring, all rails),
  PSVC-R0-003 (web rendered mode, no implementation at all, all rails),
  PSVC-R0-004 (document Worker-runtime incompatibility, all rails),
  PSVC-R0-005 (verify executor wiring, all rails),
  PSVC-R0-006 (production PCC/receipt signer, cross-cutting all 12 routes),
  PSVC-R0-007 (production artifact persistence wiring + R2 provisioning,
    cross-cutting all 12 routes),
  PSVC-R0-008 (production audit-sink wiring, cross-cutting all 12 routes)
]

R1_RELEASE_RISKS = [
  MCP application-layer rate limiting (carried from SUN-1206, still open,
    does not block activation eligibility itself since MCP cannot bypass
    paid-route disablement regardless),
  deployed-but-unreferenced bindings (CATALOG, JOBS, EVENTS, AI) --
    unused today, not a safety risk, but worth reconciling before any
    future binding audit,
  Schemathesis known schema-validation warnings (carried from SUN-1206,
    unchanged, not paid-execution-specific),
  the idempotency/x402 persistence layer's dedupe behavior has never been
    exercised end-to-end through a real production executor -- proven
    correct only in the test-only graph; must be re-proven once an
    executor exists (tracked as a dependency of PSVC-R0-006/007/008
    closure, not a standalone new risk)
]

R2_DEFERRED = [
  Browser Rendering cost/resource controls (moot until PSVC-R0-003 has
    any implementation to control),
  key-rotation model detail for the future PCC signer (moot until
    PSVC-R0-006 exists),
  rendered-mode-specific SSRF/timeout policy (moot until PSVC-R0-003
    exists)
]
```

## 26. Next checkpoint recommendation (§33)

```
PAID_ROUTE_ACTIVATION_ELIGIBLE = NO
```

Therefore, per the governing directive:

```
SUN-1214 -- Production Paid-Service Execution Composition
```

scoped to closing PSVC-R0-006 (signer), PSVC-R0-007 (artifact persistence), and
PSVC-R0-008 (audit wiring) first -- the three cross-cutting blockers that gate
every route equally -- and then wiring exactly one service/rail executor end to
end (recommended: `verify_agent_output.v2` / CDP, per §20's
smallest-blast-radius reasoning), proven under real workerd, before any route
activation is even considered. Activation itself remains a separately authorized
future checkpoint, not part of SUN-1214.

## 27. Mutation accounting (§1/§32-in-original-numbering)

```
VERSION_UPLOADS = 0
WORKER_VERSIONS_CREATED = 0
DEPLOYMENTS = 0
TRAFFIC_SHIFTS = 0
SECRET_CREATES_OR_UPDATES = 0
BINDING_CHANGES = 0
PAID_ROUTE_CHANGES = 0
ECONOMIC_FLAG_CHANGES = 0
PRODUCTION_MIGRATIONS = 0
PRODUCTION_D1_WRITES = 0
PRODUCTION_KV_WRITES = 0
PRODUCTION_R2_WRITES = 0
PRODUCTION_QUEUE_WRITES = 0
PAYMENT_SIGNATURES = 0
SETTLEMENTS = 0
TRANSACTIONS = 0
REAL_NEVERMINED_ECONOMIC_EFFECTS = 0
LIVE_PROVIDER_CALLS_PERFORMED = 0
SUN1213_SCOPE_VIOLATION = NONE
```

Cloudflare interaction throughout this checkpoint was limited to read-only
`wrangler deployments status` and public HTTP behavior checks already performed
in earlier sections and the standard `production:preflight`'s own read-only
`wrangler secret list` (names only). No secret value was read. No repository
file was modified beyond this evidence report.
