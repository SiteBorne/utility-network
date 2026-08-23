# SUN-1211 Checkpoint Q — 1% Public Canary

## Summary

This checkpoint continued an already-running SUN-1211 release checkpoint that
was interrupted mid-execution by an AI usage limit in a prior (non-Claude Code)
session, at an ambiguous boundary: a Cloudflare `Create Token` action had been
submitted but its outcome was unknown. This continuation began with strict
read-only reconciliation of that ambiguous boundary before any further mutation,
independently re-verified the repository and Cloudflare state inherited from the
prior session's checkpoints (SUN-1206 through SUN-1210), resolved the
token-creation ambiguity, executed a bounded 1% public canary of the frozen
runtime candidate, observed it against explicit safety thresholds, restored
known-good to 100%, and revoked the temporary credential used.

```
PUBLIC_CANARY_GATE = PASS
PROMOTION_AUTHORIZATION_ELIGIBLE = YES
```

This does **not** authorize 100% promotion, paid-route activation, or any
further deployment. SUN-1212 (100% runtime promotion, paid routes still
disabled) was not performed and is not authorized by this report.

## 1. Reconciliation of the interrupted boundary

Before any new mutation, the reported interrupted state was independently
verified rather than assumed:

- **Repository history**: all 8 claimed commits (SUN-1206 through SUN-1210 P4)
  were confirmed to exist on `main`'s linear ancestry in the claimed order, via
  `git rev-parse` and `git log --oneline`. All 8 claimed report files were
  confirmed to exist with content matching every claimed field value exactly
  (`FINAL_ACTIVE_DEPLOYMENT_ID`, `FINAL_PRODUCTION_VERSION`,
  `RUNTIME_BUNDLE_SHA256`, `CANDIDATE_CLOUDFLARE_VERSION_ID`, and others).
  `HEAD=13c5130`, working tree clean at the start of this continuation — matched
  the claimed starting state exactly.
- **Live Cloudflare state** (via an already-authenticated `wrangler` OAuth
  session, independent of any narrated history): `wrangler deployments status`
  confirmed production was serving known-good
  (`a4ada936-a434-4522-a8af-41c57170f4e4`) at 100%, with the candidate
  (`f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce`) not present in the active deployment.
  `GET /health`, `GET /ready`, `GET /mcp`, and all 12 paid routes returned the
  expected codes. `pnpm production:preflight` passed.
- **Route-behavior discrepancy, resolved by Git comparison, not assumption**: an
  initial concern that the candidate's live `404` behavior on paid routes might
  reflect stale evidence versus a "later refactor" visible at current `HEAD` was
  resolved by a direct `git diff` between the frozen candidate commit
  (`e5d061e2e9c908244f807cf0cf141ab308575496`) and current `HEAD`
  (`13c51304818111f5ffab60ae89dfec0e89add929`) for `production-paid-services.ts`
  and `index.ts` — the diff was empty. The `503` fail-closed path
  (`productionServiceExecutorUnavailable`) was already present at
  candidate-freeze time; live `404` is the flag-absent branch, not evidence of
  drift.
  ```
  RUNTIME_SOURCE_DIFF_SINCE_FROZEN_CANDIDATE = NO
  REPO_DEPLOYED_ROUTE_DIVERGENCE = NO
  ```
- **A methodological error, caught and corrected before proceeding**: an early
  check used the `Cloudflare-Workers-Version-Overrides` header against paid
  routes while the candidate was not part of the active deployment. That
  override is inapplicable outside an active deployment; those 3 requests were
  actually served by the known-good path, not independent candidate evidence.
  Reclassified accordingly; not repeated. SUN-1210 P4 remained the authoritative
  real candidate-specific evidence for that question.
- **API token inventory**: the account's User API Tokens page (inspected via a
  human-authenticated Safari dashboard session, read-only, no
  Create/Edit/Roll/Delete clicked) showed exactly one pre-existing token
  (`siteborneutility`, left untouched) and **no** token matching `SUN-1211`,
  `SUN-1210 P3`, or `Observability Attribution` — resolving the original
  ambiguity definitively:
  ```
  SUN1211_TOKEN_PRESENT (pre-existing) = NO
  ```

## 2. Temporary Observability token

A new least-privilege, user-owned Custom API Token was created by the human
operator (this agent has no click capability on the operator's real Safari
session — grant tier is screenshot-only), per the following policy, which was
reviewed before creation:

```
Token type:        user-owned Custom API Token
Account scope:      SITEBORNE Cloudflare account only
Permission:         Workers Observability Write (Workers Observability:Edit)
Additional perms:    none
Zone permissions:    none
Client IP filter:    none
```

**Deviation from the original TTL policy, explicitly acknowledged and accepted
by the operator**: the token was created with **no expiration** (`TTL=none`),
rather than the "short-lived" TTL the checkpoint originally specified. This was
flagged directly to the operator before use; the operator explicitly chose to
proceed on the basis that unconditional deletion at the end of this checkpoint
(§28/this report §7) still bounds the credential's effective lifetime in
practice. This is recorded here as a deliberate, called-out deviation, not a
silent gap.

```
TOKEN_TYPE_VERIFIED = Custom API Token, Workers Observability Write only
TOKEN_ACCOUNT_SCOPE_VERIFIED = SITEBORNE account only
TOKEN_TTL = none (deviation, operator-accepted)
SUN1211_OBSERVABILITY_TOKEN_CREATED = 1
```

### Secure handoff

The token value was never seen by this agent via screenshot, clipboard, or chat
— all of which would have entered the agent's own transcript. It was transferred
via a mode-600, single-read local file (`.sun1211_token.secret`, in the shared
project directory) that the operator wrote to directly in their own terminal; a
script read it exactly once into a shell variable, used it only as `curl -K -`
stdin config (never as a visible argv, avoiding `ps` exposure), and deleted the
file immediately after reading, before making any network call. The token value
never appeared in any tool output, log, or file this agent produced. (An initial
attempt used a FIFO for the same purpose; it failed because the FIFO lived in a
sandbox path not reachable from the operator's real terminal — diagnosed and
replaced with the shared-project-directory file approach, which worked.)

### Verification against the two Observability endpoints

```
POST /accounts/{account_id}/workers/observability/telemetry/keys
  -> HTTP 200, real key list returned (106+ keys)
POST /accounts/{account_id}/workers/observability/telemetry/query
  -> HTTP 200 (clean, on a correctly-shaped query body)
```

```
OBSERVABILITY_KEYS_AUTHORIZED = YES
OBSERVABILITY_QUERY_AUTHORIZED = YES
```

No saved queries, shared queries, destinations, live-tail configuration, or
Worker Observability configuration were created — only the two read operations
above were exercised, plus `wrangler tail` (using the pre-existing `wrangler`
OAuth session, not the new token) for attribution evidence in §3/§5, matching
the pattern used in SUN-1210 P3/P4.

## 3. Precanary attribution calibration

One ordinary `GET /health` (no version override):

```
HTTP status:  200
cf-ray:       a2f60045abf9157d
service:      siteborne-utility-edge
scriptVersion.id: a4ada936-a434-4522-a8af-41c57170f4e4
outcome:      ok
```

```
SUN1211_PRECANARY_ATTRIBUTION = PASS
```

## 4. Precanary production reconciliation

Immediately before Deployment A:

```
CURRENT_PRODUCTION_VERSION       = a4ada936-a434-4522-a8af-41c57170f4e4
CURRENT_PRODUCTION_TRAFFIC       = 100%
CANDIDATE_IN_ACTIVE_DEPLOYMENT   = NO
CANDIDATE_TRAFFIC                = 0%
previews_enabled                 = false
CANDIDATE_IDENTITY_DRIFT         = NONE

GET /health   = 200
GET /ready    = 200
GET /mcp      = 405
12 paid routes = 12/12 HTTP 404

PRECANARY_PRODUCTION_PREFLIGHT = PASS  (pnpm production:preflight)
```

`wrangler versions deploy --help` was checked to confirm current pinned syntax
before use; a `--dry-run` of the intended 99/1 split was run first and confirmed
the exact intended composition (candidate correctly tagged
`SUN-1209 frozen candidate e5d061e2`).

## 5. Deployment A — 1% public canary

The non-dry-run `wrangler versions deploy` command was blocked by Claude Code's
own Bash permission auto-classifier (a harness-level guardrail independent of
operator chat authorization); this agent did not attempt to route around it. The
operator ran the exact, previously-dry-run-verified command directly in their
own terminal.

```bash
wrangler versions deploy \
  a4ada936-a434-4522-a8af-41c57170f4e4@99 \
  f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce@1 \
  --name siteborne-utility-edge \
  --message "SUN-1211 bounded 1% public canary" \
  -y
```

Immediate read-back:

```
CANARY_DEPLOYMENT_CREATED_AT = 2026-08-23T00:35:53.334Z
known-good  99%  a4ada936-a434-4522-a8af-41c57170f4e4
candidate    1%  f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce

CANARY_PERCENTAGES_VERIFIED = YES
MAX_NORMAL_CANDIDATE_TRAFFIC_PERCENT = 1
```

## 6. Observation window

A `wrangler tail --format json` capture was started against the live Worker, and
bounded synthetic traffic (`GET /health`/`GET /ready` alternating, no version
override, 1 request/second, capped at 900 requests / 15 minutes) was generated
in parallel. A continuous background safety monitor watched the tail stream in
real time for non-`ok` outcomes, exceptions, or payment/settlement/fixture
markers throughout the window (no alert fired). A separate wait condition polled
for the minimum 5-minute floor plus ≥5 candidate and ≥5 known-good samples.

```
Threshold met at elapsed=301s (just past the 5-minute floor)
NORMAL_PERCENTAGE_ROUTED_CANDIDATE_SAMPLES = 7 (later 8 at final capture stop)
KNOWN_GOOD_SAME_WINDOW_SAMPLES = 316 (333 at final capture stop)
```

Synthetic traffic generation was stopped immediately once the threshold was met
(well under the 900-request/15-minute cap).

### Full window telemetry inspection (§21)

Across all 341 captured events (8 candidate, 333 known-good, 0 other version):

```
CANDIDATE outcomes    = {ok: 8}         (100%)
KNOWNGOOD outcomes    = {ok: 333}       (100%)
CANDIDATE exceptions  = 0
KNOWNGOOD exceptions  = 0
CANDIDATE HTTP status = {200: 8}
ALL HTTP statuses     = {200: 339, 405: 2}   (405s are GET /mcp, expected)

CANDIDATE_UNHANDLED_EXCEPTIONS = 0
CANDIDATE_TELEMETRY_ERRORS = 0
CANDIDATE_REQUEST_RUNTIME_EVAL_FAILURES = 0
CANDIDATE_PAYMENT_EVENTS = 0
CANDIDATE_SETTLEMENT_EVENTS = 0
CANDIDATE_LIVE_PROVIDER_EVENTS = 0
CANDIDATE_FIXTURE_MARKERS = 0
```

An initial automated scan flagged a substring match for `"402"` inside 26
known-good events; this was investigated field-by-field before being treated as
anything, and traced precisely to a TLS handshake hash
(`event.request.cf.tlsExportedAuthenticator.clientHandshake`) — a false positive
from naive whole-blob substring search, not a real HTTP status. A corrected,
field-scoped re-check (`event.response.status`, `outcome`, `exceptions`, log
message text only) confirmed zero genuine danger signals. This is recorded here
for transparency rather than silently discarded.

```
CANARY_CANDIDATE_HEALTH = PASS
CANARY_CANDIDATE_READINESS = PASS (4 candidate /ready samples observed, all HTTP 200, no candidate-routed /ready payload inspected beyond status — P4 already proved the payload content directly)
```

### Paid routes and MCP during the window (§19/§20)

```
representative paid routes (v1 CDP / v2 CDP / v2 Nevermined) = 404/404/404
GET /mcp = 405
POST /mcp unknown method = 400 (not an unexpected execution)

CANARY_MCP_EXPOSURE_REGRESSION = NO
PAYMENT_SIGNATURES = 0
SETTLEMENTS = 0
LIVE_PROVIDER_CALLS = 0
```

### Performance (§23)

```
Candidate:   CPU median 8.5ms / max 11ms   |  wall median 9.0ms / max 12ms
Known-good:  CPU median 0ms   / max 12ms   |  wall median 1ms  / max 12ms

CANARY_PERFORMANCE = PASS
```

(No statistical significance is claimed from an 8-sample candidate window; this
is a sanity check against the emergency thresholds — CPU >100ms or wall >1000ms
— not a formal SLO comparison. Nothing in either version approaches those
thresholds.)

## 7. Deployment B — mandatory restoration

Executed regardless of the clean pass, per the standing checkpoint rule.
`--dry-run` confirmed the intended restoration first; the operator then ran the
real command directly (again blocked from direct agent execution by the same
Bash permission classifier):

```bash
wrangler versions deploy \
  a4ada936-a434-4522-a8af-41c57170f4e4@100 \
  --name siteborne-utility-edge \
  --message "SUN-1211 restore known-good after 1% canary" \
  -y
```

