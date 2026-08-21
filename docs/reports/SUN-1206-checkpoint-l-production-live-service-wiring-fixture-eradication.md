# SUN-1206 Checkpoint L — production live-service wiring and fixture eradication

Date: 2026-08-20 Classification: source/test architecture hardening; no
production or economic mutation Final decision:
**`PREUPLOAD_RELEASE_GATE = EXTERNAL_BLOCK`** Upload authorization:
**`SUN1207_UPLOAD_AUTHORIZATION_ELIGIBLE = NO`**

SUN-1206 closes the repository-owned fixture-execution R0 without pretending
that an undocumented live service architecture exists. Repository authority
contains real service orchestrators and real payment-provider implementations,
but no complete governed Worker-compatible production service composition:
paid-service Ed25519 key custody is absent, the accepted service registry is
explicitly local/fixture-only, the Python document bridge is not Worker
compatible, Modal live artifact access remains unimplemented, and no complete
artifact/audit composition is wired. All twelve paid route configurations are
therefore structurally unavailable before economics. They cannot challenge,
verify, settle, execute, or fall back to fixture output.

The source defect is closed. The canonical production Nevermined secret name,
`NVM_API_KEY`, remains absent from the read-only Cloudflare secret-name
inventory. The gate is consequently `EXTERNAL_BLOCK`, not `PASS`, and no
candidate manifest or upload authorization is issued.

## 1. Repository

| Field                            | Evidence                                                                                                                     |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `START_HEAD`                     | `94fd03e4f2b4bf822e759969944de8a0e454225f`                                                                                   |
| SUN-1205 partial/history commits | preserved; no amend, rebase, reset, or rewrite                                                                               |
| Implementation commit            | `cd4a250c12a1d43d0557d582f40271ecbc7dff20` — `fix(production): isolate fixture service executors`                            |
| Closure report commit            | the commit containing this report; its SHA is recorded in the final stop report because a commit cannot contain its own hash |
| Working tree before report       | clean                                                                                                                        |
| Branch                           | `main`                                                                                                                       |

No `.wrangler` state, local database, temporary bundle, scanner output,
credential, authorization token, or payment material is committed.

Disk health remained stable throughout the heavy pass: `/dev/disk3s5`, 460 GiB
total, 58 GiB free, 87% capacity. The ignored repository `.wrangler` directory
was 3.0 MiB, ignored scanner output was 764 KiB, and Turbo cache was 17 MiB;
none presented an ENOSPC risk and none was committed.

`DISK_HEALTH_FOR_RELEASE_TESTING = PASS`

## 2. PRODUCTION_FIXTURE_REACHABILITY_GRAPH

### Before SUN-1206

```text
request
  -> production index route-family flag
  -> buildPaidServicesApp / buildNeverminedV2PaidServicesApp
  -> CDP or Nevermined economic boundary
  -> route executor
  -> buildFixtureRegistry
     -> SEC JSON / inline HTML / canned document WorkerResult
     -> FixtureDocumentWorkerBridge
     -> createFixtureSigner
     -> createTestClock
     -> createTestArtifactStore
     -> createTestServiceAuditSink
     -> execution_mode='fixture'
  -> paid response containing fixture-derived service output
```

This graph was reachable for all four services on v1 CDP, all four on v2 CDP,
and all four on v2 Nevermined: **12/12 route configurations**.

### Fixture component inventory

