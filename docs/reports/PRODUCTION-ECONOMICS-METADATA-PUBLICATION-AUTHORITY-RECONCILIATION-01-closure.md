# PRODUCTION-ECONOMICS-METADATA-PUBLICATION-AUTHORITY-RECONCILIATION-01 — Closure

**Decision:** BLOCKED

**Date:** 2026-09-19

**Scope:** reconcile the authority contradiction recorded by
`PRODUCTION-ECONOMICS-METADATA-PUBLICATION-01`; stopped before source repair or
static publication

**Mutations performed:** this report only; no static deployment, Worker upload,
Worker deployment, traffic, DNS, secret, payment, provider, Bazaar, or directory
mutation

The authority failure is classified. The original 23-record inventory mixed 22
retrievable static artifacts with the frozen PCC schema `$id` on
`utility.siteborne.net`. Repository law and JSON Schema identifier semantics
support treating that `$id` as identity metadata, not as a second copy that this
`siteborne.net` Pages project must publish. The qualified static inventory is
therefore 22 files.

That correction does not make the current production reference graph
publishable. The 100%-traffic production Worker still advertises 18
`utility.siteborne.net/schemas/**` retrieval URLs and a stale
`https://siteborne.net/license` URL. The qualified 0%-traffic candidate corrects
those projections, but promoting it and changing the Worker are forbidden in
this checkpoint. A `siteborne.net` Pages deployment cannot serve Worker-owned
`utility.siteborne.net` paths or alter production metadata. The publication
authority is therefore unresolved under the authorized mutation boundary,
triggering an explicit stop condition.

## 1. Starting provenance

- Starting HEAD: `f21f1a96e15f789887cc402cb615401d19f97491`
- Branch: `metadata-vcm-qualification`
- Upstream: `origin/metadata-vcm-qualification`, 0 behind / 15 ahead
- Starting tracked worktree: clean
- Pre-existing stash: untouched
- Prior checkpoint: `PRODUCTION_ECONOMICS_METADATA_PUBLICATION_01=BLOCKED`
- Original manifest digest:
  `415789de731196c77a4a3c0b378bad330544ef82eec9f6901688956640bd3847`
- Original readback: 22/23 HTTP 200, 2/23 raw-hash matches, 4/23 content-type
  matches

The final read-only Cloudflare deployment readback remains:

| Role                | Version                                | Traffic |
| ------------------- | -------------------------------------- | ------: |
| Production          | `ab9f0ebe-21ea-415a-a770-70f9cf1bec08` |    100% |
| Qualified candidate | `369b4bf5-c2f7-4e05-8454-7f5514a3bd45` |      0% |

Both version readbacks contain `PAID_ROUTES_ENABLED=false`. No other version is
a member of deployment `90c5a399-5dc3-408b-aa78-222e43b02f3f`.

## 2. Exact original failures

The original prepublication readback did not contain only one failure. Twenty
`siteborne.net` resources returned stale/fallback bytes, and the extra
utility-origin PCC record returned 404. The two passing records were `/` and
`/.well-known/security.txt`.

The `LIVE_HASH` below is the SHA-256 of the raw response body. Every 200
fallback listed below returned the root-page hash
`5da34b1fec6c544c5144f60e77fe43fb7642201c9f12b7e8f01a2bcd82575504`. The
utility-origin 404 body hash was
`7d04f7431bbfa41a04bcc7e6b98b9de0d919756c4c671c5785c99fff45f16402`.

