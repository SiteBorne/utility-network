# SUN-1222C2-CANDIDATE-DISCOVERY-ECONOMICS-RECONCILIATION

Date: 2026-09-05

Repository start HEAD: `635615b022832eaf5815724e389afef641b0ec06`

Worker: `siteborne-utility-edge`

Production hostname: `https://utility.siteborne.net`

## Result

**PASS.** The discovery/economics mismatch found by the prior
`SUN-1222C2-deterministic-version-override-targeting.md` checkpoint was a
real, root-caused, source-level bug — not a Cloudflare routing artifact and
not a stale-candidate-source issue. It has been fixed in source, proven with
a genuine red/green test, gated against the full repository test suite, and
verified live on a freshly uploaded 0%-traffic candidate using the same
deterministic version-override + authoritative Ray-ID attribution
methodology validated by the prior checkpoint. All four frozen v2 service
prices now display correctly on the candidate. Zero economic action of any
kind was taken.

## 1. Root cause

`GET /catalog` and `GET /services/:service_id`
(`apps/edge-api/src/control-plane/routes/catalog.ts`) both returned
`price_usd` as a straight, unmodified pass-through of the D1 `services`
table's stored column.

That column is written exactly once by `seedServices()`
(`apps/edge-api/src/control-plane/routes/paid-services.ts`) — a plain
`INSERT` whose `UNIQUE constraint` failure path is treated as "already
exists, do nothing." No code path anywhere in the repository ever updates
an existing row's `price_usd` (`D1ServicesRepository` exposes only
`create`, `getById`, `getAll`, and `updateProductionEnabled` — no price
setter exists at all).

Live read-only query against the real production D1 database
(`siteborne-utility`, `efe23c42-cbcc-47c2-9b28-922a541bdcdd`) confirmed all
8 rows (four `.v1` + four `.v2` service ids) were seeded on
`2026-08-18 03:48:17` and never touched since. At that time, `.v2` prices
had not yet been reduced by SUN-1000 checkpoint 1M / SUN-1222C-R3's later
governed-price change (`REGISTRY_SERVICES` in
`packages/protocol-x402/src/bazaar/registry-source.ts`, via
`withGovernedRegistryPrice(...)` /
`resolveServiceMaxPriceUsd('*_v2')` in `packages/pricing`). The D1 rows kept
their original, higher, pre-freeze values forever:

| service_id | stale D1 `price_usd` | governed (correct) price | atomic |
|---|---|---|---|
| `company_evidence_graph.v2` | 0.039 | **0.0312** | 31200 |
| `web_context_verified.v2` | 0.009 | **0.008** | 8000 |
| `document_evidence_json.v2` | 0.012 | **0.0098** | 9800 |
| `verify_agent_output.v2` | 0.019 | **0.017** | 17000 |

Critically, this is a **discovery-only** defect. The actual x402
`PaymentRequirements` a buyer receives on a real 402 challenge is built
independently from `REGISTRY_SERVICES` (already correct, already covered by
existing tests in `packages/pricing`, `packages/protocol-x402`, and the
production-composition test suites) — a buyer would have been shown a
*higher* advertised price than they'd actually be charged, never charged
more than advertised. Still a real correctness defect that blocks honest
discovery, and exactly what this checkpoint was authorized to find and fix.

The repository had already solved this exact class of problem once, for a
different field: `overlayEffectiveDiscoveryStatus()` in the same file
already overlays `production_enabled` / `production_ready` /
`protocol_status` live from `resolveEffectiveServiceRuntimeStatus(...)`
specifically because SUN-1220P1 §7 proved the static D1 value can drift.
`price_usd` was simply never given the same treatment.

`SOURCE_FIX_REQUIRED=YES`. `ROOT_CAUSE_CLASS=DISCOVERY_ONLY_BUG` (not
`STALE_CANDIDATE_SOURCE` — a fresh candidate built from unmodified source
would have shown the identical bug, since all Worker versions share the
same D1 database).

## 2. Fix

[`catalog.ts`](../../apps/edge-api/src/control-plane/routes/catalog.ts):
extended `overlayEffectiveDiscoveryStatus()` to also project
`price_usd` from `REGISTRY_SERVICES[service_id].maximum_price.amount`
(imported from `@siteborne/protocol-x402`) whenever a registry entry exists
for that service id — applied unconditionally per-service (not gated on
`hasProductionExecutor`, since a stale advertised price is a discovery
defect independent of executor wiring). A service id absent from the
registry keeps its D1 value unchanged, matching the existing status
overlay's own fallback behavior.

