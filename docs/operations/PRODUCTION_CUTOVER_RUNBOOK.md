# SITEBORNE Production Cutover Runbook

Reconciled through SUN-1207 M3. This is a procedural reference for a future,
separately authorized upload/cutover checkpoint. The only production
configuration mutations through M3 were the bounded M2 `NVM_API_KEY`
secret-version creation and the M3 preview-routing disable. **Every mutating
upload/deploy/payment command below remains `NOT EXECUTED`.**

The current Worker is already Internet-exposed. In particular, `/mcp` receives
unsolicited machine probes today. Enabling paid routes is therefore not the
first Internet exposure of this Worker; it is a separate economic-surface
cutover.

## 0. Preconditions

- `PREUPLOAD_RELEASE_GATE = PASS`; neither `FAIL` nor `EXTERNAL_BLOCK` is
  upload-eligible.
- `pnpm production:preflight`, `pnpm check`, and `pnpm security:release` all
  exit 0 on the exact candidate commit.
- `pnpm test:worker-runtime` is green on that commit.
- The production bundle contains no paid-service fixture executor. Until a
  complete governed production executor is separately implemented and accepted,
  all 12 paid route configurations return `503 service_executor_not_configured`
  before payment economics.
- The release manifest freezes the exact Git SHA, lockfile/config hashes,
  compatibility date, migration head, pricing/contracts, and bundle identity.
- Required Cloudflare binding and secret **names** are reconciled read-only.
- `preview_urls = false` is committed and the Worker-level Cloudflare setting
  reports `previews_enabled = false`. Versioned and aliased preview routing is a
  release-blocking invariant: undeployed versions may inherit production secrets
  and stale version-scoped configuration.
- Any later cutover variables are reviewed as a new bounded change. They are
  intentionally absent from the fail-closed SUN-1206 pre-upload candidate.

## 1. Freeze the candidate

```bash
git status --short
git rev-parse HEAD
pnpm production:preflight
pnpm check
pnpm security:release
```

The tree must be clean, and the SHA must match the release manifest.

## 2. Required production configuration

The authoritative gate is `pnpm production:preflight`, which checks the actual
live D1 dereference, committed non-secret variables, provider/config drift, and
required Cloudflare secret names. The canonical Nevermined secret name is
`NVM_API_KEY`; `NEVERMINED_API_KEY` is a deprecated alias, and differing dual
values fail closed. M2 provisioned `NVM_API_KEY` through a single non-deployed
secret-version operation. Do not recreate or overwrite it unless a separately
authorized rotation is intended.

Read-only operator checks may include:

```bash
pnpm exec wrangler secret list --config wrangler.toml
pnpm exec wrangler versions view --config wrangler.toml
pnpm exec wrangler deployments status --config wrangler.toml
```

Never retrieve, print, or persist secret values.

## 3. Upload the fail-closed candidate

**NOT EXECUTED THROUGH SUN-1207 M3. Requires a later explicit human upload
authorization after the complete pre-upload gate passes.**

```bash
pnpm exec wrangler versions upload \
  --config wrangler.toml \
  --strict \
  --message "<approved release description>"
```

This creates a Worker Version but does not change the production deployment or
its traffic percentages. `preview_urls = false` and the matching Cloudflare
Worker setting must keep its versioned and aliased preview hostnames unroutable.
Do not weaken that policy to smoke-test an undeployed version: SUN-1207 M2
proved that a secret-version operation can inherit stale activated configuration
and production secret bindings even while the current deployment remains safely
rolled back.

## 4. Undeployed-version validation

1. Record the uploaded version ID with `wrangler versions view` and confirm its
   bindings/configuration match the frozen manifest.
2. Confirm `wrangler deployments status` still assigns 100% of production
   traffic to the previously approved version.
3. Confirm the versioned preview hostname is unroutable and Cloudflare reports
   `previews_enabled = false`; do not invoke paid routes on an undeployed
   version.
4. Run all route/MCP/provider-boundary smoke scenarios in the deterministic
   real-workerd harness, not through a public preview.
5. No payment signature, entitlement, provider workload, settlement, or storage
   mutation is authorized by upload or metadata validation.

## 5. Paid-route enablement mechanism

Paid routes are compile/config-version controlled, not an independently
switchable live route. SUN-1206 removed the local fixture registry from the
production module graph and froze every paid route as unavailable before
economics. Consequently, setting variables alone cannot activate a paid service.
A later, separately reviewed implementation checkpoint must first wire a
complete governed production executor (live provider dependencies, artifact
handling, audit, clock, and paid-service Ed25519 receipt key custody) and pass
the fixture-eradication gate. Only then may an activation candidate set the
exact authorized variables and pass all provider gates. For CDP, the
load-bearing values would include:

- `PAYMENT_ENVIRONMENT = "production"`
- `PRODUCTION_ENABLED = "true"`
- `PRODUCTION_CDP_CREDENTIALS_APPROVED = "true"`
- `HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP = "true"` for the exact bounded
  authorized action only; it is never standing authority
- `PAID_ROUTES_ENABLED = "true"`

Nevermined additionally requires its own route/live guards, canonical secret,
sandbox-only classification under the current implementation, and an explicit
economic authorization checkpoint. Uploading a version alone does not deploy it
to production, and the permanent preview-disable policy must keep that
undeployed version publicly unroutable. Deploying the activated version is what
moves production traffic to those route implementations.

`/mcp` is independent of `PAID_ROUTES_ENABLED`: it is mounted unconditionally
and is already public. Its paid tools use a closed execution boundary unless a
separately wired economic boundary is provided.

## 6. Deploy a version to production traffic

**NOT EXECUTED THROUGH SUN-1207 M3. Requires explicit human traffic-shift
authorization after zero-traffic metadata and containment verification.**

```bash
pnpm exec wrangler versions deploy \
  --config wrangler.toml \
  <version-id>@<approved-percentage>% \
  --message "<approved deployment description>" \
  -y
```

Record the deployment ID, every serving version ID/percentage, and the exact
timestamp. A staged percentage is preferred unless the approved risk decision
explicitly selects 100%.

## 7. Post-deployment verification

1. Confirm `wrangler deployments status` reports the approved version mix.
2. Re-run the non-economic public/MCP smoke tests against production.
3. Confirm paid routes have exactly the expected pre-payment behavior for the
   deployed activation state.
4. Monitor `wrangler tail` for bounded errors, provider/config failures,
   correlation IDs, and accidental secret/payload logging.
5. Stop on any payment ambiguity, price mismatch, duplicate execution, or
   request-time dynamic-code-generation error.

### 7.1 Zero-percent versions and version overrides

A version assigned 0% of normal traffic is not necessarily unreachable while
it remains a member of the current deployment. Cloudflare's documented
`Cloudflare-Workers-Version-Overrides` request header can explicitly select a
current-deployment version, including one assigned 0%, on the normal production
custom domain. This mechanism does not require a preview URL or traffic-weight
change.

Treat a 0% current-deployment version as externally targetable by a caller who
knows the Worker name and version UUID. A bounded release test may use the
override only with explicit authorization, non-economic request shapes, and
authoritative request-to-version attribution (for example, matching the
response Ray ID to a Cloudflare event whose `scriptVersion.id` is the intended
version). Removing a version from the current deployment closes this override
path; merely assigning it 0% does not.

## 8. Economic smoke test

**NOT EXECUTED THROUGH SUN-1207 M3. Requires a separate, explicit, rail-specific
human authorization.** Upload or deployment never authorizes payment signing,
provider consumption, settlement, or a real transaction. A bounded economic
smoke test must define its Payment-Identifier, rail, amount, provider workload,
recovery path, and stop boundary before it starts.

## 9. Rollback

Known-good production version through SUN-1207 M3:

```text
a4ada936-a434-4522-a8af-41c57170f4e4
```

**NOT EXECUTED THROUGH SUN-1207 M3.**

```bash
pnpm exec wrangler rollback --config wrangler.toml
# Or pin the known-good version explicitly:
pnpm exec wrangler versions deploy \
  --config wrangler.toml \
  a4ada936-a434-4522-a8af-41c57170f4e4@100% \
  --message "emergency rollback to disabled known-good version" \
  -y
```

The current migrations are additive and the known-good disabled version does not
execute paid-service paths. Its binding/config shape was reconciled read-only in
SUN-1207 M3. Rolling code back cannot reverse an already-finalized external
payment or provider workload; such economic effects are the irreversible cutover
actions and must be reconciled by Payment-Identifier.

## 10. Emergency paid-route disable

There is no independent instantaneous route toggle. Create a new fail-closed
version with `PAID_ROUTES_ENABLED` absent or not `"true"`, upload it, verify its
metadata and local real-workerd behavior while public previews remain disabled,
then deploy it to 100%. Both upload and deployment are mutations and were **NOT
EXECUTED THROUGH SUN-1207 M3**. `/mcp` remains public through this procedure,
while paid MCP tool execution remains closed at its economic boundary.

## 11. Evidence required to close a future cutover

- Frozen candidate/activation SHA and release manifest.
- Preflight, full regression, security, bundle, and preview-containment
  evidence.
- Uploaded version ID, authoritative metadata, and proof that versioned and
  aliased preview routing remained disabled.
- Deployment ID and traffic percentages.
- Production route/MCP observations and logs.
- Any separately authorized economic test's durable receipt, PSL, provider
  evidence, exactly-once/recovery proof, and reconciliation.
- Rollback readiness and explicit confirmation that no rollback trigger fired
  during the approved observation window.