| Canonical URL                                                                    | Source authority                                                                      | Projecting surfaces                                                                        | Expected hash                                                      | Live status / content type        | Live hash                                                          | Failure class                                                                                                                 |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | --------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `https://siteborne.net/docs/a2a`                                                 | `apps/network-site/docs/a2a/index.html`                                               | Agent Card documentation URL; public docs                                                  | `bd81b5623d19f1cc2e4ba966b6056f858e34ad6cbad25a068f7b06982dd6b7ee` | 200 / `text/html; charset=utf-8`  | `5da34b1fec6c544c5144f60e77fe43fb7642201c9f12b7e8f01a2bcd82575504` | `SPA_FALLBACK+STALE_PUBLIC_ARTIFACT`                                                                                          |
| `https://siteborne.net/extensions/a2a/x402/v1`                                   | `apps/network-site/extensions/a2a/x402/v1/index.html`                                 | Agent Card extension metadata; A2A docs                                                    | `dcdb4a6bf8ec5d0641ac449a516937f267f0aba29b7f1f959a5d7daf1d5737c8` | 200 / `text/html; charset=utf-8`  | `5da34b1fec6c544c5144f60e77fe43fb7642201c9f12b7e8f01a2bcd82575504` | `SPA_FALLBACK+STALE_PUBLIC_ARTIFACT`                                                                                          |
| `https://siteborne.net/schemas/common/async-job.schema.json`                     | `contracts/releases/2.0.0/schemas/common/async-job.schema.json`                       | schema index; service schemas; OpenAPI/registry transitive graph                           | `2979350890d8b2376cf72fabbddbdbfe35182e693eb043d9ca20aa6fe86af994` | 200 / `text/html; charset=utf-8`  | `5da34b1fec6c544c5144f60e77fe43fb7642201c9f12b7e8f01a2bcd82575504` | `SPA_FALLBACK+CONTENT_TYPE_ERROR+STALE_PUBLIC_ARTIFACT`                                                                       |
| `https://siteborne.net/schemas/common/authorized-artifact-reference.schema.json` | `contracts/releases/2.0.0/schemas/common/authorized-artifact-reference.schema.json`   | schema index; service schemas; registry                                                    | `772db35bb1d19bcee3cfbbfde41da88f77bb10b9afeabe505a15e6a0b25655ac` | 200 / `text/html; charset=utf-8`  | `5da34b1fec6c544c5144f60e77fe43fb7642201c9f12b7e8f01a2bcd82575504` | `SPA_FALLBACK+CONTENT_TYPE_ERROR+STALE_PUBLIC_ARTIFACT`                                                                       |
| `https://siteborne.net/schemas/common/money.schema.json`                         | `contracts/releases/2.0.0/schemas/common/money.schema.json`                           | schema index; request/quote/service metadata schemas                                       | `4567307ae24362cb33c1078072cd4d409eb14c0a2783e9941c1d0ec0e7d4b90f` | 200 / `text/html; charset=utf-8`  | `5da34b1fec6c544c5144f60e77fe43fb7642201c9f12b7e8f01a2bcd82575504` | `SPA_FALLBACK+CONTENT_TYPE_ERROR+STALE_PUBLIC_ARTIFACT`                                                                       |
| `https://siteborne.net/schemas/common/pagination.schema.json`                    | `contracts/releases/2.0.0/schemas/common/pagination.schema.json`                      | schema index; service schemas                                                              | `a966b1d885ecb10d03d35f843bce625e60ca2ab6798040e178baa45ab5db3e31` | 200 / `text/html; charset=utf-8`  | `5da34b1fec6c544c5144f60e77fe43fb7642201c9f12b7e8f01a2bcd82575504` | `SPA_FALLBACK+CONTENT_TYPE_ERROR+STALE_PUBLIC_ARTIFACT`                                                                       |
| `https://siteborne.net/schemas/common/quote-request.schema.json`                 | `contracts/releases/2.0.0/schemas/common/quote-request.schema.json`                   | schema index; MCP quote metadata; registry                                                 | `6db5dcb73b5a40ff31bed8c0ce2acd045a785dd64a3bacaec05ede9d26a426bc` | 200 / `text/html; charset=utf-8`  | `5da34b1fec6c544c5144f60e77fe43fb7642201c9f12b7e8f01a2bcd82575504` | `SPA_FALLBACK+CONTENT_TYPE_ERROR+STALE_PUBLIC_ARTIFACT`                                                                       |
| `https://siteborne.net/schemas/common/quote-response.schema.json`                | `contracts/releases/2.0.0/schemas/common/quote-response.schema.json`                  | schema index; MCP quote metadata; registry                                                 | `0fcc1ef9a79fa4548a47af3ba677c3cc260d68dffe4a6c2e53f9cc60d3601b11` | 200 / `text/html; charset=utf-8`  | `5da34b1fec6c544c5144f60e77fe43fb7642201c9f12b7e8f01a2bcd82575504` | `SPA_FALLBACK+CONTENT_TYPE_ERROR+STALE_PUBLIC_ARTIFACT`                                                                       |
| `https://siteborne.net/schemas/common/request-envelope.schema.json`              | `contracts/releases/2.0.0/schemas/common/request-envelope.schema.json`                | schema index; four service input schemas                                                   | `c3c50ca6e7bea34236e2ed92004f61d69acf52b208ba6d38e072a46900d817a9` | 200 / `text/html; charset=utf-8`  | `5da34b1fec6c544c5144f60e77fe43fb7642201c9f12b7e8f01a2bcd82575504` | `SPA_FALLBACK+CONTENT_TYPE_ERROR+STALE_PUBLIC_ARTIFACT`                                                                       |
| `https://siteborne.net/schemas/common/service-metadata.schema.json`              | `contracts/releases/2.0.0/schemas/common/service-metadata.schema.json`                | schema index; registry; catalog contract                                                   | `97f514fab559fd067673dad2b3aa546d47beb393160b40d4d1a34956158b03bb` | 200 / `text/html; charset=utf-8`  | `5da34b1fec6c544c5144f60e77fe43fb7642201c9f12b7e8f01a2bcd82575504` | `SPA_FALLBACK+CONTENT_TYPE_ERROR+STALE_PUBLIC_ARTIFACT`                                                                       |
| `https://siteborne.net/schemas/common/structured-error.schema.json`              | `contracts/releases/2.0.0/schemas/common/structured-error.schema.json`                | schema index; service/output schemas; OpenAPI                                              | `aa968374d206ff5e8264dad3eca25be6b27e8bd849065843fa8488732c593d98` | 200 / `text/html; charset=utf-8`  | `5da34b1fec6c544c5144f60e77fe43fb7642201c9f12b7e8f01a2bcd82575504` | `SPA_FALLBACK+CONTENT_TYPE_ERROR+STALE_PUBLIC_ARTIFACT`                                                                       |
| `https://siteborne.net/schemas/proof-carrying-context.schema.json`               | `contracts/releases/2.0.0/schemas/proof-carrying-context.schema.json`                 | static schema index; MCP bundled-output source; publication docs                           | `d32a8e25eba7a7ae4d7d7f7a14c565c1b92c8d8e10810ff885698ed102fdbcc0` | 200 / `text/html; charset=utf-8`  | `5da34b1fec6c544c5144f60e77fe43fb7642201c9f12b7e8f01a2bcd82575504` | `SPA_FALLBACK+CONTENT_TYPE_ERROR+STALE_PUBLIC_ARTIFACT`                                                                       |
| `https://siteborne.net/schemas/services/agent-verification-input.schema.json`    | `contracts/releases/2.0.0/schemas/services/agent-verification-input.schema.json`      | Agent Card; OpenAPI; catalog; registry; schema index                                       | `66d459905cd1a18b57ccb3fc40043a4e4c1a77bc7dba40676fcaf674cacb0f34` | 200 / `text/html; charset=utf-8`  | `5da34b1fec6c544c5144f60e77fe43fb7642201c9f12b7e8f01a2bcd82575504` | `SPA_FALLBACK+CONTENT_TYPE_ERROR+STALE_PUBLIC_ARTIFACT`                                                                       |
| `https://siteborne.net/schemas/services/agent-verification-output.schema.json`   | `contracts/releases/2.0.0/schemas/services/agent-verification-output.schema.json`     | Agent Card; OpenAPI; catalog; registry; schema index                                       | `a9a462b89b290ecba1aa62ec6d2fd030572f326ed79f498a43690244b38ad679` | 200 / `text/html; charset=utf-8`  | `5da34b1fec6c544c5144f60e77fe43fb7642201c9f12b7e8f01a2bcd82575504` | `SPA_FALLBACK+CONTENT_TYPE_ERROR+STALE_PUBLIC_ARTIFACT`                                                                       |
| `https://siteborne.net/schemas/services/company-evidence-input.schema.json`      | `contracts/releases/2.0.0/schemas/services/company-evidence-input.schema.json`        | Agent Card; OpenAPI; catalog; registry; schema index                                       | `8d9a6c432b019e24a2df4d48dd93424a8782febb49c0c88f7cf9208cf0204dd7` | 200 / `text/html; charset=utf-8`  | `5da34b1fec6c544c5144f60e77fe43fb7642201c9f12b7e8f01a2bcd82575504` | `SPA_FALLBACK+CONTENT_TYPE_ERROR+STALE_PUBLIC_ARTIFACT`                                                                       |
| `https://siteborne.net/schemas/services/company-evidence-output.schema.json`     | `contracts/releases/2.0.0/schemas/services/company-evidence-output.schema.json`       | Agent Card; OpenAPI; catalog; registry; schema index                                       | `5593736dfc60089aa3f01de664eb67ccba3a58e03449a66e91f477324e24861b` | 200 / `text/html; charset=utf-8`  | `5da34b1fec6c544c5144f60e77fe43fb7642201c9f12b7e8f01a2bcd82575504` | `SPA_FALLBACK+CONTENT_TYPE_ERROR+STALE_PUBLIC_ARTIFACT`                                                                       |
| `https://siteborne.net/schemas/services/document-evidence-input.schema.json`     | `contracts/releases/2.0.0/schemas/services/document-evidence-input.schema.json`       | Agent Card; OpenAPI; catalog; registry; schema index                                       | `19e64c92f088ed8b7a45eef561c5426bb59ce5cc3576b85482aded4f620e57ba` | 200 / `text/html; charset=utf-8`  | `5da34b1fec6c544c5144f60e77fe43fb7642201c9f12b7e8f01a2bcd82575504` | `SPA_FALLBACK+CONTENT_TYPE_ERROR+STALE_PUBLIC_ARTIFACT`                                                                       |
| `https://siteborne.net/schemas/services/document-evidence-output.schema.json`    | `contracts/releases/2.0.0/schemas/services/document-evidence-output.schema.json`      | Agent Card; OpenAPI; catalog; registry; schema index                                       | `df91ed115ae0e29d8f4c211d95462ddd96e9714bc5f5e0ce0b820b370e0d5dde` | 200 / `text/html; charset=utf-8`  | `5da34b1fec6c544c5144f60e77fe43fb7642201c9f12b7e8f01a2bcd82575504` | `SPA_FALLBACK+CONTENT_TYPE_ERROR+STALE_PUBLIC_ARTIFACT`                                                                       |
| `https://siteborne.net/schemas/services/web-context-input.schema.json`           | `contracts/releases/2.0.0/schemas/services/web-context-input.schema.json`             | Agent Card; OpenAPI; catalog; registry; schema index                                       | `d3b0762020d4cc1d1e846960ed978cf1237b1741f90213adabe8ed931c2845ea` | 200 / `text/html; charset=utf-8`  | `5da34b1fec6c544c5144f60e77fe43fb7642201c9f12b7e8f01a2bcd82575504` | `SPA_FALLBACK+CONTENT_TYPE_ERROR+STALE_PUBLIC_ARTIFACT`                                                                       |
| `https://siteborne.net/schemas/services/web-context-output.schema.json`          | `contracts/releases/2.0.0/schemas/services/web-context-output.schema.json`            | Agent Card; OpenAPI; catalog; registry; schema index                                       | `7d4882e997ec3a3bd97b746de36ed99dfe430d59b4d1c8adc7d9fa83a274b4e0` | 200 / `text/html; charset=utf-8`  | `5da34b1fec6c544c5144f60e77fe43fb7642201c9f12b7e8f01a2bcd82575504` | `SPA_FALLBACK+CONTENT_TYPE_ERROR+STALE_PUBLIC_ARTIFACT`                                                                       |
| `https://utility.siteborne.net/schemas/proof-carrying-context.schema.json`       | frozen `$id` in `contracts/releases/2.0.0/schemas/proof-carrying-context.schema.json` | four frozen output-schema `$ref`s; production `/schemas` also projects utility-origin URLs | `d32a8e25eba7a7ae4d7d7f7a14c565c1b92c8d8e10810ff885698ed102fdbcc0` | 404 / `text/plain; charset=UTF-8` | `7d04f7431bbfa41a04bcc7e6b98b9de0d919756c4c671c5785c99fff45f16402` | original: `MISSING_STATIC_ARTIFACT+WRONG_PUBLICATION_AUTHORITY`; reconciled: `MANIFEST_CLASSIFICATION_BUG+FROZEN_ID_CONFLICT` |

