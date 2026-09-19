# PRODUCTION-ECONOMICS-DISCOVERY-01 closure

**Decision:** PASS_WITH_ACCEPTED_PRE_EXISTING_LIMITATION  
**Scope:** local qualification and publication-artifact preparation only  
**Date:** 2026-09-19  
**Production/economic mutations:** none

This checkpoint establishes one governed economic model and proves deterministic
parity across its repository-owned projections. It does not deploy, upload,
publish to Bazaar, enable paid routes, shift traffic, modify DNS or Cloudflare
state, invoke a paid service, or prove live paid fulfillment.

## 1. Lineage and starting state

- Branch: `metadata-vcm-qualification`
- Starting head: `685aae6aaf2c0c6038158c58b3c3d3410fda0276`
- Starting commit:
  `PRODUCTION-RELEASE-CANDIDATE-01: qualify final release candidate at zero percent`
- Upstream at closure: `origin/metadata-vcm-qualification` at the starting head
- The pre-existing stash was not read, applied, popped, dropped, or otherwise
  changed.
- The final local head is the commit containing this report; its immutable SHA
  is recorded in the final checkpoint return because a commit cannot truthfully
  contain its own SHA.

## 2. Implementation commits

In dependency order:

1. `4f22fe5` — add canonical economic contract and governed document page limit
2. `3038718` — reject unavailable modes before any payment step
3. `7a64877` — derive MCP quotes from the canonical economic contract
4. `a4812f1` — project canonical economics into VCM, A2A and Bazaar
5. `17dd1db` — govern the document page limit across projections
6. `a35e098` — publish the v2 paid contract in OpenAPI and catalog
7. `88a12f1` — make MCP tool metadata truthful, complete and derived
8. `7bcd7a6` — give every projected canonical URL a publication artifact
9. `3372dad` — qualify cross-surface parity and align fixture v2 price keys
10. `e0d51c8` — preserve plain-TSX script loading and repair TDQS
    typing/mutation anchors
11. `5e0af70` — align real-workerd qualification price assertions with v2
    pricing keys

No earlier implementation history was squashed or amended.

## 3. Changed-file inventory and scope

Relative to the starting head, 75 files changed: 8,906 insertions and 334
deletions before this report. Every file belongs to an authorized category:

- **Canonical economics:** `packages/pricing/src/economic-contract.ts`,
  `economic-contract.test.ts`, `index.ts`, `service-prices.ts`.
- **Pre-economic validation / x402 projection:**
  `apps/edge-api/src/control-plane/routes/paid-services.ts`,
  `pre-economic-mode-gate.ts`, both v2 production composition files,
  `production-payment.ts`, and
  `apps/edge-api/tests/unavailable-mode-prepayment-rejection.test.ts`.
- **VCM economics projection:** `packages/vcm/src/effective-view.ts`,
  `legacy/import-registry.ts`, projection
  contexts/types/projectors/tests/digests, fixtures, types and validators (14
  files).
- **A2A economics projection:**
  `packages/protocol-a2a/src/{card,transport,types}.ts`, `card.test.ts`,
  `apps/edge-api/src/routes/a2a.ts`, and
  `apps/edge-api/tests/a2a-economics-primary-compare.test.ts`.
- **MCP quote/metadata:** `packages/protocol-mcp/src/server.ts`,
  `transport.test.ts`, `tdqs.test.ts`,
  `apps/edge-api/src/control-plane/mcp/x402-mcp-adapter.ts`, and
  `apps/edge-api/tests/mcp-four-service-acceptance.test.ts`.
- **OpenAPI/catalog:** `packages/protocol-x402/src/openapi/paid-operations.ts`,
  `apps/edge-api/src/control-plane/routes/catalog.ts`, and the
  OpenAPI/catalog/route tests.
- **Bazaar declaration:**
  `packages/protocol-x402/src/bazaar/{discovery,economic-declaration,index,purchasable-example,registry-source,routes}.*`,
  plus protocol exports and economic projection.
