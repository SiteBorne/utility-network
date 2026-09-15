# METADATA-VCM-05 — Registry Field Authority & Immutability Reconciliation

## Decision and scope

**METADATA_VCM_05=PASS** for this repository authority investigation.
**SAFE_TO_BEGIN_SHADOW_PROJECTION_PARITY=NO.** Select **PATH_B**, with
code-derived current exposure imported into VCM as a prerequisite, not
independently authored exposure booleans. No compiler or correction is
implemented here.

The working registry is **PARTIAL** in its immutability: accepted release
directories are wholly immutable; the active v2 registry metadata is
semantically pinned by the active release comparison; v1 working metadata is
outside that active comparison and has an explicitly approved schema-hash update
in history. That does not give permission to reinterpret old identity, pricing,
or release declarations. There is **no demonstrated freely rewritable current
protocol field** in these files.

The retained `planned` values are compatibility evidence. For v1 they originate
in the preimplementation release. For v2 they were copied after implementations
existed, so they must **not** be narrated as proof that implementation was
absent at the v2 freeze. Classification **C** is the common answer; v1 also has
the historical basis for **A**. Existing discovery producers do not consult
these flags. VCM does, making its static exposure false for all six modeled
surfaces. Internal economic validity and lossless registry parity do not
establish current exposure validity.

Inspection anchor: `e65acbcd03f333139d9c2bd4c4c41e42b1580c48`; implementation
anchor: `cc46c3a87781824ac2fc56e5d86966cd0c137ad0`. Initial `git status --short`
and `git diff --stat` were empty. VCM schema 0.2.0 and the closed truth-core
checkpoint are preserved. This report assesses committed code, not deployed
configuration or paid fulfillment. No network, secrets, Cloudflare, economic
actions, deployment, or public metadata edits were used.

## 1. Evidence map and method

All eight JSON files were parsed recursively before grouping. All field
spellings and their typed aliases were traced through the importer/projector and
the registry import boundary, then through its consumers. Whole-object imports,
copies, and D1 seeding were included; unrelated provider registries and
payment-provider registration records were distinguished from
`registry/services`.

Primary evidence (repository-relative paths; function names make the references
stable):

| ID  | Source                                                                                                                                                                                                                                                   | Evidence used                                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| E01 | `governance/CONTRACT_COMPATIBILITY.yaml`                                                                                                                                                                                                                 | `baseline_rules`, `forbidden_silent_changes`, `service_metadata_compatibility`, service-specific and common freeze rules                          |
| E02 | `packages/contracts/scripts/compat.ts:131`                                                                                                                                                                                                               | `compareSchemas`; every changed scalar defaults to a major classification, including metadata scalars; arrays recurse by index                    |
| E03 | `packages/contracts/scripts/compat.ts:271`                                                                                                                                                                                                               | `baselineVerify`, `releaseVerify`, `compatCheck`, `main`; original baseline versus active comparison distinction                                  |
| E04 | `docs/decisions/0012-service-contract-release-versioning.md`, `0013-contract-compatibility-classification.md`, `0014-frozen-baseline-and-change-enforcement.md`, `0015-strict-consumer-compatibility-model.md`; `docs/contracts/COMPATIBILITY_POLICY.md` | Accepted release and strict-consumer law; new directories, never rewriting old snapshots                                                          |
| E05 | `schemas/common/service-metadata.schema.json`                                                                                                                                                                                                            | Actual field descriptions, required fields, status vocabulary, production false requirement                                                       |
| E06 | `packages/protocol-x402/src/bazaar/registry-source.ts` and `registry-pricing.ts`                                                                                                                                                                         | Only production static JSON import boundary; eight entries, v2 governed price projection, raw protocol fields not in the typed consumer interface |
| E07 | `packages/vcm/src/legacy/{import-registry,project-registry,types,contract-map,pricing-map}.ts`                                                                                                                                                           | Every registry value represented; release/current exposure conflation and separate current pricing                                                |
| E08 | `packages/protocol-a2a/src/{card,constants,executor}.ts`; `apps/edge-api/src/routes/a2a.ts`; `apps/edge-api/src/index.ts:110`                                                                                                                            | Eight skills, identity dispatch, mounted endpoint/card, injected operational status                                                               |
| E09 | `packages/protocol-mcp/src/{server,constants,frozen-contracts}.ts`; `apps/edge-api/src/routes/mcp.ts`                                                                                                                                                    | Four primary v2 tools plus quote/health, actual registration factory, schema bundles and versions                                                 |
| E10 | `packages/protocol-x402/src/bazaar/{discovery,routes,capability,catalog-status,frozen-inputs,schema-bundle}.ts`                                                                                                                                          | Declaration production, frozen route sources, capabilities, governed amounts, external catalog status                                             |
| E11 | `packages/protocol-nevermined/src/{declarations,routes,registry-reconciliation}.ts`                                                                                                                                                                      | Independent declaration and registered-ID sources; external registry reconciliation is a separate domain                                          |
| E12 | `apps/edge-api/src/control-plane/routes/{paid-services,catalog}.ts`; `apps/edge-api/src/control-plane/config/production-payment.ts`                                                                                                                      | D1 seed, current discovery overlays, route composition, catalog and OpenAPI producers                                                             |
| E13 | `packages/pcc-schema/scripts/{generate-openapi,drift-check-openapi,generate-service-models,drift-check-services,generate-manifest}.ts`                                                                                                                   | Schemas and release tooling; generation is not an import of registry protocol flags                                                               |
| E14 | `scripts/check-registry-pricing-drift.mts`; `packages/pricing/src/service-prices.ts`                                                                                                                                                                     | Historical-price exceptions and current governed price source; narrower checker scope than its headline                                           |
| E15 | `packages/vcm/src/{types,runtime-overlay,effective-view}.ts`                                                                                                                                                                                             | Static exposure gates the overlay; runtime cannot widen exposure; qualification and economic time separation                                      |
| E16 | `docs/decisions/0048-bazaar-discovery-as-canonical-extension.md`; `docs/operations/X402_BAZAAR_METADATA.md`                                                                                                                                              | Composition of registry descriptions, frozen schemas/routes, governance pricing, and protocol-specific state                                      |

Supporting context: METADATA-ECON-01; METADATA-VCM-IMPL-02 status/evidence; VCM
importer references to the frozen master design; SUN-1000 checkpoint 1M evidence
in its introducing commit and task history. Source code and policy take priority
over report wording. In particular, ECON-01's shorthand that baseline
verification checks working registry price byte identity is too broad: baseline
verification hashes snapshot files; active compatibility separately compares
working files semantically.

## 2. Complete structural inventory

Count convention: **36 normalized paths**, including object/array container
paths, seven protocol children, four money children, and three array-element
paths (`[]`). There are **33 named property paths**; `[]` describes all actual
indexed elements, not an assumed schema field. Root `$` is not counted. The
exact indexed-array expansion appears below, so no real elements are hidden by
the normalization. All 36 normalized paths occur in **8/8 services**; no
optional or additional paths were found.

Files: four families (`company_evidence_graph`, `document_evidence_json`,
`verify_agent_output`, `web_context_verified`) × `.v1.json` and `.v2.json`.

Inventory columns are normalized through family and evidence codes only to keep
this table readable. Each row explicitly includes temporal, authority,
mutability, compatibility, and rewrite status. `Consumers=Fxx/§5` resolves to
the full consumer matrix. `INTRO` means **94ad83c (SUN-0101) for v1 / ea4cbb4
(SUN-1000 1M) for v2**, verified from file history; `HASH` additionally records
v1 output-hash replacement at **6be370e (SUN-0102)** and **ea4cbb4**. `K` means
active v2 semantic equality required by E02/E03; v1 requires policy
classification but is not in the active v2 metadata comparison. `D` adds
verified derived-schema provenance and controlled release updates. **NO** means
no safe unclassified rewrite of the existing release/current mixed document;
this checkpoint authorizes none in any event.

