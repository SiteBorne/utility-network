# SUN-1220M — x402 EIP-712 domain-metadata paid candidate (Worker version upload)

Evidence hygiene (SUN-1220H backfill) + exactly one non-deploying Worker
version upload. **No deployment, no traffic shift, no version override, no
live 402, no live signing, no payment material, no paid request, no
settlement.**

## 0. Starting state reconciliation

```
SUN1220K_DESIGN_EVIDENCE_COMMIT_SHA  = e59be29a917e2f87fc5b7ce876455f9eaa3b0022
SUN1220L_IMPLEMENTATION_COMMIT_SHA   = 2d1961a77ce4fc6fd58dd1511da2140bd7ea5da0
SUN1220H_BACKFILL_COMMIT_SHA         = 4c5e023f043853eb41a47fe4a431057f11e8e47 (docs+evidence-integrity commit)
```

`docs/reports/SUN-1220H-paid-e2e-economic-preflight.md` was already
backfilled and committed as `4c5e023` in a prior turn of this same
checkpoint chain (annotated historical, superseded, stale HEAD `ea89b80`
noted). Working tree confirmed clean immediately before the upload:

```
$ git status --short
(empty)

$ git log --oneline -5
4c5e023 SUN-1220H: backfill superseded economic preflight evidence
2d1961a SUN-1220L: propagate x402 EIP-712 domain metadata
e59be29 SUN-1220K: record x402 payment domain metadata design
09d41ef SUN-1220J: add one-shot local paid E2E client
12ecbbd SUN-1220I: record first paid E2E challenge preflight
```

## 1. Pre-upload freeze and regression (prior turn, unchanged at upload time)

Fresh regression run against `4c5e023` (source unchanged from SUN-1220L's
`2d1961a`): lint 16/16, typecheck 23/23, `test` 2211 passed / 37 skipped,
`test:worker-runtime` 88/88, `production:preflight` PASS, `secrets:scan`
clean. Dry-run bundle inspected: `paymentRequirementExtra: { name, version }`
reachable in `verify-agent-output-v2-cdp-composition.ts`'s compiled output;
zero reachable calls to `createPaymentPayload` / `signEIP3009Authorization`
/ `ExactEvmScheme` outside vendored SDK copies and comments; `CDP_WALLET_SECRET`
absent from the bundle's declared bindings.

## 2. Upload

**Environment note**: `wrangler versions upload` is a real, outward-facing,
hard-to-reverse mutation (it registers a new Worker version against the
live Cloudflare account) and was correctly refused twice by Claude Code's
own auto-mode permission classifier when I attempted to run it directly in
this session — that block was working as intended, not a bug. Per the
tool's own guidance in that situation ("STOP and explain... let the user
decide"), the user ran the upload themselves, in their own terminal:

```
$ cd "/Users/meta4ickal/SITEBORNE Utility Network/apps/edge-api" && pnpm exec wrangler versions upload \
    --var PAID_ROUTES_ENABLED:true \
    --var VERIFY_V2_CDP_ROUTE_ENABLED:true \
    --var PAYMENT_ENVIRONMENT:production \
    --var PRODUCTION_ENABLED:true \
    --var HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP:true \
    --var PRODUCTION_CDP_CREDENTIALS_APPROVED:true \
    --message "SUN-1220M x402 EIP-712 domain-metadata paid candidate"
```

I did not run or observe that command's own terminal output. Everything
below is an independent authoritative read-back I performed myself via
read-only `wrangler` and HTTP calls after the user reported `done`.

## 3. Authoritative read-back

```
$ pnpm exec wrangler versions list --json
...
{
  "id": "a0055146-d358-40d4-b0af-52eccc56c8ef",
  "number": 29,
  "metadata": {
    "created_on": "2026-08-28T20:23:52.274246Z",
    "source": "wrangler",
    "author_email": "hello@siteborne.com",
    "has_preview": true
  },
  "annotations": {
    "workers/message": "SUN-1220M x402 EIP-712 domain-metadata paid candidate",
    "workers/triggered_by": "version_upload"
  }
}
```

