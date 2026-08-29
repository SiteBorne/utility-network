# SUN-1220Q — Final Production Promotion (FAILED — Rolled Back)

Attempted full production promotion of the discovery-fixed candidate
(`8a1cdfe1-2e68-4dd9-b604-07dc3a666963`) to 100% traffic. **Promotion
succeeded technically but failed the public-discovery hard gate (§8):
`/ready` reports `production_services_enabled: false` and a stale
`blocked_external` list, directly contradicting live production reality.
Rolled back immediately to known-good per §0/§18. Release NOT complete.**

## Human authorization

Explicit in-chat authorization was obtained via a direct yes/no
confirmation naming the candidate, the 100% target, the rollback version,
the route scope (`verify_agent_output.v2`/CDP only, other routes and
Nevermined inactive), and prohibiting agent-initiated payment activity.
The user selected: *"Yes, authorize and proceed."*

## Release lineage

```
P1 design                 = 664427d0ceb16af000052e85bf0aeb3ed4c044c4
P2 discovery impl         = 83d7e2d31bc1322edce69e1d97f4638e5b20e0ec
P3 candidate evidence     = a14910ec001afcadcb7d9b329561c786950e5726
P4 qualification evidence = 4017207b78535a23d8b066acc478cae59af55e5b
P5 canary evidence        = 70bbad37210719878f728670084b452b2464183a
P5R reconciliation        = f06da167d4f63587c41e60a652e6d10667ae24d5
Final candidate           = 8a1cdfe1-2e68-4dd9-b604-07dc3a666963
Rollback version          = f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
```

## §1–2: Preconditions — PASS

- `git status --short`: clean. `git rev-parse HEAD` == `git rev-parse
  f06da16` == `f06da167d4f63587c41e60a652e6d10667ae24d5`.
- Starting production: single active version `f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce`
  @ 100%, candidate absent. `pnpm production:preflight`: PASS.

## §3–4: Candidate immutability / economic identity — PASS

`wrangler versions view 8a1cdfe1-...`: created `2026-08-28T22:36:59.486Z`,
message "SUN-1220P3 discovery-truthfulness qualification candidate" —
identical to every prior checkpoint (Cloudflare Worker versions are
content-addressed/immutable, so this confirms zero drift since P5).
Qualification vars confirmed: `PAID_ROUTES_ENABLED=true`,
`VERIFY_V2_CDP_ROUTE_ENABLED=true`, `PAYMENT_ENVIRONMENT=production`,
`PRODUCTION_ENABLED=true`, `HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP=true`,
`PRODUCTION_CDP_CREDENTIALS_APPROVED=true`. No other-route enable flags
present. `NVM_ENVIRONMENT=sandbox` (Nevermined inactive). Secrets: exactly
6 (`AGENT_CARD_SIGNING_PRIVATE_KEY`, `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`,
`NVM_API_KEY`, `PAID_RECEIPT_SIGNING_KEY_ID`,
`PAID_RECEIPT_SIGNING_PRIVATE_KEY`); `CDP_WALLET_SECRET` absent, as
required. `git merge-base --is-ancestor 83d7e2d3 HEAD`: confirmed. Economic
contract constants (`0x8335...`, `0x7f44...`, `19000`, `eip155:8453`)
still present in current source at the four call sites established in
prior checkpoints.

## §5: Fresh Q-owned observability — started

New `wrangler tail --format json` launched and identified by exact PID
chain (`96225` → `96227` → `96233`; leaf PID `96233` is the actual
tail process), output captured to a fresh, Q-only file. 8 pre-existing
stale `wrangler tail` process trees were observed and left untouched
(not in scope for this checkpoint; see §25).

## §6: Promotion mutation — succeeded, read-back confirmed

```
$ pnpm exec wrangler versions deploy 8a1cdfe1-2e68-4dd9-b604-07dc3a666963@100 --yes
...
SUCCESS  Deployed siteborne-utility-edge version 8a1cdfe1-2e68-4dd9-b604-07dc3a666963 at 100%
```

Authoritative read-back (`wrangler deployments status`):

