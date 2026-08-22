# SUN-1209 Checkpoint O — frozen candidate upload and zero-traffic reconciliation

Date: 2026-08-22 (America/Chicago)

Classification: one frozen-candidate Worker Version upload followed by read-only
cloud-side reconciliation. No deployment, traffic shift, route activation,
secret mutation, storage mutation, provider execution, payment, settlement, or
economic activity occurred.

Final decision:

```text
CANDIDATE_UPLOAD_GATE = PASS
DEPLOYMENT_AUTHORIZATION_ELIGIBLE = YES
```

This means only that the exact SUN-1208 runtime candidate now exists as a
verified, undeployed, zero-traffic, preview-unroutable Cloudflare Worker
Version. It does not authorize deployment or paid-route activation.

## Starting authority

| Field                       | Frozen value                                                       |
| --------------------------- | ------------------------------------------------------------------ |
| Main/report `START_HEAD`    | `c4c3d4059bcca5ab3d7ec8c23e47acf21b990689`                         |
| `RUNTIME_CANDIDATE_SHA`     | `e5d061e2e9c908244f807cf0cf141ab308575496`                         |
| `RUNTIME_GIT_TREE`          | `ae82119f906b9641075409bb14a3d4f9a88514c8`                         |
| `RUNTIME_BUNDLE_SHA256`     | `5d969493edd11f4127643ae5af3adc961f2ffce15a97a726b9c98524ca10844b` |
| `WRANGLER_TOML_SHA256`      | `10328cd55ae007d10c2a775c15a31ab8a7fe7acff12fbe17ecc9f5a3983e0387` |
| `LOCKFILE_SHA256`           | `2c5ea71c07a8c900da69529a230702b6d879708488d51d255ccf01e8ff922669` |
| SUN-1208 pre-upload gate    | `PASS`                                                             |
| SUN-1208 candidate manifest | `FROZEN`                                                           |

The report HEAD was not used as upload input. A disposable detached worktree at
`/private/tmp/siteborne-sun1209-candidate.6XnSZZ` reconstructed the exact
runtime candidate without creating a branch, commit, or candidate change. The
main checkout remained at the report HEAD throughout the upload and cloud-side
reconciliation.

```text
UPLOAD_SOURCE_HEAD = e5d061e2e9c908244f807cf0cf141ab308575496
UPLOAD_SOURCE_TREE = ae82119f906b9641075409bb14a3d4f9a88514c8
UPLOAD_SOURCE_WORKING_TREE = clean

RUNTIME_CANDIDATE_SHA_MATCH = YES
RUNTIME_GIT_TREE_MATCH = YES
WRANGLER_TOML_SHA256_MATCH = YES
LOCKFILE_SHA256_MATCH = YES
```

The first dependency setup requested offline-only resolution and stopped before
build/upload because one lockfile-pinned package tarball was not present in the
local pnpm store. The normal frozen-lockfile install then completed with the
same lockfile, reused all 628 packages, downloaded zero packages, and left the
detached candidate clean. This setup event changed no tracked source,
configuration, version, or dependency identity.

### Frozen manifest reconstruction

| Authority                                         | Recomputed SHA-256                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------ |
| `pnpm-lock.yaml`                                  | `2c5ea71c07a8c900da69529a230702b6d879708488d51d255ccf01e8ff922669` |
| `wrangler.toml`                                   | `10328cd55ae007d10c2a775c15a31ab8a7fe7acff12fbe17ecc9f5a3983e0387` |
| migration head `0007_cdp_settlement_recovery.sql` | `2ef2a881f21ecae8e13b2dc47060d214502322e7b427453616d8bf227a0256be` |
| contract release                                  | `8cbfada1cd03573038b824be5ba84c5fbdab3618fb69a2fed93e07cb11e64660` |
| contract release sums                             | `b552a649f624a359dd2ab409fb6265a5cb7a8317cb1439056e25bdabd37089ed` |
| fixed service pricing                             | `c58526ab1e039530ac80388bebd9c9ad4fc0979bdc154394d237454bbd84cec0` |
| document pricing                                  | `fd830b6024b2f63bd722b581b909036a4b9bc56e49d6a0c149dcc864702bdb3f` |
| combined pricing governance                       | `7074c1f270a06dcafb1828065d787bf63c3f5321c9db198ad590d57f84be4188` |