- **Publication artifacts:** `apps/network-site/_headers`, two canonical HTML
  resources, and 18 copied schema JSON artifacts under
  `apps/network-site/schemas/`.
- **Tests:** canonical URL, economic parity, provider wiring, route, A2A, VCM,
  pricing, x402 and OpenAPI tests listed above.
- **Qualification scripts:** `scripts/check-embedded-pricing-drift.mts`,
  `generate-network-site-publication.mts`,
  `test-mcp-coherence-mutation-caught.mts`, `test-worker-runtime.mts`, and the
  corresponding root scripts in `package.json`.
- **Checkpoint report:** this file.

No lockfile, Vitest configuration, debug/probe/dump file, conflict artifact,
generated junk, or stash remnant is in the checkpoint diff. The worker-runtime
script change is a qualification-only repair: it derives v2 expectations from
governed pricing instead of embedding v1 amounts.

## 4. Canonical economic model and authority

The authoritative derivation is:

```text
governance/RISK_LIMITS.yaml
  -> packages/pricing/src/service-prices.ts
  -> packages/pricing/src/economic-contract.ts
  -> protocol projections
```

`packages/pricing/src/economic-contract.ts` owns service identity, version,
scheme, amount kind, unit, settlement model, modes, availability, pricing keys
and product posture. Operational state and the payment destination are injected
by the runtime; they are not invented by A2A, MCP, OpenAPI, catalog, Bazaar or
VCM.

## 5. Projection graph

```text
canonical economic contract
  + runtime production state and governed payment destination
  -> VCM effective view
      -> selected A2A card (signed only after representation selection)
      -> MCP comparison projection
  -> MCP get_quote / tool descriptions
  -> HTTP x402 requirements
  -> OpenAPI x-siteborne-economics
  -> catalog/service metadata
  -> Bazaar discovery declaration
```

The final 28-test unified gate proves governance = canonical contract = VCM =
A2A = MCP quote = HTTP 402 = OpenAPI = catalog = Bazaar for every applicable v2
capability and pricing model.

## 6. Current v2 pricing table

| Capability / mode               | Scheme | Governed price | Unit           | Settlement                          |
| ------------------------------- | -----: | -------------: | -------------- | ----------------------------------- |
| company evidence                |  exact |        $0.0312 | request        | exact amount                        |
| web direct                      |  exact |         $0.008 | request        | exact amount                        |
| web rendered                    |  exact |         $0.029 | request        | unavailable; pre-economic rejection |
| document native                 |   upto |        $0.0098 | processed page | measured usage                      |
| document OCR                    |   upto |        $0.0156 | processed page | measured usage                      |
| document table                  |   upto |        $0.0238 | processed page | measured usage                      |
| document authorization ceiling  |   upto |          $0.19 | job            | actual amount never exceeds ceiling |
| verify standard                 |  exact |         $0.017 | request        | exact amount                        |
| verify independent reproduction |  exact |         $0.049 | request        | unavailable; pre-economic rejection |

Pricing source version is `1.0.0`. The amount kind is `exact` except for the
document authorization maximum, which is `authorized_maximum`; document
settlement is measured per processed page using the highest applicable tier.

## 7. Availability and production admission

| Current v2 capability           | Mode available in contract |     Production admission posture |
| ------------------------------- | -------------------------: | -------------------------------: |
| company evidence                |                        yes | false / defined but not admitted |
| web direct                      |                        yes |                release candidate |
| web rendered                    |                         no |                            false |
| document extraction             |                        yes | false / defined but not admitted |
| verify standard                 |                        yes |                release candidate |
| verify independent reproduction |                         no |                            false |

Availability is a product capability fact; production admission is injected
runtime state. This checkpoint does not activate any route.
`PAID_ROUTES_ENABLED` remains false/absent in committed configuration.

## 8. Pre-economic rejection proof

