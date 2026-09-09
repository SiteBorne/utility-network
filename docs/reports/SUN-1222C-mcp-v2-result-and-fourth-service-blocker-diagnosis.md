# SUN-1222C-MCP-V2-RESULT-AND-FOURTH-SERVICE-BLOCKER-DIAGNOSIS

Read-only diagnostic checkpoint. No implementation, no deployment, no economic effect.

## Status correction

The prior checkpoint's `FOUR_SERVICE_ACCEPTANCE` framing is corrected here to:

`SUN1222C_MCP_FOUR_SERVICE_ACCEPTANCE=PARTIAL_WITH_BLOCKERS`

Only 3 of 4 services were exercised, and the one completed fulfilled result was schema-invalid.

## pcc_version finding: root cause proven, Class A

`PCC_VERSION_SCHEMA_FAILURE_REPRODUCED=YES` — reproduced cleanly. The real fulfilled `web_context_verified.v2` result's top-level keys are exactly `requested_url, retrieval_mode_requested, final_url, retrieval_mode_used, http_metadata, canonical_text, content_hash, truncation_status, character_count, byte_count` and others — a pure `WebContextExtension` business payload. Zero PCC-envelope fields (`pcc_version`, `job_id`, `subject`, ...) anywhere in it.

Traced end to end via direct source read:

- **Real PCC document IS correctly built.** `packages/service-runtime/src/pcc/builder.ts:85` sets `pcc_version: '1.0.0'` inside `buildDraftDocument()`, a shared, generic, non-service-specific PCC builder every service's `verify-and-sign.ts` call eventually uses.
- **That document is never attached to the HTTP response.** `apps/edge-api/src/control-plane/workflows/paid-continuation-workflow.ts`'s `DurableCachedResult.body` interface (line 263-270) has exactly five fields: `service_id, result_class, output, receipt_id, link_id, link_hash` — no `durableEvidence`, no `pcc`, no `pcc_version`. The real PCC/receipt/settlement-evidence documents live in a *sibling* field, `durableEvidence: { pcc, receipt, settlement_evidence, payment_service_link }` (line 272-277), which is stored durably but never serialized into `body`.
- **The wire response is exactly `cached.body`, unchanged.** `apps/edge-api/src/control-plane/routes/x402-service.ts:799`: `return c.json(cached.body, cached.status as never);` — no reshaping, no merge, nothing added.
- **My MCP adapter faithfully reproduces this.** `apps/edge-api/src/control-plane/mcp/x402-mcp-adapter.ts:151`: `result: body.output` — this is exactly the same `output` sub-field of the same wire body every REST caller receives. The adapter is not the defect.

```
PCC_VERSION_PRODUCER=packages/service-runtime/src/pcc/builder.ts (buildDraftDocument, shared across all 4 services)
PCC_VERSION_EXPECTED_CONTRACT=contracts/releases/2.0.0/schemas/services/*-output.schema.json (pcc_version required at output root)
PCC_VERSION_ACTUAL_REPRESENTATION=correctly built internally as durableEvidence.pcc; never serialized into the HTTP response body sent to any caller
PCC_VERSION_FAILURE_BOUNDARY=apps/edge-api/src/control-plane/workflows/paid-continuation-workflow.ts's DurableCachedResult.body construction (and x402-service.ts's verbatim c.json(cached.body) passthrough) -- the wire-response-construction boundary, not the PCC builder and not the MCP adapter
PCC_VERSION_ROOT_CAUSE_CLASS=A
PCC_VERSION_ROOT_CAUSE=Production result construction never attaches the real, correctly-built PCC envelope (or any of its fields, including pcc_version) to the HTTP response body any caller (REST, A2A, or MCP) receives; only opaque reference IDs (receipt_id, link_id, link_hash) are exposed, presumably for separate out-of-band receipt retrieval that does not currently exist as a callable endpoint in this codebase (not investigated further -- out of this checkpoint's scope).
```

One important caveat on the classification: `frozen-contracts.test.ts`'s existing "16/16 passing" suite (built in an earlier checkpoint, commit `0f8d101`) only ever validates the *schema's own bundled example* (`frozenOutputExample`) against itself -- a self-consistency check, not proof that real production output conforms. This diagnostic checkpoint is the first time a genuinely real `body.output` value has ever been checked against `MCP_SERVICE_OUTPUT_SCHEMAS`/`contracts/releases/2.0.0`. That is consistent with this gap being long-standing and undiscovered: across this entire engagement's R1-R10/Q1 real-payment attempts, none had ever previously reached a genuine `fulfilled` outcome to exercise this path.