| FIELD_PATH                     | EXAMPLE_VALUE (first sorted service)                                                                                                                                                         | PRESENT_IN_SERVICES | INTRODUCED_BY | CURRENT_CONSUMERS | CURRENT_AUTHORITY         | TEMPORAL_CLASS      | MUTABILITY_CLASS        | CONTRACT_COMPATIBILITY_STATUS | SAFE_TO_REWRITE_IN_PLACE |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------: | ------------- | ----------------- | ------------------------- | ------------------- | ----------------------- | ----------------------------- | ------------------------ |
| `service_id`                   | `"company_evidence_graph.v1"`                                                                                                                                                                |                   8 | INTRO         | F01/§5            | NORMATIVE_CURRENT         | CURRENT_STATIC_FACT | FROZEN_RELEASE_EVIDENCE | K                             | NO                       |
| `service_version`              | `"v1"`                                                                                                                                                                                       |                   8 | INTRO         | F01/§5            | NORMATIVE_CURRENT         | CURRENT_STATIC_FACT | FROZEN_RELEASE_EVIDENCE | K                             | NO                       |
| `title`                        | `"Company Evidence Graph"`                                                                                                                                                                   |                   8 | INTRO         | F02/§5            | NORMATIVE_CURRENT         | CURRENT_STATIC_FACT | FROZEN_RELEASE_EVIDENCE | K                             | NO                       |
| `description`                  | `"Resolves and verifies canonical company identity, SEC submissions, XBRL facts, website evidence, regulatory mentions, and public repository signals into a structured evidence graph."`    |                   8 | INTRO         | F02/§5            | NORMATIVE_CURRENT         | CURRENT_STATIC_FACT | FROZEN_RELEASE_EVIDENCE | K                             | NO                       |
| `capabilities`                 | `["identity_resolution","sec_submissions","xbrl_facts","recent_filings","website_evidence","regulatory_mentions","public_repository_signals"]`                                               |                   8 | INTRO         | F03/§5            | NORMATIVE_CURRENT         | CURRENT_STATIC_FACT | FROZEN_RELEASE_EVIDENCE | K                             | NO                       |
| `capabilities[]`               | `"identity_resolution"`                                                                                                                                                                      |                   8 | INTRO         | F03/§5            | NORMATIVE_CURRENT         | CURRENT_STATIC_FACT | FROZEN_RELEASE_EVIDENCE | K                             | NO                       |
| `input_schema_uri`             | `"https://siteborne.net/schemas/services/company-evidence-input.schema.json"`                                                                                                                |                   8 | INTRO         | F04/§5            | DERIVED_CURRENT           | MIXED               | DERIVED_CURRENT         | D                             | NO                       |
| `input_schema_hash`            | `"sha256:8d9a6c432b019e24a2df4d48dd93424a8782febb49c0c88f7cf9208cf0204dd7"`                                                                                                                  |                   8 | INTRO         | F04/§5            | DERIVED_CURRENT           | MIXED               | DERIVED_CURRENT         | D                             | NO                       |
| `output_schema_uri`            | `"https://siteborne.net/schemas/services/company-evidence-output.schema.json"`                                                                                                               |                   8 | INTRO         | F04/§5            | DERIVED_CURRENT           | MIXED               | DERIVED_CURRENT         | D                             | NO                       |
| `output_schema_hash`           | `"sha256:5593736dfc60089aa3f01de664eb67ccba3a58e03449a66e91f477324e24861b"`                                                                                                                  |                   8 | HASH          | F04/§5            | DERIVED_CURRENT           | MIXED               | DERIVED_CURRENT         | D                             | NO                       |
| `pcc_version`                  | `"1.0.0"`                                                                                                                                                                                    |                   8 | INTRO         | F05/§5            | MIRROR                    | CURRENT_STATIC_FACT | FROZEN_RELEASE_EVIDENCE | K                             | NO                       |
| `pricing_schemes`              | `["exact","upto"]`                                                                                                                                                                           |                   8 | INTRO         | F06/§5            | MIRROR                    | CURRENT_STATIC_FACT | FROZEN_RELEASE_EVIDENCE | K                             | NO                       |
| `pricing_schemes[]`            | `"exact"`                                                                                                                                                                                    |                   8 | INTRO         | F06/§5            | MIRROR                    | CURRENT_STATIC_FACT | FROZEN_RELEASE_EVIDENCE | K                             | NO                       |
| `base_price`                   | `{"amount":"0.039","currency":"USD"}`                                                                                                                                                        |                   8 | INTRO         | F07/§5            | FROZEN_RELEASE_EVIDENCE   | RELEASE_TIME_FACT   | FROZEN_RELEASE_EVIDENCE | K                             | NO                       |
| `base_price.amount`            | `"0.039"`                                                                                                                                                                                    |                   8 | INTRO         | F07/§5            | FROZEN_RELEASE_EVIDENCE   | RELEASE_TIME_FACT   | FROZEN_RELEASE_EVIDENCE | K                             | NO                       |
| `base_price.currency`          | `"USD"`                                                                                                                                                                                      |                   8 | INTRO         | F07/§5            | FROZEN_RELEASE_EVIDENCE   | RELEASE_TIME_FACT   | FROZEN_RELEASE_EVIDENCE | K                             | NO                       |
| `maximum_price`                | `{"amount":"0.19","currency":"USD"}`                                                                                                                                                         |                   8 | INTRO         | F07/§5            | FROZEN_RELEASE_EVIDENCE   | RELEASE_TIME_FACT   | FROZEN_RELEASE_EVIDENCE | K                             | NO                       |
| `maximum_price.amount`         | `"0.19"`                                                                                                                                                                                     |                   8 | INTRO         | F07/§5            | FROZEN_RELEASE_EVIDENCE   | RELEASE_TIME_FACT   | FROZEN_RELEASE_EVIDENCE | K                             | NO                       |
| `maximum_price.currency`       | `"USD"`                                                                                                                                                                                      |                   8 | INTRO         | F07/§5            | FROZEN_RELEASE_EVIDENCE   | RELEASE_TIME_FACT   | FROZEN_RELEASE_EVIDENCE | K                             | NO                       |
| `execution_mode`               | `"async"`                                                                                                                                                                                    |                   8 | INTRO         | F08/§5            | FROZEN_RELEASE_EVIDENCE   | RELEASE_TIME_FACT   | FROZEN_RELEASE_EVIDENCE | K                             | NO                       |
| `maximum_input_bytes`          | `1048576`                                                                                                                                                                                    |                   8 | INTRO         | F09/§5            | FROZEN_RELEASE_EVIDENCE   | RELEASE_TIME_FACT   | FROZEN_RELEASE_EVIDENCE | K                             | NO                       |
| `expected_latency_class`       | `"variable"`                                                                                                                                                                                 |                   8 | INTRO         | F10/§5            | FROZEN_RELEASE_EVIDENCE   | RELEASE_TIME_FACT   | FROZEN_RELEASE_EVIDENCE | K                             | NO                       |
| `authorization_classification` | `"public"`                                                                                                                                                                                   |                   8 | INTRO         | F11/§5            | FROZEN_RELEASE_EVIDENCE   | RELEASE_TIME_FACT   | FROZEN_RELEASE_EVIDENCE | K                             | NO                       |
| `promotion_state`              | `"executable_candidate"`                                                                                                                                                                     |                   8 | INTRO         | F12/§5            | FROZEN_RELEASE_EVIDENCE   | RELEASE_TIME_FACT   | FROZEN_RELEASE_EVIDENCE | K                             | NO                       |
| `production_enabled`           | `false`                                                                                                                                                                                      |                   8 | INTRO         | F13/§5            | FROZEN_RELEASE_EVIDENCE   | RELEASE_TIME_FACT   | FROZEN_RELEASE_EVIDENCE | K                             | NO                       |
| `declared_limitations`         | `["SEC data is cache-only, not real-time","No real-time price or trading data","Website evidence limited to publicly accessible pages","Repository signals limited to public repositories"]` |                   8 | INTRO         | F03/§5            | NORMATIVE_CURRENT         | CURRENT_STATIC_FACT | FROZEN_RELEASE_EVIDENCE | K                             | NO                       |
| `declared_limitations[]`       | `"SEC data is cache-only, not real-time"`                                                                                                                                                    |                   8 | INTRO         | F03/§5            | NORMATIVE_CURRENT         | CURRENT_STATIC_FACT | FROZEN_RELEASE_EVIDENCE | K                             | NO                       |
| `protocols`                    | `{"x402":"planned","mcp":"planned","a2a":"planned","nevermined":"planned","agentverse":"planned","coinbase_bazaar":"planned","mcp_registry":"planned"}`                                      |                   8 | INTRO         | F14/§5            | LEGACY_COMPATIBILITY_ONLY | RELEASE_TIME_FACT   | FROZEN_RELEASE_EVIDENCE | K                             | NO                       |
| `protocols.x402`               | `"planned"`                                                                                                                                                                                  |                   8 | INTRO         | F14/§5            | LEGACY_COMPATIBILITY_ONLY | RELEASE_TIME_FACT   | FROZEN_RELEASE_EVIDENCE | K                             | NO                       |
| `protocols.mcp`                | `"planned"`                                                                                                                                                                                  |                   8 | INTRO         | F14/§5            | LEGACY_COMPATIBILITY_ONLY | RELEASE_TIME_FACT   | FROZEN_RELEASE_EVIDENCE | K                             | NO                       |
| `protocols.a2a`                | `"planned"`                                                                                                                                                                                  |                   8 | INTRO         | F14/§5            | LEGACY_COMPATIBILITY_ONLY | RELEASE_TIME_FACT   | FROZEN_RELEASE_EVIDENCE | K                             | NO                       |
| `protocols.nevermined`         | `"planned"`                                                                                                                                                                                  |                   8 | INTRO         | F14/§5            | LEGACY_COMPATIBILITY_ONLY | RELEASE_TIME_FACT   | FROZEN_RELEASE_EVIDENCE | K                             | NO                       |
| `protocols.agentverse`         | `"planned"`                                                                                                                                                                                  |                   8 | INTRO         | F14/§5            | LEGACY_COMPATIBILITY_ONLY | RELEASE_TIME_FACT   | FROZEN_RELEASE_EVIDENCE | K                             | NO                       |
| `protocols.coinbase_bazaar`    | `"planned"`                                                                                                                                                                                  |                   8 | INTRO         | F14/§5            | LEGACY_COMPATIBILITY_ONLY | RELEASE_TIME_FACT   | FROZEN_RELEASE_EVIDENCE | K                             | NO                       |
| `protocols.mcp_registry`       | `"planned"`                                                                                                                                                                                  |                   8 | INTRO         | F14/§5            | LEGACY_COMPATIBILITY_ONLY | RELEASE_TIME_FACT   | FROZEN_RELEASE_EVIDENCE | K                             | NO                       |
| `updated_at`                   | `"2026-08-05T22:00:00Z"`                                                                                                                                                                     |                   8 | INTRO         | F15/§5            | HISTORICAL                | RELEASE_TIME_FACT   | HISTORICAL              | K                             | NO                       |

