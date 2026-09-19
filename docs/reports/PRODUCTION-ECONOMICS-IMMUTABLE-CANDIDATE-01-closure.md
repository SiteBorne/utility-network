# PRODUCTION-ECONOMICS-IMMUTABLE-CANDIDATE-01 — Closure

Date: 2026-09-19

Overall result: **PASS**

The immutable candidate passed exact-version qualification while paid routes
remained disabled. The live candidate therefore proved that the outer master
paid-route gate prevents all paid-route economic execution. Mode-specific
rendered/reproduction validators were independently qualified locally and
through canonical MCP/economic admission behavior, but were not reached on the
live candidate because the master gate correctly rejected the routes first. This
is expected pre-activation behavior.

No candidate traffic promotion, paid-route activation, paid transaction,
provider execution, settlement, DNS change, secret change, publication,
directory registration, or push occurred.

## 1. Source provenance

| Evidence                                    | Result                                     |
| ------------------------------------------- | ------------------------------------------ |
| Source HEAD                                 | `eccc68447b72113241674cfdd78b661ee3547a29` |
| Expected qualified lineage                  | exact match                                |
| Branch                                      | `metadata-vcm-qualification`               |
| Upstream relation at start                  | 0 ahead / 13 behind; no local divergence   |
| Starting tracked working tree               | clean                                      |
| Pre-existing stash                          | present and untouched                      |
| `PRODUCTION-ECONOMICS-DISCOVERY-01` closure | read and consistent                        |
| `STARTING_PROVENANCE`                       | **PASS**                                   |

No source correction was required. The source HEAD remained unchanged throughout
the checkpoint.

## 2. Fresh local release evidence

`SOURCE_RELEASE_GATES=PASS_WITH_ACCEPTED_LIMITATION`.

The exact source HEAD passed the following fresh gates before upload:

- canonical pricing: 79/79;
- unified economic parity: 28/28;
- VCM: 152/152;
- A2A unit/property/fixture/edge/spec qualification;
- MCP unit/property/edge/stdio/spec qualification with exactly six tools;
- x402 unit: 537/537; property: 20/20; fixtures/spec qualification;
- focused edge/VCM/OpenAPI/security qualification: 133 passed, 1 skipped;
- schema, embedded-pricing drift, registry-pricing drift, PCC drift, OpenAPI
  drift, publication-artifact, governance, state, task, compatibility, and
  contract-release checks;
- production preflight, including 12/12 paid routes structurally unavailable and
  `preview_urls=false`;
- root typecheck: 25/25 Turbo tasks;
- root lint: 17/17 Turbo tasks;
- changed-file Prettier check and `git diff --check`;
- complete history and working-tree secret scans: no leaks;
- controlled contradiction/mutation tests in the unified economics and lifecycle
  suites.

The full edge aggregate completed with 1,679 passes, 72 skips, and five
timing-only failures while several resource-intensive gates were run
concurrently. Each timed-out case passed in an isolated rerun: A2A
primary/compare adversarial 13/13; MCP primary/compare adversarial 10/10;
migration/full-stack controls 7 passed and 3 intentionally skipped; and the load
gate 7/7. The isolated load rerun had 100 successful requests, zero unexpected
failures, and all committed ceilings passed. This is accepted aggregate
resource-contention evidence, not a behavioral regression.

## 3. Production baseline and immutable candidate

Before mutation, Cloudflare deployment `ed48746d-833c-4571-aa86-596deed5c0e0`
contained only production version `ab9f0ebe-21ea-415a-a770-70f9cf1bec08` at
100%. Public `/health` and `/ready` returned HTTP 200; readiness truthfully
reported production services disabled.

The Wrangler upload dry run passed in strict mode and emitted no migration
marker. The deterministic local bundle manifest digest was:

```text
9ba843db966fb20e54961c38ee81d3045831f147e9acc9b174251571c3afe4b3
```

One immutable version upload created:

| Field                                      | Value                                                   |
| ------------------------------------------ | ------------------------------------------------------- |
| Candidate version                          | `369b4bf5-c2f7-4e05-8454-7f5514a3bd45`                  |
| Cloudflare version number                  | 98                                                      |
| Created                                    | `2026-09-19T18:02:27.918959Z`                           |
| Tag                                        | `production-economics-immutable-candidate-01`           |
| Source message                             | exact source `eccc68447b72113241674cfdd78b661ee3547a29` |
| Candidate traffic immediately after upload | 0% (not a deployment member)                            |
| `PAID_ROUTES_ENABLED`                      | `false`                                                 |
| A2A metadata mode                          | `vcm_primary_compare`                                   |
| MCP metadata mode                          | `vcm_primary_compare`                                   |

Candidate and production had identical binding arrays and compatibility
settings. Their binding fingerprint was
`ee89fff52048923996731016b1596c1046627a7e1617279d28ed3079ee9b0b7a`. No secret
value was read or logged.

Because version previews are intentionally disabled, Cloudflare's canonical
exact-targeting mechanism required the candidate to be a member of the current
deployment. One deployment-record mutation created deployment
`90c5a399-5dc3-408b-aa78-222e43b02f3f` at `2026-09-19T18:03:50.735608Z` with
production unchanged at 100% and the candidate at 0%. This was a
deployment-membership mutation, not a production-traffic mutation.

