# SUN-1000 Checkpoint 1O-B2B — v2 CDP Base-Sepolia Proof

Interim checkpoint 1O-B2A accepted at `e10dbb9`. This checkpoint completes the
independent, CDP-only portion of Phase-2 v2 provider activation while the
Nevermined provider issue (classified `NEVERMINED_BACKEND_REGRESSION_OR_DEFECT`,
1O-B2A) remains externally pending. **Zero Nevermined registrations, zero
Nevermined verify/settle/order calls, zero Nevermined credential reads — this
entire checkpoint makes no Nevermined call of any kind.**

## §1: baseline

Clean tree, `HEAD=e10dbb9` confirmed. Full credential-free gate suite run before
any live call:

| Gate                                                               | Result                                                            |
| ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `pnpm security:load`                                               | PASS (7/7 scenarios)                                              |
| `pnpm security:chaos`                                              | PASS (18/18 scenarios)                                            |
| `pnpm security:schemathesis`                                       | PASS (exit 0)                                                     |
| `pnpm security:semgrep`                                            | PASS (0 findings)                                                 |
| `pnpm security:osv`                                                | PASS (0 critical)                                                 |
| `pnpm security:trivy`                                              | **BLOCKED_EXTERNAL** (3 HIGH, unchanged — OpenTelemetry upstream) |
| `pnpm x402:check` / `nevermined:check` / `mcp:check` / `a2a:check` | PASS                                                              |
| `pnpm check`                                                       | PASS                                                              |

Zero Nevermined live provider calls made at any point in this checkpoint.

## §2-3: frozen blocker / CDP risk-acceptance record

- `NEVERMINED_V2_PROVIDER_STATUS=BLOCKED_EXTERNAL_PROVIDER` (per 1O-B2A). All
  four v2 Nevermined registrations, and the company-v2 delegation, preserved
  unchanged. Zero additional Nevermined verify/settle calls this checkpoint.
- `CDP_CREDENTIAL_ROTATION_COMPLETED=false`,
  `USER_ACCEPTED_EXPOSED_CDP_CREDENTIAL_RISK=true` — recorded truthfully,
  unchanged from prior checkpoints. Rotation is not represented as remediated.
  No credential value printed, hashed, or logged anywhere in this checkpoint.

## §4-5: read-only CDP identity / network safety

`x402-live-exact-v2.test.ts`'s own `beforeAll` performs both checks before any
economic mutation is reachable:

- `SELLER_WALLET_ADDRESS` is asserted to exactly equal the frozen, approved Base
  Sepolia seller address (`0x7f44a2dd...`) — a mismatch throws
  `CDP_PUBLIC_IDENTITY_CHANGED` before any further call.
- The official x402 Base Sepolia asset (`getDefaultAsset('eip155:84532')`) is
  asserted to exactly equal the approved USDC deployment
  (`0x036CbD53842c5426634e7929541eC2318f3dCF7e`).
- `checkCdpSupportsNetwork` confirms the real CDP facilitator's authenticated
  `/supported` advertises both `exact` and `upto` for `eip155:84532` before any
  buyer-account lookup or payment signing.

Both checks passed: identity unchanged, network Base Sepolia only, mainnet
(`eip155:8453`) never selectable (hardcoded constant, never derived).

## §6: exact v2 live-proof route selection

`web_context_verified.v2` — the smallest fixed-price v2 `exact`-scheme service
($0.009, `pricingKey: web_context_verified_direct`,
`governance/RISK_LIMITS.yaml`), the identical pricing key and price as the
already-accepted v1 CDP live proof it's adapted from.
`company_evidence_graph.v2` ($0.039) and `verify_agent_output.v2` ($0.019) are
both more expensive; no other v2 `exact`-scheme service is smaller.

- `service_id`: `web_context_verified.v2`
- `route`: `/v2/web/context`
- `amount`: `9000` (atomic)
- `rail`: `cdp`
- `network`: `eip155:84532`

## §7: durable D1

New dedicated persistence directory, separate from every other live checkpoint's
own directory (v1's `sun-0900b-checkpoint1`, the v2 Nevermined checkpoint's
`sun-1000-checkpoint-1o-b2`):

```
$HOME/.local/share/siteborne/live-d1/sun-1000-checkpoint-1o-b2b
```

