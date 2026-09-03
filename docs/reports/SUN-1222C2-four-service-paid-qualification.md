# SUN-1222C2 — Four-Service Final Paid Qualification (STOPPED before Q1)

## 0. Lineage

C2 start HEAD: `7e5a923` (clean). C1 lineage: `1e891b6` (document-worker credential/R2 provisioning), `1e3ca29` (C1-R2 live verification), `7e5a923` (SHA correction). No repo mutations were required for this checkpoint's investigation.

## Result: BLOCKED before any financial step

The load-bearing blocker is `DETERMINISTIC_CANDIDATE_TARGETING_AVAILABLE=NO` (§9). Per this checkpoint's own §10 ("absolute probabilistic-payment prohibition"), that alone requires stopping before 402/authorization/signature/paid POST, regardless of how the rest of the investigation went. Everything below §9 in this report is the honest state of the rest of the investigation, kept for the next checkpoint's use.

## 1-3. Deployment / version readback

- `C2_PRODUCTION_VERSION=db7054c9-76ee-4830-aabe-8a4542261b6a` @ 100%
- `C2_CANDIDATE_VERSION=8ce8cb66-f388-4fcc-b3e6-9c14b4919a93` @ 0%
- `C2_ACTIVE_VERSION_COUNT=2` (no unexpected third version)
- `C2_CANDIDATE_SOURCE_HEAD=eaeffa7` (per C1's own evidence). Confirmed `eaeffa7` is an ancestor of current HEAD `7e5a923`, with only 5 commits between them, all C1/C1-R2 evidence-report commits — zero functional source drift since the candidate was built.

## 2. Release economics — re-derived fresh from `packages/pricing/src/service-prices.ts`

| SERVICE_ID | PricingKey | DISPLAY_PRICE_USDC | AMOUNT_ATOMIC |
|---|---|---|---|
| company_evidence_graph.v2 | company_evidence_graph_v2 | 0.0312 | 31200 |
| web_context_verified.v2 | web_context_verified_direct_v2 | 0.008 | 8000 |
| document_evidence_json.v2 | document_evidence_json_native_v2 | 0.0098 | 9800 |
| verify_agent_output.v2 | verify_agent_output_standard_v2 | 0.017 | 17000 |

`FOUR_SERVICE_FROZEN_TOTAL_ATOMIC=66000`. `FROZEN_ECONOMICS_DRIFT=NO`. Network for all four: `eip155:8453` (Base mainnet). Asset: Base USDC (`0x833589fCD6EDb6E08f4c7C32D4f71b54bdA02913`). `PAY_TO`/seller = the configured `SELLER_WALLET_ADDRESS` on both the public API and Workflow host (`0x7f44a2dd237938F18632d4CcA40f4c69029...`, confirmed present and identical on both scripts' bindings).

Traced `document_evidence_json.v2`'s pricing wiring specifically (`packages/protocol-x402/src/bazaar/registry-source.ts`): the v2 route is **statically** bound to the `document_evidence_json_native_v2` pricing key — the frozen input schema's richer example (`extract_tables`/`ocr_permission: true`) does **not** select a different, more expensive tier; the v2 endpoint charges the same flat 9800 atomic regardless of request content. The canonical qualification body for Q3 should therefore be the frozen schema's example (`contracts/releases/1.0.0/schemas/services/document-evidence-input.schema.json`, `examples[0]`), but with `artifact_reference` replaced by `upload_reference: { upload_id: <real id> }` from a real, non-economic `POST /v2/artifacts/documents` upload first (proven safe/idempotent in C1-R2) — not the schema's placeholder `artifact_reference` (which points at a document that was never actually stored).

`CANONICAL_QUALIFICATION_BODY` examples for the other three services (from `frozen-inputs.ts` / the frozen contract schemas' own `examples[0]`, unmodified):
- company_evidence_graph.v2: `{"company_name":"Acme Corporation","domain":"acme.example.com","requested_field_groups":["identity","sec_submissions","website_evidence"],"freshness_seconds":86400,"minimum_verification_score":0.7}`
- web_context_verified.v2: `{"target_url":"https://acme.example.com/about","retrieval_mode":"rendered","output_mode":"markdown","freshness_seconds":3600,"maximum_authorized_price":{"amount":"0.029","currency":"USD"}}`
- verify_agent_output.v2: `{"verification_contract":{...},"candidate_output":{"company":"Acme Corp","confidence":0.95},"required_schema":{...},"verification_mode":"standard","maximum_authorized_price":{"amount":"0.019","currency":"USD"}}`

`PROVIDER`=CDP (Coinbase Developer Platform, `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET`, confirmed present on both scripts). `EXECUTOR`: company/webctx via the Modal webctx safe-egress deployment (shared `MODAL_WEBCTX_*`), document via the dedicated Modal document-worker (`MODAL_DOCWORKER_*`), verify via the in-Workflow verification executor — all four ultimately dispatched from `PaidContinuationWorkflow` (the single settlement owner).

## 4. Candidate configuration readback

`C2_CANDIDATE_CONFIG_READBACK=PASS` for the items I could verify directly this checkpoint:
- Four v2 route-enable flags all `"true"` on the candidate (re-confirmed via `wrangler versions view`, matches C1's own readback exactly).
- Frozen economics exact (§2 above, zero drift).
- MCP `legacy: 'stateless'` hardening present (`packages/protocol-mcp/src/server.ts:384`), and live-proven reachable on the candidate in C1-R2 (bare `tools/list` succeeded where production's fails with `-32022`).
- Single-settlement-owner architecture confirmed by direct grep of every `settle(` occurrence repo-wide: the **only** actual invocation is `paid-continuation-workflow.ts:599` (`deps.settlement.evidenceProvider.settle(`); every other occurrence in `x402-service.ts`, `production-payment.ts`, `settlement-reconciliation.ts`, `handoff.ts` is a comment/doc-reference explicitly stating it never calls `.settle()`. `PUBLIC_API_SETTLE_CALLSITES=0`, `DEDICATED_HOST_SETTLE_CALLSITES=1`.

Three named items from the runbook's checklist — "A2A productionEnabled fix", "Agent Card normalization", "post-settlement PCC undefined fail-closed guard", "receipt durability" — were **not** independently re-verified by exact name/diff this checkpoint (the relevant subsystems exist and are wired — `packages/protocol-a2a/src/card.ts`, `signing.ts`; the Workflow's settlement-reconciliation path — but I did not trace each named historical fix to a specific line this time, given the checkpoint's outcome is already decided by §9 regardless). These should be confirmed immediately before Q1 in whatever checkpoint actually attempts payment.

## 5. Zero-fixture proof

Direct full-file scan of `apps/edge-api/src/control-plane/workflows/production-dependencies.ts` (the sole dependency-construction path for all four services, per SUN-1222D-PRE) for `fixture`/`mock` (case-insensitive): **zero matches**. There is no fixture-capable code path in this file at all — not a flag-gated one, a structurally absent one.

- `COMPANY_PRODUCTION_FIXTURE_REACHABLE=NO`
- `WEBCTX_PRODUCTION_FIXTURE_REACHABLE=NO`
- `DOCUMENT_PRODUCTION_FIXTURE_REACHABLE=NO`
- `VERIFY_PRODUCTION_FIXTURE_REACHABLE=NO`

## 6. Document dependency closure (by name, Workflow host `f17acb0c-6400-47f7-a203-5c97b44dcb9d` @ 100%)

- `DOCUMENT_WORKER_ENDPOINT_CONFIGURED=YES` (`MODAL_DOCWORKER_ENDPOINT_URL` secret present)
- `DOCUMENT_WORKER_AUTH_CONFIGURED=YES` (`MODAL_DOCWORKER_PROXY_KEY`, `MODAL_DOCWORKER_PROXY_SECRET` present — the token minted fresh in SUN-1222D-R2, not the deleted orphan)
- `DOCUMENT_R2_BINDING_CONFIGURED=YES` (`env.ARTIFACTS` → `siteborne-artifacts`)
- `DOCUMENT_D1_BINDING_CONFIGURED=YES` (`env.DB` → `efe23c42-cbcc-47c2-9b28-922a541bdcdd`)
- No `CDP_WALLET_SECRET` or any local/scratch credential present or referenced.
- `DOCUMENT_PAID_RUNTIME_DEPENDENCIES_COMPLETE=YES`

**Source-currency check**: the deployed host (`f17acb0c`) was built from commit `6060494`, which is *older* than the candidate's `eaeffa7`. I diffed every Workflow/continuation/config/evidence/repository path between the two: the only change is one new, purely-additive method (`D1ArtifactsRepository.listReclaimable`, for the cron-reclamation feature the Workflow never calls) — zero existing method signatures changed, zero behavioral drift. The deployed host is functionally current despite being on an older commit.

## 7. Other executor dependency closure

- `COMPANY_PAID_RUNTIME_DEPENDENCIES_COMPLETE=YES` (`MODAL_WEBCTX_*` present, reused per SUN-1222D-PRE design)
- `WEBCTX_PAID_RUNTIME_DEPENDENCIES_COMPLETE=YES` (same `MODAL_WEBCTX_*`)
- `VERIFY_PAID_RUNTIME_DEPENDENCIES_COMPLETE=YES` (`CDP_API_KEY_ID`/`SECRET`, `PAID_RECEIPT_SIGNING_*`, `PAYMENT_CONTINUATION_ENCRYPTION_KEY` all present)

## 8. C1 discovery gaps — not closed this checkpoint

Per the runbook's own instruction, closing these requires a deterministic targeting mechanism, which §9 found unavailable. Left as-is rather than attempting another probabilistic traffic window for no incremental value:

- `CANDIDATE_MCP_FULL_BODY_CAPTURED=NO`
- `CANDIDATE_MCP_FOUR_PRIMARY_TOOLS_PRESENT=NO`
- `CANDIDATE_A2A_LIVE_PROOF=UNAVAILABLE_WITHOUT_TRAFFIC_MUTATION`

## 9. Deterministic candidate targeting — LOAD BEARING FINDING

`wrangler.toml` line 35: `preview_urls = false`. Cloudflare Workers preview URLs / preview aliases (`wrangler versions upload --preview-alias <name>`) are assigned **at upload time only** — there is no CLI/API path to retroactively attach a preview URL or alias to an already-uploaded version. The candidate `8ce8cb66-f388-4fcc-b3e6-9c14b4919a93` was uploaded with `preview_urls=false` in effect and has no preview URL, and none can be added to it after the fact.

No other authoritative, documented Cloudflare mechanism exists to force a request to one specific version of a Worker at a fixed traffic split without either (a) changing the split (probabilistic, prohibited for money by this runbook's own §10) or (b) uploading a distinct new version (a different version ID, not `8ce8cb66` itself).

- `DETERMINISTIC_CANDIDATE_TARGETING_AVAILABLE=NO`
- `DETERMINISTIC_TARGETING_MECHANISM=NONE_AVAILABLE_FOR_EXISTING_VERSION_8ce8cb66`
- `NON_ECONOMIC_VERSION_ATTRIBUTION_PROOF=PASS` (C1-R2 already proved non-economic, *probabilistic* version attribution works via version-filtered `wrangler tail`; that is not the same thing as *deterministic* targeting, which this section requires and which does not exist for this version)

**Recommended mechanism for the next checkpoint**: upload a byte-identical snapshot of `eaeffa7` as a *new* version with `preview_urls=true` / `--preview-alias` set, non-economically prove it is behaviorally identical to `8ce8cb66` (same config readback, same MCP/discovery responses), and use *that* version's dedicated preview URL for deterministic Q1-Q4 targeting — all while `8ce8cb66` and the traffic split remain completely untouched at 0%/100%. This is a version-upload (not a traffic mutation) but is still an external mutation requiring its own fresh authorization.

## 11. Buyer funding

`C2_BUYER_BALANCE_START_ATOMIC=79727` (read live via Base mainnet RPC `eth_call` to the USDC contract, immediately before writing this report). Unchanged from C1-R2 (no spending has occurred). Headroom over the frozen 66000 atomic total: 13727 atomic.

## 12. Database baseline (read-only)

| table | count |
|---|---|
| jobs | 10 |
| payment_attempts | 10 |
| payment_quotes | 0 |
| x402_quotes | 50 |
| x402_service_results | 2 |
| job_attempts | 0 |
| idempotency_records | 0 |
| job_artifacts | 1 (pre-existing, unrelated to C1-R2's cleaned-up qualification artifact) |

`C2_DATABASE_BASELINE_CAPTURED=YES`

## 13-31. Not reached

Sequential qualification (Q1-Q4), all payment/settlement/reconciliation law, and the final PASS definition were never entered. `SUN1222C2_FOUR_SERVICE_PAID_QUALIFICATION` cannot be set to PASS/FAIL/AMBIGUOUS — the correct classification is `BLOCKED`, per this runbook's own vocabulary, distinct from a failed qualification attempt (no attempt was made).

## Final Packet

```
SUN1222C2=BLOCKED
C2_PRODUCTION_VERSION=db7054c9-76ee-4830-aabe-8a4542261b6a
C2_PRODUCTION_TRAFFIC=100%
C2_CANDIDATE_VERSION=8ce8cb66-f388-4fcc-b3e6-9c14b4919a93
C2_CANDIDATE_TRAFFIC=0%
C2_CANDIDATE_SOURCE_HEAD=eaeffa7
C2_CANDIDATE_CONFIG_READBACK=PASS
FOUR_SERVICE_FROZEN_TOTAL_ATOMIC=66000
C2_BUYER_BALANCE_START_ATOMIC=79727
DETERMINISTIC_CANDIDATE_TARGETING_AVAILABLE=NO
DETERMINISTIC_TARGETING_MECHANISM=NONE_AVAILABLE_FOR_EXISTING_VERSION_8ce8cb66
CANDIDATE_MCP_FULL_BODY_CAPTURED=NO
CANDIDATE_MCP_FOUR_PRIMARY_TOOLS_PRESENT=NO
CANDIDATE_A2A_LIVE_PROOF=UNAVAILABLE_WITHOUT_TRAFFIC_MUTATION
DOCUMENT_PAID_RUNTIME_DEPENDENCIES_COMPLETE=YES
COMPANY_PAID_RUNTIME_DEPENDENCIES_COMPLETE=YES
WEBCTX_PAID_RUNTIME_DEPENDENCIES_COMPLETE=YES
VERIFY_PAID_RUNTIME_DEPENDENCIES_COMPLETE=YES
Q1_COMPANY_PAID_QUALIFICATION=NOT_EXECUTED
Q1_AMOUNT_ATOMIC=31200
Q1_SETTLEMENT_TX=
Q1_RECEIPT_SIGNATURE_VALID=NOT_EXECUTED
Q2_WEBCTX_PAID_QUALIFICATION=NOT_EXECUTED
Q2_AMOUNT_ATOMIC=8000
Q2_SETTLEMENT_TX=
Q2_RECEIPT_SIGNATURE_VALID=NOT_EXECUTED
Q3_DOCUMENT_PAID_QUALIFICATION=NOT_EXECUTED
Q3_AMOUNT_ATOMIC=9800
Q3_SETTLEMENT_TX=
Q3_RECEIPT_SIGNATURE_VALID=NOT_EXECUTED
Q4_VERIFY_OUTPUT_PAID_QUALIFICATION=NOT_EXECUTED
Q4_AMOUNT_ATOMIC=17000
Q4_SETTLEMENT_TX=
Q4_RECEIPT_SIGNATURE_VALID=NOT_EXECUTED
ACTUAL_TOTAL_QUALIFICATION_SPEND_ATOMIC=0
PAYMENT_IDENTITIES_UNIQUE=N/A
NONCES_UNIQUE=N/A
PAYMENT_MATERIAL_REUSE_COUNT=0
TOTAL_PAID_POSTS=0
TOTAL_SETTLEMENT_ATTEMPTS=0
TOTAL_MATCHING_TRANSFERS=0
ALL_FOUR_DISCOVERY_COHERENT=NO
C2_TRAFFIC_MUTATIONS=0
C2_END_PRODUCTION_TRAFFIC=100%
C2_END_CANDIDATE_TRAFFIC=0%
SUN1222C2_FOUR_SERVICE_PAID_QUALIFICATION=BLOCKED
SUN1222C3_FOUR_SERVICE_CANARY_ELIGIBLE=NO
SUN1222C2_EVIDENCE_COMMIT_SHA=<set on commit, corrected in follow-up commit>
NEXT_REQUIRED_CHECKPOINT=SUN-1222C2-TARGETING-WINDOW
```
