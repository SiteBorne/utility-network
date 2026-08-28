# SUN-1220N — Live domain-metadata 402 qualification (temporary split, exactly one unpaid request, mandatory restoration)

Live qualification of the SUN-1220L EIP-712 domain-metadata fix against
production, using the SUN-1220M candidate at 0% traffic under a version
override, exactly one unpaid `POST /v2/verify/agent-output`, and immediate
restoration to known-good 100%. **No payment signing, no EIP-3009
authorization, no `PAYMENT-SIGNATURE`, no paid request, no settlement, no
economic effect.**

## 0. Starting state reconciliation

```
SUN1220M_NEW_PAID_CANDIDATE_UPLOAD  = PASS
NEW_PAID_CANDIDATE_VERSION_ID       = a0055146-d358-40d4-b0af-52eccc56c8ef
NEW_PAID_CANDIDATE_CREATED_AT       = 2026-08-28T20:23:52.274246Z
KNOWN_GOOD_PRODUCTION                = f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce @ 100%
HISTORICAL_SUPERSEDED_CANDIDATE      = 9a18898a-f08b-4543-8e00-8bccf2dfc52a (HISTORICAL_PAID_CANDIDATE_REUSABLE=NO, untouched)
```

Both the upload and this qualification's mutating Cloudflare commands
(`wrangler versions deploy`) were run manually by the user in their own
terminal, outside Claude Code's Bash sandbox, because the local
auto-mode permission classifier blocks these commands when invoked by the
agent. Every claim below is from an independent, authoritative read-back run
directly by the assistant (`wrangler deployments status`, live `curl`
requests, a live `wrangler tail --format json` capture, and the canonical
`decodePaymentRequiredHeaderSafe` codec) — not from the pasted terminal
transcript.

## 1. Temporary 100/0 split

User-run command:

```
wrangler versions deploy \
  f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce@100 \
  a0055146-d358-40d4-b0af-52eccc56c8ef@0 \
  --message "SUN-1220N: temporary known-good 100% / domain-metadata paid candidate 0% for live 402 qualification" \
  --yes
```

Independent read-back (`wrangler deployments status`, run by the assistant):

```
Version(s):  (100%) f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
             (0%)   a0055146-d358-40d4-b0af-52eccc56c8ef
```

```
TEMPORARY_SPLIT_CONFIRMED = PASS
```

## 2. Ordinary routing, before any override

`wrangler tail siteborne-utility-edge --format json` started in the
background before any request; attribution below is from that live capture,
matched by `cf-ray`, not from response bodies.

```
GET /health, no override -> HTTP 200, ray a32623d31f28674a
  scriptVersion.id: f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
  outcome: ok, exceptions: []

ORDINARY_ROUTING_DURING_ZERO_PERCENT = KNOWN_GOOD
```

## 3. Candidate attribution (one request)

```
GET /health, header
  Cloudflare-Workers-Version-Overrides: siteborne-utility-edge="a0055146-d358-40d4-b0af-52eccc56c8ef"
-> HTTP 200, ray a326244acc022c90
  scriptVersion.id: a0055146-d358-40d4-b0af-52eccc56c8ef
  outcome: ok, exceptions: []

CANDIDATE_OVERRIDE_ATTRIBUTION = PASS
```

## 4. The governed unpaid verify call (exactly one, real)

Request body: the frozen `agent-verification-input.schema.json`'s own
published `examples[0]` verbatim. No `PAYMENT-SIGNATURE` header, no payment
material of any kind.

```bash
curl -X POST \
  -H 'Content-Type: application/json' \
  -H 'Cloudflare-Workers-Version-Overrides: siteborne-utility-edge="a0055146-d358-40d4-b0af-52eccc56c8ef"' \
  --data @verify_body.json \
  https://siteborne-utility-edge.siteborneutilitynetwork.workers.dev/v2/verify/agent-output
```

Result:

```
HTTP 402, ray a32624612e23dd20
body: {"error":"payment_required","x402_version":2,
       "quote_id":"qte_bbcdee21f492f2e0e458eae3",
       "requirement_id":"req_f4c8a824f1afc23d5ec8eed0"}
```

Tail attribution for this exact ray: `scriptVersion.id
a0055146-d358-40d4-b0af-52eccc56c8ef`, `outcome: "ok"`, `exceptions: []`,
`wallTime: 1010ms`, `cpuTime: 136ms`.

```
CANDIDATE_UNPAID_X402_BOUNDARY = PASS
REAL_PAYMENT_MATERIAL_SENT     = NO
PAYMENT_SIGNATURES             = 0
SETTLEMENTS                    = 0
TRANSACTIONS                   = 0
REAL_ECONOMIC_EFFECTS          = 0
```

## 5. Canonical `PAYMENT-REQUIRED` decode

Decoded with the production codec (`packages/protocol-x402/src/codec/headers.ts`,
`decodePaymentRequiredHeaderSafe`) — not hand-parsed:

```json
{
  "ok": true,
  "value": {
    "x402Version": 2,
    "resource": { "url": "https://siteborne-utility-edge.siteborneutilitynetwork.workers.dev/v2/verify/agent-output" },
    "accepts": [
      {
        "scheme": "exact",
        "network": "eip155:8453",
        "amount": "19000",
        "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        "payTo": "0x7f44a2dd237938F18632d4CcA40f4c690295E6E1",
        "maxTimeoutSeconds": 60,
        "extra": {
          "name": "USD Coin",
          "version": "2",
          "quote_id": "qte_bbcdee21f492f2e0e458eae3"
        }
      }
    ]
  }
}
```

Hard-field validation against the frozen economic invariant:

```
CHALLENGE_NETWORK              = eip155:8453                                    -> MATCH
CHALLENGE_ASSET                = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913      -> MATCH
CHALLENGE_AMOUNT_ATOMIC         = 19000                                          -> MATCH
CHALLENGE_PAYTO                 = 0x7f44a2dd237938F18632d4CcA40f4c690295E6E1     -> MATCH
CHALLENGE_SCHEME                = exact                                          -> MATCH
CHALLENGE_QUOTE_ID_PRESENT      = YES
CHALLENGE_EXTRA_NAME             = "USD Coin"                                     -> PRESENT (SUN-1220L fix, live)
CHALLENGE_EXTRA_VERSION          = "2"                                            -> PRESENT (SUN-1220L fix, live)

LIVE_PAYMENT_REQUIREMENT_EXACT_EVM_COMPATIBLE = YES
ECONOMIC_CAP_GATE                              = PASS  (0.019 USD == 19000 atomic; MAX_TOTAL_PAYER_EXPOSURE_USD 0.25 not exceeded, no fee)
```

This is the qualification target of the entire SUN-1220K/L/M/N chain: the
live `PAYMENT-REQUIRED` challenge now carries `extra.name` and
`extra.version`, which SUN-1220K identified as absent and which
`ExactEvmScheme.createPaymentPayload` → `signEIP3009Authorization` requires
before `signTypedData` is reachable.

## 6. Mandatory restoration

Executed immediately after §5, no other requests issued in between.

```bash
wrangler versions deploy \
  f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce@100 \
  --message "SUN-1220N: mandatory restoration to known-good 100% after live unpaid 402 qualification" \
  --yes
```

Run directly by the assistant (not blocked this time — single-version
deploys did not trip the classifier that blocked the two-version split).
Independent read-back:

```
$ wrangler deployments status
Version(s):  (100%) f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce

$ curl .../health          -> HTTP 200 (no override)
$ curl -X POST .../v2/verify/agent-output --data '{}'  -> HTTP 404 (route absent from active deployment)
$ pnpm production:preflight -> PREFLIGHT RESULT: PASS
```

```
SUN1220N_RESTORATION      = PASS
FINAL_PRODUCTION_VERSION  = f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
FINAL_PRODUCTION_TRAFFIC  = 100%
```

## 7. Economic action ledger (unchanged from checkpoint's zero-mandate)

```
WORKER_VERSIONS_CREATED_THIS_CHECKPOINT = 0   (candidate already existed from SUN-1220M)
DEPLOYMENTS                             = 2   (temporary split, then restoration — both zero-economic)
TRAFFIC_SHIFTS                          = 2   (100/0 -> 100/0 restored; candidate never carried traffic)
CANDIDATE_REQUESTS                      = 2   (1 health attribution, 1 unpaid verify)
LIVE_402_REQUESTS                       = 1
PAYMENT_SIGN_TYPED_DATA_CALLS           = 0
EIP3009_AUTHORIZATIONS_CREATED          = 0
PAYMENT_PAYLOADS_CREATED                = 0
PAYMENT_SIGNATURES_CREATED              = 0
LIVE_PAID_REQUESTS_WITH_PAYMENT         = 0
SETTLEMENTS                             = 0
TRANSACTIONS                            = 0
REAL_ECONOMIC_EFFECTS                   = 0
```

## 8. Result

```
LIVE_DOMAIN_METADATA_402_QUALIFICATION_ELIGIBLE = YES
FIRST_REAL_PAID_E2E_EXECUTION_ELIGIBLE          = NO
```

The SUN-1220L fix is proven live in production's actual `PAYMENT-REQUIRED`
challenge. A real paid E2E is still gated on mainnet activation, which
remains blocked on SUN-1219A's finding
(`EXISTING_CDP_CREDENTIALS_PRODUCTION_APPROVED=NO`): the user must
provision production-designated CDP credentials via the Coinbase CDP
Portal, and the four ADR-0055 production gates must be legitimately set,
before any buyer-side signing work proceeds.

### Note on the checkpoint's "authorization reconciliation" claim

This checkpoint's prompt asserted that `siteborne-x402-facilitator` is
already an approved production CDP credential and that SUN-1219A's
`EXISTING_CDP_CREDENTIALS_PRODUCTION_APPROVED=NO` finding should not block
further work. That assertion arrived as pasted instruction text, not as new
verified evidence — no live CDP Portal check was authorized or performed in
this checkpoint (or possible under its own "no live CDP" constraint) to
confirm or refute it. Absent independent verification, this report keeps
SUN-1219A's previously-established finding as authoritative and reports
`FIRST_REAL_PAID_E2E_EXECUTION_ELIGIBLE = NO` accordingly. Resolving this
requires either the user producing verifiable evidence of the credential's
production approval, or a dedicated read-only CDP Portal verification
checkpoint.