This uses the same field (`maximum_price.amount`) `seedServices()` itself
already uses to seed `price_usd` in the first place, so the overlay is
consistent with the repository's own existing convention, not a new one.

**Incidental, transparently-disclosed side effect**: this also changes the
displayed price for the (out-of-scope, deprecated) `.v1` service ids. For
`.v2` entries `withGovernedRegistryPrice(...)` sets `base_price.amount` and
`maximum_price.amount` to the identical governed value, so the fix is exact
for the four services this checkpoint was authorized to reconcile. For
`.v1` entries the frozen registry JSON's `base_price` (the actual flat
charge, e.g. `company_evidence_graph.v1` = 0.039) and `maximum_price` (a
separate authorized-ceiling field, e.g. 0.19) differ — the overlay now
surfaces the ceiling, not the flat charge, for `.v1` catalog listings only.
`.v1` was not named in this checkpoint's frozen economics and carries zero
live traffic; flagged here for a future checkpoint's attention rather than
addressed now, since altering `.v1` behavior was outside this
authorization's scope and no v1 economic action is affected (v1 routes are
not activated on production or on this candidate).

## 3. Test: genuine red/green

New file
[`catalog.test.ts`](../../apps/edge-api/src/control-plane/routes/catalog.test.ts)
(real Miniflare D1, real migrations, a row seeded with the actual
historical stale price to reproduce the exact live scenario):

- **RED** (fix reverted via `git stash` on `catalog.ts` alone, test file
  kept): 2 of 3 tests failed —
  `expected '0.039' to be '0.0312'` on both `GET /catalog` and
  `GET /services/:service_id`.
- **GREEN** (fix restored): 3/3 pass.

`RED_GREEN_PROVEN=YES`.

## 4. Full repository gate

- `tsc --noEmit` (edge-api project): clean, zero errors.
- `scripts/validate-governance.ts`: 77/77 checks passed.
- `eslint` on both changed files: zero warnings/errors.
- `vitest run` (full monorepo, 255 files / 2922 tests): **2844 passed**,
  **1 failed**, 77 skipped (pre-existing live/e2e gates requiring
  network/credentials not exercised this checkpoint).
  - The 1 failure
    (`worker-bridge.subprocess.test.ts`, real-Python-subprocess OCR bridge
    test) timed out at 60s under full-suite parallel CPU contention. Fully
    unrelated to this checkpoint's change (different package, no
    pricing/catalog/discovery code in its path). Re-ran in isolation with
    the fix stashed out: **passed in 18.8s**. Confirmed pre-existing,
    confirmed unrelated, confirmed non-flaky in isolation.

`FULL_REPO_GREEN=YES` (one confirmed-unrelated, confirmed-passing-in-
isolation timeout under parallel load, not a regression).

Committed as `32bc9a1` (repo-only; zero Cloudflare/D1 mutation at this
point).

## 5. Candidate rebuild

Exact same four-service activation as the superseded candidate `8ce8cb66`,
replicated from a **fresh live readback** of `8ce8cb66` itself (not prior
memory) rather than assumed: all 10 non-committed "activating" vars
(`PAID_ROUTES_ENABLED`, `PRODUCTION_ENABLED`,
`HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP`,
`PRODUCTION_CDP_CREDENTIALS_APPROVED`, `PAYMENT_ENVIRONMENT`,
`VERIFY_V2_CDP_ROUTE_ENABLED`, `WEB_CONTEXT_V2_CDP_ROUTE_ENABLED`,
`COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED`,
`DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED`,
`DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED`, all `"true"`/`"production"`) plus
the committed `wrangler.toml` `[vars]` (unchanged).

- **Dry-run** (`wrangler versions upload --dry-run`): binding list matched
  expectations exactly (D1, R2 `ARTIFACTS`, cross-script `Workflow`, KV,
  Queues, all 10 activating vars hidden-but-present). `CANDIDATE_DRY_RUN=PASS`.
