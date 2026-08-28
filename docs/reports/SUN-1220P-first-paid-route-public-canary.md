# SUN-1220P — First Paid Route Public Canary: FAILED at Pre-Canary Discovery Gate, Emergency Restoration

## Outcome

**SUN1220P_PUBLIC_PAID_CANARY = FAIL**

The bounded 1% public canary was already live in production (deployed under
explicit human authorization in the prior turn) when this checkpoint began.
Reconciliation against actual Cloudflare state found the "AUTHORITATIVE
STARTING STATE" assumed by the checkpoint script (`known-good @100%`) was
stale — production was live at 99/1 with zero Phase-A safety gates run.
Safety verification was therefore performed against the live state
immediately. The pre-canary/candidate discovery-truthfulness hard gate
(§9) **failed**, and production was restored to known-good @ 100% within
the same turn.

## Timeline

| Time (UTC) | Event |
|---|---|
| 2026-08-28T21:58:34.390Z | 99/1 canary deployed under explicit human authorization (`f4f20676...@99%`, `a0055146...@1%`) |
| 2026-08-28T21:58:34 – 22:00:45 | Live public 1% traffic exposure window (~2m 11s) |
| this turn | Reconciliation found live 99/1 state contradicted checkpoint's assumed 100/0 starting state |
| this turn | Candidate safe-surface smoke: PASS (6/6 surfaces returned HTTP 200 via version override) |
| this turn | Candidate discovery-truthfulness check: **FAIL** (see below) |
| 2026-08-28T22:00:45.083Z | Emergency restoration deployed: `f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce @ 100%`, candidate removed |
| this turn | Read-back confirmed: single version, 100% traffic, `/health` = 200 |

## SUN-1220O evidence resolution (§1–2)

- `SUN1220O_SUCCESS_EVIDENCE_COMMIT_SHA` = `322852a78e032f3d06a43ead8102517af2cdecdf`
- Transaction `0x612efe6f63cfbec1939241cc5fe6e9797ac4f1e94c248a644501e7bb2eaec5a2` — evidence in committed report unchanged, not re-verified against a new economic action (none performed).
- `SUN1220O_SETTLEMENT_EVIDENCE_RECONCILED` = YES (from committed evidence; no new chain query performed in this checkpoint)

## Candidate safe-surface smoke (§8) — PASS

Via `Cloudflare-Workers-Version-Overrides: siteborne-utility-edge="a0055146-d358-40d4-b0af-52eccc56c8ef"`:

| Surface | HTTP |
|---|---|
| `/health` | 200 |
| `/catalog` | 200 |
| `/schemas` | 200 |
| `/openapi.json` | 200 |
| `/.well-known/agent-card.json` | 200 |
| `/.well-known/jwks.json` | 200 |

`CANDIDATE_SAFE_SURFACE_SMOKE = PASS`

## Pre-canary public-discovery truthfulness (§9) — **FAIL**

The candidate's live, publicly served `/catalog` and
`/.well-known/agent-card.json` both declare, for **every** service
including `verify_agent_output.v2`:

```
"production_enabled": false,
"production_ready": false,
"protocol_status": "preproduction"
```

and, in the agent-card's x402 extension params:

```
"productionEnabled": false
```

This directly contradicts the runtime fact already proven by SUN-1220O:
`verify_agent_output.v2` on this exact candidate version executed a real,
settled 0.019 USDC payment
(`0x612efe6f63cfbec1939241cc5fe6e9797ac4f1e94c248a644501e7bb2eaec5a2`) minutes
earlier. The service is live, payable, and settling real funds while its own
public discovery tells external agents/consumers it is not production-ready.

