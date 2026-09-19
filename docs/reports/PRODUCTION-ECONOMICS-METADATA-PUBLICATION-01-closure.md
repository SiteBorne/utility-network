# PRODUCTION-ECONOMICS-METADATA-PUBLICATION-01 — Closure

**Decision:** BLOCKED

**Date:** 2026-09-19

**Scope:** canonical metadata publication preflight and external readback;
stopped before upload

**Mutations performed:** none

The qualified static bundle is deterministic, byte-identical to contract release
2.0.0, and clean under the publication security scan. Publication was not
attempted because the complete live reference graph cannot be made truthful
through the authorized `siteborne.net` Pages deployment alone. The remaining
targets are on `utility.siteborne.net`, which is owned by the production Worker,
or have no governed source artifact. Resolving them would require a Worker,
hostname/DNS, production-traffic, or source-contract mutation explicitly outside
this checkpoint.

## 1. Starting provenance

- Branch: `metadata-vcm-qualification`
- Starting and source HEAD: `c1adba3ed1ee7ceafe970a8b748861373c4012f7`
- Prior qualified source lineage: `eccc68447b72113241674cfdd78b661ee3547a29`
- Upstream: `origin/metadata-vcm-qualification`, 0 behind / 14 ahead
- Starting tracked worktree: clean
- Pre-existing stash: present and untouched
- Prior discovery closure: PASS with accepted documented baseline limitations
- Prior immutable candidate closure: PASS

The current Worker deployment readback matched the checkpoint's expected
identity exactly:

| Role                | Version                                | Traffic |
| ------------------- | -------------------------------------- | ------: |
| Production          | `ab9f0ebe-21ea-415a-a770-70f9cf1bec08` |    100% |
| Qualified candidate | `369b4bf5-c2f7-4e05-8454-7f5514a3bd45` |      0% |

Both immutable version readbacks report `PAID_ROUTES_ENABLED=false`.

```text
STARTING_PROVENANCE=PASS
```

## 2. Publication authority and current static deployment

The authoritative generator is `scripts/generate-network-site-publication.mts`.
It copies the 18 schemas from the active frozen release selected by
`contracts/CONTRACT_RELEASE.yaml` into `apps/network-site/schemas/**`, verifies
every registry-declared schema hash, and requires the governed A2A documentation
and extension pages.

The read-only Cloudflare inventory found an already-established Pages project:

- Project: `siteborne-network-identity`
- Project domains: `siteborne-network-identity.pages.dev`, `siteborne.net`
- Existing production deployment: `3428f3d8-89d2-4cef-8254-69197cea4cb9`
- Existing deployment source: `685aae6`
- Existing production branch: `metadata-vcm-qualification`
- Existing preview deployments: none

That deployment predates the production-economics publication artifacts. It
serves the root page and `security.txt` correctly but returns the root HTML as a
generic fallback for the new docs, extension, and schema paths. Therefore the
prior checkpoint's `PUBLICATION_DEPLOYED=NO` remains accurate for the qualified
artifact set even though a smaller pre-existing identity-site deployment is
live.

