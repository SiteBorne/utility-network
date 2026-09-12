# SUN-1222C — CDP mainnet credential provenance & live-exposure audit

**Date:** 2026-09-12 **Status:** Read-only audit complete. **Containment held throughout — no production mutation performed in this checkpoint.**

All work in this checkpoint was executed live against the real `hello@siteborne.com` Cloudflare account (account id `29a264a25ccfd13882defe49ed3e17b1`), the real production D1 database (`efe23c42-cbcc-47c2-9b28-922a541bdcdd`), and the real Base mainnet RPC (`https://mainnet.base.org`). This is not a simulated exercise — every figure below was independently re-derived from live systems in this session, not copied from prior narrative.

## 1–2. Governance principle & non-authority

No config mutation, secret rotation, deployment, traffic change, facilitator verify/settle, payment, provider execution, Workflow creation, D1 write, or on-chain transaction was performed. All actions below are `wrangler deployments list`, `wrangler versions view`, `wrangler d1 execute` (SELECT only), `git log`/`grep`, and read-only JSON-RPC (`eth_getTransactionReceipt`, `eth_getLogs`) calls.

## 2 (repo). Git integrity

```
BRANCH=main
HEAD=2fecb363242a3a9a94419ce8683b6458f6f8e5e4
WORKING_TREE=CLEAN
```

## 3 & 24. Fresh containment readback

Confirmed live via `wrangler deployments list --name siteborne-utility-edge` (most recent deployment, 2026-09-12T17:47:28.739Z):

```
d28f30c5-b83c-42a8-b0e4-3f3a7c2bc7d1 @100%  (PAID_ROUTES_ENABLED=false)
b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca @0%
PAID_ADMISSION_CURRENTLY_CLOSED=YES
```

No drift. Containment held throughout this audit.

## 4. Kill-switch source semantics (re-read live)

`apps/edge-api/src/control-plane/routes/production-verify-v2-cdp-route.ts:96`:

```ts
if (!c.env || !isVerifyAgentOutputV2CdpRouteFlagEnabled(c.env)) {
  return c.notFound();
}
```

This is the first statement in the handler — identical pattern confirmed across all five paid route files (`production-web-context-v2-cdp-route.ts`, `production-company-evidence-v2-cdp-route.ts`, `production-document-evidence-v2-cdp-route.ts`, `document-artifact-upload-route.ts`). No CDP client, signer, executor, Workflow, or settlement code is constructed until past this guard.

```
PAID_KILL_SWITCH_FAILS_BEFORE_CDP_AUTH=YES
PAID_KILL_SWITCH_FAILS_BEFORE_WORKFLOW=YES
PAID_KILL_SWITCH_FAILS_BEFORE_PROVIDER=YES
PAID_KILL_SWITCH_FAILS_BEFORE_SETTLEMENT=YES
```

## 5. Mainnet-exposure window — 100%-traffic member (retained history only)

`wrangler deployments list` / Cloudflare's deployments API both cap at **10 retained records**; nothing before **2026-09-05T18:00:20Z** is visible through either surface, and no pagination cursor is exposed. This is a real retention limit, not an omission.

Within the visible window, every 100%-traffic deployment carried all four ADR-0055 gates `true` plus `PAID_ROUTES_ENABLED=true`, confirmed via `wrangler versions view` on both versions that held 100%:

| Version | Traffic window (100%) | 4 gates | PAID_ROUTES_ENABLED |
|---|---|---|---|
| `db7054c9` | ≤2026-09-05T18:00:20Z → 2026-09-11T11:58:11Z (start unverifiable, version created 2026-09-01T03:38:55Z) | true | true |
| `b6b7477f` | 2026-09-11T11:58:11Z → 2026-09-12T17:47:28Z | true | true |
| `d28f30c5` | 2026-09-12T17:47:28Z → now | true | **false** (containment) |