```
RESTORATION_CREATED_AT = 2026-08-23T00:54:28.041Z
ACTIVE VERSION = a4ada936-a434-4522-a8af-41c57170f4e4
TRAFFIC = 100%
CANDIDATE_IN_ACTIVE_DEPLOYMENT = NO
CANDIDATE_TRAFFIC = 0
```

### Post-restoration attribution

One ordinary `GET /health`:

```
cf-ray: a2f62652ff6e70fe
service: siteborne-utility-edge
scriptVersion.id: a4ada936-a434-4522-a8af-41c57170f4e4
outcome: ok

POST_CANARY_RESTORATION_ATTRIBUTION = PASS
CANDIDATE_NORMAL_ROUTING_AFTER_RESTORE = NO
```

### Final containment

```
previews_enabled = false
GET /health = 200
GET /ready  = 200
GET /mcp    = 405
12 paid routes = 12/12 HTTP 404

POST_CANARY_PRODUCTION_PREFLIGHT = PASS  (pnpm production:preflight)
```

## 8. Token revocation and credential cleanup

Only after final production containment was positively proven, the temporary
token was deleted through the authenticated Cloudflare dashboard by the human
operator (this agent again could not click Delete itself — read-tier browser
access only). Deletion was independently verified by this agent via a fresh,
read-only screenshot of the API Tokens list: only the pre-existing
`siteborneutility` token remains; the SUN-1211 temporary token is absent.

```
SUN1211_TEMP_OBSERVABILITY_TOKENS_EXPECTED = 1
SUN1211_TEMP_OBSERVABILITY_TOKENS_DELETED  = 1
```

The optional post-delete "still-memory-held token" 401/403 confirmation (§28)
was not performed: this agent never retained the token value at any point after
each single use (immediate on-disk deletion after each one-shot read), so no
memory-held copy existed to test with. This is a consequence of the secrecy
handling design, not an omission.

### Cleanup

All temporary handoff files, scripts, and tail captures were removed:
`.sun1211_token_fifo`, `.sun1211_token.secret`, `.sun1211_probe`, the tail
JSONL/err captures, the traffic-generator script/log/pid files, and the
wait-condition script. A stray leftover script (`/tmp/sun1211-q-state.mjs`,
timestamped before this continuation began, referencing the same
account/worker/candidate IDs) from the earlier interrupted session was
identified and removed as clearly in-scope. An incidental `.gitignore` edit made
mid-cleanup (adding the now-removed FIFO path) was reverted with
`git checkout -- .gitignore`, since no runtime/config changes are authorized by
this checkpoint.

```
TEMP_CANARY_ARTIFACTS_REMOVED = YES
TEMP_OBSERVABILITY_CREDENTIAL_EXPOSURE = CLOSED
```

## 9. Mutation accounting

```
CLOUDFLARE_API_TOKENS_CREATED = 1
CLOUDFLARE_API_TOKENS_DELETED = 1

VERSION_UPLOADS = 0
WORKER_VERSIONS_CREATED = 0
WORKER_SECRET_CHANGES = 0

DEPLOYMENTS = 2
  DEPLOYMENT_A: known-good 99% / candidate 1%
  DEPLOYMENT_B: known-good 100% / candidate removed

MAX_NORMAL_CANDIDATE_TRAFFIC_PERCENT = 1

PREVIEW_CONFIG_CHANGES = 0
PAID_ROUTE_CHANGES = 0
BINDING_CHANGES = 0
PRODUCTION_MIGRATIONS = 0

PRODUCTION_D1_WRITES = 0
PRODUCTION_KV_WRITES = 0
PRODUCTION_R2_WRITES = 0
PRODUCTION_QUEUE_WRITES = 0

PAYMENT_SIGNATURES = 0
SETTLEMENTS = 0
TRANSACTIONS = 0
REAL_NEVERMINED_ECONOMIC_EFFECTS = 0
LIVE_PROVIDER_CALLS_PERFORMED = 0

CANARY_WINDOW_SECONDS = 301
SYNTHETIC_NORMAL_REQUESTS = ~323 (bounded generator, stopped early once threshold met; well under the 900 cap)
NORMAL_CANDIDATE_SAMPLES = 8
NORMAL_KNOWN_GOOD_SAMPLES = 333
ORGANIC_CANDIDATE_INVOCATIONS = 0 (all candidate samples came from the authorized synthetic /health, /ready generator; no organic public traffic was observed hitting candidate in this window)
OBSERVABILITY_QUERIES = 3 (1 verify, 1 keys, 1 query — all via the temporary token; plus 2 wrangler tail sessions via the pre-existing OAuth session, not the temporary token)
```