## Pre-upload local artifact

One credential-stripped Wrangler dry run from the detached candidate produced:

```text
runtime file = index.js
runtime bytes = 2,643,822
Wrangler total upload = 2,581.86 KiB
Wrangler gzip = 447.68 KiB
RUNTIME_BUNDLE_SHA256 =
5d969493edd11f4127643ae5af3adc961f2ffce15a97a726b9c98524ca10844b

PREUPLOAD_BUNDLE_SHA_MATCH = YES
```

The bundle audit preserved SUN-1208's accepted boundaries:

```text
bare eval( = 0
new Function( = 1 previously audited generated occurrence
request-runtime crash blockers = 0
production fixture markers = 0
production test entrypoint = absent
CDP fixture provider = absent
Nevermined deny/test provider = absent
synthetic settlement code = absent
secret material = absent
```

The upload did not require another full source qualification cycle because the
candidate SHA, tree, lockfile, config, and material runtime bundle were all
identical to SUN-1208's fully tested authority.

## Pre-upload Cloudflare state

Immediately before the authorized upload, read-only Cloudflare and Wrangler
evidence established:

```text
WORKER = siteborne-utility-edge
CURRENT_DEPLOYMENT_ID = a85d3b6c-8cc2-4e6e-baf0-a81158a80be6
CURRENT_PRODUCTION_VERSION = a4ada936-a434-4522-a8af-41c57170f4e4
CURRENT_PRODUCTION_TRAFFIC = 100%

workers_dev = true
preview_urls = false
Cloudflare enabled = true
Cloudflare previews_enabled = false

PREUPLOAD_VERSION_PREVIEW_ROUTING = DISABLED
PREUPLOAD_ALIAS_PREVIEW_ROUTING = DISABLED
```

All four required secret names were present; no values were retrieved:

```text
AGENT_CARD_SIGNING_PRIVATE_KEY
CDP_API_KEY_ID
CDP_API_KEY_SECRET
NVM_API_KEY
```

### Version inventory reconciliation

Wrangler's human-readable `versions list` displayed its ten most recent
versions. The authoritative paginated API returned 20 total versions before
upload. The ten additional versions were older versions numbered 1 through 10,
all created on August 18; the latest remained version 20, the known August 21
secret-provisioning version. No unrecognized new version existed.

```text
PREUPLOAD_WORKER_VERSION_TOTAL = 20
PREUPLOAD_LATEST_VERSION_ID = 1c5f6218-baac-45e7-bd74-f8d0e32edaba
```

This corrects the display-scope assumption in the SUN-1208 report without
changing the security or release conclusion: Wrangler displayed 10, while the
API's `total_count` was 20.

### Production route state before upload

Every paid route returned HTTP 404 without payment headers:

| Rail/version  | Company | Web | Document | Verify |
| ------------- | ------: | --: | -------: | -----: |
| v1 CDP        |     404 | 404 |      404 |    404 |
| v2 CDP        |     404 | 404 |      404 |    404 |
| v2 Nevermined |     404 | 404 |      404 |    404 |

`GET /mcp` returned HTTP 405. The historical secret-version preview's harmless
`GET /health` returned HTTP 404.

```text
PREUPLOAD_PAID_ROUTE_STATE = DISABLED
```

## Authorized upload

The exact, single mutation command was run once from the clean detached
candidate worktree:

```bash
pnpm exec wrangler versions upload \
  --config wrangler.toml \
  --strict \
  --message "SUN-1209 frozen candidate e5d061e2"
```