No secret or payment-signature material is ever written to it — only the same D1
schema (`payment_attempts`, `jobs`, etc.) every other checkpoint uses.

## §8-9: exact v2 CDP proof and replay — real evidence

One bounded, real Base Sepolia lifecycle:

```
network:              eip155:84532
scheme:                exact
service_id:            web_context_verified.v2
payment_identifier:    pay_133fba4e4ff74bd182a188732c21f490
buyer:                 0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99
seller:                0x7f44a2dd237938F18632d4CcA40f4c690295E6E1
amount:                9000 (atomic, $0.009)
transaction:           0x8aec91e4b54e9f6b3ff9fd3c869d5ee29fa528f55e1679a2a9d33bdf5243fa59
receipt_id:            rcpt_f06b7121f839ed3f77f961d2
link_id:               lnk_f927e9a1b90807653fd49380
service_job_id:        7b03fad8-9111-49ec-b32f-601a12b3fc81
http_status:            200
service_execution_count: 1
facilitator_verify_count: 1
facilitator_settle_count: 1
logical_job_count:      1
```

Replay (same `PAYMENT-SIGNATURE`, immediately after): HTTP `200`, identical
`link_id`/`receipt_id`/`PAYMENT-RESPONSE` header, `service_execution_count`
still `1`, `facilitator_verify_count` still `1`, `facilitator_settle_count`
still `1` — no second execution, no second facilitator call, no second
transaction.

Test file:
[x402-live-exact-v2.test.ts](../../apps/edge-api/tests/live/x402-live-exact-v2.test.ts),
adapted call-for-call from the accepted SUN-0700B checkpoint 1 v1 reference.

## §10-12: document `upto` requirement — NOT_REQUIRED_ALREADY_PROVEN_BY_SHARED_IMPLEMENTATION

Traced `apps/edge-api/src/control-plane/routes/x402-service.ts`'s `upto`
handling directly: every `config.scheme === 'upto'` branch (authorization,
`actual_amount` computation, `authorization_exceeded` rejection) is driven
purely by `config.scheme`, never by `service_id` — the same code path executes
identically for `document_evidence_json.v1` and `.v2`. The only per-service
parameters `createX402ServiceRoute` accepts
(`pricingKey`/`inputSchemaHash`/`outputSchemaHash`/`serviceId`/`executor`) never
touch the `upto` settlement math.

This checkpoint's own §8 additionally supplies **direct empirical evidence** for
the analogous claim on the `exact` scheme: `web_context_verified.v2` reused the
identical `CdpPaymentEvidenceProvider`/facilitator/settlement code path as the
already-accepted v1 `exact` proof and settled for real with zero v2-specific
issue. Combined with the source-level confirmation that `upto`'s code path is
equally scheme-driven, not serviceId-driven, and that a real `upto` proof
already exists and is accepted for v1 (`x402-live-upto.test.ts`, SUN-0700B
checkpoint 2, real Base Sepolia settlement against `document_evidence_json.v1`),
**no redundant v2 `upto` payment was made this checkpoint.**

## §13: cross-rail Payment-Identifier conflict — local only, zero Nevermined calls

Two complementary local-only cases, both against the real, durably-persisted CDP
payment attempt from §8-9 (no synthetic identifier for the base case):

- **§13a** — presenting the SAME real, already-settled CDP `payment_identifier`
  on a synthetic (locally-constructed, never network-derived) Nevermined-shaped
  binding. `acquirePaymentAttempt`
  (`packages/protocol-x402/src/replay/idempotency.ts`) checks expiry, then
  `existing.consumed`, before ever comparing binding digests — so the real
  observed outcome is time-dependent (`expired` once the original record's TTL
  has passed; `already_consumed` within the TTL window). Both are **strictly
  stronger** terminal rejections than `duplicate_conflict` (which only governs
  still-pending bindings) — the real run for this checkpoint observed `expired`.
- **§13b** — a fresh, never-consumed CDP-shaped binding (still entirely
  local/credential-free, matching the already-accepted pattern in
  `d1-payment-attempts.test.ts`) demonstrates the literal `duplicate_conflict`
  classification for the pending case: `first_seen` on first acquire, then
  `duplicate_conflict` when the same identifier is presented with the rail
  switched to Nevermined.

