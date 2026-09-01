# SUN-1221G: Final Production Promotion

**Checkpoint status:** PASS
**Worker:** `siteborne-utility-edge`
**Authorization:** explicit standalone user authorization, in-conversation, this checkpoint only

## 0. Lineage

| Item | Value |
|---|---|
| Rollback version (known-good) | `de70bf98-f304-4d7f-b189-4ae2401041a0` |
| Promoted candidate | `db7054c9-76ee-4830-aabe-8a4542261b6a` (h2bf5-final, SUN-1221E6R qualified) |
| Pre-promotion traffic | de70bf98 99% / db7054c9 1% |
| F evidence | `383327c` — SUN1221F_CANARY=PASS (2 clean candidate samples, did not meet ≥5 floor alone) |
| F2 evidence | `8842c3f` — SUN1221F2=PASS (5 new clean candidate samples; total 7, 0 candidate 5xx/exceptions) |
| R3 governance classification | `NONCOMPLIANT_NON_ECONOMIC_EXTRA_MUTATIONS` (preserved, not rewritten) |
| R4 evidence | `66e9592` — receipt durability fix, real recovery, cryptographic verification |

## 1. Authorization gate

A prior message in this conversation that reused the G runbook text as a *command* (not a first-person authorization) was correctly treated as **insufficient** — `SUN1221G_AUTHORIZATION=ABSENT`, zero mutations performed, execution stopped per §1. Execution resumed only after the user supplied an explicit first-person "I authorize SUN-1221G to perform the final SITEBORNE production promotion..." statement.

## 2. Pre-promotion readback

`wrangler versions deploy --dry-run` / `wrangler deployments list` confirmed, immediately before mutation:
- `de70bf98-f304-4d7f-b189-4ae2401041a0` = 99%
- `db7054c9-76ee-4830-aabe-8a4542261b6a` = 1%
- No third active version.
- Host `siteborne-paid-continuation-runtime`: last deployment 2026-09-01T15:17:01Z, version `1641fac4`, unchanged, no public route/workers.dev (by design — see `wrangler.paid-continuation-runtime.toml`).
- Single settlement owner: exactly 1 reference to `cdp_successful_economic_settlement_count` write path in `src/`.
- Receipt baseline: on-chain tx `0x15e60…41d95`, status `success`, 1 USDC transfer of 9000 atomic units, 0 duplicates.
- Pricing exact: `verify_agent_output.v2` = 0.019 USDC, `web_context_verified.v2` = 0.009 USDC.

`PROMOTION_TRAFFIC_READBACK=PASS`.

## 3. Promotion mutation

Exactly one mutation executed via `wrangler versions deploy`:

```
Created:     2026-09-01T20:37:08.935Z
Message:     SUN-1221G: final production promotion, candidate 100%, de70 retained as rollback
Version(s):  (100%) db7054c9-76ee-4830-aabe-8a4542261b6a
```

`de70bf98-f304-4d7f-b189-4ae2401041a0` retained as the designated rollback version at 0% traffic (not deleted). `PROMOTION_TRAFFIC_MUTATIONS=1`.

## 4. Post-promotion observation

**Monitoring:** `wrangler tail siteborne-utility-edge --format json` (pid 49095) + a 15s-interval non-economic sampler (pid 49218) hitting `/`, `/health`, `/ready`, `/catalog`, `/.well-known/agent-card.json`, `/services/verify_agent_output.v2`, `/services/web_context_verified.v2`, `/openapi.json`, and `POST /mcp tools/list` (modern per-request `_meta` envelope, `MCP-Protocol-Version: 2026-07-28` header — the legacy `initialize` handshake is rejected by design). A background watcher (`watch.py`) parsed the tail stream every 5s, checked both process PIDs were alive (not inferred from narration), and flagged any promoted-version abnormality immediately.

Both monitor processes were independently verified alive mid-window (`G_TAIL_PROCESS_ALIVE=YES`, `G_SAMPLER_PROCESS_ALIVE=YES`) — no restart was needed, so this is one continuous window, not stitched.

| Metric | Value |
|---|---|
| `G_OBSERVATION_START` | `2026-09-01T20:37:14Z` |
| `G_CONTINUOUS_OBSERVATION_SECONDS` | 601 |
| `G_SAFE_PROBE_COUNT` | 41 |
| `G_SAFE_PROBE_2XX_COUNT` | 41 |
| `G_SAFE_PROBE_5XX_COUNT` | 0 |
| `G_PROMOTED_VERSION_EVENT_COUNT` (tail-captured) | 52 |
| `G_UNEXPECTED_ROLLBACK_VERSION_EVENTS` | 0 |
| `G_PROMOTED_VERSION_EXCEPTIONS` | 0 |
| `G_PROMOTED_VERSION_5XX` | 0 |
| Promoted-version status mix | 200×47, 400×3, 404×1, 202×1 — ordinary organic client noise, all `outcome=ok`, none candidate-attributed defects |

