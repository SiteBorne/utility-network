# SUN-1221E5 — web_context_verified.v2 / CDP: Decisive Diagnostic Reconciliation

**Checkpoint:** SUN-1221E5 (branch-diagnostic zero-traffic qualification + one real paid E2E)
**Candidate:** `090a4bc4-64e4-4152-8ce9-d41977238162` (SUN-1221E4P protocol-diagnostic candidate)
**Production:** `de70bf98-f304-4d7f-b189-4ae2401041a0` @ 100% (unchanged before/after; restored immediately per no-retry law)

## Result

`SUN1221E5_REAL_PAID_E2E = FAIL_RECONCILED_NO_SETTLEMENT` — same outcome class as E3/E4, but with a
**decisive** difference: for the first time, the E4P diagnostic instrumentation fired a specific,
non-generic reason code instead of the collapsed `WEBCTX_UPSTREAM_PROTOCOL_ERROR` bucket.

## Qualification (Phase A/B) — all PASS

- Production preflight PASS before and after.
- Temporary 100/0 split deployed and read back exactly.
- Candidate config read-back exact match (13/13 required vars, 6/6 secrets, `CDP_WALLET_SECRET` absent).
- Ordinary routing stayed on known-good (`de70bf98`) across `/health`, `/ready`, `/catalog`.
- Candidate override attribution confirmed via authoritative tail (`scriptVersion.id = 090a4bc4-...`).
- REST discovery (`/ready`, `/catalog`, service detail, agent-card) truthful: `verify_agent_output.v2`
  and `web_context_verified.v2` both `production_enabled: true`; remaining 6 CDP routes `false`.
- All 10 non-target paid routes (other 6 CDP + 4 Nevermined) return HTTP 404 under candidate override.
- Official MCP client (`@modelcontextprotocol/client`, protocol version `2026-07-28`) confirms
  `siteborne_get_service_health` reports `real_executor` / `production_enabled` / `configured` for
  both active services — REST and MCP fully coherent.
- First-service (`verify_agent_output.v2`) non-regression confirmed; E4P touched only shared
  diagnostic-only transport code (`errors.ts`, `socket-http-client.ts`), proven zero behavioral change
  via full regression (2416 tests).
- Fresh unpaid 402 obtained and canonically decoded: exact match to frozen contract (`amount: "9000"`,
  `network: "eip155:8453"`, `asset: 0x8335...29913`, `payTo: 0x7f44...5E6E1`, `extra.name: "USD Coin"`,
  `extra.version: "2"`).
- Buyer balance sufficient: 28197 atomic USDC (≥ 9000 required) before submission.
- Local payment client: routing-constant-only fix (candidate ID `a088632e-...` → `090a4bc4-...`), no
  Worker runtime/source change; typecheck clean; 13/13 non-economic unit tests pass.

## The one real paid submission

`pnpm exec tsx scripts/web-context-first-paid-e2e.ts` run by the operator returned:

```json
{"ok":false,"stage":"RESULT_OBSERVED","challenge_received":true,"challenge_validated":true,
 "payment_material_created":true,"paid_request_submitted":true,
 "submission_result":"ambiguous","http_status":502}
```

No retry was made (absolute no-retry law). Production was restored to `de70bf98-f304-4d7f-b189-4ae2401041a0
@ 100%` immediately, confirmed by authoritative read-back and preflight PASS, before any forensic work began.

## Reconciliation

**D1 (`payment_attempts`, id `e8d2607b-c3e3-4690-825a-b919bdaa9a48`):**
`lifecycle_stage = "verified"`, `settlement_transaction_reference = null`,
`service_output_hash = null`, `service_receipt_id = null`. Facilitator `verify()` succeeded;
`settle()` was never reached.

**D1 (`audit_events`), full timeline for this attempt:**

| timestamp (UTC) | event_type | detail |
|---|---|---|
| 01:24:29.986 | `payment_required_created` | quote `qte_d084ba9d9b1d2c781e157df8` |
| 01:24:30.515 | `payment_payload_received` | `valid: true`, rail `cdp` |
| 01:24:30.606 | `job_created` | job `ee04c4bf-1b74-44c6-a1ab-00edc235b4a9` |
| 01:24:30.927 | `payment_verification_requested` | |
| 01:24:31.046 | `payment_verified` | facilitator verify() succeeded |
| 01:24:31.260 | `service_execution_started` | real executor invoked |
| 01:24:31.425 | **`service_execution_diagnostic`** | **`result_class: "internal_verification_failed"`, `diagnostic_reason_code: "WEBCTX_HTTP_PREMATURE_EOF"`, `diagnostic_stage: "direct_public_http_fetch"`** |

