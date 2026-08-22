# SUN-1208 Checkpoint N — final pre-upload revalidation and candidate freeze

Date: 2026-08-22 (America/Chicago)

Classification: complete pre-upload evidence pass and source-candidate freeze.
No Worker version upload, deployment, traffic shift, paid-route activation,
secret mutation, production storage mutation, provider execution, payment, or
economic transaction occurred.

Final decision:

```text
PREUPLOAD_RELEASE_GATE = PASS
UPLOAD_AUTHORIZATION_ELIGIBLE = YES
RELEASE_CANDIDATE_MANIFEST = FROZEN
```

This decision means only that the exact source candidate identified below is
eligible for a separately human-authorized, upload-only checkpoint. It does not
authorize or perform that upload, and it does not authorize deployment or paid
route activation.

## Repository

| Field                                             | Evidence                                                                                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `START_HEAD`                                      | `e5d061e2e9c908244f807cf0cf141ab308575496`                                                                                            |
| Runtime/config implementation commits in SUN-1208 | none; the corrected M3 state was revalidated unchanged                                                                                |
| `RUNTIME_CANDIDATE_SHA`                           | `e5d061e2e9c908244f807cf0cf141ab308575496`                                                                                            |
| Runtime candidate Git tree                        | `ae82119f906b9641075409bb14a3d4f9a88514c8`                                                                                            |
| Closure-report commit                             | the commit containing this report; its SHA is recorded in the final SUN-1208 stop report because a commit cannot contain its own hash |
| `END_HEAD`                                        | the closure-report commit recorded in the final stop report                                                                           |
| Branch                                            | `main`                                                                                                                                |
| Initial tree                                      | clean                                                                                                                                 |
| Runtime-candidate tree                            | clean before every release, security, mutation, and build boundary                                                                    |
| Disk before heavy validation                      | `/dev/disk3s5`; 460 GiB total, 47 GiB free, 89% used                                                                                  |

The runtime candidate is deliberately the already-committed M3 state. This
closure report is non-runtime evidence and is committed afterward; it does not
change the executable candidate identity.

## SUN1208_FINAL_BLOCKER_LEDGER

The blocker ledger was rebuilt from current source, fresh local gates, and
read-only Cloudflare evidence rather than copied forward as an assumption.

### R0 blockers

```text
R0_BLOCKERS = []
```

| Finding                                        | Prior state                        | Fresh SUN-1208 evidence                                                                                               | Final disposition |
| ---------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------- |
| Production fixture execution                   | R0 in SUN-1205; closed in SUN-1206 | bundle/module assertions report zero production fixture markers; workerd activation paths return 503 before economics | closed            |
| Public preview of secret-bearing stale version | R0 in SUN-1207 M2; contained in M3 | repository `preview_urls = false`; Cloudflare `previews_enabled = false`; known version hostname returns 404          | closed            |
| Missing canonical Nevermined credential        | external blocker before M2         | secret-name inventory contains canonical `NVM_API_KEY`; no value was retrieved                                        | closed            |
| Required production binding/secret drift       | previously investigated            | production preflight passes against the actual `DB` binding and exact required secret names                           | closed            |
| Unpaid MCP/provider execution                  | previously bounded                 | fresh workerd MCP scenarios prove no unauthenticated provider or live-service invocation                              | closed            |
| Request-runtime dynamic-code crash             | previously repaired                | historical-AJV mutation is caught; real workerd executes every governed scenario; bundle contains zero bare `eval(`   | closed            |
| Candidate reproducibility                      | not yet frozen                     | two independent dry-run builds have byte-identical runtime JavaScript                                                 | closed            |

### External blockers

```text
EXTERNAL_BLOCKERS = []
```

Cloudflare exposes the required `DB` binding and all four required secret names.
No external resource was provisioned or changed during SUN-1208.

### R1 release risks

1. All 12 paid route configurations are intentionally unavailable before
   economics because a complete governed production service-executor composition
   is not yet approved. This is a fail-closed product limitation, not an
   authorization or fixture bypass. An upload of this candidate does not create
   paid-service availability.
2. `/mcp` is already public. Its byte, method, initialization, and economic
   boundaries are covered by workerd, but an account-level public rate limiter
   or concurrency quota remains future defense-in-depth work.