```
V2_IDENTITY_SCHEMA_FIX_STATUS=CORRECT (reconfirmed: frozen-contracts.test.ts, 16/16 pass, unregressed)
PCC_VERSION_SCHEMA_AUTHORITY=contracts/releases/2.0.0/schemas/services/*-output.schema.json
PCC_VERSION_GOVERNANCE_ACTION_REQUIRED=YES -- a human decision is needed on which side is "correct": either (a) production result construction should attach the real PCC envelope to the response body, or (b) the output-schema authority should validate a receipt-retrieval-shaped object rather than the immediate payment response. This report does not decide that; it proves the facts on both sides.
```

## Cross-protocol impact: NOT MCP-specific

Because the failure boundary is the shared `x402-service.ts`/`paid-continuation-workflow.ts` wire-response construction, every protocol built on it inherits the identical gap:

```
REST_V2_PCC_VERSION_IMPACT=YES (direct proof: x402-service.ts:799's c.json(cached.body, ...) is the literal REST response for every caller, MCP included)
A2A_V2_PCC_VERSION_IMPACT=YES (apps/edge-api/src/routes/a2a.ts delegates to createSiteborneA2aHonoApp, itself built on the same underlying paid-route composition; not exhaustively re-traced within this checkpoint's time budget, but the response body A2A would ultimately validate is constructed by the same shared code, not a parallel implementation)
MCP_V2_PCC_VERSION_IMPACT=YES (this checkpoint's own direct proof)
```

This is explicitly **not** minimized because MCP discovered it -- it is a pre-existing, protocol-wide production-contract gap that predates the MCP work entirely.

```
PCC_VERSION_RELEASE_IMPACT=C
```

Explanation: this does **not** block MCP's own release path (MCP faithfully mirrors the same REST contract every other caller already receives; there is no MCP-specific regression to fix), and it does not represent a payment/settlement/security defect (zero economic invariant is affected -- settlement correctness, binding validation, and payment gating are all independently proven intact). It is a real, pre-existing gap in the *output-schema-vs-wire-response* contract that is safely isolated from the payment/settlement critical path, but should be resolved before any caller (REST, A2A, or MCP) is represented as producing "2.0.0-schema-valid" results, since today none of them do for a real fulfilled response.

## Cross-service PCC audit

