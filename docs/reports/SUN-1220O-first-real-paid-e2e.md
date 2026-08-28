# SUN-1220O — First Real Paid E2E (Attempt Log)

## Attempt 1 — CLOSED_PRE_ECONOMIC

Invoked by the human operator via `pnpm first-paid-e2e` under a fresh,
standalone, explicit authorization for exactly one real paid transaction
against candidate `a0055146-d358-40d4-b0af-52eccc56c8ef`.

```json
{"ok":false,"stage":"PRE_CHALLENGE","failure_reason":"expected HTTP 402, got 404","challenge_received":false,"challenge_validated":false,"payment_material_created":false,"paid_request_submitted":false,"http_status":404}
```

```
SUN1220O_ATTEMPT_1                    = CLOSED_PRE_ECONOMIC
ATTEMPT_1_STAGE                       = PRE_CHALLENGE
ATTEMPT_1_HTTP_STATUS                 = 404
ATTEMPT_1_CHALLENGE_RECEIVED          = NO
ATTEMPT_1_PAYMENT_MATERIAL_CREATED    = NO
ATTEMPT_1_PAID_REQUEST_SUBMITTED      = NO
ATTEMPT_1_SETTLEMENT                  = NO
ATTEMPT_1_REAL_ECONOMIC_EFFECT        = 0
ATTEMPT_1_AUTHORIZATION_CONSUMED      = YES
ATTEMPT_1_RETRY_AUTHORIZED            = NO
```

The vitest suite in `first-paid-e2e-local.test.ts` reported 28/28 tests
passed for the always-run unit matrix; the live `describe.skipIf` block ran
once, produced the JSON line above, and exited. No retry occurred.

## Root cause — corrected from the SUN-1220O1 checkpoint's stated premise

The checkpoint prompt that opened SUN-1220O1 asserted the root cause as:

> "The committed SUN-1220J local one-shot client sends its challenge and
> paid submission to the ordinary production URL **without** the
> established Cloudflare candidate-version override."

Independent source inspection (`apps/edge-api/tests/live/first-paid-e2e-local.test.ts`,
committed at `09d41ef`, unchanged since) shows this premise is **false**:
the `Cloudflare-Workers-Version-Overrides` header was already attached to
both the unpaid-challenge request (then line 344) and the paid-submission
request (then line 453), via a module constant `VERSION_OVERRIDE_HEADER_VALUE`.

The actual defect is narrower — a **value-format mismatch**, not a missing
header:

```
# what SUN-1220J sent (pre-fix):
Cloudflare-Workers-Version-Overrides: siteborne-utility-edge=a0055146-d358-40d4-b0af-52eccc56c8ef

# the proven-working format (SUN-1210/1211/1219C/1220N, grepped from every
# report file in docs/reports/ that exercises this header — 8/8 occurrences,
# 0 exceptions):
Cloudflare-Workers-Version-Overrides: siteborne-utility-edge="a0055146-d358-40d4-b0af-52eccc56c8ef"
```

The pre-fix value omitted the double quotes around the version-id token.
Cloudflare's version-override header is parsed as a Structured Field Value
dictionary (RFC 8941): an unquoted value is not a valid `sf-string` member
and is dropped by the parser, so the request fell through to ordinary
100%-traffic routing — landing on known-good production
(`f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce`), which correctly returns 404 for
`/v2/verify/agent-output` because paid routes are disabled there. This is
consistent with, and fully explains, the observed `expected HTTP 402, got 404`
without needing to invoke a "header entirely absent" theory.

```
CHECKPOINT_STATED_ROOT_CAUSE_VERIFIED = NO (header was present, not absent)
ACTUAL_ROOT_CAUSE_VERIFIED            = YES (unquoted structured-field value)
```

## Proven override mechanism (§2)

```
VERSION_OVERRIDE_HEADER_NAME        = Cloudflare-Workers-Version-Overrides
VERSION_OVERRIDE_HEADER_VALUE_SHAPE = <script-name>="<version-id>"
VERSION_OVERRIDE_CONSTRUCTION_HELPER = none (no shared TS helper exists anywhere
                                        in the repo; every prior proof — SUN-1210
                                        P/P2/P3/P4, SUN-1211 Q, SUN-1219C,
                                        SUN-1220N — constructed this header value
                                        as a literal curl -H string)
```

Source: `grep -h "Version-Overrides" docs/reports/*.md` — 8 occurrences
across 6 independent checkpoints, 8/8 quoted, 0/8 unquoted.

## Attempt 2 — CLOSED_PRE_ECONOMIC

Run after the SUN-1220O1 quoting fix (commit `1c031aa`) with fresh, standalone
authorization. Result:

```json
{"ok":false,"stage":"PRE_CHALLENGE","failure_reason":"expected HTTP 402, got 404","challenge_received":false,"challenge_validated":false,"payment_material_created":false,"paid_request_submitted":false,"http_status":404}
```

Identical failure mode to Attempt 1, but the quoting fix was confirmed
correct by direct `curl` reproduction of both header shapes. Read-only
diagnosis via `wrangler deployments status` found the true cause: the
active deployment contained **only** `f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce`
at 100% traffic. The candidate `a0055146-d358-40d4-b0af-52eccc56c8ef` had
been uploaded (`wrangler versions upload`, SUN-1220M) but was never part of
an active deployment after SUN-1220N's mandatory restoration removed it.
The `Cloudflare-Workers-Version-Overrides` mechanism can only route to a
version that is part of the current active deployment (even at 0% traffic)
— an uploaded-but-undeployed version is not reachable by any header value.

