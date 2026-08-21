# SUN-1205 Checkpoint K — final pre-upload hardening and release-freeze audit

Date: 2026-08-20  
Classification: pre-upload production audit; no production or economic
mutation  
Final decision: **`PREUPLOAD_RELEASE_GATE = FAIL`**  
Upload authorization: **`SUN1206_UPLOAD_AUTHORIZATION_ELIGIBLE = NO`**

The failure is deliberate and fail-closed. The repository now has a real
production preflight, bounded public MCP behavior, fail-closed payment-provider
construction, and a reconciled cutover runbook. It is not a releasable paid
service candidate because all 12 paid-route configurations still construct
fixture-backed **service executors**. Enabling the paid routes could therefore
charge a buyer for canned service output. Separately, the canonical Nevermined
production secret is absent from Cloudflare. The first issue is repository-owned
and makes the final classification `FAIL`; the second is an external
provisioning blocker that would remain after the source defect is closed.

## 1. Repository and history

| Item                                           | Evidence                                                                                                         |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| SUN-1204 accepted closure                      | `3c0ecd4`                                                                                                        |
| START_HEAD / inherited partial SUN-1205 commit | `7a62d4b1b5b4a02d09498b39771088f288079614`                                                                       |
| History preservation                           | `7a62d4b` was not amended, rebased, reset, or rewritten                                                          |
| Implementation/config/test/runbook commit      | `b35fd2428b8b54bf3db56c8975cc0a421fd55273` (`fix(production): harden preupload fail-closed gates`)               |
| Comment-only correction                        | `620243565d94447d14d0c04ce916b231baa96e45` (`docs(production): correct preflight secret count`)                  |
| Report commit                                  | The commit containing this report; recorded in the final stop report because a commit cannot contain its own SHA |
| Working tree before report work                | clean                                                                                                            |

The changes since `3c0ecd4` were inspected as a whole and the partially
committed implementation was reconciled rather than restarted. No `.wrangler`
state, local D1 database, temporary bundle, scanner output, credential, access
token, or payment material is part of the commits.

## 2. Disk recovery

The prior stop was a genuine `ENOSPC` event. Before heavy verification, only
about 3 GiB remained and a disposable Hugging Face model cache occupied about 56
GiB. With explicit approval, only `/Users/meta4ickal/.cache/huggingface/hub` was
removed. Source, Git data, lockfiles, migrations, fixtures, governance, reports,
project dependencies, credentials, and persistent D1 state were not removed.

Final pre-regression/recheck observation:

| Field                                  | Value                                            |
| -------------------------------------- | ------------------------------------------------ |
| Filesystem                             | `/dev/disk3s5` mounted at `/System/Volumes/Data` |
| Total                                  | 460 GiB (`482,797,652` KiB)                      |
| Available                              | 58 GiB (`61,325,876` KiB)                        |
| Capacity                               | 87%                                              |
| Repository `.wrangler`                 | 3.0 MiB; normal local metadata only              |
| Repository `node_modules`              | 1.1 GiB; retained required dependencies          |
| Leftover bundle/scan/mutation fixtures | none retained                                    |

`DISK_FREE_BEFORE_HEAVY_REGRESSION = approximately 59 GiB`  
`DISK_HEALTH_FOR_RELEASE_TESTING = PASS`

## 3. Wrangler accidental-commit reconciliation

Commit `7a62d4b` accidentally committed five cutover/economic variables and
intentionally added the Nevermined environment. History was preserved; the
current candidate removes the five activation values in a new commit and keeps
only the fail-closed sandbox environment.

### WRANGLER_ACCIDENTAL_COMMIT_RECONCILIATION

| Variable                                | Value in `7a62d4b` | Current committed value | Live consumer and effect                                                                    | Can authorize economics alone?                                                                                 | Candidate disposition                                           |
| --------------------------------------- | ------------------ | ----------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `PAYMENT_ENVIRONMENT`                   | `production`       | absent                  | Production-payment resolver; included in uploaded config and only relevant after deployment | No; all activation checks, credentials, seller identity, route mount, and provider construction must also pass | removed                                                         |
| `PRODUCTION_ENABLED`                    | `true`             | absent                  | Production-payment authorization gate                                                       | No                                                                                                             | removed                                                         |
| `PRODUCTION_CDP_CREDENTIALS_APPROVED`   | `true`             | absent                  | Explicit CDP credential-approval gate                                                       | No; secrets and all other gates are required                                                                   | removed                                                         |
| `HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP` | `true`             | absent                  | Human bootstrap/cutover gate                                                                | No; and it must not be stored as standing authority                                                            | removed                                                         |
| `PAID_ROUTES_ENABLED`                   | `true`             | absent                  | Structurally mounts the CDP paid route families after deployment                            | No; payment-provider construction still fails closed, but exposure would change from 404                       | removed                                                         |
| `NVM_ENVIRONMENT`                       | `sandbox`          | `sandbox`               | Nevermined configuration/live guard                                                         | No; key, route flag, and command-scoped live guard are also required; `live` is rejected                       | retained; correct for the only supported Nevermined environment |

