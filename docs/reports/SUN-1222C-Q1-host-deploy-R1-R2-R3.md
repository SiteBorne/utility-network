# SUN-1222C-Q1-HOST-DEPLOY — Workflow execution-plane correction (R1+R2+R3 to the dedicated host)

## Result: PASS

## 0. Authoritative failure this checkpoint corrects

Payment `pay_a3bde18f5a714dbf9f94dd2a40c695bc` (Workflow instance
`siteborne-wf-da36ceea4d675abe647503a67fe3b4b10326e3158ce4557c`) verified
payment but was rejected with `PolicyBlockedError` /
`resultClass='policy_blocked'` — *"sec-edgar company_submissions returned
policy_blocked for CIK 0000320193"*. `cdp_facilitator_settle_attempt_count=0`.
Zero economic effect (buyer 79727, seller 28000 atomic, both unchanged,
dual-RPC confirmed). That payment material is retired and not reused here.

## 1. Authorization gate

`HOST_DEPLOY_AUTHORIZATION=PRESENT` (SUN-1222C-Q1-HOST-DEPLOY, this message).

## 2. Execution-plane proof (call-site level, not merely import-graph level)

`grep -rn "\.executor\b" apps/edge-api/src` (non-test) finds exactly one
*invocation*: `deps.executor(decrypted.executorInput, ...)` at
`paid-continuation-workflow.ts:709`, inside `runPaidContinuationWorkflow`.
Every other hit (`production-dependencies.ts:391`, `paid-services.ts:262`)
is an assignment into a config object, never a call.

`paid-continuation-workflow.ts` is exported by
`apps/edge-api/src/workflow-host-entrypoint.ts` — the `main` of
`wrangler.paid-continuation-runtime.toml` (`name =
"siteborne-paid-continuation-runtime"`), a physically separate Cloudflare
Worker script from the public API (`siteborne-utility-edge`).

The public route (`production-company-evidence-v2-cdp-route.ts`) also
constructs `config.executor` via the same
`buildCompanyEvidenceGraphV2CdpProductionRouteConfig`, but
`grep -n "config\.executor" x402-service.ts` finds only a comment, never a
call — that reference is dead on the public side; the shared route handler
only ever hands off to `config.workflow` (`env.PAID_CONTINUATION_WORKFLOW`),
never invokes the executor in-process.

`SecSubmissionsAdapter` (`packages/provider-adapters/src/sec/
submissions-adapter.ts`) is what `production-dependencies.ts` builds into
`deps.executor` for `company_evidence_graph.v2`; `globalTermsGuard` is
imported and called only inside that adapter's own `execute()`.

```
SEC_ADAPTER_EXECUTION_SCRIPT=apps/edge-api/src/workflow-host-entrypoint.ts (siteborne-paid-continuation-runtime)
TERMS_GUARD_EXECUTION_SCRIPT=apps/edge-api/src/workflow-host-entrypoint.ts (siteborne-paid-continuation-runtime)
COMPANY_V2_EXECUTION_SCRIPT=apps/edge-api/src/workflow-host-entrypoint.ts (siteborne-paid-continuation-runtime)
WORKFLOW_EXECUTION_PLANE_PROVEN=YES
```

## 3. Pre-deploy host version (authoritative, not transcript)

`wrangler deployments list --config wrangler.paid-continuation-runtime.toml`:

```
PRE_DEPLOY_HOST_VERSION_ID=f17acb0c-6400-47f7-a203-5c97b44dcb9d
PRE_DEPLOY_HOST_CREATED_AT=2026-09-03T17:17:55.856Z
```

Traced to its origin: deployed by SUN-1222D-R2-credential-configuration
(Modal docworker secret injection), which itself deployed straight from
that day's HEAD — i.e. after H2BF5-R1's fail-closed entrypoint fix, but
three days before any SEC-EDGAR-specific R1/R2/R3 commit existed.

## 4. Fix chronology