## 3. Three authorities

### Normative URI authority

- Active contract release selector: `contracts/CONTRACT_RELEASE.yaml`
- Frozen schema identities and references: `contracts/releases/2.0.0/schemas/**`
- Current host projection constants:
  `packages/protocol-x402/src/bazaar/routes.ts`
- Compatibility law: `docs/contracts/COMPATIBILITY_POLICY.md`

`packages/protocol-x402/src/bazaar/routes.ts` distinguishes the runtime resource
origin (`https://utility.siteborne.net`) from the schema publication origin
(`https://siteborne.net`). All current registry input/output schema URIs use the
schema publication origin. The PCC `$id` is the deliberate frozen exception.

### Content authority

`contracts/CONTRACT_RELEASE.yaml` selects release 2.0.0. The immutable bytes are
defined by `contracts/releases/2.0.0/schemas/**`; registry hash fields bind
those bytes. `scripts/generate-network-site-publication.mts` verifies the hashes
and copies them without modification to `apps/network-site/schemas/**`.

The raw frozen PCC source and generated static PCC copy both hash to:

```text
d32a8e25eba7a7ae4d7d7f7a14c565c1b92c8d8e10810ff885698ed102fdbcc0
```

### Publication authority

- Authorized static source: `apps/network-site/**`
- Generator: `scripts/generate-network-site-publication.mts`
- Authorized static host: Cloudflare Pages project `siteborne-network-identity`
- Attached domains: `siteborne-network-identity.pages.dev`, `siteborne.net`
- Previous production static deployment: `3428f3d8-89d2-4cef-8254-69197cea4cb9`
- `utility.siteborne.net`: production Worker-owned; not a domain of the Pages
  project