Unavailable web `rendered` and verify `independent_reproduction` requests are
rejected before quote construction, payment challenge, payment verification,
provider invocation or service execution. The edge regression, OpenAPI
constraints, MCP quote rejection and unified parity gate all cover this
boundary. Unsupported modes are never silently downgraded or substituted.

## 9. payTo, network, asset and resource handling

The destination comes from `resolvePublicPaymentDestination` in
`apps/edge-api/src/control-plane/config/production-payment.ts`. It validates the
governed `SELLER_WALLET_ADDRESS` and combines it with the governed network and
asset. Missing or malformed configuration resolves to no destination, never a
sentinel. The address value is intentionally not reproduced in this report.

The parity gate proves that all enabled projections use the same payTo, network,
asset, resource, service version and amount kind. It also proves no wallet
literal is hard-coded in projection sources. `PAYTO_PROJECTION=PASS` locally;
operational/live ownership remains outside this checkpoint.

## 10. OpenAPI v2 state

- OpenAPI: `3.1.0`
- Contract version: `2.0.0-preproduction`
- All v2 paid paths are present.
- All `$ref` targets resolve and Ajv 2020 schemas compile.
- Economics blocks validate against the canonical projection.
- Unavailable modes are rejected by schema/runtime gates.
- The document limit is 10 pages.

## 11. Canonical URL publication state

The URL projection gate classifies every repository-projected SITEBORNE URL as a
current runtime endpoint, a generated repository publication artifact, or an
explicitly future/non-live target. No 404 is represented as a live canonical
resource.

`publication:check` verified the contract `2.0.0`, 18 copied schemas, canonical
HTML artifacts, and source/destination content hashes without drift.

- `PUBLICATION_ARTIFACTS_READY=YES`
- `PUBLICATION_DEPLOYED=NO`

## 12. Document page-limit parity

`max_document_pages=10` is equal across governance, canonical economics, runtime
enforcement, request schemas, OpenAPI, A2A, MCP, VCM, catalog and Bazaar. The
final gate also scans served surfaces for stale 100-page claims.

## 13. TDQS/tool-definition review

The actual locally exported `tools/list` response contains exactly the same six
tool identities:

1. `siteborne_company_evidence_graph`
2. `siteborne_web_context_verified`
3. `siteborne_document_evidence_json`
4. `siteborne_verify_agent_output`
5. `siteborne_get_quote`
6. `siteborne_get_service_health`

No tool was renamed and no seventh tool was added. The deterministic
`mcp-tdqs@0.1.0` lint scored all six with 100% parameter coverage, 0 errors, 3
heuristic warnings and 0 notes. The warnings are advisory shadow-language
heuristics, not missing schema or behavioral claims.

The descriptions were reviewed against executable/source authority:

- replay protection / “not charged twice” maps to payment replay and
  request/body-binding invariants;
- idempotent annotations map to same-payment retry handling, not a promise that
  arbitrary new payments are free;
- open-world hints match whether execution can leave SITEBORNE;
- unavailable modes map to pre-economic gates;
- prices and actual-vs-authorization wording are rendered from canonical
  economics;
- the 10-page statement maps to governance, schemas and runtime enforcement;
- structured failures map to boundary error translation tests;
- production-enabled wording is derived from the health state supplied to the
  MCP server. The TDQS export is candidate-context local evidence, not a claim
  that this checkpoint activated production.

## 14. Exact local test and validation evidence

