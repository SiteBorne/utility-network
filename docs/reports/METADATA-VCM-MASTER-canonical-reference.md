# SITEBORNE Verified Canonical Metadata — Master Reference

Status: **consolidated design reference**. This document combines the three
METADATA-* design checkpoints into one file so that ongoing VCM implementation
work has a single place to look, instead of three. It introduces no new
decisions, no new fields, and no new claims beyond what the three source
checkpoints already established — it is a merge, not a revision.

The three source checkpoints remain in place, unmodified, as the immutable
EVIDENCE-class record of how each decision was reached (consistent with this
same document's own Part I §1 rule that EVIDENCE-class artifacts are
write-once and never edited after creation):

- [`METADATA-AUTHORITY-01-canonical-authority-map.md`](./METADATA-AUTHORITY-01-canonical-authority-map.md) — reproduced below as **Part I**
- [`METADATA-VCM-02-schema-design.md`](./METADATA-VCM-02-schema-design.md) — reproduced below as **Part II**
- [`METADATA-VCM-03-machine-discovery-optimization.md`](./METADATA-VCM-03-machine-discovery-optimization.md) — reproduced below as **Part III**

Cross-references inside each part (e.g. a bare `§7`, or `Authority Map §7`)
are left exactly as originally written and still resolve correctly: a bare
`§N` inside Part I refers to Part I §N; a bare `§N` inside Part II refers to
Part II §N; a bare `§N` inside Part III refers to Part III §N; an explicit
`Authority Map §N` mention (appearing in Parts II and III) refers to Part I §N.