```
Created: 2026-08-29T01:10:02.531Z
Version(s): (100%) 8a1cdfe1-2e68-4dd9-b604-07dc3a666963
```

`SUN1220Q_PROMOTION_READBACK = PASS`.

## §7: Immediate health control — PASS

`GET /health` (normal routing, no override header): HTTP 200. Cross-
referenced by `cf-ray` (`a327ad1a9f039da2`) against the Q tail capture:
attributed to `scriptVersion.id = 8a1cdfe1-2e68-4dd9-b604-07dc3a666963`.
`NORMAL_PRODUCTION_ATTRIBUTION = PASS`.

## §8: Public discovery hard gate — **FAIL**

All five surfaces returned HTTP 200. `/catalog`, `/services/verify_agent_output.v2`,
`/.well-known/agent-card.json`, and `/openapi.json` correctly report
`production_enabled: true` / `protocol_status: "production"` for
`verify_agent_output.v2` (the P2 discovery-truthfulness fix holds on
these surfaces, as already established in P4/P5).

`/ready`, however, returned:

```json
{
  "status": "not_ready",
  "phase": "foundation",
  "production_services_enabled": false,
  "blocked_external": ["cloudflare_account_configuration", "ionos_dns_migration",
    "seller_wallet", "cdp_credentials", "nevermined_credentials", "registry_publication"],
  "reason": "Service contracts and production dependencies are not yet verified. Only health/readiness endpoints available."
}
```

This is stale, hardcoded content from an early pre-production phase of the
project. Every item in `blocked_external` was resolved checkpoints ago
(a real paid route was live, at that exact moment, on this exact
deployment). `/ready` was evidently never brought into scope by the P2
discovery-truthfulness fix — that fix covered `/catalog`,
`/services/<id>`, and the agent-card, but not `/ready`. The result is the
same class of bug SUN-1220P1/P2 were built to eliminate (public discovery
falsely contradicting live runtime reality), now caught on a surface the
original fix didn't reach.

```
READY_RUNTIME_AVAILABILITY_CONTRADICTION = YES
PRODUCTION_PUBLIC_DISCOVERY_TRUTHFULNESS = FAIL
```

Per §8/§0: **rolled back immediately**, before further investigation.

## §18: Rollback — PASS

```
$ pnpm exec wrangler versions deploy f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce@100 --yes
SUCCESS  Deployed siteborne-utility-edge version f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce at 100%
```

Authoritative read-back:

```
Created: 2026-08-29T01:11:58.336Z
Version(s): (100%) f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
```

Post-rollback `GET /health`: HTTP 200 `{"status":"ok",...}`.
Post-rollback `pnpm production:preflight`: PASS.

`SUN1220Q_ROLLBACK = PASS`.

## Live-window accounting (full coverage, Q tail ran before promotion through after rollback)

Candidate was live @ 100% for **115.805s** (`2026-08-29T01:10:02.531Z` →
`2026-08-29T01:11:58.336Z`, both deployment-readback timestamps). The Q
tail captured the entire window with no gaps. Exactly **6 events**
occurred during it, all self-generated by this checkpoint's own §7/§8
probes (`/health`, `/ready`, `/catalog`, `/services/verify_agent_output.v2`,
agent-card, `/openapi.json`), all HTTP 200, zero exceptions:

```
01:10:28.264  GET /health                              200
01:11:14.172  GET /ready                                200
01:11:15.905  GET /catalog                              200
01:11:19.598  GET /services/verify_agent_output.v2       200
01:11:36.080  GET /.well-known/agent-card.json           200
01:11:37.827  GET /openapi.json                          200
```

No POST was ever sent to `/v2/verify/agent-output` (§11 was never
reached — the checkpoint failed at §8, before it). No external traffic of
any kind hit the candidate during the live window.