Cloudflare documents Pages Direct Upload as an atomic prebuilt-directory
deployment with preview branches, and documents rollback to an earlier
successful production deployment. The pre-existing deployment above is the
identified rollback target. No rollback was necessary because no new deployment
was made. See Cloudflare's
[Direct Upload documentation](https://developers.cloudflare.com/pages/get-started/direct-upload/)
and
[Pages rollback documentation](https://developers.cloudflare.com/pages/configuration/rollbacks/).

## 3. Deterministic artifact regeneration

`pnpm publication:generate` regenerated all 18 schemas from contract release
2.0.0. The command left no tracked diff. `pnpm publication:check` then passed,
including registry hash integrity and source/destination byte equality.

```text
SCHEMA_HASH_PARITY=PASS
PUBLICATION_ARTIFACT_PARITY=PASS
```

The deterministic manifest contains 23 URL records and has SHA-256:

```text
415789de731196c77a4a3c0b378bad330544ef82eec9f6901688956640bd3847
```

The count is 22 files on the `siteborne.net` static surface plus the same PCC
schema under its frozen, actively referenced `$id` on `utility.siteborne.net`.

## 4. Publication manifest

| Canonical URL                                                                    | Source / generated path                                                                                                                                            | Content type                             | Bytes | SHA-256                                                            | Contract / service / schema identity              |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- | ----: | ------------------------------------------------------------------ | ------------------------------------------------- |
| `https://siteborne.net/`                                                         | `apps/network-site/index.html`                                                                                                                                     | `text/html; charset=utf-8`               |  2734 | `5da34b1fec6c544c5144f60e77fe43fb7642201c9f12b7e8f01a2bcd82575504` | 2.0.0                                             |
| `https://siteborne.net/.well-known/security.txt`                                 | `apps/network-site/.well-known/security.txt`                                                                                                                       | `text/plain; charset=utf-8`              |   127 | `295a2d317e1f9bc1f63818b427c15de1733bb0f511ad6fd352fcb0f375d7d889` | 2.0.0                                             |
| `https://siteborne.net/docs/a2a`                                                 | `apps/network-site/docs/a2a/index.html`                                                                                                                            | `text/html; charset=utf-8`               |  2403 | `bd81b5623d19f1cc2e4ba966b6056f858e34ad6cbad25a068f7b06982dd6b7ee` | 2.0.0                                             |
| `https://siteborne.net/extensions/a2a/x402/v1`                                   | `apps/network-site/extensions/a2a/x402/v1/index.html`                                                                                                              | `text/html; charset=utf-8`               |  2536 | `dcdb4a6bf8ec5d0641ac449a516937f267f0aba29b7f1f959a5d7daf1d5737c8` | 2.0.0                                             |
| `https://siteborne.net/schemas/common/async-job.schema.json`                     | `contracts/releases/2.0.0/schemas/common/async-job.schema.json` → `apps/network-site/schemas/common/async-job.schema.json`                                         | `application/schema+json; charset=utf-8` |  3616 | `2979350890d8b2376cf72fabbddbdbfe35182e693eb043d9ca20aa6fe86af994` | `$id` equals URL                                  |
| `https://siteborne.net/schemas/common/authorized-artifact-reference.schema.json` | `contracts/releases/2.0.0/schemas/common/authorized-artifact-reference.schema.json` → `apps/network-site/schemas/common/authorized-artifact-reference.schema.json` | `application/schema+json; charset=utf-8` |  1887 | `772db35bb1d19bcee3cfbbfde41da88f77bb10b9afeabe505a15e6a0b25655ac` | `$id` equals URL                                  |
| `https://siteborne.net/schemas/common/money.schema.json`                         | `contracts/releases/2.0.0/schemas/common/money.schema.json` → `apps/network-site/schemas/common/money.schema.json`                                                 | `application/schema+json; charset=utf-8` |  1727 | `4567307ae24362cb33c1078072cd4d409eb14c0a2783e9941c1d0ec0e7d4b90f` | `$id` equals URL                                  |
| `https://siteborne.net/schemas/common/pagination.schema.json`                    | `contracts/releases/2.0.0/schemas/common/pagination.schema.json` → `apps/network-site/schemas/common/pagination.schema.json`                                       | `application/schema+json; charset=utf-8` |  1414 | `a966b1d885ecb10d03d35f843bce625e60ca2ab6798040e178baa45ab5db3e31` | `$id` equals URL                                  |
| `https://siteborne.net/schemas/common/quote-request.schema.json`                 | `contracts/releases/2.0.0/schemas/common/quote-request.schema.json` → `apps/network-site/schemas/common/quote-request.schema.json`                                 | `application/schema+json; charset=utf-8` |  3439 | `6db5dcb73b5a40ff31bed8c0ce2acd045a785dd64a3bacaec05ede9d26a426bc` | `$id` equals URL                                  |
| `https://siteborne.net/schemas/common/quote-response.schema.json`                | `contracts/releases/2.0.0/schemas/common/quote-response.schema.json` → `apps/network-site/schemas/common/quote-response.schema.json`                               | `application/schema+json; charset=utf-8` |  6110 | `0fcc1ef9a79fa4548a47af3ba677c3cc260d68dffe4a6c2e53f9cc60d3601b11` | `$id` equals URL                                  |
| `https://siteborne.net/schemas/common/request-envelope.schema.json`              | `contracts/releases/2.0.0/schemas/common/request-envelope.schema.json` → `apps/network-site/schemas/common/request-envelope.schema.json`                           | `application/schema+json; charset=utf-8` |  4269 | `c3c50ca6e7bea34236e2ed92004f61d69acf52b208ba6d38e072a46900d817a9` | `$id` equals URL                                  |
| `https://siteborne.net/schemas/common/service-metadata.schema.json`              | `contracts/releases/2.0.0/schemas/common/service-metadata.schema.json` → `apps/network-site/schemas/common/service-metadata.schema.json`                           | `application/schema+json; charset=utf-8` |  7502 | `97f514fab559fd067673dad2b3aa546d47beb393160b40d4d1a34956158b03bb` | `$id` equals URL                                  |
| `https://siteborne.net/schemas/common/structured-error.schema.json`              | `contracts/releases/2.0.0/schemas/common/structured-error.schema.json` → `apps/network-site/schemas/common/structured-error.schema.json`                           | `application/schema+json; charset=utf-8` |  4787 | `aa968374d206ff5e8264dad3eca25be6b27e8bd849065843fa8488732c593d98` | `$id` equals URL                                  |
| `https://siteborne.net/schemas/proof-carrying-context.schema.json`               | `contracts/releases/2.0.0/schemas/proof-carrying-context.schema.json` → `apps/network-site/schemas/proof-carrying-context.schema.json`                             | `application/schema+json; charset=utf-8` | 20623 | `d32a8e25eba7a7ae4d7d7f7a14c565c1b92c8d8e10810ff885698ed102fdbcc0` | Frozen `$id` is the utility-origin URL below      |
| `https://siteborne.net/schemas/services/agent-verification-input.schema.json`    | `contracts/releases/2.0.0/schemas/services/agent-verification-input.schema.json` → `apps/network-site/schemas/services/agent-verification-input.schema.json`       | `application/schema+json; charset=utf-8` |  5595 | `66d459905cd1a18b57ccb3fc40043a4e4c1a77bc7dba40676fcaf674cacb0f34` | `verify_agent_output.v2`; `$id` equals URL        |
| `https://siteborne.net/schemas/services/agent-verification-output.schema.json`   | `contracts/releases/2.0.0/schemas/services/agent-verification-output.schema.json` → `apps/network-site/schemas/services/agent-verification-output.schema.json`     | `application/schema+json; charset=utf-8` | 14223 | `a9a462b89b290ecba1aa62ec6d2fd030572f326ed79f498a43690244b38ad679` | `verify_agent_output.v2`; `$id` equals URL        |
| `https://siteborne.net/schemas/services/company-evidence-input.schema.json`      | `contracts/releases/2.0.0/schemas/services/company-evidence-input.schema.json` → `apps/network-site/schemas/services/company-evidence-input.schema.json`           | `application/schema+json; charset=utf-8` |  4091 | `8d9a6c432b019e24a2df4d48dd93424a8782febb49c0c88f7cf9208cf0204dd7` | `company_evidence_graph.v2`; `$id` equals URL     |
| `https://siteborne.net/schemas/services/company-evidence-output.schema.json`     | `contracts/releases/2.0.0/schemas/services/company-evidence-output.schema.json` → `apps/network-site/schemas/services/company-evidence-output.schema.json`         | `application/schema+json; charset=utf-8` | 17817 | `5593736dfc60089aa3f01de664eb67ccba3a58e03449a66e91f477324e24861b` | `company_evidence_graph.v2`; `$id` equals URL     |
| `https://siteborne.net/schemas/services/document-evidence-input.schema.json`     | `contracts/releases/2.0.0/schemas/services/document-evidence-input.schema.json` → `apps/network-site/schemas/services/document-evidence-input.schema.json`         | `application/schema+json; charset=utf-8` |  3982 | `19e64c92f088ed8b7a45eef561c5426bb59ce5cc3576b85482aded4f620e57ba` | `document_evidence_json.v2`; `$id` equals URL     |
| `https://siteborne.net/schemas/services/document-evidence-output.schema.json`    | `contracts/releases/2.0.0/schemas/services/document-evidence-output.schema.json` → `apps/network-site/schemas/services/document-evidence-output.schema.json`       | `application/schema+json; charset=utf-8` | 15128 | `df91ed115ae0e29d8f4c211d95462ddd96e9714bc5f5e0ce0b820b370e0d5dde` | `document_evidence_json.v2`; `$id` equals URL     |
| `https://siteborne.net/schemas/services/web-context-input.schema.json`           | `contracts/releases/2.0.0/schemas/services/web-context-input.schema.json` → `apps/network-site/schemas/services/web-context-input.schema.json`                     | `application/schema+json; charset=utf-8` |  2841 | `d3b0762020d4cc1d1e846960ed978cf1237b1741f90213adabe8ed931c2845ea` | `web_context_verified.v2`; `$id` equals URL       |
| `https://siteborne.net/schemas/services/web-context-output.schema.json`          | `contracts/releases/2.0.0/schemas/services/web-context-output.schema.json` → `apps/network-site/schemas/services/web-context-output.schema.json`                   | `application/schema+json; charset=utf-8` | 13103 | `7d4882e997ec3a3bd97b746de36ed99dfe430d59b4d1c8adc7d9fa83a274b4e0` | `web_context_verified.v2`; `$id` equals URL       |
| `https://utility.siteborne.net/schemas/proof-carrying-context.schema.json`       | same frozen PCC source and generated bytes                                                                                                                         | `application/schema+json; charset=utf-8` | 20623 | `d32a8e25eba7a7ae4d7d7f7a14c565c1b92c8d8e10810ff885698ed102fdbcc0` | Frozen `$id`; requires utility-origin publication |

The manifest is deterministic and complete as an evidence inventory, but it is
not valid as an executable publication plan under this checkpoint's authority:
the final row cannot be deployed through the `siteborne.net` Pages project.

```text
PUBLICATION_MANIFEST_VALID=FAIL
```

## 5. Prepublication URL and live-state finding

The qualified-source canonical URL test passed 5/5 because it explicitly
classifies the utility-origin PCC `$id` as a documented future publication
target. The present checkpoint is stricter: a URL actively used by the schema
graph cannot remain future/unpublished.

The four frozen service output schemas all `$ref`:

```text
https://utility.siteborne.net/schemas/proof-carrying-context.schema.json
```

Read-only public fetch returned HTTP 404 with `text/plain`, not the PCC schema.
The `siteborne.net` Pages project cannot serve a path on the separate
`utility.siteborne.net` Worker hostname.

Current 100%-traffic production state creates two additional incompatibilities:

1. Production `/schemas` advertises all 18 schema URLs on
   `https://utility.siteborne.net/schemas/**`; those file paths are not served
   by the production Worker.
2. Production `/openapi.json` advertises `https://siteborne.net/license`, but
   there is no governed license artifact in the qualified bundle. The current
   Pages deployment returns generic root HTML for that path.

The 0%-traffic candidate corrected the schema projection origin and removed the
stale license URL, but promoting it is explicitly forbidden in this checkpoint.
Publishing the Pages bundle first would therefore leave current production
OpenAPI/schema references broken, contrary to sections 10–12 and the PASS law.

## 6. Security scan

The complete `apps/network-site` bundle was scanned before the stop:

- Gitleaks directory scan: 140,122 bytes, zero leaks.
- Credential/key/token/private-key pattern scan: zero findings.
- Private IPv4/internal-host/path disclosure scan: zero findings.
- Source-map and executable-source inventory: zero files.
- All 18 JSON schema files parsed with `jq`.
- The public governed pay-to value was not added to the static bundle by this
  checkpoint.

```text
PUBLICATION_SECURITY_SCAN=PASS
```

## 7. Prepublication live readback

Manifest-driven readback of the current public state produced:

```text
CANONICAL_URL_COUNT=23
CANONICAL_URL_HTTP_200=22/23
CANONICAL_HASH_MATCH=2/23
CANONICAL_CONTENT_TYPE_MATCH=4/23
```

Only `/` and `/.well-known/security.txt` matched the qualified bytes. The A2A
docs and extension paths returned HTTP 200 but wrong root-page bytes. All 18
`siteborne.net/schemas/**` paths returned HTTP 200 `text/html` SPA/static
fallbacks rather than `application/schema+json`; the utility-origin PCC path
returned 404. This is the exact failure mode the checkpoint prohibits.

Accordingly:

```text
CANONICAL_LIVE_READBACK=FAIL
A2A_CANONICAL_REFERENCE_READBACK=FAIL
OPENAPI_CATALOG_REFERENCE_READBACK=FAIL
CANONICAL_HASH_PARITY=FAIL
```

## 8. Economic parity and side-effect ledger

The focused unified gate passed 28/28 after regeneration:

```text
ECONOMIC_PROJECTION_PARITY=PASS
```

No paid route was called. Every network request in this checkpoint was a GET to
a static/public metadata endpoint or a read-only Cloudflare control-plane API.
No provider, payment, settlement, job, quote, or paid-transaction path was
entered.

```text
PROVIDER_INVOCATIONS=0
PAYMENT_AUTHORIZATIONS=0
PAYMENT_SETTLEMENTS=0
PAID_TRANSACTIONS=0
```

## 9. Publication, external directories, and Bazaar

The stop condition was reached before preview upload. No Pages deployment,
production static deployment, external-directory observation, Bazaar readback,
publication, registration, or recrawl was performed.

```text
STATIC_METADATA_DEPLOYMENTS=0
NEW_STATIC_DEPLOYMENT=not_created
EXTERNAL_AGENSTRY_READBACK=NOT_OBSERVABLE
EXTERNAL_GLAMA_READBACK=NOT_OBSERVABLE
EXTERNAL_MCP_REGISTRY_READBACK=NOT_OBSERVABLE
EXTERNAL_MCPMETRICS_READBACK=NOT_OBSERVABLE
BAZAAR_LIVE_READBACK=NOT_PERFORMED
BAZAAR_PUBLICATION_MUTATION=0
DIRECTORY_MUTATIONS=0
```

## 10. Final Worker and deployment state

The final readback remained exactly:

| Role                | Version                                | Traffic |
| ------------------- | -------------------------------------- | ------: |
| Production          | `ab9f0ebe-21ea-415a-a770-70f9cf1bec08` |    100% |
| Qualified candidate | `369b4bf5-c2f7-4e05-8454-7f5514a3bd45` |      0% |

No other Worker version receives traffic. `PAID_ROUTES_ENABLED=false` remains
unchanged.

```text
WORKER_STATE_UNCHANGED=PASS
WORKER_UPLOADS=0
WORKER_DEPLOYMENT_MUTATIONS=0
WORKER_TRAFFIC_MUTATIONS=0
DNS_MUTATIONS=0
SECRET_MUTATIONS=0
STATIC_METADATA_DEPLOYMENTS=0
```

## 11. Rollback readiness and closure

The immediately prior known-good static deployment is
`3428f3d8-89d2-4cef-8254-69197cea4cb9`. For a future authorized complete
publication, Cloudflare Pages can roll production back to that successful
production deployment without changing Worker traffic. Because this checkpoint
made no static deployment, rollback was not invoked.

```text
ROLLBACK_READY=YES
```

The next checkpoint must reconcile publication authority before retrying:

- decide how the frozen PCC utility-origin `$id` and four active `$ref`s will be
  served without changing their frozen bytes;
- reconcile the current production Worker's 18 utility-origin `/schemas`
  references and stale `/license` URL with the no-promotion boundary; and
- authorize one complete, atomic publication path that can pass live readback
  for both the current production contract and the already-qualified candidate.

No partial Pages upload was made because it could not satisfy the checkpoint's
success law. Candidate promotion and paid activation remain unauthorized.

```text
PRODUCTION_ECONOMICS_METADATA_PUBLICATION_01=BLOCKED
SAFE_FOR_HUMAN_AUTHORIZED_CANDIDATE_PROMOTION=NO
SAFE_FOR_PAID_ACTIVATION=NO
NEXT_RECOMMENDED_CHECKPOINT=PRODUCTION-ECONOMICS-METADATA-PUBLICATION-AUTHORITY-RECONCILIATION-01
```