| Area                    | Result | Exact evidence                                                                    |
| ----------------------- | ------ | --------------------------------------------------------------------------------- |
| Pricing                 | PASS   | 79/79 tests in 4 files (includes canonical economic contract)                     |
| VCM                     | PASS   | 152/152 tests in 16 files                                                         |
| A2A unit                | PASS   | 60/60                                                                             |
| A2A property            | PASS   | 6/6                                                                               |
| A2A fixture             | PASS   | 1/1                                                                               |
| A2A edge                | PASS   | 6/6                                                                               |
| MCP protocol unit       | PASS   | 104/104                                                                           |
| MCP property invocation | PASS   | 104/104                                                                           |
| MCP edge                | PASS   | 7/7                                                                               |
| MCP stdio               | PASS   | 1/1                                                                               |
| TDQS targeted           | PASS   | 13/13                                                                             |
| x402 unit               | PASS   | 537/537                                                                           |
| x402 property           | PASS   | 20/20                                                                             |
| Edge API                | PASS   | 1,684 passed, 72 skipped; 142 passed files, 22 skipped files                      |
| Unified economics       | PASS   | 28/28                                                                             |
| Governance validation   | PASS   | 77 pass, 0 fail                                                                   |
| State validation        | PASS   | 30 pass, 0 fail                                                                   |
| Task validation         | PASS   | 252 pass, 0 fail                                                                  |
| Production preflight    | PASS   | 12/12 paid routes structurally unavailable; read-only secret-name inventory only  |
| Root typecheck          | PASS   | 25/25 Turbo tasks                                                                 |
| Root lint               | PASS   | 17/17 Turbo tasks                                                                 |
| Secret scan             | PASS   | 1,635 working-tree files / 17.4 MB; 869-commit Git scan / about 31 MB; zero leaks |

Protocol fixture/spec checks, metadata verification, package packing, registry
parity, effective-view validation, generated PCC TypeScript/Python, generated
service models, OpenAPI drift, schema drift, pricing drift, contract
baseline/compatibility/release checks, canonical URL checks and publication
hashes also passed.

The package-local `pricing`, `vcm` and `edge-api` test scripts inherit root
Vitest globs while changing cwd and therefore report “No test files found”;
those scripts/configs are unchanged from the starting head. The same source
trees were run directly from the root and produced the exact green counts above.

## 15. Root aggregate and real-workerd pre-existing limitations

These checks are truthfully not relabeled PASS:

- Current root aggregate: 3 failed files / 301 passed / 22 skipped; 15 failed
  tests / 3,772 passed / 78 skipped. Thirteen reconciliation tests hit their
  5-second timeout, one load assertion exceeded its shared-host p95 threshold
  and one document subprocess test hit 60 seconds.
- Each failing current file passed alone: reconciliation 38/38, load 7/7 (burst
  p95 about 11.3 seconds under the 24.5-second limit), and document subprocess
  3/3 (10-page OCR about 14.7 seconds).
- A clean detached starting-head worktree also failed its root aggregate: 2
  failed files / 294 passed / 23 skipped; 3 failed / 3,633 passed / 81 skipped.
  The affected current test files have no checkpoint diff. Classification:
  `PASS_WITH_ACCEPTED_PRE_EXISTING_LIMITATION` for aggregate shared-host
  contention/discovery behavior.
- Real-workerd harness after the qualification repair: 89/99. A clean detached
  starting head is also 89/99 with the same 10 failures (one stale paid-MCP
  expectation, eight stale response-envelope assertions and one stale
  bundle-marker assertion). Before the repair, the checkpoint added three
  v1-price expectations; deriving them from the v2 keys removed exactly those
  three. No unrelated baseline failure was changed.

## 16. Plain-TSX/source-import validation

The prior barrel-cycle blind spot is closed by loading source through the actual
plain-TSX scripts. All passed:

- `schemas:check`
- `pricing:check` (15 keys)
- `pricing:registry:check` (8 entries)
- PCC TypeScript/Python drift check
- 18 generated service models drift check
- three generated OpenAPI files drift check
- publication generation/hash check
- governance/state/task validators
- production preflight

Therefore `VITEST_IMPORT_PATHS=PASS` and `PLAIN_TSX_IMPORT_PATHS=PASS`.

## 17. Formatting baseline and quality classification

- Checkpoint-changed, Prettier-supported files: PASS.
- `apps/network-site/_headers`: not accepted by any inferred Prettier parser;
  validated as its own platform syntax and not mislabeled formatted.
