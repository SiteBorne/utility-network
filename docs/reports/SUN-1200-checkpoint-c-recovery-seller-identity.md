# SUN-1200 Checkpoint C — Payment Recovery Convergence + Production Seller Identity

**Starting HEAD:** `274069a` **Classification:** capability complete, production
not activated — `SUN-1200` remains `BLOCKED_EXTERNAL — MARKET_DEMAND`

## Governing authority

User directive "SUN-1200 — CHECKPOINT C — PAYMENT RECOVERY CONVERGENCE +
PRODUCTION SELLER IDENTITY", refined by the user's own follow-up research and
final authorization of **Option 1 — retry-based CDP settlement convergence**
(scheme-aware, bounded, evidence-preserving). ADR 0055 continues to govern; no
gate it defines was loosened.

## What checkpoint B left open

1. A same-Payment-Identifier retry against a CDP `settlement_failed` payment
   returned `202 processing` forever — no reconciliation, no way to ever resolve
   it, stranding the Payment-Identifier.
2. `getAuthenticatedSellerAddress` remained unwired — the seller-identity
   architecture question was open.

## Official semantics reconciled (read from primary sources, not assumed)

`@x402/core`'s `FacilitatorClient` interface exposes exactly `verify` / `settle`
/ `getSupported` — **no read-only settlement-status endpoint exists at the
protocol level**. Coinbase's own SDK doc comment on `settle()` states a timeout
is "an indeterminate outcome: the facilitator may still have completed the
settlement." Both `exact` (EIP-3009) and `upto` (Permit2) EVM authorizations
enforce single-use nonces at the smart-contract level per the x402 spec — an
identical retry payload cannot itself produce a second successful on-chain
charge. Conclusion, confirmed and authorized by the user: **read chain evidence
if available → otherwise an identical, single-use settle retry → never execute
twice → remain explicitly ambiguous if payment still cannot be proven.**

## Root cause of the 202 (confirmed by direct inspection)

`attemptNeverminedRecovery()` was Nevermined-only by construction, and
`reconstructFromJob()` required `job.current_state === 'DELIVERED'` — never true
for a `settlement_failed` job (which moves to `REFUND_REQUIRED`). CDP fell
through both, landing on the generic `duplicate_same` → `202 processing` path
with no way out.

## Recovery classification: explicit rejection vs. ambiguous

The lifecycle edge `settlement_failed → settled_external` was already legal
(added for a real Nevermined false-rejection incident) and is reused directly
for CDP recovery — no lifecycle-stage schema change needed.

**Explicit rejection** (permanently terminal, never retried) requires a
facilitator that definitively answered. **Ambiguous** (recoverable) covers
everything else — a thrown/transport exception, or a structurally malformed
response.

**A real classification bug was found and fixed during this checkpoint.** The
first implementation reused Nevermined's own check —
`settlementEvidence.reason === 'provider_rejected'` — for the CDP branch too.
Direct `grep` confirmed that literal string is a Nevermined-provider-only
fallback default (`nevermined-provider.ts`'s
`safeReason(validation.reason, 'provider_rejected')`) and is **never** produced
by the real `CdpPaymentEvidenceProvider`, whose `reason` field instead carries
the facilitator's own `response.errorReason` (e.g. `insufficient_funds`) or one
of three internal structural-mismatch labels (`settlement_network_mismatch` /
`settlement_amount_mismatch` / `settlement_transaction_missing`). As written,
every real CDP rejection would have been misclassified `ambiguous`,
contradicting the frozen policy's required clean separation. Fixed with a
CDP-specific classifier (`isExplicitCdpSettlementFailure`, `x402-service.ts`),
shared identically by the first settle attempt and every recovery retry so the
two can never diverge:

- `trust_class === 'external_verified'` means the facilitator genuinely,
  definitively answered (either the normal `response.success` path, or the
  provider's catch-block `facilitatorAnswered` case — a structured HTTP error
  with a real `errorReason`). `'external_unverified'` means it did not answer at
  all (timeout/transport failure) — inherently ambiguous.
- Given `external_verified`, a `reason` that is **not** one of the three
  structural-mismatch labels is a genuine, explicit "no" from the facilitator →
  `explicit_rejection`. A structural-mismatch label means the shape of the
  answer didn't match expectations, not that the facilitator said no → stays
  `ambiguous`/recoverable, exactly like a malformed response on any other rail.

## Provider read-reconciliation contract

No read-only CDP settlement-status endpoint exists (confirmed above), so the
"non-mutating reconciliation operation" is: `cdpChainReceiptChecker` — an
optional, injected, read-only on-chain transaction-receipt checker
(`(txRef, network) => Promise<'SETTLED'|'FAILED'|'STILL_UNKNOWN'>`) on
`X402ServiceRouteConfig`/`PaidServicesConfig`, threaded through all twelve
`createX402ServiceRoute` call sites in `paid-services.ts`. **Not wired anywhere
in this repository's live request path** — deliberately left unwired, matching
the seller-identity hook's own established disclosed-unwired pattern. Its
absence changes nothing: `attemptCdpRecovery` skips straight to the bounded
settle-retry step, its exact prior behavior.