```
EXTERNAL_PAID_REQUESTS_OBSERVED    = 0  (fully observed, not UNPROVEN — Q tail covers the whole window)
EXTERNAL_SETTLEMENTS_OBSERVED      = 0
EXTERNAL_DUPLICATE_SETTLEMENT_PATTERN = NO
AGENT_SIGN_TYPED_DATA_CALLS        = 0
AGENT_EIP3009_AUTHORIZATIONS_CREATED = 0
AGENT_PAYMENT_SIGNATURES_CREATED   = 0
AGENT_PAID_REQUEST_SUBMISSIONS     = 0
AGENT_SETTLEMENTS                  = 0
AGENT_REAL_ECONOMIC_EFFECT_USDC    = 0
```

## §23: Secrets scan

`pnpm secrets:scan`: 236 commits scanned, one finding — the same known
recurring `BASESCAN_TOKEN_CONTRACT` heuristic match on the public
BaseScan contract address in `SUN-1220O-first-real-paid-e2e.md:159`,
unchanged since prior checkpoints. `NEW_SECRET_FINDINGS = 0`.

## §25: Q-owned tail cleanup

The Q-owned tail process was stopped by exact PID (`96225`/`96227`/`96233`,
its full parent→child chain), confirmed dead by re-check — not by
pattern-matching (a prior checkpoint's `pkill -f` pattern was found in
P5R to have silently failed to match its target; exact-PID kill here was
verified to actually work). `SUN1220Q_OWN_TAIL_PROCESS_STOPPED = YES`.