All production credential and live/probe/registration flags were removed from
the child environment. Wrangler `4.119.0` bundled the same 2,581.86 KiB / 447.68
KiB-gzip runtime and reported 200 ms Worker startup time.

```text
UPLOAD_COMMAND_COUNT = 1
UPLOAD_RESULT = SUCCESS
CANDIDATE_CLOUDFLARE_VERSION_ID = f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
CANDIDATE_CLOUDFLARE_CREATED_AT = 2026-08-22T07:06:16.667547Z
CANDIDATE_UPLOAD_MESSAGE = SUN-1209 frozen candidate e5d061e2
CANDIDATE_VERSION_NUMBER = 21
CANDIDATE_VERSION_SOURCE = wrangler / version_upload
```

Wrangler explicitly stated that production deployment would require the separate
`wrangler versions deploy` command. That command was not run.

## Exact version-count reconciliation

The authoritative API version count changed from 20 to 21. The set difference
contained exactly one ID:

```text
f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
```

```text
NEW_WORKER_VERSIONS = 1
EXACTLY_ONE_CANDIDATE_VERSION_CREATED = YES
CANDIDATE_VERSION_ID != SECRET_PROVISIONING_VERSION_ID
```

No second upload was attempted or needed.

## Candidate chain of custody

```text
Git commit e5d061e2e9c908244f807cf0cf141ab308575496
  -> tree ae82119f906b9641075409bb14a3d4f9a88514c8
  -> wrangler.toml 10328cd55ae007d10c2a775c15a31ab8a7fe7acff12fbe17ecc9f5a3983e0387
  -> local runtime 5d969493edd11f4127643ae5af3adc961f2ffce15a97a726b9c98524ca10844b
  -> one strict wrangler versions upload
  -> Cloudflare version f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
```

Cloudflare does not expose a local-bundle SHA-256 in the version-detail
response. It does expose an opaque script-resource ETag:

```text
f8a2f8b70a206a96eed9d901f7e3fae84af80cb4c082992ecb0a4c0810de5d9f
```

That ETag is recorded as Cloudflare metadata and is not misrepresented as the
local runtime hash.

```text
CANDIDATE_VERSION_CHAIN_OF_CUSTODY = PASS
```

## Uploaded-version configuration

`wrangler versions view` and the authoritative version-detail API independently
returned:

```text
Version ID: f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
Compatibility Date: 2026-08-05
Compatibility Flags: nodejs_compat
Usage Model: standard
Source: version_upload
```

### UPLOADED_VERSION_CONFIG_DRIFT_MATRIX

| Property                     | Frozen candidate  | Uploaded version                              | Match? |
| ---------------------------- | ----------------- | --------------------------------------------- | ------ |
| compatibility date           | `2026-08-05`      | `2026-08-05`                                  | yes    |
| compatibility flags          | `nodejs_compat`   | `nodejs_compat`                               | yes    |
| D1 binding                   | `DB`              | `DB` / `efe23c42-cbcc-47c2-9b28-922a541bdcdd` | yes    |
| `ENVIRONMENT`                | `production`      | `production`                                  | yes    |
| `PCC_VERSION`                | `1.0.0`           | `1.0.0`                                       | yes    |
| `LOG_LEVEL`                  | `info`            | `info`                                        | yes    |
| `NVM_ENVIRONMENT`            | `sandbox`         | `sandbox`                                     | yes    |
| agent-card key ID            | present           | present                                       | yes    |
| seller wallet                | present           | present                                       | yes    |
| required secret names        | four frozen names | four exact names                              | yes    |
| economic activation vars     | absent            | absent                                        | yes    |
| repository preview policy    | disabled          | candidate source `preview_urls=false`         | yes    |
| Worker-level preview routing | disabled          | `previews_enabled=false`                      | yes    |
| workers.dev policy           | enabled           | `enabled=true`                                | yes    |

The uploaded version also contains the frozen non-load-bearing resource
declarations `CATALOG`, `EVENTS`, `JOBS`, `BROWSER`, and `AI`; no resource was
created or mutated after upload.