| Symbol/data                                                       | Source                                                                     | Production caller before repair                           | Affected routes | Classification                              | Behavior / replacement disposition                                                            |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------- | --------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `buildFixtureRegistry`                                            | `packages/service-runtime/src/wiring.ts`                                   | `apps/edge-api/src/control-plane/routes/paid-services.ts` | 12              | `FIXTURE_TEST_ONLY`                         | built four local fixture services; production import removed                                  |
| `createFixtureSigner`                                             | `packages/service-runtime/src/pcc/test-signer.ts`                          | paid-services constructor                                 | 12              | `FIXTURE_TEST_ONLY`                         | deterministic Ed25519 test key; no governed production receipt key exists, so routes disabled |
| `FixtureDocumentWorkerBridge`                                     | `packages/service-runtime/src/services/document-evidence/worker-bridge.ts` | document service wiring                                   | document routes | `FIXTURE_TEST_ONLY`                         | returned canned WorkerResult; production import removed                                       |
| `createTestClock`                                                 | `packages/service-runtime/src/context.ts`                                  | shared paid-service context                               | 12              | `FIXTURE_TEST_ONLY`                         | deterministic test time; production execution unavailable                                     |
| `createTestArtifactStore`                                         | `packages/service-runtime/src/context.ts`                                  | shared paid-service context                               | 12              | `FIXTURE_TEST_ONLY`                         | in-memory test artifacts; no historical `ARTIFACTS` resurrection                              |
| `createTestServiceAuditSink`                                      | `packages/service-runtime/src/context.ts`                                  | shared paid-service context                               | 12              | `FIXTURE_TEST_ONLY`                         | in-memory audit sink; production execution unavailable                                        |
| SEC submissions JSON                                              | provider-adapter fixture tree                                              | paid-services import                                      | company routes  | `FIXTURE_TEST_ONLY`                         | canned company evidence; production import removed                                            |
| inline HTML                                                       | paid-services source                                                       | fixture HTTP map                                          | web routes      | `FIXTURE_TEST_ONLY`                         | canned page content; production import removed                                                |
| document WorkerResult JSON                                        | service-runtime fixture tree                                               | paid-services import                                      | document routes | `FIXTURE_TEST_ONLY`                         | canned document processing; production import removed                                         |
| local service orchestrators, validators, PCC and receipt builders | service-runtime                                                            | fixture registry                                          | 12              | `SHARED_PURE` / partially production-shaped | remain tested; not a complete production composition by themselves                            |

`PRODUCTION_FIXTURE_COMPONENTS = 9 production-reachable fixture classes/data families before repair`
`PRODUCTION_FIXTURE_ROUTE_COUNT = 12`
`PRODUCTION_FIXTURE_REACHABILITY = 0/12 after repair (12/12 before)`

### After SUN-1206

```text
request
  -> production index route-family flag
  -> productionServiceExecutorUnavailable
  -> 503 service_executor_not_configured
  -> no quote or payment header
  -> no payment provider
  -> no service registry
  -> no service/provider/artifact/signer/audit/storage work
```

The production entrypoint has no static or dynamic import of the fixture-backed
paid-services module.

## 3. LIVE_SERVICE_IMPLEMENTATION_MATRIX

The repository's four service orchestrators are useful implementation work, but
the accepted registry records `productionEnabled: false` and
`local_fixture_verified`/`not_implemented`. A complete Worker production graph
was not found.

| Service/version                | Route configurations | Existing implementation evidence                     | Missing governed production dependencies                                                                           | SUN-1206 status                         |
| ------------------------------ | -------------------: | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| `company_evidence_graph.v1/v2` |                    3 | service orchestrator and provider adapter interfaces | live provider policy/composition, production receipt signer, artifact/audit persistence                            | `PARTIALLY_IMPLEMENTED`; disabled       |
| `web_context_verified.v1/v2`   |                    3 | direct HTTP orchestration and SSRF guards            | production composition/signer/artifact/audit; rendered mode truthfully remains unavailable                         | `PARTIALLY_IMPLEMENTED`; disabled       |
| `document_evidence_json.v1/v2` |                    3 | local Python subprocess bridge and document worker   | Worker-compatible bridge; Modal live artifact accessor raises `NotImplementedError`; production signer/store/audit | `MISSING_LIVE_IMPLEMENTATION`; disabled |
| `verify_agent_output.v1/v2`    |                    3 | deterministic verification orchestrator/Profile 1    | production signer/key registry and artifact/audit composition                                                      | `PARTIALLY_IMPLEMENTED`; disabled       |

