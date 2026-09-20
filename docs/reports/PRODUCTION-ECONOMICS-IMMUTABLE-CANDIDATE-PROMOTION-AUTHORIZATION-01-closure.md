# PRODUCTION-ECONOMICS-IMMUTABLE-CANDIDATE-PROMOTION-AUTHORIZATION-01 — Closure

Date: 2026-09-20  
Starting local HEAD: `dd20902f2d34ee1b0664bf6e230f6c810beac7f6`  
Candidate source HEAD: `eccc68447b72113241674cfdd78b661ee3547a29`  
Branch: `metadata-vcm-qualification`  
Outcome: `PASS`

## 1. Executive result

The previously built and exact-version-qualified immutable Worker candidate
`369b4bf5-c2f7-4e05-8454-7f5514a3bd45` was promoted through the authorized
traffic sequence `5%`, `25%`, then `100%`. The old production version
`ab9f0ebe-21ea-415a-a770-70f9cf1bec08` remains present at `0%` as the immutable
rollback target.

Every stage passed read-only health, readiness, metadata, MCP, A2A/JWS, OpenAPI,
catalog, schema-index, canonical-reference, and economic invariants.
CF-Ray-to-tail attribution observed the candidate under ordinary routing at both
weighted stages and attributed all final ordinary production probes to the
promoted candidate. No probe invoked a paid route.

The promotion closed the two Worker-owned metadata defects: the production
catalog now has zero legacy schema routes, and the production schema index has
zero broken `utility.siteborne.net` static schema URLs. All projected static
references map to the already-published `siteborne.net` canonical artifacts.

```text
STARTING_PROVENANCE=PASS
CANDIDATE_IMMUTABILITY_RECHECK=PASS
ROLLBACK_READY=YES
PRODUCTION_PROMOTION=PASS
CURRENT_PRODUCTION_VERSION=369b4bf5-c2f7-4e05-8454-7f5514a3bd45
CURRENT_PRODUCTION_TRAFFIC=100%
PAID_ROUTES_ENABLED=false
PRODUCTION_ECONOMICS_IMMUTABLE_CANDIDATE_PROMOTION_AUTHORIZATION_01=PASS
```

## 2. Starting provenance and immutable candidate

Before the first traffic mutation:

- the repository was clean at the expected local HEAD;
- the branch tracked `origin/metadata-vcm-qualification` and was 18 commits
  ahead and zero behind;
- the pre-existing stash was not touched;
- Cloudflare deployment `90c5a399-5dc3-408b-aa78-222e43b02f3f` assigned `100%`
  to the old production version and `0%` to the candidate;
- Pages deployment `ad502ad1-0b90-49db-85f3-bc24c27d4b1d` remained the current
  production static deployment;
- all 22 static artifacts returned HTTP 200 with their governed content types
  and raw-byte hashes.

The candidate version readback was unchanged from qualification:

| Field                     | Value                                                              |
| ------------------------- | ------------------------------------------------------------------ |
| Version ID                | `369b4bf5-c2f7-4e05-8454-7f5514a3bd45`                             |
| Cloudflare version number | 98                                                                 |
| Created                   | `2026-09-19T18:02:27.918959Z`                                      |
| Source annotation         | `eccc68447b72113241674cfdd78b661ee3547a29`                         |
| Script etag               | `1877d276642ff4917ee8ae4032b7f21302e6f365476b0af64bcb66043c1473d7` |
| Compatibility date        | `2026-08-05`                                                       |
| Compatibility flags       | `nodejs_compat`                                                    |
| A2A metadata mode         | `vcm_primary_compare`                                              |
| MCP metadata mode         | `vcm_primary_compare`                                              |
| Paid routes               | `false`                                                            |

The candidate and old production version exposed the same normalized binding
set. Secret values were neither read nor printed; only binding identities were
compared. Network, asset, and public payment destination were unchanged:

```text
network=eip155:8453
asset=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
payTo=0x7f44a2dd237938F18632d4CcA40f4c690295E6E1
```

## 3. Pre-promotion exact-version qualification

An exact candidate override fetched health, readiness, catalog, schema index,
OpenAPI, Agent Card, JWKS, MCP initialize, MCP tools/list, and the read-only MCP
service-health tool. All ten HTTP probes succeeded. Tail attribution matched all
ten CF-Ray identifiers to
`scriptVersion.id=369b4bf5-c2f7-4e05-8454-7f5514a3bd45`, with `outcome=ok` and
zero exceptions.

Results:

- health and readiness: PASS;
- catalog legacy schema references: `0`;
- schema-index entries: `18`, all on the governed `siteborne.net` host;
- broken `utility.siteborne.net` static schema references: `0`;
- projected canonical static references: `21/21` HTTP 200 and raw-hash match;
- MCP modern protocol: `2026-07-28`;
- MCP tools: exactly `6`, with governed identities, annotations, descriptions,
  unavailable-mode truth, and document limit;
- A2A Agent Card JWS verification against live JWKS: PASS;
- OpenAPI: `3.1.0`, with all four v2 paid POST operations;
- VCM A2A and MCP primary/compare selection telemetry: match and primary success
  observed;
- economic projection and `payTo` parity: PASS.

The compatibility initialize response remains `2025-11-25` when no modern
protocol header is supplied. The qualified modern SITEBORNE protocol is
`2026-07-28`, proven through modern-header tools/list and read-only health.

## 4. Local release gates before traffic movement

All relevant gates were green before promotion:

- publication generation and manifest check: PASS, 22 artifacts, digest
  `beb258fff2061cf88dbe9f5a2c7445d6605498fc1a0305f3727627e48eacaebd`;
- economic, canonical URL, A2A primary/compare, and MCP primary/compare tests:
  55/55 PASS;
- contract release, compatibility, schema drift, and generated-validator checks:
  PASS;
- workspace typecheck: 25/25 tasks successful;
- workspace lint: 17/17 tasks successful, with only the documented Node
  module-type warnings;
- static live readback: 22/22 HTTP 200, 22/22 content types, 22/22 raw hashes;
- final post-promotion economic/canonical gate: 33/33 PASS.

No source file, Worker version, static artifact, Worker binding, compatibility
setting, secret, DNS record, payment configuration, or economic authority was
changed.

## 5. Rollback readiness

The rollback target was frozen before promotion:

```text
ROLLBACK_VERSION=ab9f0ebe-21ea-415a-a770-70f9cf1bec08
```

The exact emergency mechanism was recorded as a Wrangler rollback of the
existing immutable version for `siteborne-utility-edge`, with an explicit
checkpoint message and non-interactive confirmation. Cloudflare documents that
rollback creates a new single-version deployment and assigns it 100% of traffic.
The command was not executed because every stage passed.

Final readback confirms the rollback version still exists as Cloudflare
version 97. It was not deleted.

## 6. Controlled traffic stages

| Stage   | Deployment ID                          | Timestamp (UTC)               | Old version | Candidate | Ordinary attributed probes    | Bad outcomes |
| ------- | -------------------------------------- | ----------------------------- | ----------: | --------: | ----------------------------- | -----------: |
| Start   | `90c5a399-5dc3-408b-aa78-222e43b02f3f` | `2026-09-19T18:03:50.735608Z` |        100% |        0% | preflight exact-version proof |            0 |
| Stage 1 | `8770a437-27c2-4e5d-bf7a-bb9aca3d3c80` | `2026-09-20T05:36:21.228596Z` |         95% |        5% | 212 old, 8 candidate          |            0 |
| Stage 2 | `c2510b4d-6d82-4244-a9e0-4b38c82c49a8` | `2026-09-20T05:37:54.291717Z` |         75% |       25% | 106 old, 26 candidate         |            0 |
| Final   | `08f1257c-a6f1-42d4-97e2-21abc89ba8d7` | `2026-09-20T05:38:52.270174Z` |          0% |      100% | 140 candidate                 |            0 |

