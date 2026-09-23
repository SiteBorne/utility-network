# PCC-V3-IMMUTABLE-CANDIDATE-QUALIFICATION-01

## Verdict and boundary

**BLOCKED.** This checkpoint repaired source-proven stale candidate economics
and qualified substantial local behavior, but it did **not** freeze an
upload-eligible immutable v3 source candidate. `ZERO_TRAFFIC_UPLOAD_READY=NO`.
The remaining publication and qualification gaps below must be closed and the
entire final candidate requalified before naming an immutable candidate SHA.
This report and the repairs are committed locally; a report commit is not a
deployment candidate.

Starting HEAD: `3e98192dbbad6e5775c06669cf03d6a19f767447`. Starting tree was
clean (`git status --short` and both diff commands empty). Pre-existing stash
`stash@{0}` (`WIP on main: 3c64615 SUN-0300...`) was not applied, dropped, or
changed. All work was local. Worker uploads, deployments, traffic changes,
continuation-host/alert-worker deployments, cloud-secret changes, production D1
writes, real payments, and pushes: **0**.

## Price authority and repair

`governance/RISK_LIMITS.yaml` is the canonical price table.
`packages/pricing/src/service-prices.ts` identifies it as such and its
Worker-safe embedded mirror passes `pnpm pricing:check`.
`packages/pricing/src/economic-contract.ts` derives each v3 offer from its v2
definition. The verify standard mode uses `verify_agent_output_standard_v2` (USD
**0.017**), and
`apps/edge-api/src/control-plane/production/verify-agent-output-v2-cdp-composition.ts`
uses that same key for v3. Six-decimal USDC yields **17000 atomic units**. The
v1 verify key is USD 0.019 and must not be substituted for v3.

### Verify v3 economic truth matrix at starting HEAD

| Surface                                        | Observed value                                  | Authority/source                                                                                                                           |
| ---------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Governed v2/v3 standard price                  | USD 0.017                                       | `governance/RISK_LIMITS.yaml`, `verify_agent_output_standard_v2`                                                                           |
| v1 standard price (distinct identity)          | USD 0.019                                       | Same YAML, `verify_agent_output_standard`                                                                                                  |
| Runtime offer and quote key                    | USD 0.017 / 17000                               | `packages/pricing/src/economic-contract.ts`; verify v3 CDP composition                                                                     |
| x402 exact requirement and settlement          | 17000 atomic USDC                               | Runtime quote/requirement from the same v2 key; `pnpm x402:check`                                                                          |
| Registry and VCM price mapping                 | USD 0.017                                       | `registry/services/verify_agent_output.v3.json`; `packages/vcm/src/legacy/pricing-map.ts`                                                  |
| MCP, A2A, catalog, Bazaar, health              | Derived from governed offer/registry; USD 0.017 | `packages/protocol-mcp`, `packages/protocol-a2a`, `apps/edge-api/src/control-plane/routes/catalog.ts`, `packages/protocol-x402/src/bazaar` |
| Nevermined declaration/fixture                 | 17000 atomic                                    | `packages/protocol-nevermined/src/declarations.ts`, `fixtures/declarations-baseline.json`                                                  |
| Frozen Release 3 metadata                      | **USD 0.019**                                   | `contracts/releases/3.0.0/metadata/verify_agent_output.v3.json`; stale copy                                                                |
| OpenAPI, Service Contract, signed PCC examples | No independent verify price authority           | Release 3 contract/proof artifacts; no repricing instruction                                                                               |

`VERIFY_V3_CANONICAL_PRICE_USD=0.017`;
`VERIFY_V3_CANONICAL_ATOMIC_AMOUNT=17000`;
`VERIFY_V3_METADATA_0019_CLASSIFICATION=STALE_METADATA`. No price, quote,
requirement, settlement, network, asset, payee, rail, or historical release
definition was changed.