| Service | PCC builder | pcc_version produced | Schema expects | Validation status | Evidence type |
|---|---|---|---|---|---|
| company_evidence_graph.v2 | packages/service-runtime/src/pcc/builder.ts (shared) | Yes, internally (`durableEvidence.pcc`), never on wire | Required at output root | Would fail identically (same wire-body shape) | SOURCE_PROOF_ONLY (this checkpoint's harness reached `rejected`, not `fulfilled`, for this service -- see the prior acceptance report) |
| web_context_verified.v2 | packages/service-runtime/src/pcc/builder.ts (shared) | Yes, internally, never on wire | Required at output root | Proven FAILS (missing `pcc_version`) | REAL_FULFILLED_RESULT (this checkpoint reproduced it directly) |
| document_evidence_json.v2 | packages/service-runtime/src/pcc/builder.ts (shared) | Yes, internally (same shared builder), never on wire | Required at output root | Would fail identically (same wire-body shape); never independently exercised | NOT_PROVEN (see blocker findings below -- route currently disabled in production, never reached `fulfilled` in any environment this engagement)  |
| verify_agent_output.v2 | packages/service-runtime/src/pcc/builder.ts (shared) | Yes, internally, never on wire | Required at output root | Would fail identically (same wire-body shape) | SOURCE_PROOF_ONLY (this checkpoint's harness reached `rejected` -- real independent verification mesh rejection -- not `fulfilled`, for this service) |

The company/document/verify rows are `SOURCE_PROOF_ONLY`/`NOT_PROVEN` rather than independently reproduced failures, because none of those three has ever reached a genuine `fulfilled` state in this engagement to directly inspect. The classification rests on direct proof that all four services share the exact same `DurableCachedResult.body` construction and the exact same `c.json(cached.body, ...)` wire-response code path (`paid-continuation-workflow.ts` and `x402-service.ts` are service-agnostic, parametrized only by `config.serviceId`) -- there is no service-specific branch that would cause one service's wire body to differ in shape from another's.

```
COMPANY_V2_PCC_VALIDATION=would_fail (source-proven, not independently reproduced)
WEB_CONTEXT_V2_PCC_VALIDATION=proven_fails (directly reproduced)
DOCUMENT_V2_PCC_VALIDATION=not_proven (route disabled; see below)
VERIFY_V2_PCC_VALIDATION=would_fail (source-proven, not independently reproduced)
```

## document_evidence_json.v2: the prior "two external blockers" claim was WRONG

The prior acceptance checkpoint's report said this service is "structurally unavailable in any environment today" due to two external blockers, sourced from a doc comment inside `document-evidence-json-v2-cdp-composition.ts`. This checkpoint checked the **live production state directly** rather than trusting that comment, and found the comment is **stale**:

**Blocker 1 as claimed: `env.ARTIFACTS` R2 binding commented out in `wrangler.toml` pending dashboard enablement.**
Live check of the actual, current `wrangler.toml` (lines 144-154):
```
# SUN-0800B checkpoint 3: R2 bucket was commented out pending dashboard
# enablement. SUN-1222C-R1 confirmed R2 enabled at the account level and
# created the real bucket below (private, no managed/custom domain).
# SUN-1222C-1 uncomments this binding -- ...
[[r2_buckets]]
binding = "ARTIFACTS"
bucket_name = "siteborne-artifacts"
```
**RESOLVED.** The binding is active, uncommented, and has been since an earlier checkpoint (SUN-1222C-1). The composition file's own doc comment (describing this as still-commented-out) was never updated after that fix landed.

**Blocker 2 as claimed: `MODAL_DOCWORKER_ENDPOINT_URL`/`PROXY_KEY`/`PROXY_SECRET` credentials never provisioned (Modal App never deployed).**
Live check via `wrangler secret list --name siteborne-utility-edge` (names only, no values read or logged):
```
MODAL_DOCWORKER_ENDPOINT_URL   secret_text
MODAL_DOCWORKER_PROXY_KEY      secret_text
MODAL_DOCWORKER_PROXY_SECRET   secret_text
```
**RESOLVED.** All three secrets are present on the live production Worker. (This proves the credentials are *provisioned* -- it does not by itself prove the Modal App they point to is deployed and reachable; that was not independently tested, per the zero-effect accounting below, since doing so would require constructing a real request through the executor.)

### What the actual, current blocker is

Live check of the real, public, non-payment catalog endpoint (`GET /catalog`, read-only, zero economic effect):
```json
{
  "service_id": "document_evidence_json.v2",
  "production_enabled": false,
  "production_ready": false,
  "protocol_status": "preproduction"
}
```
`DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED` is absent from both `wrangler.toml`'s `[vars]` and the live secret list -- it is simply unset. This is the **same deliberate, simple, config-only "candidate qualified, awaiting explicit go-live authorization" pattern** every other service in this engagement went through its own dedicated activation checkpoint for (R5/R6/D14, etc.) -- not an unresolved external/provider problem.

```
DOCUMENT_V2_BLOCKER_1=RESOLVED (R2 ARTIFACTS binding, confirmed live since SUN-1222C-1)
DOCUMENT_V2_BLOCKER_2=RESOLVED (MODAL_DOCWORKER_* secrets, confirmed present on live production Worker)
DOCUMENT_V2_CURRENT_EXECUTABILITY=CONFIG_BLOCKED (DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED unset; both infra prerequisites the composition builder gates on are met)
```

Classification of each cited blocker:
```
DOCUMENT_V2_BLOCKER_1_CLASS=CONFIGURATION (was, now resolved)
DOCUMENT_V2_BLOCKER_2_CLASS=CREDENTIAL (was, now resolved)
```
Neither was ever MCP-specific; both were shared-service-backend infrastructure prerequisites that would equally have blocked REST and A2A callers.

## Readiness/advertising consistency: no inconsistency found

```
DOCUMENT_V2_ADVERTISED_EXECUTABLE=NO (catalog explicitly and correctly states production_enabled:false, production_ready:false, protocol_status:"preproduction")
DOCUMENT_V2_ACTUALLY_EXECUTABLE=UNKNOWN (infra prerequisites are met; whether a real request through the Modal doc-worker endpoint would actually succeed was not tested -- doing so would require a real executor invocation, out of this checkpoint's zero-effect scope)
DOCUMENT_V2_READINESS_CONSISTENT=YES (the catalog honestly discloses the service is not ready; there is no advertised-but-broken contradiction to flag)
```

## Minimum remediation design -- pcc_version (design only, not implemented)

This is a governance decision, not a mechanical bug fix -- two candidate directions, deliberately not chosen here:

**Option 1: attach the real PCC envelope to the wire response.**
- Files: `apps/edge-api/src/control-plane/workflows/paid-continuation-workflow.ts` (`DurableCachedResult.body` interface and its one construction site), `apps/edge-api/src/control-plane/mcp/x402-mcp-adapter.ts` (`result: body.output` -> whatever the new merged/nested field becomes).
- RED test: a real-shaped fulfilled REST/MCP response fails `contracts/releases/2.0.0` validation (this checkpoint's own reproduction already IS that RED test, transplantable into a permanent suite).
- Minimal GREEN: merge or nest `durableEvidence.pcc`'s fields into `body` (exact shape TBD by whoever makes the governance call -- flat merge vs. a new `pcc` sub-key changes what "the output schema" must describe).
- Mutation proof: revert the merge, confirm the same RED reappears.
- Cross-service regression: all four services share the construction site, so one fix covers all four.
- Contract-governance impact: changes the real wire contract for REST and A2A too, not just MCP -- needs sign-off beyond this MCP-scoped engagement.
- Production compatibility impact: any existing caller depending on the current (narrower) response shape is unaffected by an additive merge; a caller depending on the CURRENT absence of `pcc_version` (unlikely, but not verified) would not be.

**Option 2: correct the output-schema authority to describe what the wire response actually is.**
- Files: none in this repository -- `contracts/releases/2.0.0` is described elsewhere in this engagement as immutable/versioned; a new `2.1.0`/`3.0.0` release would be the mechanism, not an edit to `2.0.0` in place.
- Contract-governance impact: likely larger, since it changes the documented, discoverable contract every future integrator reads.

```
PCC_VERSION_REMEDIATION_REQUIRED=YES
PCC_VERSION_REMEDIATION_SCOPE=DESIGN_ONLY_PENDING_GOVERNANCE_DECISION (Option 1 vs Option 2 above; not chosen by this checkpoint)
```

## Minimum remediation design -- document_evidence_json.v2 (design only, not implemented)

Given both infrastructure prerequisites are confirmed resolved, the only remaining step to reach parity with the other three services is the same kind of explicit, standalone, human-authorized activation checkpoint every other service in this engagement required (flip `DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED`, verify `production_ready` flips true in the catalog, non-economic verification, then separately-authorized real-payment qualification). No code change is implicated by anything found in this checkpoint.

```
DOCUMENT_V2_REMEDIATION_REQUIRED=NO (no code fix required)
DOCUMENT_V2_NEXT_ACTION=EXTERNAL_ACTIVATION_DECISION_REQUIRED (an explicit go-live authorization, same pattern as prior service activations -- not a bug, not blocked on anything in this repository)
```

## Preserved findings (reconfirmed, unchanged)

Reconfirmed directly, not merely re-asserted:
```
PUBLIC_API_SETTLE_CALLSITES=0
MCP_ADAPTER_SETTLE_CALLSITES=0
DEDICATED_WORKFLOW_SETTLE_CALLSITES=1 (paid-continuation-workflow.ts:673, the sole real evidenceProvider.settle() call expression in the repository)
TOTAL_PRODUCTION_SETTLE_CALLSITES=1
```
The core MCP findings from the prior acceptance checkpoint stand: the official x402-MCP carrier works through the real route boundary, unpaid calls never reach useful execution, malformed payments are rejected, and economic binding guards are mutation-proven causal for all three exercisable services.

## Zero-effect accounting

```
LIVE_QUOTES_OR_INTENTIONAL_402_REQUESTS=0
REAL_SIGNING=0
PAID_REQUESTS=0
REAL_PROVIDER_CALLS=0
FACILITATOR_VERIFY_CALLS=0
FACILITATOR_SETTLE_CALLS=0
REAL_SETTLEMENTS=0
CHAIN_TRANSACTIONS=0
ECONOMIC_EFFECT_USDC=0
PRODUCTION_D1_WRITES=0
PRODUCTION_DEPLOYMENTS=0
TRAFFIC_MUTATIONS=0
SECRET_MUTATIONS=0
```
The only live production interaction performed this checkpoint was two read-only GETs: `wrangler secret list` (names only, values never read) and `GET /catalog` (the same public, non-payment discovery endpoint anyone can query). Neither creates state, cost, or economic effect.