At each stage Cloudflare independently returned the intended allocation and only
the intended two versions. Ordinary public requests covered health, readiness,
catalog, schema index, OpenAPI, Agent Card, and JWKS. Exact candidate
qualification covered those surfaces plus MCP. Every observed tail event had
`outcome=ok` and an empty exception list.

The two weighted stages produced ordinary-routing candidate observations, so the
ramp was not inferred from configured percentages alone. At final 100%, all 140
ordinary probe Ray IDs were attributed to the promoted candidate.

## 7. Final public machine-contract qualification

### Health and readiness

`/health` and `/ready` return HTTP 200 under ordinary production routing. Final
tail attribution identifies the promoted candidate and shows no exceptions.

### MCP

The ordinary production MCP endpoint passed initialize compatibility,
modern-header tools/list, and read-only service-health qualification:

```text
MCP_PROTOCOL_VERSION=2026-07-28
MCP_TOOL_COUNT=6
MCP_PUBLIC_PRODUCTION_QUALIFICATION=PASS
```

Tool identities, TDQS-oriented descriptions, annotations, output field
descriptions, 10-page document limit, unavailable rendered/reproduction modes,
and canonical economics match the qualified source. No paid tool was invoked.

### A2A and JWS

The ordinary production Agent Card and JWKS returned their governed media types.
The card signature verified against the live JWKS. The v2 capability set,
economics, mode availability, document limit, and canonical static references
match the qualified candidate.

```text
A2A_PUBLIC_PRODUCTION_QUALIFICATION=PASS
A2A_JWS_VALIDATION=PASS
```

### OpenAPI

The ordinary production specification is OpenAPI 3.1.0 and contains the four v2
paid POST operations:

- `/v2/company/evidence-graph`;
- `/v2/web/context`;
- `/v2/document/evidence-json`;
- `/v2/verify/agent-output`.

Its schema references, current service IDs, 10-page bound, availability truth,
and canonical economics all pass.

### Catalog and schema index

The former production blockers are closed:

```text
CATALOG_LEGACY_SCHEMA_ROUTES=0
SCHEMA_INDEX_URLS=18
SCHEMA_INDEX_UTILITY_STATIC_URLS=0
CATALOG_REFERENCE_PARITY=PASS
SCHEMA_INDEX_REFERENCE_PARITY=PASS
```

All active `siteborne.net` documentation and schema references resolve to the
existing governed static publication with the correct raw bytes.

## 8. Economic and availability invariants

The final production catalog agrees with governance, the canonical economic
contract, VCM, MCP, HTTP/x402, A2A, OpenAPI, catalog, and the Bazaar
declaration. Current v2 economics are unchanged:

| Service / mode                                      |     Amount | Kind / unit          | Availability                   |
| --------------------------------------------------- | ---------: | -------------------- | ------------------------------ |
| `company_evidence_graph.v2` / standard              | USD 0.0312 | exact / request      | available, production disabled |
| `web_context_verified.v2` / direct                  |  USD 0.008 | exact / request      | available, production disabled |
| `web_context_verified.v2` / rendered                |  USD 0.029 | exact / request      | unavailable                    |
| `document_evidence_json.v2` / native                | USD 0.0098 | measured tier / page | available, production disabled |
| `document_evidence_json.v2` / OCR                   | USD 0.0156 | measured tier / page | available, production disabled |
| `document_evidence_json.v2` / table                 | USD 0.0238 | measured tier / page | available, production disabled |
| `document_evidence_json.v2` authorization maximum   |   USD 0.19 | upto / job           | 10-page ceiling                |
| `verify_agent_output.v2` / standard                 |  USD 0.017 | exact / request      | available, production disabled |
| `verify_agent_output.v2` / independent reproduction |  USD 0.049 | exact / request      | unavailable                    |