The absence of the first five variables is now part of the preflight contract.
Their accidental historical presence is not hidden.

`WRANGLER_COMMITTED_VARS_SAFE_FOR_CANDIDATE = YES`

This statement is limited to the committed variables. It does not make the
overall production candidate eligible.

## 4. SUN1205_CARRIED_RISK_LEDGER

### R0_BLOCKERS

| Origin                                    | Risk and affected surface                                                                                                                                                   | First-cutover/security/economic consequence                                                                                                             | Current evidence                                                                                            | Final disposition                                                 |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| SUN-1203 carried into SUN-1205            | All 12 paid route configurations use `buildFixtureRegistry`, fixture signers/workers/artifacts/clocks/audit sinks, inline fixture payloads, and `execution_mode: 'fixture'` | A real payment rail could settle while the service returns canned fixture output; first cutover would violate paid-service truth and buyer expectations | Source audit plus production-bundle strings; preflight reports `PRODUCTION_SERVICE_FIXTURE_EXECUTION=12/12` | **R0 repository-owned; open**                                     |
| SUN-1205 source/Cloudflare reconciliation | Required canonical Nevermined secret `NVM_API_KEY` is absent                                                                                                                | Four intended v2 Nevermined routes cannot authenticate; they fail 503 and cannot be release-eligible                                                    | Source trace to `.authenticated()` plus read-only Cloudflare secret-name inventory                          | **R0 external provisioning; open; no secret mutation authorized** |

### R1_RELEASE_RISKS

| Origin                      | Exact risk                                                                                                                      | Current evidence / disposition                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Existing public MCP surface | No application-layer rate limiter or concurrency quota on `/mcp`; unsolicited automated traffic is already observed             | 1 MiB measured body limit and zero pre-payment provider/storage calls bound impact; retain as R1 before production-scale traffic |
| Upload semantics            | A version upload does not receive production traffic but, with current Wrangler preview settings, produces a public preview URL | Runbook now states this explicitly; never assume “zero traffic” means “not public”                                               |
| Configuration drift         | `CATALOG`, `JOBS`, `EVENTS`, `AI`, and `BROWSER` are deployed declarations with no production source dereference                | Not a functional blocker, but increases audit/rollback surface; remove only in a later deliberate config cleanup                 |
| Schemathesis output         | Four operation-level schema-validation warnings were reported while 1,512/1,512 generated cases passed                          | Gate is green; investigate before a future contract refresh rather than obscuring it                                             |

### R2_HARDENING

| Topic                       | Disposition                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Dependency scan             | OSV found 77 non-critical advisories with 77 fixes available; zero critical findings under the frozen gate                                                   |
| Container/filesystem scan   | Trivy found 7 non-blocking findings, zero high/critical blockers, and zero misconfigurations                                                                 |
| Deprecated Nevermined alias | `NEVERMINED_API_KEY` remains a compatibility alias; canonical precedence and disagreement fail closed; later remove after migration                          |
| Free-route amplification    | Catalog/service discovery can perform bounded D1 reads and A2A can perform bounded signing CPU before economics; current use is intentional and non-billable |

### R3_ENHANCEMENTS

- Remove or justify unused resource declarations after the release path is
  correct.
- Add explicit edge/WAF rate-limit policy for MCP and discovery surfaces.
- Remove the root ESLint module-type warning by making the package-module policy
  explicit.
- Normalize reproducible source-map metadata if byte-identical maps become a
  release requirement.

The historical stale-binding finding is closed: validation was narrowed to the
actual live `DB` dereference. `ARTIFACTS` must not be resurrected merely because
it existed in older designs; no production source dereferences that binding. Its
absence does not excuse the fixture artifact store used by the paid-service
executor, which is part of the R0 above.

## 5. PRODUCTION_BINDING_MATRIX