### Exact array-index coverage

These are the union of concrete array paths; each container itself is already in
the inventory. Counts refer to service files in which that concrete index
exists.

| Concrete path             | Present in services | Example                                                 |
| ------------------------- | ------------------: | ------------------------------------------------------- |
| `capabilities[0]`         |                   8 | `identity_resolution`                                   |
| `capabilities[1]`         |                   8 | `sec_submissions`                                       |
| `capabilities[2]`         |                   8 | `xbrl_facts`                                            |
| `capabilities[3]`         |                   6 | `recent_filings`                                        |
| `capabilities[4]`         |                   2 | `website_evidence`                                      |
| `capabilities[5]`         |                   2 | `regulatory_mentions`                                   |
| `capabilities[6]`         |                   2 | `public_repository_signals`                             |
| `pricing_schemes[0]`      |                   8 | `exact`                                                 |
| `pricing_schemes[1]`      |                   8 | `upto`                                                  |
| `declared_limitations[0]` |                   8 | `SEC data is cache-only, not real-time`                 |
| `declared_limitations[1]` |                   8 | `No real-time price or trading data`                    |
| `declared_limitations[2]` |                   8 | `Website evidence limited to publicly accessible pages` |
| `declared_limitations[3]` |                   8 | `Repository signals limited to public repositories`     |

Fully index-expanded structural count: **46 paths** (33 named properties plus
indexed elements). Normalized audit count remains 36.

## 3. Field authority and temporal model

`CURRENT_AUTHORITY` describes the role of the **stored registry value**, not who
controls the corresponding live fact. A field can be normative for presentation
and simultaneously protected as release compatibility evidence. “Current static”
does not imply editable without a compatibility process. Conversely, a stored
release declaration does not become a live fact merely because VCM copies it
into a canonical-looking member.

| Family                       | Stored-value temporal interpretation                                                                      | Authority of corresponding current fact / consequence                                                                                                                                                                      |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F01 Identity                 | CURRENT_STATIC_FACT; persistent service-major identity, also frozen in every release                      | Contract identity/version policy; no reinterpretation or v1→v2 repointing. Tool-name mappings are separate current facts.                                                                                                  |
| F02 Presentation             | CURRENT_STATIC_FACT for registry-backed A2A/Bazaar/Nevermined presentation; also accepted release content | Registry authorship, constrained by compatibility; catalog serves seeded D1 copies and MCP has separately authored descriptions. Equal text is not proof of shared authority.                                              |
| F03 Capabilities/limitations | CURRENT_STATIC_FACT as advertised bounded capability descriptions; also release content                   | Registry is the descriptive source for E08/E10/E11, not proof of production qualification or every runtime mode.                                                                                                           |
| F04 Schema refs/hashes       | MIXED: current canonical schema references in working registry versus RELEASE_TIME_FACT in snapshots      | Canonical schema bytes/manifest and accepted release descriptors. All four v1 output hashes now point to widened current schemas, unlike frozen 1.x metadata. Never pair these blindly with old-release digest claims.     |
| F05 PCC version              | CURRENT_STATIC_FACT: wire version 1.0.0, also a release binding                                           | PCC document version; schema release 1.0.1/1.1.0 and contract release 1.x/2.0.0 are different facts.                                                                                                                       |
| F06 Pricing schemes          | CURRENT_STATIC_FACT as contract-supported scheme vocabulary, also frozen                                  | Actual route/payment policy chooses exact/upto, network and tier. Presence in the array is not proof every route enables every combination.                                                                                |
| F07 Prices                   | RELEASE_TIME_FACT                                                                                         | Current price: governance via pricing resolver = CURRENT_STATIC_FACT. Runtime admitted effective price = CURRENT_OPERATIONAL_FACT. Input-bound quote/authorization amount = TRANSACTION_TIME_FACT.                         |
| F08 Execution mode           | RELEASE_TIME_FACT: declared async contract                                                                | Actual invocation/operation registration and runtime execution model establish current static behavior; MCP transport response style is not the service async contract.                                                    |
| F09 Input bound              | RELEASE_TIME_FACT: declared maximum payload                                                               | Schema constraints and actual request-boundary enforcement are current static limits. No consumer trace proves this registry scalar enforces runtime admission.                                                            |
| F10 Latency                  | RELEASE_TIME_FACT: declared expectation                                                                   | Current measured latency is CURRENT_OPERATIONAL_FACT with environment/window/evidence. `variable` or `slow` is not a measured SLA; schema description mentions sync despite current async declaration.                     |
| F11 Authorization            | RELEASE_TIME_FACT: declared public/buyer-authorized data access                                           | Current static required authorization from contract/runtime policy; an individual authorization grant/signature is TRANSACTION_TIME_FACT. Never treat `public` as permission for free paid execution.                      |
| F12 Promotion                | RELEASE_TIME_FACT: executable_candidate declaration                                                       | Governance defines lifecycle vocabulary; current qualification/promotion needs an evidenced operational overlay. Importer's uppercase conversion does not prove current qualification.                                     |
| F13 Production               | RELEASE_TIME_FACT: false at metadata checkpoint                                                           | Actual admission is CURRENT_OPERATIONAL_FACT from version-local production composition, environment gates and DB availability. Never copy false into a present-tense production claim or infer true from implemented code. |
| F14 Protocols                | RELEASE_TIME_FACT retained for compatibility; not reliable implementation chronology for v2               | Actual mounted registration is CURRENT_STATIC_FACT; configured availability and external publication/registration are CURRENT_OPERATIONAL_FACT. `planned` does not control registration.                                   |
| F15 Timestamp                | RELEASE_TIME_FACT / HISTORICAL declaration                                                                | Not current build time, observation time, or immutable snapshot freeze time. It survived later hash updates and v2 copying, so cannot date the entire current document.                                                    |

