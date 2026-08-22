# SUN-1207 M3 — Public Secret-Version Preview Containment

Date: 2026-08-21 (America/Chicago)

Classification: production routing containment; no upload, deployment,
paid-route activation, secret mutation, provider execution, or economic
activity.

## Repository

- `START_HEAD = f160b914b770bfd23a127c9131e157ce78501c4b`
- Containment implementation commit: `c4e8acc2968e8925572e014c863e62325643fc17`
  (`fix(production): disable Worker preview routing`)
- Closure-report commit: this report's commit.
- `END_HEAD`: the closure-report commit, reported in the final M3 stop report.
- Disk before final containment checks: 460 GiB total, 47 GiB available, 89%
  used.

The starting and implementation-commit working trees were clean at their
respective verification boundaries. SUN-1205 and SUN-1206 history was not
amended or rewritten.

## Incident state

The M2 secret operation created this undeployed Worker version:

```text
UNSAFE_PREVIEW_VERSION_ID = 1c5f6218-baac-45e7-bd74-f8d0e32edaba
UNSAFE_PREVIEW_HOSTNAME =
  1c5f6218-siteborne-utility-edge.siteborneutilitynetwork.workers.dev
```

Before containment, a harmless `GET /health` returned HTTP 200 from that
versioned preview hostname. The version was not serving production traffic, but
its version metadata contained stale economically active configuration and real
production secret bindings. It also predated the SUN-1206 fixture-eradication
closure. No paid preview endpoint was probed.

```text
PREVIEW_PUBLIC_BEFORE = YES
PREVIEW_PAID_EXECUTION_RISK = PRESENT
```

That classification is based on configuration and reachability, not on an
attempt to settle, execute, or otherwise exercise the unsafe economic path.

The serving production state before containment remained:

```text
CURRENT_PRODUCTION_DEPLOYMENT = a85d3b6c-8cc2-4e6e-baf0-a81158a80be6
CURRENT_PRODUCTION_VERSION = a4ada936-a434-4522-a8af-41c57170f4e4
CURRENT_PRODUCTION_TRAFFIC = 100%
```

## Repository preview policy

The production Wrangler configuration now commits:

```toml
workers_dev = true
preview_urls = false
```

`workers_dev = true` preserves the existing ordinary workers.dev surface;
`preview_urls = false` disables versioned and aliased version-preview routing.
This behavior follows Cloudflare's documented distinction between the
workers.dev route and version-preview URLs.

`scripts/production-preflight.mts` now requires an explicit boolean false. A
missing value, malformed value, or `preview_urls = true` is a repository-owned
preflight failure.

The isolated mutation proof in `scripts/test-public-preview-policy-caught.mts`
changes only a temporary Wrangler copy to `preview_urls = true`, runs
configuration-only preflight, requires the unsafe policy to be rejected, and
deletes the temporary directory.

```text
REPOSITORY_PREVIEW_POLICY = DISABLED
PREVIEW_POLICY_PREFLIGHT_COVERAGE = YES
PUBLIC_PREVIEW_POLICY_REGRESSION_CAUGHT = YES
```

Pinned Wrangler `4.119.0` accepted the canonical configuration in a local
`wrangler deploy --dry-run`; no upload or deployment occurred.

## Cloudflare containment

The authoritative pre-mutation Worker subdomain state was:

```json
{ "enabled": true, "previews_enabled": true }
```

M3 used the narrow Worker Script Subdomain API operation documented by
Cloudflare:

```text
POST /accounts/<account-id>/workers/scripts/siteborne-utility-edge/subdomain
body: {"enabled":true,"previews_enabled":false}
```

The operation preserved the ordinary workers.dev route (`enabled = true`) and
disabled Preview URLs (`previews_enabled = false`). It did not call any upload,
deploy, version-deploy, secret, route, storage, payment, or provider operation.
The OAuth credential was supplied only as an HTTP authorization header and was
not printed or persisted in repository evidence.

The authoritative post-mutation read-back is:

```json
{ "enabled": true, "previews_enabled": false }
```

Cloudflare documents that disabling Preview URLs disables both versioned and
aliased preview URLs. The known versioned hostname's safe `GET /health` changed
from HTTP 200 before containment to Cloudflare HTTP 404 afterward. No paid route
was requested.

```text
CLOUDFLARE_PREVIEW_URLS_ENABLED_AFTER = NO
UNSAFE_PREVIEW_PUBLIC_AFTER = NO
VERSION_PREVIEW_ROUTING = DISABLED
ALIAS_PREVIEW_ROUTING = DISABLED
PREVIEW_CONTAINMENT = PASS
```

Authoritative references:

- [Cloudflare Worker Preview URLs](https://developers.cloudflare.com/workers/versions-and-deployments/preview-urls/)
- [Cloudflare Worker Script Subdomain API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/subdomain/methods/create/)

## Production reconciliation

After containment, read-only deployment reconciliation still reported:

```text
CURRENT_PRODUCTION_VERSION = a4ada936-a434-4522-a8af-41c57170f4e4
CURRENT_PRODUCTION_TRAFFIC = 100%
SECRET_VERSION_BECAME_PRODUCTION = NO
```

All 12 paid production routes remained structurally disabled:

| Route                                   | Observed status after containment |
| --------------------------------------- | --------------------------------: |
| `/v1/company/evidence-graph`            |                               404 |
| `/v1/web/context`                       |                               404 |
| `/v1/document/evidence-json`            |                               404 |
| `/v1/verify/agent-output`               |                               404 |
| `/v2/company/evidence-graph`            |                               404 |
| `/v2/web/context`                       |                               404 |
| `/v2/document/evidence-json`            |                               404 |
| `/v2/verify/agent-output`               |                               404 |
| `/v2/nevermined/company/evidence-graph` |                               404 |
| `/v2/nevermined/web/context`            |                               404 |
| `/v2/nevermined/document/evidence-json` |                               404 |
| `/v2/nevermined/verify/agent-output`    |                               404 |

The existing public `/mcp` surface retained its governed method boundary; a
bounded `GET /mcp` returned HTTP 405 both before and after containment. No MCP
paid invocation or provider path was exercised.

```text
PAID_ROUTE_EXPOSURE_CHANGED = NO
MCP_ROUTE_EXPOSURE_CHANGED = NO
DEPLOYMENTS = 0
TRAFFIC_SHIFTS = 0
```

## Secret state

Read-only secret-name inventory still contains exactly the expected names:

```text
AGENT_CARD_SIGNING_PRIVATE_KEY
CDP_API_KEY_ID
CDP_API_KEY_SECRET
NVM_API_KEY
```

No secret value was retrieved or recorded.

```text
CANONICAL_NEVERMINED_SECRET_NAME = NVM_API_KEY
NVM_API_KEY_PRESENT_AFTER_CONTAINMENT = YES
SECRET_CREATES_OR_UPDATES_THIS_CHECKPOINT = 0
```

## Worker-version state

The Worker version inventory contained 10 versions before containment and the
same 10 version IDs afterward. The containment operation created no version.

Version `1c5f6218-baac-45e7-bd74-f8d0e32edaba` was intentionally retained. Its
final classification is:

```text
UNDEPLOYED
NOT_SERVING_PRODUCTION
PREVIEW_UNROUTABLE
NOT_RELEASE_CANDIDATE
```

```text
WORKER_VERSIONS_CREATED_THIS_CHECKPOINT = 0
```

## Preflight and focused proofs

The post-containment production-aware `pnpm production:preflight` passed. It
proved:

- required `DB` binding present;
- committed non-secret variables valid;
- economic/cutover variables absent and fail-closed;
- `preview_urls = false` present;
- fixture isolation preserved;
- 12/12 paid routes unavailable before economics;
- all four required Cloudflare secret names present.

Focused M3 evidence also passed:

```text
PRODUCTION_PREFLIGHT_AFTER_CONTAINMENT = PASS
PUBLIC_PREVIEW_POLICY_REGRESSION_CAUGHT = YES
PRODUCTION_FIXTURE_REINTRODUCTION_CAUGHT = YES
REPOSITORY_FIXTURE_R0 = CLOSED
PRODUCTION_FIXTURE_REACHABILITY = 0/12
PRODUCTION_FIXTURE_FALLBACK = NONE
```

The final credential-stripped secret scan passed after the report content was
complete: 1,045 tracked files / 9,269,128 tracked bytes were in scope; eight
required risk classes and nine redacted detector probes passed; 162 Git commits
/ approximately 10.01 MB and the working directory / approximately 20.44 MB were
scanned with no leaks. The first in-sandbox invocation was blocked before
scanning by a local `tsx` IPC `EPERM`; the identical command completed outside
that restricted shell.

M3 intentionally did not run the complete release/security regression and did
not freeze a release candidate. Those belong to the next explicitly authorized
revalidation checkpoint.

## Mutation accounting

```text
REPOSITORY_CONFIG_CHANGES = 1 bounded implementation commit
CLOUDFLARE_PREVIEW_ROUTING_CONFIG_CHANGES = 1

SECRET_CREATES_OR_UPDATES_THIS_CHECKPOINT = 0
WORKER_VERSIONS_CREATED_THIS_CHECKPOINT = 0
VERSION_UPLOADS = 0
DEPLOYMENTS = 0
TRAFFIC_SHIFTS = 0
PAID_ROUTE_CHANGES = 0
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
PREVIEW_PAID_ROUTE_REQUESTS = 0
```

## Decision

The public secret-version preview risk is contained, but M3 is deliberately not
a complete release revalidation or candidate-freeze checkpoint.

```text
PUBLIC_SECRET_VERSION_PREVIEW_R0 = CLOSED
PREUPLOAD_RELEASE_GATE = REVALIDATION_REQUIRED
UPLOAD_AUTHORIZATION_ELIGIBLE = NO
```

The next checkpoint, if separately authorized, is the complete pre-upload gate
against committed `preview_urls = false`, present `NVM_API_KEY`, the closed
fixture R0, the closed preview R0, and the unchanged production deployment. No
upload, deployment, traffic shift, route activation, secret rotation, provider
execution, or economic action is authorized by this report.
