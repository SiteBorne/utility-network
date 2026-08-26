# SUN-1220J — local one-shot paid-E2E client (implementation + tests only)

Scope: implementation, tests, local mock execution, and this report only.
**No live signing, no live 402 request, no payment material, no paid
request, no settlement, no deployment, no traffic shift, and no Cloudflare
mutation occurred in this checkpoint.**

## 1. SUN-1220I evidence freeze

```
SUN1220I_PAID_E2E_CHALLENGE_PREFLIGHT = PASS
FRESH_BUYER_USDC_ATOMIC               = 47197
FRESH_BUYER_USDC                      = 0.047197
BUYER_SUFFICIENTLY_FUNDED             = YES
CHALLENGE_NETWORK                     = eip155:8453
CHALLENGE_AMOUNT_ATOMIC               = 19000
CHALLENGE_PAYTO                       = 0x7f44a2dd237938F18632d4CcA40f4c690295E6E1
PAYMENT_SIGNATURES_CREATED            = 0
SETTLEMENTS                           = 0
REAL_ECONOMIC_EFFECTS                 = 0
```

`SUN1220I_EVIDENCE_COMMIT_SHA = 12ecbbd3a70d832c75300c8d4d78bf6589a57741`

## 2. Local tool

Two new files, following the exact SUN-1220F/G local-only precedent:

- `apps/edge-api/tests/live/first-paid-e2e-local.test.ts` — the entire
  implementation (state machine, hard validation, exposure cap, official
  library wiring) plus a 27-test always-run unit suite and one
  `describe.skipIf(!process.env.RUN_LOCAL_FIRST_PAID_E2E)`-gated live test.
- `scripts/first-paid-e2e.ts` — thin CLI wrapper (`pnpm first-paid-e2e`)
  that checks *presence only* of `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` /
  `CDP_WALLET_SECRET` and shells to `vitest run` with
  `RUN_LOCAL_FIRST_PAID_E2E=1` — never reads/logs a credential value.

Both live entirely under `apps/edge-api/tests/` / `scripts/`, never under
`apps/edge-api/src/`. `wrangler.toml`'s `main = "apps/edge-api/src/index.ts"`
never reaches either file.

## 3. Official libraries only