Counts: **15 families**; 9 release-time families (F07–F15), 5 current-static
families (F01/F02/F03/F05/F06), 1 mixed family (F04); **0 stored
current-operational families and 0 stored transaction-time families**.
Operational/transactional counterparts above are separate facts outside this
registry, not additional registry paths. No `production_ready`, contract-release
version, qualification evidence, service-ID list, or MCP wire-version literal
exists as a registry field.

## 4. Immutability and compatibility enforcement

### What is immutable, and what can change only through release process

**REGISTRY_WHOLE_DOCUMENT_IMMUTABLE=PARTIAL** refers specifically to the eight
working registry documents, not their release snapshots.

1. **All paths in `contracts/releases/{1.0.0,1.0.1,2.0.0}/metadata/*.json` are
   immutable after acceptance**, including descriptions, timestamps, and
   protocol statuses. New accepted releases use new directories; no old release
   rewrite follows from VCM authority.
2. **All 36 normalized paths of the four active `.v2` working registry files are
   semantically pinned** to release 2.0.0 by `compatCheck`. A byte change first
   triggers recursive comparison; harmless formatting/object-key order can
   compare equal. Therefore this is semantic equality of the working copy, not
   an assertion of byte immutability of every working JSON file.
3. **v1 working files are not compared by the active metadata loop**, because
   the 2.0.0 manifest contains only v2 metadata. `baseline:verify` checks frozen
   1.0.0, not working v1. This is a coverage gap, not authority to mutate v1
   silently.
4. **Permanent identity freeze**: `service_id`, `service_version`
   interpretation, per E01/E04; launch price and maximum-price semantics are
   release-preserved (F07), and the remaining release declarations must not be
   rewritten to imply current state. Controlled schema evolution is
   independently evidenced by ea4cbb4 updating every v1 `output_schema_hash`
   without changing old snapshots.

Exact path sets (generation-qualified to avoid falsely granting an in-place
allowance):

- **IMMUTABLE_PATHS**: every path in the inventory for every accepted snapshot;
  every path in the inventory for active `.v2` semantic comparison until a new
  accepted release; for persistent identity within a major, `service_id`,
  `service_version`. Frozen historical facts at
  `base_price{,.amount,.currency}`, `maximum_price{,.amount,.currency}`,
  `protocols{,.x402,.mcp,.a2a,.nevermined,.agentverse,.coinbase_bazaar,.mcp_registry}`,
  `production_enabled`, `promotion_state`, `updated_at`, `execution_mode`,
  `maximum_input_bytes`, `expected_latency_class`,
  `authorization_classification` must retain their historical meaning even
  outside the active comparison.
- **MUTABLE_PATHS (freely rewritable in existing documents)**: **none**. Policy
  permits evaluated new-release changes, not silent current-state refreshes.
  Potential classified authored updates concern `title`, `description`,
  `capabilities`, `capabilities[]`, `declared_limitations`,
  `declared_limitations[]`, `pricing_schemes`, `pricing_schemes[]`,
  `pcc_version`, and controlled schema-reference updates. This list is not an
  approval, nor a proof that every such change is patch-compatible.
- **DERIVED_PATHS**: `input_schema_uri`, `input_schema_hash`,
  `output_schema_uri`, `output_schema_hash` from schema identity/bytes and
  release selection. Only `output_schema_hash` has a demonstrated post-freeze
  working-v1 change here; URI mutability is not inferred from that fact. Active
  v2 still pins all four.
- **UNKNOWN_PATHS**: none for classification/ownership. No unsupported positive
  mutability claim is made. Details of a _future_ particular change require
  classification at that time.

These sets describe different layers (permanent identity, active-release
comparison, derived provenance); they overlap intentionally. They are not a
schema-level whitelist implemented by CI. “PARTIAL” does not mean that a simple
global field-only mutable/immutable partition exists.

### Tool behavior versus policy

E01 allows nonsemantic annotation/documentation patches, requires
machine-selection changes to be classified, forbids enabled protocols without
implementation evidence, and requires honest protocol status. E02 does **not**
implement a nuanced registry annotation whitelist: arbitrary changed scalars
default to `property_type_changed`/major; `compatCheck` returns pass only when
`changes.length === 0`. Even a title scalar change is rejected against the
active baseline. A stated policy allowance is not a passing implementation gate.

`releaseVerify` checks active/frozen descriptor version consistency and
canonical PCC/input/output/common-schema hashes; it does not independently
certify current protocol registration or operational production truth.
`baseline:verify` targets only original 1.0.0. This investigation additionally
verified every SHA256SUMS entry for all three releases (28 each) independently.

`check-registry-pricing-drift.mts` is not a general registry-authority checker.
It reconstructs an override only for company v2 and uses older non-v2 keys for
three other v2 files. Its broad success message is not proof of full current
runtime pricing-projection parity. The actual E06 runtime map overrides all four
v2 entries; VCM's current price resolver is separate. No checker was edited or
mutation-tested, because transient forbidden-file edits would exceed this
checkpoint.

### Git chronology

| Commit                | Checkpoint / consequence                                                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `94ad83c6`            | SUN-0101: all four v1 documents introduced, all seven statuses planned, false production, original timestamp.                                |
| `6be370e9`            | SUN-0102: release 1.0.0 baseline, governance, ADRs and comparator; output hashes corrected before freeze.                                    |
| `7157e0b`             | Bazaar discovery implementation, composed from accepted sources.                                                                             |
| `894f7f5`             | MCP remote protocol foundation.                                                                                                              |
| `fba962b`             | A2A signed protocol foundation.                                                                                                              |
| `04280b9`             | Nevermined alternative-rail foundation.                                                                                                      |
| `ea4cbb4d`            | SUN-1000 1M: v2 introduced, copied protocol values and timestamps, all v1 output hashes updated to widened schemas; 1.x snapshots untouched. |
| `c93f6b7` / `f0e413d` | Nevermined v2 sandbox registration evidence / provider route wiring, separate from registry status flags.                                    |
| `36e6cae` / `c81b737` | Later governed v2 pricing decisions, runtime projections preserve frozen JSON.                                                               |
| `cc46c3a` / `e65acbc` | VCM economic authority correction and evidence closure; no exposure repair.                                                                  |

Current v2 JSON equals frozen 2.0.0 metadata structurally, 4/4. Current v1
differs from frozen 1.0.1 metadata **only in `output_schema_hash`**, 4/4. This
direct comparison is decisive against whole-working-document permanent byte
immutability.