- Global current `pnpm format:check`: FAIL on exactly 268 files.
- Clean detached starting head `pnpm format:check`: FAIL on exactly the same 268
  files.
- Classification: `GLOBAL_REPOSITORY_FORMAT_BASELINE=PRE_EXISTING_FAIL`; no
  repository-wide formatter was run.
- `git diff --check`: PASS.

## 18. Mutation-test evidence

After the suite, a controlled mutation changed the current web-v2 canonical
pricing key to the v1 key. The unified gate failed as required, including an
8,000-vs-9,000 HTTP/MCP/surface mismatch and a production-composition
pricing-key mismatch. The file was restored, and SHA-256 returned byte-for-byte
to `48296bc9a563643ef7bd69483681087ddbdfb5730f84d58cd82b8ea2577e2eb0` before the
final canonical run. The final unified gate then passed 28/28.

The first restoration attempt matched the adjacent v1 block; the mandatory
hash/diff verification detected it before acceptance. Both service-specific
blocks were then restored with narrow context and the original hash was proven.
No mutation survived in the working tree.

## 19. Authority and VCM invariant review

- `AUTHORITY_INVERSION=NO`.
- A2A, MCP, OpenAPI, catalog and Bazaar consume canonical economics; none is a
  pricing authority.
- VCM primary/compare behavior is preserved.
- The legacy independent builder remains preserved.
- Mismatch and projector-failure fallback remain preserved.
- Representation selection occurs before signing; there is no
  sign-then-substitute path.
- MCP handlers do not import or depend on VCM.
- Economic projection is descriptive/qualification state, not runtime payment
  authorization.

The VCM suite, primary-compare A2A test, shadow projection/digest tests and
final pairwise surface comparison supply executable coverage for these claims.

## 20. Secret scan and side-effect accounting

The secret-scan scope verifier, full redacted Git-history gitleaks scan and
working-tree scan passed with zero leaks. No secret values, bearer material,
signed payment content or credential attributes were printed into this report.

```text
PAID_ROUTES_ENABLED=false
ECONOMIC_SIDE_EFFECT_DELTA=NONE
PROVIDER_SIDE_EFFECT_DELTA=NONE
PRODUCTION_CONFIG_CHANGED=NO
CLOUDFLARE_MUTATIONS=0
WORKER_UPLOADS=0
DEPLOYMENTS=0
TRAFFIC_MUTATIONS=0
DNS_MUTATIONS=0
PAID_TRANSACTIONS=0
BAZAAR_PUBLICATIONS=0
```

The production preflight used only a read-only secret-name listing and performed
no mutation.

## 21. Remaining external blockers

- Bazaar live publication/readback: NOT_PERFORMED / NOT_PROVEN.
- External directory recrawl/readback: NOT_PERFORMED; no external observer has
  yet seen this local candidate.
- Publication artifacts: ready locally, not deployed.
- Production paid routes: disabled.
- Company/document current-lineage paid acceptance: pending a separately
  authorized checkpoint.
- Nevermined production qualification: separate and pending.
- Credentialed paid fulfillment: not performed and not inferred from metadata,
  protocol, 402 or refusal-path evidence.

None authorizes a production mutation in this checkpoint.

## 22. Recommendation

The local checkpoint is safe to close as
PASS_WITH_ACCEPTED_PRE_EXISTING_LIMITATION. The next checkpoint, only after
separate human authorization, should be
`PRODUCTION-ECONOMICS-IMMUTABLE-CANDIDATE-01`: build and upload one new
immutable Worker candidate at 0% traffic, keep paid activation off,
exact-version qualify health, MCP, A2A/JWS, OpenAPI, economics, canonical
publication artifacts, unsupported-mode rejection, caller binding and
pre-authority provider exclusion, prove zero economic side effects, and publish
an immutable evidence record.

Do not begin that checkpoint from this report alone.