The all-service inventory also found three stale Release 3 metadata values and
generic scheme declarations. Candidate metadata was corrected to the inherited
v2 economics; v3 registry and Release 3 metadata now advertise each service's
actual scheme, and Release 3 metadata matches the registry's
`executable_candidate` state. Only `.v3` registry and Release 3 metadata were
edited. `SHA256SUMS` was updated for exactly the four changed files.

| v3 service                  |                                             Governed/default offer |  Atomic amount for default price | Scheme | Candidate metadata base / max | Local economic parity          |
| --------------------------- | -----------------------------------------------------------------: | -------------------------------: | ------ | ----------------------------- | ------------------------------ |
| `company_evidence_graph.v3` |                                                         USD 0.0312 |                            31200 | exact  | 0.0312 / 0.0312               | PASS                           |
| `web_context_verified.v3`   |                                                          USD 0.008 |                             8000 | exact  | 0.008 / 0.008                 | PASS                           |
| `document_evidence_json.v3` |       USD 0.0098 native page, variable tiers, USD 0.19 job ceiling | 9800 native tier, 190000 maximum | upto   | 0.0098 / 0.19                 | PASS                           |
| `verify_agent_output.v3`    | USD 0.017 standard; USD 0.049 reproduction defined but unavailable |                   17000 standard | exact  | 0.017 / 0.049                 | PASS for offered standard mode |

`pnpm pricing:check`, `pricing:registry:check`, release verification, all SHA256
checks, candidate release tests, Nevermined declarations, MCP frozen contracts,
VCM parity, and Bazaar roundtrip passed after repair. The display currency is
USD; the runtime x402 destination remains the existing CDP Base Sepolia USDC
asset and `SELLER_WALLET_ADDRESS`. The actual asset address and receiving
address are resolved from runtime configuration, not duplicated in candidate
metadata. This checkout cannot prove the live bound values without a separate
readback. `PRICING_CHANGED=NO`, `PAYMENT_REQUIREMENT_ECONOMICS_CHANGED=NO`,
`SETTLEMENT_AMOUNT_CHANGED=NO`, `NETWORK_CHANGED=NO`, `ASSET_CHANGED=NO`,
`PAYEE_CHANGED=NO`, `PAYMENT_RAIL_CHANGED=NO` relative to starting HEAD.

## Local behavior freeze evidence

The inherited PCC 2.0.0 / Service Contract 3.0.0 architecture was not
redesigned. Source and focused tests retain full-PCC wire root, reconstructible
signed preimage, R2 `results/pcc/` content-addressed storage,
schema/crypto/persistence readiness before settlement, exact initial/replay
artifact use, and fail-closed legacy sensitive unbound result handling. Focused
vNext proof and release-example tests pass **15/15** after the tests pin the
recorded fixture Node version `v24.18.1` and restore the process descriptor; no
signed fixture or proof source changed. The previous direct run without pinning
showed environment-sensitive golden comparisons.

Authorization enforcement remains additive to the historical payment replay
binding. `result-authorization-enforcement`,
`result-authorization-real-rest-flow`, D1, route timing, and contract-invariant
tests passed. The real REST tests cover document and verify initial/replay
policy equality without rerunning the provider; route timing tests prove subject
binding before provider invocation. Source requires a server-verified OIDC or
mapped Cloudflare mTLS principal, rejects self-asserted arbitrary headers and
MCP metadata as identity, and routes both initial and cached sensitive results
through the policy. Payer and replay-tuple possession alone do not release
sensitive results. Buyer-authorized v3 routes additionally require exact
`BUYER_AUTHORIZED_V3_ROUTE_ENABLED=true`, existing service gate, exact candidate
selector, and configured subject-reference key. Public company/web retain public
classification. `REPLAY_BINDING_FIELDS_CHANGED=NO`; `BINDING_DIGEST_CHANGED=NO`.

The v3 route requires exactly
`RESULT_CONTRACT_RELEASE_SELECTION=3.0.0-public-candidate`; absent or other
values return not found. Wrangler config contains no activating selector or
paid-route gate. V2 remains the default and no v3 execution or quote is selected
by fallback. `ACCIDENTAL_V3_DEFAULT_ACTIVATION_PATHS=0` in the inspected route
source and focused tests.