| Step | Official function used |
|---|---|
| Decode 402 | `decodePaymentRequiredHeaderSafe` (`@siteborne/protocol-x402`, wraps `@x402/core`'s Zod parser) |
| Resolve buyer | `cdpClient.evm.getAccount({ address })` (`@coinbase/cdp-sdk`) |
| Adapt signer | `fromCdpEvmAccount` (`@coinbase/cdp-sdk/x402`) |
| Build + sign payment | `new ExactEvmScheme(signer).createPaymentPayload(...)` (`@x402/evm`) |
| Encode PAYMENT-SIGNATURE | `encodePaymentSignatureHeaderSafe` (`@siteborne/protocol-x402`) |
| Decode PAYMENT-RESPONSE | `decodePaymentResponseHeaderSafe` (`@siteborne/protocol-x402`) |
| Buyer payment identifier | `buildBuyerPaymentIdentifierExtensions` / `generateSiteborneePaymentId` (`@siteborne/protocol-x402`, wraps `@x402/extensions/payment-identifier`) |

No hand-written EIP-712 domain/types/signing logic exists anywhere in this
tool. Pinned versions confirmed installed: `@coinbase/cdp-sdk@1.55.0`,
`@x402/core@^2.21.0`, `@x402/evm@^2.21.0`.

## 4. CRITICAL FINDING — the live candidate will fail closed today

Read directly from the installed `@x402/evm@2.21.0` source
(`node_modules/@x402/evm/dist/cjs/index.js`, `signEIP3009Authorization`):

```js
if (!requirements.extra?.name || !requirements.extra?.version) {
  throw new Error(
    `EIP-712 domain parameters (name, version) are required in payment requirements for asset ${requirements.asset}`
  );
}
```

SITEBORNE's own `verify_agent_output.v2` route registration never sets
`X402ServiceRouteConfig.paymentRequirementExtra` (confirmed: no call site
in `apps/edge-api/src` sets it — `buildExactPaymentRequirement` puts
`extra: { ...(input.extra ?? {}), quote_id }`, and `input.extra` is
`undefined` for this route). The real, live candidate's 402 challenge
therefore has `accepts[0].extra = { quote_id }` only — **missing the
`name`/`version` EIP-712 domain fields `@x402/evm` requires** — and
`ExactEvmScheme.createPaymentPayload` would throw before ever calling
`signTypedData`, exactly analogous in shape to SUN-1220E's
`MISSING_CDP_WALLET_SECRET` finding, but this time on the **seller/requirement
side**, not the buyer/credential side.

This tool hard-validates `extra.name === "USD Coin"` and
`extra.version === "2"` (the well-known, canonical Base-mainnet USDC EIP-712
domain) as part of its §4 exact-equality gate, and fails closed at
`CHALLENGE_VALIDATED` with a clear reason — turning what would otherwise be
an unhandled exception mid-signing into a controlled, correctly-classified
stop. A unit test (`the current live candidate is expected to fail closed
at CHALLENGE_VALIDATED`) reproduces this exact real-world shape without any
network call and proves the gate fires.

**Per SUN-1220J §17 ("Do NOT modify ... production composition unless an
implementation blocker proves necessary. If permanent Worker changes appear
necessary: STOP and reclassify."), this is exactly such a case.** Fixing it
requires adding `paymentRequirementExtra: { name: 'USD Coin', version: '2' }`
to the `verify_agent_output.v2` route registration in
`apps/edge-api/src/control-plane/routes/paid-services.ts` (not inspected/
modified this checkpoint) — a small, Worker-side, production-composition
change that must be its own separately authorized checkpoint before any
live run of this tool can reach `PAYMENT_MATERIAL_CREATED`.

## 5. Hard validation (§4/§5)

Exact-equality only, no tolerance, checked in this order before any signing
call: `network`, `asset`, `amount` (`19000` atomic, exactly), `payTo`,
`extra.name`/`extra.version`. Then the fixed USD exposure check:
`0.019 + 0 (no payer-borne gas) = 0.019 <= 0.25`. Any failure exits before
`cdp.evm.getAccount` is ever called.

## 6. Exactly-once state machine and call budget

States: `PRE_CHALLENGE → CHALLENGE_RECEIVED → CHALLENGE_VALIDATED →
PAYMENT_MATERIAL_CREATED → PAID_REQUEST_SUBMITTED → RESULT_OBSERVED`. Every
counter (`unpaid402Requests`, `cdpGetAccountCalls`,
`paymentSignTypedDataCalls`, `paymentPayloadsCreated`,
`paymentSignatureHeadersCreated`, `paidRequestSubmissions`) is asserted `<=
1` by the test suite; no retry loop exists anywhere in the module. A
network failure, a 5xx, or an unexpected status after submission all
classify as `ambiguous` (or `rejected` for a post-signing 402) and stop —
never a second submission.

## 7. Sanitized output only

`FirstPaidE2ESanitizedResult` carries only: `ok`, `stage`, `failure_reason`,
the four boolean milestones, `submission_result`, `http_status`,
`service_execution_observed`, `settlement_observed`, `transaction_hash`,
`receipt_id`. Tests R/S/T assert the exact key set and assert the
serialized result never matches `/signature/i` or `/authorization/i`, and
never contains a 65-byte signature hex string.

## 8. Replay / idempotency (§15) — read from the real server implementation

Read directly from `apps/edge-api/src/control-plane/routes/x402-service.ts`:

```
SAME_PAYMENT_PAYLOAD_REPLAY_BEHAVIOR   = Idempotent per deterministic
  payment_identifier (parsePaymentIdentifier / acquirePaymentAttempt): the
  same payload replayed against the SAME binding reconstructs the already-
  cached response (reconstructFromJob) rather than re-verifying/re-settling.
  A DIFFERENT binding reusing the same identifier is duplicate_conflict
  (rejected, never silently accepted).
SERVICE_REQUEST_IDEMPOTENCY_BEHAVIOR   = Idempotent per payment_identifier;
  the D1-cached response (status/body/PAYMENT-RESPONSE) is replayed
  byte-for-byte; the service executor never re-runs for an already-consumed
  payment.
SETTLEMENT_IDEMPOTENCY_BEHAVIOR        = EIP-3009 transferWithAuthorization
  is single-use at the smart-contract level (nonce), so a resubmitted
  identical signature cannot settle twice on-chain even if replayed.
  Server-side, attemptCdpRecovery permits at most one additional bounded
  settle() retry, and only for a payment attempt durably recorded as
  settlement_failed/ambiguous — never a second attempt from a fresh request.
```

This tool submits its one authorized paid request exactly once and never
tests replay live, per §15's explicit instruction.

## 9. Response / settlement evidence sources (§16)

- HTTP status of the paid response.
- Response JSON body: `result_class`, `receipt_id`, `link_id`/`link_hash`.
- `PAYMENT-RESPONSE` header, decoded via `decodePaymentResponseHeaderSafe`:
  `success`, `transaction` (on-chain tx hash), `network`, `amount`.
- `wrangler tail --format json` (established attribution channel from
  SUN-1220D/G/I) for `scriptVersion.id` / `outcome` / `cpuTime` / `wallTime`
  / exceptions — not wired into this tool itself, available as a
  complementary live-run evidence channel.
- D1 `x402_service_results` / `payment_attempts` rows exist server-side but
  this local tool has no D1 access wired — not required for a single
  request/response evidence packet, and adding it was judged unnecessary
  new instrumentation per §16's "do not add new production instrumentation
  unless required."

## 10. File scope

No Worker routing, `wrangler.toml`, paid-route activation gate, or
production composition file was modified. The one blocker identified in
§4 above is a production-composition change and is explicitly deferred to
a separate checkpoint, not implemented here.

## 11. Regression

```
pnpm lint               -> PASS (16/16 packages)
pnpm typecheck           -> PASS (23/23 packages)
pnpm test                -> PASS (2205 passed, 37 skipped, 0 failed; +27 new
                             unit tests, +1 new gated live test vs. pre-
                             checkpoint baseline)
pnpm test:worker-runtime -> PASS (88/88 scenarios)
pnpm production:preflight -> PASS
pnpm secrets:scan        -> PASS (no leaks, git history + working tree)
```

`LIVE_PAYMENT_TEST_SKIPPED_BY_DEFAULT = YES` (confirmed: the gated
`describe` block showed `1 skipped` with no `RUN_LOCAL_FIRST_PAID_E2E` env
var set).
`LIVE_PAYMENT_NETWORK_CALLS_DURING_TESTS = 0` (every always-run test uses
an injected `fetchImpl`/`cdpClient` mock or the real official library
against a deterministic TEST-ONLY private key — never the network, never
the real controlled buyer's credential).

## 12. Production containment

```
wrangler deployments status -> f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce @ 100% (unchanged)
wrangler deploy --dry-run   -> bundle contains NO trace of "first-paid-e2e",
                                "SUN-1220J", or "runFirstPaidE2E"
```

## 13. Commit

`SUN1220J_IMPLEMENTATION_COMMIT_SHA = eb6b38b72d152c1c8534b7a7b56fa03c146ce72e`
(local tool, tests, CLI wrapper, package alias, this report).
