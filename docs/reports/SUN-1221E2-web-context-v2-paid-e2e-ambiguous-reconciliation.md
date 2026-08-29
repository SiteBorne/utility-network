# SUN-1221E2 — web_context_verified.v2/CDP zero-traffic requalification + real paid E2E (AMBIGUOUS → RECONCILED SAFE)

## 1. Authorization

User explicitly authorized, in a standalone message:

- Candidate: `915be949-b46f-464b-a4d6-17b74539ce55`
- Temporary deployment: `de70bf98-f304-4d7f-b189-4ae2401041a0@100%` / `915be949-b46f-464b-a4d6-17b74539ce55@0%`
- All pre-payment gates (candidate attribution, REST discovery, MCP `siteborne_get_service_health` truthfulness, cross-surface coherence, readiness truthfulness, first-service non-regression, remaining 10 routes inactive, Nevermined inactive, canonical request validation)
- Exactly one unpaid POST to obtain a fresh 402 for `web_context_verified.v2`
- Exactly one real paid E2E, max 9000 atomic USDC, network `eip155:8453`, asset `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, buyer `0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99`, seller/payTo `0x7f44a2dd237938F18632d4CcA40f4c690295E6E1`, canonical target `https://example.com/`, canonical mode `direct`
- Max 1 payment signature, 1 EIP-3009 authorization, 1 paid submission, 1 settlement
- **No retry after payment material is created**
- Mandatory restoration to `de70bf98-f304-4d7f-b189-4ae2401041a0@100%` regardless of outcome

## 2. Pre-payment gates — all PASS

- Candidate `915be949` deployed at temporary `100/0` split, read-back confirmed.
- REST discovery (`/catalog`, `/services/web_context_verified.v2`, `/.well-known/agent-card.json`) truthful under candidate override: both `verify_agent_output.v2` and `web_context_verified.v2` production-active; remaining 10 routes inactive; Nevermined inactive.
- MCP `siteborne_get_service_health` truthful for both services (the SUN-1221E1 fix holds under this candidate).
- REST/MCP cross-surface coherence confirmed.
- `/ready` truthful.
- First-service (`verify_agent_output.v2`) non-regression confirmed (still returns its own correct 402/economics).
- Fresh 402 for `web_context_verified.v2` obtained and verified exact-match: `amount=9000`, `network=eip155:8453`, `asset=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, `payTo=0x7f44a2dd237938F18632d4CcA40f4c690295E6E1`, `quote_id=qte_1cdda6b84605101e2787ef9d`.
- Buyer balance check: `28197` atomic USDC available (≥ 9000 required).

## 3. Real paid E2E — result: AMBIGUOUS at the client

The user ran `pnpm web-context-first-paid-e2e` in their own terminal with their own CDP credentials (I never had access to CDP secrets and did not execute or observe the signing step). The client (`apps/edge-api/tests/live/web-context-first-paid-e2e-local.test.ts`), built with a single-shot budget and no-retry guarantee, reported:

```json
{"ok":false,"stage":"RESULT_OBSERVED","challenge_received":true,"challenge_validated":true,"payment_material_created":true,"paid_request_submitted":true,"submission_result":"ambiguous","http_status":502}
```

A payment signature **was created and submitted**. The worker returned HTTP 502 rather than a clean success or rejection. Per the authorization's explicit instruction, no retry was attempted; the attempt was submitted exactly once.

## 4. Immediate mandatory restoration

Executed immediately after the ambiguous result was reported, before reconciliation:

```
wrangler versions deploy de70bf98-f304-4d7f-b189-4ae2401041a0@100 \
  --message "SUN-1221E2 mandatory restoration after ambiguous paid submission (HTTP 502)" --yes