## 5. Consumer matrix

Codes are exactly these classifications: **S** =
CURRENT_SEMANTIC_AUTHORITY_CONSUMER; **R** = RELEASE_COMPATIBILITY_CONSUMER;
**O** = OVERRIDDEN_AT_RUNTIME; **T** = DERIVED/TRANSFORMED; **I** = IGNORED. A
multi-code cell covers named different uses; it is not a claim that every field
in the family is read by every consumer. The following field-specific notes
resolve those distinctions.

| Family                       | A2A E08                | MCP E09                            | x402/Bazaar E10                                         | Nevermined E11                          | Catalog/seed E12                   | OpenAPI E12/E13                       | Contracts E01–05 | VCM E07/E15                               |
| ---------------------------- | ---------------------- | ---------------------------------- | ------------------------------------------------------- | --------------------------------------- | ---------------------------------- | ------------------------------------- | ---------------- | ----------------------------------------- |
| F01 identity                 | S/T                    | I/T separate tool map              | S/T                                                     | S/T                                     | S/T via seed                       | I/T schema/route IDs                  | R                | T                                         |
| F02 presentation             | S/T                    | I, separate titles/descriptions    | S/T                                                     | S/T                                     | S/T seed→D1                        | I                                     | R                | T                                         |
| F03 capabilities/limitations | S/T                    | I, own descriptions                | S/T capabilities; I limitations                         | S limitations; I capabilities           | I                                  | I                                     | R                | T                                         |
| F04 schemas                  | S URIs; I hashes       | I/T frozen bundles and own URI map | I/T frozen bundles                                      | S URI/hash                              | S/T URIs via seed; I hashes        | I/T canonical schema generation       | R                | T                                         |
| F05 PCC                      | I                      | I/T own release bindings           | S/T, conflated as contract_release in local declaration | S                                       | I, own literal                     | I/T descriptor/literals               | R                | T                                         |
| F06 schemes                  | I/T payment policy     | I/T own schema/policy              | I/T payment policy                                      | I/T own plan policy                     | I                                  | I/T contract schemas                  | R                | T                                         |
| F07 price                    | I amounts              | I/T governed resolver              | O v2 import; T governed quote                           | I/T governed resolver                   | O v2; S v1 max via projected entry | I/T runtime pricing producers         | R                | R preserved; T current price separately   |
| F08 execution                | I                      | I                                  | I                                                       | I                                       | I                                  | I/T schema contract                   | R                | T                                         |
| F09 input bound              | I                      | I                                  | I                                                       | I                                       | I, separate bounds literal         | I/T schema constraints                | R                | T                                         |
| F10 latency                  | I                      | I                                  | I                                                       | I                                       | I                                  | I                                     | R                | T                                         |
| F11 authorization            | I                      | I                                  | I                                                       | I                                       | I                                  | I/T auth contracts                    | R                | T                                         |
| F12 promotion                | I                      | I                                  | I, capability table instead                             | I                                       | I                                  | I                                     | R                | T uppercase lifecycle                     |
| F13 production               | O injected             | O options/boundary                 | O separate disclosure/status                            | O explicit false                        | O seed/DB/effective resolver       | O runtime overlays; R frozen document | R                | R preserved; operational overlay separate |
| F14 protocols                | I registration instead | I registration instead             | I registration instead                                  | I declarations/registration IDs instead | I own protocol_status              | I own producer                        | R                | R preserved; T into false exposure        |
| F15 timestamp                | I                      | I                                  | I nowIso input                                          | I                                       | I generated_at                     | I generated_at                        | R                | R preserved                               |

`I/T` means the **registry field is ignored** and corresponding output is
transformed from another identified authority. It is not a hidden registry read.
`O` for production means the served equivalent is supplied independently;
producers generally do not read the raw registry flag at all.

Additional complete-consumer details:

- E06 structurally retains all raw keys via imports/spreads, but its
  `RegistryServiceEntry` type omits `protocols` and `updated_at`. Retention is
  MIRROR, not semantic consumption. V2 money objects are replaced by
  `withGovernedRegistryPrice`; v1 objects are not.
- A2A reads service ID/version, title/description/capabilities to build skills;
  reads schema URIs and limitations in its x402 extension. Production comes from
  `effectiveProductionStatusByServiceId`, with aggregate `some`, and mTLS from
  an injected operational flag. No registry protocol enum drives card emission
  or executor dispatch.
- MCP uses `MCP_SERVICE_TOOLS`, `SERVICE_TOOL_TITLES`, authored routing
  descriptions, bundled input/output schemas and `MCP_SERVICE_SCHEMA_METADATA`.
  It registers only four primary v2 tools, plus quote and health. Quote/health
  support is not identical to primary execution exposure. It resolves price via
  governed keys. No registry title/protocol/status import controls registration.
- Bazaar's local builder reads service_version, pcc_version, title, description
  and capabilities; it does not read declared_limitations despite the broader
  source-module/ADR composition description; uses schemas/examples from frozen
  bundles and route/method from accepted OpenAPI. Its pricing_schemes array does
  not select policy: `BAZAAR_PAYMENT_POLICY` does. The local builder uses
  `contract_release: registryEntry.pcc_version`—a separate version-domain
  conflation, not a reason to change PCC wire version.
- Nevermined reads title, description, schema URIs/hashes, pcc_version and
  limitations; chooses payment policy and registered IDs separately. Its
  external `registry-reconciliation.ts` handles provider agent/plan records, not
  these JSON files. Recorded registration IDs do not prove current production
  enablement.
- `seedServices` copies ID, version, title, description, schema URIs, and
  projected maximum_price into D1; existing rows are insert-only here. Catalog
  then reads D1, overrides price from E06 and known-service production from the
  effective resolver. A current-registry edit would not necessarily update
  already-seeded presentation. Test seed consumers include worker-runtime
  entrypoint and MCP four-service acceptance tests; they do not establish a new
  authority.
- Frozen OpenAPI generation reads canonical schema files, an explicit v2
  service-ID map and contract descriptor. The `/openapi.json` producer in
  catalog.ts is a separate hand-authored control-plane document. They must not
  be conflated into one parity target. Frozen schema model generators consume
  the metadata **schema**, not current registry statuses.
- Contracts read all baseline-mapped fields recursively (including money
  children, arrays, and timestamp); metadata-schema validation constrains
  permitted structure/vocabulary. Tests/fixtures include
  `packages/contracts/src/compat/compat.property.test.ts`,
  `tests/compatibility`, protocol A2A fixtures, MCP transport tests and schema
  fixtures, Bazaar discovery/roundtrip/catalog-status tests, Nevermined
  declaration tests, catalog tests, and VCM importer/projector/registry-parity
  tests. VCM parity compares all fields; it proves preservation, not
  registration truth.
- Pricing's service resolver does not consult frozen price JSON; E14 checker
  reads both money families only. Other same-named authorization/promotion
  fields found in provider manifests, provenance records and D1 rows are
  independent objects, not consumers of these registry paths.

## 6. Protocol-field semantics, independently resolved

The metadata schema's allowed vocabulary is
**planned/scaffolded/tested/enabled/not_enabled**. VCM's transitional type
instead lists **planned/live/deprecated** and its importer tests `=== 'live'`.
No existing file exercises that mismatch, but changing a registry status to the
schema-valid `enabled` would still yield false exposure. Therefore “change
planned to live” is neither a proven legal registry edit nor a sound importer
repair.