3. Four Schemathesis operations retain known response/schema diagnostic warnings
   even though all 1,512 generated cases pass. These are preserved as
   contract-hygiene debt and are not hidden.
4. The historical secret-provisioning version
   `1c5f6218-baac-45e7-bd74-f8d0e32edaba` remains undeployed and retained. Its
   public preview is contained globally, and it is explicitly not the release
   candidate.

### R2 hardening

- OSV reports 77 fix-available non-Critical advisory records under the frozen
  policy; Trivy reports seven non-blocking dependency findings and zero blocking
  High/Critical findings.
- Deprecated `NEVERMINED_API_KEY` compatibility remains intentionally accepted;
  conflicting canonical/alias values fail closed.
- Historical unused resource declarations remain candidates for later config
  cleanup only where live-source authority proves them stale.

### R3 enhancements

- Add account-level MCP rate-limit observability and explicit capacity policy.
- Remove the package-module-format lint warning when package governance allows.
- Normalize dry-run source-map output-directory metadata if byte-identical map
  artifacts are ever required; runtime JavaScript is already reproducible.

## Cloudflare read-only reconciliation

The authoritative Worker identity and state remained stable through the final
read-only checks:

```text
ACCOUNT_ID = 29a264a25ccfd13882defe49ed3e17b1
WORKER = siteborne-utility-edge
CURRENT_DEPLOYMENT_ID = a85d3b6c-8cc2-4e6e-baf0-a81158a80be6
CURRENT_PRODUCTION_VERSION = a4ada936-a434-4522-a8af-41c57170f4e4
CURRENT_PRODUCTION_TRAFFIC = 100%
workers_dev = true
preview_urls = false
Cloudflare enabled = true
Cloudflare previews_enabled = false
```

Cloudflare's first/latest deployment read-back remained the deployment above,
with 100% assigned to the same known-good version. No deployment or version
mutation was used to obtain this evidence.

### Historical secret version

The version inventory contains ten versions and still includes:

```text
SECRET_PROVISIONING_VERSION_ID = 1c5f6218-baac-45e7-bd74-f8d0e32edaba
version number = 20
created = 2026-08-21T06:04:18.600478Z
trigger = create_version_api
```

Its metadata retains `has_preview = true`, which describes the version as
created; the current Worker-level routing authority has
`previews_enabled = false`. A safe `GET /health` to the known version-preview
hostname returned Cloudflare HTTP 404. No paid route on that version was
requested.

Final classification:

```text
UNDEPLOYED
NOT_SERVING_PRODUCTION
PREVIEW_UNROUTABLE
NOT_RELEASE_CANDIDATE

PUBLIC_SECRET_VERSION_PREVIEW_R0 = CLOSED
VERSION_PREVIEW_ROUTING = DISABLED
ALIAS_PREVIEW_ROUTING = DISABLED
```

### Secret-name inventory

Read-only inventory contains exactly the required names:

```text
AGENT_CARD_SIGNING_PRIVATE_KEY
CDP_API_KEY_ID
CDP_API_KEY_SECRET
NVM_API_KEY
```

```text
MISSING_PRODUCTION_SECRET_NAMES = []
NVM_API_KEY_PRESENT = YES
```

No secret value was retrieved, printed, hashed, copied into a child test
environment, or embedded into a bundle.

## Production preflight and mutation controls

Fresh credential-stripped `pnpm production:preflight` passed. Its
production-aware read-only phase proved:

- the live `DB` binding exists under its exact name;
- required committed variables are valid;
- economic/cutover variables remain absent and fail closed;
- repository `preview_urls = false` and Cloudflare `previews_enabled = false`
  agree;
- production configuration drift is clean;
- fixture service execution is unreachable;
- all 12 paid routes are unavailable before economics; and
- all four required Cloudflare secret names exist.

Fresh isolated mutation controls produced the required fail/pass boundaries:

| Control                                                     | Mutant result                                         | Restored result                                         | Final                                            |
| ----------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------ |
| `DB` binding renamed to `DB_MUTANT` in isolated config      | preflight failed with exact missing-DB diagnostic     | canonical config passed                                 | `PRODUCTION_PREFLIGHT_REGRESSION_CAUGHT = YES`   |
| `preview_urls = false` changed to `true` in isolated config | public-preview policy rejected                        | canonical config passed                                 | `PUBLIC_PREVIEW_POLICY_REGRESSION_CAUGHT = YES`  |
| representative fixture registry import reintroduced         | production fixture gate rejected it                   | source restored byte-for-byte                           | `PRODUCTION_FIXTURE_REINTRODUCTION_CAUGHT = YES` |
| old request-time AJV path restored                          | workerd returned governed failure rather than success | current path returned HTTP 200                          | `OLD_VERIFY_PATH_CAUGHT = YES`                   |
| x402 sanitizer repair removed                               | malformed response caught                             | current response accepted                               | `X402_BLOCKER_REGRESSION_CAUGHT = YES`           |
| Nevermined exact-denial handling weakened                   | exact denial regression caught                        | current denial remained `payment_verification_rejected` | `NEVERMINED_DENIAL_REGRESSION_CAUGHT = YES`      |

All temporary mutation state was removed, and the canonical tree remained clean.

```text
PRODUCTION_PREFLIGHT_RESULT = PASS
```

## Fixture isolation and paid-route disposition

Established production bundle/module assertions were rerun; they do not rely on
repository grep alone.

```text
REPOSITORY_FIXTURE_R0 = CLOSED
PRODUCTION_FIXTURE_REACHABILITY = 0/12
PRODUCTION_FIXTURE_FALLBACK = NONE
PRODUCTION_RUNTIME_FIXTURE_MARKERS = 0
PRODUCTION_EXECUTION_MODE_FIXTURE = IMPOSSIBLE
```

The production runtime contains none of these historical production-reachable
symbols or labels:

```text
buildFixtureRegistry
createFixtureSigner
FixtureDocumentWorkerBridge
createTestClock
createTestArtifactStore
createTestServiceAuditSink
execution_mode='fixture'
```

All 12 paid production endpoints returned HTTP 404 from the currently serving
version:

| Rail/version  | Company | Web | Document | Verify |
| ------------- | ------: | --: | -------: | -----: |
| v1 CDP        |     404 | 404 |      404 |    404 |
| v2 CDP        |     404 | 404 |      404 |    404 |
| v2 Nevermined |     404 | 404 |      404 |    404 |

The fresh local real-workerd activation phase exercised all 12 route
configurations and received `503 service_executor_not_configured` before a 402
challenge, payment verification, settlement, service/provider execution, or
storage work.

```text
UNSUPPORTED_SERVICE_PREPAYMENT_FAIL_CLOSED = YES
UNSUPPORTED_SERVICE_CAN_SETTLE = NO
PAID_ROUTE_EXPOSURE_CHANGED = NO
```

## MCP and payment boundaries

The public `/mcp` surface remained independently governed. The fresh workerd
release harness proved:

- malformed JSON-RPC returns bounded HTTP 400;
- initialization/discovery returns the governed six-tool catalog;
- an unknown method returns governed JSON-RPC `-32601` / HTTP 404;
- unpaid paid-tool invocation returns `payment_required`;
- oversized input returns HTTP 413;
- understated `Content-Length` does not bypass the actual-body bound; and
- unauthenticated traffic causes no CDP, Nevermined, live-service, or billable
  provider invocation.

```text
MCP_PUBLIC_NOW = YES
MCP_DISCOVERY_AVAILABLE = YES
MCP_PAID_INVOCATION_GATED = YES
MCP_UNAUTH_PROVIDER_CALL_RISK = NONE
MCP_UNAUTH_LIVE_SERVICE_EXECUTION = NONE
```

Fresh x402/CDP workerd phases retained unsigned 402 behavior, canonical prices,
synthetic authorized success at the governed economic seam, and malformed or
tampered payment rejection. Fresh Nevermined phases retained canonical prices,
missing/malformed authentication rejection, exact provider-denial rejection,
malformed verification rejection, canonical secret resolution, and
conflicting-alias fail-closed behavior. No live payment provider was contacted.

## Real-workerd release harness

`pnpm test:worker-runtime` passed **66/66** scenarios:

| Phase                                                           | Coverage                                               | Result |
| --------------------------------------------------------------- | ------------------------------------------------------ | -----: |
| Exact production-config boot, 12 route 404s, and MCP boundaries | production entrypoint and public pre-economic surface  |   pass |
| Activated-but-unconfigured paid services                        | 12/12 routes return pre-economic 503                   |   pass |
| Profile 1 verification                                          | valid 200, invalid 502, malformed/tampered payment 400 |   pass |
| v1 CDP                                                          | three service families, 402/synthetic 200/rejections   |   pass |
| v2 CDP                                                          | four canonical services/prices and negative proofs     |   pass |
| v2 Nevermined                                                   | four canonical services/prices and negative proofs     |   pass |

```text
WORKER_RUNTIME = 66/66
TESTS_CONSUMED_PRODUCTION_SECRETS = NO
```

## Full deterministic repository regression

Fresh `pnpm check` completed with exit 0. Focused count-bearing suites were
rerun in concise mode to preserve exact results:

| Gate                                    |                                                                 Exact result |
| --------------------------------------- | ---------------------------------------------------------------------------: |
| Root Vitest                             | 2,079 passed; 35 guarded live tests skipped; 0 failed; 610/610 suites passed |
| Service runtime                         |                                                               145/145 passed |
| Service-runtime properties              |                                                                   3/3 passed |
| Profile 1 differential                  |                                                                 55/55 passed |
| Verification                            |                                                                 86/86 passed |
| Document worker                         |                                                     81/81 passed; 4 warnings |
| PCC Python                              |                                                     91/91 passed; 5 warnings |
| x402 protocol                           |                                                               504/504 passed |
| x402 properties                         |                                                                 20/20 passed |
| Nevermined protocol                     |                                                               242/242 passed |
| Nevermined compatibility/runtime matrix |                                                               165/165 passed |
| MCP protocol                            |                                                                 30/30 passed |
| MCP properties/config                   |                                                                 30/30 passed |
| MCP edge                                |                                                                   5/5 passed |
| A2A                                     |                                                                 44/44 passed |
| A2A properties                          |                                                                   6/6 passed |
| A2A edge                                |                                                                   2/2 passed |
| Provider adapters                       |                           170 passed; 6 guarded live tests skipped; 0 failed |
| Provider-adapter properties             |                                                                 16/16 passed |
| Adapter fixture matrix                  |                                                               103/103 passed |
| Real workerd                            |                                                                 66/66 passed |

Formatting, lint, whole-repository typecheck, schemas, governance, pricing,
contract baseline, contract compatibility, release verification, SSRF, D1,
migrations, and repository-drift checks all passed through `pnpm check`. The
first restricted-sandbox adapter-matrix invocation was blocked before tests by
local `tsx` IPC `EPERM`; the identical credential-stripped command ran outside
that restricted shell and passed 103/103. This was an execution-environment
constraint, not a product failure.

## Security release and secret handling

Fresh `pnpm security:release` completed with exit 0:

| Gate                       |                                                                        Exact result |
| -------------------------- | ----------------------------------------------------------------------------------: |
| Semgrep                    |                                           50 rules; 534 tracked targets; 0 findings |
| OSV                        |                   77 fix-available advisory records; 0 Critical under frozen policy |
| Trivy                      |                           7 findings; 0 blocking High/Critical; 0 misconfigurations |
| Schemathesis               | 1,512/1,512 generated cases; 4/4 operations; 4 preserved schema-diagnostic warnings |
| Chaos                      |                                                                        18/18 passed |
| Load                       |                                                                          7/7 passed |
| Embedded real-workerd gate |                                                                        66/66 passed |

```text
SECURITY_RELEASE = PASS
SECRET_LEAKS = 0
```

The report-inclusive final secret scan ran after the report content was
complete. It covered 1,046 tracked files / 9,278,964 tracked bytes, all eight
required risk classes, and all nine redacted detector probes. Gitleaks scanned
163 Git commits / approximately 10.02 MB and the complete working directory /
approximately 20.47 MB with no leaks:

```text
FINAL_SECRET_SCAN = PASS
SECRET_LEAKS = 0
```

## Production artifact and reproducibility

Two independent, credential-stripped Wrangler production dry runs were built
into separate temporary directories. Neither command uploaded a version or
changed Cloudflare state.