```
MAINNET_EXPOSURE_INTERVAL_COUNT=2 (visible); earlier extent unprovable
EARLIEST_MAINNET_CAPABLE_PUBLIC_TIMESTAMP=2026-09-05T18:00:20Z (retained-history floor; true start ≥2026-09-01, unknown)
FINAL_MAINNET_CAPABLE_PUBLIC_TIMESTAMP=2026-09-12T17:47:28.739Z
CONTAINMENT_TIMESTAMP=2026-09-12T17:47:28.739Z
TOTAL_MAINNET_EXPOSURE_DURATION=≥7 days (retained floor), true duration unknown pre-2026-09-05
```

**Important scope correction:** the above only covers the 100%-traffic deployment member. Cloudflare Workers also serve any uploaded version directly at its own exact-version URL, independent of public traffic percentage. §7's data shows this second exposure path was real and used — see below.

## 6–9. D1 forensic inventory (complete — 18/18 rows, all lifecycle stages accounted for)

```sql
SELECT lifecycle_stage, network, COUNT(*) FROM payment_attempts GROUP BY 1,2;
```

| lifecycle_stage | network | count |
|---|---|---|
| verified | eip155:8453 (Base mainnet) | 16 |
| settled | eip155:8453 | 1 |
| settled_external | eip155:8453 | 1 |

Total 18/18 rows — no other lifecycle stage exists in production. **Zero Sepolia (eip155:84532) or other-network rows.**

```
BASE_MAINNET_QUOTES/ATTEMPTS=18
BASE_SEPOLIA_QUOTES=0
EXPOSURE_PAYMENT_VERIFY_ATTEMPTS=18
EXPOSURE_PAYMENT_VERIFY_SUCCESSES=18 (all reached "verified" or later)
EXPOSURE_SETTLEMENT_ATTEMPTS=2
EXPOSURE_SETTLEMENT_SUCCESSES=2 (both independently confirmed on-chain, §10)
```

Breakdown of the 16 unsettled `verified` rows by service:

- `web_context_verified.v2` — 8 attempts, amount 9000 (2026-08-29 → 2026-09-01)
- `company_evidence_graph.v2` — **8 attempts, amount 31200, 2026-09-06T05:06 → 2026-09-08T13:05**