| Field                       | Classification                                                                          | Why, independent evidence                                                                                                                                  | Current exposure authority                                                                                                                                                               |
| --------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `protocols.a2a`             | **C: retained release-compatibility metadata; A additionally for original v1 snapshot** | Introduced 94ad83c; unchanged through ea4cbb4. A2A implemented at fba962b before v2 copy. Active v2 comparator pins planned; card and executor ignore it.  | Mounted `/a2a` and card route, eight-skill/dispatch registration E08.                                                                                                                    |
| `protocols.mcp`             | **C; A for original v1**                                                                | 894f7f5 precedes v2; E09 registers four primary v2 tools, independent of all eight planned flags.                                                          | Actual `registerTool` factory and tool→service map, auxiliary quote/health registration, transport mounting.                                                                             |
| `protocols.x402`            | **C; A for original v1**                                                                | Implementation and payment/discovery composition precede v2; route policies, not flags, select execution/payment semantics.                                | Mounted paid-service routes and version/rail composition E12, actual payment policy and supported-scheme implementation.                                                                 |
| `protocols.coinbase_bazaar` | **C; A for original v1**                                                                | 7157e0b discovery predates v2. E10 emits metadata without reading flag; `CURRENT_BAZAAR_CATALOG_STATUS='not_submitted'` is a separate package declaration. | Local discovery builder and official extension composition; no mounted caller of that builder was found in current apps source. External cataloging requires separate observed evidence. |
| `protocols.nevermined`      | **C; A for original v1**                                                                | 04280b9 precedes v2; later c93f6b7 records sandbox registrations, f0e413d mounts provider routes; retained flags do not track these.                       | E11 declarations/registered-ID records, real rail route composition and runtime qualification.                                                                                           |

**PROTOCOL_EXPOSURE_FIELDS_ARE=FROZEN_RELEASE_METADATA** means their current
compatibility role is frozen evidence; it does not assert v2 planned was a
historically complete implementation inventory. No evidence proves a separately
authored intention that “planned” meant production-live absence across all
protocols, or an approval to reinterpret it that way. Classification C resolves
the actionable authority question without inventing that intent. A blanket B
(“stale mutable current source”) or D (“current declaration overridden”) is
unsupported by active compatibility law.

`protocols.agentverse` and `protocols.mcp_registry` are also retained
compatibility declarations. The latter is distinct from MCP transport support
and the mounted MCP registry-auth endpoint; neither an auth endpoint nor a
retained flag proves external listing. VCM preserves these two without canonical
surface counterparts.

## 7. Current exposure architecture and revised registry target

Current exposure has **distributed code authority**, not one existing unified
authority module. The actual mounted routes, protocol registration factories,
tool/skill maps, and per-rail policy constitute the static truth.
Environment/qualification/external publication supply operational truth
separately. VCM is a downstream consumer; it cannot authorize exposure by
itself.

| Architecture                                           | Fit to actual repository and desired properties                                                                                                                                                                                                                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A: authored registry remains current exposure owner    | Reject. Active compatibility pinning, schema/importer enum mismatch, and ignored flags mean a flag edit neither legally nor structurally changes registration.                                                                                                                                         |
| B: VCM authors exposure, CI compares registration      | Better than current drift, but duplicate authorship and manual adapter coverage can still diverge. Accept only as an intermediate representation whose values are derived, not hand-entered.                                                                                                           |
| **C: derive from actual registration; VCM normalizes** | **Recommended static-authority architecture.** Existing registration maps/factories are inspectable sources. Capture their actual outputs deterministically using credential-free construction; assert complete coverage against mounted routes. Do not regex-guess exposed booleans from source text. |
| D: frozen evidence plus separate current view          | Required preservation/output arrangement alongside C; by itself it does not establish how current exposure is obtained.                                                                                                                                                                                |
| E: another authority                                   | No stronger existing unified source found. A new manually curated manifest would duplicate the real maps unless it actually drives registration in a separately approved later change.                                                                                                                 |

The future extraction must be commit-bound and fail closed on missing surfaces,
duplicate IDs, unrecognized registrations, or different
tool→service/route→service mappings. It must distinguish primary execution,
quote-only and health operations, public discovery and paid admission, external
publication and local declaration. CI should observe registrations through the
same constructors, compare exact coverage and semantics, and include negative
controls showing removal/addition/remap of a real registration fails. A fixture
copied from VCM would be circular evidence. The result is reproducible given
source commit, dependency lock, schema artifacts and explicit configuration
fixtures. No production environment is needed for static exposure proof.

**REVISED_REGISTRY_AUTHORITY_TARGET=TARGET_D**: split release evidence from
current metadata conceptually and, for generated outputs, physically. Preserve
existing accepted release directories permanently. Keep working
`registry/services` as compatibility-bound input until an explicit release
process changes its role. Generate a separately named current VCM view later.
**TARGET_C** is a compatible future release-production process after
parity/approval, but it cannot rewrite old releases. **TARGET_B** alone
inaccurately calls every working v1 byte immutable; TARGET_A/E fail to qualify
the old blanket projection target.

## 8. Transitional names

**LEGACY_PROTOCOL_EXPOSURE_FIELD_RENAME_RECOMMENDED=YES**: recommend
`releaseProtocolExposureDeclared` (and matching
`ReleaseProtocolExposureDeclared` type). “Declared” matters: v2 copied values
cannot be represented as a proved absence of implementation at release time.
`frozenReleaseProtocolExposure` without “Declared” risks that implication.

**FROZEN_PRICE_FIELD_RENAME_RECOMMENDED=YES**: recommend
`releaseBasePriceDeclared` and `releaseMaximumPriceDeclared`. Their authority is
release evidence, not age; neither supplies current list price, current
governance cap, or a transaction authorization. `legacyMaximumPriceDeclared`'s
universal “variable-cost ceiling” comment should eventually be narrowed: the
registry maximum has family-specific historical semantics, not a universal proof
of the actual quote ceiling.

Also record, without making changes: `legacyProductionEnabledDeclared` is better
understood as `releaseProductionEnabledDeclared`; `legacyUpdatedAt` as
`releaseMetadataUpdatedAtDeclared`. F12 needs a separate release promotion
declaration versus evidenced current promotion. No names/types/importer code are
changed here.

## 9. Shadow-projection readiness

READY means the current VCM input can truthfully generate the **complete named
current surface** from canonical facts plus explicitly owned
projection/operational inputs. It does not mean that selected strings could be
copied today. Structural and economic core PASS remains closed; readiness adds a
different semantic requirement.

| Surface | Status                                | Precise blockers                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A2A     | **BLOCKED_BY_TEMPORAL_SEMANTICS**     | Static protocolExposure false for all eight despite mounted skills; runtime overlay cannot widen it. Need code-derived eight-skill/endpoint bindings, protocol version/extension declarations, and fixture-driven production/mTLS overlay. Registry data alone cannot authorize configured security claims.                                                                                                                                          |
| MCP     | **BLOCKED_BY_TEMPORAL_SEMANTICS**     | False exposure and one generic evaluate interaction cannot represent four primary v2 tools plus quote and health; v1 capability must not become a v1 primary tool. Need actual tool names/map, routing prose, schemas/annotations, and supported transport-version binding.                                                                                                                                                                          |
| OpenAPI | **BLOCKED_BY_MISSING_CANONICAL_FACT** | No registry exposure analog; importer sets false. Need endpoint-scoped document identities (control-plane versus frozen service release versus effective runtime view), operation/path/status/error/security contracts and non-service operations. VCM URI/hash pairs are not full schema bodies.                                                                                                                                                    |
| x402    | **BLOCKED_BY_MISSING_CANONICAL_FACT** | Need actual route/rail/network/asset/scheme/tier binding, required extensions and code-derived exposure; one primary listPrice is insufficient for document tier prices and max-job authorization cap. Quote identities/expiry/input hashes are transaction facts outside the static model.                                                                                                                                                          |
| Bazaar  | **BLOCKED_BY_MISSING_CANONICAL_FACT** | Same exposure/payment-route gaps plus frozen schema/examples, official extension construction, time/expiry inputs, catalog/publication evidence and capability exclusions. The local declaration builder has no mounted application caller in the inspected current source, so declaration existence must not become public route exposure. Local builder also conflates PCC wire version with contract release; no silent correction is authorized. |
| catalog | **BLOCKED_BY_MISSING_CANONICAL_FACT** | Need explicitly selected D1 row set/snapshot, seeded presentation/schema refs, current overlay fixture and catalog contract-release semantics. VCM alone cannot reproduce historical D1 contents or know deployment gates; mixed identity set and stale catalog literals must be reported, not silently normalized away.                                                                                                                             |