MCP source and packed output were both checked: `pnpm mcp:check` passed,
including clean protocol build, 10-tool fixture, stdio package build, metadata
verification, and offline pack/install check. `pnpm x402:check`, `a2a:check`,
`nevermined:check`, and `migrations:verify` passed. Migration verification
applies through `0011_result_authorization.sql` on local Miniflare D1 and checks
constraints/concurrency; an upgrade from an independently captured **current
production schema** was not run. Thus `V3_LOCAL_MIGRATION_CHAIN=FAIL` for the
full requested scope, despite the fresh local chain passing.

The prior wire and authorization reports document execute → freeze → PCC →
schema/crypto validation → stage exact bytes → persistence readiness → settle →
commit reference → release; retry after `persistence_failed_after_settlement`
reuses staged bytes and settlement evidence. The local focused tests support
these invariants. This checkpoint did not exhaustively reprove every negative
route and cannot assert a new exhaustive path count; the previous qualified
design states zero pre-ready-settlement and double-settlement paths, but **this
freeze gate remains unclosed**.

## Public artifacts and remaining blockers

1. `pnpm pcc:generate:check`, `services:generate:check`,
   `openapi:generate:check`, and `schemas:check` passed.
   `pnpm publication:check` failed on all four `.v3` output schema URLs:
   `https://utility.siteborne.net/contracts/3.0.0/...` is outside the
   publication generator's canonical `https://siteborne.net/schemas/...` origin.
   No route serving those Release 3 URLs was found in `apps/edge-api/src`
   (excluding generated validators). The frozen schema hashes are internally
   checked, but a reachable/publication contract for the candidate URLs has not
   been established. `V3_GENERATED_ARTIFACT_DRIFT=4` reported URL violations;
   `V3_CROSS_SURFACE_PARITY=FAIL` for public followability. This was present at
   starting HEAD and is candidate-owned, not a reason to fabricate a clean
   generator gate.
2. Broad `pnpm test` at this checkout reported **4489 passed, 61 failed, 79
   skipped** across 368 files. Focused A2A shadow tests had stale eight-skill
   assertions; they were changed to the governed service-ID count and now pass
   13/13. Focused signed v3 fixture tests now pass 15/15 with the fixture
   runtime pinned. The aggregate has **not been rerun** after those fixes. Other
   failures include aggregate timeouts in D1 operator/load tests and an isolated
   VCM deep-nesting expectation mismatch (also reproducible alone). These are
   unresolved baseline findings, not green tests. Credential-gated skipped tests
   are not counted as passes.
3. The final-source local Worker dry run succeeded using Wrangler 4.119.0:
   `pnpm exec wrangler deploy --dry-run --outdir /tmp/siteborne-v3-candidate-build-final --config wrangler.toml`.
   It emitted `index.js` (5,508,569 bytes; SHA-256
   `c496932362cd3e24387e67d0ea9aa938b55eed541852dab94faea047bc86a1e9`) plus map
   and README; reported upload size 5379.46 KiB / gzip 839.39 KiB. The bundle
   contains candidate selector, v3 verify identity, and `results/pcc/`. An
   active-deployment source comparison remains required.
   `DEPLOY_ARTIFACT_SCOPE=FAIL` pending that comparison.
4. Release 3 checksums pass with every listed file verified. No historical
   Release 1.0.0, 1.0.1, 2.0.0 or active `.v2` artifact was edited
   (`HISTORICAL_RELEASE_MUTATIONS=0`). Release 3 metadata edits were accompanied
   by exact checksum changes; no new release file was added.

### Deployment binding and secret inventory (no value readback)