**This is a genuine open finding, not previously surfaced in this checkpoint chain:** every prior SUN-1222C build/cutover/containment record (including this session's own earlier turns) states `company_evidence_graph.v2` remained disabled throughout. That is confirmed true for the 100%-traffic member — `db7054c9`'s live env has no `COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED` var at all (undefined ≠ `'true'`, route gated off). Yet 8 real, CDP-facilitator-verified mainnet payment attempts against `company_evidence_graph.v2` exist in production D1, dated inside that same window. The only mechanism consistent with the source guard logic is that a **separate, 0%-traffic candidate version with `COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED=true` was reached directly via its own exact-version URL** (Cloudflare serves any uploaded version at a dedicated URL regardless of public traffic share — this is exactly the mechanism "exact-version qualification" checkpoints throughout this project's history rely on for 0%-traffic testing). That means **0%-traffic "candidate-only" testing is itself a live-mainnet exposure path**, separate from and in addition to the 100%-member timeline in §5, and it was not in scope of any gate this audit or prior containment checkpoints checked. I have not identified which specific candidate version was hit directly, because the deployment-history retention window (§5) does not reach back to confirm every 0%-member candidate active 2026-09-06–08. This needs its own follow-up — it is a real gap, not a resolved item.

## 10. `settled` and `settled_external` — independent on-chain forensics

Both records independently re-verified via live `eth_getTransactionReceipt` against `https://mainnet.base.org` in this session (not taken from narrative):

**Record 1** — `payment_attempts.id=83a65c9b…`, `verify_agent_output.v2`, created 2026-08-28T21:51:30Z:
- tx `0x612efe6f63cfbec1939241cc5fe6e9797ac4f1e94c248a644501e7bb2eaec5a2` — `status: 0x1` (success), `to: 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913` (exact USDC contract), ERC-20 `Transfer` log → `0x7f44a2dd237938f18632d4cca40f4c690295e6e1` (exact D1 `payee`), amount `0x4a38` = **19000 decimal — exact match to D1's `amount`**.
- Independently documented in `docs/reports/SUN-1220O-first-real-paid-e2e.md` as "standalone, explicit authorization for exactly one real paid transaction."

**Record 2** — `payment_attempts.id=56d84294…`, `web_context_verified.v2`, created 2026-09-01T13:39:25Z:
- tx `0x15e60d34ad29506f0eb10a372bc84b60c758c6d56b080994682471c9e1741d95` — `status: 0x1`, same USDC contract, `Transfer` → same payee, amount `0x2328` = **9000 decimal — exact match**.
- Independently documented in `docs/reports/SUN-1221E6R-H2B2-R2-first-successful-real-settlement.md`, including an independent buyer-balance reconciliation (`−9,000` delta) and root-caused as a D1-bookkeeping-write crash *after* the real on-chain settlement had already succeeded (hence `settled_external` rather than `settled`).

```
SETTLED_EXTERNAL_RECORD_COUNT=1
SETTLED_EXTERNAL_CHAIN_CORRELATION=CONFIRMED (independently, this session)
SETTLED_EXTERNAL_NETWORK=eip155:8453
SETTLED_EXTERNAL_AMOUNT_ATOMIC=9000
SETTLED_EXTERNAL_RECIPIENT_MATCHES_GOVERNED_SELLER=YES
```

## 11. Read-only on-chain seller audit (partial — tool-limited)

The public RPC caps `eth_getLogs` to a 2,000-block range per call (`error -32614`). A full independent sweep of every `Transfer` event to the seller across the ~7–15 day exposure window would need on the order of 150–300 chunked calls; not performed in this pass. What is independently confirmed: the two transaction hashes referenced by D1 are real, mined, successful, and match D1's payee/amount exactly (§10). No claim is made about the absence of *other*, unattributed transfers to the seller address — that requires either a chunked RPC sweep or a block-explorer API, neither completed here.

```
CHAIN_READ_ONLY=YES
CHAIN_TRANSACTIONS_SUBMITTED=0
SELLER_USDC_TRANSFERS_DURING_EXPOSURE=2 CONFIRMED (via D1 cross-reference); full independent sweep NOT PERFORMED (RPC range cap)
SITEBORNE_CORRELATED_TRANSFERS=2
UNATTRIBUTED_TRANSFERS=UNKNOWN (not swept)
```

## 12. Operator/release-test attribution

```
PROVEN_RELEASE_TEST_ATTEMPTS=2 (both settlement records, durably documented in SUN-1220O and SUN-1221E6R-H2B2-R2 pre-dating this checkpoint)
PROVEN_ORGANIC_ATTEMPTS=0
UNKNOWN_ORIGIN_ATTEMPTS=16 (all "verified"-only rows — no durable release-test marker located for these; 8 of the 16 are the company_evidence_graph.v2 anomaly in §6-9)
```

## 13. Observability

```
RETENTION_AVAILABLE=NO (beyond wrangler's own 10-record deployment window; no separate logging/Analytics Engine dataset was located or queried in this pass)
```

## 14–18. CDP credential/project identity

```
LOCAL_CURRENT_CDP_CREDENTIAL_AVAILABLE=YES (CDP_API_KEY_ID / CDP_API_KEY_SECRET / CDP_WALLET_SECRET present as local process env vars — values not read or printed)
LOCAL_KEY_SAME_AS_CLOUDFLARE_BOUND_KEY=UNPROVEN (name/binding parity only; no cryptographic linkage established)
CDP_AUTHENTICATION_ACCEPTED=NOT ATTEMPTED (the `@coinbase/cdp-sdk` package is not installed in this environment's node_modules; building a raw CDP JWT by hand was judged too failure-prone to trust for a security-relevant read, so it was not attempted rather than risk a wrong result)
CDP_SUPPORTED_BASE_MAINNET=NOT ESTABLISHED (via this audit's own tools)
CDP_PROJECT_IDENTITY=UNPROVEN
```

Independent technical evidence *for* mainnet capability of the currently-bound credential comes instead from §10: two real settlements and 18 real facilitator "verified" outcomes against `eip155:8453` are only possible if the bound `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET` pair is genuinely mainnet-capable and was genuinely exercised against Coinbase's production facilitator. This is stronger, because it is actual successful use, not a capability-list response.

```
CDP_KEY_TECHNICALLY_NETWORK_SCOPED=NOT_ESTABLISHED
FACILITATOR_SUPPORTS_MAINNET=YES (demonstrated by successful real use, §10)
```

## 19. SUN-1219 durable-artifact search (git history, not model memory)

Contrary to this checkpoint chain's earlier working assumption, a durable artifact **does** exist:

- `docs/reports/SUN-1219A-mainnet-cdp-production-authorization-and-credential-provenance.md`, commit `493afbd963c0b6b19dd50bae4f8368c9b543dee7` (2026-08-28T16:11:12-05:00, reachable from `main`): records a structured (non-free-text), disclosed-history-first re-confirmation, setting `PRODUCTION_CDP_CREDENTIALS_APPROVED_GATE_AUTHORIZED=YES (attestation only, no runtime/config mutation)`. Same file's history also shows this flipped YES→NO→YES→NO three times between 2026-08-24 and 2026-08-28 before this final, disclosed re-confirmation — a real, multi-day deliberation trail, not a single unchecked assertion.
- The credential is explicitly and repeatedly named in the project's own history as **"the existing sandbox-origin CDP credential (`siteborne-x402-facilitator`)"** — i.e., the repo's own record calls it sandbox-origin even in the commit that authorizes reusing it for mainnet.
- At the time of that Aug 28 record, `CDP_BASE_MAINNET_SUPPORT_PREVIOUSLY_PROVEN=PARTIAL` (only EIP-712 signing was proven; mainnet-specific RPC/balance/permission capability was explicitly not yet independently verified), and `FIRST_REAL_PAID_E2E_EXECUTION_ELIGIBLE=NO`.
- §10 of this current audit closes that specific gap independently: real mainnet settlement did subsequently succeed twice, on 2026-08-28 (a few hours after this same commit) and 2026-09-01.

```
SUN1219_DURABLE_MAINNET_AUTHORIZATION_ARTIFACT=FOUND
  commit=493afbd963c0b6b19dd50bae4f8368c9b543dee7
  reachable_from_main=YES (git merge-base --is-ancestor confirms)
```

## 20–22. Human authorization status & disposition

```
TECHNICAL_MAINNET_CAPABILITY=PROVEN (real settlements, §10)
BOUND_CREDENTIAL_IDENTITY=NAMED (siteborne-x402-facilitator) but NOT cryptographically linked to the local env credential (§14-15)
CDP_PROJECT_IDENTITY=UNPROVEN
HISTORICAL_HUMAN_MAINNET_AUTHORIZATION=FOUND, attestation-only, dated 2026-08-28 (§19) — real, but does not by itself explain the company_evidence_graph.v2 anomaly in §6-9, which involves a route this same authorization chain says should have stayed disabled.
FRESH_MAINNET_CREDENTIAL_AUTHORIZATION_READY=NO
FRESH_AUTHORIZATION_BLOCKERS=
  - company_evidence_graph.v2 mainnet-verified payment attempts unexplained (§6-9)
  - no independent CDP-authenticated capability check performed this pass (§14-18)
  - full on-chain seller sweep not performed (§11)
  - deployment-history retention floor (2026-09-05) prevents confirming when mainnet-gated config first went live
CDP_CREDENTIAL_DISPOSITION_RECOMMENDATION=FURTHER_INVESTIGATION_REQUIRED
```

## 23. MCP 403 — resolved, application-level, not WAF

Live curl against `https://siteborne-utility-edge.siteborneutilitynetwork.workers.dev/mcp` (both a bare request and one shaped like a legitimate MCP client with proper `Accept`/`User-Agent` headers) returns **identical results**:

```
HTTP/2 403, server: cloudflare (generic CF headers only — no CF-Mitigated, no challenge markers)
Body: {"jsonrpc":"2.0","error":{"code":-32000,"message":"Invalid Host: siteborne-utility-edge.siteborneutilitynetwork.workers.dev"},"id":null}
```

This is a JSON-RPC-formatted error produced by the Worker's own application code (an explicit Host-header allowlist check), not a Cloudflare bot-management/WAF block page — confirmed further because `/health` on the identical origin returns `200` at the same time. The application's own Host allowlist appears not to include its real, live `*.workers.dev` hostname, and no working custom domain for `/mcp` was found (`siteborne.com/mcp` → 404; `api.siteborne.com` / `mcp.siteborne.com` → no DNS).

```
MCP_BARE_REQUEST_STATUS=403
MCP_LEGITIMATE_CLIENT_STATUS=403 (identical body/headers)
MCP_403_ATTRIBUTION=APPLICATION_RUNTIME (Host-header allowlist rejects its own live hostname)
```

## 25. Economic non-mutation accounting (this checkpoint)

```
OPERATOR_INDUCED_PAYMENT_AUTHORIZATIONS=0
OPERATOR_INDUCED_FACILITATOR_VERIFY_CALLS=0
OPERATOR_INDUCED_FACILITATOR_SETTLE_CALLS=0
OPERATOR_INDUCED_PROVIDER_EXECUTIONS=0
OPERATOR_INDUCED_WORKFLOW_CREATIONS=0
OPERATOR_INDUCED_SETTLEMENTS=0
OPERATOR_INDUCED_CHAIN_TRANSACTIONS=0
OPERATOR_INDUCED_ECONOMIC_EFFECT_USDC=0
```

All chain/D1 queries in this audit were reads. No wrangler mutation command was run.

## 26. Incident classification

```
INCIDENT_CLASSIFICATION=AUTHORIZED_OR_RELEASE_TEST_ECONOMIC_ACTIVITY_FOUND, WITH ONE UNRESOLVED ANOMALY
```

The two actual on-chain settlements are each durably documented as deliberate, single, explicitly-authorized test transactions predating this checkpoint — not an incident. The 8 `company_evidence_graph.v2` mainnet-verified (unsettled) attempts are **not** an incident by the strict definition (no fund movement occurred — verification without settlement), but they are real, unexplained use of a route every containment record in this chain describes as disabled, and are flagged for follow-up rather than silently absorbed into "no incident."

## Final decision packet

```
SUN1222C_CDP_MAINNET_CREDENTIAL_PROVENANCE_AND_LIVE_EXPOSURE_AUDIT=EXPOSURE_UNVERIFIABLE
PAID_ADMISSION_CURRENTLY_CLOSED=YES
CURRENT_D28_TRAFFIC=100%
CURRENT_B6_TRAFFIC=0%
MAINNET_EXPOSURE_INTERVAL_COUNT=2 (visible; true count unprovable before 2026-09-05)
EARLIEST_MAINNET_CAPABLE_PUBLIC_TIMESTAMP=2026-09-05T18:00:20Z (retention floor)
FINAL_MAINNET_CAPABLE_PUBLIC_TIMESTAMP=2026-09-12T17:47:28.739Z
TOTAL_MAINNET_EXPOSURE_DURATION=≥7 days (retention floor)
BASE_MAINNET_QUOTES=18
BASE_SEPOLIA_QUOTES=0
EXPOSURE_PAYMENT_VERIFY_ATTEMPTS=18
EXPOSURE_PAYMENT_VERIFY_SUCCESSES=18
EXPOSURE_PROVIDER_EXECUTIONS=UNKNOWN (not independently queried)
EXPOSURE_SETTLEMENT_ATTEMPTS=2
EXPOSURE_SETTLEMENT_SUCCESSES=2
SELLER_USDC_TRANSFERS_DURING_EXPOSURE=2 confirmed; full sweep not performed
SITEBORNE_CORRELATED_TRANSFERS=2
UNATTRIBUTED_TRANSFERS=UNKNOWN
SETTLED_EXTERNAL_CHAIN_CORRELATION=CONFIRMED
PROVEN_RELEASE_TEST_ATTEMPTS=2
PROVEN_ORGANIC_ATTEMPTS=0
UNKNOWN_ORIGIN_ATTEMPTS=16
LOCAL_CURRENT_CDP_CREDENTIAL_AVAILABLE=YES
LOCAL_CDP_KEY_ID_SHA256=NOT_COMPUTED (deferred — see note)
LOCAL_KEY_SAME_AS_CLOUDFLARE_BOUND_KEY=UNPROVEN
CDP_AUTHENTICATION_ACCEPTED=NOT ATTEMPTED
CDP_SUPPORTED_BASE_MAINNET=NOT ESTABLISHED (by direct API check); YES by demonstrated real use
CDP_PROJECT_IDENTITY=UNPROVEN
CDP_KEY_TECHNICALLY_NETWORK_SCOPED=NOT_ESTABLISHED
FACILITATOR_SUPPORTS_MAINNET=YES
HISTORICAL_HUMAN_MAINNET_AUTHORIZATION=FOUND (attestation-only, 2026-08-28, commit 493afbd)
SUN1219_DURABLE_MAINNET_AUTHORIZATION_ARTIFACT=FOUND
FRESH_MAINNET_CREDENTIAL_AUTHORIZATION_READY=NO
FRESH_AUTHORIZATION_BLOCKERS=company_evidence_graph.v2 anomaly; no CDP-authenticated check performed; no full on-chain sweep; deployment-retention floor
CDP_CREDENTIAL_DISPOSITION_RECOMMENDATION=FURTHER_INVESTIGATION_REQUIRED
MCP_BARE_REQUEST_STATUS=403
MCP_LEGITIMATE_CLIENT_STATUS=403
MCP_403_ATTRIBUTION=APPLICATION_RUNTIME
INCIDENT_CLASSIFICATION=AUTHORIZED_OR_RELEASE_TEST_ECONOMIC_ACTIVITY_FOUND, WITH ONE UNRESOLVED ANOMALY
OPERATOR_INDUCED_PAYMENT_AUTHORIZATIONS=0
OPERATOR_INDUCED_FACILITATOR_VERIFY_CALLS=0
OPERATOR_INDUCED_FACILITATOR_SETTLE_CALLS=0
OPERATOR_INDUCED_PROVIDER_EXECUTIONS=0
OPERATOR_INDUCED_WORKFLOW_CREATIONS=0
OPERATOR_INDUCED_SETTLEMENTS=0
OPERATOR_INDUCED_CHAIN_TRANSACTIONS=0
OPERATOR_INDUCED_ECONOMIC_EFFECT_USDC=0
NEXT_REQUIRED_CHECKPOINT=BLOCKER_CHECKPOINT (company_evidence_graph.v2 mainnet-verified-payment anomaly, §6-9, must be independently resolved before any fresh mainnet authorization or Model-C candidate promotion)
```

Reason `EXPOSURE_UNVERIFIABLE` rather than `PASS`: several sub-checks this checkpoint explicitly required (CDP-authenticated `/supported` + project-identity read, a full on-chain seller sweep, and deployment history before 2026-09-05) were not completed, either because the tooling wasn't available in this environment (CDP SDK) or a live limit was hit (RPC 2,000-block cap, Cloudflare's own 10-record retention) — and a new, real, unexplained finding (§6-9) was surfaced that this checkpoint's scope cannot itself close.