```
SUN1220O_ATTEMPT_2                    = CLOSED_PRE_ECONOMIC
ATTEMPT_2_STAGE                       = PRE_CHALLENGE
ATTEMPT_2_HTTP_STATUS                 = 404
ATTEMPT_2_REAL_ECONOMIC_EFFECT        = 0
ATTEMPT_2_AUTHORIZATION_CONSUMED      = YES
ATTEMPT_2_RETRY_AUTHORIZED            = NO
TRUE_ROOT_CAUSE                       = candidate not part of active deployment
```

## Temporary candidate inclusion (SUN-1220O2)

Under explicit, standalone human authorization, the candidate was included
in the active deployment at 0% traffic alongside known-good at 100%:

```
wrangler versions deploy f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce@100 a0055146-d358-40d4-b0af-52eccc56c8ef@0
```

Read-back confirmed exactly these two versions, no others, candidate at 0%.
Pre-payment controls both passed: ordinary routing (no override) → known-good
served; version-override → candidate served (`scriptVersion.id` matched,
HTTP 200 on `/health`).

## Attempt 3 — SUCCESS (first real paid E2E)

Run under a third fresh, standalone authorization (payment authorization and
temporary-deployment authorization each supplied as separate human messages,
per SUN-1220O3's hard precondition gate), against the now-reachable
candidate:

```json
{"ok":true,"stage":"RESULT_OBSERVED","challenge_received":true,"challenge_validated":true,"payment_material_created":true,"paid_request_submitted":true,"submission_result":"success","http_status":200,"service_execution_observed":true,"settlement_observed":true,"transaction_hash":"0x612efe6f63cfbec1939241cc5fe6e9797ac4f1e94c248a644501e7bb2eaec5a2","receipt_id":"rcpt_e7f0e8820f46a99a7d82cea2"}
```

29/29 tests passed (28 always-run unit assertions + 1 live attempt). No raw
payment signature, PaymentPayload, or PAYMENT-SIGNATURE header value ever
appeared in the client's output (assertions R/S/T in the same suite enforce
this structurally).

### Independent on-chain verification (read-only, BaseScan)

The transaction hash returned by the client was independently looked up on
a public block explorer — not merely trusted from the client's own claim:

```
BASESCAN_TX_STATUS       = Success
BASESCAN_BLOCK           = 50582273 (confirmed)
BASESCAN_TIMESTAMP       = 2026-08-28T21:51:33Z
BASESCAN_TOKEN_TRANSFER  = 0.019 USDC
BASESCAN_FROM (buyer)    = 0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99  (matches authorized buyer)
BASESCAN_TO (seller)     = 0x7f44a2dd237938F18632d4CcA40f4c690295E6E1  (matches authorized payTo)
BASESCAN_TOKEN_CONTRACT  = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913  (matches authorized USDC asset)
BASESCAN_NATIVE_VALUE    = 0 ETH (pure ERC-20 transfer, no direct ETH movement by buyer)
BASESCAN_GAS_PAYER       = 0xa32cCda98ba7529705a059Bd2d213Da8de10d101 (facilitator relayer, not buyer)
BASESCAN_GAS_FEE         = 0.00000064688779407 ETH (~$0.0016, borne by facilitator, not buyer)
```

This independently confirms the EIP-3009 meta-transaction pattern: the buyer
signed off-chain only (no ETH gas required from the buyer), and the
facilitator submitted and paid gas on-chain. Buyer's total exposure was
exactly 0.019 USDC — the authorized maximum — with zero network fee borne by
the payer, matching `EXPECTED_PAYER_BORNE_NETWORK_FEE_USD=0` from the frozen
economic invariant.

```
ATTEMPT_3_REAL_ECONOMIC_EFFECT_USDC   = 0.019 (matches maximum authorized exactly)
ATTEMPT_3_TOTAL_PAYER_EXPOSURE_USD    = 0.019 (well within $0.25 ceiling)
ATTEMPT_3_AUTHORIZATION_CONSUMED      = YES
ATTEMPT_3_RETRY_AUTHORIZED            = NO (none requested; not needed)
```

### Mandatory restoration

Executed immediately after the result was observed, before any extended
investigation:

```
wrangler versions deploy f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce@100
```

Authoritative read-back (`wrangler deployments status`):

```
FINAL_PRODUCTION_VERSION  = f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
FINAL_PRODUCTION_TRAFFIC  = 100%
OTHER_VERSIONS_ACTIVE     = 0 (candidate fully removed from active deployment)
```

Post-restoration containment re-verified:

```
production:preflight  = PASS (12/12 paid routes structurally unavailable; 6/6 secrets present)
secrets:scan           = PASS (gitleaks: 0 leaks across 228 commits, both scan passes)
```

## Summary

```
SUN1220O_FINAL_OUTCOME              = SUCCESS
ATTEMPTS_TOTAL                      = 3
ATTEMPTS_CLOSED_PRE_ECONOMIC        = 2 (Attempt 1, Attempt 2)
ATTEMPTS_SUCCEEDED                  = 1 (Attempt 3)
REAL_ECONOMIC_EFFECTS               = 1 (0.019 USDC, buyer → seller, Base mainnet, on-chain verified)
SETTLEMENTS                         = 1
TRANSACTIONS                        = 1
LIVE_SIGN_TYPED_DATA_CALLS          = 1
EIP3009_AUTHORIZATIONS_CREATED      = 1
PAYMENT_SIGNATURES_CREATED          = 1
LIVE_PAID_REQUESTS                  = 1
PUBLIC_PAID_CANARY_ELIGIBLE         = pending separate authorization (not evaluated here)
FINAL_PRODUCTION_VERSION            = f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
FINAL_PRODUCTION_TRAFFIC            = 100%
CANDIDATE_IN_ACTIVE_DEPLOYMENT      = NO
```