## 10. Deviations and notable findings, called out honestly

1. **Token TTL deviation**: the created token had no expiration, contrary to the
   original "short-lived" policy. Flagged to and explicitly accepted by the
   operator before use (§2). Mitigated by unconditional deletion at the end of
   this checkpoint, independently verified (§8).
2. **Route-behavior discrepancy**, initially misdiagnosed by this agent as a
   "later refactor," corrected via direct Git comparison to show no source drift
   since the frozen candidate (§1).
3. **Version-override misuse**, initially treated as fresh candidate evidence
   when the candidate was not in the active deployment (so the override was
   inapplicable); corrected and reclassified before use in any gating decision
   (§1).
4. **False-positive danger marker** (`"402"` substring inside a TLS handshake
   hash) during window analysis, investigated and disproven before being treated
   as a rollback trigger (§6).
5. **Query-endpoint schema**: the Observability `telemetry/query` REST
   endpoint's exact body schema was not documented anywhere in this repository;
   the first attempt (empty parameters) returned a schema-valid `200` with zero
   matched events (likely a degenerate aggregation query, not a raw-event
   lookup) rather than the specific ray-match this agent hoped to demonstrate.
   `wrangler tail` was used instead for the actual attribution proofs (§3/§7),
   which is the same mechanism the inherited SUN-1210 P checkpoint used. The two
   Observability API endpoints were still independently proven authorized per
   §8's literal requirement (clean `200` on both).
6. **Direct deployment execution was blocked** at the Bash tool permission layer
   for both `wrangler versions deploy` invocations; the operator ran both
   commands themselves after this agent verified them via `--dry-run` first.

## 11. Human promotion authorization packet

```
RUNTIME_CANDIDATE_SHA        = e5d061e2e9c908244f807cf0cf141ab308575496
RUNTIME_BUNDLE_SHA256        = 5d969493edd11f4127643ae5af3adc961f2ffce15a97a726b9c98524ca10844b
CANDIDATE_CLOUDFLARE_VERSION_ID = f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce

PUBLIC_CANARY_PERCENT        = 1%
NORMAL_CANDIDATE_SAMPLES     = 8
CANARY_DURATION              = 301 seconds

CANDIDATE_OUTCOMES           = {ok: 8} (100%)
CANDIDATE_ERRORS             = 0
CANDIDATE_EXCEPTIONS         = 0
CANDIDATE_CPU                = median 8.5ms / max 11ms
CANDIDATE_WALL                = median 9.0ms / max 12ms

KNOWN_GOOD_SAME_WINDOW_COMPARISON = 333 samples, {ok: 333} (100%), CPU median 0ms/max 12ms, wall median 1ms/max 12ms

PAYMENT_SIGNATURES = 0
SETTLEMENTS = 0
TRANSACTIONS = 0
LIVE_PROVIDER_CALLS = 0

FINAL_PRODUCTION_VERSION     = a4ada936-a434-4522-a8af-41c57170f4e4
FINAL_DEPLOYMENT_CREATED_AT  = 2026-08-23T00:54:28.041Z
FINAL_PRODUCTION_TRAFFIC     = 100%

CANDIDATE_IN_ACTIVE_DEPLOYMENT = NO
CANDIDATE_TRAFFIC              = 0
CANDIDATE_PREVIEW_ROUTABLE     = NO

POST_CANARY_PREFLIGHT          = PASS
OBSERVABILITY_CREDENTIAL_CLEANUP = CLOSED (token deleted, independently verified; token TTL deviation noted above)

R0_BLOCKERS      = NONE
EXTERNAL_BLOCKERS = NONE newly introduced by this checkpoint
R1_RELEASE_RISKS = small candidate sample size (8 requests) inherent to a bounded 1% canary over a ~5-minute window; not a blocker, consistent with the checkpoint's own stated minimum-sample bar

PROMOTION_AUTHORIZATION_ELIGIBLE = YES
```

This packet establishes eligibility for a **separately authorized** SUN-1212
checkpoint (100% runtime promotion, paid routes remaining disabled). It does not
itself authorize promotion, paid-route activation, economic enablement, or
provider settlement — none of which were performed or are authorized by this
report.

## 12. Final classification

```
PUBLIC_CANARY_GATE = PASS
PROMOTION_AUTHORIZATION_ELIGIBLE = YES
```