```
$ pnpm exec wrangler versions view a0055146-d358-40d4-b0af-52eccc56c8ef
Version ID:  a0055146-d358-40d4-b0af-52eccc56c8ef
Created:     2026-08-28T20:23:52.274Z
Message:     SUN-1220M x402 EIP-712 domain-metadata paid candidate

Secrets:
  AGENT_CARD_SIGNING_PRIVATE_KEY
  CDP_API_KEY_ID
  CDP_API_KEY_SECRET
  NVM_API_KEY
  PAID_RECEIPT_SIGNING_KEY_ID
  PAID_RECEIPT_SIGNING_PRIVATE_KEY

env.PAID_ROUTES_ENABLED                     ("true")
env.VERIFY_V2_CDP_ROUTE_ENABLED             ("true")
env.PAYMENT_ENVIRONMENT                     ("production")
env.PRODUCTION_ENABLED                      ("true")
env.HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP   ("true")
env.PRODUCTION_CDP_CREDENTIALS_APPROVED     ("true")
```

`CDP_WALLET_SECRET` is absent from the secrets list — 6/6 expected secrets
present, no more, no fewer. All six requested `--var` gates landed exactly
as specified.

```
$ pnpm exec wrangler deployments status
Created:     2026-08-26T13:24:26.285Z
Message:     SUN-1220I: mandatory restoration to known-good only after fresh unpaid-402 challenge preflight
Version(s):  (100%) f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
```

The new candidate (`a0055146...`, version 29) does **not** appear in the
active deployment. Traffic split is unchanged from before the upload:
`f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce` still holds 100%.

```
$ curl -s -o /dev/null -w '%{http_code}\n' https://siteborne-utility-edge.siteborneutilitynetwork.workers.dev/health
200
$ curl -s -o /dev/null -w '%{http_code}\n' https://siteborne-utility-edge.siteborneutilitynetwork.workers.dev/v2/verify/agent-output
404
```

Live production containment confirmed post-upload: health check 200, the
paid route returns 404 (currently-deployed version has paid routes gated
off) — i.e. no economic surface was touched by this upload.

Historical candidate `9a18898a-f08b-4543-8e00-8bccf2dfc52a` (SUN-1219C)
is unchanged in the version list and remains historical/non-reusable,
untouched by this action.

## 4. Final packet

```
WORKER_VERSIONS_CREATED                       = 1
DEPLOYMENTS                                   = 0
TRAFFIC_SHIFTS                                = 0
CANDIDATE_REQUESTS                            = 0
LIVE_402_REQUESTS                             = 0
LIVE_SIGN_TYPED_DATA_CALLS                    = 0
EIP3009_AUTHORIZATIONS_CREATED                = 0
PAYMENT_SIGNATURES_CREATED                    = 0
LIVE_PAID_REQUESTS                            = 0
SETTLEMENTS                                   = 0
TRANSACTIONS                                  = 0
REAL_ECONOMIC_EFFECTS                         = 0

NEW_PAID_CANDIDATE_VERSION_ID                 = a0055146-d358-40d4-b0af-52eccc56c8ef
NEW_PAID_CANDIDATE_NUMBER                     = 29
NEW_PAID_CANDIDATE_CREATED_AT                 = 2026-08-28T20:23:52.274Z
NEW_PAID_CANDIDATE_TRAFFIC                    = 0%

FINAL_PRODUCTION_VERSION                      = f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
FINAL_PRODUCTION_TRAFFIC                      = 100%
POSTUPLOAD_PRODUCTION_CONTAINMENT             = PASS
LIVE_DOMAIN_METADATA_402_QUALIFICATION_ELIGIBLE = YES

HISTORICAL_PAID_CANDIDATE_REUSABLE            = NO   (9a18898a..., unchanged)
```

## 5. Mainnet activation path (unchanged, still blocked)

This upload does not change SUN-1219A's finding:
`EXISTING_CDP_CREDENTIALS_PRODUCTION_APPROVED = NO`. The new candidate
carries the domain-metadata fix and the ADR-0055 gate variables, but no
mainnet-designated CDP credentials have been provisioned, no traffic has
been shifted to it, and no qualification 402 has been requested against
it. The next step in the chain (SUN-1219B-style candidate qualification,
zero-traffic deployment, and eventual user-authorized traffic shift) still
requires the user to first provision fresh production-designated CDP
credentials via the Coinbase CDP Portal.

**STOP.** No deployment, no version override, no live 402, no signing, no
payment material, no paid E2E was performed.
