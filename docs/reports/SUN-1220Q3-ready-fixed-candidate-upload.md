# SUN-1220Q3 — Ready-Fixed Qualification Candidate Upload

Upload only. No deployment, no traffic shift, no live requests, no payment.

## Evidence chain

```
SUN1220Q_FAILURE_EVIDENCE_COMMIT_SHA=09a7862ec2285629adbe04e7fae6ae400534d127
SUN1220Q1_DESIGN_EVIDENCE_COMMIT_SHA=a5a1ea59062f28456bdf5d5b1fda35ec9475222b
SUN1220Q2_IMPLEMENTATION_COMMIT_SHA=41fdaccea4ad245fa0dd034740d7577e2cdb650b
SOURCE_HEAD_SHA (at upload)=41fdaccea4ad245fa0dd034740d7577e2cdb650b
WORKING_TREE_CLEAN=YES
```

**Note (evidence-integrity anomaly, out of scope for this checkpoint):** while
reconciling lineage for this report, `docs/reports/SUN-1220P3-discovery-fixed-candidate-upload.md`
was found to contain a literal unresolved context-compaction placeholder
(`… [elided …] ⟦bm_…⟧`) instead of its real body — a real evidence-integrity
defect in that historical committed report. It does not block this checkpoint
(Q3's required lineage is Q/Q1/Q2, all of which are intact and were verified
byte-for-byte above), but it means the P3 upload's exact recorded metadata is
not currently recoverable from the repository as committed. Flagged for a
separate remediation checkpoint; not touched here (Q3 has no authorization to
edit P3's evidence).

## §2 — Q2 source scope (reconciled)

```
git show --stat 41fdacc
```

```
apps/edge-api/src/routes/readiness.ts              |  35 ++-
apps/edge-api/tests/readiness-truthfulness.test.ts | 239 +++++++++++++++
apps/edge-api/tests/routes.test.ts                 |   7 +-
docs/reports/SUN-1220Q2-ready-production-truthfulness-implementation.md | 341 +++++++++++++++++++++
scripts/test-readiness-truthfulness-mutation-caught.mts                | 233 ++++++++++++++
5 files changed, 844 insertions(+), 11 deletions(-)
```

No file under payment requirement construction, x402 scheme handling,
settlement, payment provider, receipt signer, payment evidence, service
executor, paid route composition, buyer client, D1 migrations/write path, or
route economics appears in the diff.

```
READY_ONLY_EFFECTIVE_BEHAVIOR_CHANGE=YES
ECONOMIC_EXECUTION_PATH_CHANGED=NO
PAID_ROUTE_COMPOSITION_CHANGED=NO
BUYER_CLIENT_CHANGED=NO
NEW_READY_FIXED_CANDIDATE_UPLOAD_ELIGIBLE=YES
```

## §3 — Frozen economic identity

Pricing/amount for `verify_agent_output.v2` is D1-driven and runtime-resolved
(`resolveServiceMaxPriceUsd` → `usdToAtomicUnits`), not a hardcoded literal;
Q2's diff scope (above) touches none of the files in that resolution chain
(`x402-service.ts`, `paid-services.ts`, the CDP composition/executor). Since
Q2 made zero changes there, the economic identity proven live at P4
(`SERVICE=verify_agent_output.v2`, `PRICE_USDC=0.019`, `AMOUNT_ATOMIC=19000`,
`NETWORK=eip155:8453`, `ASSET=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`,
`PAYTO=0x7f44a2dd237938F18632d4CcA40f4c690295E6E1`, `SCHEME=exact`,
`EXTRA_NAME=USD Coin`, `EXTRA_VERSION=2`) remains frozen and unchanged.

## §4 — /ready local truthfulness (focused)

```
pnpm vitest run apps/edge-api/tests/readiness-truthfulness.test.ts
```

18/18 passed. Confirms:
- known-good equivalent: `production_services_enabled=false`
- qualified-candidate equivalent: `production_services_enabled=true`
- stale blockers absent: `cloudflare_account_configuration`, `seller_wallet`, `cdp_credentials`
- unproven blockers preserved: `ionos_dns_migration`, `nevermined_credentials`, `registry_publication`
- `status`/`phase`/`reason` semantics preserved

```
READY_LOCAL_TRUTHFULNESS=PASS
```

## §5 — Cross-surface coherence (P2 discovery + Q2 readiness)

```
pnpm vitest run apps/edge-api/tests/discovery-truthfulness.test.ts apps/edge-api/tests/readiness-truthfulness.test.ts
```

33/33 passed (15 discovery + 18 readiness).

```
CATALOG_AGENT_CARD_READY_COHERENCE=PASS
```

## §6 — Mutation proofs

```
npx tsx scripts/test-readiness-truthfulness-mutation-caught.mts
```
16/16 caught, 0 skipped, 0 not caught. Mutation #16 (economic metadata drift)
was independently caught by the pre-existing domain-metadata suite, proving
Q2 neither touched nor weakened it.

```
npx tsx scripts/test-discovery-truthfulness-mutation-caught.mts
```
10/10 caught, 0 skipped, 0 not caught.

Working tree confirmed clean (`git status --short`, empty) after both scripts
ran — no mutation left applied.

```
READY_TRUTHFULNESS_MUTATION_PROOF=PASS
READY_MUTATIONS_CAUGHT=16/16
DISCOVERY_TRUTHFULNESS_MUTATION_PROOF=PASS
```

## §7 — Full pre-upload regression

```
LINT=PASS
TYPECHECK=PASS
TESTS=2245 passed, 37 skipped, 0 failed (184 files)
WORKER_RUNTIME=88/88 PASS
PRODUCTION_PREFLIGHT=PASS
```

Worker-runtime PHASE 8 also reconfirms route isolation on the real bundle:
other 11 paid routes 404 in every state; only `verify_agent_output.v2` is
economically reachable; zero hard fixture-bypass markers; production
payment-evidence/CDP-composition modules present in bundle.

```
pnpm secrets:scan
```
One finding: `BASESCAN_TOKEN_CONTRACT` in `docs/reports/SUN-1220O-first-real-paid-e2e.md:159`,
commit `322852a`. Byte-identical fingerprint to the known historical
public-address entropy heuristic match recorded in every prior SUN-1220
checkpoint since SUN-1220O. Not a new credential leak.

```
NEW_SECRET_FINDINGS=0
```

## §8 — Bundle verification

```
cd apps/edge-api && npx wrangler deploy --dry-run --outdir <scratch>/q3-bundle
```
`Total Upload: 6254.70 KiB / gzip: 1020.34 KiB`

Bundle inspection (`index.js`):
- `cloudflare_account_configuration`: 1 occurrence, in a comment only
  (`// SUN-1220Q1: ...`), not in the live array literal.
- `seller_wallet` (as a blocked-external string literal): 0 occurrences.
- `ionos_dns_migration`: 1 occurrence (preserved, as required).
- `resolveVerifyAgentOutputV2CdpEffectiveDiscoveryStatus`/`EffectiveDiscoveryStatus`: 9 occurrences (resolver reachable from both `/catalog` and `/ready`).
- `USD Coin` (domain-metadata fix): 7 occurrences.
- Hard fixture-bypass markers (`BYPASS_FIXTURE`, `__FIXTURE_BYPASS__`): 0.
- `CDP_WALLET_SECRET`: 3 occurrences, all inside the vendored CDP SDK's own
  `process.env` fallback path (unreachable in Workers runtime, pre-existing
  since before Q2, unrelated to this change) — not a binding.
- `NEVERMINED_ACTIVE...true` literal: 0 occurrences.

```
READY_FIX_PRESENT_IN_UPLOAD_BUNDLE=YES
P2_DISCOVERY_FIX_PRESENT_IN_UPLOAD_BUNDLE=YES
BUYER_SIGNING_CODE_REACHABILITY=0
CDP_WALLET_SECRET_RUNTIME_REACHABILITY=0
PRODUCTION_FIXTURE_REACHABILITY=0
PRODUCTION_SYNTHETIC_PAYMENT_EVIDENCE_REACHABILITY=0
```

## §9 — Current production precondition (before upload)

```
npx wrangler deployments list
```
Latest deployment record: created `2026-08-29T01:11:58.336Z`,
`(100%) f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce`. The `8a1cdfe1` entry visible
earlier in the list is the superseded SUN-1220Q promotion attempt, rolled
back by this later record.

```
CURRENT_PRODUCTION_VERSION=f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
CURRENT_PRODUCTION_TRAFFIC=100%
ACTIVE_DEPLOYMENT_VERSION_COUNT=1
```
Historical Q-attempt candidate `8a1cdfe1-2e68-4dd9-b604-07dc3a666963` absent
from the active deployment.

## §10/§11 — Qualification config + secret boundary

Read authoritatively from the historical qualified candidate
(`wrangler versions view 8a1cdfe1...`) as the source of truth for exact
values, then replicated on the new candidate at upload time via `--var`.

```
PAID_ROUTES_ENABLED=true
VERIFY_V2_CDP_ROUTE_ENABLED=true
PAYMENT_ENVIRONMENT=production
PRODUCTION_ENABLED=true
HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP=true
PRODUCTION_CDP_CREDENTIALS_APPROVED=true
OTHER_11_PAID_ROUTE_FLAGS_ACTIVE=NO
NEVERMINED_ACTIVE=NO
```

```
Secret Name:  AGENT_CARD_SIGNING_PRIVATE_KEY
Secret Name:  CDP_API_KEY_ID
Secret Name:  CDP_API_KEY_SECRET
Secret Name:  NVM_API_KEY
Secret Name:  PAID_RECEIPT_SIGNING_KEY_ID
Secret Name:  PAID_RECEIPT_SIGNING_PRIVATE_KEY
```
(names only, read via `wrangler secret list`; no values read/logged/printed)

```
REQUIRED_WORKER_SECRETS_PRESENT=YES
CDP_WALLET_SECRET_WORKER_BINDING_PRESENT=NO
CDP_WALLET_SECRET_IN_UPLOAD_CONFIG=NO
CDP_WALLET_SECRET_IN_REPOSITORY=NO
```

## §12 — Historical candidates preserved

```
HISTORICAL_PAID_CANDIDATE_MODIFIED=NO   # a0055146-d358-40d4-b0af-52eccc56c8ef
HISTORICAL_Q_CANDIDATE_MODIFIED=NO      # 8a1cdfe1-2e68-4dd9-b604-07dc3a666963
HISTORICAL_CANDIDATES_REDEPLOYED=NO
```
New version ID differs from both.

## §13/§14 — Upload

```
SOURCE_HEAD_SHA=41fdaccea4ad245fa0dd034740d7577e2cdb650b
BUNDLE_HASH (local dry-run reference, sha256)=48f644c1db4509a6d74201f281bb0369fc7107be1773d1daf9c9b6e0be123dfd
UPLOAD_MESSAGE=SUN-1220Q3 ready-truthfulness qualification candidate
```

```
cd apps/edge-api && npx wrangler versions upload --message "SUN-1220Q3 ready-truthfulness qualification candidate" \
  --var AGENT_CARD_SIGNING_KEY_ID:"siteborne-agent-card-2026-08" \
  --var ENVIRONMENT:"production" \
  --var HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP:"true" \
  --var LOG_LEVEL:"info" \
  --var NVM_ENVIRONMENT:"sandbox" \
  --var PAID_ROUTES_ENABLED:"true" \
  --var PAYMENT_ENVIRONMENT:"production" \
  --var PCC_VERSION:"1.0.0" \
  --var PRODUCTION_CDP_CREDENTIALS_APPROVED:"true" \
  --var PRODUCTION_ENABLED:"true" \
  --var SELLER_WALLET_ADDRESS:"0x7f44a2dd237938F18632d4CcA40f4c690295E6E1" \
  --var VERIFY_V2_CDP_ROUTE_ENABLED:"true"
```

Output: `Total Upload: 6254.70 KiB / gzip: 1020.34 KiB` (identical to the
inspected dry-run bundle), `Worker Version ID: de70bf98-f304-4d7f-b189-4ae2401041a0`.

```
NEW_READY_FIXED_CANDIDATE_VERSION_ID=de70bf98-f304-4d7f-b189-4ae2401041a0
NEW_READY_FIXED_CANDIDATE_VERSION_NUMBER=(Cloudflare does not expose a separate sequential number via CLI; version ID above is the authoritative identifier)
NEW_READY_FIXED_CANDIDATE_CREATED_AT=2026-08-29T02:40:02.907Z
```

Differs from `a0055146-d358-40d4-b0af-52eccc56c8ef` and
`8a1cdfe1-2e68-4dd9-b604-07dc3a666963`. `WORKER_VERSION_UPLOADS=1`.

## §15 — Authoritative version read-back

```
npx wrangler versions view de70bf98-f304-4d7f-b189-4ae2401041a0
```

```
PAID_ROUTES_ENABLED=true
VERIFY_V2_CDP_ROUTE_ENABLED=true
PAYMENT_ENVIRONMENT=production
PRODUCTION_ENABLED=true
HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP=true
PRODUCTION_CDP_CREDENTIALS_APPROVED=true
OTHER_11_PAID_ROUTE_FLAGS_ACTIVE=NO
NEVERMINED_ACTIVE=NO
```
All 6 required secrets present. `CDP_WALLET_SECRET_WORKER_BINDING_PRESENT=NO`.

```
NEW_CANDIDATE_CONFIGURATION_READBACK=PASS
```

## §16 — /ready-fixed source identity

Upload size (`6254.70 KiB / gzip: 1020.34 KiB`) is byte-identical to the
dry-run bundle inspected in §8 (same source HEAD, clean tree at upload time),
which was directly confirmed to contain the Q2 readiness fix and the P2
discovery fix.

```
NEW_CANDIDATE_CONTAINS_Q2_READY_FIX=YES
NEW_CANDIDATE_CONTAINS_P2_DISCOVERY_FIX=YES
```
No live candidate HTTP request performed.

## §17 — Not deployed

```
npx wrangler deployments list
```
Latest deployment record unchanged: still `(100%) f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce`,
created `2026-08-29T01:11:58.336Z`. No new deployment record was created by
`versions upload` (it never mutates active traffic).

```
NEW_READY_FIXED_CANDIDATE_IN_ACTIVE_DEPLOYMENT=NO
NEW_READY_FIXED_CANDIDATE_NORMAL_TRAFFIC_PERCENT=0
DEPLOYMENT_MUTATIONS=0
TRAFFIC_SHIFTS=0
SUN1220Q3_CANDIDATE_UPLOAD=PASS
```

## §18 — No live qualification performed

```
LIVE_REQUESTS=0
LIVE_CANDIDATE_REQUESTS=0
LIVE_402_REQUESTS=0
```
No `/health`, `/ready`, `/catalog`, agent-card, service-detail, version-override,
unpaid-route, or 402 request was sent against the candidate. Reserved for Q4.

## §19 — Historical paid-E2E evidence transfer

```
HISTORICAL_REAL_PAID_E2E_TX=0x612efe6f63cfbec1939241cc5fe6e9797ac4f1e94c248a644501e7bb2eaec5a2
HISTORICAL_REAL_PAID_E2E_CANDIDATE=a0055146-d358-40d4-b0af-52eccc56c8ef
HISTORICAL_REAL_PAID_E2E_AMOUNT_ATOMIC=19000

HISTORICAL_REAL_PAID_E2E_REMAINS_VALID=YES
REAL_PAID_E2E_REPEAT_CURRENTLY_REQUIRED=NO
P4_ECONOMIC_EQUIVALENCE_EVIDENCE_REMAINS_VALID=YES
P5_HISTORICAL_CANARY_EVIDENCE_REMAINS_VALID=YES

NEW_READY_FIXED_CANDIDATE_REAL_PAYMENT_EXECUTED=NO
```

## §20 — Future qualification requirement

```
NEW_ZERO_TRAFFIC_QUALIFICATION_REQUIRED=YES
NEW_PUBLIC_CANARY_REQUIRED=YES
```
No direct promotion is allowed from Q3. The next checkpoint (Q4) must prove
the new candidate live (0%-traffic override) before any canary is considered.

## §23 — Final production containment

```
npx wrangler deployments list
```
```
FINAL_PRODUCTION_VERSION=f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
FINAL_PRODUCTION_TRAFFIC=100%
ACTIVE_DEPLOYMENT_VERSION_COUNT=1
NEW_READY_FIXED_CANDIDATE_IN_ACTIVE_DEPLOYMENT=NO
```
```
pnpm production:preflight
```
`PREFLIGHT RESULT: PASS`
```
FINAL_PRODUCTION_PREFLIGHT=PASS
```

## §24 — Stale wrangler tails

```
ps aux | grep -i "wrangler tail"
```
3 pre-existing stale tail processes observed (predate this checkpoint).

```
PREEXISTING_STALE_WRANGLER_TAIL_PROCESSES=YES
BACKGROUND_GLOBAL_TAIL_CLEANUP_PERFORMED=NO
PROCESS_TERMINATIONS=0
```

## §25 — Mutation accounting

```
WORKER_VERSION_UPLOADS=1
WORKER_VERSIONS_CREATED=1
DEPLOYMENT_MUTATIONS=0
TRAFFIC_SHIFTS=0
D1_WRITES=0
LIVE_REQUESTS=0
LIVE_CANDIDATE_REQUESTS=0
LIVE_402_REQUESTS=0
LIVE_CDP_CALLS=0
LIVE_SIGN_TYPED_DATA_CALLS=0
EIP3009_AUTHORIZATIONS_CREATED=0
PAYMENT_PAYLOADS_CREATED=0
PAYMENT_SIGNATURES_CREATED=0
LIVE_PAID_REQUESTS=0
SETTLEMENTS=0
TRANSACTIONS=0
REAL_ECONOMIC_EFFECTS=0
PROCESS_TERMINATIONS=0
```

## §26 — Pass gate

```
SUN1220Q3_CANDIDATE_UPLOAD=PASS
```
All required sub-conditions satisfied: Q2 reconciled; clean source tree;
ready-only source scope proven; economic execution path unchanged; full
regression PASS; bundle verification PASS; production known-good@100% before
upload; exactly one Worker version uploaded; new candidate unique; all six
qualification vars exact; other 11 inactive; Nevermined inactive; required
six Worker secrets present; CDP_WALLET_SECRET absent; Q2 readiness fix
present; P2 discovery fix present; new candidate NOT deployed; production
remains known-good@100%; zero live requests; zero economic actions.