No whole surface is READY. “Blocked by missing fact” does not mean its registry
ownership remains unresolved; the missing fact source is identified above.
Reading an existing producer and returning its output is useful as a reference
oracle, but is not an independent VCM compiler or parity proof.

## 10. Future parity standard (conditional, no adapters implemented)

For every surface retain raw existing/shadow artifacts and a normalized semantic
diff, with source commit, schema/VCM versions, dependency lock, fixture
identity, and expected difference ledger. Byte parity is appropriate for
preserved release snapshots and deterministic checked-in artifacts, not every
dynamic response. Structural parity is necessary but insufficient wherever equal
shapes can carry different meanings. A known defect remains a failing semantic
difference unless a separately governed correction identifies exact fields and
expected values.

| Surface | PARITY_LEVEL                                                | VOLATILE_FIELDS                                                        | NORMALIZATION                                                                                                                    | ALLOWED_DIFFERENCES                                                                                    | BLOCKING_DIFFERENCES                                                                                                                              |
| ------- | ----------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| A2A     | SEMANTIC_PARITY + STRUCTURAL_PARITY                         | signature material; injected operational state                         | Match source/config fixture; compare unsigned payload; key skills by exact ID; canonical object order                            | Object ordering; signing bytes excluded only with separate signing/payload-binding checks              | Missing/extra skills, ID/version remap, extension policy/resource, schemas, security requirements, production flags, capability claims            |
| MCP     | SEMANTIC_PARITY + STRUCTURAL_PARITY                         | session/request IDs, transport envelope metadata                       | Same negotiated transport era; key by tool name and service ID; canonical JSON Schema with refs resolved from same frozen inputs | Object order and generated request IDs; meaningful tool descriptions remain compared                   | v1/v2 remap, missing auxiliary tools, schema/annotation/payment-carrier drift, routing guidance, error behavior, unsupported version claim        |
| OpenAPI | SEMANTIC_PARITY; BYTE_PARITY for unchanged frozen artifacts | runtime host/generated_at where emitted                                | Compare like endpoint/document/release; key path+method+operationId; resolve schema refs without dropping constraints            | Order/format in unhashed generated current view; host from explicit fixture                            | Service-ID membership, response/error contract, required fields, schema hashes, production/preproduction claim, auth and payment requirements     |
| x402    | SEMANTIC_PARITY + deterministic transaction-vector equality | quote time/expiry/IDs, input-bound hashes, payee/network configuration | Fixed clock/input/config; exact atomic amounts and networks; canonical accepts tuples; recompute bound digests                   | Object ordering; time differences only when replayed with equal fixture clock and revalidated bindings | Price/tier/cap errors, scheme/asset/rail/path, expiry semantics, payment/receipt binding, admission or settlement claims                          |
| Bazaar  | SEMANTIC_PARITY + official extension structural validation  | same quote/config/time fields; observed catalog status                 | Same examples/schema bundles, time and config; compare official extension independently from SITEBORNE bookkeeping               | Object order; declared fixture-driven volatile values                                                  | Cataloged/live claims without evidence, schema/example or method mismatch, excluded modes, wrong contract release, amount/network/expiry mismatch |
| catalog | SEMANTIC_PARITY + STRUCTURAL_PARITY                         | generated_at; D1/config-derived state                                  | Inject same repository rows and overlay fixtures; key by exact service ID; preserve domain-specific version labels               | Row ordering and generated_at only                                                                     | Missing generations, stale governed price, wrong production gate, silent D1 presentation rewrite, misleading contract release                     |

**INTENTIONAL_DIFFERENCE** requires a field-specific decision record.
Frozen/current price differences are expected only across correctly labeled time
domains; two _current-price_ outputs disagreeing is never excused by frozen
history. Do not ignore a whole `status`, `version`, `security`, or `pricing`
subtree as volatile. No automatically allowed correction to public metadata is
granted by this report.

## 11. Frozen truth versus actual drift

| OBSERVED_DIFFERENCE                        | FROZEN_RELEASE_TRUTH                                       | CURRENT_TRUTH (repository scope)                                                                                    | ACTUAL_DRIFT?                                                                                                          | REQUIRES_CORRECTION?                                                       | CORRECTION_LOCATION                                             |
| ------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------- |
| v2 base/maximum price versus governance    | Launch/reference amounts retained in release 2.0.0         | E06 and pricing resolver project later v2 governed values                                                           | No, across time domains; yes if release price is labeled current                                                       | Economic importer already corrected; preserve that separation              | Future projections; never frozen JSON                           |
| A2A planned versus implemented             | v1 preimplementation; v2 retained declaration              | Mounted endpoint/card and 8 skills                                                                                  | Not a mutable-registry defect; VCM current-exposure mapping is semantically wrong                                      | Yes, current model exposure input                                          | Code-derived current exposure → VCM                             |
| MCP planned versus implemented             | Same compatibility declaration                             | 4 primary v2 tools + quote/health                                                                                   | Same; additionally eight-service exposure inference would be wrong                                                     | Yes                                                                        | Registration-derived interactions/exposure                      |
| x402 planned versus implemented            | Retained compatibility declaration                         | Paid route builders/compositions and payment policies                                                               | Same; not proof of production activation                                                                               | Yes                                                                        | Current static route/policy import + separate runtime overlay   |
| contract release version                   | v1 1.0.0, v2 2.0.0; PCC wire remains 1.0.0                 | Active descriptor 2.0.0; catalog/schema route uses 1.0.0 literal; local Bazaar builder uses PCC as contract_release | Version-domain conflation in current producers; not evidence PCC is stale                                              | Yes, after scoped public correction design; shadow must flag it            | Catalog/version projections and Bazaar binding, not pcc_version |
| production_ready / production_enabled      | Snapshot false; production_ready absent in registry        | E12 resolver derives known-service production state from gates; live state not queried                              | Historical false versus operational value is expected; unscoped present-tense false can mislead                        | Preserve overlays; audit static/frozen labels separately                   | Runtime discovery overlay/labels, never release snapshot        |
| service-ID arrays                          | Frozen release 1.x lists v1; 2.0.0 lists v2                | A2A/Bazaar 8; MCP primary 4 v2; generated service OpenAPI v2; control-plane service-metadata enum lists only v1     | Different intentional surface scopes are not generic drift; control-plane enum underrepresents v2-capable catalog seed | Yes for that current control-plane schema, separately governed             | Endpoint-scoped operation/service mapping; preserve all old IDs |
| MCP version literals                       | Protocol-specific baseline independent of service contract | 2026-07-28 constant and type; 2025-11-25 legacy transport handling is intentional                                   | Dual-era support is not drift; duplicate current literals are drift risk, not proved mismatch                          | No value change proved; derive/check version declarations                  | MCP SDK/transport/constants and future projection verification  |
| v1 output hash versus 1.x snapshot         | Original narrower schema digest                            | Working hash updated by accepted 1M widened schema release                                                          | Intentional controlled working-schema evolution                                                                        | Preserve source/release pairing; no historical rewrite                     | Contract provenance import/view                                 |
| updated_at unchanged after v2/hash updates | Declared original metadata time                            | Same string remains despite later commits                                                                           | Not trustworthy current document timestamp                                                                             | Label as declared provenance; do not invent current time                   | VCM provenance naming/view                                      |
| promotion_state executable_candidate       | Original release declaration                               | Qualification represented elsewhere; no current qualification query                                                 | No current promotion value inferred here                                                                               | Prevent release declaration from being used as evidenced current promotion | Operational qualification source and VCM mapping                |