Cumulative status as of this merge: **zero runtime, metadata-generator,
registry, governance, pricing, contract, CI, or production mutations have
been made by any of the three checkpoints or by this merge.** `packages/vcm`
has not been created. See [Master Synthesis & Status](#master-synthesis--status)
at the end of this document for the combined return block and the current
actionable next step.

## Table of contents

**Part I — Canonical Authority Map and Projection Law**
[1](#i-1-authority-class-taxonomy) Authority Class Taxonomy ·
[2](#i-2-fact-authority-matrix) Fact Authority Matrix ·
[3](#i-3-capability--exposure--activation--admission--qualification-state-model) Capability/Exposure/Activation/Admission/Qualification Model ·
[4](#i-4-version-namespace-map) Version Namespace Map ·
[5](#i-5-static-model--runtime-overlay-law) Static-Model/Runtime-Overlay Law ·
[6](#i-6-registryservicesjson--canonical-role-decision) Registry Canonical-Role Decision ·
[7](#i-7-pricing-authority-decision) Pricing Authority Decision ·
[8](#i-8-identity--service-id-authority-decision) Identity/Service-ID Authority Decision ·
[9](#i-9-project_stateyaml--tasksyaml-disposition) PROJECT_STATE.yaml/TASKS.yaml Disposition ·
[10](#i-10-projection-law-per-protocol) Projection Law Per Protocol ·
[11](#i-11-contradiction-taxonomy) Contradiction Taxonomy ·
[12](#i-12-release--evidence-authority) Release/Evidence Authority ·
[13](#i-13-security-metadata-truth-law) Security Metadata Truth Law ·
[14](#i-14-migration-sequence) Migration Sequence ·
[15](#i-15-explicit-invariants) Explicit Invariants ·
[P](#i-p-return-block) Return Block

**Part II — Verified Canonical Metadata Model Schema Design**
[1](#ii-1-three-layer-model) Three-Layer Model ·
[2](#ii-2-version-namespaces--closed-unambiguous) Version Namespaces ·
[3](#ii-3-unknown--null--unsupported-states) Unknown/Null/Unsupported States ·
[4](#ii-4-capability--exposure--activation--admission--qualification--formalized) Capability Model, Formalized ·
[5](#ii-5-core-identity-types) Core Identity Types ·
[6](#ii-6-service-identity-family-generation-interactions) Service Identity/Family/Generation/Interactions ·
[7](#ii-7-schemacontract-references-digests-economics) Schema/Contract References, Digests, Economics ·
[8](#ii-8-critical-economic-semantics--four-distinct-concepts-never-merged) Economic Semantics ·
[9](#ii-9-critical-security-semantics--four-truth-levels-structurally-enforced) Security Semantics ·
[10](#ii-10-runtime-state-overlay) Runtime State Overlay ·
[11](#ii-11-effective-metadata-view) Effective Metadata View ·
[12](#ii-12-extension-boundary) Extension Boundary ·
[13](#ii-13-compatibility-provenance-evidence-release) Compatibility, Provenance, Evidence, Release ·
[14](#ii-14-deterministic-identity--canonicalization-and-digest-model) Digest Model ·
[15](#ii-15-registry-transition-model) Registry Transition Model ·
[16](#ii-16-projection-readiness) Projection Readiness ·
[17](#ii-17-runtime-truth-proof--worked-instance) Runtime Truth Proof ·
[18](#ii-18-minimality-classification) Minimality Classification ·
[19](#ii-19-decision-gates) Decision Gates ·
[P](#ii-p-return-block) Return Block

**Part III — Machine-Mediated Discovery, Routing, and Conversion Optimization**
[0](#iii-0-scope-discipline) Scope Discipline ·
[1](#iii-1-mcp--verified-findings) MCP Findings ·
[2](#iii-2-a2a--verified-findings) A2A Findings ·
[3](#iii-3-x402--bazaar--partial-findings) x402/Bazaar Findings ·
[4](#iii-4-openapi--llm-tool-routers--search-indexing--autonomous-purchasing-agents--reasoned-inference-only) OpenAPI/Router Findings ·
[5](#iii-5-explicit-anti-patterns--kept-out-on-purpose) Anti-Patterns Rejected ·
[6](#iii-6-measuring-machine-outcomes--proposed-evidence-class-overlay-not-new-claims) Machine Outcome Telemetry ·
[7](#iii-7-prioritized-truthful-action-list) Prioritized Action List ·
[8](#iii-8-return) Return

[Master Synthesis & Status](#master-synthesis--status)

---
---

# PART I — Canonical Authority Map and Projection Law

*Source: `METADATA-AUTHORITY-01-canonical-authority-map.md`. Reproduced verbatim below; only the top status line and section anchors were adjusted for this merge.*

Status: design/evidence checkpoint. No runtime source, metadata generator, registry file,
governance YAML, contract, schema, CI config, or production configuration was modified to
produce this document. All claims below are cited to file paths; open questions are marked
`OPEN` rather than assumed.

---

## I.1. Authority Class Taxonomy

| Class | Definition | Mutability | Allowed writers | Allowed readers | Runtime may override? | Generated projections may redefine? | CI must hash/pin? | May appear in public metadata? |
|---|---|---|---|---|---|---|---|---|
| **NORMATIVE** | Governed, human-approved source of a fact. One per fact family. | Change only via governed process (PR + ADR/governance-file review) | Repo maintainers via reviewed PR | Everyone (build, runtime, CI, humans) | No | No | Yes | Yes |
| **OPERATIONAL** | Live, deployed-environment state. Not checked into any static file as truth; observed at request time or read from environment bindings/secrets. | Changes per-deploy, per-request | Deployment process (wrangler secrets/vars), request context | Runtime code, CI-against-live smoke checks | N/A (it *is* the runtime) | No — may only narrow what NORMATIVE declares | Not hashable (it's live); its *shape/schema* is pinned, not its value | Yes, as an overlay layer, never as a replacement for the static claim |
| **DERIVED** | Computed deterministically from one or more NORMATIVE/OPERATIONAL facts by a build-time or request-time function. Never independently authored. | Regenerated, never hand-edited | The compiler/generator only | Everyone | No | No (derivation logic itself is normative) | Yes (digest the derivation output) | Yes |
| **MIRROR** | A literal copy of a NORMATIVE fact kept in a second location for a technical reason (e.g. filesystem-less runtime). Must be structurally guaranteed identical to its source, not independently editable in practice. | Regenerated or CI-diffed against source | Build tooling only (never hand-authored divergently) | Runtime that cannot reach the primary source | No | No | Yes — CI must fail if mirror != source | Yes, but must cite its source |
| **EVIDENCE** | Immutable record of what was actually released, deployed, or qualified. Append-only. | Write-once per release; never edited after creation | Release/qualification tooling | Everyone | No | No | Yes (this class *is* the hash/digest layer) | Yes |
| **HISTORICAL** | A past snapshot kept for audit/traceability. Explicitly non-authoritative for current state. | Frozen at time of archival | Whoever archives it | Everyone, with an explicit "historical" label | No | No | No | Only with an explicit "as of" timestamp, never as current truth |
| **DEPRECATED** | Was NORMATIVE or OPERATIONAL, formally retired, kept only for reference/back-compat. | Frozen; must carry a superseding pointer | Governed retirement process | Everyone | No | No | No (already covered by EVIDENCE at time of freeze if applicable) | Only labeled `deprecated`, never as current |

Note: `PROJECT_STATE.yaml` and `TASKS.yaml` today behave as if they were NORMATIVE
(they read as declarative present-tense claims) but are actually unmaintained —
see §I.9. This mismatch between *apparent* class and *actual* class is the single
largest source of the drift found in the discovery report.

---

## I.2. Fact Authority Matrix

Columns: `FACT | AUTHORITY_CLASS | CURRENT_OWNER | CURRENT_DUPLICATES | PROPOSED_CANONICAL_OWNER | RUNTIME_OVERLAY_ALLOWED | PUBLIC_PROJECTIONS | DRIFT_GATE | MIGRATION_RISK`

| FACT | CLASS | CURRENT_OWNER | CURRENT_DUPLICATES | PROPOSED_CANONICAL_OWNER | OVERLAY? | PROJECTIONS | DRIFT_GATE | RISK |
|---|---|---|---|---|---|---|---|---|
| service_id | NORMATIVE | `registry/services/*.json` (`service_id` field) | `protocol-a2a/src/constants.ts:SITEBORNE_SERVICE_IDS`, `protocol-x402/src/bazaar/registry-source.ts:ALL_BAZAAR_SERVICE_IDS` (hand-written) | `registry/services/*.json` | No | A2A, MCP, OpenAPI, x402, Bazaar, catalog | IDENTITY_DRIFT (error) | Low — both arrays currently agree; risk is silent future divergence |
| service_family | NORMATIVE | `registry/services/*.json` filename stem | none observed | same | No | all | IDENTITY_DRIFT | Low |
| service_generation (.v1/.v2) | NORMATIVE | `registry/services/*.json:service_version` | contract-release directory names implicitly encode it | same | No | all | VERSION_DRIFT | Low — see §I.4 permanence rule |
| title | NORMATIVE | `registry/services/*.json:title` | none found (MCP/A2A pull from registry at build time per discovery) | same | No | all | IDENTITY_DRIFT | Low |
| description (canonical) | NORMATIVE | `registry/services/*.json:description` | `server.ts:SERVICE_INPUT_DESCRIPTION_OVERRIDES` is a **deliberate per-protocol rewrite**, not a duplicate — see §I.10 | same, with MCP override treated as a governed projection transform | No (base fact); Yes (routing-language transform, bounded — §I.10) | all | IDENTITY_DRIFT if base text diverges from registry unintentionally | Medium — need a rule distinguishing "intentional protocol-specific phrasing" from "accidental duplication" (see §I.10) |
| routing description (MCP contrastive use-when/do-not-use-when text) | DERIVED (from description + capability + lifecycle) | hand-authored per-tool in `server.ts` | none | keep hand-authored today; mark as future DERIVED target once VCM exists | No | MCP only | CAPABILITY_DRIFT if routing text claims a capability the registry doesn't declare | Low |
| lifecycle state | NORMATIVE | `registry/services/*.json:promotion_state` | `governance/PROMOTION_STATES.yaml` defines the *ladder*, not the per-service value | same | No | catalog, A2A extensions | ACTIVATION_DRIFT | Low |
| input_schema / output_schema | NORMATIVE | `registry/services/*.json:{input,output}_schema_uri` + `_hash`; actual schema bodies in `schemas/services/` | `packages/contracts` Zod types are a **separate, independently-authored schema layer** used by the OpenAPI generator (discovery finding: generator reads `schemas/services/`, not Zod) | `schemas/services/*.schema.json` as the single schema-body source; registry hash pins it; Zod types must be generated from or CI-diffed against it, not hand-maintained in parallel | No | A2A, MCP, OpenAPI, x402 | SCHEMA_DRIFT (error, build-blocking) | **High** — two independently hand-written schema representations (JSON Schema vs Zod) is the riskiest duplication in the system today |
| input_uri / output_uri | NORMATIVE | `registry/services/*.json` | discovery noted per-service/version hand-duplication in a `frozen-contracts.ts`-style file | registry | No | OpenAPI, catalog | SCHEMA_DRIFT | Low |
| protocol exposure: A2A | NORMATIVE (declares intent) + OPERATIONAL (actual wiring) | `registry/services/*.json:protocols.a2a` currently `"planned"` for **all** services, while `protocol-a2a` code demonstrably implements them | code (skill registration in the A2A package) is ground truth today; registry field is stale | registry field, kept in CI-sync with code's actual tool/skill registration list | Yes — runtime may report a route as un-deployed even if code exposes it | A2A card | EXPOSURE_DRIFT (currently **active**, not hypothetical — see §I.3 worked example) | **High** — this field is already wrong today |
| protocol exposure: MCP | same pattern | `registry/services/*.json:protocols.mcp = "planned"` vs. 6 live tools in `packages/protocol-mcp/src/server.ts` | same | same | Yes | MCP tool list | EXPOSURE_DRIFT | **High** — already wrong today |
| protocol exposure: OpenAPI | NORMATIVE | `registry/services/*.json:protocols` has no OpenAPI key; generator (`packages/pcc-schema/scripts/generate-openapi.ts`) independently decides what to emit | add an explicit `openapi` key to the protocols block | Yes | OpenAPI doc | EXPOSURE_DRIFT | Medium |
| protocol exposure: x402 | NORMATIVE + OPERATIONAL | `registry/services/*.json:protocols.x402 = "planned"` vs. live `buildQuote()`/402 flow in `apps/edge-api/.../x402-service.ts` | same as A2A/MCP | same | Yes | x402 discovery, Bazaar | EXPOSURE_DRIFT | **High** |
| protocol exposure: Bazaar | NORMATIVE | `registry/services/*.json:protocols.coinbase_bazaar` | `protocol-x402/src/bazaar/discovery.ts` fixtures use sentinel values (`'0xUSDC'`, `PAYTO_NOT_CONFIGURED`) when real data is absent — this is a *placeholder-handling* mechanism, not a duplicate authority | registry | Yes | Bazaar | EXPOSURE_DRIFT | Medium |
| protocol exposure: Nevermined | NORMATIVE | `registry/services/*.json:protocols.nevermined = "planned"` | `NEVERMINED_ROUTES_ENABLED` env gate exists in `env.ts` with no corresponding implemented route found | registry (capability) + env gate (activation) | Yes | Nevermined | EXPOSURE_DRIFT / STALE_STATE_VIEW | Low (appears genuinely not implemented, so "planned" is accurate here — contrast with MCP/A2A/x402 above) |
| capability availability per protocol surface | see §I.3 model | scattered (see rows above) | — | VCM capability/exposure/activation triple (§I.3) | Yes | all | CAPABILITY_DRIFT, EXPOSURE_DRIFT, ACTIVATION_DRIFT (three distinct gates, not one) | High until §I.3 model is adopted |
| pricing (list/max) | NORMATIVE | `governance/RISK_LIMITS.yaml:financial_limits.max_price_usd_per_service` | `packages/pricing/src/service-prices.ts:EMBEDDED_PRICING` (MIRROR, correct pattern), `PROJECT_STATE.yaml` pricing block (**stale duplicate**, wrong pattern — missing 6 `_v2` entries), `registry/services/*.json:{base_price,maximum_price}` (a **third** independently-authored copy) | `governance/RISK_LIMITS.yaml` | Yes (runtime effective price ≤ governed max) | all | PRICE_DRIFT (error, build-blocking) | **High** — confirmed live drift today (PROJECT_STATE.yaml), plus a third copy in registry not yet cross-checked against RISK_LIMITS.yaml |
| pricing_policy_version | NORMATIVE — **does not currently exist as a field anywhere** | none | none | new field, owned by `governance/RISK_LIMITS.yaml` | No | all pricing-bearing projections | PRICE_DRIFT | New field — low risk to introduce, but must be added before any pricing projection ships from VCM |
| price ceiling | NORMATIVE | `governance/RISK_LIMITS.yaml` | see pricing row | same | Yes (runtime may charge ≤ ceiling, never >) | all | PRICE_DRIFT | shared with pricing row |
| settlement currency / asset / network | NORMATIVE (declared support) + OPERATIONAL (actual deployed asset) | `packages/protocol-x402/src/network/schemes.ts` (scheme×network support matrix, NORMATIVE); `apps/edge-api/.../production-payment.ts:resolvePaymentAsset(network)` → `@x402/evm.getDefaultAsset()` (OPERATIONAL, derived from live network, not hardcoded) | one literal exception: `DOCUMENT_MAINNET_USDC` constant, verified by discovery to match the derived value | schemes.ts for support matrix; live resolver for actual value | Yes | x402 discovery | ECONOMIC_DRIFT if literal and derived values disagree | Low today (verified matching), but the literal constant is a latent risk if the derivation path ever changes without updating it |
| payment scheme (exact/upto) | NORMATIVE | `packages/protocol-x402/src/network/schemes.ts` | none | same | No | x402, Bazaar | CAPABILITY_DRIFT | Low |
| payTo | OPERATIONAL | `apps/edge-api/.../production-payment.ts:124-150`, sourced from `env.SELLER_WALLET_ADDRESS` | Bazaar fixture sentinel `PAYTO_NOT_CONFIGURED` (explicitly a placeholder, not a false duplicate) | env binding is sole owner | N/A — this *is* runtime state | x402, Bazaar | ECONOMIC_DRIFT if projection shows a payTo that isn't the live one | Low — sentinel pattern already correctly refuses to fabricate |
| production_enabled (global) | OPERATIONAL, but currently authored as if NORMATIVE | `PROJECT_STATE.yaml:production_ready` (stale, static `false`) | `registry/services/*.json:production_enabled` (also static, per-service) vs. 6+ independent env booleans in `env.ts` | env-gate state is the only truth; both YAML/JSON fields must become either DERIVED-from-env-at-report-time or explicitly HISTORICAL | N/A | none directly — only via a live status projection (already exists: MCP `siteborne_get_service_health`) | ACTIVATION_DRIFT | **High** — this is the clearest case of a class mismatch (static file pretending to be live truth) |
| paid_routes_enabled | OPERATIONAL | `env.ts:PAID_ROUTES_ENABLED` | none (single source) | same | N/A | status endpoints only | ACTIVATION_DRIFT | Low — already correctly modeled as env-only |
| per-route enablement | OPERATIONAL | `env.ts:{SERVICE}_V2_CDP_ROUTE_ENABLED` (compound AND with `PAID_ROUTES_ENABLED`) | none | same | N/A | status endpoints | ACTIVATION_DRIFT | Low |
| PCC wire version (`pcc_version`) | NORMATIVE | `packages/pcc-schema/src/index.ts:PCC_VERSION = '1.0.0'` | `registry/services/*.json:pcc_version` (mirrors correctly at `1.0.0`) | pcc-schema package | No | PCC receipts | VERSION_DRIFT | Low |
| PCC schema-release version (`pcc_dependency.schema_release`) | EVIDENCE (per contract release) | `contracts/releases/2.0.0/CONTRACT_RELEASE.yaml:pcc_dependency.schema_release = '1.1.0'` | none — this is a **distinct namespace**, not a duplicate of `pcc_version` (see §I.4) | contract-release file | No | release manifests | RELEASE_DIGEST_DRIFT | Low — namespace already correctly separated, just undocumented until now |
| contract-release version | EVIDENCE | `contracts/releases/{1.0.0,1.0.1,2.0.0}/CONTRACT_RELEASE.yaml` | `PROJECT_STATE.yaml:service_contract_release.version` claims `1.0.0` — **stale**, actual normative release is `2.0.0` | `contracts/releases/*/CONTRACT_RELEASE.yaml`, "latest" = highest non-historical entry | No | all | RELEASE_DIGEST_DRIFT / STALE_STATE_VIEW | **High** — confirmed live drift |
| signing capability (code exists) | NORMATIVE | `packages/protocol-a2a/src/signing.ts:createConfiguredA2aSigningIdentity` | none | same | No | none directly | — | Low |
| signing activation (key provisioned) | OPERATIONAL | Cloudflare Worker secret `AGENT_CARD_SIGNING_PRIVATE_KEY`, declared in `wrangler.toml` as a secret binding, value not in repo | `PROJECT_STATE.yaml` implicitly claims this is *not* done (understates it) — see §I.13 truth-level model | live secret store | N/A | A2A card, only if §I.13 evidence bar is met | **Unverifiable from repo** — flagged `OPEN` |
| key id | NORMATIVE (name) + OPERATIONAL (which one is active) | `wrangler.toml:AGENT_CARD_SIGNING_KEY_ID` (plaintext var, names the *expected* active key) vs. `signing.ts:LOCAL_A2A_SIGNING_KEY_ID` (hardcoded ephemeral fallback id, always available) | not a duplicate — two different identities for two different truth levels (configured vs. ephemeral) | keep separate; never merge | N/A | A2A card `kid` | ACTIVATION_DRIFT if card claims the configured kid while actually signing with the ephemeral one | Medium — this is exactly the failure mode §I.13 exists to prevent |
| JWKS URI | NORMATIVE | `packages/protocol-a2a/src/signing.ts:SITEBORNE_A2A_JWKS_URL` | none | same | No | A2A card | SECURITY_CLAIM_DRIFT | Low |
| security scheme / mTLS declaration | NORMATIVE (declared) + OPERATIONAL (live) | `apps/edge-api/.../mtls-production-capability.ts` (capability), env gates (activation) — `OPEN`: exact file/field not yet fully enumerated in this pass | same split as signing | same | N/A | any surface asserting mTLS | SECURITY_CLAIM_DRIFT | Needs a follow-up pass before VCM implements the security section — flagged `OPEN`, not blocking this checkpoint |
| public origin | NORMATIVE | `wrangler.toml` / edge-api route config | none observed | same | Yes (staging vs prod origin differs operationally) | all | — | Low |
| MCP protocol version | NORMATIVE | literal `'2026-07-28'` in `packages/protocol-mcp/src/server.ts` (discovery noted it appears in multiple places as a literal, not all deriving from one constant) | itself, repeated | promote to a single exported constant | No | MCP | VERSION_DRIFT | Low effort, currently a latent risk |
| x402 protocol version | NORMATIVE | `@x402/core` package's exported `x402Version` constant (`= 2`), pinned via `x402-spec-baseline.json` at `2.21.0` | none | `@x402/core` (external dependency, pinned) | No | x402, Bazaar | VERSION_DRIFT | Low |
| release hash / schema digest / projection digest | EVIDENCE | `contracts/releases/*/CONTRACT_RELEASE.yaml` hashes schema bodies; **no digest currently exists for generated projections themselves** (OpenAPI doc, Agent Card, MCP tool list) | none | new: VCM must generate and record projection digests | No | release manifest | RELEASE_DIGEST_DRIFT | New capability — this is the biggest genuine gap, not a duplication |
| deployment identifier | OPERATIONAL | Cloudflare Worker version id (platform-assigned, not in repo) | git commit SHA is a *different* identifier (source, not deployment) | live platform metadata | N/A | release attestation only | RELEASE_DIGEST_DRIFT if conflated with source commit | Low if kept separate (see §I.12) |
| qualification status | EVIDENCE | `governance/PROMOTION_STATES.yaml` (ladder definition) + per-service `promotion_state` in registry (current rung) | none | registry field, ladder in governance file | No | catalog | ACTIVATION_DRIFT | Low |

**Summary counts** (feeding §I.P):
- Facts with **multiple current authorities actively disagreeing today**: 5 — protocol exposure ×4 (A2A, MCP, x402, and implicitly Bazaar via the same `protocols` block), pricing (3-way), contract-release version, production_enabled/production_ready, and PCC-schema-vs-release version pairing *once misread as one namespace* (it's actually not drift, see §I.4, so it is **not** counted). Recount precisely: **protocol exposure (1 fact family, 4 surfaces), pricing (1), contract-release version (1), production_ready/production_enabled (1)** = **4 fact families** with confirmed live contradiction, expanding to **7 individual matrix rows** if each protocol surface is counted separately.
- Facts with **no clear current authority**: 3 — `pricing_policy_version` (doesn't exist yet), `openapi` key in the protocols block (doesn't exist yet), projection/digest hashing for generated surfaces (doesn't exist yet).

---

## I.3. Capability / Exposure / Activation / Admission / Qualification State Model

Five distinct booleans-per-service-per-surface are required. Collapsing them into one
`available` field is exactly the mistake the discovery report's OpenAPI/MCP finding
almost made.

```
CAPABILITY_EXISTS          — the underlying function/logic is implemented in code,
                              regardless of any protocol wrapper.
PROTOCOL_EXPOSED           — a specific protocol surface (A2A/MCP/OpenAPI/x402/...)
                              has wired that capability to a callable endpoint/tool.
RUNTIME_ENABLED             — the deployed environment's config (env vars, secrets)
                              currently allows that endpoint to execute for real traffic.
ECONOMIC_ADMISSION_ENABLED — payment/quote/settlement path for that capability is live
                              (distinct from RUNTIME_ENABLED: a free/read-only capability
                              can be RUNTIME_ENABLED with no economic dimension at all).
QUALIFIED_FOR_PRODUCTION   — the service has cleared the governance promotion ladder
                              rung required for `controls_money`/`controls_marketplace_metadata`
                              (per `governance/PROMOTION_STATES.yaml`).
```

### Worked example: `get_quote`

Investigated per the checkpoint's explicit instruction, using:
- `packages/protocol-mcp/src/server.ts:484` — MCP tool handler calls `buildQuote(...)`
- `apps/edge-api/src/control-plane/routes/x402-service.ts:518` — the real paid-service
  REST route also calls `buildQuote(...)` inline, as part of minting the 402 payment
  requirement, **not** as a standalone `/quotes/{service_id}` endpoint
- `packages/pcc-schema/scripts/generate-openapi.ts:458-490` — the OpenAPI generator
  emits a **standalone** `POST /quotes/{service_id}` path, annotated
  `x-implementation-status: 'not_implemented'` and summary text
  "Not currently implemented - preproduction contract only."

Analysis:

```
CAPABILITY_EXISTS   = YES   (buildQuote() — one function, called from two call sites)
PROTOCOL_EXPOSED (MCP)      = YES, as a standalone siteborne_get_quote tool
PROTOCOL_EXPOSED (REST/OpenAPI, standalone POST /quotes/{service_id}) = NO
PROTOCOL_EXPOSED (REST, inline within the paid-service 402 flow)      = YES
```

`SAME_CAPABILITY_DIFFERENT_SURFACE = YES`
`ACTUAL_CONTRADICTION = NO`

This is an **EXPOSURE_DRIFT**, not a capability or identity contradiction: MCP chose to
expose quoting as its own callable tool; the REST surface chose to fold quoting into the
payment-required response of the real service route rather than also offering a
standalone quote endpoint. The OpenAPI generator's `not_implemented` annotation is
**accurate** for the specific path it describes — it is not lying, it is describing a
narrower thing than "quoting capability" (it describes "standalone REST quote endpoint").
The discovery report's flag was correct to surface for investigation but the conclusion
is: no fix is required here; the VCM should simply model `PROTOCOL_EXPOSED` per
surface *and per exposure shape*, so a future reader doesn't have to re-derive this
by hand again.

### Worked example: production route enablement

```
CAPABILITY_EXISTS          = YES  (route handler implemented)
PROTOCOL_EXPOSED            = YES  (registered on the router)
RUNTIME_ENABLED             = NO   (PAID_ROUTES_ENABLED or a per-service *_ROUTE_ENABLED gate is unset)
ECONOMIC_ADMISSION_ENABLED  = NO   (follows RUNTIME_ENABLED for paid routes)
QUALIFIED_FOR_PRODUCTION    = per governance ladder, independent of the above
```

Public projection for a disabled route must read:

```json
{ "implemented": true, "exposed": true, "runtime_enabled": false }
```

never simply `"available": false` (which would incorrectly imply `CAPABILITY_EXISTS = false`)
and never `"available": true` (which would incorrectly imply live callability).

---

## I.4. Version Namespace Map

No field may be named bare `version`. Nine distinct namespaces exist today:

| Namespace | Field name | Current value(s) | Owner | Changes when |
|---|---|---|---|---|
| service version | `service_version` (part of `service_id` suffix `.v1`/`.v2`) | `v1`, `v2` | `registry/services/*.json` | A new, permanently-coexisting service generation is introduced (§9 of the original directive: `.v1`/`.v2` are **permanent parallel identities**, per `docs/contracts/VERSIONING.md` — confirmed by discovery, not re-litigated here) |
| contract release version | `service_contract_release.version` / `CONTRACT_RELEASE.yaml` directory name | `1.0.0`, `1.0.1`, `2.0.0` (2.0.0 is current normative) | `contracts/releases/*/CONTRACT_RELEASE.yaml` | A governed, reviewed contract-release cut happens |
| PCC wire version | `pcc_version` | `'1.0.0'` (unchanged since inception) | `packages/pcc-schema/src/index.ts:PCC_VERSION` | The **document-content compatibility shape** of a PCC receipt changes (has never happened) |
| PCC schema-release version | `pcc_dependency.schema_release` | `'1.1.0'` (in `contracts/releases/2.0.0`) | per-contract-release `CONTRACT_RELEASE.yaml` | The **JSON Schema package/tooling** that validates PCC receipts is revised, even if wire content compatibility (`pcc_version`) doesn't change |
| MCP protocol version | literal string in `server.ts` | `'2026-07-28'` | should become one exported constant (currently a repeated literal — low-risk cleanup, not in scope for this checkpoint) | MCP spec date advances |
| x402 protocol version | `x402Version` | `2` (via `@x402/core@2.21.0`, pinned in `x402-spec-baseline.json`) | external dependency | Upstream x402 spec major version changes |
| Agent Card / A2A protocol semantics | not a single field — governed by the A2A package's spec-compliance target | `OPEN` — not enumerated in this pass; the A2A discovery agent did not report a single version field | `packages/protocol-a2a` | A2A spec revision |
| metadata model / VCM schema version | does not exist yet | — | future `packages/vcm` | Every time the VCM's own schema shape changes |
| metadata projection version / digest | does not exist yet (§I.2 gap) | — | future VCM release tooling | Every regeneration of a public projection |
| deployment version | Cloudflare Worker version id | platform-assigned, not in repo | live platform | Every deploy |

### `PCC_VERSION` vs `pcc_dependency.schema_release` — resolved

Confirmed **intentionally distinct dimensions**, not drift:

- `packages/pcc-schema/src/index.ts:4` — `export const PCC_VERSION = '1.0.0' as const;` — this is
  the **wire/content-compatibility** version baked into every PCC receipt
  (`pcc_version: z.literal('1.0.0')` at `index.ts:884`).
- `contracts/releases/2.0.0/CONTRACT_RELEASE.yaml:42` — explicit comment: *"version pcc_version
  remains 1.0.0, unchanged"* — the release author already documented the distinction.
- `contracts/releases/2.0.0/CONTRACT_RELEASE.yaml:44-45` — `pcc_dependency.schema_release: '1.1.0'`
  — this is the **schema package/tooling release** that a given contract release depends on;
  it can advance (structural/tooling refinements to the JSON Schema file, doc generation,
  validation tooling) without the wire content shape (`pcc_version`) changing.

`PCC_VERSION_DOMAINS_RESOLVED = YES`. VCM must carry both fields under unambiguous names
(`pcc_wire_version` and `pcc_schema_release`) and never conflate them.

---

## I.5. Static-Model / Runtime-Overlay Law

```
CANONICAL STATIC MODEL  (NORMATIVE + DERIVED + MIRROR + EVIDENCE)
        +
RUNTIME STATE OVERLAY   (OPERATIONAL)
        =
EFFECTIVE PUBLIC METADATA
```

**Static, proven from code/config, never runtime-sourced:**
- service identity, title, description (`registry/services/*.json`)
- schemas and their hashes (`schemas/services/`, `registry/services/*.json:*_hash`)
- protocol capability existence (what a package *implements* — e.g. the fixed 6-tool
  MCP surface in `server.ts`, the fixed scheme×network matrix in `schemes.ts`)
- price policy (`governance/RISK_LIMITS.yaml`)
- compatibility declarations (`governance/CONTRACT_COMPATIBILITY.yaml`)
- security *capability* (code existing, e.g. `createConfiguredA2aSigningIdentity`)

**Runtime, proven from `env.ts` / live bindings / secrets, never static-file-sourced:**
- `PAID_ROUTES_ENABLED` and the per-service `*_ROUTE_ENABLED` gates (`env.ts:113-168`)
- active production signer (whether `AGENT_CARD_SIGNING_PRIVATE_KEY` is actually bound —
  `OPEN`, unverifiable from repo, see §I.13)
- active `payTo` (`production-payment.ts:124-150`, sourced from `env.SELLER_WALLET_ADDRESS`)
- active network/asset (`production-payment.ts` → `resolvePaymentAsset(network)` →
  `@x402/evm.getDefaultAsset()`)
- active deployment id (Cloudflare platform-assigned)

**Precedence rule (mandatory, per directive §E):**

```
runtime overlay may NARROW capability   (disable something that exists)
runtime overlay must NEVER INVENT capability   (claim something that doesn't exist in the static model)
```

Enforced structurally: the overlay's schema for a given field must be a strict subset/refinement
of the static model's declared possibility space (e.g. overlay can turn `runtime_enabled: true`
into `false`, never introduce a `protocol_exposed: true` for a surface the static model didn't
declare `capability_exists` for).

---

## I.6. `registry/services/*.json` — Canonical Role Decision

Three architectures evaluated as instructed, without forcing the expected conclusion:

**A. Registry remains canonical; VCM wraps/imports it.**
- Blast radius: near zero initially.
- Reproducibility: good — registry files are already versioned JSON.
- Problem: registry is demonstrably **already wrong** for protocol exposure today
  (`protocols.{a2a,mcp,x402}` all read `"planned"` while code shows all three implemented
  and live — §I.2 row "protocol exposure"). Wrapping a source that's already drifted from
  code doesn't fix the drift; it just gives the drift a new consumer.

**B. VCM becomes canonical; registry becomes a generated projection.**
- Blast radius: high immediately — every current consumer of `registry/services/*.json`
  (A2A, MCP, x402, catalog, per discovery) would need to switch to reading generated output.
- Backwards compatibility: risky without a byte-identity proof step first.
- Correct end state, because a compiler that derives protocol-exposure facts from actual
  code registration (MCP's live tool list, A2A's live skill list, x402's live route table)
  is the only way to stop the exposure fields from drifting the way they already have.

**C. Transitional: VCM initially imports registry byte-identically, then authority inverts
after a parity proof.**
- Blast radius: low at each step — first VCM only *reads* what registry already says
  (including its known-stale `protocols` block, reproduced faithfully, not silently
  "fixed"), and a parity test proves VCM's generated registry-shaped output is
  byte-identical to the current file before anything downstream is repointed.
- Only *after* parity is proven does VCM's *compiled* protocol-exposure facts (sourced
  from actual code registration, not the hand-authored JSON) become canonical, and the
  registry file becomes a generated projection of that.
- This naturally forces the exposure-field fix to happen as a **separately reviewed,
  visible diff** (registry's `protocols` block flipping from `"planned"` to `"live"` for
  the affected services) rather than silently, which matches the "no fixing drift during
  this checkpoint" instruction and gives reviewers a single clear moment to approve the
  correction.
- Rollback: trivial at every stage before the final authority inversion (VCM is additive
  until then).

**Decision: C → B.** The user's expected conclusion is confirmed by evidence, primarily
because registry's protocol-exposure fields are proven stale *today*, which makes "A"
unsafe (it would make VCM parrot known-wrong data indefinitely) and makes a direct "B"
unsafe (no parity proof, high blast radius, no reviewed moment to approve the correction
it would silently perform).

`REGISTRY_ROLE_CURRENT = canonical-but-partially-stale`
`REGISTRY_ROLE_TARGET = generated projection of VCM, post-parity-proof`

---

## I.7. Pricing Authority Decision

Distinct concepts, previously conflated:

```
LIST_PRICE            — the published/advertised price for a service (registry base_price)
MAX_PRICE              — the governed ceiling a runtime is permitted to ever charge
                          (governance/RISK_LIMITS.yaml:financial_limits.max_price_usd_per_service)
GOVERNED_PRICE         — MAX_PRICE, scoped and versioned under pricing_policy_version
RUNTIME_EFFECTIVE_PRICE — what the live pricing resolver actually returns right now
                          (packages/pricing/src/service-prices.ts:resolveServiceMaxPriceUsd())
QUOTED_PRICE           — the amount bound into one specific quote
                          (packages/protocol-x402/src/quote/quote.ts — deterministic hash of
                          pricing_key, pricing_source_version, scheme, network, asset, amount, payee)
```

These are **not the same concept** and must not share one field name. `LIST_PRICE` and
`MAX_PRICE` can legitimately differ (a list price below the ceiling is normal); collapsing
them previously is part of why `registry/services/*.json:{base_price,maximum_price}` and
`governance/RISK_LIMITS.yaml` were never cross-checked against each other.

**Canonical owner: `governance/RISK_LIMITS.yaml`** for `MAX_PRICE`/`GOVERNED_PRICE`.
`packages/pricing/src/service-prices.ts` remains a legitimate **MIRROR** (filesystem-less
runtime need is real and documented via its `ENOENT`/`ENOTDIR` fallback) but must be
CI-diffed against `RISK_LIMITS.yaml`, not hand-maintained independently — this is exactly
the class of drift that let the six `_v2` prices exist in two places but not reach a third
(`PROJECT_STATE.yaml`, itself being retired per §I.9).

`registry/services/*.json:{base_price,maximum_price}` is `LIST_PRICE`, a separate,
legitimately-independent fact — but it must be validated `LIST_PRICE ≤ MAX_PRICE` at
build time, which does not currently happen anywhere observed.

New field required: `pricing_policy_version`, owned by `governance/RISK_LIMITS.yaml`,
carried by every projection that states a price (x402 discovery, Bazaar, catalog, OpenAPI
schema examples) so a consumer can tell which governed pricing generation a quoted number
came from.

`PRICING_CANONICAL_OWNER = governance/RISK_LIMITS.yaml`

---

## I.8. Identity / Service-ID Authority Decision

Current duplication:
```
protocol-a2a/src/constants.ts:SITEBORNE_SERVICE_IDS        (hand-written array, 8 ids)
protocol-x402/src/bazaar/registry-source.ts:ALL_BAZAAR_SERVICE_IDS  (hand-written array, 8 ids, currently identical)
registry/services/*.json:service_id                          (per-file, 8 files)
contracts/releases/*/CONTRACT_RELEASE.yaml service list       (per-release)
```

**Canonical owner: `registry/services/*.json` file set** — the set of files present *is*
the set of service ids (derived trivially as "all `service_id` values found"), which makes
it structurally impossible for the registry itself to internally disagree with itself.
`SITEBORNE_SERVICE_IDS` and `ALL_BAZAAR_SERVICE_IDS` become DERIVED (generated from the
registry file list at build time) rather than hand-written arrays; a CI equality check is
not even needed once they're generated from one source instead of two.

Per the directive: `.v1`/`.v2` remain **permanent parallel identities**. No deprecation
relationship is introduced by this checkpoint or implied by VCM's existence — VCM must
treat `company_evidence_graph.v1` and `company_evidence_graph.v2` as two fully independent
canonical service ids, exactly as `docs/contracts/VERSIONING.md` already governs.

`SERVICE_ID_CANONICAL_OWNER = registry/services/*.json (file-set-derived)`

---

## I.9. `PROJECT_STATE.yaml` / `TASKS.yaml` Disposition

Both are demonstrably stale (discovery report, confirmed again in this pass):
- `PROJECT_STATE.yaml`: dated 2026-08-16, claims `current_increment: SUN-1000`,
  `production_ready: false`, `service_contract_release.version: 1.0.0`, and a pricing
  block missing all six `_v2` entries — while git history and `docs/reports/` (303 files)
  show work through SUN-1222C (mainnet CDP, PCC production cutover, canary splits,
  SMTP hardening), the normative contract release is `2.0.0` (frozen 2026-08-17), and
  the PCC schema generation already targets `.v2` enums in live code.
- `TASKS.yaml`: dated 2026-08-11, version `1.0.0`, only three top-level `SUN-1xxx` entries
  (`SUN-1000`, `SUN-1100`, `SUN-1200`) — confirms a two-tier ledger where `TASKS.yaml` was
  meant to hold coarse parent tasks and `docs/reports/` became the de facto granular
  checkpoint log, but `TASKS.yaml` was never updated even at the coarse level past
  `SUN-1200`, and nothing marks it as intentionally frozen there.

**Disposition: `HISTORICAL_ONLY`** for both files, effective as of this checkpoint's
findings being acted on (not yet — this checkpoint changes no files). Rationale for
`HISTORICAL_ONLY` over the alternatives:
- Not `GENERATED_VIEW`: nothing in the repo today derives these files from git/reports
  automatically, and building that generator is separate, non-trivial work not yet scoped.
- Not `RETIRED`: the files still have narrative/context value for understanding *how*
  the project reached SUN-1200-era decisions; deleting them destroys that.
- Not `MANUAL_NON_NORMATIVE`: that disposition would let them keep being hand-edited
  going forward with an implicit "trust it a little" status, which is exactly the
  ambiguity the directive prohibits ("must not remain capable of contradicting runtime
  or contract authority while still appearing canonical").
- `HISTORICAL_ONLY` requires exactly one mechanical change (out of scope for this
  checkpoint): prepend a clear "as of 2026-08-16 / superseded by `docs/reports/` and
  `contracts/releases/`" banner, and stop treating any field inside them as a build or
  CI input anywhere it might currently be read (`OPEN`: no consumer of these two files
  was found by any of the five discovery agents, which is good — suggests the blast
  radius of freezing them is near zero, but this should be explicitly verified with a
  repo-wide reference search before the banner change is made).

Specific fields resolved:

| Field | Disposition |
|---|---|
| `production_ready` | Frozen historical value; live truth is the `env.ts` gate set, exposed today via MCP's `siteborne_get_service_health` |
| `service_contract_release.version` | Frozen historical value; live truth is the highest non-historical `contracts/releases/*/CONTRACT_RELEASE.yaml` (`2.0.0`) |
| PCC schema version (as stated in `PROJECT_STATE.yaml`) | Frozen historical value; live truth is `packages/pcc-schema/src/index.ts:PCC_VERSION` + the current contract release's `pcc_dependency.schema_release` |
| pricing block | Frozen historical value; live truth is `governance/RISK_LIMITS.yaml` (§I.7) |
| `current_increment` / `last_completed_increment` | Frozen historical value; live truth is git history + `docs/reports/` |

`PROJECT_STATE_DISPOSITION = HISTORICAL_ONLY`
`TASKS_DISPOSITION = HISTORICAL_ONLY`

---

## I.10. Projection Law Per Protocol

| Surface | Source facts | Transformations allowed | Transformations forbidden | Runtime overlay used | Digest generated | Validation required |
|---|---|---|---|---|---|---|
| **Agent Card / A2A** | identity, description, schemas, protocol-exposure(a2a), security(signing), pricing | field renaming to A2A's vocabulary (`skills`, `capabilities` shape); adding A2A-specific envelope (protocol version, JWKS pointer) | inventing a skill not backed by `CAPABILITY_EXISTS`; claiming `active` signing without §I.13 evidence | Yes — signing activation, key id | Yes (future) | Schema-valid A2A card + signature verifies against declared JWKS |
| **MCP** | identity, description (+ governed routing-language transform, see below), schemas, protocol-exposure(mcp), pricing | contrastive "Use when/Do not use when" routing text **is a bounded, governed transform**: it may rephrase but must not assert a capability, price, or lifecycle state absent from the base facts; annotation hints (`readOnlyHint`/`destructiveHint`/`idempotentHint`) are DERIVED from lifecycle+economic facts, not independently authored per tool | inventing a tool not backed by `CAPABILITY_EXISTS`; a routing description implying a capability the base description doesn't declare | Yes — `runtime_enabled` surfaces via `siteborne_get_service_health`, not by silently removing a tool | Yes (future) | Tool list matches registry-derived service set 1:1 |
| **OpenAPI** | identity, schemas, protocol-exposure(openapi/rest) | operationId derivation, HTTP envelope (status codes, error shapes) — must be generated from the actual route implementation (`x402-service.ts`) as discovery found, not guessed | describing a path as implemented when `PROTOCOL_EXPOSED(rest)=NO` for that exact shape (must use `x-implementation-status` honestly, as the existing `/quotes/{service_id}` annotation already correctly does) | Yes — could add a runtime status extension field | Yes (future) | Schema $refs resolve; generated doc validates against OpenAPI 3.x meta-schema |
| **x402 discovery / economic metadata** | pricing, settlement currency/asset/network, payment scheme, protocol-exposure(x402) | envelope required by x402 spec (scheme/network arrays) | fabricating a `payTo` or asset when `RUNTIME_ENABLED=false`/unconfigured (must use the sentinel pattern already in `discovery.ts`, not a plausible-looking fake value) | Yes — payTo, asset, network are all live-resolved | Yes (future) | Matches `packages/protocol-x402/src/network/schemes.ts` support matrix exactly |
| **Bazaar** | same as x402 discovery | Bazaar-specific listing envelope | same as x402 | Yes | Yes (future) | — |
| **Nevermined** | identity, protocol-exposure(nevermined) | minimal — surface appears genuinely `"planned"` (§I.2), not yet implemented | claiming any capability beyond what's implemented | N/A yet | N/A yet | — |
| **catalog** | identity, lifecycle state, pricing (list), protocol-exposure summary | human-readable formatting | any economic/security claim beyond what other surfaces assert | Yes — lifecycle/enablement | Yes (future) | Cross-checked 1:1 against registry file set |
| **PCC references** | `pcc_version`, `pcc_dependency.schema_release` | none — these are cited verbatim, never rephrased | conflating the two namespaces (§I.4) | No | Already covered by receipt signature | Receipt schema validation |

General rule (directive §J, confirmed): projections may rename fields, omit unsupported
fields, and add protocol-specific envelope data; they may **never** independently redefine
identity, pricing, schema, lifecycle, or economic/security semantics. The one case that
looks like an exception — MCP's routing-language rewrite — is deliberately scoped above
as a *bounded* transform (rephrasing allowed, new claims not) rather than an exemption
from the rule.

---

## I.11. Contradiction Taxonomy

| Class | Example found in this repo | Severity | Blocks build | Blocks CI | Blocks candidate creation | Blocks deployment | Blocks public-contract freeze |
|---|---|---|---|---|---|---|---|
| IDENTITY_DRIFT | (none currently active; latent risk from dual service-id arrays, §I.8) | ERROR | Yes | Yes | Yes | Yes | Yes |
| VERSION_DRIFT | MCP protocol-version literal repeated instead of one constant (§I.4) | WARNING | No | Yes | No | No | Yes |
| SCHEMA_DRIFT | JSON Schema (`schemas/services/`) vs. Zod (`packages/contracts`) independently hand-authored (§I.2) | ERROR | Yes | Yes | Yes | Yes | Yes |
| PRICE_DRIFT | `PROJECT_STATE.yaml` missing 6 `_v2` prices present in `RISK_LIMITS.yaml`/`service-prices.ts`; registry `base_price`/`maximum_price` never cross-checked against `RISK_LIMITS.yaml` (§I.2, §I.7) | ERROR | Yes | Yes | Yes | Yes | Yes |
| CAPABILITY_DRIFT | none confirmed active; the `get_quote` case (§I.3) resolved to **not** a capability drift | ERROR | Yes | Yes | Yes | Yes | Yes |
| EXPOSURE_DRIFT | registry `protocols.{a2a,mcp,x402}` all `"planned"` while live code implements all three (§I.2, §I.6) | ERROR (already active, not hypothetical) | No | Yes | Yes | No (doesn't block current live deployment, which doesn't read this field for gating) | Yes |
| ACTIVATION_DRIFT | `production_ready`/`production_enabled` static claims vs. live `env.ts` gate reality (§I.2, §I.9) | ERROR for any *public claim*; INFORMATIONAL for the frozen historical file itself once labeled per §I.9 | No | Yes (for any live-facing projection) | Yes | No | Yes |
| ECONOMIC_DRIFT | none confirmed active; `payTo`/asset resolution verified consistent (§I.2) | ERROR | Yes | Yes | Yes | Yes | Yes |
| SECURITY_CLAIM_DRIFT | latent risk: A2A card could claim the configured `kid` while actually signing with the ephemeral fallback if not gated per §I.13 | ERROR | Yes | Yes | Yes | Yes | Yes |
| RELEASE_DIGEST_DRIFT | no projection digesting exists yet (§I.2) — currently this is a **gap**, not yet a drift, but will become detectable/blocking once VCM introduces digests | INFORMATIONAL today → ERROR once digesting exists | No today | No today → Yes later | No today → Yes later | No | Yes once it exists |
| STALE_STATE_VIEW | `PROJECT_STATE.yaml`, `TASKS.yaml` (§I.9) | WARNING (once correctly labeled HISTORICAL per §I.9); ERROR if any of these fields is read by a live process (`OPEN`, needs verification) | No | Yes (a lint step should flag any code that reads these files as a live source) | No | No | No |

---

## I.12. Release / Evidence Authority

Six distinct identifiers that must never be conflated, modeled directly on the SUN-1222C
pattern the directive names as the reference case:

```
runtime source commit        — git SHA of the code that implements a capability
evidence/report commit       — git SHA of the docs/reports/ entry documenting closure
                                (discovery confirmed these are already, correctly, different
                                commits for SUN-1222C — the pattern already exists, just
                                undocumented as a formal rule until now)
immutable contract release   — contracts/releases/{version}/CONTRACT_RELEASE.yaml, frozen
deployed Worker version      — Cloudflare platform-assigned id, not in repo, OPEN to query live
metadata model digest        — does not exist yet; VCM's own schema-version hash
projection digest            — does not exist yet; per-surface generated-output hash
qualification evidence       — governance/PROMOTION_STATES.yaml ladder + docs/reports/ entries
                                showing which requirements were met for a given promotion
```

Rule: a metadata release record (future VCM release manifest) must carry **all six**
identifiers as separate fields, even when some are currently unobtainable
(`deployed Worker version` is `OPEN` — needs a live platform query, not a repo fact) —
recording "unknown, needs live verification" is correct; silently omitting the field or
substituting the runtime source commit for it is the exact conflation this section exists
to prevent.

---

## I.13. Security Metadata Truth Law

Four truth levels, strictly ordered — a higher level may never be asserted on the strength
of evidence for only a lower one:

```
IMPLEMENTED  — code exists that can perform the security function.
               Evidence: source file + exported function (e.g.
               packages/protocol-a2a/src/signing.ts:createConfiguredA2aSigningIdentity).
CONFIGURED   — the deployment declares the binding needed to activate it.
               Evidence: wrangler.toml secret/var declaration
               (AGENT_CARD_SIGNING_KEY_ID, AGENT_CARD_SIGNING_PRIVATE_KEY) — but a
               declared binding does not prove a value was ever set.
ACTIVE        — the live environment currently has a real value bound and the code path
               that consumes it is actually being exercised by current traffic.
               Evidence: a live query against the deployed environment (e.g.
               `wrangler secret list`, or a runtime self-report endpoint) — NOT
               obtainable from repository contents alone.
VERIFIED     — an independent check (signature verification against the published JWKS,
               an external audit, a reproducible test against the live endpoint) confirms
               ACTIVE is functioning correctly, not just configured-and-assumed-working.
```

Worked case (the exact example the directive names): `createConfiguredA2aSigningIdentity`
existing and being wired into `wrangler.toml` proves **IMPLEMENTED** and **CONFIGURED**.
It proves nothing about **ACTIVE** — discovery explicitly could not verify from the repo
whether `AGENT_CARD_SIGNING_PRIVATE_KEY` holds a real value in the live Cloudflare account.
`signing.ts`'s own design (`createConfiguredA2aSigningIdentity` throwing rather than
silently falling back to the ephemeral `LOCAL_A2A_SIGNING_KEY_ID`, per its doc comment at
`signing.ts:121`) is itself evidence the authors intended CONFIGURED/ACTIVE to be a hard
gate, not a soft default — VCM's truth law simply makes that existing code-level intent
explicit at the metadata layer too.

**Rule: public metadata may only assert `active signing`, `active mTLS`, or `active
identity verification` when ACTIVE-level evidence exists (a live check), never on the
strength of IMPLEMENTED or CONFIGURED alone.** Until VCM has a live-query mechanism,
any security claim in a generated projection must be capped at CONFIGURED
("signing capability configured; activation not verified by this build") rather than
overclaiming ACTIVE.

`mtls-production-capability.ts` and the equivalent env-gate enumeration for mTLS were
located but not fully enumerated field-by-field in this pass — flagged `OPEN` for the
next checkpoint, not blocking, since the four-level law above already governs how to
treat whatever is found there.

---

## I.14. Migration Sequence

Non-binding sequencing sketch only — no implementation authorized by this checkpoint.

1. **Prove parity, change nothing else**: build the VCM compiler to read
   `registry/services/*.json` + `schemas/services/` + `governance/RISK_LIMITS.yaml` and
   regenerate byte-identical `registry/services/*.json` output (§I.6 option C, step 1).
2. **Fix the two confirmed-live drifts as separately reviewed diffs**, not silently inside
   the VCM cutover: (a) registry `protocols` block for A2A/MCP/x402 flipped from
   `"planned"` to accurate live values, generated from actual code registration; (b)
   registry `base_price`/`maximum_price` validated against `RISK_LIMITS.yaml` and any
   disagreement resolved by a human, not auto-overwritten.
3. **Collapse the schema duplication** (§I.2 highest-risk row): make Zod types in
   `packages/contracts` generated from `schemas/services/*.schema.json`, or add a CI diff
   gate if generation isn't feasible yet.
4. **Introduce `pricing_policy_version`** and wire it through every pricing-bearing
   projection.
5. **Generate `SITEBORNE_SERVICE_IDS`/`ALL_BAZAAR_SERVICE_IDS`** from the registry file
   set instead of hand-authoring both.
6. **Add the capability/exposure/activation triple (§I.3)** to every projection that
   currently uses a single `available`-shaped boolean.
7. **Add projection digests** (§I.2, §I.12 gap) once the above are stable.
8. **Add the live-query mechanism for security ACTIVE-level truth (§I.13)** and gate all
   security claims in projections behind it.
9. **Only then** invert registry authority to VCM-generated (§I.6 option C, step 2) and
   apply the `PROJECT_STATE.yaml`/`TASKS.yaml` `HISTORICAL_ONLY` banner (§I.9).
10. AVUF/DID/ERC-8004 remain explicitly out of critical path throughout (per original
    directive constraint); VCM's compiler design should not preclude AVUF later producing
    a Candidate VCM through the same compiler, but no AVUF-specific code is introduced now.

---

## I.15. Explicit Invariants

```
✓ ONE normative owner per fact                          — enforced by §I.2 matrix; §I.2's
                                                            highest-risk violation (schema
                                                            dual-authorship) is flagged for
                                                            §I.14 step 3, not silently accepted.
✓ MANY generated projections allowed                     — §I.10.
✓ ZERO projection-specific redefinition of canonical facts — §I.10 forbidden-transforms columns.
✓ runtime state may narrow static capability              — §I.5.
✓ runtime state may never fabricate capability             — §I.5, worked example §I.3.
✓ security metadata claims only what evidence proves       — §I.13 four-level law.
✓ economic metadata claims only what governed state allows — §I.7, §I.2 pricing rows.
✓ v1/v2 identities remain stable                           — §I.4, §I.8 (no deprecation
                                                            relationship introduced).
✓ current public contracts remain byte/semantically compatible during migration
  unless a separately governed contract change is approved — §I.14 step 1 (parity-first),
                                                            step 2 (drift fixes as their
                                                            own reviewed diffs, not bundled
                                                            into the cutover).
```

---

## I.P. Return Block

```
METADATA_AUTHORITY_01=PASS

AUTHORITY_CLASSES=NORMATIVE, OPERATIONAL, DERIVED, MIRROR, EVIDENCE, HISTORICAL, DEPRECATED

FACTS_WITH_MULTIPLE_CURRENT_AUTHORITIES=4   (fact families: protocol exposure [4 surfaces],
                                              pricing [3-way], contract-release version,
                                              production_ready/production_enabled)
FACTS_WITH_NO_CLEAR_AUTHORITY=3   (pricing_policy_version, openapi key in protocols block,
                                    projection/digest hashing)

REGISTRY_ROLE_CURRENT=canonical-but-partially-stale
REGISTRY_ROLE_TARGET=generated projection of VCM, post-parity-proof

VCM_ROLE_TARGET=compile-time semantic authority; registry becomes its generated projection
                 after §I.6 transitional parity proof

RUNTIME_OVERLAY_REQUIRED=YES

PROJECT_STATE_DISPOSITION=HISTORICAL_ONLY
TASKS_DISPOSITION=HISTORICAL_ONLY

PRICING_CANONICAL_OWNER=governance/RISK_LIMITS.yaml
SERVICE_ID_CANONICAL_OWNER=registry/services/*.json (file-set-derived)

GET_QUOTE_ACTUAL_CONTRADICTION=NO

PCC_VERSION_DOMAINS_RESOLVED=YES

PROJECTION_SURFACES_MAPPED=8   (Agent Card/A2A, MCP, OpenAPI, x402 discovery, Bazaar,
                                 Nevermined, catalog, PCC references)
CONTRADICTION_CLASSES=11

SECURITY_TRUTH_LEVELS=IMPLEMENTED|CONFIGURED|ACTIVE|VERIFIED

DESIGN_ARTIFACT=docs/reports/METADATA-AUTHORITY-01-canonical-authority-map.md

RUNTIME_SOURCE_CHANGES=0
METADATA_PROJECTION_CHANGES=0
PRODUCTION_MUTATIONS=0

SAFE_TO_DESIGN_VCM_SCHEMA=YES
```

Open items carried forward, not blocking: exact mTLS capability/activation field
enumeration (§I.13); whether `AGENT_CARD_SIGNING_PRIVATE_KEY` holds a live value
(§I.2, §I.13 — requires live platform query, out of reach from repo alone); confirming
no live code path reads `PROJECT_STATE.yaml`/`TASKS.yaml` before applying the
`HISTORICAL_ONLY` banner (§I.9).

---
---

# PART II — Verified Canonical Metadata Model Schema Design

*Source: `METADATA-VCM-02-schema-design.md`. Reproduced verbatim below; only the top status line and section anchors were adjusted for this merge.*

Status: design checkpoint. `METADATA-AUTHORITY-01` (Part I above) is treated as frozen authority; every
canonical-owner decision made there is inherited without re-litigation. No runtime,
protocol-projection, registry, governance, pricing, contract, CI, or production file was
modified to produce this document. `packages/vcm` is **not** created by this checkpoint.

All canonicalization/hashing decisions reuse the repo's existing frozen machinery rather
than inventing a second one: `packages/pcc-schema`'s `canonicalize()`/`hashCanonical()`
(RFC8785/JCS, documented at `docs/decisions/0007-pcc-canonicalization-and-signing.md`),
consumed the same way `packages/verification/src/canonical.ts` already consumes it —
by import, not reimplementation. Hash format matches the existing convention exactly:
`sha256:<64 lowercase hex>`, i.e. `packages/pcc-schema/src/index.ts:654`'s
`HashZ = z.string().regex(/^sha256:[a-f0-9]{64}$/)`.

---

## II.1. Three-Layer Model

```
CanonicalStaticModel   — NORMATIVE + DERIVED + MIRROR + EVIDENCE facts (per Authority Map §I.1).
                          Build-time. Never reads live environment state.
        +
RuntimeStateOverlay     — OPERATIONAL facts (per Authority Map §I.1). Read at request/report
                          time from env bindings, secrets, and live measurement. Never
                          hand-authored, never checked into a static file as truth.
        =
EffectiveMetadataView   — the merge. The only thing any protocol projection is allowed
                          to read from. Never constructed by hand; always `project(static, overlay)`.
```

```typescript
declare function project(
  staticModel: CanonicalStaticModel,
  overlay: RuntimeStateOverlay,
): EffectiveMetadataView;
```

**Merge law** (structural, not just documented — see §II.6 for how the types enforce it):
for every fact that has both a static declaration and an overlay observation, the
effective value is `overlay.narrows(static)`, never `overlay.widens(static)`. The overlay
types below are deliberately missing any field that could assert a capability, exposure,
or truth level the static model didn't already declare — there is no `protocolExposed`
field anywhere in `RuntimeStateOverlay`, only fields that can turn a static "yes" into an
effective "no" (`runtimeEnabled: false`, `measuredLevel: 'UNMEASURED'`, etc.). A widening
bug is a type-construction error, not just a logic error a reviewer has to catch.

---

## II.2. Version Namespaces — Closed, Unambiguous

No field in this model is ever named bare `version`. Eleven namespaces, exactly matching
Authority Map §I.4:

```typescript
/** `.v1`, `.v2`, … — permanent parallel identities. Never a deprecation ladder. */
type ServiceGeneration = 'v1' | 'v2';

/** Precise decimal semver, not a bare string — avoids "2.0" vs "2.0.0" ambiguity
 *  that has already caused confusion in hand-maintained YAML across this repo. */
interface SemVer {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly raw: `${number}.${number}.${number}`;
}

type ContractReleaseVersion = SemVer;              // contracts/releases/*/CONTRACT_RELEASE.yaml
type PccWireVersion = '1.0.0';                      // packages/pcc-schema/src/index.ts:PCC_VERSION
                                                      // (literal union of one today; extend the
                                                      // union, never widen to `string`, if it changes)
type PccSchemaRelease = SemVer;                      // CONTRACT_RELEASE.yaml:pcc_dependency.schema_release
type McpProtocolVersion = `${number}-${string}-${string}`; // date-shaped, e.g. '2026-07-28'
type X402ProtocolVersion = number;                   // @x402/core's exported x402Version (= 2)
type VcmSchemaVersion = SemVer;                      // this model's own shape version
type VcmReleaseVersion = SemVer;                     // one compiled instance of the model
type ProjectionVersion = SemVer;                     // per-protocol-surface generated-output version
type DeploymentVersion =                             // OPERATIONAL — never in CanonicalStaticModel
  | { readonly platform: 'cloudflare-workers'; readonly workerVersionId: string }
  | Unknown_;                                        // platform id not obtainable from this build context
type PricingPolicyVersion = SemVer;                  // governance/RISK_LIMITS.yaml pricing generation
```

`PccWireVersion` and `PccSchemaRelease` are carried as two separate fields everywhere
they appear (`ServiceContractRef.pcc.wireVersion` / `.schemaRelease` — §II.5) — never
collapsed, per Authority Map §I.4's resolved finding that these are intentionally distinct
dimensions (`contracts/releases/2.0.0/CONTRACT_RELEASE.yaml:42`'s own comment: *"version
pcc_version remains 1.0.0, unchanged"* while `schema_release` independently advances).

---

## II.3. Unknown / Null / Unsupported States

Every "we don't know" state is a distinct, named sentinel — never a bare `null`/`undefined`
standing in for three different meanings at once.

```typescript
/** We looked and could not obtain a value in this build/report context
 *  (e.g. a live platform query wasn't performed). Distinct from "known false". */
interface Unknown_ { readonly kind: 'UNKNOWN' }

/** A live measurement was never attempted for this fact. Distinct from UNKNOWN:
 *  UNMEASURED means "no attempt was made", UNKNOWN means "an attempt was made
 *  and failed or was inconclusive". Both are honest; they answer different questions. */
interface Unmeasured { readonly kind: 'UNMEASURED' }

/** The fact is knowably absent by design (e.g. no payTo bound yet), not merely unknown. */
interface NotConfigured { readonly kind: 'NOT_CONFIGURED' }

/** The fact does not apply to this entity at all (e.g. security mechanism kind
 *  that has no jwksUri concept). */
interface NotApplicable { readonly kind: 'NOT_APPLICABLE' }

type Maybe<T> = T | Unknown_;
type MeasuredOr<T> = T | Unmeasured;
```

Rule: a field typed `T | undefined` is a design smell in this model. If absence is
possible, it must be one of the four sentinels above, chosen for what absence *means*.

---

## II.4. Capability / Exposure / Activation / Admission / Qualification — Formalized

Direct implementation of Authority Map §I.3's five-axis model, now as types instead of prose:

```typescript
type ProtocolSurface = 'a2a' | 'mcp' | 'openapi' | 'x402' | 'bazaar' | 'nevermined';

/** STATIC. capabilityExists is always `true` by construction: if a CanonicalInteraction
 *  exists at all, the capability exists. The field is kept explicit (not just implied by
 *  presence in an array) because §II.10's projection law requires every projection to be able
 *  to state it positively, and because a future interaction kind might need a `false` here
 *  if the model ever represents "planned but not yet implemented" interactions directly
 *  (not needed today — see minimality table, §II.18). */
interface StaticProtocolExposure {
  readonly surface: ProtocolSurface;
  readonly capabilityExists: true;
  /** Whether THIS surface has wired the interaction to a callable endpoint/tool.
   *  Compiled from actual code registration once the registry authority inversion (§II.15)
   *  completes; during transition, carried through from the legacy registry file
   *  verbatim (see §II.15's two-track field). */
  readonly protocolExposed: boolean;
  readonly exposureShape: 'standalone_endpoint' | 'inline_within_another_operation' | 'not_exposed';
}

/** OPERATIONAL. Lives only in RuntimeStateOverlay (§II.10) — deliberately has NO field that
 *  could assert protocolExposed; it can only narrow protocolExposed=true down to
 *  effectively-unavailable via runtimeEnabled=false. */
interface RouteRuntimeState {
  readonly serviceId: CanonicalServiceIdValue;
  readonly operationId: string;
  readonly runtimeEnabled: boolean;
  readonly economicAdmissionEnabled: boolean; // independent axis; a free/read-only
                                               // interaction can be runtimeEnabled=true
                                               // with economicAdmissionEnabled=NOT_APPLICABLE
                                               // — see EffectiveInteractionView, §II.10
}

/** EVIDENCE-derived, not static, not purely operational: whether a service has cleared
 *  the governance promotion ladder rung required for the controls it exercises.
 *  Computed from governance/PROMOTION_STATES.yaml's requirement set + docs/reports/
 *  evidence, at report time — hence modeled as part of the overlay (it can change
 *  without a code deploy), not the static model. */
interface QualificationRuntimeState {
  readonly serviceId: CanonicalServiceIdValue;
  readonly currentPromotionState: LifecycleState;
  readonly qualifiedForProduction: boolean;
}
```

Effective view merges these into one honest per-interaction record (§II.10). No projection
is ever allowed to collapse this back into a single `available: boolean` — that collapse
is exactly the class of bug the `get_quote` investigation in `METADATA-AUTHORITY-01` §I.3
surfaced and resolved as a non-contradiction only because the two axes were disentangled
by hand; VCM makes the disentanglement structural.

---

## II.5. Core Identity Types

```typescript
type Sha256Digest = `sha256:${string}`; // validated against HashZ's regex at parse time,
                                         // not representable at the TS type level alone

type IsoTimestamp = string; // validated as ISO-8601 at parse time; kept as `string` here
                             // deliberately — see §II.14, this is the one place a "generic
                             // string" is correct because the domain (arbitrary instants)
                             // is genuinely unbounded, unlike the enums elsewhere in this doc

type GitSha = string; // validated against /^[0-9a-f]{40}$/ at parse time
type UriString = string; // validated as a well-formed absolute URI at parse time
type EvmAddress = `0x${string}`; // validated against /^0x[0-9a-fA-F]{40}$/ at parse time

interface MetadataModelIdentity {
  readonly vcmSchemaVersion: VcmSchemaVersion;
  readonly vcmReleaseVersion: VcmReleaseVersion;
  readonly modelDigest: Sha256Digest;   // see §II.9 — excluded from its own hash input, obviously
  readonly compiledAt: IsoTimestamp;    // volatile — excluded from every digest (§II.14)
}

/** Closed today: SITEBORNE has exactly one known organizational identity in this repo.
 *  If a second org identity is ever needed (white-label, multi-tenant), extend
 *  `network` to a union rather than widening it to `string` preemptively — YAGNI. */
interface OrganizationIdentity {
  readonly legalName: string;
  readonly publicName: string;
  readonly network: 'net.siteborne';
  readonly homepageUri: UriString;
  readonly supportContact: UriString;
}
```

---

## II.6. Service Identity, Family, Generation, Interactions

```typescript
/** Closed per Authority Map §I.8 — the four families that exist today. Extending this
 *  union is itself a governed, reviewed act (a new service family launching),
 *  exactly like adding a new file to registry/services/ is today. */
type ServiceFamily =
  | 'company_evidence_graph'
  | 'web_context_verified'
  | 'document_evidence_json'
  | 'verify_agent_output';

interface CanonicalServiceId {
  readonly family: ServiceFamily;
  readonly generation: ServiceGeneration;
}

/** The dotted string form used everywhere as a map key / lookup value.
 *  Derived, never independently settable — constructing one always goes through
 *  a single `serviceIdValue()` function, never string concatenation at call sites. */
type CanonicalServiceIdValue = `${ServiceFamily}.${ServiceGeneration}`;

/** Mirrors governance/PROMOTION_STATES.yaml's ladder ids exactly (DRAFT,
 *  CASE_SUPPORTED, MULTI_CASE_SUPPORTED, VERIFIED_PATTERN confirmed present in this
 *  pass; EXECUTABLE_VERIFIED confirmed as a registry-observed value
 *  (`promotion_state: "executable_candidate"` — NOTE: the registry's current string
 *  does not exactly match any ladder id read from PROMOTION_STATES.yaml in this pass;
 *  flagged OPEN below, not blocking, since the union is still closed and the mismatch
 *  itself becomes a detectable IDENTITY_DRIFT once VCM validates registry values
 *  against the governance ladder at compile time — which it cannot do today). */
type LifecycleState =
  | 'DRAFT'
  | 'CASE_SUPPORTED'
  | 'MULTI_CASE_SUPPORTED'
  | 'VERIFIED_PATTERN'
  | 'EXECUTABLE_CANDIDATE' // OPEN: reconcile exact name against governance/PROMOTION_STATES.yaml's
                            // full ladder (only its first four rungs were read in this pass)
  | 'EXECUTABLE_VERIFIED'
  | 'RETIRED'
  | 'TOMBSTONED';

type AuthorizationClassification = 'public' | 'restricted'; // 'public' confirmed observed;
  // 'restricted' inferred as the closed complement — OPEN: confirm no third value exists
  // by reading every registry/services/*.json file's authorization_classification before
  // implementation (mechanical, cheap — not a design blocker)

/** A capability tag. Deliberately NOT a closed TS union: the actual capability
 *  vocabulary varies per service family (identity_resolution, sec_submissions, …) and
 *  is itself data, not a fixed protocol concept — collapsing it into one repo-wide
 *  union would force every new capability to be a type-level change. Boundedness is
 *  enforced instead by a per-family closed set validated by the compiler (a runtime
 *  check against a governed capability vocabulary file), not by TypeScript. This is
 *  the one deliberate departure from "prefer closed unions" in this document, and it
 *  is deliberate rather than a `Record<string, unknown>` escape hatch. */
interface CanonicalCapability {
  readonly id: string; // validated at compile time against a governed per-family vocabulary
  readonly description: string;
}

type ExecutionMode = 'sync' | 'async';

/** 'variable' confirmed observed in registry/services/*.json. 'fast'/'slow' are the
 *  closed complement inferred from the field's name and are OPEN pending a full read
 *  of every registry file's expected_latency_class value before implementation. */
type LatencyClass = 'fast' | 'variable' | 'slow';

interface CanonicalInteraction {
  readonly operationId: string;
  /** Matches the three tool categories confirmed in the MCP discovery pass:
   *  four service tools (primary_service_call), one quote tool, one health tool. */
  readonly kind: 'primary_service_call' | 'quote_request' | 'health_check';
  readonly executionMode: ExecutionMode;
  readonly maximumInputBytes: number;
  readonly expectedLatencyClass: LatencyClass;
  readonly readOnly: boolean;
  readonly idempotent: boolean;
  readonly destructive: boolean;
  readonly exposure: readonly StaticProtocolExposure[];
  /** The ONE bounded, governed transform per Authority Map §I.10: MCP's contrastive
   *  routing text may rephrase but never assert a fact absent from this interaction's
   *  own capabilities/lifecycle/price. Optional because most interactions don't need
   *  an override — a default routing text is DERIVABLE from the base fields alone
   *  (§II.16 projection readiness); this slot exists only because today's MCP text is
   *  hand-authored per tool and migrating it to fully-generated text is out of scope
   *  for this checkpoint (see minimality table, §II.18: REQUIRED_FOR_KNOWN_PROJECTION,
   *  not REQUIRED_NOW). */
  readonly routingOverrides?: readonly RoutingOverride[];
  /** Two-track transitional field — see §II.15. REMOVE once registry authority inverts. */
  readonly legacyProtocolExposureDeclared?: Partial<Record<ProtocolSurface, 'planned' | 'live' | 'deprecated'>>;
}

interface RoutingOverride {
  readonly protocolSurface: Extract<ProtocolSurface, 'mcp'>; // only MCP needs this today;
                                                               // extend the Extract<> set if
                                                               // another surface adopts
                                                               // hand-authored routing text
  readonly useWhen: readonly string[];
  readonly doNotUseWhen: readonly string[];
}
```

---

## II.7. Schema/Contract References, Digests, Economics

```typescript
interface SchemaRef {
  readonly uri: UriString;
  readonly digest: Sha256Digest;
}

interface ServiceContractRef {
  readonly contractReleaseVersion: ContractReleaseVersion;
  readonly inputSchema: SchemaRef;
  readonly outputSchema: SchemaRef;
  readonly pcc: {
    readonly wireVersion: PccWireVersion;
    readonly schemaRelease: PccSchemaRelease;
  };
}

/** Decimal-as-string, matching the existing registry convention
 *  (`{"amount": "0.039", "currency": "USD"}`) — never a JS `number`, which would
 *  silently introduce float rounding into a financial figure that is compared for
 *  exact equality elsewhere in this repo (governance ceiling checks). */
type UsdAmount = `${number}.${number}`;

interface Price {
  readonly amount: UsdAmount;
  readonly currency: 'USD'; // closed — only USD observed anywhere in this repo
}

type PaymentScheme = 'exact' | 'upto'; // packages/protocol-x402/src/network/schemes.ts
type SettlementNetworkFamily = 'eip155' | 'solana'; // schemes.ts

interface SchemeNetworkSupport {
  readonly scheme: PaymentScheme;
  readonly networks: readonly SettlementNetworkFamily[];
}

/** Deliberately excludes effectiveRuntimePrice and quotedTransactionAmount —
 *  those are OPERATIONAL / transaction-artifact facts respectively (§II.8, §II.9's economic
 *  semantics section), never part of CanonicalStaticModel. */
interface ServiceEconomics {
  readonly pricingPolicyVersion: PricingPolicyVersion;
  /** INVARIANT, enforced at compile time by the VCM compiler (not representable as a
   *  TS type constraint alone): listPrice.amount <= governedMaxPrice.amount. */
  readonly listPrice: Price;
  readonly governedMaxPrice: Price;
  readonly supportedSchemes: readonly SchemeNetworkSupport[];
}
```

---

## II.8. Critical Economic Semantics — Four Distinct Concepts, Never Merged

Direct implementation of Authority Map §I.7:

```typescript
// CanonicalStaticModel (§II.7 above):
//   listPrice            — ServiceEconomics.listPrice           (NORMATIVE, registry-sourced)
//   governedMaxPrice      — ServiceEconomics.governedMaxPrice     (NORMATIVE, RISK_LIMITS.yaml-sourced)

// RuntimeStateOverlay (§II.10 below):
//   effectiveRuntimePrice — EconomicRuntimeState.effectiveRuntimePrice (OPERATIONAL, live resolver)

// NOT part of VCM at all:
//   quotedTransactionAmount — belongs to a Quote, a transaction artifact bound to one
//                             specific request (deterministic hash of pricing_key,
//                             pricing_source_version, scheme, network, asset, amount,
//                             payee — packages/protocol-x402/src/quote/quote.ts).
//                             A Quote MAY CITE a VCM release's pricingPolicyVersion and
//                             modelDigest as provenance, but a Quote is never itself a
//                             field of VerifiedCanonicalMetadata, and VCM never contains
//                             quote_id, expiresAt, or any other per-transaction field.
```

```typescript
interface EconomicRuntimeState {
  readonly serviceId: CanonicalServiceIdValue;
  readonly effectiveRuntimePrice: Price | Unknown_;
  readonly payTo: EvmAddress | NotConfigured;
  readonly activeNetwork: SettlementNetworkFamily | Unknown_;
  readonly activeAsset: { readonly symbol: string; readonly contractAddress: EvmAddress } | Unknown_;
}
```

`payTo`, active network, and active asset are OPERATIONAL exactly as the directive
requires — `apps/edge-api/.../production-payment.ts:124-150` resolves `payTo` from
`env.SELLER_WALLET_ADDRESS` and the asset from `resolvePaymentAsset(network)` →
`@x402/evm.getDefaultAsset()`, both live-environment facts with no static counterpart.
The existing Bazaar discovery fixture sentinel (`PAYTO_NOT_CONFIGURED`) maps directly
onto `NotConfigured` here — VCM formalizes a pattern the codebase already uses correctly
rather than inventing a new one.

---

## II.9. Critical Security Semantics — Four Truth Levels, Structurally Enforced

Direct implementation of Authority Map §I.13. The type system itself makes "code support
implies live activation" inexpressible: the static model's truth-level union has only
two members; ACTIVE/VERIFIED literally cannot be constructed there.

```typescript
type StaticSecurityTruthLevel = 'IMPLEMENTED' | 'CONFIGURED';
type SecurityTruthLevel = StaticSecurityTruthLevel | 'ACTIVE' | 'VERIFIED';

/** Closed per evidence: A2A card signing uses ES256 (packages/protocol-a2a),
 *  PCC receipts use Ed25519 (packages/pcc-schema / packages/verification).
 *  mTLS fields intentionally left unenumerated — OPEN per Authority Map §I.13,
 *  not required by any of the 7 governed projections (§II.16), so not blocking. */
interface SecurityMechanism {
  readonly kind: 'a2a_card_signing' | 'mtls' | 'payment_signature_verification';
  readonly keyId?: string;      // present once CONFIGURED or higher
  readonly jwksUri?: UriString; // present for a2a_card_signing once CONFIGURED or higher
  readonly algorithm?: 'ES256' | 'Ed25519';
}

/** STATIC. truthLevel is type-capped at CONFIGURED — this interface cannot represent
 *  ACTIVE or VERIFIED. `createConfiguredA2aSigningIdentity` existing
 *  (packages/protocol-a2a/src/signing.ts:123) plus `wrangler.toml` declaring
 *  AGENT_CARD_SIGNING_KEY_ID/AGENT_CARD_SIGNING_PRIVATE_KEY proves exactly
 *  CONFIGURED — never more — from repo contents alone. */
interface SecurityCapability {
  readonly mechanism: SecurityMechanism;
  readonly truthLevel: StaticSecurityTruthLevel;
}

/** OPERATIONAL. The ONLY place ACTIVE/VERIFIED can be written, and only by a process
 *  that performed a live measurement (a platform secret-presence query, a signature
 *  verification against the published JWKS, an external audit) — never inferred. */
interface SecurityRuntimeState {
  readonly mechanismKind: SecurityMechanism['kind'];
  readonly measuredLevel: MeasuredOr<Extract<SecurityTruthLevel, 'ACTIVE' | 'VERIFIED'>>;
  readonly measuredAt: IsoTimestamp;
  readonly evidenceRef?: EvidenceRef;
}
```

---

## II.10. Runtime State Overlay

```typescript
interface RuntimeStateOverlay {
  readonly observedAt: IsoTimestamp;               // volatile, excluded from overlay digest
  readonly deploymentVersion: DeploymentVersion;
  readonly routes: readonly RouteRuntimeState[];     // §II.4
  readonly economics: readonly EconomicRuntimeState[]; // §II.8
  readonly security: readonly SecurityRuntimeState[];  // §II.9
  readonly qualification: readonly QualificationRuntimeState[]; // §II.4
}
```

No other fields. This is deliberately the smallest overlay that can represent every
OPERATIONAL fact identified in Authority Map §I.2 and §I.5 — see minimality table, §II.18.

---

## II.11. Effective Metadata View

```typescript
interface EffectiveInteractionView {
  readonly operationId: string;
  readonly capabilityExists: true;
  readonly protocolExposed: boolean;                      // from static
  readonly runtimeEnabled: boolean;                        // from overlay, ANDed under the hood
  readonly economicAdmissionEnabled: boolean | NotApplicable; // NotApplicable for non-paid interactions
  readonly effectivePrice: Price | Unknown_ | NotApplicable;
}

interface EffectiveSecurityView {
  readonly mechanismKind: SecurityMechanism['kind'];
  /** Ceiling law: this can only reach ACTIVE/VERIFIED if the overlay supplied a
   *  matching measurement; otherwise it falls back to the static CONFIGURED/IMPLEMENTED
   *  ceiling. Never the other direction. */
  readonly truthLevel: SecurityTruthLevel | Unmeasured;
}

interface EffectiveServiceView {
  readonly id: CanonicalServiceIdValue;
  readonly title: string;
  readonly description: string;
  readonly lifecycleState: LifecycleState;
  readonly qualifiedForProduction: boolean;
  readonly interactions: readonly EffectiveInteractionView[];
  readonly security: readonly EffectiveSecurityView[];
  readonly listPrice: Price;
  readonly governedMaxPrice: Price;
}

interface EffectiveMetadataView {
  readonly digest: Sha256Digest;        // see §II.14
  readonly organization: OrganizationIdentity;
  readonly services: readonly EffectiveServiceView[];
  readonly generatedAt: IsoTimestamp;   // volatile, excluded from effective-view digest
}
```

---

## II.12. Extension Boundary

The single deliberate `Record<string, unknown>` escape hatch in this entire model —
justified, not accidental:

```typescript
interface ExtensionField<Namespace extends string = string> {
  /** Reserved-prefix convention, e.g. 'x-siteborne-avuf'. */
  readonly namespace: Namespace;
  /** Explicitly non-normative. Ignored by every core validator and excluded from
   *  every digest in §II.14 — its presence or absence must never silently change a
   *  core service's identity hash. This is what lets AVUF later "produce a Candidate
   *  VCM via the same metadata compiler" (original directive) without AVUF, DID, or
   *  ERC-8004 concepts entering the critical-path types above. */
  readonly payload: Record<string, unknown>;
}
```

Attached as an optional `extensions?: readonly ExtensionField[]` on `CanonicalService`
and on `VerifiedCanonicalMetadata` itself. Nowhere else.

---

## II.13. Compatibility, Provenance, Evidence, Release

```typescript
interface CompatibilityDeclaration {
  readonly contractReleaseVersion: ContractReleaseVersion;
  readonly compatibleWith: readonly ContractReleaseVersion[]; // governance/CONTRACT_COMPATIBILITY.yaml
  readonly breakingFrom: readonly ContractReleaseVersion[];
}

interface EvidenceRef {
  readonly kind: 'git_commit' | 'docs_report' | 'contract_release' | 'promotion_requirement' | 'live_query';
  /** Shape genuinely varies by kind (a SHA, a file path, a query description) —
   *  bounded by the compiler per-kind, not further subdivided at the type level
   *  since no consumer needs to distinguish locator shapes generically. */
  readonly locator: string;
  readonly observedAt: IsoTimestamp;
}

/** Authority Map §I.12's six-identifier rule, minus deploymentVersion (carried
 *  separately on MetadataRelease itself, not duplicated here) and minus the two
 *  digest fields (also on MetadataRelease). ProvenanceRef holds exactly the two
 *  identifiers that are source-control facts, kept deliberately distinct
 *  (runtimeSourceCommit vs evidenceReportCommit — confirmed by discovery to
 *  already differ for SUN-1222C, i.e. this is not a hypothetical distinction). */
interface ProvenanceRef {
  readonly runtimeSourceCommit: GitSha;
  readonly evidenceReportCommit?: GitSha;
  readonly contractReleaseVersion: ContractReleaseVersion;
}

interface MetadataRelease {
  readonly vcmReleaseVersion: VcmReleaseVersion;
  readonly modelDigest: Sha256Digest;
  readonly provenance: ProvenanceRef;
  readonly deploymentVersion: DeploymentVersion;
  readonly projectionDigests: Partial<Record<ProtocolSurface, Sha256Digest>>;
  readonly qualificationEvidence: readonly EvidenceRef[];
}
```

---

## II.14. Deterministic Identity — Canonicalization and Digest Model

**Canonical bytes**: `@siteborne/pcc-schema`'s `canonicalize()` (RFC8785/JCS), imported
the same way `packages/verification/src/canonical.ts` already does — one canonicalization
algorithm for the whole repo, per that module's own header comment. VCM does not implement
JCS a second time.

**Hash algorithm**: SHA-256, hex-encoded, prefixed `sha256:` — identical to
`packages/pcc-schema/src/index.ts:575-576` and the existing `HashZ` regex. VCM's digests
are drop-in-compatible with every existing `sha256:...` field in this repo (schema hashes,
receipt hashes).

**Volatile-field exclusions** (never enter canonicalized bytes for any digest below):
`compiledAt`, `generatedAt`, `observedAt`, `measuredAt`, the digest field being computed
itself, `deploymentVersion` (except where a digest's own stated purpose is to bind to a
specific deployment — see projection digest), and the contents of every `ExtensionField.payload`.

**Timestamp treatment**: every `IsoTimestamp`-typed field is enumerated per digest kind
below as either "excluded" (volatile, about when the fact was observed/compiled — always
excluded) or "not present in this digest's input at all" (structurally absent because the
type being hashed doesn't carry one). No digest ever includes a timestamp.

Five digests, each retained because it has a specific release/integrity consumer —
**no digest is created merely because it is possible**:

| Digest | Computed over | Excludes | Consumer / use |
|---|---|---|---|
| **model digest** | `CanonicalStaticModel` minus `modelIdentity.compiledAt` and `modelIdentity.modelDigest` itself; includes `vcmSchemaVersion` (structural shape matters) but not `vcmReleaseVersion` (identifies a compiled instance, not content) | timestamps, self | Identifies "this exact static content" independent of when it was compiled — lets two builds from different machines/times prove they produced the same canonical facts |
| **service digest** | one `CanonicalService` | none within it (services carry no internal timestamps) | Fine-grained change detection; lets the registry parity proof (§II.15) and any future diffing tool point at exactly which service changed, rather than only "the whole model changed" |
| **runtime-overlay digest** | `RuntimeStateOverlay` minus `observedAt` and every `measuredAt` | timestamps | Lets a live status consumer (e.g. `siteborne_get_service_health`) detect "the effective operational facts changed" without diffing full JSON on every poll |
| **effective-view digest** | `EffectiveMetadataView` minus `generatedAt` | timestamp | The one digest a projection or external verifier should actually cite as "the semantic content you are looking at, precisely." Closes Authority Map §I.2's "no digest for generated projections" gap at the model layer |
| **projection digest** | the generated output of one protocol surface (Agent Card JSON, MCP tool list, OpenAPI doc, x402 discovery doc, Bazaar listing, catalog entry) — canonicalized the same way | none beyond whatever the projection's own volatile fields are (documented per-adapter, not here) | Closes Authority Map §I.12's confirmed gap: "no digest currently exists for generated projections themselves." Recorded in `MetadataRelease.projectionDigests`, one per surface |

Digests deliberately **not** created: no digest for `OrganizationIdentity` alone (no
consumer needs to verify the org identity independent of the rest of the model — it's
tiny and rarely changes); no digest for an individual `CanonicalInteraction` (too granular
— no consumer identified that needs interaction-level integrity independent of its parent
service digest); no digest for `MetadataModelIdentity` alone (it *contains* the model
digest — hashing a struct that contains a hash of itself is definitionally redundant).

---

## II.15. Registry Transition Model

```
registry/services/*.json
        ↓  legacyRegistryToVCM()
CanonicalStaticModel  (VCM, imported)
        ↓  vcmToLegacyRegistry()
regenerated registry/services/*.json
```

```typescript
declare function legacyRegistryToVCM(
  registryFiles: readonly LegacyRegistryServiceFile[], // raw parsed registry/services/*.json
  riskLimits: RiskLimitsFile,                            // governance/RISK_LIMITS.yaml, parsed
  schemaFiles: readonly SchemaFileRef[],                 // schemas/services/*.schema.json, hashed
): CanonicalStaticModel;

declare function vcmToLegacyRegistry(
  model: CanonicalStaticModel,
): readonly LegacyRegistryServiceFile[];
```

### Two-track protocol-exposure field during transition

Per Authority Map §I.6/§I.14, the transitional import must **preserve the currently-stale
`protocols` block verbatim**, not silently correct it. `CanonicalInteraction` therefore
carries two fields during the transition period (§II.6):

- `exposure: StaticProtocolExposure[]` — the **real** value, compiled from actual code
  registration (MCP's live tool list, A2A's live skill list, x402's live route table).
- `legacyProtocolExposureDeclared?: Partial<Record<ProtocolSurface, 'planned'|'live'|'deprecated'>>`
  — the **raw legacy value**, carried through losslessly so `vcmToLegacyRegistry()` can
  reproduce the original file's stale `"planned"` values exactly, byte-for-byte in content
  (not necessarily formatting — see parity law below), until the correction is applied as
  its own separately reviewed diff (Authority Map §I.14 step 2).

This field is classified `REMOVE` in the minimality table (§II.18) once authority inverts —
it exists only to make the parity proof possible without silently fixing known drift
inside a "just a schema design" checkpoint.

### Parity law

Target stated in the directive: `project(import(existing_registry)) == existing_registry`.

**Strongest feasible law, chosen deliberately over raw byte equality**:

```
deepStructuralEqual(
  canonicalize(vcmToLegacyRegistry(legacyRegistryToVCM(readAllRegistryFiles()))),
  canonicalize(readAllRegistryFiles())
)
```

i.e. **ordered structural equality over JCS-canonicalized JSON**, not raw byte equality
of the files on disk. Justification: `registry/services/*.json` files are not currently
serialized through any canonicalizer — their on-disk key ordering and whitespace are
incidental, not semantically meaningful. Requiring raw byte equality today would force
reformatting all eight registry files as a precondition of even writing the parity test,
which is itself a mutation this checkpoint is not authorized to make and which the
directive's own instruction ("no registry mutation") forecloses.

**Upgrade path, explicit**: once the reviewed correction diff from Authority Map §I.14
step 2 lands (the `protocols` block fix), re-serialize all registry files once through
`canonicalize()` as that diff's own formatting side-effect. From that point forward, raw
byte equality becomes the permanent, strictly stronger law, since the files will already
be in canonical form. This is recorded here as the target end-state, not performed now.

**Authority inversion** (registry becomes a generated projection of VCM rather than VCM
importing registry) occurs **only after** the structural parity proof above passes in CI
for the current registry file set, exactly per the directive's ordering requirement.

---

## II.16. Projection Readiness

| Projection | Status | Basis |
|---|---|---|
| **Agent Card / A2A** | `DERIVABLE_WITH_PROTOCOL_ADAPTER` | Needs identity (§II.5), description, `ServiceContractRef` (§II.7), `StaticProtocolExposure(a2a)` (§II.4), `SecurityCapability` capped at CONFIGURED (§II.9) + optional `SecurityRuntimeState` overlay, `ServiceEconomics` (§II.7). All present. Adapter work: A2A's own envelope shape (`skills` array naming, JWKS pointer placement) — protocol-specific packaging, not a missing fact. |
| **MCP** | `DERIVABLE_WITH_PROTOCOL_ADAPTER` | Needs identity, description + `RoutingOverride` (§II.6), schemas, `StaticProtocolExposure(mcp)`, `ServiceEconomics`, and the three annotation-hint booleans (`readOnly`/`idempotent`/`destructive`) already on `CanonicalInteraction` (§II.6). All present. Adapter work: MCP tool-registration envelope + the routing-text bounded transform (§II.10's projection law). |
| **OpenAPI** | `DERIVABLE_WITH_PROTOCOL_ADAPTER` | Needs identity, schemas, `StaticProtocolExposure(openapi)`. HTTP-specific error-shape catalog (400/402 response bodies, reverse-engineered from `x402-service.ts` per discovery) is correctly **not** in VCM — it's REST-transport packaging, the adapter's job, not a cross-protocol canonical fact. No missing fact. |
| **x402** | `DERIVABLE_WITH_PROTOCOL_ADAPTER` | Needs `ServiceEconomics.supportedSchemes` (§II.7), `StaticProtocolExposure(x402)`, `EconomicRuntimeState` overlay (§II.8) for live `payTo`/network/asset. All present. Adapter work: x402 discovery-document envelope. |
| **Bazaar** | `DERIVABLE_WITH_PROTOCOL_ADAPTER` | Same inputs as x402 plus its own listing envelope; `NotConfigured` sentinel (§II.3) directly models the existing `PAYTO_NOT_CONFIGURED` fixture pattern. No missing fact. |
| **Nevermined** | `FULLY_DERIVABLE` | `StaticProtocolExposure(nevermined).protocolExposed = false`, `exposureShape = 'not_exposed'` for every service today — the model represents "honestly not implemented" with no adapter logic beyond reading the flag. |
| **catalog** | `FULLY_DERIVABLE` | Identity, `lifecycleState`, `listPrice`, and a protocol-exposure summary across all six surfaces are all directly present on `CanonicalService`/`EffectiveServiceView` with no per-protocol packaging required. |

**`MISSING_CANONICAL_FACT` count: 0.**

mTLS (`SecurityMechanism.kind = 'mtls'`) remains `OPEN` for field enumeration per
Authority Map §I.13 but is not required by any of the seven projections above — it does
not block this checkpoint. `SecurityMechanism` already reserves room for it (`'mtls'` is
already a member of the `kind` union) so no type redesign will be needed when that
enumeration pass happens.

---

## II.17. Runtime Truth Proof — Worked Instance

Concrete instance for `company_evidence_graph.v2`, `PAID_ROUTES_ENABLED` unset (the
repo's actual current state per `env.ts`), A2A signing IMPLEMENTED+CONFIGURED with no
live measurement performed:

```typescript
const staticInteraction: CanonicalInteraction = {
  operationId: 'evaluate',
  kind: 'primary_service_call',
  executionMode: 'async',
  maximumInputBytes: 1_048_576,
  expectedLatencyClass: 'variable',
  readOnly: false,
  idempotent: true,
  destructive: false,
  exposure: [
    { surface: 'mcp', capabilityExists: true, protocolExposed: true, exposureShape: 'standalone_endpoint' },
    { surface: 'x402', capabilityExists: true, protocolExposed: true, exposureShape: 'inline_within_another_operation' },
    { surface: 'a2a', capabilityExists: true, protocolExposed: true, exposureShape: 'standalone_endpoint' },
  ],
};

const staticSecurity: SecurityCapability = {
  mechanism: { kind: 'a2a_card_signing', keyId: 'siteborne-a2a-es256-2026-01', jwksUri: '…', algorithm: 'ES256' },
  truthLevel: 'CONFIGURED', // NOT 'ACTIVE' — type system forbids it here (§II.9)
};

const overlay: Pick<RuntimeStateOverlay, 'routes' | 'security'> = {
  routes: [
    { serviceId: 'company_evidence_graph.v2', operationId: 'evaluate',
      runtimeEnabled: false,              // PAID_ROUTES_ENABLED is unset today
      economicAdmissionEnabled: false },
  ],
  security: [
    { mechanismKind: 'a2a_card_signing', measuredLevel: { kind: 'UNMEASURED' }, measuredAt: '2026-09-20T00:00:00Z' },
  ],
};

// project(static, overlay) yields:
const effective: EffectiveInteractionView = {
  operationId: 'evaluate',
  capabilityExists: true,   // code exists — true
  protocolExposed: true,    // MCP/x402/A2A have wired it — true
  runtimeEnabled: false,    // PAID_ROUTES_ENABLED unset — honestly false
  economicAdmissionEnabled: false,
  effectivePrice: { kind: 'UNKNOWN' }, // resolver not queried in this static example
};

const effectiveSecurity: EffectiveSecurityView = {
  mechanismKind: 'a2a_card_signing',
  truthLevel: { kind: 'UNMEASURED' }, // NEVER 'ACTIVE' — no measurement was supplied,
                                       // and CONFIGURED is not promoted to ACTIVE by
                                       // default; a consumer reading UNMEASURED must
                                       // NOT interpret it as "inactive", only as
                                       // "not verified by this report" — the ceiling
                                       // law (§II.9) still lets a caller fall back to
                                       // displaying the static CONFIGURED level with
                                       // an explicit "activation unverified" label,
                                       // which is a projection-layer choice, not a
                                       // VCM one.
};
```

This is the exact chain the directive asked to prove: capability implemented → protocol
exposed → route not runtime-enabled because `PAID_ROUTES_ENABLED=false` → signing
implementation present and configured → live signing activation reported as unmeasured,
never fabricated as active. Effective metadata never claims paid availability or verified
security merely because supporting code exists.

---

## II.18. Minimality Classification

| Field / type | Classification | Note |
|---|---|---|
| `MetadataModelIdentity` (all fields) | `REQUIRED_NOW` | Nothing downstream works without model identity |
| `OrganizationIdentity` (all fields) | `REQUIRED_NOW` | Every projection needs it |
| `CanonicalServiceId`, `ServiceFamily`, `ServiceGeneration` | `REQUIRED_NOW` | Core identity |
| `CanonicalService.{title,description,capabilities,lifecycleState}` | `REQUIRED_NOW` | Used by all 7 projections |
| `CanonicalService.declaredLimitations` | `REQUIRED_FOR_KNOWN_PROJECTION` | Currently only surfaced in registry/catalog-shaped output; not consumed by A2A/MCP/x402 today per discovery |
| `CanonicalService.authorizationClassification` | `REQUIRED_NOW` | Gates public visibility itself |
| `CanonicalInteraction.{operationId,kind,executionMode,maximumInputBytes,expectedLatencyClass}` | `REQUIRED_NOW` | Directly sourced from existing registry fields, directly consumed |
| `CanonicalInteraction.{readOnly,idempotent,destructive}` | `REQUIRED_FOR_KNOWN_PROJECTION` | Needed specifically for MCP annotation hints; other surfaces don't consume them today |
| `CanonicalInteraction.exposure` (`StaticProtocolExposure[]`) | `REQUIRED_NOW` | Core of the capability/exposure model |
| `CanonicalInteraction.routingOverrides` | `REQUIRED_FOR_KNOWN_PROJECTION` | MCP-only, optional |
| `CanonicalInteraction.legacyProtocolExposureDeclared` | `REMOVE` (post-authority-inversion) | Transitional only — §II.15 |
| `ServiceContractRef` (all fields) | `REQUIRED_NOW` | Every projection needs schema references; PCC dual-version fields required to avoid re-collapsing the §II.4 namespace fix |
| `ServiceEconomics.{pricingPolicyVersion,listPrice,governedMaxPrice}` | `REQUIRED_NOW` | Closes the confirmed live pricing drift (Authority Map §I.2, §I.7) |
| `ServiceEconomics.supportedSchemes` | `REQUIRED_FOR_KNOWN_PROJECTION` | x402/Bazaar only |
| `CompatibilityDeclaration` | `REQUIRED_FOR_KNOWN_PROJECTION` | Not consumed by any projection surface directly today (discovery found no consumer), but required to keep `governance/CONTRACT_COMPATIBILITY.yaml` from becoming a second undeclared authority once VCM exists |
| `RuntimeStateOverlay` (all fields) | `REQUIRED_FOR_RUNTIME_TRUTH` | Entire purpose is closing the confirmed `production_ready`/env-gate drift (Authority Map §I.2, §I.9) |
| `SecurityCapability` / `SecurityRuntimeState` | `REQUIRED_FOR_RUNTIME_TRUTH` | Directly implements the directive's non-negotiable security truth law |
| `EffectiveMetadataView` (all fields) | `REQUIRED_NOW` | The only thing projections may read |
| `MetadataRelease` | `REQUIRED_FOR_RUNTIME_TRUTH` | Closes Authority Map §I.12's confirmed digest gap |
| `EvidenceRef` / `ProvenanceRef` | `REQUIRED_FOR_RUNTIME_TRUTH` | Same |
| `ExtensionField` | `FUTURE_EXTENSION` | Exists only to keep AVUF/DID/ERC-8004 off the critical path while remaining reachable later, per original directive constraint |
| `DeploymentVersion` | `REQUIRED_FOR_RUNTIME_TRUTH` | Needed for `MetadataRelease`, but its value is frequently `Unknown_` until a live-query mechanism exists (Authority Map §I.13 follow-up) |
| Per-digest fields (`modelDigest`, `projectionDigests`, etc.) | `REQUIRED_FOR_RUNTIME_TRUTH` | Scoped tightly per §II.14's "no hash without a consumer" rule; nothing here is speculative |

No field in the design is classified `FUTURE_EXTENSION` other than `ExtensionField`
itself — the model does not carry speculative AVUF/DID/ERC-8004 fields, matching the
directive's minimality requirement.

---

## II.19. Decision Gates

```
ONE_CANONICAL_SERVICE_ID_SOURCE_DESIGN=YES        — §II.15: registry file set, generation-derived (Authority Map §I.8)
ONE_CANONICAL_PRICING_POLICY_SOURCE_DESIGN=YES     — §II.7/§II.8: governance/RISK_LIMITS.yaml, single ServiceEconomics shape
STATIC_RUNTIME_SEPARATION_COMPLETE=YES              — §II.1, §II.4, §II.6, §II.9: no overlay field can widen a static fact
PROTOCOL_EXPOSURE_MODEL_COMPLETE=YES                — §II.4, §II.16: capability/exposure/activation/admission/qualification
                                                       all separately typed and merged only via project()
VERSION_DOMAINS_UNAMBIGUOUS=YES                     — §II.2: eleven named namespaces, zero bare `version` fields
SECURITY_TRUTH_MODEL_COMPLETE=YES                   — §II.9: four levels, ACTIVE/VERIFIED type-unreachable from static model
ECONOMIC_TRUTH_MODEL_COMPLETE=YES                   — §II.8: four distinct price concepts, quote explicitly excluded from VCM
PROVENANCE_MODEL_COMPLETE=YES                       — §II.13: six-identifier rule from Authority Map §I.12 fully represented
DETERMINISTIC_DIGEST_MODEL_COMPLETE=YES             — §II.14: reuses frozen JCS/SHA-256 machinery, five scoped digests, none speculative
REGISTRY_TRANSITION_MODEL_COMPLETE=YES              — §II.15: legacyRegistryToVCM/vcmToLegacyRegistry, two-track field,
                                                       structural-equality parity law with an explicit byte-equality upgrade path
ALL_CURRENT_PROJECTIONS_DERIVABLE=YES               — §II.16: 0 MISSING_CANONICAL_FACT across all 7 surfaces
```

---

## II.P. Return Block

```
METADATA_VCM_02=PASS

VCM_ROOT_TYPE=VerifiedCanonicalMetadata
VCM_SCHEMA_VERSION_PROPOSAL=1.0.0

CANONICAL_SERVICE_ID_OWNER=registry/services/*.json (file-set-derived, per Authority Map §I.8)
CANONICAL_PRICING_POLICY_OWNER=governance/RISK_LIMITS.yaml (per Authority Map §I.7)

STATIC_RUNTIME_SEPARATION_COMPLETE=YES
RUNTIME_OVERLAY_MODEL=RuntimeStateOverlay { observedAt, deploymentVersion, routes[], economics[], security[], qualification[] }
EFFECTIVE_VIEW_MODEL=EffectiveMetadataView = project(CanonicalStaticModel, RuntimeStateOverlay)

CAPABILITY_EXPOSURE_ACTIVATION_MODEL=PASS
VERSION_NAMESPACE_MODEL=PASS
ECONOMIC_MODEL=PASS
SECURITY_MODEL=PASS
PROVENANCE_MODEL=PASS
DIGEST_MODEL=PASS

REGISTRY_MIGRATION=
IMPORT -> PARITY_PROOF -> AUTHORITY_INVERSION

PROJECTION_A2A=DERIVABLE_WITH_PROTOCOL_ADAPTER
PROJECTION_MCP=DERIVABLE_WITH_PROTOCOL_ADAPTER
PROJECTION_OPENAPI=DERIVABLE_WITH_PROTOCOL_ADAPTER
PROJECTION_X402=DERIVABLE_WITH_PROTOCOL_ADAPTER
PROJECTION_BAZAAR=DERIVABLE_WITH_PROTOCOL_ADAPTER
PROJECTION_NEVERMINED=FULLY_DERIVABLE
PROJECTION_CATALOG=FULLY_DERIVABLE

MISSING_CANONICAL_FACTS=0
UNRESOLVED_SCHEMA_DECISIONS=3
  (1) LifecycleState full ladder vs. governance/PROMOTION_STATES.yaml — only first four
      rungs plus one registry-observed value were read; reconcile exact ids before implementation.
  (2) LatencyClass — 'variable' confirmed observed, 'fast'/'slow' inferred; confirm full
      value set across all registry/services/*.json files before implementation.
  (3) AuthorizationClassification — 'public' confirmed, 'restricted' inferred as closed
      complement; confirm no third value exists before implementation.
  None of these block PASS: each is a mechanical, cheap verification against existing
  files, not an open design question, and each union is already closed pending that check.

DESIGN_ARTIFACT=
docs/reports/METADATA-VCM-02-schema-design.md

RUNTIME_SOURCE_CHANGES=0
METADATA_PROJECTION_CHANGES=0
PRODUCTION_MUTATIONS=0

SAFE_TO_IMPLEMENT_VCM=YES
```

---
---

# PART III — Machine-Mediated Discovery, Routing, and Conversion Optimization

*Source: `METADATA-VCM-03-machine-discovery-optimization.md`. Reproduced verbatim below; only the top status line and section anchors were adjusted for this merge.*

Status: design/research checkpoint. Zero runtime, metadata generator, registry, governance, pricing,
contract, CI, or production mutations made. No fields were added to `packages/vcm` (not yet created).

## III.0. Scope discipline

This report was commissioned with an explicit constraint: optimize exclusively for **machine-mediated**
outcomes (discovery, routing, selection, invocation, economic conversion, repeat use) — not human
marketing — and never fabricate a field or inflate a claim merely to satisfy a rubric. Every finding
below is tagged with an evidence tier:

- **VERIFIED** — a primary protocol source was read live in this session *and* the corresponding SITEBORNE
  source file was grepped in this session to confirm the current state.
- **SPEC-DOCUMENTED** — a primary protocol source was read live in this session; the SITEBORNE-side gap
  is taken from an earlier discovery agent's report (METADATA-AUTHORITY-01 inputs), not re-grepped here.
- **REASONED-INFERENCE** — established, widely-documented API/tool-design consensus, not tied to one
  fetched primary source in this session. Flagged explicitly so it is never mistaken for spec fact.
- **NOT INDEPENDENTLY VERIFIED** — attempted to reach a primary source and could not (dead link, JS wall,
  404). Named so a future pass knows exactly what's still open, instead of silently guessing.

Sources actually fetched live in this session:
- `modelcontextprotocol.io` — Build an MCP server; Tools (spec `2025-06-18` and `2026-07-28`)
- `raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol` — `schema/2025-06-18/schema.ts` (`ToolAnnotations`, `Tool` interfaces, verbatim)
- `anthropic.com/engineering/writing-tools-for-agents` (Sep 11, 2025)
- `a2a-protocol.org/latest/specification/` — full AgentCard/AgentSkill/AgentProvider/AgentCapabilities field tables, trust/signing sections
- `github.com/coinbase/x402` — README (protocol flow, scheme/network model, `description` field)
- Attempted, not reachable: `docs.cdp.coinbase.com/x402/core-concepts/discovery` (404) — **Bazaar-specific ranking/listing mechanics are NOT INDEPENDENTLY VERIFIED in this report.**

Repo files grepped live in this session for cross-check: `packages/protocol-a2a/src/card.ts`,
`packages/protocol-mcp/src/server.ts`.

---

## III.1. MCP — verified findings

### III.1.1 Tool annotations are explicitly untrusted hints, not a scoring input
`schema.ts` (verbatim, both spec versions carry the same doctrine):
> "ToolAnnotations are **hints**. They are not guaranteed to provide a faithful description of tool
> behavior... Clients should never make tool use decisions based on ToolAnnotations received from
> untrusted servers."

**Implication:** annotation completeness does not itself buy trust or ranking. The actual trust lever is
*server identity* (a client deciding SITEBORNE is a "trusted server" at all) — which routes back to signed,
verifiable provenance, not metadata richness. This reinforces rather than adds to the Authority Map's
existing emphasis on the A2A signing chain (§ MetadataRelease / provenance in VCM-02) as the real
trust-bearing artifact. **No new field proposed here** — this is a priority confirmation, not a gap.

### III.1.2 `openWorldHint` — VERIFIED gap, zero-risk truthful fix
`schema.ts`: `openWorldHint?: boolean` — *"If true, this tool may interact with an 'open world' of
external entities. If false, the tool's domain of interaction is closed... **Default: true**."*

Grep of `packages/protocol-mcp/src/server.ts:551,611,616,638` confirms `annotations` objects set
`readOnlyHint`, `destructiveHint`, `idempotentHint` but never `openWorldHint`. **By spec default, every
SITEBORNE MCP tool currently self-declares as open-world** (unpredictable domain of interaction) —
that is honest for `web_context_verified` (which fetches arbitrary web content) but **false** for
`company_evidence_graph`, `document_evidence_json`, and `verify_agent_output`, which query closed,
bounded internal sources. This is not an enhancement — it is a present *misstatement by omission*
relative to spec default, and correcting it is a pure truth fix with plausible routing-accuracy upside:
clients choosing between a closed, deterministic tool and an open-world one for a precision task can
only make that distinction if the flag is set correctly.

- **Proposed field:** `CanonicalInteraction.openWorldHint: boolean` (VCM-02 §II.6/CanonicalInteraction), value
  set per-service from actual data-source boundedness, not defaulted blindly to `false`.
- **Classification:** REQUIRED_NOW.

### III.1.3 Token-efficiency levers (Anthropic engineering post, Sep 2025) — SPEC-DOCUMENTED
Directly measured by Anthropic on their own tool suites:
- A `response_format` enum (`concise` / `detailed`) cut token cost to ~⅓ in their Slack-tool example,
  with no loss of capability — the concise path omits low-signal technical identifiers (UUIDs,
  `mime_type`) an agent doesn't need for the immediate step.
- Natural-language/semantic identifiers outperform opaque UUIDs for retrieval precision; a UUID should
  only appear in a response when it's needed to chain into a later tool call.
- Helpful, actionable error bodies (not opaque codes/tracebacks) measurably improved agent task
  completion in their evaluations.

None of these were re-verified against SITEBORNE's actual tool-response bodies or error payloads in this
session (would require reading `apps/edge-api` route handlers, out of this report's grep pass) — flagged
**REQUIRES_VERIFICATION**, not asserted as a gap. If SITEBORNE's evidence-graph/document tools return raw
UUIDs or opaque error codes today, that is the single highest-leverage, purely mechanical improvement
available, because it lowers real per-call token cost — which directly raises "invocation conversion"
and "repeat invocation rate" for any cost-aware routing agent, with no metadata claim involved at all
(it's an implementation change, not a VCM field).

- **Proposed field (only once implemented):** `CanonicalInteraction.supportedResponseVerbosity:
  ('concise'|'detailed')[]` — REQUIRED_FOR_KNOWN_PROJECTION, but the metadata must not be added ahead of
  the implementation; doing so would itself be exactly the kind of premature claim this report is
  constrained against.

### III.1.4 Contrastive Use-when/Do-not-use-when descriptions — already correct, do not dilute
Anthropic's own research names prompt-engineered tool descriptions as one of the highest-leverage,
directly-measured levers for tool-selection accuracy (cites a Claude 3.5 SWE-bench-Verified jump from
description refinement alone). SITEBORNE's MCP tools already carry this pattern
(`SERVICE_INPUT_DESCRIPTION_OVERRIDES`, confirmed in the original MCP discovery pass and reaffirmed in
Authority Map §I.10 as a "bounded, governed transform"). **No change proposed.** Flagging explicitly so a
future optimization pass doesn't accidentally regress this by over-templating it into something generic.

### III.1.5 `title`, `outputSchema` — already correct
`title` is populated per-tool (`server.ts:551,611,633`); `outputSchema` is sourced from
`packages/contracts` (per original MCP discovery). Both match documented MCP best practice. No action.

---

## III.2. A2A — verified findings

### III.2.1 There is no rating/score/trust field in the AgentCard schema — a negative finding worth stating plainly
The full field table for `AgentCard` (§4.4.1) and `AgentSkill` (§4.4.5) in the live 1.0.0 specification
contains: `name`, `description`, `supportedInterfaces`, `provider`, `version`, `documentationUrl`,
`capabilities`, `securitySchemes`, `securityRequirements`, `defaultInputModes`, `defaultOutputModes`,
`skills`, `signatures`, `iconUrl` (card level); `id`, `name`, `description`, `tags`, `examples`,
`inputModes`, `outputModes`, `securityRequirements` (skill level). **None of these is a reputation, star,
usage-count, or trust-score field.** Trust in A2A is structurally binary and out-of-band:
> "Clients verify at least one signature before trusting an Agent Card." / "Clients maintain a trusted
> key store for known agent providers."

There is no lever inside the AgentCard itself to raise a "score" — only (a) whether the card is validly
signed at all, and (b) whether the *client* already trusts that signing key, which is a relationship
SITEBORNE cannot self-declare into existence. This directly rules out a class of optimization the
original request implied might exist for A2A. The only thing worth doing here is making sure the signing
chain already designed in Authority Map / VCM-02 (`MetadataRelease.provenance`, A2A signing identity) is
real and verifiable — which is an existing tracked item, not a new one.

### III.2.2 `AgentSkill.examples` — VERIFIED gap
Spec: `examples` — *"Example prompts or scenarios that this skill can handle"* (optional, array of
string). Grep of `packages/protocol-a2a/src/card.ts:53` shows `examples: []` — present as a field,
populated empty for every skill. This is the single most concrete, zero-ambiguity, zero-fabrication-risk
addition in this whole report: real example prompts already exist as fixtures in the repo's own eval/test
suites (per the METADATA-VCM-02 discussion of eval/verification evidence) and can be surfaced verbatim —
not invented copy, actual prior successful invocations.

- **Proposed field:** `CanonicalInteraction.examplePrompts: string[]`, sourced only from real fixtures/eval
  transcripts, never authored fresh for the purpose of filling the field. Classification: REQUIRED_NOW.

### III.2.3 `AgentCard.iconUrl` — SPEC-DOCUMENTED gap, cosmetic only
Optional field, not found via grep in `card.ts`. Low priority — affects human-facing directory listings
more than machine routing. Classification: FUTURE_EXTENSION. Not worth VCM-02 schema churn on its own;
bundle with any future A2A projection-adapter pass.

### III.2.4 `AgentSkill.tags` — already correct, and is the one true "search index" lever A2A offers
Confirmed populated (earlier A2A/registry discovery: tags derived from `service.capabilities` +
`service.service_version`). Tags are the only field in the entire A2A schema with keyword-matching/index
semantics. The only real optimization available is **accuracy**, not volume — padding tags with
adjacent-but-untrue capability words would increase discovery hits at the cost of routing precision
(an agent matched on a tag it doesn't actually satisfy fails the task, which is worse for "repeat
invocation rate" than not being discovered at all). No change proposed; flagged as an explicit
anti-pattern in §III.5.

---

## III.3. x402 / Bazaar — partial findings

### III.3.1 `description` and scheme/network breadth — SPEC-DOCUMENTED, already correctly modeled
The x402 README frames the resource-level `description` field exactly like an MCP tool description
("what your endpoint does") and frames scheme/network breadth (`accepts: [...]`) as a pure
client-compatibility lever — more supported (scheme, network) pairs means more clients can transact
without a client-side adapter. SITEBORNE's actual support (`exact` on `eip155`+`solana`, `upto` on
`eip155` only, per the original OpenAPI/x402/pricing discovery) is already faithfully modeled in
VCM-02's `SchemeNetworkSupport`. **No schema change** — but an explicit warning belongs in §III.5: do not
advertise a (scheme, network) pair SITEBORNE cannot actually settle merely to widen a Bazaar listing's
apparent compatibility. A `PaymentRequirements` offer that fails at `/settle` is worse for
quote-to-payment conversion than never having offered it, and actively damages the facilitator-level
trust signal referenced in §III.1.1's logic (untrustworthy servers get deprioritized by rational clients).

### III.3.2 Bazaar-specific ranking/listing mechanics — NOT INDEPENDENTLY VERIFIED
`docs.cdp.coinbase.com/x402/core-concepts/discovery` returned 404 in this session; no other primary
source for Bazaar's actual listing/ranking algorithm was reached. **I am not going to assert what drives
Bazaar ranking** — doing so without a source would be exactly the fabrication this report is constrained
against. Recommend a dedicated follow-up pass against Bazaar's current discovery/listing API
documentation (or its OpenAPI spec, if published) before adding any Bazaar-specific VCM field.

---

## III.4. OpenAPI / LLM tool routers / search-indexing / autonomous purchasing agents — reasoned inference only

No primary source for a generalized, vendor-neutral "LLM tool router ranking algorithm" exists to fetch —
these are product-internal (LangChain, OpenAI function-calling, various agent frameworks) and not
publicly specified the way MCP/A2A/x402 are. What's stated here is REASONED-INFERENCE from established
OpenAPI/API-design consensus, not a verified spec passage:

- Stable, unique `operationId`s; a `summary`/`description` split (short label vs. full explanation);
  explicit 4xx/5xx response schemas; example values in schema — these are the standard inputs
  function-calling frameworks use to build their internal tool catalogs from an OpenAPI document.
  SITEBORNE's generator already produces hardcoded `operationId`s and reverse-engineered 400/402 shapes
  (per the original OpenAPI/x402/pricing discovery), so the mechanics are present.
- The one concrete, already-known item here: `/quotes/{service_id}` is marked
  `x-implementation-status: 'not_implemented'` in the generated OpenAPI. That is the *correct* honest
  choice over silently advertising a dead endpoint as live — a router scoring "completeness" will fairly
  score it down, and **the fix is to finish the implementation, not to touch the metadata.** This is
  already implicitly on the roadmap (MCP's `siteborne_get_quote` is live; the REST path lags it) — noted
  here as a genuine machine-conversion gap (a REST-only or OpenAPI-only consuming agent cannot get a
  quote today even though the capability exists), not as something to paper over.

No claims are made here about "search/indexing agents" or "autonomous purchasing agents" specifically —
no authoritative public spec for either was located in this session, and inventing plausible-sounding
criteria for them would violate the no-fabrication constraint. §III.6 proposes measuring real outcomes
against these instead of guessing at their internals.

---

## III.5. Explicit anti-patterns — kept out on purpose

These would plausibly raise a naive score and were deliberately excluded, consistent with the Authority
Map's existing truth invariants:

1. **No padded/adjacent A2A tags or MCP capability keywords.** Anthropic's own research shows ambiguous
   or overlapping tool descriptions *degrade* selection accuracy — the mechanism that would make padding
   "work" for discovery is the same mechanism that makes it fail at routing and execution.
2. **No `SecurityTruthLevel` set to `ACTIVE`/`VERIFIED` without fresh measured evidence.** Already
   structurally prevented by VCM-02's type split (static model literally cannot construct those values) —
   restated here because it is the single most tempting "score-raising" move a naive optimization pass
   could make, and MCP's own doctrine (§III.1.1) confirms untrusted self-declared claims don't even work as
   intended on sophisticated clients.
3. **No advertised x402/Bazaar scheme-network pair SITEBORNE cannot settle** (§III.3.1).
4. **No third-party review/star/usage aggregation inside canonical VCM** — already decided in Authority
   Map §I (external evidence is independent evidence about SITEBORNE, not a canonical VCM fact); reaffirmed
   here because "market data" research is exactly the kind of input that tempts conflating the two.
5. **No fabricated `examples`/`examplePrompts` content.** §III.2.2's fix only works if the prompts are drawn
   from real fixtures — invented "realistic-sounding" examples would be a claim about capability the
   service hasn't actually demonstrated, and AgentSkill.examples exists specifically to inform a client's
   routing decision; a misleading example there produces exactly the failure-to-execute outcome the whole
   framework exists to prevent.

---

## III.6. Measuring machine outcomes — proposed EVIDENCE-class overlay, not new claims

The request asks for success to be evaluated primarily as machine outcomes: discovery probability,
correct-routing probability, tool-selection accuracy, invocation conversion, quote-to-payment conversion,
execution success rate, repeat-invocation rate, trust/ranking score, latency-adjusted utility,
price-adjusted utility, expected revenue per discovery. None of these can be *declared* — they can only be
*measured*. Per VCM-02's existing sentinel pattern (`MeasuredOrUnmeasured<T>`), the correct home for this
is a new **operational, EVIDENCE-class** telemetry block attached to `RuntimeStateOverlay` — never the
static model, since these are facts *about* usage, not facts *about* capability:

```ts
interface MachineOutcomeTelemetry {
  windowStart: IsoTimestamp;
  windowEnd: IsoTimestamp;
  serviceId: CanonicalServiceIdValue;
  surface: ProtocolSurface;
  discoveryEvents: MeasuredOrUnmeasured<number>;        // card/tool-list fetched
  selectionEvents: MeasuredOrUnmeasured<number>;        // tool actually chosen among alternatives offered
  invocationEvents: MeasuredOrUnmeasured<number>;       // tool actually called
  quoteRequestEvents: MeasuredOrUnmeasured<number>;
  paymentSettledEvents: MeasuredOrUnmeasured<number>;
  executionSuccessEvents: MeasuredOrUnmeasured<number>;
  distinctRepeatCallers: MeasuredOrUnmeasured<number>;
  measurementSource: EvidenceRef;                       // where the counter actually comes from
}
```

Every field defaults to `UNMEASURED` until real instrumentation (edge-api access logs, x402 settlement
logs, MCP `tools/call` audit logging already required by spec §"Log tool usage for audit purposes")
produces a number. This satisfies the request's own framing — machine outcomes as the success
measure — without adding a single self-declared claim to the canonical, capability-bearing part of VCM.
Classification: REQUIRED_FOR_RUNTIME_TRUTH, scoped to the overlay only.

---

## III.7. Prioritized, truthful action list

| # | Action | Tier | Effort | VCM field | Risk |
|---|---|---|---|---|---|
| 1 | Set `openWorldHint` correctly per MCP tool (§III.1.2) | VERIFIED | trivial | `CanonicalInteraction.openWorldHint` | none — pure correction |
| 2 | Populate `AgentSkill.examples` from real fixtures (§III.2.2) | VERIFIED | small | `CanonicalInteraction.examplePrompts` | none if sourced from real usage |
| 3 | Verify tool responses use natural-language identifiers, not raw UUIDs, where not needed for chaining (§III.1.3) | REQUIRES_VERIFICATION | unknown until checked | none (implementation only) | none |
| 4 | Verify tool-call error bodies are actionable, not opaque codes (§III.1.3) | REQUIRES_VERIFICATION | unknown until checked | none (implementation only) | none |
| 5 | Add `iconUrl` to AgentCard (§III.2.3) | SPEC-DOCUMENTED | trivial | `OrganizationIdentity`/card projection | none |
| 6 | Implement `/quotes/{service_id}` REST parity with MCP's live `get_quote` (§III.4) | SPEC-DOCUMENTED | medium | none — closes an honesty-correct but conversion-costly gap | none |
| 7 | Implement `response_format` (concise/detailed) once justified by evidence of high token cost (§III.1.3) | SPEC-DOCUMENTED | medium | `CanonicalInteraction.supportedResponseVerbosity` (only after implementation) | none |
| 8 | Stand up `MachineOutcomeTelemetry` overlay instrumentation (§III.6) | design proposed here | medium | `RuntimeStateOverlay` extension | none — additive, all-UNMEASURED until real |
| 9 | Dedicated follow-up research pass on Bazaar discovery/ranking mechanics (§III.3.2) | blocked — source unreachable | small (research only) | none yet | none |

Items 1, 2, 5 require no implementation work beyond filling in already-existing, currently-empty or
currently-absent metadata fields with true values — they are the highest ratio of legitimate score
improvement to effort/risk in this entire report, specifically *because* they're corrections of
incomplete self-description, not new claims.

## III.8. Return

```
METADATA_VCM_03 = PASS (research/design checkpoint)
PRIMARY_SOURCES_FETCHED = 6 (MCP x3, Anthropic engineering blog, A2A spec, x402 README)
PRIMARY_SOURCES_UNREACHABLE = 1 (Coinbase x402/Bazaar discovery docs — flagged, not guessed)
VERIFIED_GAPS = 2 (openWorldHint omission, AgentSkill.examples empty)
SPEC_DOCUMENTED_ITEMS = 5
REQUIRES_VERIFICATION_ITEMS = 2 (response identifiers, error body shape — not checked this session)
FABRICATED_CLAIMS_INTRODUCED = 0
ANTI_PATTERNS_EXPLICITLY_REJECTED = 5
NEW_VCM_FIELDS_PROPOSED = 4 (openWorldHint, examplePrompts, iconUrl, MachineOutcomeTelemetry overlay)
MUTATIONS_MADE = 0
SAFE_TO_IMPLEMENT = YES, scoped strictly to items 1–2 and 5 immediately; items 3–4 require a verification
  pass before action; item 6 is an implementation task outside VCM; item 8 is additive/measurement-only;
  item 9 requires a follow-up research session.
```

---
---

# Master Synthesis & Status

Combined status across all three checkpoints, current as of this merge. No checkpoint's
findings are revised here — this section only aggregates their return blocks and states
the current actionable next step.

```
METADATA_AUTHORITY_01 = PASS   (Part I  — 7 authority classes, 35+ facts mapped, 4 fact
                                 families with confirmed live contradictions, registry
                                 role decision C→B, security truth law, migration sequence)
METADATA_VCM_02        = PASS   (Part II — VerifiedCanonicalMetadata root type, static/
                                 runtime/effective 3-layer model, 11 version namespaces,
                                 0 missing canonical facts across 7 projections, 5 scoped
                                 digests, registry transition + parity law)
METADATA_VCM_03        = PASS   (Part III — machine-discovery optimization research,
                                 2 verified truthful gaps, 5 anti-patterns explicitly
                                 rejected, 0 fabricated claims, outcome-telemetry design)

CUMULATIVE_RUNTIME_SOURCE_CHANGES    = 0
CUMULATIVE_METADATA_PROJECTION_CHANGES = 0
CUMULATIVE_PRODUCTION_MUTATIONS      = 0
PACKAGES_VCM_CREATED                 = NO

CANONICAL_REFERENCE_FOR_IMPLEMENTATION = docs/reports/METADATA-VCM-MASTER-canonical-reference.md (this file)
CHECKPOINT_RECORDS_PRESERVED_UNMODIFIED =
  docs/reports/METADATA-AUTHORITY-01-canonical-authority-map.md,
  docs/reports/METADATA-VCM-02-schema-design.md,
  docs/reports/METADATA-VCM-03-machine-discovery-optimization.md
```

**Open items carried forward from Part I** (not blocking, tracked for the next
implementation pass): exact mTLS capability/activation field enumeration (Part I §I.13);
whether `AGENT_CARD_SIGNING_PRIVATE_KEY` holds a live value (Part I §I.2, §I.13 — requires
a live Cloudflare platform query, out of reach from repo alone); confirming no live code
path reads `PROJECT_STATE.yaml`/`TASKS.yaml` before applying the `HISTORICAL_ONLY` banner
(Part I §I.9).

**Open items carried forward from Part II** (mechanical, cheap, not design blockers):
reconcile `LifecycleState`'s full ladder against `governance/PROMOTION_STATES.yaml`;
confirm `LatencyClass`'s full value set across all `registry/services/*.json` files;
confirm `AuthorizationClassification` has no third value beyond `public`/`restricted`.

**Open items carried forward from Part III**: verify tool response bodies use
natural-language identifiers rather than raw UUIDs where not needed for chaining, and
that error bodies are actionable (Part III §III.1.3, items 3–4); a follow-up research pass
on Bazaar's actual discovery/ranking mechanics once its docs are reachable (Part III §III.3.2,
item 9).

**Current actionable next step**: Part I §I.14 ("Migration Sequence") step 1 — build the
VCM compiler to prove byte/structural parity against the existing
`registry/services/*.json` files before any authority inversion, per Part II §II.15's
registry transition model. In parallel, Part III's items 1, 2, and 5 (§III.7) are
zero-risk, zero-dependency truthful corrections (`openWorldHint`, `AgentSkill.examples`,
`iconUrl`) that can be scheduled independently of the VCM compiler build-out, since they
are metadata-value corrections, not schema or architecture changes.

`packages/vcm` remains not created. No implementation is authorized by this merge; it
only consolidates the already-approved design record into one reference.

---

# Freeze Record

An external competitive-backtest review reported that the artifact it received ended
mid-Part I, after the Fact Authority Matrix, and withheld a freeze declaration until the
missing sections were restored and a digest recorded. The file on disk at
`docs/reports/METADATA-VCM-MASTER-canonical-reference.md` was checked against that claim
directly (line count, section-header enumeration, tail content) and found already
complete — all of Part I (§I.1–I.15 + Return Block), Part II (§II.1–II.19 + Return
Block), Part III (§III.0–III.8 + Return), and Master Synthesis & Status are present, in
that order, ending at the sentence above. The truncation the external review saw
happened in transit to that review (upload/paste size limit), not in this repository. No
content was reconstructed or restored; nothing below this line was present when the
digest was computed.

```
DOCUMENT_DIGEST_ALGORITHM = SHA-256, computed over the raw UTF-8 file bytes
DOCUMENT_DIGEST_SCOPE     = everything above this "Freeze Record" section
                            (byte offset 0 through the end of the line
                            "only consolidates the already-approved design record into one reference.")
DOCUMENT_BYTE_LENGTH      = 133032
DOCUMENT_LINE_COUNT       = 1978
DOCUMENT_DIGEST           = sha256:32b61aa5ab940f27900a78ffa6b468b66621d1b3aab6759827dc7cb207a87096
LINE_ENDINGS              = LF only, no CRLF
TRAILING_WHITESPACE       = none
FINAL_NEWLINE             = single, present
```

**Freeze declaration.** This digest identifies the exact revision of Parts I–III and
Master Synthesis that now serves as the frozen design authority for VCM implementation,
per the revised implementation sequence's step 1. Parts I–III are not to be edited in
place going forward; if a future review changes one of their decisions, that change is
recorded as a new dated addendum appended after this Freeze Record (or as a new
`METADATA-VCM-0N` checkpoint file cross-referenced from here), never as a silent edit to
the frozen text above — the same EVIDENCE-class discipline Part I §I.1 already applies to
every other record in this project.

This freeze covers the design record only. It does not freeze VCM implementation
schema forever: the additions identified in the current competitive review — a
protocol-neutral machine-routing vocabulary (primary intent, exclusion intents, subject
type, output artifact, side-effect class, idempotency, open-world behavior, caller-visible
error taxonomy, auth requirements, timeout/rate-limit policy, preferred generation,
supersession/deprecation, canonical tags, machine examples), Bazaar-native economic
projection fields, the `server/discover` proof chain, and external-evidence separation for
third-party quality signals (Bazaar call counts, Smithery `useCount`/score, Agenstry
uptime/trust, Glama TDQS) — are new design content, additive to this baseline. They belong
in a new checkpoint (e.g. `METADATA-VCM-04-machine-routing-and-bazaar-economics.md`) that
extends Parts I–III rather than rewrites them, keeping this digest meaningful as a stable
reference point. `packages/vcm` implementation should cite
`DOCUMENT_DIGEST = sha256:32b61aa5ab940f27900a78ffa6b468b66621d1b3aab6759827dc7cb207a87096`
as the baseline it was built against.

Cumulative status is otherwise unchanged from Master Synthesis & Status above: zero
runtime, metadata-projection, or production mutations; `packages/vcm` not created.