### Production component disposition

| Component                                | Governing result                                                                                                            |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `PRODUCTION_SERVICE_REGISTRY`            | no paid registry is constructed until a separately governed live composition exists                                         |
| `PRODUCTION_REGISTRY_CONTAINS_FIXTURES`  | `NO`                                                                                                                        |
| paid receipt signer                      | unimplemented; Agent Card ES256 key is A2A-specific and was not repurposed as an Ed25519 paid-evidence key                  |
| `PRODUCTION_FIXTURE_SIGNER_REACHABLE`    | `NO`                                                                                                                        |
| `DOCUMENT_WORKER_MODE`                   | unavailable in Worker production; local subprocess is test/integration only and Modal live artifact access is unimplemented |
| `FIXTURE_DOCUMENT_BRIDGE_REACHABLE`      | `NO`                                                                                                                        |
| production clock                         | platform time would be the ordinary source, but no paid execution is constructed; test clock unreachable                    |
| `PRODUCTION_TEST_CLOCK_REACHABLE`        | `NO`                                                                                                                        |
| `PRODUCTION_ARTIFACT_STORE`              | no governed paid-service store wired; routes disabled; stale historical `ARTIFACTS` binding not resurrected                 |
| `TEST_ARTIFACT_STORE_REACHABLE`          | `NO`                                                                                                                        |
| production audit sink                    | no governed paid-service sink wired; routes disabled rather than silently losing contract evidence                          |
| `PRODUCTION_TEST_AUDIT_SINK_REACHABLE`   | `NO`                                                                                                                        |
| `PRODUCTION_INLINE_SERVICE_FIXTURE_DATA` | `NONE`                                                                                                                      |
| `PRODUCTION_EXECUTION_MODE_FIXTURE`      | `IMPOSSIBLE`                                                                                                                |

`LIVE_SERVICE_PROVIDER_WIRING = 0/0 retained release-eligible paid routes`. This
is not a disguised 12/12 claim: all twelve configurations are explicitly
unsupported and disabled. No route is advertised as live.

## 4. Route disposition — all 12 configurations

| Route                                   | Rail       | Disposition     | Before economics? |
| --------------------------------------- | ---------- | --------------- | ----------------- |
| `/v1/company/evidence-graph`            | CDP/x402   | 503 unavailable | yes               |
| `/v1/web/context`                       | CDP/x402   | 503 unavailable | yes               |
| `/v1/document/evidence-json`            | CDP/x402   | 503 unavailable | yes               |
| `/v1/verify/agent-output`               | CDP/x402   | 503 unavailable | yes               |
| `/v2/company/evidence-graph`            | CDP/x402   | 503 unavailable | yes               |
| `/v2/web/context`                       | CDP/x402   | 503 unavailable | yes               |
| `/v2/document/evidence-json`            | CDP/x402   | 503 unavailable | yes               |
| `/v2/verify/agent-output`               | CDP/x402   | 503 unavailable | yes               |
| `/v2/nevermined/company/evidence-graph` | Nevermined | 503 unavailable | yes               |
| `/v2/nevermined/web/context`            | Nevermined | 503 unavailable | yes               |
| `/v2/nevermined/document/evidence-json` | Nevermined | 503 unavailable | yes               |
| `/v2/nevermined/verify/agent-output`    | Nevermined | 503 unavailable | yes               |

With route flags absent, the families remain 404. If either family flag is
mistakenly enabled, the deterministic 503 is defense in depth. It emits neither
`PAYMENT-REQUIRED` nor `PAYMENT-RESPONSE`.

`UNSUPPORTED_SERVICE_PREPAYMENT_FAIL_CLOSED = YES`
`UNSUPPORTED_SERVICE_CAN_SETTLE = NO`
`FIXTURE_FALLBACK_AFTER_PAYMENT = IMPOSSIBLE`

## 5. Regression-first proof and real workerd