```text
UPLOADED_VERSION_CONFIG_DRIFT = NONE
CANDIDATE_REQUIRED_BINDINGS_PRESENT = YES
CANDIDATE_REQUIRED_SECRET_BINDINGS_PRESENT = YES
```

### Required secret bindings

The candidate version exposes these names and types only:

```text
AGENT_CARD_SIGNING_PRIVATE_KEY  secret_text
CDP_API_KEY_ID                  secret_text
CDP_API_KEY_SECRET              secret_text
NVM_API_KEY                     secret_text
```

No secret value was read or printed.

### Stale activation variables

The candidate version-detail binding list contains none of:

```text
PAYMENT_ENVIRONMENT
PRODUCTION_ENABLED
PRODUCTION_CDP_CREDENTIALS_APPROVED
HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP
PAID_ROUTES_ENABLED
NEVERMINED_ROUTES_ENABLED
```

```text
STALE_ECONOMIC_ACTIVATION_VARS_PRESENT = NO
```

## Preview containment

Cloudflare version metadata reports `has_preview=true`, which records that the
version supports a preview identity. It does not override the authoritative
Worker-level routing policy:

```json
{ "enabled": true, "previews_enabled": false }
```

Cloudflare documents that disabling Preview URLs disables routing to both
versioned and aliased preview hostnames. A single harmless `GET /health` to the
candidate's known version-prefix hostname returned Cloudflare HTTP 404. No paid
candidate route was requested.

```text
CANDIDATE_VERSION_PREVIEW_SURFACE = NONE
CANDIDATE_PREVIEW_ROUTABLE = false
CANDIDATE_VERSION_PREVIEW_R0 = CLOSED
VERSION_PREVIEW_ROUTING = DISABLED
ALIAS_PREVIEW_ROUTING = DISABLED
```

Authoritative platform references:

- <https://developers.cloudflare.com/workers/versions-and-deployments/preview-urls/>
- <https://developers.cloudflare.com/workers/versions-and-deployments/>
- <https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/versions/methods/get/>

## Production reconciliation after upload

The latest deployment remained unchanged:

```text
CURRENT_DEPLOYMENT_ID = a85d3b6c-8cc2-4e6e-baf0-a81158a80be6
CURRENT_PRODUCTION_VERSION = a4ada936-a434-4522-a8af-41c57170f4e4
CURRENT_PRODUCTION_TRAFFIC = 100%

CANDIDATE_VERSION_DEPLOYED = false
CANDIDATE_VERSION_TRAFFIC = 0
CANDIDATE_VERSION_BECAME_PRODUCTION = NO
KNOWN_GOOD_PRODUCTION_VERSION_UNCHANGED = YES
```

Post-upload production probes reproduced the pre-upload boundary:

| Rail/version  | Company | Web | Document | Verify |
| ------------- | ------: | --: | -------: | -----: |
| v1 CDP        |     404 | 404 |      404 |    404 |
| v2 CDP        |     404 | 404 |      404 |    404 |
| v2 Nevermined |     404 | 404 |      404 |    404 |

`GET /mcp` remained HTTP 405.

```text
PAID_ROUTE_EXPOSURE_CHANGED = NO
MCP_ROUTE_EXPOSURE_CHANGED = NO
CURRENT_PRODUCTION_CUSTOMER_EXPOSURE_CHANGED = NO
```

No remote candidate paid route was invoked. The accepted local real-workerd
proof remains the authority for its fail-closed route behavior.

## Post-upload production preflight

Credential-stripped `pnpm production:preflight` passed after upload:

```text
DB binding = PASS
required vars = PASS
economic activation flags fail closed = PASS
preview policy = PASS
production config drift = PASS
fixture service execution unreachable = PASS
paid routes unavailable before economics = 12/12 PASS
required secret names = PASS

POSTUPLOAD_PRODUCTION_PREFLIGHT = PASS
```