| Field                                   | Build 1                                                            | Build 2      |
| --------------------------------------- | ------------------------------------------------------------------ | ------------ |
| Total upload bytes reported by Wrangler | 2,581.86 KiB                                                       | 2,581.86 KiB |
| Gzip bytes reported by Wrangler         | 447.68 KiB                                                         | 447.68 KiB   |
| Material runtime file                   | `index.js`                                                         | `index.js`   |
| Runtime bytes                           | 2,643,822                                                          | 2,643,822    |
| Runtime SHA-256                         | `5d969493edd11f4127643ae5af3adc961f2ffce15a97a726b9c98524ca10844b` | same         |
| Source-map bytes                        | 5,717,726                                                          | 5,717,726    |
| Normalized source-map SHA-256           | `5ae0a86c52d77c7fba59e1b56495d6f9644e152a293083f51fa30d79054762aa` | same         |

Material runtime JavaScript is byte-identical. Raw source-map hashes differ only
because `sourceRoot` names each independently created temporary output
directory; removing that non-runtime field produces the identical normalized
hash above. Wrangler's generated README differs only by build timestamp.

```text
CANDIDATE_BUILD_REPRODUCIBLE = YES
REPRODUCIBILITY_DIFFERENCES = explained non-runtime sourceRoot and README timestamp metadata only
```

### Bundle audit

The exact candidate bundle contains:

```text
bare eval( = 0
new Function( = 1 known generated dependency occurrence
request-runtime dynamic-code blockers = 0
production fixture markers = 0
Worker test entrypoint = absent
CDP fixture provider = absent
Nevermined deny/test provider = absent
synthetic settlement code = absent
secret material = absent
```

The single generated `new Function(` occurrence is the previously audited
dependency/validator construct. The old-AJV mutation control and all 66 real
workerd scenarios prove that it is not a request-runtime crash path.

```text
PRODUCTION_BUNDLE_REQUEST_RUNTIME_CRASH_BLOCKERS = 0
PRODUCTION_PAYMENT_BYPASS_CODE = NONE
PRODUCTION_TEST_CODE = ABSENT
PRODUCTION_RUNTIME_FIXTURE_MARKERS = 0
```

## Rollback revalidation

The known-good production version remained live at 100% throughout SUN-1208:

```text
KNOWN_GOOD_PRODUCTION_VERSION = a4ada936-a434-4522-a8af-41c57170f4e4
ROLLBACK_DATA_COMPATIBILITY = PASS
ROLLBACK_CONFIG_COMPATIBILITY = PASS
ROLLBACK_ROUTE_COMPATIBILITY = PASS
NEW_SECRET_BREAKS_CURRENT_PRODUCTION = NO
PREVIEW_POLICY_BREAKS_CURRENT_PRODUCTION = NO
```

No migration, binding, route, secret, deployment, or rollback operation was
performed. Continued successful health/MCP behavior and unchanged 12-route 404
state demonstrate that the provisioned secret name and disabled preview policy
are safely tolerated by the current production version.

## RELEASE_CANDIDATE_MANIFEST

The following is the immutable source/runtime candidate manifest. Secret names
are listed; secret values are excluded.