| Candidate dependency                                                                                 | Status                                  | Basis / future proof                                                                                              |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| D1 `DB`, R2 `ARTIFACTS`, Workflow `PAID_CONTINUATION_WORKFLOW`, KV `CATALOG`, queues `JOBS`/`EVENTS` | EXISTING_NEEDS_READBACK                 | Present in `wrangler.toml` and local dry-run binding listing; live ownership/version/state not checked            |
| `AI`, `BROWSER`, `STORAGE_ALERT_RECEIVER`                                                            | EXISTING_NEEDS_READBACK                 | Local binding listing; candidate execution dependency must be reconciled with active deployment                   |
| `RESULT_CONTRACT_RELEASE_SELECTION`, `BUYER_AUTHORIZED_V3_ROUTE_ENABLED`                             | NEW_REQUIRED for later activation       | Absent from current Wrangler vars; **must remain absent for 0%-traffic upload**                                   |
| CDP payment configuration, seller payee, receipt signer/JWKS, continuation encryption                | EXISTING_NEEDS_READBACK                 | Env/composition references; no cloud secret or value queried                                                      |
| `RESULT_AUTH_OIDC_ISSUERS_JSON`, `RESULT_AUTH_MTLS_REGISTRY_JSON`                                    | NEW_REQUIRED for buyer route activation | Runtime accepts configured trust issuers / mTLS registry; independently verify trust and edge certificate mapping |
| `RESULT_SUBJECT_REFERENCE_KEY`, `RESULT_SUBJECT_REFERENCE_KEY_VERSION`                               | NEW_REQUIRED for buyer route activation | Versioned ≥32-byte HMAC key, never printed; absent fails closed                                                   |

Secret requirements: existing/needs-readback `CDP_API_KEY_ID`,
`CDP_API_KEY_SECRET`, paid receipt private key, continuation encryption key, A2A
signing private key, and applicable provider credentials; new for buyer
activation subject-reference HMAC key and possibly secret-bearing OIDC/mTLS
configuration; no rotation conclusion without live inventory. No secret values
were read or printed. `pnpm secrets:scan` passed (history and working tree, no
leaks).

### Future drain proof

`IN_FLIGHT_WORKFLOW_DRAIN_REQUIRED=YES`. Before a later production selector
change, record the exact deployed pre-candidate Workflow version/generation and
its selection boundary. Read production D1 only: enumerate
`payment_workflow_owner_intents` with `workflow_instance_id`, `status`,
`workflow_input_json`, and linked payment/job lifecycle; identify old-generation
continuations whose serialized input lacks `linkEvidenceInputs`. Exclude D1 rows
only when terminal state and settlement/result-reference reconciliation are
independently evidenced. For every remaining instance, read Workflow instance
status from the pinned old-generation host without mutation; include
pending/running/retryable/ambiguous instances, including `retry_exhausted`
intents unless terminal resolution is proven. Reconcile the D1 set with the
Workflow API census and repeat until the count of **old-generation, nonterminal
paid continuations without link evidence is exactly zero**; retain timestamped
counts, version IDs, and instance IDs/redacted evidence. No drain or cloud
readback occurred here.

## Qualification status

| Gate                                                                             | Result                                           |
| -------------------------------------------------------------------------------- | ------------------------------------------------ |
| Verify v3 price and four-service economic parity                                 | PASS locally                                     |
| Buyer authorization, auth declarations, selector and default-v2 focused behavior | PASS locally; no production activation           |
| PCC proof examples and Release 3 checksums                                       | PASS focused                                     |
| MCP packaged artifact, x402/A2A/Nevermined focused suites                        | PASS                                             |
| Fresh local D1 migration chain                                                   | PASS; production-schema upgrade unverified       |
| Generator determinism / public schema URL publication                            | **FAIL**                                         |
| Broad repository baseline                                                        | **FAIL** (aggregate and isolated findings above) |
| Deploy artifact scope against active deployed source                             | **UNVERIFIED**                                   |
| Full immutable candidate freeze and 0%-traffic upload                            | **BLOCKED / NO**                                 |

The next work should close candidate URL publication/serving, classify and
repair checkpoint-owned remaining test failures, prove upgrade migration and
final artifact scope, rerun the full gate matrix, then seek a new independent
review of that exact source commit. Only then can
`PCC-V3-ZERO-TRAFFIC-CANDIDATE-DEPLOYMENT-01` be considered. No upload or
deployment is authorized by this report.