The new production isolation test was run against the old entrypoint first. All
twelve scenarios failed, demonstrating that the historical production graph did
not reach the required pre-economic unavailability boundary. After the repair,
all twelve pass and verify status, exact governed error, absent payment headers,
and absent fixture output.

`PAID_FIXTURE_EXECUTION_REGRESSION_CAUGHT = YES`

The production fixture-reintroduction mutation proof temporarily adds a fixture
paid-services import to the actual production entrypoint. The config-only
preflight rejects the mutant, and the script restores the source byte-for-byte.

`PRODUCTION_FIXTURE_REINTRODUCTION_CAUGHT = YES`

### LIVE_EXECUTION_WORKERD_MATRIX

| Phase                                                   | Module graph                                                            |                                 Coverage | Result                                                                             |
| ------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------: | ---------------------------------------------------------------------------------- |
| production entrypoint, flags absent                     | actual `wrangler.toml`                                                  |        v1/v2 404 + public MCP boundaries | pass                                                                               |
| production entrypoint, both family flags command-scoped | actual production routing and unavailable executor                      |                             12/12 routes | pass: 503 before economics                                                         |
| test-only paid-service graph                            | real service orchestrators with narrow synthetic payment/provider edges | Profile 1, v1 CDP, v2 CDP, v2 Nevermined | pass; preserves payment/service correctness without making it production-reachable |

`LIVE_SERVICE_WORKERD_COVERAGE = 0/0 positive live executors; 12/12 unsupported route dispositions proven under real workerd`
`WORKER_RUNTIME = 66/66`

### SUN1206_SYNTHETIC_BOUNDARY_MATRIX

Tests substitute only unavoidable external/economic boundaries: facilitator
verify/settle, Nevermined verify/settle, external HTTP/provider responses, and
document-worker fixtures in test-only graphs. Routing, request validation,
economic state machines, Payment-Identifier binding, service orchestration,
PCC/receipt/PSL construction, replay, D1 persistence, and provider-selection
policy remain real. The production-entrypoint phase uses no synthetic service
executor at all.

## 6. Payments, MCP, evidence truth, and abuse boundaries

Payment-provider code and the independently accepted payment architecture were
not rewritten. Direct tests prove CDP/x402 and Nevermined verification,
settlement, denial, recovery, replay, malformed/tampered payment rejection, and
canonical pricing. The production entrypoint cannot construct those providers
until a governed service executor exists.

The already-public `/mcp` route remains independent of paid-route flags.
Real-workerd proofs show:

- malformed JSON-RPC is bounded at 400;
- initialization/discovery returns six governed tools;
- unknown methods are governed failures;
- unpaid paid-tool calls stop at `payment_required`;
- oversized input is rejected at 413;
- unauthenticated probes produce zero provider or live-service execution.

`MCP_UNAUTH_PROVIDER_CALL_RISK = NONE`
`MCP_UNAUTH_LIVE_SERVICE_EXECUTION = NONE`
`REQUEST_CONTROLLED_PAYMENT_BYPASS = NONE`

Because production paid execution is unreachable, production emits no paid
receipt with a false fixture provenance label. In test-only positive paths,
receipt/PCC/PSL verification remains cryptographic and service/version/input/
output/payment bound. A future live executor must introduce and test its own
truthful live provider and execution metadata before any route can be retained.

`LIVE_RECEIPT_PROVENANCE_TRUTHFUL = PASS (fail-closed non-emission in production; cryptographic test-only regression remains green)`

## 7. Bindings, secrets, and preflight

Fixture eradication introduced no new production resource requirement because
unsupported execution was disabled rather than silently inventing
infrastructure.

`NEW_REQUIRED_PRODUCTION_BINDINGS = NONE`
`NEW_REQUIRED_PRODUCTION_SECRET_NAMES = NONE`
`NEW_EXTERNAL_PROVISIONING_BLOCKERS = existing canonical NVM_API_KEY only`