| Name                        | Type              | Source consumer                                       | Required?                            | Wrangler/production state                             | Preflight             | Missing consequence                                        |
| --------------------------- | ----------------- | ----------------------------------------------------- | ------------------------------------ | ----------------------------------------------------- | --------------------- | ---------------------------------------------------------- |
| `DB`                        | D1                | payment attempts, jobs, service catalog/control plane | required for paid routes             | declared and deployed                                 | yes                   | paid mount fails configuration-closed                      |
| `CATALOG`                   | KV                | no current production dereference                     | no                                   | declared/deployed                                     | reported stale        | none in current code                                       |
| `JOBS`                      | Queue producer    | no current production dereference                     | no                                   | declared/deployed                                     | reported stale        | none in current code                                       |
| `EVENTS`                    | Queue producer    | no current production dereference                     | no                                   | declared/deployed                                     | reported stale        | none in current code                                       |
| `AI`                        | Workers AI        | no current production dereference                     | no                                   | declared/deployed                                     | reported stale        | none in current code                                       |
| `BROWSER`                   | Browser Rendering | no current production dereference                     | no                                   | declared/deployed                                     | reported stale        | none in current code                                       |
| `ARTIFACTS`                 | R2                | no current production dereference                     | no in current architecture           | commented/unprovisioned                               | explicitly classified | no current binding failure; fixture persistence remains R0 |
| service bindings            | service           | none                                                  | no                                   | none                                                  | N/A                   | none                                                       |
| Durable Objects             | Durable Object    | none                                                  | no                                   | none                                                  | N/A                   | none                                                       |
| `SELLER_WALLET_ADDRESS`     | public var        | payment quote/receiver construction                   | required for paid economics          | committed                                             | yes                   | payment config fails closed                                |
| activation/environment vars | public vars       | route and provider guards                             | required only for authorized cutover | intentionally absent except `NVM_ENVIRONMENT=sandbox` | yes                   | paid routes remain 404/closed                              |

`MISSING_REQUIRED_PRODUCTION_BINDINGS = NONE` for current source  
`STALE_CONFIG_BINDINGS = CATALOG,JOBS,EVENTS,AI,BROWSER`  
`UNREFERENCED_REQUIRED_BINDINGS = NONE`  
`BINDING_NAME_DRIFT = NONE`  
`ARTIFACTS_BINDING_STATUS = NOT_A_LIVE_SOURCE_DEREFERENCE`

## 6. PRODUCTION_SECRET_MATRIX

Only secret names were read. No value was retrieved, printed, compared, hashed,
or persisted.

| Canonical name                   | Consumer/routes                                                  | Required?                         | Present in Cloudflare? | Preflight                        | Missing behavior                                      |
| -------------------------------- | ---------------------------------------------------------------- | --------------------------------- | ---------------------- | -------------------------------- | ----------------------------------------------------- |
| `CDP_API_KEY_ID`                 | CDP payment provider; 8 CDP route configs                        | yes for CDP production            | yes                    | yes                              | 503 provider-not-configured                           |
| `CDP_API_KEY_SECRET`             | CDP payment provider; 8 CDP route configs                        | yes for CDP production            | yes                    | yes                              | 503 provider-not-configured                           |
| `AGENT_CARD_SIGNING_PRIVATE_KEY` | production Agent Card/JWKS signer                                | yes with committed signing-key ID | yes                    | yes                              | signing/config path fails closed                      |
| `NVM_API_KEY`                    | authenticated Nevermined provider; 4 v2 Nevermined route configs | yes                               | **no**                 | yes                              | 503 provider-not-configured                           |
| `NEVERMINED_API_KEY`             | deprecated compatibility alias                                   | no if canonical is present        | no                     | disagreement/alias logic covered | alias-only accepted for compatibility; canonical wins |

Source trace:

`index.ts` → `buildNeverminedV2PaidServicesApp` →
`NeverminedPaymentEvidenceProvider.authenticated()` →
`resolveNeverminedConfig()` → `NVM_API_KEY` (canonical) with
`NEVERMINED_API_KEY` (deprecated alias). If both exist and differ, resolution
fails closed.

`CANONICAL_NEVERMINED_SECRET_NAME = NVM_API_KEY`  
`NEVERMINED_SECRET_REQUIRED_FOR_PRODUCTION = YES`  
`NEVERMINED_SECRET_PRESENT_IN_CLOUDFLARE = NO`  
`R0_EXTERNAL_PROVISIONING_BLOCKER = YES`  
`REQUIRED_PRODUCTION_SECRET_NAMES = AGENT_CARD_SIGNING_PRIVATE_KEY, CDP_API_KEY_ID, CDP_API_KEY_SECRET, NVM_API_KEY`  
`MISSING_PRODUCTION_SECRET_NAMES = NVM_API_KEY`  
`SECRET_PREFLIGHT_COVERAGE = 4/4 canonical required names`

No secret was created or updated.

## 7. LIVE_PROVIDER_WIRING_MATRIX

There are 12 paid route configurations covering 8 unique service identities:
four v1 CDP routes, four v2 CDP routes, and four v2 Nevermined routes.

