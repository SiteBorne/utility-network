# PRODUCTION-ECONOMICS-METADATA-PUBLICATION-SEQUENCING-AUTHORIZATION-01 — Closure

Date: 2026-09-20  
Starting HEAD: `acb6f2a1c04b71266557ddd77ff107e906a01775`  
Qualified publication source commit:
`4a60c8d964f303265a2fcd4bb64738577163fe7c`  
Branch: `metadata-vcm-qualification`  
Outcome: `BLOCKED`

## 1. Executive result

The one authorized production mutation succeeded: exactly one static Cloudflare
Pages deployment published the reconciled 22-artifact SITEBORNE metadata bundle
to the existing `siteborne-network-identity` project serving `siteborne.net`.
All 22 canonical URLs return HTTP 200 with the governed content type and the
exact governed raw-byte SHA-256. No canonical metadata path redirects or falls
through to the SPA index.

The checkpoint cannot be declared `PASS` under its literal success law because
the unchanged 100%-production Worker still exposes stale references from
`/openapi.json`, `/catalog`, and `/schemas`. Sixteen catalog references and all
18 schema-index references resolve to Worker-owned 404 paths. This pre-existing
Worker projection state cannot be repaired by a static Pages deployment, and
this checkpoint expressly prohibited Worker mutation or candidate promotion.

The static deployment was not rolled back. Its own validation passed completely,
it made every Agent Card `siteborne.net` reference truthful, and rolling it back
would reintroduce the broken static targets without correcting the Worker-owned
OpenAPI/catalog/schema projections. The remaining blocker belongs to the
separate candidate-promotion sequence.

```text
STARTING_PROVENANCE=PASS
PUBLICATION_SEQUENCE_AUTHORIZED=PASS
STATIC_METADATA_PUBLICATION=PASS
CANONICAL_LIVE_READBACK=PASS
A2A_CANONICAL_REFERENCE_READBACK=PASS
OPENAPI_CATALOG_REFERENCE_READBACK=FAIL
PRODUCTION_ECONOMICS_METADATA_PUBLICATION_SEQUENCING_AUTHORIZATION_01=BLOCKED
```

## 2. Provenance and unchanged runtime state

Before mutation, the repository was clean at the expected starting commit. The
branch tracked `origin/metadata-vcm-qualification`; the pre-existing stash was
not touched. Read-only Cloudflare state showed deployment
`90c5a399-5dc3-408b-aa78-222e43b02f3f` with:

| Role                | Worker version                         | Traffic |
| ------------------- | -------------------------------------- | ------: |
| Production          | `ab9f0ebe-21ea-415a-a770-70f9cf1bec08` |    100% |
| Qualified candidate | `369b4bf5-c2f7-4e05-8454-7f5514a3bd45` |      0% |

Fresh post-publication `wrangler deployments list --json` returned the same
deployment and allocation. Fresh `wrangler versions view` readbacks confirmed
`PAID_ROUTES_ENABLED=false` on both versions. No other Worker version receives
traffic.

## 3. Reconciled publication manifest

Authority and identity law:

- artifact count: 22;
- contract version: `2.0.0`;
- hash domain: `RAW_BYTES`;
- manifest: `governance/NETWORK_SITE_PUBLICATION_MANIFEST.json`;
- manifest SHA-256:
  `beb258fff2061cf88dbe9f5a2c7445d6605498fc1a0305f3727627e48eacaebd`;
- the frozen PCC `$id` at `utility.siteborne.net` remains identifier metadata,
  not a second static deployment obligation.