The prior binding/secret audit remains authoritative:

- `DB` is the required live D1 binding and is declared/present;
- `CATALOG`, `JOBS`, `EVENTS`, `AI`, and `BROWSER` remain deployed but have no
  current production source dereference;
- historical `ARTIFACTS` is not a live source dependency and was not restored;
- Cloudflare secret names present: `AGENT_CARD_SIGNING_PRIVATE_KEY`,
  `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`;
- required canonical Nevermined secret `NVM_API_KEY` (or deprecated alias) is
  absent.

`pnpm production:preflight --config-only` passes and reports:

```text
12/12 paid routes are structurally unavailable before economics;
production imports no fixture service executor.
```

The full read-only preflight passes bindings, committed vars, activation-var
closure, config drift, and fixture isolation, then exits 1 with exactly the
external missing-secret blocker.

An isolated config mutation renamed the required D1 binding from `DB` to
`DB_MUTANT`; preflight failed, the temp config was removed, and canonical
preflight passed again.

`PRODUCTION_CONFIG_DRIFT_CHECK = PASS`
`PRODUCTION_PREFLIGHT_REGRESSION_CAUGHT = YES`
`PRODUCTION_PREFLIGHT_RESULT = EXTERNAL_BLOCK`

## 8. Fresh mutation proofs

| Proof                                | Result                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------ |
| historical request-time AJV verifier | `OLD_VERIFY_PATH_CAUGHT = YES`; restored path returned real 200          |
| x402 sanitizer/schema blocker        | mutant reproduced 400; restored path returned real 200                   |
| Nevermined denial                    | mutant changed the N4 denial signal; restored path returned exact denial |
| production D1 binding                | mutant failed preflight; canonical config passed                         |
| production fixture import            | mutant failed preflight; canonical source restored byte-for-byte         |

The tree was clean after every proof.

## 9. Full regression ledger

All repository commands ran with Nevermined/CDP credentials and every
live/registration/probe/recovery flag removed from the child environment.

| Gate                          | Result                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------- |
| focused production isolation  | 12/12                                                                         |
| focused index/MCP matrix      | 39/39                                                                         |
| full root Vitest              | 170 files passed, 19 skipped; **2,079 passed, 35 guarded live tests skipped** |
| service runtime               | 145/145 plus 3/3 property                                                     |
| document worker               | 81/81; lint/typecheck/import/16 fixture manifest passed                       |
| x402                          | 504/504 plus 20/20 property and fixture/spec audit                            |
| Nevermined                    | 242/242 plus 165/165 compatibility matrix                                     |
| Profile 1                     | 55/55; positive/negative real-workerd differential passed                     |
| MCP                           | 30/30 protocol, 30/30 property/config, 5/5 edge, package pack/install passed  |
| A2A                           | 44/44 plus 6/6 property and 2/2 edge                                          |
| PCC Python                    | 91/91                                                                         |
| provider adapters / SSRF      | 170 passed, 6 guarded live skipped; 16 property; 103 fixture matrix           |
| contracts / schemas / pricing | baseline, compatibility, release, generated drift and pricing passed          |
| D1/migrations/control plane   | passed; migration head `0007`                                                 |
| governance/state/tasks        | passed                                                                        |
| `pnpm check`                  | **PASS**                                                                      |
| Semgrep                       | 50 rules, 533 tracked files, 0 findings                                       |
| OSV                           | 77 advisories, 77 fixes available, **0 critical** under frozen policy         |
| Trivy                         | 7 findings, 0 blocking high/critical, 0 misconfigurations                     |
| Schemathesis                  | 1,512/1,512 generated cases; 4 known schema-validation warnings retained      |
| chaos                         | 18/18                                                                         |
| load                          | 7/7; 118 requests in campaign                                                 |
| real workerd                  | **66/66**                                                                     |
| `pnpm security:release`       | **PASS**                                                                      |

Final pre-report secret scan:

- 1,043 tracked files / 9,229,317 bytes;
- 8 required risk classes;
- 9 redacted detector probes;
- 160 commits / 9,966,337 bytes history scanned, no leaks;
- 19,641,277 working-directory bytes scanned, no leaks.

## 10. Production bundle audit and reproducibility

Two credential-stripped `wrangler deploy --dry-run` builds were produced in
explicit temporary directories and removed after inspection. This performs no
upload or deployment.

| Field                                           | Result                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| Wrangler                                        | `4.119.0`                                                          |
| runtime `index.js` bytes                        | `2,643,822`                                                        |
| source map bytes                                | `5,717,726`                                                        |
| upload / gzip                                   | 2,581.86 KiB / 447.68 KiB                                          |
| runtime SHA-256, both builds                    | `5d969493edd11f4127643ae5af3adc961f2ffce15a97a726b9c98524ca10844b` |
| bare `eval(`                                    | 0                                                                  |
| `new Function(`                                 | 1, known generated validator/runtime dependency                    |
| request-reachable runtime crash blockers        | 0                                                                  |
| Worker test entrypoint                          | absent                                                             |
| fixture/deny/synthetic payment-provider markers | absent                                                             |
| paid-service fixture runtime markers            | **0**                                                              |
| secret material                                 | none                                                               |

The runtime JavaScript is byte-identical across different output directories.
Source maps differ only when their absolute temporary output directory differs;
rebuilding twice in the same output directory produces byte-identical runtime
and map files.

`CANDIDATE_BUILD_REPRODUCIBLE = YES for material runtime; explained path-dependent source-map metadata across different outdirs`
`PRODUCTION_RUNTIME_FIXTURE_MARKERS = 0` `PRODUCTION_PAYMENT_BYPASS_CODE = NONE`
`PRODUCTION_TEST_CODE = ABSENT`
`PRODUCTION_LIVE_SERVICE_CODE = NOT PRESENT; routes truthfully disabled`
`PRODUCTION_BUNDLE_REQUEST_RUNTIME_CRASH_BLOCKERS = 0`

## 11. Audited identity, rollback, and candidate status

This is an audited build identity, not a frozen release-candidate manifest:

| Field                     | Value                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| source SHA before report  | `cd4a250c12a1d43d0557d582f40271ecbc7dff20`                                                 |
| lockfile SHA-256          | `2c5ea71c07a8c900da69529a230702b6d879708488d51d255ccf01e8ff922669`                         |
| Node                      | `v24.18.1`                                                                                 |
| pnpm                      | `9.0.0`                                                                                    |
| Wrangler                  | `4.119.0`                                                                                  |
| compatibility date        | `2026-08-05`                                                                               |
| contract baseline         | `2.0.0`; descriptor SHA `8cbfada1cd03573038b824be5ba84c5fbdab3618fb69a2fed93e07cb11e64660` |
| migration head            | `0007`; SHA `2ef2a881f21ecae8e13b2dc47060d214502322e7b427453616d8bf227a0256be`             |
| production config SHA-256 | `8af29d25bf71ba604bd242304ff38ef97c71f40db33f42a02811f0185455bc1c`                         |
| runtime bundle SHA-256    | `5d969493edd11f4127643ae5af3adc961f2ffce15a97a726b9c98524ca10844b`                         |

`RELEASE_CANDIDATE_MANIFEST = NOT_FROZEN` because the external secret blocker
remains.

The known-good production Worker version remains
`a4ada936-a434-4522-a8af-41c57170f4e4`, at 100% traffic in deployment
`a85d3b6c-8cc2-4e6e-baf0-a81158a80be6`. Migrations remain additive; the
known-good disabled runtime ignores new fail-closed source/config; paid routes
remain 404; `/mcp` remains independently public. Code rollback cannot reverse a
completed external payment, but no payment occurred here.

## 12. Production/economic state

