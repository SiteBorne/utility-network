# SUN-1221E2D — diagnostic-hardened candidate upload

## Lineage

- SUN-1221E2D implementation: `ae85ae5` (full SHA: see `git log --oneline -1 ae85ae5`)
- Old (now historical) candidate: `915be949-b46f-464b-a4d6-17b74539ce55` — `OLD_E2_CANDIDATE_REUSE_ELIGIBLE=NO` (source changed since it was uploaded)

## Candidate

```
DIAGNOSTIC_CANDIDATE_VERSION_ID=0ef05df7-4627-4de1-9b8e-b366f94872c8
DIAGNOSTIC_CANDIDATE_CREATED_AT=2026-08-29T18:48:09.336Z
WORKER_VERSION_UPLOADS=1
```

## Pre-upload qualification-var manifest (§19)

Built from the last-known-good candidate's own authoritative read-back (`915be949`), not guessed — the exact 13-variable set this checkpoint's own primary defect class (SUN-1221E1's missing-`--var` mistake) exists to guard against:

| Variable | Value |
|---|---|
| `AGENT_CARD_SIGNING_KEY_ID` | `siteborne-agent-card-2026-08` |
| `ENVIRONMENT` | `production` |
| `HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP` | `true` |
| `LOG_LEVEL` | `info` |
| `NVM_ENVIRONMENT` | `sandbox` |
| `PAID_ROUTES_ENABLED` | `true` |
| `PAYMENT_ENVIRONMENT` | `production` |
| `PCC_VERSION` | `1.0.0` |
| `PRODUCTION_CDP_CREDENTIALS_APPROVED` | `true` |
| `PRODUCTION_ENABLED` | `true` |
| `SELLER_WALLET_ADDRESS` | `0x7f44a2dd237938F18632d4CcA40f4c690295E6E1` |
| `VERIFY_V2_CDP_ROUTE_ENABLED` | `true` |
| `WEB_CONTEXT_V2_CDP_ROUTE_ENABLED` | `true` |

`PREUPLOAD_QUALIFICATION_VAR_MANIFEST_COMPLETE=YES`, `PREUPLOAD_REQUIRED_VAR_COUNT=13`.

- verify/CDP active: `PAID_ROUTES_ENABLED=true` + `VERIFY_V2_CDP_ROUTE_ENABLED=true` ✓
- web-context/CDP active: `PAID_ROUTES_ENABLED=true` + `WEB_CONTEXT_V2_CDP_ROUTE_ENABLED=true` ✓
- remaining 10 paid routes: no other `*_ROUTE_ENABLED` flag present — inactive ✓
- Nevermined: `NVM_ENVIRONMENT=sandbox` only, no production-activation flag — inactive ✓
- all four ADR-0055 production/mainnet gates present and `true` ✓

## Authoritative candidate read-back (§21)

`wrangler versions view 0ef05df7-4627-4de1-9b8e-b366f94872c8` — all 13 vars match the manifest above exactly, byte-for-byte. Six required Worker secrets present (`AGENT_CARD_SIGNING_PRIVATE_KEY`, `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `NVM_API_KEY`, `PAID_RECEIPT_SIGNING_KEY_ID`, `PAID_RECEIPT_SIGNING_PRIVATE_KEY`). `CDP_WALLET_SECRET` absent (never a Worker secret, by design — buyer-side only).

`DIAGNOSTIC_CANDIDATE_CONFIG_READBACK=PASS`.

## Not deployed (§22)

`wrangler deployments status` immediately after upload: active deployment unchanged — `de70bf98-f304-4d7f-b189-4ae2401041a0 @ 100%`, single version, candidate `0ef05df7` entirely absent from the active deployment. No version-override request, no `/ready` request, no 402, ever sent against the candidate.

`DIAGNOSTIC_CANDIDATE_IN_ACTIVE_DEPLOYMENT=NO`.

## Zero economic actions (§23)

```
BUYER_BALANCE_QUERIES=0
SIGN_TYPED_DATA_CALLS=0
EIP3009_AUTHORIZATIONS_CREATED=0
PAYMENT_SIGNATURES_CREATED=0
PAID_REQUESTS=0
SETTLEMENTS=0
TRANSACTIONS=0
REAL_ECONOMIC_EFFECT_USDC=0
CURRENT_REAL_PAYMENT_AUTHORIZATION=NONE
```

## Final production state

```
FINAL_PRODUCTION_VERSION=de70bf98-f304-4d7f-b189-4ae2401041a0
FINAL_PRODUCTION_TRAFFIC=100%
FINAL_PRODUCTION_PREFLIGHT=PASS
```

## E3 eligibility

**`SUN1221E3_REAL_PAID_RETRY_ELIGIBLE=NO`** — not for any procedural reason (every mechanical gate above is satisfied), but because SUN-1221E2D §9/§10 proved with certainty that a real paid retry against `web_context_verified.v2` would deterministically reproduce the identical `policy_blocked` HTTP 502: `globalTermsGuard` has no terms review recorded for `direct-public-http` anywhere in the codebase, and this checkpoint deliberately did not fabricate one (see the implementation report's §10 for why). That is a human/business decision, not an engineering gate this candidate can pass on its own. This candidate is ready and waiting the moment that decision is made.