## Recovery dispatch (`attemptCdpRecovery`, `x402-service.ts`)

For a `duplicate_same` retry on a CDP `settlement_failed` payment attempt:

1. `explicit_rejection` → reconstruct the identical 402, **never** call the
   provider again.
2. `ambiguous` with both a candidate transaction reference and a wired
   `cdpChainReceiptChecker` → read-only chain check first, no facilitator write.
   `SETTLED` converges to success; `FAILED` converges to explicit rejection;
   `STILL_UNKNOWN` falls through to step 3.
3. Otherwise → **at most one** bounded, identical `.settle()` retry, reusing the
   current request's re-supplied `PaymentPayload` (already
   binding-hash-validated by `acquirePaymentAttempt` before recovery is ever
   reached) and the durable draft's `verification_evidence`/`actual_amount`
   (never re-verified, never re-executed, never recomputed). Success converges
   normally; an explicit rejection on retry becomes terminal; still-ambiguous
   persists (attempt count incremented, tx reference updated if present) and
   returns a new, honest `503 settlement_manual_reconciliation_required` — never
   a silent permanent `202`, never a false success, never a second automatic
   retry within one recovery invocation.

## Durable pre-settle write (CDP now crash-safe, like Nevermined)

CDP settlement previously shortcut directly `verified → settled`, skipping every
durable checkpoint. It now flows through the same
`verified → executed → settlement_pending → settled_external → link_verified → settled`
chain Nevermined already used. `CdpSettlementPendingDraft` (new type) is written
durably via `results.createPending()` **before** every CDP settle call —
previously CDP had no pre-settle durable write at all. It stores the full
`verification_evidence` object (needed because a recovery retry re-calls the
real provider's `.settle()`, whose internal hash computation must match the
original gate bit-for-bit) but deliberately **never** stores the signed
`PaymentPayload`/economic authorization in plaintext D1 — a recovery retry
reuses the buyer's own replay-resupplied, already hash-validated payload
instead.

Two real bugs were found and fixed while building this: a missing
`verified → executed` transition (CDP's row was never actually transitioned
before the new pre-settle write tried to CAS from that stage — a genuine 500,
traced via a scratch debug test then fixed by making the transition
unconditional across both rails) and a TS18047 null-narrowing error across a
nested closure (`finalizeCdpRecoverySuccess` now takes `draft` as an explicit
parameter instead of relying on outer-scope narrowing).

## Migration 0007

`ALTER TABLE payment_attempts ADD COLUMN settlement_outcome_kind TEXT` (`NULL` /
`'explicit_rejection'` / `'ambiguous'`), plus
`cdp_facilitator_settle_attempt_count` and
`cdp_successful_economic_settlement_count` (both `INTEGER NOT NULL DEFAULT 0`,
accounting only, never an authorization gate). Deliberately reuses the
already-rail-neutral columns migration 0006 added
(`settlement_transaction_reference`, `service_output_hash`,
`service_receipt_id`, `settlement_pending_at`) rather than duplicating them, and
does not touch or reinterpret any Nevermined-specific column
(`nevermined_delegation_id`, `settlement_permission_hash`). All columns
nullable/defaulted and additive — every historical row is unaffected. Verified
via `pnpm migrations:verify`.

## Seller identity — architecture decision confirmed, hook completed

Three options were on the table: (A) CDP-managed seller required, checked
against `SELLER_WALLET_ADDRESS`; (B) an arbitrary external EVM seller with no
CDP-side authentication; (C) ambiguous/deferred. Repository authority already,
unambiguously chose **(A)** back in checkpoints A/B:
`resolveProductionCdpEvidenceProvider` already fails closed to fixture mode
unless `getAuthenticatedSellerAddress` is supplied AND its result matches
`SELLER_WALLET_ADDRESS` (`assertSellerIdentityConsistent`) — there is no code
path anywhere in this repository that ever accepted a CDP-unauthenticated
external seller. (B) was never built and is not introduced now; this checkpoint
completes (A) rather than re-opening the question.

**`buildCdpSellerAddressLookup`** (new, `production-payment.ts`) is the real
(not stubbed) implementation: given an injected `CdpAccountLookupClient` factory
(the minimal read-only surface this repository needs from `@coinbase/cdp-sdk`'s
`CdpClient.evm.getAccount` — narrowed so tests never depend on the real SDK's
full client shape) and the configured `SELLER_WALLET_ADDRESS`, it resolves the
address the CDP API itself confirms for that account. Read-only — a wallet
lookup, never a transaction, never a signature. **Not wired into `index.ts`'s
live request path** — `index.ts` still supplies no
`getAuthenticatedSellerAddress` at all, so production evidence-provider
construction continues to fail closed to fixture mode regardless of every other
flag, exactly as before this checkpoint (confirmed by direct inspection: zero
call sites changed in `index.ts`).