| Field                           | Frozen value                                                                            |
| ------------------------------- | --------------------------------------------------------------------------------------- |
| `RUNTIME_CANDIDATE_SHA`         | `e5d061e2e9c908244f807cf0cf141ab308575496`                                              |
| `GIT_TREE_STATE`                | clean; tree `ae82119f906b9641075409bb14a3d4f9a88514c8`                                  |
| `LOCKFILE_SHA256`               | `2c5ea71c07a8c900da69529a230702b6d879708488d51d255ccf01e8ff922669`                      |
| `NODE_VERSION`                  | `v24.18.1`                                                                              |
| `PNPM_VERSION`                  | `9.0.0`                                                                                 |
| `WRANGLER_VERSION`              | `4.119.0`                                                                               |
| `CLOUDFLARE_COMPATIBILITY_DATE` | `2026-08-05`                                                                            |
| `MIGRATION_HEAD`                | `0007_cdp_settlement_recovery.sql`                                                      |
| `MIGRATION_HEAD_SHA256`         | `2ef2a881f21ecae8e13b2dc47060d214502322e7b427453616d8bf227a0256be`                      |
| `CONTRACT_BASELINE`             | `2.0.0`                                                                                 |
| `CONTRACT_RELEASE_SHA256`       | `8cbfada1cd03573038b824be5ba84c5fbdab3618fb69a2fed93e07cb11e64660`                      |
| `CONTRACT_BASELINE_SUMS_SHA256` | `b552a649f624a359dd2ab409fb6265a5cb7a8317cb1439056e25bdabd37089ed`                      |
| `SERVICE_PRICING_SHA256`        | `c58526ab1e039530ac80388bebd9c9ad4fc0979bdc154394d237454bbd84cec0`                      |
| `DOCUMENT_PRICING_SHA256`       | `fd830b6024b2f63bd722b581b909036a4b9bc56e49d6a0c149dcc864702bdb3f`                      |
| `PRICING_GOVERNANCE_SHA256`     | `7074c1f270a06dcafb1828065d787bf63c3f5321c9db198ad590d57f84be4188`                      |
| `WRANGLER_TOML_SHA256`          | `10328cd55ae007d10c2a775c15a31ab8a7fe7acff12fbe17ecc9f5a3983e0387`                      |
| `RUNTIME_BUNDLE_SHA256`         | `5d969493edd11f4127643ae5af3adc961f2ffce15a97a726b9c98524ca10844b`                      |
| `RUNTIME_BUNDLE_BYTES`          | `2,643,822`                                                                             |
| `RUNTIME_BUNDLE_GZIP`           | `447.68 KiB` as reported by Wrangler                                                    |
| `REQUIRED_BINDINGS`             | `DB` (D1)                                                                               |
| `REQUIRED_SECRET_NAMES`         | `AGENT_CARD_SIGNING_PRIVATE_KEY`, `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `NVM_API_KEY` |
| `PRODUCTION_PREFLIGHT_RESULT`   | `PASS`                                                                                  |
| `WORKER_RUNTIME_RESULT`         | `66/66 PASS`                                                                            |
| `FULL_REPOSITORY_CHECK`         | `PASS`                                                                                  |
| `SECURITY_RELEASE_RESULT`       | `PASS`                                                                                  |
| `CANDIDATE_BUILD_REPRODUCIBLE`  | `YES`                                                                                   |

```text
RELEASE_CANDIDATE_MANIFEST = FROZEN
```

## Runbook reconciliation

`docs/operations/PRODUCTION_CUTOVER_RUNBOOK.md` already contains every required
post-M3 invariant, so SUN-1208 made no speculative runbook edit. It states:

- `preview_urls = false` and Cloudflare preview routing disabled;
- canonical `NVM_API_KEY` provisioned and not to be recreated absent an
  authorized rotation;
- the historical secret-created Worker version is not a candidate;
- current production remains unchanged;
- upload must preserve the preview-disable and secret requirements;
- upload and deployment are separate operations; and
- paid-route enablement requires separate implementation and authorization.

## Production and economic mutation accounting

SUN-1208 used only local deterministic work and read-only production metadata or
bounded HTTP probes.

```text
SECRET_CREATES_OR_UPDATES = 0
WORKER_VERSIONS_CREATED = 0
VERSION_UPLOADS = 0
DEPLOYMENTS = 0
TRAFFIC_SHIFTS = 0
ROUTE_CHANGES = 0
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
```

## Final classification and next boundary

Every required SUN-1208 gate is green, the blocker lists are empty, and the
runtime candidate is frozen without changing production:

```text
PREUPLOAD_RELEASE_GATE = PASS
UPLOAD_AUTHORIZATION_ELIGIBLE = YES
RELEASE_CANDIDATE_MANIFEST = FROZEN
```

The exact proposed next checkpoint is upload-only:

> Upload/create the exact frozen candidate Worker version with previews
> remaining disabled and no production traffic change; capture the resulting
> Cloudflare version ID; reconcile its bindings and configuration; perform only
> safe non-economic candidate inspection; prove current production remains at
> 100%; and stop before deployment or paid-route activation.

The proposed future command, **not executed or authorized by SUN-1208**, is:

```bash
pnpm exec wrangler versions upload \
  --config wrangler.toml \
  --strict \
  --message "<approved SUN-1209 candidate description>"
```

According to the governed runbook, that operation creates an undeployed Worker
version. It does not change production traffic, activate the structurally
disabled paid routes, or by itself create economic/customer exposure. Preview
routing must remain disabled. Separate explicit human authorization is still
required before running it.