| Route family  | Routes/services                                                                                          | Payment provider construction                               | Required config                                                                      | Service execution construction | Closed behavior                                                                       |
| ------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------- |
| CDP v1        | `/v1/company/evidence-graph`, `/v1/web/context`, `/v1/document/evidence-json`, `/v1/verify/agent-output` | real `CdpPaymentEvidenceProvider` path                      | DB, seller, two CDP secrets, all activation gates                                    | fixture registry/executors     | 404 while route flag absent; 503 in production unless provider mode is real           |
| CDP v2        | corresponding `/v2/*` direct routes                                                                      | real `CdpPaymentEvidenceProvider` path                      | same                                                                                 | fixture registry/executors     | same                                                                                  |
| Nevermined v2 | `/v2/nevermined/*` for four services                                                                     | real `NeverminedPaymentEvidenceProvider.authenticated` path | DB, `NVM_API_KEY`, `NVM_ENVIRONMENT=sandbox`, route guard, command-scoped live guard | fixture registry/executors     | 404 while route flag absent; 503 on missing/misclassified config; no payment fallback |

The v1 `/v1/nevermined/*` compatibility surface is a hardcoded 503 when its
guard is enabled and is not counted as one of the payment-capable route
configurations.

`LIVE_PAYMENT_PROVIDER_CODE_PRESENT = YES`  
`LIVE_PAYMENT_PROVIDER_WIRING = 12/12 structurally available but disabled`  
`LIVE_SERVICE_PROVIDER_WIRING = 0/12`  
`PRODUCTION_SERVICE_FIXTURE_EXECUTION = 12/12`  
`PRODUCTION_FIXTURE_FALLBACK = FAIL (service executor is fixture-backed)`  
`PRODUCTION_PAYMENT_FIXTURE_FALLBACK = NONE`  
`MISSING_CREDENTIAL_FAILS_CLOSED = YES`  
`LIVE_PROVIDER_MISCONFIGURATION_TESTS = PASS`

The production CDP path now refuses fixture evidence whenever
`ENVIRONMENT=production`. The Nevermined path already refused missing or invalid
authentication. Focused tests cover both.

## 8. Production test-seam reachability

Searches covered `.fixture()`, mock/fake providers, synthetic settlement,
Nevermined deny clients, worker test entrypoints, deterministic CDP providers,
fixture evidence providers, and fixture worker/artifact implementations.

- Request data, headers, query parameters, hostname, D1/KV/R2 contents, and
  caught exceptions cannot select a payment fixture provider in production.
- Missing payment configuration returns 404/503; it does not fall back.
- The worker-runtime test entrypoint and test-only Nevermined client factories
  are absent from the production bundle.
- The production service executor itself is nevertheless fixture-backed. This is
  a direct construction defect, not a request-controlled bypass.

`REQUEST_CONTROLLED_PAYMENT_BYPASS = NONE`  
`PRODUCTION_TEST_SEAM_REACHABILITY = PRESENT: service executor is directly fixture-backed`  
`PRODUCTION_PAYMENT_BYPASS_CODE = NONE`

## 9. CURRENT_PUBLIC_ROUTE_EXPOSURE_MATRIX

Read-only production requests established the following current exposure.

| Route class                                                             | Methods/current result           | Public now?                      | Payment/auth                                 | Provider/storage/pre-economic risk                    | Intended pre-cutover state |
| ----------------------------------------------------------------------- | -------------------------------- | -------------------------------- | -------------------------------------------- | ----------------------------------------------------- | -------------------------- |
| `/`, `/health`, `/ready`                                                | GET 200                          | yes                              | none                                         | bounded static/config work                            | public                     |
| `/.well-known/agent-card.json`, `/.well-known/jwks.json`                | GET 200                          | yes                              | none                                         | bounded signing/serialization                         | public                     |
| `/.well-known/mcp-registry-auth`                                        | GET 200 on utility host and apex | yes                              | none                                         | static metadata                                       | public                     |
| `/catalog`, `/services/:id`, `/schemas`, `/benchmarks`, `/openapi.json` | GET 200 for known resources      | yes                              | none                                         | bounded D1/read/serialization depending on route      | public discovery           |
| `/a2a`                                                                  | POST protocol endpoint           | yes                              | protocol validation                          | bounded CPU/signing; no paid provider                 | public protocol surface    |
| `/mcp`                                                                  | POST JSON-RPC                    | yes; unsolicited probes observed | discovery free; paid tools require economics | capped parsing; no provider/D1/storage before payment | public protocol surface    |
| CDP paid services `/v1/*`, `/v2/*`                                      | POST 404 under committed config  | no useful execution              | paid                                         | no work while disabled                                | disabled                   |
| Nevermined paid `/v2/nevermined/*`                                      | POST 404 under committed config  | no useful execution              | paid                                         | no work while disabled                                | disabled                   |
| callback/webhook paths                                                  | none found                       | no                               | N/A                                          | none                                                  | none                       |