## 12. Next mutation path and stop

Choose **exactly PATH_B: leave frozen registry untouched and add current
exposure authority to VCM**. “Add authority” means normalize the actual
code-owned registration facts; VCM does not become an independent source allowed
to disagree with registration.

Proposed next checkpoint: **METADATA-VCM-IMPL-03A — Code-Derived Current
Exposure and Temporal Authority Inputs**. It would require its own authorization
and bounded implementation scope. Its acceptance should establish:

1. Deterministic extraction of actual per-surface/per-operation/per-generation
   registrations and matching mount coverage, with negative drift controls.
2. Release protocol declarations preserved independently; no `planned`/`live`
   shortcut, no schema-enum mutation, no new production claims.
3. Correct current exposure shapes for primary and auxiliary interactions;
   explicit source/commit provenance; separate runtime narrowing.
4. Explicit registry schema/current-versus-release provenance, promotion
   semantics, and inventory of other required producer inputs (including
   document tier/cap economics).
5. Repeat truth-core/round-trip/economic checks without changing old evidence or
   switching consumers; reassess each surface's readiness.

**METADATA-VCM-IMPL-03 — Cross-Projection Shadow Compiler + Semantic Parity is
not safe to begin now.** No surface has a complete current semantic input
contract today. A future exposure prerequisite may unblock some surfaces before
others; do not force all six into READY merely because exposure booleans become
correct. PATH_D is not selected. No adapters, generation, public corrections, or
authority inversion start here.

## 13. Verification and acceptance

Using the verification-before-completion discipline, this report separates
investigation PASS from implementation or deployment acceptance. Fresh read-only
checks:

- `pnpm contracts:baseline:verify` — PASS.
- `pnpm contracts:compat:check` — PASS.
- `pnpm contracts:release:verify` — PASS.
- Independent SHA-256 verification of all 28 manifest entries for each of 1.0.0,
  1.0.1, 2.0.0 — 84/84 match.
- Recursive inventory — 8 files, 36 normalized paths, 15 exhaustive families;
  array-index coverage recorded above.
- Snapshot comparison — v2 4/4 structurally identical; v1 4/4 only
  output_schema_hash differs from 1.0.1.
- No production state verified or claimed; no full runtime test suite
  represented as run. No transient mutation probes were performed.

Acceptance meanings: “protocol semantics resolved” means release compatibility
role versus current registration authority is established, not that every
original author's unrecorded intention is known. “all fields classified”
includes MIXED for schema provenance and explicitly bounded release
declarations; it does not mean those fields are validated as current runtime
facts.

```
ALL_REGISTRY_FIELDS_CLASSIFIED=YES
CONTRACT_IMMUTABILITY_BOUNDARY_IDENTIFIED=YES
PROTOCOL_EXPOSURE_SEMANTICS_RESOLVED=YES
CURRENT_EXPOSURE_AUTHORITY_IDENTIFIED=YES
REGISTRY_ROLE_REEVALUATED=YES
TEMPORAL_MODEL_APPLIED=YES
CURRENT_CONSUMERS_MAPPED=YES
SHADOW_READINESS_EVALUATED=YES
NEXT_PATH_SELECTED=YES
```

## 14. Required return

```
METADATA_VCM_05=PASS
VCM_TRUTH_CORE_STATUS=CLOSED
REGISTRY_FILES_ANALYZED=8
REGISTRY_FIELD_PATHS_ANALYZED=36 (normalized; concrete expansion in section 2)
REGISTRY_FIELD_FAMILIES=15
REGISTRY_WHOLE_DOCUMENT_IMMUTABLE=PARTIAL
IMMUTABLE_REGISTRY_PATHS=ALL_ACTIVE_V2_SEMANTIC_PATHS; ALL_ACCEPTED_SNAPSHOT_PATHS; PERMANENT_IDENTITY_AND_RELEASE_FACT_SEMANTICS (section 4)
MUTABLE_REGISTRY_PATHS=NONE_WITHOUT_CLASSIFIED_RELEASE_PROCESS (derived schema paths separately listed in section 4)
RELEASE_TIME_FIELD_FAMILIES=9 (F07-F15)
CURRENT_STATIC_FIELD_FAMILIES=5 (F01,F02,F03,F05,F06)
CURRENT_OPERATIONAL_FIELD_FAMILIES=0
TRANSACTION_TIME_FIELD_FAMILIES=0
MIXED_FIELD_FAMILIES=1 (F04)
PROTOCOL_EXPOSURE_FIELDS_ARE=FROZEN_RELEASE_METADATA
A2A_PROTOCOL_FIELD_CLASSIFICATION=C; ORIGINAL_V1_ALSO_A
MCP_PROTOCOL_FIELD_CLASSIFICATION=C; ORIGINAL_V1_ALSO_A
X402_PROTOCOL_FIELD_CLASSIFICATION=C; ORIGINAL_V1_ALSO_A
BAZAAR_PROTOCOL_FIELD_CLASSIFICATION=C; ORIGINAL_V1_ALSO_A
NEVERMINED_PROTOCOL_FIELD_CLASSIFICATION=C; ORIGINAL_V1_ALSO_A
CURRENT_PROTOCOL_EXPOSURE_AUTHORITY=ACTUAL_MOUNTED_CODE_REGISTRATIONS_AND_PER_OPERATION_SERVICE_BINDINGS; OPERATIONAL_STATE_SEPARATE
PRIOR_REGISTRY_AUTHORITY_TARGET=GENERATED_PROJECTION_OF_VCM
REVISED_REGISTRY_AUTHORITY_TARGET=TARGET_D (release evidence plus separate current view; future new-release generation compatible with TARGET_C)
LEGACY_PROTOCOL_EXPOSURE_FIELD_RENAME_RECOMMENDED=YES
RECOMMENDED_PROTOCOL_FIELD_NAME=releaseProtocolExposureDeclared
FROZEN_PRICE_FIELD_RENAME_RECOMMENDED=YES
RECOMMENDED_PRICE_FIELD_NAMES=releaseBasePriceDeclared,releaseMaximumPriceDeclared
SHADOW_A2A_PROJECTION=BLOCKED_BY_TEMPORAL_SEMANTICS
SHADOW_MCP_PROJECTION=BLOCKED_BY_TEMPORAL_SEMANTICS
SHADOW_OPENAPI_PROJECTION=BLOCKED_BY_MISSING_CANONICAL_FACT
SHADOW_X402_PROJECTION=BLOCKED_BY_MISSING_CANONICAL_FACT
SHADOW_BAZAAR_PROJECTION=BLOCKED_BY_MISSING_CANONICAL_FACT
SHADOW_CATALOG_PROJECTION=BLOCKED_BY_MISSING_CANONICAL_FACT
SAFE_TO_BEGIN_SHADOW_PROJECTION_PARITY=NO
RECOMMENDED_NEXT_PATH=PATH_B
NEXT_IMPLEMENTATION_CHECKPOINT=METADATA-VCM-IMPL-03A — Code-Derived Current Exposure and Temporal Authority Inputs (proposed, not started)
REGISTRY_MUTATIONS=0
VCM_MUTATIONS=0
PROTOCOL_MUTATIONS=0
GOVERNANCE_MUTATIONS=0
CONTRACT_MUTATIONS=0
RUNTIME_MUTATIONS=0
PRODUCTION_MUTATIONS=0
REPORT=docs/reports/METADATA-VCM-05-registry-field-authority-reconciliation.md
```

The only authorized deliverable is this report. A report-only evidence commit
follows the existing metadata-report convention. Stop; no shadow compiler
implementation is authorized by this result.