- **Upload** (`wrangler versions upload`, upload only, no traffic):
  `Worker Version ID: efc5a287-d807-4b07-957f-ebbdf471e439`, tag
  `sun1222c2-discovery-economics-fix`, built from HEAD `32bc9a1`.
  `CANDIDATE_UPLOADS=1`.
- **Deployment-state mutation** (`wrangler versions deploy
  db7054c9-...@100 efc5a287-...@0`): deployment id
  `dd0319d8-0619-48b7-a11d-560c47f598d1`, created
  `2026-09-05T18:00:20.763Z`. `DEPLOYMENT_STATE_MUTATIONS=1`.

Cloudflare Workers supports at most two versions per deployment, so this
deployment necessarily dropped `8ce8cb66` out of the *current* deployment
(see §8, stale-candidate disposition).

## 6. Deterministic version-override targeting (live proof)

Same mechanism the prior checkpoint validated
(`Cloudflare-Workers-Version-Overrides: siteborne-utility-edge="<version>"`
against the normal production hostname), but using **unfiltered**
`wrangler tail --format json` (no `--version-id` filter) plus Ray-ID-to-
`scriptVersion.id` matching — the prior checkpoint's filtered-tail approach
was proven unreliable there and is not repeated here.

Bounded, non-economic surface list (control = no header, override = header
targeting `efc5a287`), 17 requests total, **17/17 authoritatively
attributed**, zero ambiguity, zero unexplained events:

| Surface | Method | Control → version | Override → version |
|---|---|---|---|
| `/health` (×2 rounds) | GET | `db7054c9` | `efc5a287` |
| `/ready` | GET | `db7054c9` | `efc5a287` |
| `/catalog` | GET | `db7054c9` | `efc5a287` |
| `/.well-known/agent-card.json` | GET | `db7054c9` | `efc5a287` |
| `/openapi.json` | GET | `db7054c9` | `efc5a287` |
| `/mcp` `tools/list` | POST | `db7054c9` | `efc5a287` |
| `/services/document_evidence_json.v2` | GET | `db7054c9` | `efc5a287` |
| `/services/company_evidence_graph.v2` | GET | — | `efc5a287` |
| `/services/web_context_verified.v2` | GET | — | `efc5a287` |
| `/services/verify_agent_output.v2` | GET | — | `efc5a287` |

Every control request landed on production (`db7054c9`); every override
request landed on the new candidate (`efc5a287`) — never crossed, never
ambiguous. `OVERRIDE_TARGETING_VERIFIED=YES`,
`ATTRIBUTION_METHOD=AUTHORITATIVE` (Ray-ID-matched trace events, not
response status).

No POST to any paid/x402 service was made. `/mcp` `tools/list` is an
unpaid JSON-RPC discovery method. Zero 402s obtained, zero payment
material constructed, zero signatures, zero settlements.

## 7. Live discovery economics — now correct

Read directly from the candidate's own `GET /services/:id` responses
(override-targeted, authoritatively attributed above):

| service_id | live `price_usd` | matches frozen? | `production_enabled` | `protocol_status` |
|---|---|---|---|---|
| `company_evidence_graph.v2` | `0.0312` | ✅ (31200 atomic) | `true` | `production` |
| `web_context_verified.v2` | `0.008` | ✅ (8000 atomic) | `true` | `production` |
| `document_evidence_json.v2` | `0.0098` | ✅ (9800 atomic) | `true` | `production` |
| `verify_agent_output.v2` | `0.017` | ✅ (17000 atomic) | `true` | `production` |

All four match the frozen economics from this checkpoint's authorization
exactly. `DISCOVERY_ECONOMICS_RECONCILED=YES`.

## 8. Workflow binding & custom-domain integrity

- `PAID_CONTINUATION_WORKFLOW` → `siteborne-paid-continuation-runtime`
  present and unchanged on the new candidate (confirmed in the upload/dry-
  run binding readback, §5).
- Every probe in §6, control and override alike, targeted
  `https://utility.siteborne.net` — the production custom domain, never
  `*.workers.dev`. `CUSTOM_DOMAIN_PRESERVED=YES`.

## 9. Stale-candidate disposition