No repository/config divergence appeared, so the directive correctly did not
repeat `pnpm check` or `pnpm security:release`. The inherited SUN-1208 evidence
remains:

```text
SUN1208_FULL_REGRESSION = PASS
SUN1208_WORKER_RUNTIME = 66/66 PASS
SUN1208_SECURITY_RELEASE = PASS
SUN1208_SECRET_LEAKS = 0
```

The report-complete credential-stripped secret scan also passed before the
evidence commit. It covered 1,047 tracked files / 9,309,390 tracked bytes, all
eight required risk classes, and all nine redacted detector probes. Gitleaks
scanned 164 commits / approximately 10.05 MB and the complete working directory
/ approximately 20.49 MB with no leaks.

```text
SUN1209_SECRET_LEAKS = 0
```

## Historical secret version

Version `1c5f6218-baac-45e7-bd74-f8d0e32edaba` remains distinct from the new
candidate. Its harmless preview `/health` check remained HTTP 404, and it is not
part of the active deployment:

```text
UNDEPLOYED
NOT_SERVING_PRODUCTION
PREVIEW_UNROUTABLE
NOT_RELEASE_CANDIDATE
```

Neither historical nor candidate version was deleted.

## Extended release-candidate metadata

The frozen source identity did not move. Its cloud-stage extension is:

```text
RUNTIME_CANDIDATE_SHA = e5d061e2e9c908244f807cf0cf141ab308575496
RUNTIME_GIT_TREE = ae82119f906b9641075409bb14a3d4f9a88514c8
RUNTIME_BUNDLE_SHA256 = 5d969493edd11f4127643ae5af3adc961f2ffce15a97a726b9c98524ca10844b

CANDIDATE_CLOUDFLARE_VERSION_ID = f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
CANDIDATE_CLOUDFLARE_CREATED_AT = 2026-08-22T07:06:16.667547Z
CANDIDATE_UPLOAD_MESSAGE = SUN-1209 frozen candidate e5d061e2
CANDIDATE_VERSION_DEPLOYED = false
CANDIDATE_VERSION_TRAFFIC = 0
CANDIDATE_PREVIEW_ROUTABLE = false
```

The report commit containing this evidence is not the runtime candidate and is
recorded in the final SUN-1209 stop report because a Git commit cannot contain
its own hash.

## Mutation accounting

```text
VERSION_UPLOADS = 1
WORKER_VERSIONS_CREATED = 1

SECRET_CREATES_OR_UPDATES = 0
DEPLOYMENTS = 0
TRAFFIC_SHIFTS = 0
ROUTE_CHANGES = 0
BINDING_CHANGES_AFTER_UPLOAD = 0
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
CANDIDATE_PAID_ROUTE_REQUESTS = 0
```

The version's bindings and inherited secret names were created as part of the
single authorized version upload, not by a separate post-upload binding or
secret mutation.

## Final classification

```text
CANDIDATE_UPLOAD_GATE = PASS

CANDIDATE_CLOUDFLARE_VERSION_ID = f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
CANDIDATE_DEPLOYED = NO
CANDIDATE_TRAFFIC = 0
CANDIDATE_PREVIEW_ROUTABLE = NO

PRODUCTION_VERSION_UNCHANGED = YES
PRODUCTION_TRAFFIC_UNCHANGED = YES

R0_BLOCKERS = []
EXTERNAL_BLOCKERS = []

DEPLOYMENT_AUTHORIZATION_ELIGIBLE = YES
```

The next proposed checkpoint is deployment/canary-only, separately authorized:

> Assign a deliberately bounded fraction of production traffic to the verified
> candidate version while paid routes remain structurally disabled; validate
> health, public metadata, MCP boundaries, governed errors, logs, latency, and
> rollback; then either return candidate traffic to 0% or advance only under a
> separate explicit authorization.

This report does not authorize that checkpoint. Candidate deployment, paid-route
activation, and economic enablement remain separate risk boundaries.