**On-chain (Base mainnet, via `viem` read-only RPC):**
- Buyer USDC balance: 28197 atomic, unchanged before → after (delta = 0).
- `Transfer(buyer → seller)` log search over the last 200 blocks: **0 matches**.
- The signed EIP-3009 authorization (`valid_before: 1788053130`) was never used on-chain and is now
  time-bound toward expiry; it must never be reused.

**x402_service_results:** zero rows for this `payment_identifier` — no service result was ever persisted,
consistent with `settle()` never being called.

## Why this is decisive

E3 and E4 both collapsed into the generic `WEBCTX_UPSTREAM_PROTOCOL_ERROR` bucket with no further
detail. SUN-1221E4P instrumented every known branch of the hand-rolled HTTP/1.1 parser
(`socket-http-client.ts`) with distinct, sanitized diagnostic codes — including
`WEBCTX_HTTP_PREMATURE_EOF` for the header-loop and chunk-loop "clean stream close before framing
is complete" paths. This is the **first live attempt where that instrumentation actually
distinguished a specific branch**, ruling out (for this attempt) the `WEBCTX_RESPONSE_READ_FAILED`
socket-read-rejection path (E4's finding) and the 1xx-interim-response `RangeError` path
(characterized but never proven live). The evidence now points specifically at: the raw TCP
connection to `https://example.com/` closed (cleanly, at the transport layer) before the HTTP/1.1
parser finished reading either the response headers or a chunk boundary.

This is real, actionable signal — but a single occurrence is not yet a proven root cause for a fix.
Per the checkpoint's evidence law, no behavioral change is made in this reconciliation-only checkpoint.

## Final state

| Field | Value |
|---|---|
| `SUN1221E5_CLIENT_OUTCOME` | AMBIGUOUS |
| `SUN1221E5_REAL_PAID_E2E` | FAIL |
| `SUN1221E5_RECONCILED_E2E_OUTCOME` | FAIL_RECONCILED_NO_SETTLEMENT |
| `FACILITATOR_VERIFY_STATUS` | success |
| `FACILITATOR_SETTLE_CALLED` | NO |
| `E5_DIAGNOSTIC_REASON_CODE` | WEBCTX_HTTP_PREMATURE_EOF |
| `E5_DIAGNOSTIC_STAGE` | direct_public_http_fetch |
| `E5_RESULT_CLASS` | internal_verification_failed |
| `E5_ROOT_CAUSE_PROVEN` | NO (narrowed, not proven — single occurrence) |
| `E5_BUYER_USDC_ECONOMIC_EFFECT_ATOMIC` | 0 |
| `E5_ONCHAIN_TRANSFER_COUNT` | 0 |
| `SUN1221E5_RESTORATION` | PASS |
| `FINAL_PRODUCTION_VERSION` | de70bf98-f304-4d7f-b189-4ae2401041a0 |
| `FINAL_PRODUCTION_TRAFFIC` | 100% |
| `POST_E5_PRODUCTION_PREFLIGHT` | PASS |
| `NEW_SECRET_FINDINGS` | 0 |
| `E5_OWN_TAIL_STOPPED` | YES |
| `CURRENT_REAL_PAYMENT_AUTHORIZATION` | CONSUMED |
| `SECOND_E5_PAYMENT_ATTEMPT_AUTHORIZED` | NO |
| `SUN1221F_PUBLIC_CANARY_ELIGIBLE` | NO |

## Recommended next step (not authorized here)

Investigate `WEBCTX_HTTP_PREMATURE_EOF` at `direct_public_http_fetch` specifically for requests to
`https://example.com/` from within a Cloudflare Workers raw-socket (`connect()`) context — e.g.
whether the target server's keep-alive/connection-close behavior interacts badly with the
hand-rolled parser's expectations, or whether the Workers runtime's socket surfaces `done: true`
in a way this parser doesn't yet handle correctly. This would need targeted, isolated
reproduction (not guesswork) before any fix is proposed.