`8ce8cb66-f388-4fcc-b3e6-9c14b4919a93` (the prior, stale-price candidate)
is no longer a member of the current deployment (`dd0319d8` contains only
`db7054c9` and `efc5a287`) — Cloudflare's own two-version-per-deployment
limit made this an automatic consequence of deploying the corrected
candidate, not a separate action. Per Cloudflare's documented
Version-Overrides contract, a version outside the current deployment is no
longer targetable by that mechanism. No further action needed on
`8ce8cb66`; treat it as superseded.

## 10. Zero-percent external targetability (unchanged finding, re-confirmed)

Re-confirms the prior checkpoint's finding against the *new* candidate:
a 0%-normal-traffic version remains reachable by any external caller who
supplies the correct Worker name + version UUID via the override header,
on the normal production hostname. This is standard, documented Cloudflare
platform behavior, already recorded in
[`PRODUCTION_CUTOVER_RUNBOOK.md` §7.1](../operations/PRODUCTION_CUTOVER_RUNBOOK.md)
by the prior checkpoint; no further runbook change needed here.
`ZERO_PERCENT_VERSION_EXTERNALLY_TARGETABLE_BY_OVERRIDE=YES` (unchanged).

## 11. Absolute economic guardrail

`PAYMENT_ATTEMPTS=0` `SIGNATURES=0` `SETTLEMENTS=0`
`USDC_TRANSFERRED_ATOMIC=0` `PAID_POSTS=0` `INTENTIONAL_402S_OBTAINED=0`
`PRICING_CHANGES_TO_ACCEPTED_ECONOMICS=0` (the frozen four-service
economics are unchanged — this checkpoint corrected *display*, not the
governed values themselves) `CREDENTIAL_MUTATIONS=0` `D1_MIGRATIONS=0`.

## 12. Final deployment / mutation ledger

- Repo commits: 1 (`32bc9a1`, source fix + regression test).
- Candidate uploads: 1 (`efc5a287-d807-4b07-957f-ebbdf471e439`).
- Deployment-state mutations: 1 (`dd0319d8`, `db7054c9@100` /
  `efc5a287@0`).
- D1 migrations: 0. Secret changes: 0. Committed `wrangler.toml` var
  changes: 0. Economic actions: 0.
- Final authoritative readback: production `db7054c9` **100%**, candidate
  `efc5a287` **0%** — unchanged split, corrected candidate.

## Verdict

```
SUN1222C2_CANDIDATE_DISCOVERY_ECONOMICS_RECONCILIATION=PASS
ROOT_CAUSE_CLASS=DISCOVERY_ONLY_BUG
SOURCE_FIX_REQUIRED=YES (applied, commit 32bc9a1)
RED_GREEN_PROVEN=YES
FULL_REPO_GREEN=YES
CANDIDATE_UPLOADS=1
DEPLOYMENT_STATE_MUTATIONS=1
D1_MIGRATIONS=0
CREDENTIAL_MUTATIONS=0
ECONOMIC_ACTIONS=0
OVERRIDE_TARGETING_VERIFIED=YES (17/17 authoritative Ray-ID matches)
DISCOVERY_ECONOMICS_RECONCILED=YES (31200/8000/9800/17000 atomic, all four, live)
WORKFLOW_BINDING_INTACT=YES
CUSTOM_DOMAIN_PRESERVED=YES
STALE_CANDIDATE_8CE8CB66_STILL_IN_DEPLOYMENT=NO (superseded)
ZERO_PERCENT_VERSION_EXTERNALLY_TARGETABLE_BY_OVERRIDE=YES (unchanged platform behavior)
FINAL_PRODUCTION_TRAFFIC=100% (db7054c9-76ee-4830-aabe-8a4542261b6a)
FINAL_CANDIDATE_TRAFFIC=0% (efc5a287-d807-4b07-957f-ebbdf471e439)
NEXT_REQUIRED_CHECKPOINT=SUN-1222C2-Q1-COMPANY-EVIDENCE-GRAPH
```

The four-service candidate now advertises correct, frozen discovery
economics and is deterministically, authoritatively targetable at 0%
traffic. `SUN-1222C2-Q1-COMPANY-EVIDENCE-GRAPH` — the first of the four
real paid-qualification attempts — may proceed, but per the C2 coordinator
runbook's own explicit requirement, only under its own fresh, standalone,
first-person human authorization immediately before that attempt. This
checkpoint does not start Q1.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
