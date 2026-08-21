# SITEBORNE Production Cutover Runbook

Reconciled by SUN-1205 checkpoint K. This is a procedural reference for a
future, separately authorized upload/cutover checkpoint. **Every mutating
command below is marked `NOT EXECUTED IN SUN-1205`; none was executed by
SUN-1205.**

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
- The release manifest freezes the exact Git SHA, lockfile/config hashes,
  compatibility date, migration head, pricing/contracts, and bundle identity.
- Required Cloudflare binding and secret **names** are reconciled read-only.
- Any later cutover variables are reviewed as a new bounded change. They are
  intentionally absent from the fail-closed SUN-1205 pre-upload candidate.

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
required Cloudflare secret names. At SUN-1205, the canonical Nevermined secret
name is `NVM_API_KEY`; `NEVERMINED_API_KEY` is a deprecated alias, and differing
dual values fail closed.

Read-only operator checks may include:

```bash
pnpm exec wrangler secret list --config wrangler.toml
pnpm exec wrangler versions view --config wrangler.toml
pnpm exec wrangler deployments status --config wrangler.toml
```

Never retrieve, print, or persist secret values.

## 3. Upload the fail-closed candidate

**NOT EXECUTED IN SUN-1205. Requires explicit SUN-1206 human authorization.**

```bash
pnpm exec wrangler versions upload \
  --config wrangler.toml \
  --strict \
  --message "<approved release description>"
```

This creates a Worker Version but does not change the production deployment or
its traffic percentages. It is not, however, a zero-public-traffic operation:
this project has `workers_dev = true`, and Wrangler's version preview URLs are
enabled by default when workers.dev is enabled. The uploaded version therefore
receives a publicly reachable preview URL even before production deployment.

Because the SUN-1205 candidate keeps all five paid/economic activation variables
absent, its v1/v2 paid route families remain 404 on that preview. `/mcp` remains
a public discovery surface and paid MCP tool calls remain closed at
`payment_required` with no service/provider execution.

## 4. Preview smoke test

Against the exact uploaded version preview URL:

1. `GET /`, `/health`, `/ready`, the Agent Card, catalogs, schemas, and
   discovery documents return governed responses.
2. Malformed `/mcp` JSON returns bounded 400; valid discovery lists the six
   governed tools; an unpaid paid-tool call returns `payment_required`; an
   oversized MCP request returns 413.
3. The four v1 CDP, four v2 CDP, and four v2 Nevermined paid endpoints remain
   404 in the fail-closed pre-cutover candidate.
4. No real payment signature, entitlement, provider workload, settlement, or
   storage mutation is performed.

## 5. Paid-route enablement mechanism

Paid routes are compile/config-version controlled, not an independently
switchable live route. A later, separately reviewed activation candidate must
set the exact authorized variables and pass all provider gates. For CDP, the
load-bearing values include:

- `PAYMENT_ENVIRONMENT = "production"`
- `PRODUCTION_ENABLED = "true"`
- `PRODUCTION_CDP_CREDENTIALS_APPROVED = "true"`
- `HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP = "true"` for the exact bounded
  authorized action only; it is never standing authority
- `PAID_ROUTES_ENABLED = "true"`

Nevermined additionally requires its own route/live guards, canonical secret,
sandbox-only classification under the current implementation, and an explicit
economic authorization checkpoint. Uploading a version alone does not deploy it
to production, but does expose its preview URL; deploying the activated version
is what moves production traffic to those route implementations.

`/mcp` is independent of `PAID_ROUTES_ENABLED`: it is mounted unconditionally
and is already public. Its paid tools use a closed execution boundary unless a
separately wired economic boundary is provided.

## 6. Deploy a version to production traffic

**NOT EXECUTED IN SUN-1205. Requires explicit human traffic-shift authorization
after preview verification.**

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

## 8. Economic smoke test

**NOT EXECUTED IN SUN-1205. Requires a separate, explicit, rail-specific human
authorization.** Upload or deployment never authorizes payment signing, provider
consumption, settlement, or a real transaction. A bounded economic smoke test
must define its Payment-Identifier, rail, amount, provider workload, recovery
path, and stop boundary before it starts.

## 9. Rollback

Known-good production version at SUN-1205:

```text
a4ada936-a434-4522-a8af-41c57170f4e4
```

**NOT EXECUTED IN SUN-1205.**

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
SUN-1205. Rolling code back cannot reverse an already-finalized external payment
or provider workload; such economic effects are the irreversible cutover actions
and must be reconciled by Payment-Identifier.

## 10. Emergency paid-route disable

There is no independent instantaneous route toggle. Create a new fail-closed
version with `PAID_ROUTES_ENABLED` absent or not `"true"`, upload it, verify its
public preview, then deploy it to 100%. Both upload and deployment are mutations
and were **NOT EXECUTED IN SUN-1205**. `/mcp` remains public through this
procedure, while paid MCP tool execution remains closed at its economic
boundary.

## 11. Evidence required to close a future cutover

- Frozen candidate/activation SHA and release manifest.
- Preflight, full regression, security, bundle, and preview-smoke evidence.
- Uploaded version ID and preview URL, with the public-preview exposure
  explicitly acknowledged.
- Deployment ID and traffic percentages.
- Production route/MCP observations and logs.
- Any separately authorized economic test's durable receipt, PSL, provider
  evidence, exactly-once/recovery proof, and reconciliation.
- Rollback readiness and explicit confirmation that no rollback trigger fired
  during the approved observation window.