| Canonical URL                                                                    | Publication path                                                             | Governed content type                    | Raw SHA-256                                                        | Bytes |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------ | ----: |
| `https://siteborne.net/`                                                         | `apps/network-site/index.html`                                               | `text/html; charset=utf-8`               | `5da34b1fec6c544c5144f60e77fe43fb7642201c9f12b7e8f01a2bcd82575504` |  2734 |
| `https://siteborne.net/.well-known/security.txt`                                 | `apps/network-site/.well-known/security.txt`                                 | `text/plain; charset=utf-8`              | `295a2d317e1f9bc1f63818b427c15de1733bb0f511ad6fd352fcb0f375d7d889` |   127 |
| `https://siteborne.net/docs/a2a`                                                 | `apps/network-site/docs/a2a`                                                 | `text/html; charset=utf-8`               | `bd81b5623d19f1cc2e4ba966b6056f858e34ad6cbad25a068f7b06982dd6b7ee` |  2403 |
| `https://siteborne.net/extensions/a2a/x402/v1`                                   | `apps/network-site/extensions/a2a/x402/v1`                                   | `text/html; charset=utf-8`               | `dcdb4a6bf8ec5d0641ac449a516937f267f0aba29b7f1f959a5d7daf1d5737c8` |  2536 |
| `https://siteborne.net/schemas/common/async-job.schema.json`                     | `apps/network-site/schemas/common/async-job.schema.json`                     | `application/schema+json; charset=utf-8` | `2979350890d8b2376cf72fabbddbdbfe35182e693eb043d9ca20aa6fe86af994` |  3616 |
| `https://siteborne.net/schemas/common/authorized-artifact-reference.schema.json` | `apps/network-site/schemas/common/authorized-artifact-reference.schema.json` | `application/schema+json; charset=utf-8` | `772db35bb1d19bcee3cfbbfde41da88f77bb10b9afeabe505a15e6a0b25655ac` |  1887 |
| `https://siteborne.net/schemas/common/money.schema.json`                         | `apps/network-site/schemas/common/money.schema.json`                         | `application/schema+json; charset=utf-8` | `4567307ae24362cb33c1078072cd4d409eb14c0a2783e9941c1d0ec0e7d4b90f` |  1727 |
| `https://siteborne.net/schemas/common/pagination.schema.json`                    | `apps/network-site/schemas/common/pagination.schema.json`                    | `application/schema+json; charset=utf-8` | `a966b1d885ecb10d03d35f843bce625e60ca2ab6798040e178baa45ab5db3e31` |  1414 |
| `https://siteborne.net/schemas/common/quote-request.schema.json`                 | `apps/network-site/schemas/common/quote-request.schema.json`                 | `application/schema+json; charset=utf-8` | `6db5dcb73b5a40ff31bed8c0ce2acd045a785dd64a3bacaec05ede9d26a426bc` |  3439 |
| `https://siteborne.net/schemas/common/quote-response.schema.json`                | `apps/network-site/schemas/common/quote-response.schema.json`                | `application/schema+json; charset=utf-8` | `0fcc1ef9a79fa4548a47af3ba677c3cc260d68dffe4a6c2e53f9cc60d3601b11` |  6110 |
| `https://siteborne.net/schemas/common/request-envelope.schema.json`              | `apps/network-site/schemas/common/request-envelope.schema.json`              | `application/schema+json; charset=utf-8` | `c3c50ca6e7bea34236e2ed92004f61d69acf52b208ba6d38e072a46900d817a9` |  4269 |
| `https://siteborne.net/schemas/common/service-metadata.schema.json`              | `apps/network-site/schemas/common/service-metadata.schema.json`              | `application/schema+json; charset=utf-8` | `97f514fab559fd067673dad2b3aa546d47beb393160b40d4d1a34956158b03bb` |  7502 |
| `https://siteborne.net/schemas/common/structured-error.schema.json`              | `apps/network-site/schemas/common/structured-error.schema.json`              | `application/schema+json; charset=utf-8` | `aa968374d206ff5e8264dad3eca25be6b27e8bd849065843fa8488732c593d98` |  4787 |
| `https://siteborne.net/schemas/proof-carrying-context.schema.json`               | `apps/network-site/schemas/proof-carrying-context.schema.json`               | `application/schema+json; charset=utf-8` | `d32a8e25eba7a7ae4d7d7f7a14c565c1b92c8d8e10810ff885698ed102fdbcc0` | 20623 |
| `https://siteborne.net/schemas/services/agent-verification-input.schema.json`    | `apps/network-site/schemas/services/agent-verification-input.schema.json`    | `application/schema+json; charset=utf-8` | `66d459905cd1a18b57ccb3fc40043a4e4c1a77bc7dba40676fcaf674cacb0f34` |  5595 |
| `https://siteborne.net/schemas/services/agent-verification-output.schema.json`   | `apps/network-site/schemas/services/agent-verification-output.schema.json`   | `application/schema+json; charset=utf-8` | `a9a462b89b290ecba1aa62ec6d2fd030572f326ed79f498a43690244b38ad679` | 14223 |
| `https://siteborne.net/schemas/services/company-evidence-input.schema.json`      | `apps/network-site/schemas/services/company-evidence-input.schema.json`      | `application/schema+json; charset=utf-8` | `8d9a6c432b019e24a2df4d48dd93424a8782febb49c0c88f7cf9208cf0204dd7` |  4091 |
| `https://siteborne.net/schemas/services/company-evidence-output.schema.json`     | `apps/network-site/schemas/services/company-evidence-output.schema.json`     | `application/schema+json; charset=utf-8` | `5593736dfc60089aa3f01de664eb67ccba3a58e03449a66e91f477324e24861b` | 17817 |
| `https://siteborne.net/schemas/services/document-evidence-input.schema.json`     | `apps/network-site/schemas/services/document-evidence-input.schema.json`     | `application/schema+json; charset=utf-8` | `19e64c92f088ed8b7a45eef561c5426bb59ce5cc3576b85482aded4f620e57ba` |  3982 |
| `https://siteborne.net/schemas/services/document-evidence-output.schema.json`    | `apps/network-site/schemas/services/document-evidence-output.schema.json`    | `application/schema+json; charset=utf-8` | `df91ed115ae0e29d8f4c211d95462ddd96e9714bc5f5e0ce0b820b370e0d5dde` | 15128 |
| `https://siteborne.net/schemas/services/web-context-input.schema.json`           | `apps/network-site/schemas/services/web-context-input.schema.json`           | `application/schema+json; charset=utf-8` | `d3b0762020d4cc1d1e846960ed978cf1237b1741f90213adabe8ed931c2845ea` |  2841 |
| `https://siteborne.net/schemas/services/web-context-output.schema.json`          | `apps/network-site/schemas/services/web-context-output.schema.json`          | `application/schema+json; charset=utf-8` | `7d4882e997ec3a3bd97b746de36ed99dfe430d59b4d1c8adc7d9fa83a274b4e0` | 13103 |