8 pre-existing, unrelated `wrangler tail` process trees (dating back
across multiple days) remain running, untouched, exactly as this
checkpoint's scope requires. `PREEXISTING_STALE_WRANGLER_TAIL_PROCESSES =
YES`. `BACKGROUND_GLOBAL_TAIL_CLEANUP_PERFORMED = NO` — cleanup of that
backlog is a separate maintenance action for a future, explicitly-scoped
checkpoint.

## §26: Mutation accounting

```
WORKER_VERSIONS_CREATED            = 0
PROMOTION_DEPLOYMENT_MUTATIONS     = 1   (8a1cdfe1@100, later reverted)
ROLLBACK_DEPLOYMENT_MUTATIONS      = 1   (f4f20676@100)
D1_WRITES                          = 0
AGENT_SELECTED_ROUTE_UNPAID_REQUESTS = 0  (§11 never reached)
AGENT_SIGN_TYPED_DATA_CALLS        = 0
AGENT_EIP3009_AUTHORIZATIONS_CREATED = 0
AGENT_PAYMENT_PAYLOADS_CREATED     = 0
AGENT_PAYMENT_SIGNATURES_CREATED   = 0
AGENT_PAID_REQUEST_SUBMISSIONS     = 0
AGENT_SETTLEMENTS                  = 0
AGENT_TRANSACTIONS                 = 0
AGENT_REAL_ECONOMIC_EFFECT_USDC    = 0
```

## Why this counts as the release working as designed

The candidate's economic path, other-route isolation, and Nevermined
isolation were never in question here — the failure is a discovery-surface
bug, not an economic-safety bug, and it was caught and rolled back before
any external user could observe or act on the contradictory `/ready`
response while a real payment route was live. This is precisely the
outcome the §0 evidence-integrity/rollback law and the §8 hard gate exist
to produce: rollback on the first hard-gate failure, before further
investigation, with zero economic exposure. `SITEBORNE_FIRST_PAID_SERVICE_RELEASE`
remains `NOT_COMPLETE`.

## Required follow-up (not performed here — out of this checkpoint's scope)

`/ready`'s handler needs the same discovery-truthfulness treatment P2 gave
`/catalog`/`/services/<id>`/agent-card: it must reflect live, version-local
runtime gate state rather than a hardcoded pre-production snapshot. A new
checkpoint (design → fix → qualify → re-canary → re-attempt promotion)
would need to repeat the P1→P5 sequence for `/ready` specifically before
SUN-1220Q can be re-attempted.

---

## Final stop packet

```
SUN1220Q_FINAL_PRODUCTION_RELEASE = FAIL
SUN1220Q_EVIDENCE_COMMIT_SHA = <set at commit time, below>
FRESH_SUN1220Q_PRODUCTION_PROMOTION_AUTHORIZATION = YES
P5R_RECONCILIATION = PASS
P5_CANARY_RERUN_REQUIRED = NO
PROMOTED_CANDIDATE_VERSION_ID = 8a1cdfe1-2e68-4dd9-b604-07dc3a666963
ROLLBACK_VERSION_ID = f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
SUN1220Q_PROMOTION_READBACK = PASS
NORMAL_PRODUCTION_ATTRIBUTION = PASS
PRODUCTION_PUBLIC_DISCOVERY_TRUTHFULNESS = FAIL
PRODUCTION_CATALOG_VERIFY_V2_PRODUCTION_ENABLED = true
PRODUCTION_AGENT_CARD_VERIFY_V2_PRODUCTION_ENABLED = true
PRODUCTION_AGENT_CARD_PROTOCOL_STATUS = production
READY_RUNTIME_AVAILABILITY_CONTRADICTION = YES
OTHER_11_PAID_ROUTES_DISCOVERY_ACTIVE = NO   (not separately re-checked post-§8-failure; unaffected by this candidate's known route config)
OTHER_11_PAID_ROUTES_RUNTIME_ACTIVE = NO     (unaffected; not reached)
NEVERMINED_DISCOVERY_ACTIVE = NO
NEVERMINED_RUNTIME_ACTIVE = NO
PRODUCTION_SELECTED_ROUTE_UNPAID_REQUESTS = 0   (never sent -- §8 failed first)
PRODUCTION_SELECTED_ROUTE_HTTP_STATUS = N/A
PRODUCTION_402_MATCHES_QUALIFIED_CONTRACT = N/A
PROMOTION_OBSERVATION_DURATION_SECONDS = 115.805   (live window before rollback; no bounded observation attempted, gate failed first)
CANDIDATE_UNHANDLED_EXCEPTIONS = 0
CANDIDATE_RUNTIME_EVAL_FAILURES = 0
CANDIDATE_UNEXPECTED_5XX = 0
CANDIDATE_D1_ERRORS = 0
CANDIDATE_PROVIDER_ERRORS = 0
CANDIDATE_RECEIPT_SIGNER_ERRORS = 0
AGENT_SIGN_TYPED_DATA_CALLS = 0
AGENT_EIP3009_AUTHORIZATIONS_CREATED = 0
AGENT_PAYMENT_SIGNATURES_CREATED = 0
AGENT_PAID_REQUEST_SUBMISSIONS = 0
AGENT_SETTLEMENTS = 0
AGENT_REAL_ECONOMIC_EFFECT_USDC = 0
EXTERNAL_PAID_REQUESTS_OBSERVED = 0
EXTERNAL_SETTLEMENTS_OBSERVED = 0
EXTERNAL_DUPLICATE_SETTLEMENT_PATTERN = NO
FINAL_PRODUCTION_PREFLIGHT = PASS
FINAL_PUBLIC_SURFACE_TRUTHFULNESS = FAIL   (/ready contradiction; all other surfaces truthful)
ROLLBACK_REQUIRED = YES
SUN1220Q_ROLLBACK = PASS
FINAL_PRODUCTION_VERSION = f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
FINAL_PRODUCTION_TRAFFIC = 100%
VERIFY_AGENT_OUTPUT_V2_CDP_PRODUCTION_ACTIVE = NO
VERIFY_AGENT_OUTPUT_V2_PRICE_USDC = 0.019
VERIFY_AGENT_OUTPUT_V2_NETWORK = eip155:8453
OTHER_11_PAID_SERVICES_PRODUCTION_ACTIVE = NO
NEVERMINED_PRODUCTION_ACTIVE = NO
REAL_PAID_E2E_PREVIOUSLY_PROVEN = YES
REAL_PAID_E2E_REPEAT_REQUIRED = NO
NEW_SECRET_FINDINGS = 0
SUN1220Q_OWN_TAIL_PROCESS_STOPPED = YES
PREEXISTING_STALE_WRANGLER_TAIL_PROCESSES = YES
BACKGROUND_GLOBAL_TAIL_CLEANUP_PERFORMED = NO
SITEBORNE_FIRST_PAID_SERVICE_RELEASE = NOT_COMPLETE
```