**Root cause**: `production_enabled` / `production_ready` /
`protocol_status` are static columns in the D1 `services` table
(`apps/edge-api/src/control-plane/repositories/d1/services.ts`), set
independently of the ADR-0055 runtime payment-gate environment variables
(`PAID_ROUTES_ENABLED`, `PRODUCTION_ENABLED`, `PAYMENT_ENVIRONMENT`, etc.)
that actually govern whether a paid request is enforced and settled. The
SUN-1220M/N/O checkpoints flipped the runtime gates on this candidate but
never updated the D1 catalog metadata, so the two layers drifted out of
sync. This is a genuine discovery-truthfulness defect, not a transient
flake — it will reproduce on every future candidate unless the D1 catalog
row is updated as part of candidate qualification.

`PRECANARY_PUBLIC_DISCOVERY_TRUTHFULNESS = FAIL`

Per the checkpoint's own hard-gate instruction, no inline patch was applied
and no further canary steps (safe-sample collection, observation window,
runtime health gates) were run. Production was restored immediately.

## Mandatory restoration (§18) — PASS

```
wrangler versions deploy f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce@100 --yes
```

Read-back:
- `FINAL_PRODUCTION_VERSION` = `f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce`
- `FINAL_PRODUCTION_TRAFFIC` = 100%
- Candidate absent from active deployment
- `GET /health` = 200

`SUN1220P_CANARY_RESTORATION = PASS`

## Mutation accounting

| Counter | Value |
|---|---|
| Restoration deployment mutations | 1 |
| Worker versions created | 0 |
| Agent sign_typed_data calls | 0 |
| Agent EIP-3009 authorizations created | 0 |
| Agent payment signatures created | 0 |
| Agent paid request submissions | 0 |
| Agent settlements | 0 |
| Agent transactions | 0 |
| External paid requests observed | UNPROVEN (no dedicated attribution tooling run before restoration; window was ~2m11s) |

## Final stop packet

```
SUN1220P_PUBLIC_PAID_CANARY=FAIL
SUN1220O_SUCCESS_EVIDENCE_COMMIT_SHA=322852a78e032f3d06a43ead8102517af2cdecdf
FRESH_PUBLIC_1_PERCENT_CANARY_AUTHORIZATION=YES
NEW_PAID_CANDIDATE_VERSION_ID=a0055146-d358-40d4-b0af-52eccc56c8ef
SUN1220O_SETTLEMENT_EVIDENCE_RECONCILED=YES
CANDIDATE_DRIFT_SINCE_PAID_E2E=NO
CANDIDATE_SAFE_SURFACE_SMOKE=PASS
PRECANARY_PUBLIC_DISCOVERY_TRUTHFULNESS=FAIL
  reason: candidate /catalog and agent-card claim production_enabled=false /
  production_ready=false / protocol_status=preproduction for
  verify_agent_output.v2 despite a real settled payment on this exact
  candidate (SUN-1220O). Root cause: D1 services table metadata not
  synchronized with ADR-0055 runtime payment gates.
OTHER_11_PAID_ROUTES_ACTIVE=NOT_CHECKED (stopped at discovery gate per instructions)
NEVERMINED_ACTIVE=NOT_CHECKED (stopped at discovery gate per instructions)
PUBLIC_CANARY_DEPLOYMENT_READBACK=N/A (canary was already live pre-checkpoint; not re-deployed)
AGENT_SIGN_TYPED_DATA_CALLS=0
AGENT_PAYMENT_SIGNATURES_CREATED=0
AGENT_PAID_REQUEST_SUBMISSIONS=0
AGENT_SETTLEMENTS=0
SUN1220P_CANARY_RESTORATION=PASS
FINAL_PRODUCTION_VERSION=f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
FINAL_PRODUCTION_TRAFFIC=100%
FULL_PROMOTION_ELIGIBLE=NO
```

## Recommendation

Before any future public canary attempt on this or any candidate: update the
D1 `services` table `production_enabled` / `production_ready` /
`protocol_status` fields for `verify_agent_output.v2` (and any other
route being qualified) to accurately reflect the ADR-0055 runtime gate
state, as an explicit, reviewed step in candidate qualification — not an
inline patch during a live canary.
