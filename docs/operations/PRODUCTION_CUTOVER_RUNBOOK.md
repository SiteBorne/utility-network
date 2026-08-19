# SITEBORNE Production Cutover Runbook

Produced by SUN-1203 checkpoint I. This is a procedural reference for the
future, separately-authorized cutover checkpoint — **no command in this document
has been executed by SUN-1203**. Steps marked **NOT AUTHORIZED IN SUN-1203** are
mutating and require explicit human authorization in a later checkpoint.

## 0. Preconditions

- All R0 blockers from the current release-readiness report
  (`docs/reports/SUN-1203-checkpoint-i-preproduction-release-readiness.md`)
  resolved, or explicitly accepted by a human as R1 risk.
- `pnpm check` and `pnpm security:release` both exit 0 on the candidate commit.
- `pnpm test:worker-runtime` green on the candidate commit.
- The transient `wrangler.toml` diff (`PAYMENT_ENVIRONMENT`,
  `PRODUCTION_ENABLED`, `PRODUCTION_CDP_CREDENTIALS_APPROVED`,
  `HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP`, `PAID_ROUTES_ENABLED`) reviewed and
  its exact content re-confirmed against the human's actual intent.

## 1. Pre-cutover git SHA

Record the exact commit SHA about to be uploaded:

```bash
git rev-parse HEAD
```

## 2. Required CI/security gates

```bash
pnpm check
pnpm security:release
```

Both must exit 0. `pnpm security:release` includes `pnpm test:worker-runtime` as
its final step (SUN-1200/1201 wiring).

## 3. Required production bindings/secrets

From `wrangler.toml` (read-only reconciliation — see the checkpoint report's
`PROVIDER_READINESS_MATRIX`/binding audit for the full list):

- `DB` (D1, `siteborne-utility`)
- `CATALOG` (KV)
- `JOBS`, `EVENTS` (Queues, producer-only)
- `AI` (Workers AI)
- `BROWSER` (Browser Rendering)
- Secrets (never printed; presence-only check): `SELLER_WALLET_ADDRESS`,
  `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, and any other secret
  `production-payment.ts`'s real gate requires.

```bash
# NOT AUTHORIZED IN SUN-1203 -- presence-only check, run by a human operator
# with real Cloudflare credentials at actual cutover time.
wrangler secret list
```

## 4. Candidate version upload command

**NOT AUTHORIZED IN SUN-1203.**

```bash
wrangler versions upload --message "<release description>"
```

This creates a new version and routes **zero** traffic to it (Cloudflare's own
documented behavior — see the `wrangler` skill's guidance already used
throughout SUN-1200 checkpoint F).

## 5. Candidate smoke-test procedure

Against the new version's preview URL only (never production traffic):

1. `GET /` → 200.
2. `GET /.well-known/agent-card.json` → 200.
3. Unsigned `POST` to each of the four v1 and four v2 CDP paid routes → 402 with
   a decodable `PAYMENT-REQUIRED` header.
4. **Do not** construct a real `PAYMENT-SIGNATURE` against this preview URL —
   see §9 below for the one, explicitly bounded economic smoke test.

## 6. How paid routes become reachable

Paid routes are gated by `env.PAID_ROUTES_ENABLED === 'true'` AND a real
`env.DB` binding (`index.ts`) — both already present in the transient
`wrangler.toml` diff. Routing traffic to the new version (§7) is what actually
exposes this to real buyers; the version upload alone (§4) does not.

## 7. How traffic percentage would change

**NOT AUTHORIZED IN SUN-1203.**

```bash
wrangler versions deploy <version-id>@<percentage>% -y
```

Per SUN-1200 checkpoint F's own precedent: start at a low percentage (or 100%
only if the team's risk tolerance and monitoring plan supports it — this
repository's own prior cutover attempts used 100% directly, given Nevermined/CDP
structural gates keep real settlement additionally gated).

## 8. Verification immediately after enablement

1. Re-run the smoke test (§5) against the **production** URL now that traffic is
   routed.
2. Confirm `wrangler deployments list` shows the new version at the intended
   percentage.
3. Confirm `wrangler tail` shows no unexpected exceptions on the first several
   real requests.

## 9. Payment/economic smoke test procedure

**NOT AUTHORIZED IN SUN-1203 — requires explicit, separate human authorization,
exactly as SUN-1200 checkpoint F's bootstrap did.** A real buyer payment is the
only way to prove real CDP settlement end-to-end; this is a deliberate, bounded,
single-transaction action, never a side effect of upload or route enablement
alone.

## 10. Observability checks

- `wrangler tail` during and immediately after cutover.
- Confirm request correlation IDs, result classes, and failure categories are
  visible per the checkpoint report's `PAYMENT_PHASE_OBSERVABLE`/
  `PROVIDER_FAILURE_OBSERVABLE` findings.
- Confirm no secret/credential/raw payload appears in logs (re-verify the
  checkpoint report's `SECRET_LOGGING_FINDINGS` before relying on this).

## 11. Rollback trigger criteria

Any of:

- Elevated 5xx rate on paid routes beyond baseline.
- A real settlement failing or behaving ambiguously (see checkpoint report's
  `RETRY_AFTER_SETTLEMENT_BEHAVIOR` for what "ambiguous" means in this
  codebase).
- Any `EvalError`/request-time dynamic-code-generation exception appearing in
  `wrangler tail` (the exact defect class SUN-1200/1201/1202 closed — its
  reappearance means a regression escaped every gate).
- Any evidence of a real economic double-charge or price mismatch.

## 12. Rollback command/process

**NOT AUTHORIZED IN SUN-1203.**

```bash
wrangler rollback
# or, to a specific known-good version explicitly:
wrangler versions deploy <known-good-version-id>@100% -y
```

Known-good version as of this checkpoint: `a4ada936-a434-4522-a8af-41c57170f4e4`
(100%, the disabled/rollback-safe version every checkpoint since SUN-1200 has
verified production remains on).

## 13. Route-disable emergency procedure

Fastest mitigation short of a full rollback: flip `PAID_ROUTES_ENABLED` to
`"false"` (or unset) in `wrangler.toml` and upload+deploy that single-line
change — `/v1/*`/`/v2/*` immediately return 404 again, exactly the structural
default this repository has maintained since SUN-0700A. Does not require
reverting any code logic, only the one environment variable.

## 14. Post-cutover reconciliation

1. Re-run the full smoke test (§5) plus one real economic transaction's
   receipt/PSL inspection (read-only D1 query, no mutation).
2. Confirm D1 state matches expectations (one `x402_service_results` row,
   correct `payment_attempts` lifecycle stage).
3. Confirm no unexpected version is serving traffic
   (`wrangler deployments list`).

## 15. Required evidence to close the deployment checkpoint

- Pre-cutover SHA (§1) and gate results (§2).
- Smoke-test evidence (§5, §8) with timestamps.
- The one authorized economic smoke-test's receipt/PSL (§9), if performed.
- Observability confirmation (§10).
- Explicit sign-off that no rollback trigger (§11) fired within the post-cutover
  observation window.
