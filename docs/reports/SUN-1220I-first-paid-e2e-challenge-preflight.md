# SUN-1220I — First Paid E2E Fresh Challenge Preflight

Read-only economic qualification. 0% normal traffic on the paid candidate at
all times. No payment signature was created. No settlement occurred.

## 0. Authoritative starting state

| Field | Value |
|---|---|
| Controlled buyer | `0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99` |
| Service | `verify_agent_output.v2` |
| Service price | `0.019` USD |
| Network | `eip155:8453` (Base mainnet) |
| Asset | USDC — `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Expected seller payTo | `0x7f44a2dd237938F18632d4CcA40f4c690295E6E1` |
| Max total payer exposure | `0.25` USD |
| Qualified unpaid-mainnet candidate | `9a18898a-f08b-4543-8e00-8bccf2dfc52a` (SUN-1219C) |
| Known-good production | `f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce @ 100%` |

## 1. Fresh buyer balance

Read-only `balanceOf`/`getBalance` call against Base mainnet public RPC
(same method used in SUN-1220H), executed fresh for this checkpoint:

```
FRESH_BUYER_USDC_ATOMIC = 47197
FRESH_BUYER_USDC        = 0.047197
FRESH_BUYER_NATIVE_WEI  = 10000000000000
FRESH_BUYER_NATIVE_ETH  = 0.00001
```

`0.047197 >= 0.019` → **BUYER_SUFFICIENTLY_FUNDED = YES**. No transfer was
made or requested by this checkpoint. (Note: this is higher than the
`0.025` target discussed previously — the buyer holds more than the
minimum needed; this does not change anything below, since the hard
validation is `>= 0.019`, not an exact-match check.)

## 2. Paid candidate reconciliation

`wrangler versions view 9a18898a-f08b-4543-8e00-8bccf2dfc52a` (read-only):

```
Message: SUN-1219C mainnet unpaid-402 qualification candidate
Compatibility Date:   2026-08-05
Compatibility Flags:  nodejs_compat

[vars]
PAID_ROUTES_ENABLED               = "true"
VERIFY_V2_CDP_ROUTE_ENABLED       = "true"
PAYMENT_ENVIRONMENT               = "production"
PRODUCTION_ENABLED                = "true"
HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP = "true"
PRODUCTION_CDP_CREDENTIALS_APPROVED   = "true"
SELLER_WALLET_ADDRESS             = "0x7f44a2dd237938F18632d4CcA40f4c690295E6E1"

Secrets: AGENT_CARD_SIGNING_PRIVATE_KEY, CDP_API_KEY_ID, CDP_API_KEY_SECRET,
         NVM_API_KEY, PAID_RECEIPT_SIGNING_KEY_ID,
         PAID_RECEIPT_SIGNING_PRIVATE_KEY  (6 names, no CDP_WALLET_SECRET)
```

Configuration matches the SUN-1219C qualified mainnet configuration
exactly, including `SELLER_WALLET_ADDRESS` matching
`EXPECTED_SELLER_PAYTO`. This is an immutable Worker version — its bundle
content cannot have drifted since SUN-1219C's own containment proof.
No identity/configuration drift detected. No replacement uploaded.

## 3. Current production containment (pre-deployment)

- `wrangler deployments status`: `f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce @ 100%` only.
- `GET /health` → `200`.
- 12/12 paid REST routes (POST, `Content-Type: application/json`) → `404`.
- `pnpm production:preflight` → `PASS`.

## 4. Temporary 100/0 deployment

```
wrangler versions deploy \
  f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce@100 \
  9a18898a-f08b-4543-8e00-8bccf2dfc52a@0 \
  --message "SUN-1220I: temporary known-good 100% / paid unpaid-402 candidate 0% for fresh challenge preflight"