`PUBLIC_SURFACES_ALREADY_ACTIVE = root, health, readiness, agent-card, JWKS, discovery/catalog/schema/benchmark/OpenAPI, A2A, MCP, MCP-registry-auth`  
`PUBLIC_SURFACES_EXPECTED_PRE_CUTOVER = same`  
`ACCIDENTALLY_PUBLIC_SURFACES = NONE IDENTIFIED`  
`PUBLIC_SURFACE_PROVIDER_COST_RISK = NONE for /mcp; bounded local/D1/signing cost elsewhere`

Paid-route cutover is not the Worker’s first Internet exposure. `/mcp` is
already independent of paid-route activation.

## 10. MCP_PRECUTOVER_EXPOSURE_ASSESSMENT

The MCP endpoint is a stateless HTTP JSON-RPC endpoint. Each request creates a
fresh server; no session identifier is required. Initialization and discovery
are public and governed. Six tools are advertised. Paid tool invocation without
valid economics returns a structured `payment_required` result and does not
enter paid service execution.

The route now measures and caps the actual request body at 1 MiB. It does not
trust an understated `Content-Length`. The first implementation used
`Request.clone()` and exposed a stream-tee cancellation deadlock; that was
isolated and replaced with one bounded stream read followed by request
reconstruction.

| Scenario                                   | Real-workerd result                     |
| ------------------------------------------ | --------------------------------------- |
| M1 malformed JSON-RPC                      | bounded 400 `Invalid JSON`              |
| M2 valid initialization/discovery          | governed 200 response, six tools        |
| M3 unknown method/tool                     | governed JSON-RPC `-32601` failure      |
| M4 unpaid paid-tool call                   | `payment_required`; zero paid execution |
| M5 oversized or understated-length request | bounded 413                             |
| M6 unauthenticated probe                   | zero billable provider invocation       |

`MCP_PUBLIC_NOW = YES`  
`MCP_DISCOVERY_AVAILABLE = YES`  
`MCP_PAID_INVOCATION_GATED = YES`  
`MCP_UNAUTH_PROVIDER_CALL_RISK = NONE IDENTIFIED`  
`MCP_RESOURCE_ABUSE_RISK = BOUNDED BODY/CPU, BUT APP-LAYER RATE LIMITING ABSENT (R1)`  
`MCP_400_OBSERVED_BEHAVIOR = EXPECTED`

### Pre-payment amplification

| Dimension                           | Finding                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `PREPAYMENT_CPU_AMPLIFICATION`      | bounded JSON parse/schema/tool dispatch within a 1 MiB measured body; repeated requests remain possible |
| `PREPAYMENT_PROVIDER_AMPLIFICATION` | none on `/mcp`; paid tool execution is not reached                                                      |
| `PREPAYMENT_STORAGE_AMPLIFICATION`  | none on `/mcp`; no D1/KV/R2/Queue call                                                                  |
| `PUBLIC_MCP_RATE_LIMITING`          | none at application layer                                                                               |
| `PUBLIC_SURFACE_DOS_RISK`           | residual R1/R2; bounded per request, not globally rate-limited                                          |

## 11. Production preflight and mutation proof

Entrypoint:

```text
pnpm production:preflight
```

It validates current live architecture rather than the historical resource list:
required DB binding, committed variables, compatibility date, entrypoint,
provider/environment configuration, canonical required secret names from
read-only Cloudflare inventory, signing configuration, and fixture-backed
production service construction. `--config-only` and an isolated `--config-path`
support deterministic configuration proofs without production mutation.

Current results:

- canonical config-only phase: `PASS`
- full production preflight: `FAIL`
  - repository-owned fixture-backed service executor (12/12)
  - external missing `NVM_API_KEY`

Fresh mutation proof:

1. canonical config-only preflight: PASS;
2. isolated temporary config changed the genuinely required D1 binding from `DB`
   to `BROKEN_DB`: FAIL;
3. temporary config removed;
4. canonical config-only preflight: PASS;
5. canonical working tree unchanged.

The pass/fail/pass mutation operates on the configuration phase because the
truthful full gate is already expected to fail on the two real blockers.

`PRODUCTION_PREFLIGHT_ENTRYPOINT = pnpm production:preflight`  
`PRODUCTION_CONFIG_DRIFT_CHECK = PASS`  
`PRODUCTION_PREFLIGHT_REGRESSION_CAUGHT = YES`

No billable/provider call is made by the preflight.

## 12. Upload, deployment, and route semantics

The current Wrangler/Cloudflare model separates version upload from production
deployment:

- `wrangler versions upload` creates a version but does not move production
  traffic.
- With the current `workers_dev`/preview configuration, upload can create a
  publicly addressable preview URL. “No production traffic” is not “no public
  traffic.”