```
R1_COMMIT=3cbee0e (2026-09-06T02:11:20-05:00)
R2_COMMIT=4f54351 (HTTP status fix, 2026-09-06T02:57:56-05:00) + ce91ea9 (rate coordinator, 2026-09-06T03:16:08-05:00)
R3_COMMIT=aa2080e (2026-09-06T05:50:02-05:00)
R1_POSTDATES_HOST=YES
R2_POSTDATES_HOST=YES
R3_POSTDATES_HOST=YES
```

## 5. Exact semantic content

- **R1** — `SecSubmissionsAdapter` sends `User-Agent: SITEBORNE
  hello@siteborne.com` on every real request; `buildSubmissionsUrl`
  validates the CIK (exact 10 digits) before any URL is constructed,
  rejecting path-traversal/query/fragment/host-confusion/NUL/non-ASCII
  inputs.
- **R2** — `SecureHttpClient` classifies terminal non-2xx statuses via the
  existing `AdapterError` taxonomy (429→`RateLimitedError`,
  401/403/other-4xx→`PermanentFailureError`, 404→`NotFoundError`,
  5xx→`RetryableFailureError`, 304→explicit pass-through) instead of
  parsing every response body as success. `SecSubmissionsAdapter` now
  requires (and calls, on every attempt including retries) an injected
  `RateCoordinator`; production wires `SecD1RateCoordinator`, a D1-backed
  sliding-window log capping aggregate SEC EDGAR request-starts at 8/s
  (proven under real SQLite concurrency up to 100 simultaneous callers).
- **R3** — `sec-edgar` `TermsReview` (hash
  `sha256:7838e8bc7db0ceeed1dc9201204e942dbb5108ff0b5029686e9f00f6265aa62`)
  registered in `globalTermsGuard`, removing the unconditional
  `PolicyBlockedError` that fired for every `sec-edgar` access attempt
  regardless of CIK.

## 6. Proposed host bundle proof (dry-run, before spending the real deploy)

`wrangler deploy --config wrangler.paid-continuation-runtime.toml --dry-run
--outdir /tmp/host-dry-run-bundle` — clean build (only the pre-existing
benign `unenv`/`whatwg-url` warnings), bindings exactly as expected (`DB`,
`ARTIFACTS`, `PAID_CONTINUATION_WORKFLOW`, 4 vars, no secrets listed by a
dry-run as expected). Grepped the emitted bundle:

```
"SITEBORNE hello@siteborne.com"                    -> 2 hits
tryAcquire|SecD1RateCoordinator|provider_rate_window -> 15 hits
sec-edgar|<terms-review hash>                       -> 6 hits
classifyTerminalHttpStatus|RateLimitedError          -> 12 hits

PROPOSED_HOST_HAS_R1=YES
PROPOSED_HOST_HAS_R2=YES
PROPOSED_HOST_HAS_R3=YES
SEC_EDGAR_REVIEW_REGISTERED_IN_HOST_BUNDLE=YES
```

## 7-9. Regression

Ran in parallel first (7 heavy processes at once); 2 failures surfaced,
both re-verified to be resource contention, not regressions, by re-running
each file alone immediately after:

- `sec-rate-window.test.ts` "sustained load" burst-timing test — failed
  under parallel load, **passed 16/16 in isolation** (532ms/1059ms for the
  50/100-concurrent cases, well within budget with no contention).
- `html-worker-runtime.test.ts` "initializes HTMLRewriter... local
  Miniflare" — timed out under parallel load (cold Miniflare start
  starved of CPU), **passed 5/5 in isolation**.

```
HOST_TERMS_GUARD_REGRESSION=PASS (termsguard-tri-state.test.ts 23/23,
  sec-edgar-terms-review-local-validation.test.ts 7/7,
  sec-edgar-terms-review-gap.test.ts 6/6)
HOST_PRODUCTION_COMPOSITION_SEC_POLICY=PASS
  (company-evidence-graph-v2-production-executor.test.ts,
  company-evidence-graph-v2-cdp-composition.test.ts both pass; SEC
  TermsGuard no longer the blocking condition in the composed production
  path)
TESTS=PASS (provider-adapters 374/374 incl. the isolated re-run;
  edge-api workflows/rate-limit/company-evidence-v2 40/40 incl. the
  isolated re-run)
WORKER_RUNTIME=PASS (99/99, incl. dedicated-host bundle isolation)
TYPECHECK=PASS
LINT=PASS
BUILD=PASS
PRODUCTION_PREFLIGHT=PASS
SECRETS_SCAN=2 pre-existing findings (identical fingerprints to R2's
  documentation — both self-referential quotations of the same known
  Worker-version-UUID false positive already spun off as task_1f6eb5a9),
  0 new
HOST_CONFIG_PREDEPLOY=PASS
```