Cloudflare's relevant contracts are documented under
[Versions and Deployments](https://developers.cloudflare.com/workers/versions-and-deployments/),
[Version Overrides](https://developers.cloudflare.com/workers/versions-and-deployments/version-overrides/),
and
[Preview URLs](https://developers.cloudflare.com/workers/versions-and-deployments/preview-urls/).

## 4. Exact-version mechanism and attribution

Every exact probe used the production custom domain with:

```http
Cloudflare-Workers-Version-Overrides: siteborne-utility-edge="369b4bf5-c2f7-4e05-8454-7f5514a3bd45"
```

An unfiltered `wrangler tail --format json` capture was authoritative. A probe
counted only when its response `cf-ray` matched the trace event and the trace
exposed candidate `scriptVersion.id`. All 16 final probes matched the candidate;
zero were missing and zero were attributed to another version.

| Probe                           | HTTP | CF-Ray                 | Script version                         | Expected result                             |
| ------------------------------- | ---: | ---------------------- | -------------------------------------- | ------------------------------------------- |
| health                          |  200 | `a3dc1a4259934590-ATL` | `369b4bf5-c2f7-4e05-8454-7f5514a3bd45` | healthy                                     |
| ready                           |  200 | `a3dc1a430b9eb09d-ATL` | candidate                              | ready; production services disabled         |
| catalog                         |  200 | `a3dc1a4789a713c4-ATL` | candidate                              | canonical eight-service catalog             |
| Agent Card                      |  200 | `a3dc1a481e0eaa0a-ATL` | candidate                              | signed card, eight skills, A2A JSON-RPC 1.0 |
| JWKS                            |  200 | `a3dc1a48af6eb827-ATL` | candidate                              | one public key; no private `d` member       |
| OpenAPI                         |  200 | `a3dc1a494f7c3498-ATL` | candidate                              | OpenAPI 3.1.0, four v2 paid POST contracts  |
| MCP initialize                  |  200 | `a3dc1a49d8c0addc-ATL` | candidate                              | protocol `2026-07-28` accepted              |
| MCP tools/list                  |  200 | `a3dc1a4b29d3ae19-ATL` | candidate                              | exactly six tools                           |
| malformed MCP JSON              |  400 | `a3dc1a4c491ae774-ATL` | candidate                              | fail closed: invalid JSON                   |
| unknown MCP method              |  200 | `a3dc1a4d0905930f-ATL` | candidate                              | JSON-RPC `-32601 Method not found`          |
| unsupported media type          |  415 | `a3dc1a4dd91fb20a-ATL` | candidate                              | `UNSUPPORTED_MEDIA_TYPE`                    |
| method not allowed/control      |  404 | `a3dc1a4e4bebb469-ATL` | candidate                              | no PUT health route                         |
| web direct control              |  404 | `a3dc1a4ecccb7c0e-ATL` | candidate                              | outer paid-route gate; no 402               |
| web rendered                    |  404 | `a3dc1a4f5d6bfe91-ATL` | candidate                              | same outer paid-route gate; no 402          |
| verify standard control         |  404 | `a3dc1a4fdff1930f-ATL` | candidate                              | outer paid-route gate; no 402               |
| verify independent reproduction |  404 | `a3dc1a5059806474-ATL` | candidate                              | same outer paid-route gate; no 402          |

`EXACT_VERSION_TARGETING=PASS` and `RAY_TO_SCRIPT_VERSION_ATTRIBUTION=PASS`.

## 5. A2A/JWS, MCP, and OpenAPI

### A2A/JWS

- signed Agent Card: one signature;
- JWKS: one public key and no private key material;
- independent repository verifier accepted the candidate card/JWKS pair;
- eight expected v1/v2 skills and the canonical x402 extension were present;
- supported interface: JSON-RPC, A2A protocol `1.0`;
- document limit 10 and unavailable-mode truth were preserved.

`A2A_EXACT_VERSION_QUALIFICATION=PASS`; `A2A_JWS_VALIDATION=PASS`.

### MCP

The exact candidate negotiated `2026-07-28` and returned these unchanged tool
identities:

1. `siteborne_company_evidence_graph`
2. `siteborne_web_context_verified`
3. `siteborne_document_evidence_json`
4. `siteborne_verify_agent_output`
5. `siteborne_get_quote`
6. `siteborne_get_service_health`

Live annotations matched source exactly:

| Tool class                     | readOnly | destructive | idempotent | openWorld |
| ------------------------------ | -------: | ----------: | ---------: | --------: |
| company/web/document execution |    false |       false |       true |      true |
| verify execution               |    false |       false |       true |     false |
| quote/health                   |     true |       false |       true |     false |

All six descriptions, input schemas, and output schemas were present. The web
description says rendered is defined but unavailable; the verify description
says independent reproduction is defined but unavailable; the document
description and input schema enforce 10 pages; every quote output property has a
description. Description amounts match canonical governance values rather than
an independent literal set.

Read-only exact-candidate quote checks returned the canonical atomic amounts
(USDC six decimals): company `31200` exact, web direct `8000` exact, document
`190000` `upto` authorization maximum, and verify standard `17000` exact.
Cross-scheme attempts failed with `scheme_not_offered`; rendered and
independent-reproduction quote attempts failed with `retrieval_mode_unavailable`
and `verification_mode_unavailable`. The subsequent durable audit proved these
quote-only calls persisted no quote, payment, job, Workflow, result, or
settlement row.

`MCP_EXACT_VERSION_QUALIFICATION=PASS`; `MCP_ANNOTATION_PARITY=PASS`.

### OpenAPI

- OpenAPI version: `3.1.0`;
- exactly four v2 paid POST operations;
- no v1-only commercial authority;
- direct web and standard verify are the only input-enum modes;
- rendered and independent reproduction remain declared as unavailable economic
  modes;
- document maximum is 10 pages;
- each operation embeds the canonical `x-siteborne-economics` projection.

`OPENAPI_EXACT_VERSION_QUALIFICATION=PASS`; `OPENAPI_V2_PAID_ROUTES=PASS`.

## 6. Candidate-discovered economics

The final validator compared live candidate catalog, A2A, and OpenAPI
projections to `governance/RISK_LIMITS.yaml` through `service-prices.ts` and
`economic-contract.ts`. All projection differences and validation-problem arrays
were empty.

| Capability/mode                      | Amount USD | Kind               | Unit    |            Available |
| ------------------------------------ | ---------: | ------------------ | ------- | -------------------: |
| company v2 / standard                |     0.0312 | exact              | request |                  yes |
| web v2 / direct                      |      0.008 | exact              | request |                  yes |
| web v2 / rendered                    |      0.029 | exact              | request |                   no |
| document v2 / native                 |     0.0098 | tier               | page    | extraction available |
| document v2 / OCR                    |     0.0156 | tier               | page    | extraction available |
| document v2 / table                  |     0.0238 | tier               | page    | extraction available |
| document v2 authorization maximum    |       0.19 | authorized maximum | job     |                  yes |
| verify v2 / standard                 |      0.017 | exact              | request |                  yes |
| verify v2 / independent reproduction |      0.049 | exact              | request |                   no |

All four v2 projections used Base mainnet `eip155:8453`, the governed USDC
asset, the same governed public payTo receiver, canonical `/v2/` resources,
`production_enabled=false`, and pricing source version `1.0.0`. PayTo, network,
asset, resource, amount, amount kind, units, tiers, authorization maximum,
settlement model, limits, and mode availability all matched.

`ECONOMIC_EXACT_VERSION_QUALIFICATION=PASS`; `ECONOMIC_PROJECTION_PARITY=PASS`;
`PAYTO_PARITY=PASS`; `TIERED_PRICING_SEMANTICS=PASS`;
`UPTO_PRICING_SEMANTICS=PASS`.

## 7. Paid-route and mode-gate evidence classes

The live candidate returns the same outer 404 for web direct, web rendered,
verify standard, and verify independent reproduction because
`PAID_ROUTES_ENABLED=false` prevents the paid routes from entering their inner
validators.

```text
MASTER_PAID_ROUTE_GATE_LIVE=PASS

WEB_RENDERED_MODE_GATE_LOCAL=PASS
WEB_RENDERED_MODE_GATE_MCP_QUOTE=PASS
WEB_RENDERED_MODE_GATE_LIVE=NOT_EXERCISED

VERIFY_REPRODUCTION_MODE_GATE_LOCAL=PASS
VERIFY_REPRODUCTION_MODE_GATE_MCP_QUOTE=PASS
VERIFY_REPRODUCTION_MODE_GATE_LIVE=NOT_EXERCISED
```

The live proof is limited and precise: neither the available nor unavailable
mode can reach a 402 challenge, payment authorization, provider execution, or
settlement while the master paid-route gate is false. It is not a live exercise
of the mode-specific HTTP validators, and this expected pre-activation state is
not a defect.

## 8. Durable/audit zero-side-effect proof

The production D1 schema was inspected read-only. The governed query window
began at `2026-09-19 18:02:00 UTC`, before candidate creation, and ended at D1
query-time `datetime('now')` after final probes. This window contains every
candidate qualification request and read-only MCP quote check.

| Durable/audit surface                      | Rows/effects in window | Classification |
| ------------------------------------------ | ---------------------: | -------------- |
| jobs                                       |                      0 | `PROVEN_ZERO`  |
| job attempts                               |                      0 | `PROVEN_ZERO`  |
| x402 quotes                                |                      0 | `PROVEN_ZERO`  |
| payment attempts/authorizations            |                      0 | `PROVEN_ZERO`  |
| payment quotes                             |                      0 | `PROVEN_ZERO`  |
| x402 service/PCC results                   |                      0 | `PROVEN_ZERO`  |
| audit events                               |                      0 | `PROVEN_ZERO`  |
| Workflow owner intents                     |                      0 | `PROVEN_ZERO`  |
| payment-service link evidence              |                      0 | `PROVEN_ZERO`  |
| settled payment-service links              |                      0 | `PROVEN_ZERO`  |
| provider-rate/invocation admission records |                      0 | `PROVEN_ZERO`  |
| facilitator settlement attempts            |                      0 | `PROVEN_ZERO`  |
| successful economic settlements            |                      0 | `PROVEN_ZERO`  |

Every D1 statement reported `changed_db=false`, `changes=0`, and
`rows_written=0`. Combined with the complete Ray-attributed request manifest
(discovery, protocol, fail-closed, and outer-gated requests only), this proves:

```text
PROVIDER_INVOCATIONS=0
PAYMENT_AUTHORIZATIONS=0
PAYMENT_SETTLEMENTS=0
PAID_TRANSACTIONS=0
DURABLE_JOB_SIDE_EFFECTS=0
DURABLE_QUOTE_SIDE_EFFECTS=0
```

## 9. VCM primary/compare

Version readback proves both candidate ordinary variables equal
`vcm_primary_compare`. Fresh local primary/compare tests passed for independent
legacy build, VCM validation, normalized semantic match,
selection-before-signing, fail-safe fallback, exact MCP tool-set validation, and
existing-handler preservation.

The exact candidate trace additionally recorded:

- A2A: legacy-reference attempt, primary attempt, compare, semantic match, and
  primary success;
- MCP: the same five events on each observed MCP construction path.

No mismatch, fallback, validation-failure, projector-failure, or
authority-inversion event occurred in the candidate trace.
`VCM_LIVE_SELECTION_TELEMETRY=PASS`.

## 10. Publication, Bazaar, and directories

The governed publication-artifact check and canonical URL gate passed locally,
and candidate A2A/OpenAPI/catalog/schema references match the prepared artifacts
and hashes.

```text
PUBLICATION_ARTIFACT_PARITY=PASS
PUBLICATION_DEPLOYED=NO
BAZAAR_DECLARATION_PARITY=PASS
BAZAAR_LIVE_READBACK=NOT_PERFORMED
BAZAAR_PUBLICATION_MUTATION=0
EXTERNAL_DIRECTORY_CANDIDATE_OBSERVATION=NOT_PERFORMED
DIRECTORY_MUTATIONS=0
```

Because the prepared `siteborne.net` publication artifacts remain unpublished,
metadata publication remains the next prerequisite before candidate promotion. A
local declaration is not represented as Bazaar admission.

## 11. Final deployment readback and mutation ledger

Final Cloudflare readback:

| Version                                           | Allocation |
| ------------------------------------------------- | ---------: |
| production `ab9f0ebe-21ea-415a-a770-70f9cf1bec08` |       100% |
| candidate `369b4bf5-c2f7-4e05-8454-7f5514a3bd45`  |         0% |

Exactly two versions are deployment members; no other version receives traffic.
Candidate `PAID_ROUTES_ENABLED=false` remained unchanged.

```text
WORKER_UPLOADS=1
DEPLOYMENT_RECORD_MUTATIONS=1
PRODUCTION_TRAFFIC_MUTATIONS=0
DNS_MUTATIONS=0
SECRET_MUTATIONS=0
PRODUCTION_VERSION_CHANGED=NO
PRODUCTION_CONFIG_CHANGED=NO
```

## 12. Closure and next checkpoint

All checkpoint success conditions for an immutable, exact-version, paid-disabled
candidate are met. The two live inner mode gates are correctly `NOT_EXERCISED`,
with independent local and MCP quote-admission proof. This is permitted by the
checkpoint success law because the live outer gate, exact attribution,
protocol/economic parity, zero side effects, and 100%/0% allocation are all
proven.

```text
PRODUCTION_ECONOMICS_IMMUTABLE_CANDIDATE_01=PASS
SAFE_FOR_HUMAN_AUTHORIZED_METADATA_PUBLICATION=YES
SAFE_FOR_HUMAN_AUTHORIZED_CANDIDATE_PROMOTION=NO
SAFE_FOR_PAID_ACTIVATION=NO
NEXT_RECOMMENDED_CHECKPOINT=PRODUCTION-ECONOMICS-METADATA-PUBLICATION-01
```

Candidate promotion remains blocked until the prepared metadata artifacts are
published and read back under a separately authorized checkpoint. Paid
activation requires its own later authority and paid-runtime qualification.
