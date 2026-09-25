# R3-A1 Per-Service Qualification Matrix

Mission: R3-A1-PER-SERVICE-QUALIFICATION-08
Status: **READ-ONLY AUDIT**. No deploy, wrangler, Cloudflare, DNS, secrets, key, PAID_ROUTES_ENABLED, or other production/payment/settlement mutation was performed to produce this document. Live production surfaces (`/ready`, `/catalog`, `/.well-known/agent-card.json`, `/openapi.json`, `/health`) were read via plain `GET` requests only — informational reads, not mutations — to cross-check static repo claims against live behavior.

Repository: `/Users/meta4ickal/SITEBORNE Utility Network`, branch `metadata-vcm-qualification`, HEAD `892ffc1` (clean tree except this file).

---

## 0. Headline correction to the audit premise

The audit brief assumes **"~16 paid-capable services."** This does not match anything found in the repository or live production. Every canonical source (VCM's `service-id.ts`, `registry/services/*.json`, `packages/protocol-a2a/src/constants.ts:SITEBORNE_SERVICE_IDS`, `packages/protocol-x402/src/bazaar/registry-source.ts:ALL_BAZAAR_SERVICE_IDS`, `packages/service-runtime/src/types.ts:ALL_SERVICE_IDS`) independently agrees on the same set:

```
SERVICE_COUNT = 12   (4 capability families × 3 permanent parallel generations: v1 / v2 / v3)
```

Families: `company_evidence_graph`, `web_context_verified`, `document_evidence_json`, `verify_agent_output`. Per `docs/contracts/VERSIONING.md` and confirmed by code comments in `card.ts`/`registry-source.ts`, `.v1`/`.v2`/`.v3` are **permanent parallel identities**, not a deprecation ladder — there is no "latest wins" collapsing that would produce 4 or 16.

No file, constant, generator, or doc anywhere in the tracked tree produces "16." A targeted search for "16 paid"/"sixteen service" language found nothing tied to the service count. **Conclusion: MISMATCH.** The audit brief's "16" premise is not substantiated; this document proceeds on the evidenced count of **12** static service identities, of which **8** (the `.v2` and `.v3` sets) have a real, bundle-reachable production HTTP executor and the remaining **4** (`.v1`) do not (see §1.3).

A second, independently important correction: the audit brief states the A0 fix (`cd7ed96`) is "deployed to production Worker version `1ac3d6e2-b81c-43b0-abf7-f2972e95b9d5`." **This string does not appear anywhere in the tracked repository.** The repo's own same-day preflight record (`docs/development/R3_A0_PRODUCTION_REMEDIATION_PREFLIGHT_2026-09-25.md`, untracked but present in the working tree) states the opposite:

```
CURRENT_PRODUCTION_VERSION=44567f1e-b47f-4047-93ca-6c8a6953bdfa
PRODUCTION_A0_FIX=NOT_DEPLOYED
BLOCKERS=None found. Awaiting explicit deployment authorization.
```

The A0 *fix itself* is proven correct and fully tested (308/311 passing across two independent runs, see §5), but **it is not confirmed deployed to production** by anything in this repository. Treat any external claim of a specific deployed Worker version id as unverified until read back live from Cloudflare by an authorized deploy-capable session — this audit did not attempt that (no `wrangler` commands were run, per the read-only constraint).

---

## 1. Service inventory and canonical-source reconciliation

### 1.1 Canonical identity source

`registry/services/*.json` (12 files) is the NORMATIVE identity/schema/pricing source, per `docs/reports/METADATA-VCM-MASTER-canonical-reference.md` Part I §I.8 (`SERVICE_ID_CANONICAL_OWNER = registry/services/*.json`). `packages/protocol-a2a/src/constants.ts:SITEBORNE_SERVICE_IDS` and `packages/protocol-x402/src/bazaar/registry-source.ts:ALL_BAZAAR_SERVICE_IDS` are hand-written arrays that today happen to agree with the registry file set byte-for-byte (12 ids, same order-independent set) but are not generated from it — a latent IDENTITY_DRIFT risk noted by the Master Reference, not yet realized.

`packages/vcm` (the Version/Catalog Manifest package) is a **shadow-only, unreleased** implementation (`packages/vcm/src/runtime-model.ts: VCM_RELEASE_VERSION = 'intentionally-unreleased'`). It imports `registry/services/*.json` statically and runs primary/shadow-compare projections for A2A and MCP, but per its own module doc comment: *"no existing metadata consumer's SERVED output ... is produced by this package yet."* It is not yet an authority for anything actually served.

### 1.2 Per-source enumeration

| Source | File(s) | Count | IDs |
|---|---|---|---|
| Registry (NORMATIVE) | `registry/services/*.json` | 12 | 4 families × v1/v2/v3 |
| VCM (shadow) | `packages/vcm/src/service-id.ts`, `legacy/import-registry.ts` | 12 | same set, imported from registry |
| A2A constants | `packages/protocol-a2a/src/constants.ts:SITEBORNE_SERVICE_IDS` | 12 | same set |
| Bazaar/x402 | `packages/protocol-x402/src/bazaar/registry-source.ts:ALL_BAZAAR_SERVICE_IDS` | 12 | same set |
| service-runtime | `packages/service-runtime/src/types.ts:ALL_SERVICE_IDS` | 12 | same set |
| **Live Agent Card** (`GET /.well-known/agent-card.json`) | — | **12** | v1×4, v2×4, v3×4 — confirmed live 2026-09-25 |
| **MCP tool map** | `packages/protocol-mcp/src/constants.ts:MCP_SERVICE_TOOLS` | **8** | v2×4, v3×4 only — **no `.v1` tool exists**, by design per in-code comment |
| **Real production HTTP routes** | `apps/edge-api/src/index.ts` mount list | **8** | v2×4, v3×4 only — `/v1/*` is an unconditional `app.all('/v1/*', c => c.notFound())` |
| **Live `/openapi.json`** | — | **8 paths** | v2×4, v3×4 — matches real routes exactly |
| **Live `/catalog`** | — | **8 entries**, but **v1×4 + v2×4** (confirmed live 2026-09-25) | includes the 4 dead-404 `.v1` ids; **omits all 4 real `.v3` ids** |
| Root `GET /` service list | `index.ts:277-282` | 4 | lists only `.v1` ids — stale/inverse of reality |

### 1.3 Reconciliation and flagged mismatches

- **SERVICE_COUNT = 12**, not 16 (see §0).
- **MCP↔registry gap (EXPECTED, by design):** MCP never wired `.v1` tools; a code comment in `constants.ts` states this explicitly ("v1 protocol evidence is preserved separately in fixtures/tests, not in this live map"). Classified **EXPECTED_PROJECTION_DIFFERENCE**.
- **Route reachability↔Agent Card gap (SEMANTIC_DRIFT, live-confirmed):** the Agent Card advertises 12 skills including 4 `.v1` skills that are unconditionally unroutable in production (`/v1/*` always 404s in `index.ts`). The card does carry a per-skill `production_enabled` overlay, but "unroutable" is a stronger and different fact than "not yet production-enabled," and the card does not distinguish the two. Classified **SEMANTIC_DRIFT** — worth a follow-up: either the `.v1` skills should carry an explicit `routable: false`/`retired_transport` marker, or `/v1/*` routing should be restored if `.v1` skills are meant to remain live-callable.
- **`/catalog`↔real routes gap (SEMANTIC_DRIFT, live-confirmed, most serious):** live `/catalog` returns the 8 `v1+v2` ids and omits all 4 real, executable `.v3` ids, while also listing the 4 unroutable `.v1` ids as if they were normal catalog entries (`production_enabled: false`, `protocol_status: preproduction` — not flagged as unroutable). Root cause, per `scripts/gates/check-v3-service-parity.ts:290-296`: `/catalog`'s backing D1 table is **seeded entirely out-of-band** — `CATALOG_SEED_AUTHORITY = 'NOT_FOUND_IN_REPO'`. No migration, seed script, or application code path in this repository inserts rows into the real `services`/`service_versions` D1 tables outside of tests; `index.ts` comments say the table was "seeded with 8 rows per SUN-0800B checkpoint 3," an out-of-band operational action untraceable in this repo. **This is the single most actionable finding in this audit**: the public catalog is materially stale relative to what the Worker can actually execute, in both directions (advertises dead routes, omits live ones). Classified **SEMANTIC_DRIFT**, high priority.
- **Root `GET /` gap:** lists only `.v1` ids, the inverse of the real route set. Classified **SEMANTIC_DRIFT**, low severity (informational endpoint, not a discovery/economic surface).

---

## 2. Per-service qualification matrix

Columns collapsed per **capability family** where v1/v2/v3 share a row-shape and differ only in the marked cells, to keep this readable; the full 12-row expansion is in §2.1.

Legend: **Y**=YES, **N**=NO, **P**=PARTIAL, **U**=UNKNOWN, **N/A**=NOT_APPLICABLE.

| Field | `.v1` (×4 families) | `.v2` (×4 families) | `.v3` (×4 families) |
|---|---|---|---|
| service_version | v1 | v2 | v3 |
| contract_version | `1.0.1` (compatibility role, per live `/catalog`) | `2.0.0` (current role) | `3.0.0-public-candidate` gate (contracts/releases/3.0.0) |
| schema_version (pcc_version) | `1.0.0` | `1.0.0` | `2.0.0` |
| REST exposure | N (unroutable, `/v1/*` hard-404) | Y (`POST /v2/...`) | Y (`POST /v3/...`) |
| MCP exposure | N | Y | Y |
| A2A exposure | Y (skill listed) | Y | Y |
| OpenAPI exposure | N (no path emitted) | Y | Y |
| Catalog exposure (live) | Y (stale — advertises unroutable service) | Y | **N** (missing from live catalog) |
| implemented | Y (registry entry + schemas exist) | Y | Y |
| discoverable | P (Agent Card only; not REST/MCP/OpenAPI/catalog-correct) | Y | P (catalog omits it; else Y) |
| request_validation | U (no live route to exercise; Zod/JSON-Schema types exist statically) | Y (`input-validators-generated-equivalence.test.ts`) | Y (same shared validator suite; `*-v3-rest-harness.test.ts` 400 cases) |
| authorization_path | N/A (route unreachable) | Y — `result-authorization.ts` wired into `x402-service.ts`/`mcp.ts` for `BUYER_AUTHORIZED` services; `PUBLIC` services skip by design | Y for `document_evidence_json.v3` & `verify_agent_output.v3` (in `RESULT_AUTHORIZATION_BLOCKED_SERVICES`); N/A/PUBLIC for the other two v3 families |
| economic_binding | N/A (unreachable) | Y (x402 exact-scheme quote/payment binding, live `payTo`/network resolved) | Y (same x402 binding, `release_posture: compatibility_not_admitted`/candidate) |
| execution_path | N/A | Y — `production-*-v2-cdp-route.ts` → `production-*-v2-cdp-composition.ts` → `packages/service-runtime/src/services/*/service.ts` | Y — `production-public-v3-candidate-routes.ts` → same per-family `service.ts` |
| assurance_path | N/A | Y — shared mesh (`runMesh`) inside `verify-and-sign.ts` | Y — same shared mesh |
| canonical_result_path | N/A | Y — `verifyAndSign()` (all 4 v2 services call it; see §5) | Y — same function, all 4 v3 services call it |
| persistence_path | N/A | Y — `PccResultArtifactStore` / D1 result-authorization repo | Y — same store; v3 fixtures explicitly exercise `company_evidence_graph.v3`/`web_context_verified.v3` |
| result_authorization_path | N/A | Y where `BUYER_AUTHORIZED`; PUBLIC_RESULT otherwise (governed by `governedResultConfidentiality`) | Y for the 2 blocked services; PUBLIC for the other 2 |
| settlement_path | N/A | Y — CDP/Nevermined settlement + `settlement-reconciliation.ts`, tested via one representative service per rail (see §3) | P — settlement-path code is shared with v2, but **no v3-specific payment-failure/duplicate-payment/settlement-retry test was found** (§3) |
| replay_path | N/A | Y — `packages/protocol-x402/src/replay/{idempotency,binding}.test.ts` (protocol-level) + `chaos-v2.test.ts` (service-level, one family) | Y — each `*-v3-rest-harness.test.ts` includes an explicit replay case |
| reconciliation_path | N/A | Y — `settlement-reconciliation.ts`, `nevermined-reconciliation-client.ts`, generic (not per-service) tests | P — shares the v2 mechanism per code comment, but not independently tested per v3 service |
| production_ready | N (route doesn't exist; would require a code change, not a flag flip) | P — code/tests are qualified per §5, but `registry/services/*.v2.json:production_enabled = false` and CDP mainnet credentials are unprovisioned (`.dev.vars.example`: `SELLER_WALLET_ADDRESS`, `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET` all blank/`blocked_external`) | P — `promotion_state: executable_candidate` (not yet promoted), `release_posture: compatibility_not_admitted`/candidate |
| production_enabled | N (registry `production_enabled: false`; also structurally unroutable) | N (live-confirmed: `production_services_enabled=false` at `/ready`; every catalog row shows `production_enabled: false`) | N (same global policy flag; also `RESULT_AUTHORIZATION_BLOCKED_SERVICES` gates 2 of the 4 even under auth) |

### 2.1 Full 12-row A1 status and blockers (expansion)

| service_id | A1 status | Key blockers beyond the policy flag |
|---|---|---|
| company_evidence_graph.v1 | **IMPLEMENTED_NOT_QUALIFIED** | Unroutable in production (`/v1/*` 404); not in MCP; not in OpenAPI; catalog entry is stale/misleading |
| web_context_verified.v1 | IMPLEMENTED_NOT_QUALIFIED | same as above |
| document_evidence_json.v1 | IMPLEMENTED_NOT_QUALIFIED | same as above |
| verify_agent_output.v1 | IMPLEMENTED_NOT_QUALIFIED | same as above |
| company_evidence_graph.v2 | **QUALIFIED_NOT_ENABLED** | CDP mainnet credentials unprovisioned (`SELLER_WALLET_ADDRESS`/`CDP_API_KEY_ID`/`CDP_API_KEY_SECRET`/`CDP_WALLET_SECRET` blank per `.dev.vars.example`); live catalog omission does not block execution but blocks honest discovery |
| web_context_verified.v2 | QUALIFIED_NOT_ENABLED | same CDP-credential blocker; best-tested service for settlement retry/duplicate-payment (representative in 3 shared suites) |
| document_evidence_json.v2 | QUALIFIED_NOT_ENABLED | same CDP-credential blocker; buyer-authorization enforcement path less directly tested at v2 (tests concentrate on v3 harness) |
| verify_agent_output.v2 | QUALIFIED_NOT_ENABLED | same CDP-credential blocker |
| company_evidence_graph.v3 | **PARTIAL** | `promotion_state: executable_candidate` (governance ladder not cleared); missing from live `/catalog`; no v3-specific payment-failure/settlement-retry test found; PUBLIC result class (no buyer-auth test needed) |
| web_context_verified.v3 | PARTIAL | same governance/catalog gaps; PUBLIC result class |
| document_evidence_json.v3 | PARTIAL | same governance/catalog gaps; BUYER_AUTHORIZED — result-authorization enforcement is well-tested (`result-authorization-enforcement.test.ts`), but payment/settlement-failure coverage at v3 is absent |
| verify_agent_output.v3 | PARTIAL | same as document_evidence_json.v3 |

No service in this repository qualifies as **PROVEN** under this audit's strict "no YES from vocabulary alone" standard — every "Y" above traces to a cited file, but none of the 12 services has a single test asserting the full execution→payment→settlement→reconciliation chain succeeds end-to-end for that exact service_id (see §4). No service is **ABSENT** (all 12 have real code, schemas, and registry entries) and none is fully **UNKNOWN** (evidence exists in every case, even where the evidence is "structurally unreachable").

---

## 3. Test coverage evidence

Full detail produced by a dedicated research pass over every `*.test.ts` in `apps/edge-api/tests/`, `packages/protocol-x402/src/replay/`, and `packages/service-runtime/src/tests/`. Summary matrix (4 base families × 13 scenarios; cell = exact file, or ABSENT/UNKNOWN — see notes for the caveat that several cells are covered only via **one representative service_id inside a shared-mechanism suite**, not per-service):

| Scenario | company_evidence_graph | web_context_verified | document_evidence_json | verify_agent_output |
|---|---|---|---|---|
| success | `apps/edge-api/tests/company-evidence-graph-v3-rest-harness.test.ts:241`; `.../production/company-evidence-graph-v2-cdp-composition.test.ts:163` | `.../web-context-verified-v3-rest-harness.test.ts:297`; `.../production/web-context-v2-cdp-composition.test.ts:156` | `.../document-evidence-json-v3-rest-harness.test.ts:244`; `.../production/document-evidence-json-v2-cdp-composition.test.ts:210` | `.../verify-agent-output-v3-rest-harness.test.ts:580`; `.../production/verify-agent-output-v2-production-executor.test.ts:52` |
| invalid request | `apps/edge-api/tests/input-validators-generated-equivalence.test.ts:132` (shared, parametrized) | same file | same file | same file |
| unauthorized request | ABSENT (public route) | ABSENT (public route) | `apps/edge-api/tests/result-authorization-enforcement.test.ts:286-345`; `document-evidence-json-v3-rest-harness.test.ts:244` | `result-authorization-enforcement.test.ts:290`; `verify-agent-output-v3-rest-harness.test.ts:580` |
| duplicate request (idempotency) | `chaos-v2.test.ts:391` (v2); `packages/protocol-x402/src/replay/idempotency.test.ts` (protocol-level) | UNKNOWN per-service | UNKNOWN per-service | UNKNOWN per-service |
| retry | `chaos-v2.test.ts:356` | `production-cdp-settlement-recovery.test.ts:215,249` (representative) | UNKNOWN | UNKNOWN |
| provider failure | `chaos-v2.test.ts:216` | `chaos-v2.test.ts:256` | `chaos-v2.test.ts:613` | `chaos-v2.test.ts:323` |
| timeout | `nevermined-settlement-recovery.test.ts:231` (representative, `web_context_verified.v1`) | same file | UNKNOWN | `chaos-v2.test.ts:241` (step timeout, not full-service) |
| persistence failure | `chaos-v2.test.ts:537`; `chaos-v2-settlement-recovery.test.ts:318` | UNKNOWN | UNKNOWN | UNKNOWN |
| replay | `chaos-v2.test.ts:391`; `packages/protocol-x402/src/replay/binding.test.ts` | `web-context-verified-v3-rest-harness.test.ts:297` | `document-evidence-json-v3-rest-harness.test.ts:244` | `verify-agent-output-v3-rest-harness.test.ts:580` |
| concurrent replay | `chaos-v2.test.ts:356` (10 concurrent, one family only) | ABSENT | ABSENT | ABSENT |
| payment failure | `chaos-v2.test.ts:307`; `settlement-observability.test.ts:113-234` (protocol-level) | `nevermined-route-settlement-recovery.test.ts:519` (representative) | UNKNOWN direct | UNKNOWN direct |
| duplicate payment | `nevermined-route-settlement-recovery.test.ts:484` (representative) | same file | UNKNOWN | UNKNOWN |
| settlement retry | `production-cdp-settlement-recovery.test.ts:215-467` (representative, `web_context_verified.v2`) | native to that file | UNKNOWN direct | UNKNOWN direct |

**Counts** (4×13 = 52 cells, using base-family granularity): **27/52 concrete evidence, 6/52 ABSENT (structural — e.g. unauthorized-request on a public route), 19/52 UNKNOWN** (plausibly covered by a shared mechanism, no direct per-service test located). No `describe.each`/`it.each`/`for (const service of ...)` loop was found driving payment/settlement/replay scenarios across all service ids — the only cross-service iteration found is in schema/registry-consistency tests (`packages/service-runtime/src/registry.test.ts`, `.../tests/properties.test.ts`, `.../tests/cross-service.test.ts`), not failure-scenario tests.

**At the true 12-id granularity, coverage is worse for `.v3`:** every representative-service payment/settlement/duplicate-payment test found targets `.v1` or `.v2` service ids (`nevermined-route-settlement-recovery.test.ts`, `production-cdp-settlement-recovery.test.ts`). No `.v3`-specific payment-failure, duplicate-payment, settlement-retry, concurrent-replay, or persistence-failure test was found; the `*-v3-rest-harness.test.ts` files cover success/replay/buyer-authorization/negative-404 only. Those five columns should be read as **ABSENT**, not UNKNOWN, for all 4 `.v3` services.

Cross-cutting payment/settlement/economic test files relevant to §4 (economic ownership):

| File | Scope |
|---|---|
| `apps/edge-api/tests/chaos-v2.test.ts` | Deterministic chaos across execution+payment+settlement, v2 routes, all 4 families, one scenario each |
| `apps/edge-api/tests/chaos-v2-settlement-recovery.test.ts` | Settlement-pending crash/durability recovery, shared v2 pipeline (representative `company_evidence_graph.v2`) |
| `apps/edge-api/tests/nevermined-settlement-recovery.test.ts` | Nevermined-rail settlement recovery/reconciliation (representative `web_context_verified.v1`) |
| `apps/edge-api/tests/nevermined-route-settlement-recovery.test.ts` | Route-level settlement recovery incl. duplicate-payment-identifier conflict |
| `apps/edge-api/tests/production-cdp-settlement-recovery.test.ts` | CDP-rail bounded settle-retry, exact/upto modes (representative `web_context_verified.v2`) |
| `apps/edge-api/tests/settlement-reconciliation.test.ts` | Generic `reconcileAmbiguousSettlement` unit tests, protocol-level |
| `apps/edge-api/tests/settlement-observability.test.ts` | Settle-failure classification/audit, protocol-level |
| `apps/edge-api/tests/payment-verification-observability.test.ts` | Payment-verification failure classification, protocol-level |
| `apps/edge-api/tests/production-payment-challenge.test.ts` / `production-payment-gate.test.ts` | 402 challenge / asset-seller resolution, network-level |
| `packages/protocol-x402/src/replay/{idempotency,binding}.test.ts` | Payment-attempt classification / replay binding, protocol-level |
| `apps/edge-api/tests/result-authorization-{enforcement,contract-invariants,d1,design-reference}.test.ts` | Buyer-authorized result-delivery policy |

---

## 4. Economic ownership

For every paid-capable (`.v2`/`.v3`) service, execution, payment authorization, settlement authorization, and reconciliation are **not** unified under one module/owner — they are horizontally layered and cross-cut:

- **Execution:** per-family `production/*-composition.ts` + `*-production-executor.ts` (`apps/edge-api/src/control-plane/production/`) calling into `packages/service-runtime/src/services/*/service.ts`.
- **Finalization/signing:** single shared function `packages/service-runtime/src/pcc/verify-and-sign.ts` (all 8 paid services funnel through it — see §5).
- **Payment/settlement state machine:** `apps/edge-api/src/control-plane/workflows/` (paid-continuation workflow) plus rail-specific logic in `production-payment.ts` (CDP) and the Nevermined evidence/reconciliation clients.
- **Reconciliation:** separate `settlement-reconciliation.ts` / `nevermined-reconciliation-client.ts` layer, tested generically, not per-service.
- **Result-access authorization:** a third, independent module, `apps/edge-api/src/control-plane/security/result-authorization.ts` (see §7).

No single test file or module asserts, for one specific service_id, that execution → payment authorization → settlement authorization → reconciliation all succeed together end-to-end. Every cross-cutting test exercises the shared pipeline through **one representative service** and generalizes by comment/assertion, not by direct per-service repetition.

`ECONOMIC_OWNER_MODEL` per service: **PARTIAL** for all 8 paid (`.v2`/`.v3`) services (the pieces exist, are individually tested, and are wired together at runtime — but no single owner/test proves the whole chain for that exact id). **N/A** for the 4 `.v1` services (no live economic path — unroutable). `ECONOMIC_OWNER_MODEL_OVERALL = FRAGMENTED` (proven pieces, no single proven owner).

---

## 5. A0 path usage / parity gaps

`packages/service-runtime/src/pcc/verify-and-sign.ts` (313 lines) is confirmed to be the **sole** finalization/signing path. PCC = **Proof-Carrying Context** (per `README.md` and `docs/decisions/0002-proof-carrying-context-boundary.md`), not "Proof of Correct Computation." Pipeline: mesh verification (`runMesh`) → `finalizeSemantics` → immutable snapshot freeze → `issueReceipt` → self-verification (`verifyServiceReceipt`) → internal artifact build (+ `verifySelfVerifyingPcc` for v2 wire artifacts) → post-finalization output-schema check → **fail-closed schema gate** (the A0 fix): if a finalized document fails its own registered output schema, the artifact is discarded and delivery is forced to `decision: 'fail'` with `final_schema_validation_failed`.

All four service implementations call this one function and nothing else:
- `packages/service-runtime/src/services/company-evidence/service.ts:456`
- `packages/service-runtime/src/services/document-evidence/service.ts:250`
- `packages/service-runtime/src/services/web-context/service.ts:208`
- `packages/service-runtime/src/services/agent-verification/service.ts:231`

A repo-wide search for `issueReceipt`, `.sign(`, `Ed25519`, `createSignature`, `verifyAndSign` (excluding `.claude/worktrees/*`, which are duplicate mirror trees, not separate live code) found no alternate/bypass finalization path. Other "sign"-adjacent hits are unrelated (JWT signing for CDP/OAuth auth in `evidence/cdp-jwt-*.ts`, `routes/mcp-registry-auth.ts`) or are `Signer` implementations *passed into* `verifyAndSign` rather than parallel orchestration (`pcc/production-signer.ts`, `pcc/test-signer.ts`).

**`A0_PARITY_GAPS = 0`** — no service bypasses `verify-and-sign.ts`.

`git show cd7ed96 --stat`: 2 files, `verify-and-sign.ts` (+39/-6) and a new 197-line test `a0-finalization-schema-gate.test.ts` (3 tests). Before the fix, the schema-validity result was computed but never used to gate delivery — a finalized document could fail its own output schema and still be signed and returned as passing. The fix renames the pre-check value to `preSchemaDocument`, adds a `schemaGateFailed` check, and on failure discards the artifact and rewrites the delivered document to `decision: 'fail'`.

Test run (this audit, read-only): `cd packages/service-runtime && pnpm test` → **22 files, 311 tests passed, 0 failed, 0 skipped**, 14.76s (includes `a0-finalization-schema-gate.test.ts` 3/3). This is consistent with, though not numerically identical to, the 308-passed/3-skipped figure recorded in `docs/development/R3_A0_PRODUCTION_REMEDIATION_PREFLIGHT_2026-09-25.md` (different worktree/run, same code) — the small count difference (311 vs 308+3=311 total) reconciles once skipped-vs-passed bucketing is accounted for; both runs show **0 failures**.

---

## 6. Protocol cross-parity findings

See §1.2/§1.3 for the full matrix. Summary classification:

| Discrepancy | Classification |
|---|---|
| MCP omits `.v1` tools entirely | EXPECTED_PROJECTION_DIFFERENCE (explicitly documented in-code as intentional) |
| Agent Card advertises `.v1` skills that are unroutable in production | SEMANTIC_DRIFT |
| OpenAPI omits `.v1` paths (consistent with real routing) | EXPECTED_PROJECTION_DIFFERENCE |
| Live `/catalog` shows `.v1`+`.v2` and omits `.v3` (the actually-live candidate routes) | SEMANTIC_DRIFT (high priority — catalog's D1 seed is out-of-band and untraceable in-repo per `scripts/gates/check-v3-service-parity.ts:290-296`, `CATALOG_SEED_AUTHORITY = 'NOT_FOUND_IN_REPO'`) |
| Root `GET /` lists only `.v1` ids | SEMANTIC_DRIFT (low severity, informational endpoint) |
| Pricing: registry `base_price`/`maximum_price` vs. `governance/RISK_LIMITS.yaml` vs. `packages/pricing/src/service-prices.ts` (3-way, per Master Reference §I.7/§I.2) | Not independently re-verified in this pass; **carried forward as an open item**, already flagged ERROR-severity PRICE_DRIFT by the Master Reference |
| `production_ready`/`production_enabled`: `PROJECT_STATE.yaml` (stale, historical-only) vs. live `env.ts` gate reality | EXPECTED (PROJECT_STATE.yaml is formally disposed `HISTORICAL_ONLY` per Master Reference §I.9; no live consumer reads it) |

`PROTOCOL_PARITY` overall verdict: **PARTIAL** — identity, schema, and pricing agree across every static source; production-state and discoverability (`/catalog` specifically) do not agree with live routing reality.

---

## 7. A2 result-access authorization

Two representations exist; only one is live.

**Live, wired model** — `apps/edge-api/src/control-plane/security/result-authorization.ts` (422 lines). Types: `ResultSubjectV1`, `VerifiedPrincipalEvidence`, `ResultResourceV1`, `ResultSubjectBindingV1`, `ResultAccessDelegationV1`, `ResultReleaseDecision`, `ResultAuthorizationContextV1`. Entry point: `evaluateResultReleaseAuthorization` (line 314), called from `apps/edge-api/src/control-plane/routes/x402-service.ts` (lines 929, 1050, 1177, 1438) and from `apps/edge-api/src/routes/mcp.ts` (lines 43, 307, 309, 337) → `packages/protocol-mcp/src/server.ts` (lines 880, 931, `RESULT_AUTHORIZATION_BLOCKED_SERVICES = {document_evidence_json.v3, verify_agent_output.v3}`). Principal establishment (`request-principal.ts`) supports Bearer OIDC or mTLS client-cert. Persistence: `apps/edge-api/src/control-plane/repositories/d1/result-authorization.ts`. Confidentiality class (`PUBLIC` vs `BUYER_AUTHORIZED`) is governed per service_id/version/contract_release via `governedResultConfidentiality`. A `ResultAccessDelegationV1` type exists but its own code comment states delegation persistence/API is "intentionally deferred for first activation" — non-owner delegated access is modeled but not functional yet.

**Dormant/shadow model** — `packages/vcm/src/security/result-authorization-shadow.ts`. Its own docstring: *"SHADOW / LOCAL MODEL ONLY. Nothing imports this module. Its output is never consumed by HTTP/MCP response release, payment admission, execution, provider invocation, commit, PCC, settlement, result persistence, or reconciliation."* Confirmed by grep: only its own sibling test files import it.

```
A2_CURRENT_MODEL = Bearer-OIDC-or-mTLS caller authentication, gated by a governed PUBLIC/BUYER_AUTHORIZED
                    confidentiality classification per service, enforced by evaluateResultReleaseAuthorization()
                    and wired into both the REST (x402-service.ts) and MCP (server.ts) result-release paths;
                    delegation (non-owner authorized access) is typed but not yet implemented.
A2_CANONICAL_TYPE_USAGE = PARTIAL — one canonical, consistently-used live type set (ResultAuthorizationContextV1
                    in result-authorization.ts) is used identically by both REST and MCP; a second, structurally
                    different vocabulary (ResultAuthorizationEnvelopeV1) exists in packages/vcm as an explicitly
                    non-consumed shadow/design-validation model, so the concept is not represented by a single
                    type everywhere in the repo, even though the live path itself is unified.
A2_NEXT_ENTRY_POINT = evaluateResultReleaseAuthorization() in
                    apps/edge-api/src/control-plane/security/result-authorization.ts:314 — the single real
                    decision function already exercised by both live surfaces; its own deferred-delegation
                    comment marks exactly where the next increment belongs. Supporting entry points:
                    buildResultAuthorizationRuntime() in request-principal.ts:62 (auth-method wiring) and
                    D1ResultAuthorizationRepository (persistence layer needing a delegation table).
```

Relevant pre-existing test coverage: `apps/edge-api/tests/result-authorization-{contract-invariants,enforcement,d1,design-reference}.test.ts`.

---

## 8. Production blockers per service (policy flag aside)

Even if `PAID_ROUTES_ENABLED`/the per-service `*_ROUTE_ENABLED` gates were flipped on, each family would additionally need:

- **All `.v1` (4 services):** a code change — `/v1/*` is a hardcoded `notFound()` in `index.ts`; flipping any flag does not restore routing.
- **All `.v2` (4 services):** live CDP mainnet credentials. `.dev.vars.example` lists `SELLER_WALLET_ADDRESS`, `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET` as unset, annotated "SUN-0700B (live CDP facilitator settlement) — blocked_external until these are provisioned." This is consistent with the user's own memory note that existing CDP creds are not mainnet-approved and fresh CDP Portal credentials are the current blocking path.
- **All `.v3` (4 services):** `promotion_state: executable_candidate` in every `registry/services/*.v3.json` — has not cleared the governance promotion ladder (`governance/PROMOTION_STATES.yaml`) to a production-admitted rung; `release_posture: compatibility_not_admitted`/candidate; plus the same CDP-credential blocker as v2 (shared settlement rail); plus, for `document_evidence_json.v3` and `verify_agent_output.v3` specifically, no test proves delegation-based (non-owner) result access works, since delegation itself is unimplemented.
- **All 8 paid services:** the live `/catalog` drift (§1.3, §6) means even a technically-ready service would be discovered incorrectly by any consumer relying on `/catalog` alone.

---

## 9. A1 status summary (restated)

- PROVEN: 0
- PARTIAL: 4 (`company_evidence_graph.v3`, `web_context_verified.v3`, `document_evidence_json.v3`, `verify_agent_output.v3`)
- QUALIFIED_NOT_ENABLED: 4 (`company_evidence_graph.v2`, `web_context_verified.v2`, `document_evidence_json.v2`, `verify_agent_output.v2`)
- IMPLEMENTED_NOT_QUALIFIED: 4 (all `.v1`)
- ABSENT: 0
- UNKNOWN: 0

---

## 10. Open unknowns

1. Live `/catalog` D1 seed provenance — genuinely untraceable in this repository; needs an out-of-band operational answer, not a code search.
2. Whether the claimed production Worker version `1ac3d6e2-b81c-43b0-abf7-f2972e95b9d5` (from the audit brief) or `44567f1e-b47f-4047-93ca-6c8a6953bdfa` (from the repo's own same-day preflight doc) is actually live — neither was independently re-verified against Cloudflare in this pass (no `wrangler`/API calls made, by constraint).
3. Registry `base_price`/`maximum_price` vs. `governance/RISK_LIMITS.yaml` vs. `packages/pricing/src/service-prices.ts` 3-way pricing cross-check — not re-verified in this pass; carried forward from the Master Reference as an open, previously-flagged ERROR-severity item.
4. Whether `AGENT_CARD_SIGNING_PRIVATE_KEY` is actually bound in production (Master Reference §I.13 flags this `OPEN`/unverifiable from repo) — `/ready`'s blocker list would surface `agent_card_signing_identity_missing` if absent, and the live read in this audit showed `blocked_external: []`, which is *consistent with* the key being bound, but was not independently confirmed via a dedicated signature-verification probe.
5. `.v3` payment-failure/duplicate-payment/settlement-retry/concurrent-replay/persistence-failure test coverage — confirmed ABSENT in this pass; whether the shared v2 mechanism genuinely generalizes to v3 without service-specific edge cases is unverified.

## 11. Recommended next phase

1. Fix or explicitly re-scope the `/catalog` D1 seed so it matches the real route set (drop dead `.v1` rows or mark them unroutable; add the missing `.v3` rows or explicitly document why candidates are excluded from public catalog).
2. Add `.v3`-specific payment/settlement/replay-under-concurrency tests (parametrize the existing `chaos-v2`/settlement-recovery suites across all 12 service ids rather than one representative id per suite) before promoting any `.v3` service past `executable_candidate`.
3. Implement or explicitly defer-and-document the `ResultAccessDelegationV1` persistence/issuance path in `result-authorization.ts`, since it is the concrete, code-marked next increment for A2.
4. Resolve the CDP mainnet credential provisioning blocker (Path C / fresh CDP Portal credentials, per the user's own tracked authorization chain) before any `.v2`/`.v3` service can move past QUALIFIED_NOT_ENABLED / PARTIAL.
5. Independently re-verify, via an authorized live-read session, which Worker version is actually deployed and whether the A0 fix is present in it — this audit could not resolve the `1ac3d6e2` vs `44567f1e` discrepancy from repo evidence alone.

---

## Final Summary

```
SERVICE_COUNT=12 (not 16 — see §0; 4 families × v1/v2/v3 permanent parallel generations)
A1_SERVICES_PROVEN=0
A1_SERVICES_PARTIAL=4
A1_SERVICES_QUALIFIED_NOT_ENABLED=4
A1_SERVICES_IMPLEMENTED_NOT_QUALIFIED=4
A1_SERVICES_UNKNOWN=0
A0_PARITY_GAPS=0
ECONOMIC_OWNER_MODEL_OVERALL=FRAGMENTED (proven components, no single proven per-service owner)
PROTOCOL_PARITY=PARTIAL (identity/schema/pricing agree statically; live /catalog and Agent Card diverge from real routing)
PRODUCTION_SERVICES_ENABLED=false (live-confirmed via GET /ready, 2026-09-25)
A2_CURRENT_MODEL=Bearer-OIDC/mTLS principal auth + governed PUBLIC/BUYER_AUTHORIZED classification, enforced by evaluateResultReleaseAuthorization() in result-authorization.ts, wired into both REST and MCP; delegation typed but unimplemented
A2_CANONICAL_TYPE_USAGE=PARTIAL (one unified live type set; a second, unused shadow vocabulary also exists in packages/vcm)
A2_NEXT_ENTRY_POINT=evaluateResultReleaseAuthorization() in apps/edge-api/src/control-plane/security/result-authorization.ts:314
PRODUCTION_MUTATIONS_PERFORMED=NO
NEXT_CRITICAL_PATH_PHASE=Fix /catalog D1 seed drift; add .v3 payment/settlement/replay coverage; resolve CDP mainnet credential provisioning; implement or formally defer ResultAccessDelegationV1
BLOCKERS=Live /catalog seed provenance untraceable in-repo; CDP mainnet credentials unprovisioned; .v1 routes structurally unroutable; .v3 not promoted past executable_candidate; deployed-Worker-version claim (1ac3d6e2 vs 44567f1e) unresolved from repo evidence alone
```

---

## 12. RECONCILIATION PASS (2026-09-25, later same day) — READ-ONLY, LIVE-VERIFIED

Mission: resolve the 12-vs-16-service and 44567f1e-vs-1ac3d6e2-deployment conflicts between this A1 report and a separate, untrusted, pasted claim of "16 services / 1ac3d6e2 @ 100%." **No deploy, Cloudflare state change, traffic change, source/config change, or git push was performed to produce this section** — `wrangler deployments list`, `wrangler versions list` (run from repo root, where the actual `wrangler.toml` for `siteborne-utility-edge` lives — `apps/edge-api` itself has no `wrangler.toml`, only `wrangler.workerd-test.toml`), and plain `GET`/`POST` reads of `https://utility.siteborne.net` were the only actions taken.

### 12.1 Authority hierarchy used

1. `wrangler deployments list` / `wrangler versions list` (live Cloudflare API) — sole authority for what Worker version is active and at what traffic split.
2. Live HTTP reads of `utility.siteborne.net` (`/ready`, `/catalog`, `/openapi.json`, `/.well-known/agent-card.json`, plus direct `POST` probes of `/v1/*`, `/v2/*`, `/v3/*`) — sole authority for what is actually reachable/served right now.
3. Repository source (`registry/services/*.json`, `packages/protocol-a2a/src/constants.ts`, `packages/protocol-mcp/src/constants.ts`, `apps/edge-api/src/index.ts`) — authority for canonical identity and route-registration structure, cross-checked against (1) and (2).
4. This A1 report and the untrusted pasted "16-service" claim — both treated as **unverified prior claims**, superseded wherever they conflict with (1)-(3).

### 12.2 Corrected deployment state

`wrangler deployments list` / `wrangler versions list` (run 2026-09-25, this pass) show a **newer** deployment than either prior claim knew about:

```
LIVE_ACTIVE_VERSION      = 1ac3d6e2-b81c-43b0-abf7-f2972e95b9d5
LIVE_ACTIVE_TRAFFIC      = 100%
LIVE_DEPLOYMENT_TIMESTAMP = 2026-09-25T13:48:22.749Z
LIVE_DEPLOYMENT_MESSAGE  = "R3-A0 single-version cutover: finalization schema gate fix"
VERSION_SOURCE           = tag release-3-a0-finalization-schema-gate-01; "exact source 5ecedf5 (base 4e1252412c66 + cd7ed96f)"
```

`cd7ed96f` is confirmed by `git log` to be exactly this repo's A0 fix commit (`fix(pcc): gate signing on finalized schema validity`, 2026-09-24 21:24:39 -0500). So the version now live at 100% traffic **contains the A0 fix**.

Full deployment history (chronological, this Worker only) shows the actual sequence both prior claims each saw only a slice of:
- 2026-09-24T20:04 — cutover to `44567f1e` (Release-3 activation) — this is the version the A1 report's preflight doc and this report's §0 correctly recorded as "current" **at the time they were written**.
- 2026-09-25T03:13 — `1ac3d6e2` uploaded (A0 fix version), 0% traffic (zero-traffic qualification).
- 2026-09-25T04:06 — canary: 99% `44567f1e` / 1% `1ac3d6e2`.
- 2026-09-25T13:09 — rollback to 100% `44567f1e` ("cron cross-version invocation observed on 1ac3d6e2 canary; 1ac3d6e2 preserved, not deleted").
- **2026-09-25T13:48 — cutover to 100% `1ac3d6e2`** ("R3-A0 single-version cutover: finalization schema gate fix"). This is the current live state.

**A1 report's deployment claim (`44567f1e`, A0 fix NOT_DEPLOYED) is classified STALE**, not wrong — it accurately reflected the live Worker state at the moment its evidence was gathered, but a cutover happened afterward. The untrusted pasted claim's *version id* (`1ac3d6e2` @ 100%) is now **CURRENT**, but its *reasoning* is unverifiable (arrived as pasted text, no live readback shown) and its accompanying "16 services" claim remains unsubstantiated — see §12.3. Per the user's own memory note on SUN-1221F, a live readback superseded a stale split before; this is the same pattern repeating one level up the stack — always re-verify live, never trust a pasted number, regardless of which side it happens to land closer to.

### 12.3 Corrected service counts and the 12-vs-16 explanation

```
SERVICE_COUNT_CANONICAL   = 12  (registry/services/*.json: 12 files; packages/protocol-a2a/src/constants.ts:SITEBORNE_SERVICE_IDS: 12 entries, byte-for-byte same set — both re-counted live in this pass)
SERVICE_COUNT_ROUTABLE    = 8   (v2×4 + v3×4 have real registered Hono handlers in apps/edge-api/src/index.ts:193-249; v1×4 is unconditionally `app.all('/v1/*', c => c.notFound())` at index.ts:173 — structurally dead regardless of any flag)
SERVICE_COUNT_LIVE_CATALOG = 8   (live GET /catalog, re-read this pass: v1×4 + v2×4, confirmed by exact service_id enumeration below)
SERVICE_COUNT_OPENAPI     = 8   (live GET /openapi.json, re-read this pass: 8 service paths, /v2/* ×4 + /v3/* ×4)
```

Exact live `/catalog` service_ids (re-read 2026-09-25, this pass): `company_evidence_graph.v1`, `company_evidence_graph.v2`, `document_evidence_json.v1`, `document_evidence_json.v2`, `verify_agent_output.v1`, `verify_agent_output.v2`, `web_context_verified.v1`, `web_context_verified.v2` — all `production_enabled: false`, `protocol_status: preproduction`.

Exact live `/openapi.json` service paths: `/v2/company/evidence-graph`, `/v2/web/context`, `/v2/document/evidence-json`, `/v2/verify/agent-output`, `/v3/company/evidence-graph`, `/v3/web/context`, `/v3/document/evidence-json`, `/v3/verify/agent-output` (plus 6 non-service paths: `/health`, `/ready`, `/catalog`, `/schemas`, `/benchmarks`, `/services/{service_id}`).

Live `/.well-known/agent-card.json` skills (re-read this pass): 12 — all of v1×4, v2×4, v3×4 by id, matching the canonical registry set exactly.

**COUNT_DISCREPANCY_EXPLANATION:** Nothing in the repository, and nothing in either prior claim's own evidence, produces "16." Every independent canonical source re-counted live in this pass agrees on 12 (4 capability families × 3 permanent parallel generations v1/v2/v3). The apparent "16" in the untrusted pasted mission does not correspond to any projection found: it is not 12+4, not double-counting any single 8-count projection, and no file/constant/generator anywhere in the tracked tree references sixteen. This reconciliation pass, like the original A1 report, classifies the "16" premise as **MISMATCH — unsubstantiated**, now cross-checked twice independently (original A1 static-source pass, this pass's live-endpoint re-read) with the same result both times.

### 12.4 Catalog-drift claims re-verified live

```
CATALOG_DEAD_V1_CLAIM     = PROVEN — live POST to /v1/company/evidence-graph and /v1/web/context both return plain "404 Not Found", byte-identical to a POST against a nonexistent path (/v9/nonexistent). Source: apps/edge-api/src/index.ts:173, `app.all('/v1/*', (c) => c.notFound())` — unconditional, no flag check, would require a code change (not a flag flip) to ever route. All 4 .v1 ids are still listed in live /catalog as if normal (production_enabled:false, protocol_status:preproduction — not flagged unroutable).

CATALOG_OMITTED_V3_CLAIM  = PROVEN — live /catalog (re-read this pass) contains 0 of the 4 .v3 ids (company_evidence_graph.v3, web_context_verified.v3, document_evidence_json.v3, verify_agent_output.v3), despite all 4 having real registered routes: apps/edge-api/src/index.ts:222-225 (`app.post('/v3/company/evidence-graph', companyEvidenceGraphV3CandidateRoute)` etc.) and appearing as live paths in /openapi.json.
```

Note on live route probing: `POST /v2/*` and `POST /v3/*` currently also return plain "404 Not Found" in this pass — but this is a **different mechanism** from v1's structural 404. Inspection of `apps/edge-api/src/control-plane/routes/production-company-evidence-v2-cdp-route.ts:39-48` shows the v2/v3 handlers themselves call `c.notFound()` only when `PAID_ROUTES_ENABLED` (and the per-service `*_ROUTE_ENABLED` flag) is false — consistent with live `GET /ready` showing `production_services_enabled: false`. Flipping that policy flag alone would activate v2/v3; no equivalent flag exists for v1, whose 404 is hardcoded at the router level. This confirms, rather than contradicts, the A1 report's REST-exposure distinction (v1 = N/structurally unroutable, v2/v3 = Y/real-route-but-policy-gated) — the *current* HTTP response code looks identical across all three generations today, but the *mechanism* differs, which is what the original A1 matrix was actually asserting.

### 12.5 A1 report section-by-section reassessment

| Section | Verdict | Note |
|---|---|---|
| SERVICE_INVENTORY (§1) | VALID | 12-canonical / 8-routable / 8-openapi / 12-agent-card structure re-confirmed live, byte-for-byte, in this pass |
| TEST_COVERAGE (§3) | VALID | Not re-run in this pass (no code changed since); no basis to doubt it |
| ECONOMIC_OWNERSHIP (§4) | VALID | Unaffected by deployment-version question; static-code finding |
| A0_PATH_USAGE (§5) | VALID, STRENGTHENED | The single finalization path (`verify-and-sign.ts`) finding is unaffected; this pass adds live proof the fix is now active at 100% traffic, which the A1 report itself flagged as an open unknown (§10.2) |
| PROTOCOL_PARITY (§6) | VALID | Catalog-drift claims independently re-proven live in §12.4 above |
| PRODUCTION_BLOCKERS (§8) | NEEDS_CORRECTION | The "A0 fix not deployed" framing is superseded — A0 is now live at 100%. CDP mainnet credential and `.v3` promotion-ladder blockers stand unchanged |
| A2_ENTRY_POINT (§7) | VALID | Unaffected by deployment-version question; static-code finding, not re-verified further in this pass (out of scope) |

**A1_REPORT_OVERALL = VALID_WITH_CORRECTIONS** — the report's code-level analysis (service inventory, test coverage, economic ownership, A0 code path, protocol-parity/catalog-drift evidence) holds up under independent live re-verification. Its single deployment-state claim was accurate when written and became stale ~10 hours later due to a real cutover this pass directly observed.

### 12.6 Corrected A0 status

```
A0_PRODUCTION_FIX_STATUS = DEPLOYED_LIVE_100_PERCENT — wrangler versions/deployments list (live, this pass) show 1ac3d6e2-b81c-43b0-abf7-f2972e95b9d5 (source 5ecedf5 = base 4e1252412c66 + cd7ed96f, the A0 fix commit) at 100% traffic as of 2026-09-25T13:48:22.749Z. This supersedes both the A1 report's NOT_DEPLOYED (stale-at-write-time) and the untrusted pasted claim's un-sourced "deployed" assertion — this status rests on this pass's own direct wrangler readback, not on either prior claim.
A0_RUNTIME_INVALID_PATH_PROOF = PARTIAL (unchanged) — no new direct runtime evidence was obtained in this pass; all v2/v3 execution routes currently 404 in production due to PAID_ROUTES_ENABLED=false (policy, unrelated to A0), so the schema-finalization-gate fix cannot be exercised end-to-end live without either flipping that flag (out of scope, a mutation) or a non-production test environment.
```

### 12.7 Unresolved unknowns after this pass

1. Why the pasted "16 services" claim was made — no repository or live-endpoint evidence supports it under any counting method tried; origin remains unexplained.
2. Whether the 2026-09-25T13:09 rollback's stated cause ("cron cross-version invocation observed on 1ac3d6e2 canary") recurs now that `1ac3d6e2` is back at 100% — this pass did not observe cron behavior directly (out of scope for a read-only HTTP/wrangler-list pass).
3. All items in the original report's §10 not specifically addressed above (pricing 3-way cross-check, `AGENT_CARD_SIGNING_PRIVATE_KEY` binding, `.v3` failure-scenario test coverage) remain open — not in scope for this reconciliation pass.

---

## 13. Correction: §62/§206 "Agent Card SEMANTIC_DRIFT" claim superseded (R3-A1-PROJECTION-SEMANTICS-CLOSURE-21B)

The earlier finding that "the Agent Card advertises 12 skills including 4 `.v1` skills that are unconditionally unroutable in production" (§62, §206) was classified `SEMANTIC_DRIFT` under the mistaken premise that all protocol projections must share identical membership with `/catalog`/`/openapi.json`. That premise is incorrect and is retracted.

**The correct model, already implemented and tested in `00763a9`** (not a new change — verified only, `RUNTIME_CODE_CHANGED=NO`):

- **Execution surfaces** (mounted routes, `/catalog`, `/openapi.json`) publish only the 8 currently-executable identities (4× `.v2` + 4× `.v3`). `CATALOG_SERVICE_IDS = [...V2_PAID_SERVICE_IDS, ...V3_CANDIDATE_SERVICE_IDS]` (`apps/edge-api/src/control-plane/routes/catalog.ts:169-171`).
- **Discovery/compatibility surfaces** (A2A Agent Card, VCM, Bazaar) intentionally publish the full 12-identity canonical set (`packages/protocol-a2a/src/constants.ts:SITEBORNE_SERVICE_IDS`), including the 4 `.v1` identities, for historical/compat attestation.
- **Invariant is `EXECUTION_SET ⊆ DISCOVERY_SET`, not `AGENT_CARD_SET == EXECUTION_SET`.** This is documented in-repo at `apps/edge-api/tests/economic-parity-gates.test.ts:346-352` (`CATALOG-ROUTE-PARITY-01` comment) and enforced by `GATE:ECONOMIC_PROJECTION_PARITY`.
- Each `.v1` identity was independently re-verified this pass: `ROUTABLE=NO` (`/v1/*` hard-404s, `apps/edge-api/src/index.ts:173`), `CATALOG_EXECUTABLE=NO`, `OPENAPI_EXECUTABLE=NO`, `production_enabled=false` (`registry/services/*.v1.json`), `DISCOVERY_PUBLISHED=YES`, classified `compat_not_served` (`apps/edge-api/tests/canonical-url-projection.test.ts:131`). No projection presents `.v1` as callable, production-ready, production-enabled, or settlement-capable.
- `apps/edge-api/tests/economic-parity-gates.test.ts` and `apps/edge-api/tests/canonical-url-projection.test.ts` re-run this pass: 33/33 passed.

```
EXECUTION_IDENTITY_COUNT=8
DISCOVERY_IDENTITY_COUNT=12
COMPAT_ONLY_IDENTITY_COUNT=4
COMPAT_ONLY_IDENTITIES=company_evidence_graph.v1, web_context_verified.v1, document_evidence_json.v1, verify_agent_output.v1

EXECUTION_SET_PARITY=PASS
DISCOVERY_COMPAT_MODEL=PASS
EXECUTION_SUBSET_OF_DISCOVERY=YES
COMPAT_ONLY_NONROUTABLE=PASS
COMPAT_ONLY_NON_ECONOMIC=PASS
ECONOMIC_PROJECTION_PARITY_GATE=PASS
CANONICAL_URL_COMPAT_CLASSIFICATION=PASS
A2A_MEMBERSHIP_CHANGE_REQUIRED=NO

RUNTIME_CODE_CHANGED=NO
AGENT_CARD_MEMBERSHIP_CHANGED=NO
SIGNING_CODE_CHANGED=NO
CANONICALIZATION_CHANGED=NO
TESTS_CHANGED=NO
DOCS_CHANGED=YES (this section)

CATALOG_ROUTE_PARITY=PASS
CATALOG_OPENAPI_PARITY=PASS
DISCOVERY_EXECUTION_MEMBERSHIP_DIFFERENCE=INTENTIONAL
OVERALL_PROTOCOL_PARITY=PASS
```

**Corrected language for §62/§206:** `.v1` routes are dead/unserved as execution surfaces (by design, since SUN-1218 checkpoint X); `.v1` identities remain intentionally published on discovery/compatibility surfaces for historical attestation. This is deliberate architecture, not catalog-style drift — unlike the pre-fix `/catalog` bug (§0–§12), which was unintentional D1 seed drift with no corresponding design rationale anywhere in the codebase.

An unrelated, still-open observation from this pass (not part of this closure, not previously flagged): the root `GET /` handler (`apps/edge-api/src/index.ts:276-281`) publishes only the 4 `.v1` ids under a `services` field, which is itself stale relative to both the execution and discovery sets. Not in scope for R3-A1-PROJECTION-SEMANTICS-CLOSURE-21B.

PRODUCTION_MUTATIONS_PERFORMED=NO
CLOUDFLARE_MUTATIONS_PERFORMED=NO

---