Every service remains `production_enabled=false`; the Worker binding remains
`PAID_ROUTES_ENABLED=false`. No authority inversion was observed.

## 9. Static publication remained unchanged

Pages deployment `ad502ad1-0b90-49db-85f3-bc24c27d4b1d` remained the live
production deployment throughout. Final exhaustive readback returned:

```text
STATIC_CANONICAL_URL_HTTP_200=22/22
STATIC_CANONICAL_HASH_PARITY=PASS
STATIC_CONTENT_TYPE_PARITY=PASS
STATIC_METADATA_DEPLOYMENTS_THIS_CHECKPOINT=0
```

No Pages deployment or static artifact mutation occurred.

## 10. Zero economic side effects

The D1 read-only baseline at `2026-09-20 05:35:29` and final readback at
`2026-09-20 05:40:05` were identical:

| Durable surface       | Baseline | Final | Delta |
| --------------------- | -------: | ----: | ----: |
| Jobs                  |       18 |    18 |     0 |
| Payment quotes        |        0 |     0 |     0 |
| x402 quotes           |       73 |    73 |     0 |
| Payment attempts      |       18 |    18 |     0 |
| Service results       |        2 |     2 |     0 |
| Job attempts          |        0 |     0 |     0 |
| Audit events          |      171 |   171 |     0 |
| Payment-service links |        0 |     0 |     0 |

Only metadata, health, readiness, JWKS, and read-only MCP methods were called.
Together with the paid-disabled binding and unchanged durable counters, this
proves zero checkpoint-attributable provider invocation, payment authorization,
settlement, or paid transaction.

## 11. External read-only observations

No recrawl, registration, submission, claim, or external mutation was made.

- Agenstry: `NEW`. Its current listing exposes the live signed Agent Card and
  the `siteborne.net` documentation/schema references.
- Glama: `NEW`. Its current connector page reports a healthy six-tool surface
  and the current paid-disabled tool descriptions.
- official MCP Registry / PluginBench propagation: `NOT_OBSERVABLE`; the
  available public result did not provide a reliable post-promotion projection
  discriminator.
- mcpmetrics: `NOT_OBSERVABLE`; no reliable read-only result was available.

Ordinary crawler lag was not treated as a promotion failure.

## 12. Mutation and observability ledger

Performed:

- three Worker deployment/traffic mutations using only the two existing
  immutable versions: 95/5, 75/25, and 0/100;
- this closure report commit.

Not performed:

- Worker build, upload, source change, binding change, compatibility change,
  secret change, DNS mutation, Pages deployment, or static artifact mutation;
- paid-route activation, provider execution, payment authorization, settlement,
  or paid transaction;
- Bazaar publication or external directory recrawl;
- deletion of the old immutable version.

Final checkpoint-scoped tail evidence shows no exception, bad outcome, or 5xx
among the attributed probes. No broader account-level aggregate was inferred
from unavailable metrics.

```text
WORKER_UPLOADS=0
WORKER_DEPLOYMENT_MUTATIONS=3
WORKER_TRAFFIC_MUTATIONS=3
STATIC_METADATA_DEPLOYMENTS_THIS_CHECKPOINT=0
DNS_MUTATIONS=0
SECRET_MUTATIONS=0
BAZAAR_PUBLICATION_MUTATION=0
PROVIDER_INVOCATIONS=0
PAYMENT_AUTHORIZATIONS=0
PAYMENT_SETTLEMENTS=0
PAID_TRANSACTIONS=0
POST_PROMOTION_RUNTIME_HEALTH=PASS
```

## 13. Remaining boundary and recommendation

The promoted Worker remains deliberately paid-disabled. This checkpoint does not
prove paid runtime fulfillment and does not authorize enabling paid routes,
provider execution, payment authorization, settlement, or a paid transaction.

The next recommended checkpoint is a separately human-authorized narrow paid
canary design and preflight. It must preserve the current rollback version and
require explicit authority before any paid activation or economic execution.