## 10. Pre-deploy config readback

`wrangler secret list` (host): 11 names present — the 8 H2BF5-FINAL-required
secrets (`PAYMENT_CONTINUATION_ENCRYPTION_KEY`,
`PAID_RECEIPT_SIGNING_PRIVATE_KEY`, `PAID_RECEIPT_SIGNING_KEY_ID`,
`MODAL_WEBCTX_ENDPOINT_URL/PROXY_KEY/PROXY_SECRET`, `CDP_API_KEY_ID`,
`CDP_API_KEY_SECRET`) plus the 3 `MODAL_DOCWORKER_*` secrets added by
SUN-1222D-R2 for `document_evidence_json.v2`. `CDP_WALLET_SECRET` absent.
4 ADR-0055 vars present with exact values (`PAYMENT_ENVIRONMENT=production`,
`PRODUCTION_ENABLED=true`, `HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP=true`,
`PRODUCTION_CDP_CREDENTIALS_APPROVED=true`). No configuration change was
required — deploy proceeds code-only.

## 11. Public API containment (pre-deploy)

```
PUBLIC_API_CURRENT_VERSION=db7054c9-76ee-4830-aabe-8a4542261b6a
PUBLIC_API_TRAFFIC=100%
PUBLIC_API_MUTATION_REQUIRED=NO
```

## 12. Deployment

`wrangler deploy --config wrangler.paid-continuation-runtime.toml` (no
`--secrets-file` — code/bindings/vars only, no secret touched). Clean
upload (4728.34 KiB / gzip 772.13 KiB, 81ms startup), bindings identical to
the dry-run.

```
HOST_DEPLOYMENTS=1
NEW_HOST_VERSION_ID=917c1c49-16fd-4c4d-b9d6-e54ad6f9ec80
NEW_HOST_DEPLOY_TIMESTAMP=2026-09-07T17:53:02.657Z
```

## 13. Postdeploy authoritative readback

`wrangler deployments list` (host): `917c1c49...` now the sole active
version at 100%. `wrangler secret list` (host, post-deploy): identical 11
names, `CDP_WALLET_SECRET` still absent. `wrangler deployments list`
(public API): unchanged — `db7054c9` @ 100%, `a064477f` @ 0%.

```
HOST_DEPLOY_READBACK=PASS
```

## 14. Postdeploy bundle/version correlation

Deployed straight from the same clean working tree the dry-run bundle was
built from (`git status --porcelain` empty before and after; HEAD unchanged
across dry-run → deploy) — the fingerprint proof in §6 applies unchanged to
the actually-deployed bundle.

```
DEPLOYED_HOST_SOURCE_HEAD=7d79b556045e4a6f726670f580cdd97aea15577a
DEPLOYED_HOST_CONTAINS_R1=YES
DEPLOYED_HOST_CONTAINS_R2=YES
DEPLOYED_HOST_CONTAINS_R3=YES
```

## 15. Non-economic runtime proof

This checkpoint's own authorization grants read-only preflight, execution-
plane tracing, chronology/content proof, the host deployment itself, and
post-deploy readback — it does **not** explicitly authorize creating a new
`siteborne-paid-continuation` Workflow instance (safe-envelope or
otherwise), unlike H2BF5-FINAL's authorization, which explicitly named that
action. Per this checkpoint's own §15 fallback clause, no instance was
invented beyond what was granted:

```
NON_ECONOMIC_RUNTIME_PROOF=UNAVAILABLE_BY_DESIGN
```

Bundle fingerprinting (§6/§14), full regression (§7-9), and the identical
pre/post config readback (§10/§13) stand in its place.

## 16. Economic zero-effect confirmation