```

Authoritative read-back (`wrangler deployments status`):

```
(100%) f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
(0%)   9a18898a-f08b-4543-8e00-8bccf2dfc52a
```

`PAID_E2E_ZERO_TRAFFIC_DEPLOYMENT = PASS`. `CANDIDATE_NORMAL_TRAFFIC_PERCENT = 0`.

## 5. Ordinary routing proof

Via `wrangler tail --format json`, attributed by `cf-ray`:

| Request | Ray | scriptVersion.id | outcome | status |
|---|---|---|---|---|
| `GET /health` | `a313236eb8bced88` | `f4f20676-…` | ok | 200 |
| `GET /ready` | `a313236f3ae36d11` | `f4f20676-…` | ok | 200 |

`ORDINARY_ROUTING = KNOWN_GOOD`.

## 6. Candidate attribution

One `GET /health` with
`Cloudflare-Workers-Version-Overrides: siteborne-utility-edge="9a18898a-…"`:

| Ray | scriptVersion.id | outcome | status |
|---|---|---|---|
| `a31323a37d5a6744` | `9a18898a-f08b-4543-8e00-8bccf2dfc52a` | ok | 200 |

`PAID_CANDIDATE_ATTRIBUTION = PASS`.

## 7. Exactly one fresh unpaid 402 request

One candidate-targeted `POST /v2/verify/agent-output`, same version-override
header, canonical valid test body (matching the fixture already used
elsewhere in this repo's own load test, `apps/edge-api/tests/load-v2.test.ts`):

```json
{
  "verification_contract": {
    "claims": [{"claim_id": "total", "predicate": "equals", "expected_value": 42}],
    "deterministic_requirements": []
  },
  "candidate_output": {"total": 42},
  "required_schema": {},
  "verification_mode": "standard"
}
```

No `PAYMENT-SIGNATURE` header was sent. Response: `HTTP 402`.
Tail attribution for this exact request:

```
ray: a313260a09b51355
scriptVersion.id: 9a18898a-f08b-4543-8e00-8bccf2dfc52a
outcome: ok, status: 402, exceptions: []
```

`UNPAID_402_REQUESTS = 1`. No retry was made.

## 8. Decoded PAYMENT-REQUIRED

Decoded using the repository's canonical
`decodePaymentRequiredHeaderSafe` (`packages/protocol-x402/src/codec/headers.ts`),
invoked through `vitest run` (the only proven-working module-resolution
path for `@siteborne/protocol-x402` in this repo, per the existing
`nevermined-recover.ts` precedent — a bare `tsx` invocation fails on a
transitive `@siteborne/pricing` re-export). The header value itself is
public challenge material, not a secret.

```
CHALLENGE_NETWORK             = eip155:8453
CHALLENGE_ASSET                = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
CHALLENGE_AMOUNT_ATOMIC         = 19000
CHALLENGE_AMOUNT_USDC           = 0.019
CHALLENGE_PAYTO                 = 0x7f44a2dd237938F18632d4CcA40f4c690295E6E1
CHALLENGE_SCHEME                = exact
CHALLENGE_MAX_TIMEOUT_SECONDS    = 60
x402Version                     = 2
quote_id (extra)                 = qte_221238b196a8eb7a45e16f2c
resource.url                     = https://siteborne-utility-edge.siteborneutilitynetwork.workers.dev/v2/verify/agent-output
```

The one-off decode script was a temporary, uncommitted test file, deleted
immediately after use; `git status --short` confirmed a clean tree
afterward.

## 9. Hard validation

| Field | Expected | Observed | Match |
|---|---|---|---|
| Network | `eip155:8453` | `eip155:8453` | ✅ |
| Asset | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | same | ✅ |
| Amount (atomic) | `19000` | `19000` | ✅ |
| Amount (USDC) | `0.019` | `0.019` | ✅ |
| PayTo | `0x7f44a2dd237938F18632d4CcA40f4c690295E6E1` | same | ✅ |

`FRESH_PAYMENT_CHALLENGE_VALIDATION = PASS`.

## 10. Exposure cap

Pinned flow re-confirmed from committed source
(`apps/edge-api/src/control-plane/production/verify-agent-output-v2-cdp-composition.ts`):
the buyer only ever produces an off-chain EIP-3009 `signTypedData`
authorization; the CDP facilitator (SITEBORNE's own credentials) calls
`.verify()`/`.settle()` and broadcasts the on-chain transaction itself.
The buyer never broadcasts and bears no network fee — consistent with the
buyer's negligible native balance (`0.00001 ETH`).

```
EXPECTED_TOTAL_PAYER_EXPOSURE_USD = 0.019
MAX_TOTAL_PAYER_EXPOSURE_USD      = 0.25
ECONOMIC_CAP_GATE                 = PASS
```

The `0.25` figure is a ceiling, not authorization to spend up to it.

## 11. No payment authorization created

```
PAYMENT_SIGN_TYPED_DATA_CALLS   = 0
EIP3009_AUTHORIZATIONS_CREATED  = 0
PAYMENT_SIGNATURES_CREATED      = 0
PAYMENT_SIGNATURE_HEADERS_CREATED = 0
VALID_PAYMENT_MATERIAL_CREATED  = 0
LIVE_PAID_REQUESTS_WITH_PAYMENT = 0
SETTLEMENTS = 0
TRANSACTIONS = 0
REAL_ECONOMIC_EFFECTS = 0
```

## 12. Challenge freshness caveat

```
CURRENT_402_USED_FOR_ECONOMIC_VALIDATION_ONLY = YES
FRESH_402_REQUIRED_AT_PAYMENT_SIGNING_TIME    = YES
```

The `quote_id`/`requirement_id`/`maxTimeoutSeconds` above are recorded for
audit only. The next (payment-signing) checkpoint must obtain a brand new
`402` immediately before signing rather than reuse this one.

## 13. Mandatory restoration

```
wrangler versions deploy f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce@100 \
  --message "SUN-1220I: mandatory restoration to known-good only after fresh unpaid-402 challenge preflight"