- A later deployment selects a version for production traffic.
- Paid routes become reachable only when a reviewed version contains the
  activation variables and that version is deployed. The current committed
  version omits those variables and returns 404.
- `/mcp` is mounted independently and is already public; paid-route activation
  does not control it.
- Reversing paid-route exposure requires deploying a fail-closed version; there
  is no separately mutated route switch authorized here.

`UPLOAD_ALONE_PUBLIC_TRAFFIC = NO PRODUCTION TRAFFIC; YES PREVIEW-URL TRAFFIC`  
`PAID_ROUTE_ENABLEMENT_MECHANISM = reviewed activation configuration in a new version plus production deployment`  
`ROUTE_ENABLEMENT_SEPARATE_FROM_UPLOAD = YES for production traffic`  
`MCP_ROUTE_ENABLEMENT_SEPARATE_FROM_PAID_ROUTES = YES`

Every future mutating runbook command is marked **NOT EXECUTED IN SUN-1205**.

## 13. Rollback

`KNOWN_GOOD_PRODUCTION_VERSION = a4ada936-a434-4522-a8af-41c57170f4e4`

The production deployment remains `a85d3b6c-8cc2-4e6e-baf0-a81158a80be6` with
100% traffic on that known-good version. Uploaded versions 18 and 19 were
observed but are not deployed.

| Area                            | Finding                                                                                                   |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `ROLLBACK_DATA_COMPATIBILITY`   | PASS; migrations are additive and the known-good runtime remains compatible                               |
| `ROLLBACK_CONFIG_COMPATIBILITY` | PASS; known-good ignores additive/new fail-closed config and existing deployed resources remain available |
| `ROLLBACK_ROUTE_COMPATIBILITY`  | PASS; known-good keeps paid routes at 404 and MCP public                                                  |
| `IRREVERSIBLE_CUTOVER_ACTIONS`  | completed external payments/provider effects only; code rollback cannot reverse them                      |

No rollback or deployment command was executed.

## 14. Verification and regression ledger

All repository validation commands were run with Nevermined/CDP credentials and
live/registration/probe/recovery flags removed from child environments. No
provider/economic operation was possible.

### Focused and runtime proof

| Gate                             | Result                                                                     |
| -------------------------------- | -------------------------------------------------------------------------- |
| Focused MCP/paid-route hardening | 37/37 passed                                                               |
| Worker runtime                   | **61/61 passed**; prior 52 retained plus 9 MCP/preflight routing scenarios |
| Service runtime focused suite    | 145/145 passed                                                             |
| Nevermined focused suite         | 242/242 passed                                                             |
| x402 protocol                    | 504/504 passed                                                             |
| x402 property tests              | 20/20 passed                                                               |
| x402 fixture/spec audit          | passed                                                                     |
| MCP protocol/edge focused tests  | 30/30 plus 5/5 passed                                                      |

The first in-sandbox x402 fixture verifier attempt hit the known filesystem IPC
restriction (`tsx` socket `EPERM`). The identical credential-free command was
rerun outside that restricted shell and passed; it was not a code or protocol
failure.

### Full deterministic suite

`pnpm check`: PASS.

- root Vitest: **2,067 passed, 35 skipped**, 169 passing files and 19 skipped
  files;
- document worker: 81 passed;
- formatting, lint, monorepo typecheck, generated-artifact drift, Python,
  contracts, pricing, governance, state/tasks, migrations, D1, control plane,
  adapters, verification, service runtime, x402, MCP, A2A, Nevermined, and
  secret scanning passed;
- pre-report secret scan: 1,039 tracked files / 9,186,009 bytes, 8 required risk
  classes, 9 redacted detector probes, 158 Git commits / approximately 9.89 MB
  history, approximately 19.65 MB working directory, no leaks. The final stop
  report records the subsequent report-inclusive scan because a committed report
  cannot include the scan of its own commit.

`pnpm security:release`: PASS.

| Security/release gate              | Result                                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------------------------- |
| Semgrep                            | 50 rules, 531 files, 0 findings                                                              |
| OSV                                | 77 findings, 0 critical, 77 fixes available; frozen critical gate passed                     |
| Trivy                              | 7 findings, 0 blocking high/critical, 0 misconfigurations                                    |
| Schemathesis                       | 1,512/1,512 cases passed across 4 operations; four schema-validation warnings retained as R1 |
| Chaos                              | 18/18 passed                                                                                 |
| Load                               | 7/7 scenarios passed; 118 requests in the top-level release run                              |
| Worker runtime within release gate | 61/61 passed                                                                                 |

### Fresh mutation proofs