The Pages authority is therefore sufficient for the 22-file qualified static
bundle, but insufficient for retrieval URLs advertised by the current production
Worker on `utility.siteborne.net`.

## 4. Frozen-contract and hostname ruling

The frozen PCC `$id` and four output-schema `$ref`s are preserved. Editing them
would violate release immutability and is a major compatibility change under the
repository policy.

The existing architecture supports special-case option D from this checkpoint:
classify the PCC `$id` as identity metadata rather than a second required
publication target. Evidence:

1. `apps/edge-api/tests/canonical-url-projection.test.ts` explicitly records the
   utility PCC identifier as a documented future target while identifying
   `apps/network-site/schemas/proof-carrying-context.schema.json` as its
   published byte-equivalent copy.
2. `scripts/generate-network-site-publication.mts` permits the frozen utility
   `$id` and emits the byte-identical schema on the governed schema site.
3. `packages/protocol-mcp/src/frozen-contracts.ts` bundles PCC into MCP output
   schemas under a local `$defs` reference, avoiding a network fetch.
4. `docs/operations/X402_BAZAAR_METADATA.md` assigns PCC to a separately owned
   output contract rather than a Bazaar fetch dependency.
5. JSON Schema defines `$id` as a schema identifier and base URI; an identifier
   is not inherently a requirement that an HTTP retrieval endpoint exist. See
   [JSON Schema schema identification](https://json-schema.org/understanding-json-schema/structuring#id).

No frozen file or canonical identifier was changed.

## 5. Reference graph

```text
https://utility.siteborne.net/schemas/proof-carrying-context.schema.json
├── normative identity
│   └── contracts/releases/2.0.0/schemas/proof-carrying-context.schema.json ($id)
├── frozen direct references
│   ├── services/agent-verification-output.schema.json
│   ├── services/company-evidence-output.schema.json
│   ├── services/document-evidence-output.schema.json
│   └── services/web-context-output.schema.json
├── content/publication generator
│   └── scripts/generate-network-site-publication.mts
│       └── apps/network-site/schemas/proof-carrying-context.schema.json
├── current qualified projections
│   ├── registry/services/*.json -> siteborne.net input/output schema URLs
│   ├── candidate Agent Card -> siteborne.net service schema URLs
│   ├── candidate OpenAPI -> registry-derived siteborne.net schema URLs
│   ├── candidate catalog -> registry-derived siteborne.net schema URLs
│   └── MCP -> bundled PCC definition, no network retrieval requirement
├── current production projections
│   ├── /schemas -> all 18 retrieval URLs on utility.siteborne.net
│   ├── /catalog -> legacy relative schema references
│   └── /openapi.json -> stale siteborne.net/license URL
└── tests
    ├── apps/edge-api/tests/canonical-url-projection.test.ts
    ├── apps/edge-api/tests/economic-parity-gates.test.ts
    └── generator registry-hash/source-destination checks
```

The source delta from the deployed production source
`9ebecc88d2d502cd7de5ae408b872ca85f66f86e` to the qualified candidate source
`eccc68447b72113241674cfdd78b661ee3547a29` intentionally changes `/schemas` to
`CANONICAL_SCHEMA_ORIGIN`, changes catalog schema references to registry URIs,
and removes the unbacked OpenAPI license URL. Those corrections exist in the
already-qualified candidate, not the 100%-traffic production version.

## 6. Hash authority

```text
HASH_DOMAIN=RAW_BYTES
```

The contract registry and publication generator compute SHA-256 over raw file
bytes. The generator copies the schema bytes unchanged, so `RAW_BYTES` and
`GENERATED_BYTES` currently produce the same values. Live response hashes must
be compared to those expected raw bytes only when the response represents the
artifact. Root HTML fallback and 404 bodies are different-domain content and are
failures, not semantic equivalents.

There is no hosting transformation to normalize in the observed failures. The
live bodies are either the wrong HTML file or a 404 body.

## 7. Reconciled manifest law and blocker

The qualified static inventory is 22 artifacts:

- 1 identity page
- 1 security file
- 1 A2A documentation page
- 1 A2A extension page
- 18 JSON Schema files

The 23rd entry in the original inventory was the same PCC bytes counted again at
its frozen identifier. Removing that duplicate retrieval requirement is a
manifest-classification correction supported by existing law, not a contract
change.

No new deployable manifest was emitted, and no permanent gate was added, because
a second, independent live-authority contradiction remained after that
classification: the current production Worker advertises retrieval locations
that the authorized Pages surface cannot serve. A test that declared the 22-file
candidate graph sufficient while current production remained the public
authority would encode the wrong release sequencing.

Cloudflare Workers Custom Domains attach a hostname to a Worker, not an
individual path. Serving selected utility-host paths would require a Worker
route/source/configuration change, all forbidden here. See Cloudflare's
[Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
and
[Routes](https://developers.cloudflare.com/workers/configuration/routing/routes/)
documentation. Pages custom-domain ownership is likewise hostname-oriented; see
[Pages custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/).

Therefore:

```text
AUTHORITY_FAILURE_CLASSIFIED=PASS
NORMATIVE_URI_AUTHORITY_RESOLVED=PASS
CONTENT_AUTHORITY_RESOLVED=PASS
HASH_AUTHORITY_RESOLVED=PASS
PUBLICATION_AUTHORITY_RESOLVED=FAIL
NEW_PUBLICATION_MANIFEST_DIGEST=not_created_due_stop_condition
PUBLICATION_MANIFEST_VALID=FAIL
```

## 8. Verification performed

Fresh verification after classification produced:

- `pnpm publication:check`: PASS; 18 schemas match release 2.0.0 and registry
  hashes.
- `pnpm vitest run apps/edge-api/tests/canonical-url-projection.test.ts`: PASS,
  5/5.
- `pnpm vitest run apps/edge-api/tests/economic-parity-gates.test.ts`: PASS,
  28/28.
- `wrangler deployments list --json`: deployment
  `90c5a399-5dc3-408b-aa78-222e43b02f3f` still has production at 100% and the
  candidate at 0%.
- `wrangler versions view` for both versions: PASS; both still bind
  `PAID_ROUTES_ENABLED=false`.

The larger prepublication gate was not rerun after the stop condition because no
source fix or publication was eligible to proceed. The prior checkpoint's
deterministic artifact parity and security scan remain valid; this checkpoint
did not modify the bundle.

```text
PUBLICATION_ARTIFACT_PARITY=PASS
PUBLICATION_SECURITY_SCAN=PASS
ECONOMIC_PROJECTION_PARITY=PASS
WORKER_STATE_UNCHANGED=PASS
```

## 9. Publication and side-effect ledger

No Pages preview or production deployment was created. Consequently there is no
new deployment ID and no post-publication readback to claim.

```text
STATIC_METADATA_PUBLICATION=FAIL
STATIC_METADATA_DEPLOYMENTS=0
PREVIOUS_STATIC_DEPLOYMENT=3428f3d8-89d2-4cef-8254-69197cea4cb9
NEW_STATIC_DEPLOYMENT=not_created
CANONICAL_LIVE_READBACK=FAIL
CANONICAL_URL_COUNT=22
CANONICAL_URL_HTTP_200=22/22
CANONICAL_HASH_PARITY=FAIL
A2A_CANONICAL_REFERENCE_READBACK=FAIL
OPENAPI_CATALOG_REFERENCE_READBACK=FAIL
```

The 22/22 status count is not a pass: 20 of the 22 records still serve stale or
fallback bytes and 18 use the wrong content type. The excluded 23rd utility PCC
record was an identifier-classification error, not a successfully published
artifact.

No economic endpoint was called. This checkpoint's action ledger proves that it
initiated no provider, authorization, settlement, or paid-transaction action:

```text
WORKER_UPLOADS=0
WORKER_DEPLOYMENT_MUTATIONS=0
WORKER_TRAFFIC_MUTATIONS=0
DNS_MUTATIONS=0
SECRET_MUTATIONS=0
PROVIDER_INVOCATIONS=0
PAYMENT_AUTHORIZATIONS=0
PAYMENT_SETTLEMENTS=0
PAID_TRANSACTIONS=0
BAZAAR_PUBLICATION_MUTATION=0
DIRECTORY_MUTATIONS=0
```

## 10. Required governance/sequencing decision

The minimum next decision is not a metadata-content decision. It is a release
sequencing authorization that must explicitly choose how production's stale
reference graph becomes consistent with the qualified 22-file static bundle.
Supported choices require a separate checkpoint, for example:

1. publish and qualify the 22-file Pages bundle, then separately authorize
   promotion of the already-qualified candidate before requiring current
   production reference readback; or
2. authorize a narrowly scoped Worker route/source/configuration change that
   serves or redirects the legacy utility-host schema paths and resolves the
   unbacked license reference.

This checkpoint does not select or execute either mutation. Candidate promotion
is not yet safe to authorize from this closure because metadata publication and
the production reference graph have not jointly passed live readback. Paid
activation remains prohibited.