Both cases: **zero Nevermined provider calls, zero Nevermined settlements, zero
second CDP transaction.** No `@nevermined-io/payments` import anywhere in the
test file.

## §14: Model-D rail isolation, without invoking the blocked Nevermined provider

`web_context_verified.v2` throughout this checkpoint is mounted via
`buildPaidServicesApp` (never `buildNeverminedV2PaidServicesApp`) — the same
app-instance construction every other test in the file uses. A direct
`POST /v2/nevermined/web/context` against that same instance returns a
structural `404` — the Nevermined-rail v2 route family was never registered on
it, proving no fallback and no stacking are possible, without making any live
Nevermined call.

## §15-16: regression / state

Full regression re-run after all live proofs (§17 of the checkpoint script;
listed in §1's table plus a second pass, both identical results). The
12-criterion SUN-1000 tally is **unchanged**: 11/12 PASS, 1/12 BLOCKED_EXTERNAL
(Trivy), 0/12 FAIL_INTERNAL, 0/12 NOT_YET_TESTED — this checkpoint's real CDP
proof is Phase-2 provider-activation evidence, not one of the 12 SUN-1000
criteria itself. `SUN-1000` remains `active`. `production_ready=false`,
`production_enabled=false`.

Nevermined Phase-2 sub-status remains `BLOCKED_EXTERNAL_PROVIDER`, unchanged by
this checkpoint (no Nevermined call made).

## §18: stop report

1. Initial HEAD/tree: `e10dbb9`, clean
2. Nevermined blocker preserved: **yes**, unchanged
3. Additional Nevermined verify calls: **0**
4. Additional Nevermined settlements: **0**
5. CDP identity reconciliation: **matched** (`SELLER_WALLET_ADDRESS` == approved
   seller)
6. Network: `eip155:84532` (Base Sepolia)
7. USDC asset: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
8. Mainnet guard: **PASS** (hardcoded testnet constant, `eip155:8453` never
   selectable)
9. Exact service: `web_context_verified.v2`
10. Exact amount: `9000` (atomic, $0.009)
11. Exact Payment-Identifier: `pay_133fba4e4ff74bd182a188732c21f490`
12. Exact transaction hash:
    `0x8aec91e4b54e9f6b3ff9fd3c869d5ee29fa528f55e1679a2a9d33bdf5243fa59`
13. Job ID: `7b03fad8-9111-49ec-b32f-601a12b3fc81`
14. Receipt ID: `rcpt_f06b7121f839ed3f77f961d2`
15. PSL ID: `lnk_f927e9a1b90807653fd49380`
16. Service execution count: **1**
17. Settlement count: **1**
18. Replay result: HTTP 200, identical link/receipt/PAYMENT-RESPONSE
19. Replay second execution: **no**
20. Replay second transaction: **no**
21. `upto` external proof required:
    **NOT_REQUIRED_ALREADY_PROVEN_BY_SHARED_IMPLEMENTATION**
22. Document max: n/a (not attempted, per §21)
23. Document actual: n/a
24. Document transaction: **none performed**
25. Cross-rail conflict result: §13a `expired` (real, time-dependent, strictly
    stronger than duplicate_conflict); §13b `duplicate_conflict` (pending case,
    literal)
26. Nevermined calls during conflict proof: **0**
27. Production transactions: **0**
28. Customer evidence increment: **0**
29. Revenue evidence increment: **0**
30. Load: PASS
31. Chaos: PASS
32. Schemathesis: PASS
33. Semgrep: PASS
34. OSV: PASS (0 critical)
35. Trivy: BLOCKED_EXTERNAL (3 HIGH, unchanged)
36. x402: PASS
37. Nevermined deterministic regression: PASS
38. Full `pnpm check`: PASS
39. External CDP transaction count: **1**
40. Remaining Nevermined blocker: **BLOCKED_EXTERNAL_PROVIDER**, unchanged,
    pending Nevermined support response (1O-B2A support packet)
41. Report: this file
42. Commit: pending this checkpoint's own commit (parent `e10dbb9`)
43. Clean tree: yes, confirmed via `pnpm check`/`secrets:scan`
44. Exact next action: no further Nevermined live attempt until Nevermined
    responds to the 1O-B2A support packet; remaining independent Phase-2 work
    (if any) may continue on the CDP rail only. Do not begin
    SUN-0800B/SUN-1100/SUN-1200.

STOP.