| Mutation proof                                    | Result                                 |
| ------------------------------------------------- | -------------------------------------- |
| Old runtime-AJV path                              | `OLD_VERIFY_PATH_CAUGHT = YES`         |
| x402 schema blocker                               | PASS; mutation restored                |
| Nevermined denial regression                      | PASS; mutation restored                |
| Production preflight required-DB mutation         | PASS; mutation restored                |
| MCP understated-length/oversize economic boundary | PASS in focused and real-workerd tests |

The working tree was clean after each proof.

## 15. Production bundle audit and reproducibility

Two `wrangler versions upload --dry-run --outdir <temporary>` builds were made.
No version was uploaded. Temporary bundles were removed after inspection.

| Field                                                               | Result                                                             |
| ------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Wrangler                                                            | 4.119.0                                                            |
| Bundle size                                                         | 6,416.41 KiB; gzip 1,048.20 KiB                                    |
| Core `index.js` SHA-256, build 1                                    | `39e4ee7cd3bec850659263e260f6c1ef3c86473197a1fc316b601eed1bb401de` |
| Core `index.js` SHA-256, build 2                                    | identical                                                          |
| Bare `eval(`                                                        | 0                                                                  |
| `new Function(`                                                     | 1, known AJV-generated validator internals                         |
| Request-reachable dynamic generation blocker                        | 0 identified                                                       |
| Worker-runtime test entrypoint                                      | absent                                                             |
| Explicit CDP fixture payment provider / Nevermined deny-test client | absent                                                             |
| Real CDP/Nevermined payment-provider code                           | present                                                            |
| Fixture service implementation markers                              | **present; R0**                                                    |
| Secret material                                                     | none                                                               |

`PRODUCTION_BUNDLE_REQUEST_RUNTIME_CRASH_BLOCKERS = 0`  
`PRODUCTION_PAYMENT_BYPASS_CODE = NONE`  
`PRODUCTION_TEST_CODE = NOT ABSENT: fixture service execution is production-reachable`  
`PRODUCTION_LIVE_PROVIDER_CODE = PRESENT for payment providers; NOT WIRED for live service execution`

The core runtime was byte-identical. `README` timestamps and source-map
`sourceRoot` temporary paths differed as expected metadata. If the candidate
were otherwise eligible, runtime reproducibility would be `YES` with explained
non-runtime metadata differences. Because an R0 remains, no release candidate
was frozen and the requested candidate reproducibility status is formally N/A.

## 16. Audited build identity; no release candidate freeze

This is an audited build identity, **not** a release-candidate manifest:

| Field                            | Value                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------ |
| Audited source SHA before report | `620243565d94447d14d0c04ce916b231baa96e45`                                                 |
| Lockfile SHA-256                 | `2c5ea71c07a8c900da69529a230702b6d879708488d51d255ccf01e8ff922669`                         |
| Node                             | `v24.18.1`                                                                                 |
| pnpm                             | `9.0.0`                                                                                    |
| Wrangler                         | `4.119.0`                                                                                  |
| compatibility date               | `2026-08-05`                                                                               |
| contract baseline                | `2.0.0`; descriptor SHA `8cbfada1cd03573038b824be5ba84c5fbdab3618fb69a2fed93e07cb11e64660` |
| service pricing hash             | `c58526ab1e039530ac80388bebd9c9ad4fc0979bdc154394d237454bbd84cec0`                         |
| document pricing hash            | `fd830b6024b2f63bd722b581b909036a4b9bc56e49d6a0c149dcc864702bdb3f`                         |
| migration head                   | `0007`; SHA `2ef2a881f21ecae8e13b2dc47060d214502322e7b427453616d8bf227a0256be`             |
| production config SHA            | `8af29d25bf71ba604bd242304ff38ef97c71f40db33f42a02811f0185455bc1c`                         |
| runtime bundle SHA               | `39e4ee7cd3bec850659263e260f6c1ef3c86473197a1fc316b601eed1bb401de`                         |

`RELEASE_CANDIDATE_MANIFEST = NOT_FROZEN`  
`CANDIDATE_BUILD_REPRODUCIBLE = N/A (audited runtime builds were byte-identical)`  
`REPRODUCIBILITY_DIFFERENCES = generated README timestamp and source-map sourceRoot only`

## 17. Zero production/economic mutation assertion

| Counter                            | Value |
| ---------------------------------- | ----- |
| `VERSION_UPLOADS`                  | 0     |
| `DEPLOYMENTS`                      | 0     |
| traffic shifts                     | 0     |
| route changes                      | 0     |
| secret creates/updates             | 0     |
| binding changes                    | 0     |
| production migrations              | 0     |
| `PAYMENT_SIGNATURES`               | 0     |
| `SETTLEMENTS`                      | 0     |
| `TRANSACTIONS`                     | 0     |
| `REAL_NEVERMINED_ECONOMIC_EFFECTS` | 0     |
| `LIVE_PROVIDER_CALLS_PERFORMED`    | 0     |
| `PRODUCTION_D1_WRITES`             | 0     |
| `PRODUCTION_KV_WRITES`             | 0     |
| `PRODUCTION_R2_WRITES`             | 0     |
| `PRODUCTION_QUEUE_WRITES`          | 0     |