```

Read-back confirmed: single active version `de70bf98-f304-4d7f-b189-4ae2401041a0@100%`, candidate `915be949` removed from the active deployment. `/health` → 200. `/ready` → `production_services_enabled: true` (known-good baseline; `verify_agent_output.v2` is the live first service — this is the correct, expected known-good state, not the candidate under test).

`SUN1221E2_RESTORATION = PASS`. `FINAL_PRODUCTION_VERSION = de70bf98-f304-4d7f-b189-4ae2401041a0`. `FINAL_PRODUCTION_TRAFFIC = 100%`. `POST_E2_PRODUCTION_PREFLIGHT = PASS`.

## 5. Reconciliation — on-chain, D1, facilitator evidence

### D1 `payment_attempts` (authoritative, remote)

```
id:                            57a2bcdb-3d47-4369-b871-2d7befec555c
payment_identifier:            pay_5b90677d6a7d4a178bec037e21409e22
quote_id:                      qte_9963cfc676f1f3849db19a3d
service_id:                    web_context_verified.v2
amount:                        9000
lifecycle_stage:                verified   ← NOT "settled"
settlement_transaction_reference: null      ← no on-chain reference recorded
created_at:                    2026-08-29T17:54:27.958Z
consumed_at:                   null         ← never consumed
```

The signed EIP-3009 authorization was received and cryptographically **verified**, but the attempt never advanced to `settled`. No settlement transaction reference exists.

### D1 `x402_service_results`

No row exists for `payment_identifier = pay_5b90677d6a7d4a178bec037e21409e22` / `web_context_verified.v2`. The only row present is the historical `verify_agent_output.v2` settlement from SUN-1220O (`0x612efe6f...`), unrelated and unchanged. **No result or receipt was ever produced for this attempt.**

### On-chain — independent verification (read-only)

Buyer balance (viem, direct Base mainnet RPC read, `erc20.balanceOf`):

```json
{"buyer":"0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99","asset":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913","balance_atomic":"28197","balance_human":"0.028197"}
```

Identical to the pre-attempt balance recorded during gating (`28197` atomic). **No decrease occurred — no USDC moved.**

BaseScan address history for the buyer, independently checked in-browser: **exactly one transaction total, from 10 days prior** (an unrelated small ETH funding transfer). No transaction of any kind — successful, reverted, or pending — appears around `2026-08-29T17:54:27Z`. **Nothing was ever broadcast to the chain for this attempt.**

### Classification

`RECONCILED_CLASSIFICATION = NO_SETTLEMENT_OCCURRED / SAFE_FAILURE`

The HTTP 502 reflects a failure between the worker and the CDP facilitator's settlement step — most likely the facilitator's `settle` call itself erroring or timing out after the authorization was validated — not a failure that reached the chain. The buyer's funds are fully intact. No duplicate-settlement risk exists because no settlement occurred at all.

```
EXTERNAL_SETTLEMENT_OCCURRED=            NO
BUYER_FUNDS_AFFECTED=                    NO (balance unchanged: 28197 atomic before and after)
DUPLICATE_SETTLEMENT_DETECTED=           NO
RECEIPT_ISSUED=                          NO
```

## 6. Outstanding consideration (flagged, not acted on)

The signed EIP-3009 authorization created during this attempt was never consumed on-chain. Depending on its `validAfter`/`validBefore` window (not independently re-derived here — reconstructing it would require re-deriving payment material, which is out of scope and not authorized), it may theoretically remain replayable by the facilitator until it expires. This is a routine x402/EIP-3009 characteristic (bounded-validity signed authorizations), not a new vulnerability introduced by this attempt, and no further action was authorized or taken.

## 7. Final stop packet

```
SUN1221E2_PRE_PAYMENT_GATES=            PASS
SUN1221E2_402_OBTAINED=                 PASS (qte_1cdda6b84605101e2787ef9d, exact match)
SUN1221E2_REAL_PAID_E2E_RESULT=         AMBIGUOUS (HTTP 502 after signed submission)
SUN1221E2_RETRY_PERFORMED=              NO (correctly withheld per authorization)
EXTERNAL_SETTLEMENT_OCCURRED=           NO
BUYER_BALANCE_UNCHANGED=                YES (28197 atomic, before == after)
DUPLICATE_SETTLEMENT_DETECTED=          NO
SUN1221E2_RESTORATION=                  PASS
FINAL_PRODUCTION_VERSION=               de70bf98-f304-4d7f-b189-4ae2401041a0
FINAL_PRODUCTION_TRAFFIC=               100%
POST_E2_PRODUCTION_PREFLIGHT=           PASS
CURRENT_REAL_PAYMENT_AUTHORIZATION=     CONSUMED
SECOND_REAL_PAID_ATTEMPT_AUTHORIZED=    NO
SUN1221F_PUBLIC_CANARY_ELIGIBLE=        NO (real settlement for web_context_verified.v2 remains unproven; a fresh real-paid-E2E authorization is required before any canary)
```

STOP. No second payment attempted. No canary begun. No promotion performed.