| Counter                            | Value |
| ---------------------------------- | ----: |
| `VERSION_UPLOADS`                  |     0 |
| `DEPLOYMENTS`                      |     0 |
| `TRAFFIC_SHIFTS`                   |     0 |
| route changes                      |     0 |
| `SECRET_CREATES_OR_UPDATES`        |     0 |
| `BINDING_CHANGES`                  |     0 |
| production migrations              |     0 |
| production D1 writes               |     0 |
| production KV writes               |     0 |
| production R2 writes               |     0 |
| production Queue writes            |     0 |
| `PAYMENT_SIGNATURES`               |     0 |
| `SETTLEMENTS`                      |     0 |
| `TRANSACTIONS`                     |     0 |
| `REAL_NEVERMINED_ECONOMIC_EFFECTS` |     0 |
| `LIVE_PROVIDER_CALLS_PERFORMED`    |     0 |

Cloudflare interaction was limited to read-only deployments/version/secret-name
metadata and bounded public HTTP behavior checks. No secret value was read.

## 13. Final classification

```text
REPOSITORY_FIXTURE_R0                 CLOSED
LIVE_SERVICE_PROVIDER_WIRING          0/0 retained live routes
PRODUCTION_FIXTURE_FALLBACK           NONE
PREUPLOAD_RELEASE_GATE                EXTERNAL_BLOCK
SUN1207_UPLOAD_AUTHORIZATION_ELIGIBLE NO
RELEASE_CANDIDATE_MANIFEST            NOT_FROZEN
```

The 0/0 wiring result is an explicit fail-closed product boundary: twelve
unsupported route configurations are disabled and none is misrepresented as a
live paid service. The next source checkpoint must not manufacture 12/12 from
test fixtures.

### Exact next action

No upload is authorized. The next action requiring separate explicit human
authorization is to provision the canonical production `NVM_API_KEY` Cloudflare
secret using the approved operator procedure, then rerun the complete pre-upload
gate against the exact resulting candidate state. That action was not performed
or authorized by SUN-1206.

## 14. Human upload-authorization packet (informational only)

| Item                               | Answer                                                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| candidate SHA                      | none; external blocker prevents freeze                                                                                               |
| current production version         | `a4ada936-a434-4522-a8af-41c57170f4e4`                                                                                               |
| major source change                | production fixture graph removed; all 12 unsupported paid routes stop at pre-economic 503                                            |
| public `/mcp`                      | already public; discovery governed; unpaid execution blocked; no live provider/service execution                                     |
| repository R0                      | none for fixture reachability                                                                                                        |
| external R0                        | canonical `NVM_API_KEY` absent                                                                                                       |
| remaining R1                       | MCP application-layer rate limiting, public preview semantics, unused deployed bindings, Schemathesis warnings                       |
| binding readiness                  | required `DB` present; no new binding invented                                                                                       |
| provider wiring                    | payment implementations preserved in tested modules; zero retained production service executors                                      |
| workerd                            | 66/66                                                                                                                                |
| full regression                    | `pnpm check` and `pnpm security:release` pass                                                                                        |
| bundle                             | material runtime reproducible; fixture markers zero; test entrypoint absent                                                          |
| rollback                           | known-good version and config/data/route compatibility remain valid                                                                  |
| future upload command              | `pnpm exec wrangler versions upload --config wrangler.toml --strict --message "<approved candidate>"` — **NOT EXECUTED**             |
| upload changes production traffic? | no; it may create a public preview URL                                                                                               |
| upload exposes paid execution?     | not in this disabled source state; upload is still unauthorized                                                                      |
| proposed next scope                | separately authorize secret provisioning, rerun exact pre-upload gate, and only then decide whether an upload checkpoint is eligible |

## 15. Stop boundary

SUN-1206 stops at a truthful external block. It did not upload, deploy, alter
traffic, activate a route, provision a secret or binding, create a production
resource, write production storage, sign or settle a payment, transact, consume
a Nevermined entitlement, call a billable provider, freeze a release candidate,
or authorize SUN-1207.