## Tests

**`production-cdp-settlement-recovery.test.ts`** (9 new, real Miniflare D1, real
`CdpPaymentEvidenceProvider` + mock `HTTPFacilitatorClient`): exact Case B
(ambiguous transport failure → bounded retry succeeds, facilitator attempts=2,
successful settlements=1, verify=1); exact Case C (retry also ambiguous → `503`,
exactly one settle call per recovery invocation, never a tight loop, never
auto-marked settled); exact Case A (candidate tx reference + wired
`cdpChainReceiptChecker` → `SETTLED` converges with zero additional facilitator
settle calls); chain checker `FAILED` (converges to explicit terminal rejection,
never retries the facilitator); chain checker `STILL_UNKNOWN` (falls through to
the bounded retry, identical to no checker wired); explicit rejection is never
converted into ambiguous recovery; `upto` positive recovery (preserves
`authorized_maximum=190000` / `actual_amount=12000`); `upto` still-ambiguous
negative control; crash/restart proof (a genuinely fresh app instance —
`buildPaidServicesApp` called again, fresh Hono app, fresh repository instances,
fresh in-memory closures, only `db` shared — recovers identically, proving no
in-memory module dependency).

**`production-payment-gate.test.ts`** (5 new): `buildCdpSellerAddressLookup`
resolves via a mock client without ever constructing a real `CdpClient`;
propagates a mock lookup failure rather than swallowing it; end-to-end positive
construction through `resolveProductionCdpEvidenceProvider` with every gate true
and a matching mock CDP account; end-to-end negative control — a mock account
lookup resolving a **different** address fails closed to fixture mode;
end-to-end negative control — a mock lookup that throws fails closed to fixture
mode.

**`production-cdp-provider-wiring.test.ts`** (2 tests corrected, not regressed):
the "settlement rejected (explicit)" and "settlement ambiguous" tests previously
asserted the pre-fix `202 processing` behavior. Updated to assert the correct,
intended checkpoint C behavior — explicit rejection now reconstructs `402` with
zero additional provider calls; ambiguous now converges through one bounded
retry to `503 settlement_manual_reconciliation_required` with exactly one
additional settle call.

## Regression

`x402-service-route.test.ts` (30), `chaos-v2.test.ts` (13),
`paid-routes-mounting.test.ts`, `production-cdp-outer-router.test.ts`,
`production-payment-challenge.test.ts`, `production-cdp-provider-wiring.test.ts`
(6 files, 73 tests) — all pass unchanged, confirming zero external behavior
regression from the CDP happy-path restructuring (identical response
shapes/status codes on every previously-accepted path; only more durable
internal state). `pnpm --filter @siteborne/edge-api typecheck` clean throughout.

## Model D preservation

The Nevermined branch of `paymentRoute()` is untouched by this checkpoint —
`isExplicitProviderFailure`'s original Nevermined-only check
(`reason === 'provider_rejected'`) is byte-identical to before; every new CDP
classification/recovery function is reached only when `rail === 'cdp'`. Zero
Nevermined calls anywhere in this checkpoint's own work.

## Security

`pnpm check` (format, lint, typecheck across all workspace packages, full test
suite, contracts, governance/state/tasks validate, secrets:scan) and
`pnpm security:release` (Semgrep, OSV, Trivy 0C/0H, Schemathesis, Chaos, Load)
both green.

## External mutation accounting

Real CDP provider calls: 0. CDP transactions: 0. Production transactions: 0.
Nevermined calls: 0. Cloudflare login/authentication: 0 (confirmed still logged
out throughout). Deployments: 0. DNS mutations: 0.

## Remaining prerequisites before any production-enabling deploy

1. Real credential-provisioning checkpoint (mainnet-scoped CDP secrets,
   `PRODUCTION_CDP_CREDENTIALS_APPROVED=true` decision, real
   `SELLER_WALLET_ADDRESS`).
2. Wrangler re-authentication (still revoked, not restored this checkpoint).
3. Wire the real `getAuthenticatedSellerAddress`/`buildCdpSellerAddressLookup`
   and (optionally) `cdpChainReceiptChecker` into `index.ts`'s live app config —
   both now exist as real, tested implementations; neither is connected to the
   live request path yet.
4. A specific, bounded, human-authorized bootstrap action (ADR 0055) setting
   `HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP=true` for that one action only.
5. A real Cloudflare deploy.

## Final state

```
PRODUCTION_CDP_CODE_PATH                true
PRODUCTION_CDP_PROVIDER_WIRING          true
PRODUCTION_SETTLEMENT_RECOVERY_READY    true
PRODUCTION_SELLER_IDENTITY_READY        true
PRODUCTION_CDP_CREDENTIALS_PROVISIONED  false
PRODUCTION_CDP_CREDENTIALS_APPROVED     false
production_ready                        false
production_enabled                      false
EXECUTABLE_VERIFIED                     false
SUN-1200                                BLOCKED_EXTERNAL — MARKET_DEMAND
```