## 5. Workflow / D1 / receipt health (end-of-window, read-only)

- `wrangler d1 execute siteborne-utility --remote` connectivity: PASS (schema intact, 12 tables enumerated).
- `payment_attempts` rows created during window: 0.
- `x402_service_results` rows created during window: 0.
- `audit_events` rows (any, or error/fail-typed) during window: 0.
- Host `siteborne-paid-continuation-runtime` deployment unchanged (still `1641fac4`, no redeploy this checkpoint) — no way to reach it publicly by design, so health is inferred from D1 reachability + zero error rows, which is the same evidence basis used in prior checkpoints (F/F2).
- Single settlement owner: unchanged (no source edits this checkpoint).

`G_WORKFLOW_HOST_HEALTH=PASS`, `G_D1_HEALTH=PASS`, `G_RECEIPT_DURABILITY_ERRORS=0`, `G_SINGLE_SETTLEMENT_OWNER=PASS`.

## 6. Economic guardrail

`INTENTIONAL_402_REQUESTS=0`, `INTENTIONAL_PAYMENT_AUTHORIZATIONS=0`, `INTENTIONAL_SIGNER_CALLS=0`, `INTENTIONAL_PAID_POSTS=0`, `INTENTIONAL_SETTLEMENTS=0`. `G_ORGANIC_PAID_EVENTS_OBSERVED=0` — no organic paid traffic occurred during the window; nothing required reconciliation.

## 7. End-of-window public discovery check

Re-ran `/`, `/health`, `/ready`, `/catalog`, `/.well-known/agent-card.json`, `/.well-known/jwks.json`, `/services/verify_agent_output.v2`, `/openapi.json`, and modern `POST /mcp tools/list` after the window closed. All 200 / valid JSON; MCP `tools/list` returned a coherent tool listing. `POST_PROMOTION_DISCOVERY_COHERENCE=PASS`.

## 8. Rollback law

Not triggered. `ROLLBACK_TRAFFIC_MUTATIONS=0`.

## 9. Final state

`db7054c9-76ee-4830-aabe-8a4542261b6a` = 100% (`G_END_PRODUCTION_VERSION` / `G_END_PRODUCTION_TRAFFIC`). `de70bf98-f304-4d7f-b189-4ae2401041a0` = 0%, retained as `G_ROLLBACK_VERSION`. 99/1 split was **not** restored, per instruction.

`SUN1221G_FINAL_PRODUCTION_PROMOTION=PASS`
`SITEBORNE_SECOND_PAID_SERVICE_RELEASE=COMPLETE`

## Final packet

```
SUN1221G_FINAL_PRODUCTION_PROMOTION=PASS
PROMOTION_TRAFFIC_MUTATIONS=1
PROMOTION_TRAFFIC_READBACK=PASS
G_OBSERVATION_START=2026-09-01T20:37:14Z
G_CONTINUOUS_OBSERVATION_SECONDS=601
G_SAFE_PROBE_COUNT=41
G_SAFE_PROBE_2XX_COUNT=41
G_SAFE_PROBE_5XX_COUNT=0
G_PROMOTED_VERSION_EVENT_COUNT=52
G_UNEXPECTED_ROLLBACK_VERSION_EVENTS=0
G_PROMOTED_VERSION_EXCEPTIONS=0
G_PROMOTED_VERSION_5XX=0
G_WORKFLOW_HOST_HEALTH=PASS
G_D1_HEALTH=PASS
G_RECEIPT_DURABILITY_ERRORS=0
INTENTIONAL_402_REQUESTS=0
INTENTIONAL_PAYMENT_AUTHORIZATIONS=0
INTENTIONAL_SIGNER_CALLS=0
INTENTIONAL_PAID_POSTS=0
INTENTIONAL_SETTLEMENTS=0
G_ORGANIC_PAID_EVENTS_OBSERVED=0
POST_PROMOTION_DISCOVERY_COHERENCE=PASS
ROLLBACK_TRAFFIC_MUTATIONS=0
G_END_PRODUCTION_VERSION=db7054c9-76ee-4830-aabe-8a4542261b6a
G_END_PRODUCTION_TRAFFIC=100%
G_ROLLBACK_VERSION=de70bf98-f304-4d7f-b189-4ae2401041a0
SITEBORNE_SECOND_PAID_SERVICE_RELEASE=COMPLETE
SUN1221G_EVIDENCE_COMMIT_SHA=<filled after commit>
NEXT_REQUIRED_CHECKPOINT=SUN-1222A-POST-RELEASE
```