Production inspection consisted only of Cloudflare metadata/secret-name reads
and bounded public HTTP behavior checks. No secret value was retrieved.

## 18. Final classification

`PREUPLOAD_RELEASE_GATE = FAIL`

Reasoning:

1. disk health is PASS;
2. committed cutover variables are now fail-closed;
3. real payment-provider construction is present and missing credentials fail
   closed;
4. public MCP exposure is understood, bounded, tested in real workerd, and
   cannot invoke billable providers without economics;
5. regressions, mutation proofs, bundle construction, and rollback audits are
   green;
6. **but production service execution remains fixture-backed for all 12 paid
   route configurations**, a repository-owned R0;
7. **and `NVM_API_KEY` is absent**, a separate external R0.

The repository-owned R0 takes precedence over the otherwise applicable
`EXTERNAL_BLOCK` classification. It must not be downgraded merely because the
external Nevermined secret is also missing.

`SUN1206_UPLOAD_AUTHORIZATION_ELIGIBLE = NO`

### Exact next checkpoint

Replace the production fixture service registry/executors with governed live
service/provider/worker/artifact wiring for every one of the 12 paid route
configurations, or keep any unsupported route structurally unreachable. Add
fail-closed missing-provider tests, rerun the credential-stripped preflight,
full regression, bundle audit, and mutation proofs. Only after that internal R0
is closed may a separately authorized operator provision `NVM_API_KEY` and rerun
the pre-upload gate. No upload authorization should be considered before both
conditions pass.

## 19. HUMAN_UPLOAD_AUTHORIZATION_PACKET

This packet is informational and **does not authorize SUN-1206**.

| Required item                                                  | Current answer                                                                                                                                                         |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Candidate SHA                                                  | none; candidate not eligible to freeze                                                                                                                                 |
| Audited source SHA                                             | `620243565d94447d14d0c04ce916b231baa96e45` before this report                                                                                                          |
| Current production version                                     | `a4ada936-a434-4522-a8af-41c57170f4e4`                                                                                                                                 |
| Major changes                                                  | fail-closed production CDP construction; real preflight; activation-var removal; measured MCP body limit; 61-scenario workerd gate; corrected cutover/rollback runbook |
| Public MCP status                                              | already public and receiving unsolicited machine traffic; discovery works; paid calls remain economically gated; 1 MiB cap; no app rate limit                          |
| Repository R0                                                  | production service executor is fixture-backed, 12/12                                                                                                                   |
| External R0                                                    | canonical `NVM_API_KEY` absent in Cloudflare                                                                                                                           |
| Remaining R1                                                   | MCP rate limiting, public preview semantics, unused deployed bindings, Schemathesis warnings                                                                           |
| Binding readiness                                              | required live `DB` exists; no missing live binding; five stale declarations                                                                                            |
| Payment-provider wiring                                        | 12/12 structurally present and fail-closed; not enabled                                                                                                                |
| Live service-provider wiring                                   | 0/12                                                                                                                                                                   |
| Workerd coverage                                               | 61/61                                                                                                                                                                  |
| Full regression                                                | `pnpm check` and `pnpm security:release` PASS                                                                                                                          |
| Bundle                                                         | no runtime crash blocker or payment bypass; fixture service code present                                                                                               |
| Rollback                                                       | known-good version and data/config/route compatibility validated                                                                                                       |
| Future upload command                                          | `pnpm exec wrangler versions upload --config wrangler.toml --strict --message "<approved SUN-1206 candidate>"` — **NOT EXECUTED IN SUN-1205**                          |
| Does upload change production traffic?                         | no                                                                                                                                                                     |
| Can upload create public exposure?                             | yes, a preview URL under current configuration                                                                                                                         |
| Does upload alone expose paid routes on the production origin? | no                                                                                                                                                                     |
| Can uploaded preview create economic exposure?                 | current fail-closed candidate keeps paid routes unavailable; never rely on this without repeating the gate on the exact SHA                                            |
| Proposed SUN-1206 scope                                        | none yet; complete the internal provider-wiring repair and external secret provisioning checkpoint first, then issue a new human authorization packet                  |

## 20. Stop boundary

SUN-1205 stops at a truthful failed pre-upload gate. It did not upload a
version, deploy, alter traffic, activate routes, modify secrets/bindings, run a
production migration, sign a payment, settle, transact, consume a Nevermined
entitlement, call a billable provider, or authorize SUN-1206.
