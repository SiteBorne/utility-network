# SUN-1222C-R4-D14 — Settlement Alert Production Activation

## Status: PASS

## Authorization

`SUN1222C_R4_D14_AUTHORIZATION=GRANTED`
`D14_PRODUCTION_DEPLOYMENT_AUTHORIZATION=GRANTED_WITHIN_D14_BOUNDS`
`D14_WEBHOOK_SECRET_PROVISIONING_AUTHORIZATION=GRANTED_FROM_SECURE_LOCAL_SOURCE_ONLY`

Resumed from corrected D13 baseline (`D14_START_HEAD=496a8ea6f00a28f772a700b283308c3941287814`),
independently re-verified live rather than trusting inherited checkpoint state.

## Pre-activation verification

- Cloudflare authentication confirmed live: `hello@siteborne.com`,
  account `29a264a25ccfd13882defe49ed3e17b1`, `workers (write)` scope present.
- `siteborne-settlement-alert`: confirmed **not present** before activation
  (Cloudflare API error 10007 — Worker does not exist).
- `siteborne-paid-continuation-runtime`: confirmed unchanged at
  `d62011b9-6219-47e1-8cf9-5006776cfb50 @ 100%` (D10 state) before and after D14.
- Public API `siteborne-utility-edge`: confirmed unchanged at
  `db7054c9-76ee-4830-aabe-8a4542261b6a @ 100%`,
  `d3472f58-f578-4a8f-992b-0d0956c9b561 @ 0%` before and after D14.
- Webhook secret validated structurally only (https scheme, non-empty
  hostname) via a script that never printed the value; delivered to this
  session through a local file (`~/.siteborne-secrets/settlement_webhook_url`,
  mode 600) rather than chat, since `export` in the operator's own terminal
  does not propagate to the assistant's separate shell session.

### Tooling note

`pnpm --filter @siteborne/edge-api test <file>` silently resolves 0 test
files in the current environment (no local `vitest.config.ts` inside
`apps/edge-api`, so Vitest's effective root becomes the filtered package's
cwd rather than the monorepo root that owns `vitest.config.ts`). The correct
invocation is `pnpm exec vitest run --config vitest.config.ts <file>` from
the repository root. Re-verified directly before relying on any test result
in this checkpoint.

## Preactivation gates (all PASS)

- Targeted regression: `settlement-alert-sweep.test.ts` (10),
  `settlement-alert-webhook-transport.test.ts` (7),
  `paid-continuation-workflow-entrypoint.test.ts` (6),
  `workflow-host-entrypoint.test.ts` (5),
  `paid-continuation-workflow.test.ts` (46) — **74/74 pass**.
- Typecheck: PASS. Build: PASS. Lint: PASS (0 errors/warnings).
- `wrangler deploy --config wrangler.settlement-alert-worker.toml --dry-run`:
  clean; single binding `env.DB (siteborne-utility)`, no other resource.
- Static zero-economic-capability audit: no `settle(`, `verify(`,
  facilitator, CDP, or chain call anywhere in
  `settlement-alert-sweep.ts`, `settlement-alert-webhook-transport.ts`,
  or `settlement-alert-worker-entrypoint.ts` (only doc-comments referencing
  their deliberate absence).
- Repo-wide settlement-owner audit: exactly one real production
  `evidenceProvider.settle()` call site
  (`paid-continuation-workflow.ts:673`, dedicated Workflow only); public API
  route (`x402-service.ts`) confirmed to never call it. Unchanged from D9/D13.

## Smoke test

One real, bounded, non-economic HTTPS POST to the configured webhook,
constructed with the actual `SettlementAlertPayload` shape and a payload
clearly marked synthetic (`payment_identifier:
"SYNTHETIC_D14_SMOKE_TEST_NOT_A_REAL_PAYMENT"`, `_note` field). Executed
directly (not via the deployed Worker's `scheduled()` handler, since
Cloudflare gives deployed — non-`dev` — Workers no remote "invoke scheduled
now" mechanism) using the same `fetch` semantics the production transport
uses (`redirect: 'manual'`, JSON body, 10s bound).

Result: `D14_SMOKE_TEST_HTTP_STATUS=200`, `D14_SMOKE_TEST=PASS`.

`REAL_WEBHOOK_CALLS=1` (this smoke test; the cron-driven production sweep
had not yet fired at report time).

## Staged activation sequence executed

1. **Worker deployment** (secret intentionally absent — D12's fail-safe path
   means this state is fully inert): `wrangler deploy --config
   wrangler.settlement-alert-worker.toml`. Result: `siteborne-settlement-alert`
   created, version `ea8d2169-1f60-4736-8df7-5390a2707658`, cron trigger
   `*/15 * * * *` active from the committed D12 configuration, single binding
   `env.DB` confirmed, no public route/`workers.dev` exposure.
2. **Secret provisioning**: `wrangler secret bulk` (not `wrangler secret
   put`, per authorization) from a JSON file written outside the repository
   (`~/.siteborne-secrets/bulk_secrets.json`, mode 600), deleted immediately
   after upload succeeded. Result: `SETTLEMENT_ALERT_WEBHOOK_URL` created
   (`secret_text`), version `8fe32c69-d906-4369-9c0a-49b2cc406e8e`.
3. **Final readback**: `wrangler secret list` confirms exactly one secret by
   name only (`SETTLEMENT_ALERT_WEBHOOK_URL`, `secret_text` — value never
   displayed). Deployment history shows exactly the two expected events
   (upload, secret change), both at 100%, single script — no traffic split
   introduced.

`NEW_WORKERS_CREATED=1` (`siteborne-settlement-alert`)
`NEW_SECRETS_CREATED=1` (`SETTLEMENT_ALERT_WEBHOOK_URL`)
`DEPLOYMENTS=1`
`CRON_TRIGGERS_CREATED=1` (`*/15 * * * *`, active as part of the single deployment)
`REAL_WEBHOOK_CALLS=1`

## Invariants held

`D14_PRODUCTION_D1_WRITES=0` — this Worker's only D1 interaction is
`listUnresolvedSettlements()`'s read; the cron had not fired by report time,
and even the write-capable D1 binding was never exercised for a write by
this checkpoint's own actions.
`D14_TOTAL_PRODUCTION_SETTLE_CALLSITES=1` — unchanged.
`ECONOMIC_EFFECT_USDC=0`.
`REAL_SETTLEMENT_ATTEMPTS=0`.
Public API and paid-continuation-runtime: unchanged, verified before and
after.

## Cleanup

Ephemeral bulk-secrets JSON deleted immediately after upload. The
operator's own local webhook-URL file
(`~/.siteborne-secrets/settlement_webhook_url`) was left in place — it is
the operator's own provisioned artifact outside the repository, not
something created by this checkpoint's automation, and was not deleted.

## Result

`SUN1222C_R4_D14_SETTLEMENT_ALERT_PRODUCTION_ACTIVATION=PASS`

`siteborne-settlement-alert` is live in production: a fourth, dedicated,
economically powerless Worker that sweeps unresolved settlements every 15
minutes and delivers operator notifications to the provisioned webhook. This
closes the D11 Class-D gap (no deployed durable alert-delivery mechanism)
identified earlier in the D4→D14 terminal-observability sequence.

D15 not auto-triggered.