```

Authoritative read-back: `(100%) f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce` only,
candidate removed from active deployment. `SUN1220I_RESTORATION = PASS`.

## 14. Final containment

- `GET /health` → `200`.
- `GET /diagnostics/cdp-buyer-signer-capability` → `404`.
- 12/12 paid REST routes → `404`.
- `pnpm production:preflight` → `PASS`.

## 16. Mutation accounting

```
WORKER_VERSIONS_CREATED = 0
DEPLOYMENTS = 2            (temporary 100/0 + restoration)
TRAFFIC_SHIFTS = 2
UNPAID_402_REQUESTS = 1
PAYMENT_SIGN_TYPED_DATA_CALLS = 0
EIP3009_AUTHORIZATIONS_CREATED = 0
PAYMENT_SIGNATURES_CREATED = 0
BUYER_FUNDING_ACTIONS = 0
LIVE_PAID_REQUESTS_WITH_PAYMENT = 0
SERVICE_EXECUTIONS = 0
SETTLEMENTS = 0
TRANSACTIONS = 0
REAL_ECONOMIC_EFFECTS = 0
```

## 17. Final stop packet

```
SUN1220I_PAID_E2E_CHALLENGE_PREFLIGHT = PASS
BUYER = 0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99
FRESH_BUYER_USDC_ATOMIC = 47197
FRESH_BUYER_USDC = 0.047197
BUYER_SUFFICIENTLY_FUNDED = YES
PAID_CANDIDATE = 9a18898a-f08b-4543-8e00-8bccf2dfc52a
PAID_CANDIDATE_ATTRIBUTION = PASS
UNPAID_402_REQUESTS = 1
CHALLENGE_NETWORK = eip155:8453
CHALLENGE_ASSET = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
CHALLENGE_AMOUNT_ATOMIC = 19000
CHALLENGE_AMOUNT_USDC = 0.019
CHALLENGE_PAYTO = 0x7f44a2dd237938F18632d4CcA40f4c690295E6E1
FRESH_PAYMENT_CHALLENGE_VALIDATION = PASS
EXPECTED_TOTAL_PAYER_EXPOSURE_USD = 0.019
MAX_TOTAL_PAYER_EXPOSURE_USD = 0.25
ECONOMIC_CAP_GATE = PASS
CURRENT_402_USED_FOR_ECONOMIC_VALIDATION_ONLY = YES
FRESH_402_REQUIRED_AT_PAYMENT_SIGNING_TIME = YES
PAYMENT_SIGN_TYPED_DATA_CALLS = 0
EIP3009_AUTHORIZATIONS_CREATED = 0
PAYMENT_SIGNATURES_CREATED = 0
LIVE_PAID_REQUESTS_WITH_PAYMENT = 0
SETTLEMENTS = 0
TRANSACTIONS = 0
REAL_ECONOMIC_EFFECTS = 0
SUN1220I_RESTORATION = PASS
FINAL_PRODUCTION_VERSION = f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
FINAL_PRODUCTION_TRAFFIC = 100%
FIRST_REAL_PAID_E2E_SIGNING_ELIGIBLE = YES
```

STOP. No payment was signed. No EIP-3009 authorization was created. No
`PAYMENT-SIGNATURE` was sent. No settlement occurred.