```
REAL_402_REQUESTS=0
PAYMENT_AUTHORIZATIONS_CREATED=0
SIGNING_ACTIONS=0
PAID_POSTS=0
FACILITATOR_VERIFY_CALLS=0
FACILITATOR_SETTLE_CALLS=0
SETTLEMENT_ATTEMPTS=0
NEW_USDC_TRANSFERS=0
```

No wallet balance re-read was needed — no action taken this checkpoint
could plausibly touch it (host redeploy only; no request, no signer, no
facilitator call).

## 17. Q1 retry eligibility

Execution-plane ownership proven, old host proven stale, all three fixes
proven present in the new host by both static bundle inspection and
identical source-HEAD correlation, deployment readback clean, TermsGuard
and production-composition regressions pass, zero config drift, zero
economic action.

```
Q1_FRESH_PAYMENT_RETRY_ELIGIBLE=YES
```

## 18. No retry performed

No 402, no EIP-3009, no signing, no paid POST, no settlement attempted or
prepared this checkpoint.

## Final packet

```
SUN1222C_Q1_HOST_DEPLOY=PASS
HOST_DEPLOY_AUTHORIZATION=PRESENT
SEC_ADAPTER_EXECUTION_SCRIPT=apps/edge-api/src/workflow-host-entrypoint.ts (siteborne-paid-continuation-runtime)
TERMS_GUARD_EXECUTION_SCRIPT=apps/edge-api/src/workflow-host-entrypoint.ts (siteborne-paid-continuation-runtime)
COMPANY_V2_EXECUTION_SCRIPT=apps/edge-api/src/workflow-host-entrypoint.ts (siteborne-paid-continuation-runtime)
WORKFLOW_EXECUTION_PLANE_PROVEN=YES
PRE_DEPLOY_HOST_VERSION_ID=f17acb0c-6400-47f7-a203-5c97b44dcb9d
PRE_DEPLOY_HOST_CREATED_AT=2026-09-03T17:17:55.856Z
R1_COMMIT=3cbee0e
R2_COMMIT=4f54351,ce91ea9
R3_COMMIT=aa2080e
R1_POSTDATES_HOST=YES
R2_POSTDATES_HOST=YES
R3_POSTDATES_HOST=YES
PROPOSED_HOST_HAS_R1=YES
PROPOSED_HOST_HAS_R2=YES
PROPOSED_HOST_HAS_R3=YES
SEC_EDGAR_REVIEW_REGISTERED_IN_HOST_BUNDLE=YES
HOST_TERMS_GUARD_REGRESSION=PASS
HOST_PRODUCTION_COMPOSITION_SEC_POLICY=PASS
TESTS=PASS
WORKER_RUNTIME=PASS
TYPECHECK=PASS
LINT=PASS
BUILD=PASS
PRODUCTION_PREFLIGHT=PASS
SECRETS_SCAN=2 pre-existing findings, 0 new
HOST_CONFIG_PREDEPLOY=PASS
PUBLIC_API_MUTATION_REQUIRED=NO
HOST_DEPLOYMENTS=1
NEW_HOST_VERSION_ID=917c1c49-16fd-4c4d-b9d6-e54ad6f9ec80
HOST_DEPLOY_READBACK=PASS
DEPLOYED_HOST_CONTAINS_R1=YES
DEPLOYED_HOST_CONTAINS_R2=YES
DEPLOYED_HOST_CONTAINS_R3=YES
NON_ECONOMIC_RUNTIME_PROOF=UNAVAILABLE_BY_DESIGN
REAL_402_REQUESTS=0
PAYMENT_AUTHORIZATIONS_CREATED=0
SIGNING_ACTIONS=0
PAID_POSTS=0
FACILITATOR_SETTLE_CALLS=0
SETTLEMENT_ATTEMPTS=0
NEW_USDC_TRANSFERS=0
Q1_FRESH_PAYMENT_RETRY_ELIGIBLE=YES
EVIDENCE_COMMIT_SHA=<this commit>
NEXT_REQUIRED_CHECKPOINT=SUN-1222C-Q1-FRESH-PAID-QUALIFICATION
```

Then STOP. No Q1 retry performed this checkpoint.