## 4. Routing, content type, hash, and security proof

Cloudflare Pages canonicalizes directory `index.html` resources with redirects.
The authorized minimal fix preserved the governed document bytes while moving
the A2A documentation and extension artifacts to their exact extensionless
publication paths. Exact `_headers` rules supply `text/html; charset=utf-8` for
those two resources and `application/schema+json; charset=utf-8` for schemas.

Local Pages emulation then returned 22/22 HTTP 200, 22/22 raw hashes, 22/22
content types, and zero redirects. The live canonical readback after deployment
returned the same result. There was no HTML schema response and no generic SPA
fallback.

The publication security gate passed. Gitleaks found no committed or working
tree secret, and the static bundle scan found no private keys, tokens,
credentials, private-network addresses, developer paths, source maps,
executables, private supplier data, optimizer weights, internal thresholds, or
debug traces. Only already-governed public information is present.

## 5. Local release gates

All checkpoint-caused gates were green before deployment:

- publication generation/check and 22-artifact authority test: PASS;
- canonical URL, A2A, OpenAPI, catalog, schema, hash, drift, and contract gates:
  PASS;
- PCC/service/OpenAPI/pricing regeneration checks: PASS;
- governance validation: 77/77 PASS;
- focused qualification tests: 70/70 PASS, including economic parity 28/28;
- typecheck: 25/25 workspace tasks successful;
- lint: 17/17 workspace tasks successful, with only the documented pre-existing
  Node module-type warnings;
- changed-file formatting and `git diff --check`: PASS;
- secret and publication-security scans: PASS.

A fresh post-deployment economic parity run again passed 28/28. Static
publication did not change pricing, `payTo`, service availability, or any other
commercial authority.

## 6. The single authorized Pages mutation

| Field                | Value                                                              |
| -------------------- | ------------------------------------------------------------------ |
| Pages project        | `siteborne-network-identity`                                       |
| Canonical host       | `siteborne.net`                                                    |
| Previous deployment  | `3428f3d8-89d2-4cef-8254-69197cea4cb9`                             |
| New deployment       | `ad502ad1-0b90-49db-85f3-bc24c27d4b1d`                             |
| Deployment URL       | `https://ad502ad1.siteborne-network-identity.pages.dev`            |
| Source               | `4a60c8d964f303265a2fcd4bb64738577163fe7c`                         |
| Manifest digest      | `beb258fff2061cf88dbe9f5a2c7445d6605498fc1a0305f3727627e48eacaebd` |
| Artifact count       | 22                                                                 |
| Deployment timestamp | 2026-09-20 approximately 05:00 UTC (Wrangler completion window)    |

Exactly one `wrangler pages deploy` was issued. No retry or second deployment
was made.

## 7. Canonical live readback

The exhaustive live readback fetched all manifest URLs with redirects disabled.
Every record returned HTTP 200, the exact expected content type, and the exact
expected raw-byte SHA-256. Summary:

```text
CANONICAL_URL_COUNT=22
CANONICAL_URL_HTTP_200=22/22
CANONICAL_HASH_PARITY=PASS
CONTENT_TYPE_PARITY=PASS
SPA_FALLBACK_FOR_CANONICAL_METADATA=NO
```

## 8. Agent Card reference readback

The current production Agent Card was fetched without mutation. It contains 18
`siteborne.net` references: documentation, extension metadata, and repeated
input/output schema references across the eight listed service versions. All 18
references map to the governed manifest, returned HTTP 200, and matched the
expected raw-byte hash.

```text
A2A_CANONICAL_REFERENCE_READBACK=PASS
AGENT_CARD_SITEBORNE_REFERENCES=18/18
```

## 9. OpenAPI, catalog, and schema-index blocker

The current production Worker remains the pre-candidate version. Its read-only
surfaces therefore remain stale:

- `/openapi.json` is OpenAPI 3.0.3 with no v2 paid operations and advertises
  `https://siteborne.net/license`, which returns the generic site HTML and is
  not a governed manifest artifact;
- `/catalog` contains 16 relative legacy input/output references across eight
  service versions; all 16 resolve on `utility.siteborne.net` to HTTP 404;
- `/schemas` contains 18 `utility.siteborne.net/schemas/**` URLs; all 18 return
  HTTP 404.

The static Pages deployment cannot own or rewrite those Worker responses. The
qualified 0%-traffic candidate was already qualified against the current
canonical projection law, but promoting it was expressly outside this
checkpoint.

```text
OPENAPI_CATALOG_REFERENCE_READBACK=FAIL
STALE_CATALOG_REFERENCES=16
STALE_SCHEMA_INDEX_REFERENCES=18
UNGOVERNED_OPENAPI_SITE_REFERENCE=1
```

This failure is the sole reason the overall checkpoint is `BLOCKED` rather than
`PASS`.

## 10. External read-only observations

No recrawl, registration, submission, claim, or directory mutation was made.

- Agenstry: `NEW`. Its current read-only listing exposes the current Agent Card,
  including the newly live `siteborne.net` documentation and schema references.
- Glama: `NEW`. Its current connector readback exposes the six-tool MCP surface,
  current descriptions, and the 10-page document limit.
- MCP Registry / PluginBench: `NOT_OBSERVABLE` for the static metadata change.
  The registry API returns `net.siteborne/utility` version `0.1.0` and the
  streamable HTTP endpoint, but does not expose the static artifacts needed to
  distinguish this publication.
- mcpmetrics: `NOT_OBSERVABLE`; no reliable read-only metadata-specific readback
  was available.

## 11. Mutation and economic side-effect ledger

Performed:

- one Pages static metadata deployment;
- one local implementation commit before deployment;
- this closure report commit.

Not performed:

- Worker upload, version creation, deployment, or traffic mutation;
- DNS, custom-domain, binding, compatibility-setting, or secret mutation;
- Durable Object, D1, KV, R2, Queue, Cron, or payment-state mutation;
- Bazaar publication or external directory mutation;
- candidate promotion, paid-route activation, provider invocation, payment
  authorization, settlement, or paid transaction.

All post-deployment network probes were read-only GET/HEAD requests to static or
metadata endpoints. No paid execution route was invoked. Therefore the action
ledger proves zero checkpoint-attributable provider/payment effects.

```text
STATIC_METADATA_DEPLOYMENTS=1
WORKER_UPLOADS=0
WORKER_DEPLOYMENT_MUTATIONS=0
WORKER_TRAFFIC_MUTATIONS=0
DNS_MUTATIONS=0
SECRET_MUTATIONS=0
BAZAAR_PUBLICATION_MUTATION=0
PROVIDER_INVOCATIONS=0
PAYMENT_AUTHORIZATIONS=0
PAYMENT_SETTLEMENTS=0
PAID_TRANSACTIONS=0
```

## 12. Rollback readiness

Rollback is available without touching Worker traffic. The immediately prior
known-good Pages deployment is `3428f3d8-89d2-4cef-8254-69197cea4cb9`.
Cloudflare Pages supports rollback from the project deployment history, or
through the Pages deployment rollback API:

```text
POST /accounts/{account_id}/pages/projects/siteborne-network-identity/deployments/3428f3d8-89d2-4cef-8254-69197cea4cb9/rollback
```

Rollback was not executed because the new deployment passed every static live
validation. The current Wrangler version does not expose a Pages rollback
subcommand, so the dashboard/API mechanism is the recorded recovery path.

## 13. Closure and next checkpoint

The publication sequence itself is complete and successful. Static metadata
truth now precedes any runtime promotion exactly as required. A separately
human-authorized candidate-promotion checkpoint may now promote the already
qualified candidate and verify that production `/openapi.json`, `/catalog`, and
`/schemas` switch to the qualified canonical projections. Paid activation must
remain a later, separate checkpoint.

```text
SAFE_FOR_HUMAN_AUTHORIZED_CANDIDATE_PROMOTION=YES
SAFE_FOR_PAID_ACTIVATION=NO
NEXT_RECOMMENDED_CHECKPOINT=PRODUCTION-ECONOMICS-IMMUTABLE-CANDIDATE-PROMOTION-AUTHORIZATION-01
```
