# METADATA-AUTHORITY-01 — Canonical Authority Map and Projection Law

Status: design/evidence checkpoint. No runtime source, metadata generator, registry file,
governance YAML, contract, schema, CI config, or production configuration was modified to
produce this document. All claims below are cited to file paths; open questions are marked
`OPEN` rather than assumed.

---

## 1. Authority Class Taxonomy

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
see §9. This mismatch between *apparent* class and *actual* class is the single
largest source of the drift found in the discovery report.

---

## 2. Fact Authority Matrix

Columns: `FACT | AUTHORITY_CLASS | CURRENT_OWNER | CURRENT_DUPLICATES | PROPOSED_CANONICAL_OWNER | RUNTIME_OVERLAY_ALLOWED | PUBLIC_PROJECTIONS | DRIFT_GATE | MIGRATION_RISK`

| FACT | CLASS | CURRENT_OWNER | CURRENT_DUPLICATES | PROPOSED_CANONICAL_OWNER | OVERLAY? | PROJECTIONS | DRIFT_GATE | RISK |
|---|---|---|---|---|---|---|---|---|
| service_id | NORMATIVE | `registry/services/*.json` (`service_id` field) | `protocol-a2a/src/constants.ts:SITEBORNE_SERVICE_IDS`, `protocol-x402/src/bazaar/registry-source.ts:ALL_BAZAAR_SERVICE_IDS` (hand-written) | `registry/services/*.json` | No | A2A, MCP, OpenAPI, x402, Bazaar, catalog | IDENTITY_DRIFT (error) | Low — both arrays currently agree; risk is silent future divergence |
| service_family | NORMATIVE | `registry/services/*.json` filename stem | none observed | same | No | all | IDENTITY_DRIFT | Low |
| service_generation (.v1/.v2) | NORMATIVE | `registry/services/*.json:service_version` | contract-release directory names implicitly encode it | same | No | all | VERSION_DRIFT | Low — see §4 permanence rule |
| title | NORMATIVE | `registry/services/*.json:title` | none found (MCP/A2A pull from registry at build time per discovery) | same | No | all | IDENTITY_DRIFT | Low |
| description (canonical) | NORMATIVE | `registry/services/*.json:description` | `server.ts:SERVICE_INPUT_DESCRIPTION_OVERRIDES` is a **deliberate per-protocol rewrite**, not a duplicate — see §10 | same, with MCP override treated as a governed projection transform | No (base fact); Yes (routing-language transform, bounded — §10) | all | IDENTITY_DRIFT if base text diverges from registry unintentionally | Medium — need a rule distinguishing "intentional protocol-specific phrasing" from "accidental duplication" (see §10) |
| routing description (MCP contrastive use-when/do-not-use-when text) | DERIVED (from description + capability + lifecycle) | hand-authored per-tool in `server.ts` | none | keep hand-authored today; mark as future DERIVED target once VCM exists | No | MCP only | CAPABILITY_DRIFT if routing text claims a capability the registry doesn't declare | Low |
| lifecycle state | NORMATIVE | `registry/services/*.json:promotion_state` | `governance/PROMOTION_STATES.yaml` defines the *ladder*, not the per-service value | same | No | catalog, A2A extensions | ACTIVATION_DRIFT | Low |
| input_schema / output_schema | NORMATIVE | `registry/services/*.json:{input,output}_schema_uri` + `_hash`; actual schema bodies in `schemas/services/` | `packages/contracts` Zod types are a **separate, independently-authored schema layer** used by the OpenAPI generator (discovery finding: generator reads `schemas/services/`, not Zod) | `schemas/services/*.schema.json` as the single schema-body source; registry hash pins it; Zod types must be generated from or CI-diffed against it, not hand-maintained in parallel | No | A2A, MCP, OpenAPI, x402 | SCHEMA_DRIFT (error, build-blocking) | **High** — two independently hand-written schema representations (JSON Schema vs Zod) is the riskiest duplication in the system today |
| input_uri / output_uri | NORMATIVE | `registry/services/*.json` | discovery noted per-service/version hand-duplication in a `frozen-contracts.ts`-style file | registry | No | OpenAPI, catalog | SCHEMA_DRIFT | Low |
| protocol exposure: A2A | NORMATIVE (declares intent) + OPERATIONAL (actual wiring) | `registry/services/*.json:protocols.a2a` currently `"planned"` for **all** services, while `protocol-a2a` code demonstrably implements them | code (skill registration in the A2A package) is ground truth today; registry field is stale | registry field, kept in CI-sync with code's actual tool/skill registration list | Yes — runtime may report a route as un-deployed even if code exposes it | A2A card | EXPOSURE_DRIFT (currently **active**, not hypothetical — see §3 worked example) | **High** — this field is already wrong today |
| protocol exposure: MCP | same pattern | `registry/services/*.json:protocols.mcp = "planned"` vs. 6 live tools in `packages/protocol-mcp/src/server.ts` | same | same | Yes | MCP tool list | EXPOSURE_DRIFT | **High** — already wrong today |
| protocol exposure: OpenAPI | NORMATIVE | `registry/services/*.json:protocols` has no OpenAPI key; generator (`packages/pcc-schema/scripts/generate-openapi.ts`) independently decides what to emit | add an explicit `openapi` key to the protocols block | Yes | OpenAPI doc | EXPOSURE_DRIFT | Medium |
| protocol exposure: x402 | NORMATIVE + OPERATIONAL | `registry/services/*.json:protocols.x402 = "planned"` vs. live `buildQuote()`/402 flow in `apps/edge-api/.../x402-service.ts` | same as A2A/MCP | same | Yes | x402 discovery, Bazaar | EXPOSURE_DRIFT | **High** |
| protocol exposure: Bazaar | NORMATIVE | `registry/services/*.json:protocols.coinbase_bazaar` | `protocol-x402/src/bazaar/discovery.ts` fixtures use sentinel values (`'0xUSDC'`, `PAYTO_NOT_CONFIGURED`) when real data is absent — this is a *placeholder-handling* mechanism, not a duplicate authority | registry | Yes | Bazaar | EXPOSURE_DRIFT | Medium |
| protocol exposure: Nevermined | NORMATIVE | `registry/services/*.json:protocols.nevermined = "planned"` | `NEVERMINED_ROUTES_ENABLED` env gate exists in `env.ts` with no corresponding implemented route found | registry (capability) + env gate (activation) | Yes | Nevermined | EXPOSURE_DRIFT / STALE_STATE_VIEW | Low (appears genuinely not implemented, so "planned" is accurate here — contrast with MCP/A2A/x402 above) |
| capability availability per protocol surface | see §3 model | scattered (see rows above) | — | VCM capability/exposure/activation triple (§3) | Yes | all | CAPABILITY_DRIFT, EXPOSURE_DRIFT, ACTIVATION_DRIFT (three distinct gates, not one) | High until §3 model is adopted |
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
| PCC schema-release version (`pcc_dependency.schema_release`) | EVIDENCE (per contract release) | `contracts/releases/2.0.0/CONTRACT_RELEASE.yaml:pcc_dependency.schema_release = '1.1.0'` | none — this is a **distinct namespace**, not a duplicate of `pcc_version` (see §4) | contract-release file | No | release manifests | RELEASE_DIGEST_DRIFT | Low — namespace already correctly separated, just undocumented until now |
| contract-release version | EVIDENCE | `contracts/releases/{1.0.0,1.0.1,2.0.0}/CONTRACT_RELEASE.yaml` | `PROJECT_STATE.yaml:service_contract_release.version` claims `1.0.0` — **stale**, actual normative release is `2.0.0` | `contracts/releases/*/CONTRACT_RELEASE.yaml`, "latest" = highest non-historical entry | No | all | RELEASE_DIGEST_DRIFT / STALE_STATE_VIEW | **High** — confirmed live drift |
| signing capability (code exists) | NORMATIVE | `packages/protocol-a2a/src/signing.ts:createConfiguredA2aSigningIdentity` | none | same | No | none directly | — | Low |
| signing activation (key provisioned) | OPERATIONAL | Cloudflare Worker secret `AGENT_CARD_SIGNING_PRIVATE_KEY`, declared in `wrangler.toml` as a secret binding, value not in repo | `PROJECT_STATE.yaml` implicitly claims this is *not* done (understates it) — see §13 truth-level model | live secret store | N/A | A2A card, only if §13 evidence bar is met | **Unverifiable from repo** — flagged `OPEN` |
| key id | NORMATIVE (name) + OPERATIONAL (which one is active) | `wrangler.toml:AGENT_CARD_SIGNING_KEY_ID` (plaintext var, names the *expected* active key) vs. `signing.ts:LOCAL_A2A_SIGNING_KEY_ID` (hardcoded ephemeral fallback id, always available) | not a duplicate — two different identities for two different truth levels (configured vs. ephemeral) | keep separate; never merge | N/A | A2A card `kid` | ACTIVATION_DRIFT if card claims the configured kid while actually signing with the ephemeral one | Medium — this is exactly the failure mode §13 exists to prevent |
| JWKS URI | NORMATIVE | `packages/protocol-a2a/src/signing.ts:SITEBORNE_A2A_JWKS_URL` | none | same | No | A2A card | SECURITY_CLAIM_DRIFT | Low |
| security scheme / mTLS declaration | NORMATIVE (declared) + OPERATIONAL (live) | `apps/edge-api/.../mtls-production-capability.ts` (capability), env gates (activation) — `OPEN`: exact file/field not yet fully enumerated in this pass | same split as signing | same | N/A | any surface asserting mTLS | SECURITY_CLAIM_DRIFT | Needs a follow-up pass before VCM implements the security section — flagged `OPEN`, not blocking this checkpoint |
| public origin | NORMATIVE | `wrangler.toml` / edge-api route config | none observed | same | Yes (staging vs prod origin differs operationally) | all | — | Low |
| MCP protocol version | NORMATIVE | literal `'2026-07-28'` in `packages/protocol-mcp/src/server.ts` (discovery noted it appears in multiple places as a literal, not all deriving from one constant) | itself, repeated | promote to a single exported constant | No | MCP | VERSION_DRIFT | Low effort, currently a latent risk |
| x402 protocol version | NORMATIVE | `@x402/core` package's exported `x402Version` constant (`= 2`), pinned via `x402-spec-baseline.json` at `2.21.0` | none | `@x402/core` (external dependency, pinned) | No | x402, Bazaar | VERSION_DRIFT | Low |
| release hash / schema digest / projection digest | EVIDENCE | `contracts/releases/*/CONTRACT_RELEASE.yaml` hashes schema bodies; **no digest currently exists for generated projections themselves** (OpenAPI doc, Agent Card, MCP tool list) | none | new: VCM must generate and record projection digests | No | release manifest | RELEASE_DIGEST_DRIFT | New capability — this is the biggest genuine gap, not a duplication |
| deployment identifier | OPERATIONAL | Cloudflare Worker version id (platform-assigned, not in repo) | git commit SHA is a *different* identifier (source, not deployment) | live platform metadata | N/A | release attestation only | RELEASE_DIGEST_DRIFT if conflated with source commit | Low if kept separate (see §12) |
| qualification status | EVIDENCE | `governance/PROMOTION_STATES.yaml` (ladder definition) + per-service `promotion_state` in registry (current rung) | none | registry field, ladder in governance file | No | catalog | ACTIVATION_DRIFT | Low |

**Summary counts** (feeding §P):
- Facts with **multiple current authorities actively disagreeing today**: 5 — protocol exposure ×4 (A2A, MCP, x402, and implicitly Bazaar via the same `protocols` block), pricing (3-way), contract-release version, production_enabled/production_ready, and PCC-schema-vs-release version pairing *once misread as one namespace* (it's actually not drift, see §4, so it is **not** counted). Recount precisely: **protocol exposure (1 fact family, 4 surfaces), pricing (1), contract-release version (1), production_ready/production_enabled (1)** = **4 fact families** with confirmed live contradiction, expanding to **7 individual matrix rows** if each protocol surface is counted separately.
- Facts with **no clear current authority**: 3 — `pricing_policy_version` (doesn't exist yet), `openapi` key in the protocols block (doesn't exist yet), projection/digest hashing for generated surfaces (doesn't exist yet).

---

## 3. Capability / Exposure / Activation / Admission / Qualification State Model

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

## 4. Version Namespace Map

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
| metadata projection version / digest | does not exist yet (§2 gap) | — | future VCM release tooling | Every regeneration of a public projection |
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

## 5. Static-Model / Runtime-Overlay Law

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
  `OPEN`, unverifiable from repo, see §13)
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

## 6. `registry/services/*.json` — Canonical Role Decision

Three architectures evaluated as instructed, without forcing the expected conclusion:

**A. Registry remains canonical; VCM wraps/imports it.**
- Blast radius: near zero initially.
- Reproducibility: good — registry files are already versioned JSON.
- Problem: registry is demonstrably **already wrong** for protocol exposure today
  (`protocols.{a2a,mcp,x402}` all read `"planned"` while code shows all three implemented
  and live — §2 row "protocol exposure"). Wrapping a source that's already drifted from
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

## 7. Pricing Authority Decision

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
(`PROJECT_STATE.yaml`, itself being retired per §9).

`registry/services/*.json:{base_price,maximum_price}` is `LIST_PRICE`, a separate,
legitimately-independent fact — but it must be validated `LIST_PRICE ≤ MAX_PRICE` at
build time, which does not currently happen anywhere observed.

New field required: `pricing_policy_version`, owned by `governance/RISK_LIMITS.yaml`,
carried by every projection that states a price (x402 discovery, Bazaar, catalog, OpenAPI
schema examples) so a consumer can tell which governed pricing generation a quoted number
came from.

`PRICING_CANONICAL_OWNER = governance/RISK_LIMITS.yaml`

---

## 8. Identity / Service-ID Authority Decision

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

## 9. `PROJECT_STATE.yaml` / `TASKS.yaml` Disposition

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
| pricing block | Frozen historical value; live truth is `governance/RISK_LIMITS.yaml` (§7) |
| `current_increment` / `last_completed_increment` | Frozen historical value; live truth is git history + `docs/reports/` |

`PROJECT_STATE_DISPOSITION = HISTORICAL_ONLY`
`TASKS_DISPOSITION = HISTORICAL_ONLY`

---

## 10. Projection Law Per Protocol

| Surface | Source facts | Transformations allowed | Transformations forbidden | Runtime overlay used | Digest generated | Validation required |
|---|---|---|---|---|---|---|
| **Agent Card / A2A** | identity, description, schemas, protocol-exposure(a2a), security(signing), pricing | field renaming to A2A's vocabulary (`skills`, `capabilities` shape); adding A2A-specific envelope (protocol version, JWKS pointer) | inventing a skill not backed by `CAPABILITY_EXISTS`; claiming `active` signing without §13 evidence | Yes — signing activation, key id | Yes (future) | Schema-valid A2A card + signature verifies against declared JWKS |
| **MCP** | identity, description (+ governed routing-language transform, see below), schemas, protocol-exposure(mcp), pricing | contrastive "Use when/Do not use when" routing text **is a bounded, governed transform**: it may rephrase but must not assert a capability, price, or lifecycle state absent from the base facts; annotation hints (`readOnlyHint`/`destructiveHint`/`idempotentHint`) are DERIVED from lifecycle+economic facts, not independently authored per tool | inventing a tool not backed by `CAPABILITY_EXISTS`; a routing description implying a capability the base description doesn't declare | Yes — `runtime_enabled` surfaces via `siteborne_get_service_health`, not by silently removing a tool | Yes (future) | Tool list matches registry-derived service set 1:1 |
| **OpenAPI** | identity, schemas, protocol-exposure(openapi/rest) | operationId derivation, HTTP envelope (status codes, error shapes) — must be generated from the actual route implementation (`x402-service.ts`) as discovery found, not guessed | describing a path as implemented when `PROTOCOL_EXPOSED(rest)=NO` for that exact shape (must use `x-implementation-status` honestly, as the existing `/quotes/{service_id}` annotation already correctly does) | Yes — could add a runtime status extension field | Yes (future) | Schema $refs resolve; generated doc validates against OpenAPI 3.x meta-schema |
| **x402 discovery / economic metadata** | pricing, settlement currency/asset/network, payment scheme, protocol-exposure(x402) | envelope required by x402 spec (scheme/network arrays) | fabricating a `payTo` or asset when `RUNTIME_ENABLED=false`/unconfigured (must use the sentinel pattern already in `discovery.ts`, not a plausible-looking fake value) | Yes — payTo, asset, network are all live-resolved | Yes (future) | Matches `packages/protocol-x402/src/network/schemes.ts` support matrix exactly |
| **Bazaar** | same as x402 discovery | Bazaar-specific listing envelope | same as x402 | Yes | Yes (future) | — |
| **Nevermined** | identity, protocol-exposure(nevermined) | minimal — surface appears genuinely `"planned"` (§2), not yet implemented | claiming any capability beyond what's implemented | N/A yet | N/A yet | — |
| **catalog** | identity, lifecycle state, pricing (list), protocol-exposure summary | human-readable formatting | any economic/security claim beyond what other surfaces assert | Yes — lifecycle/enablement | Yes (future) | Cross-checked 1:1 against registry file set |
| **PCC references** | `pcc_version`, `pcc_dependency.schema_release` | none — these are cited verbatim, never rephrased | conflating the two namespaces (§4) | No | Already covered by receipt signature | Receipt schema validation |

General rule (directive §J, confirmed): projections may rename fields, omit unsupported
fields, and add protocol-specific envelope data; they may **never** independently redefine
identity, pricing, schema, lifecycle, or economic/security semantics. The one case that
looks like an exception — MCP's routing-language rewrite — is deliberately scoped above
as a *bounded* transform (rephrasing allowed, new claims not) rather than an exemption
from the rule.

---

## 11. Contradiction Taxonomy

| Class | Example found in this repo | Severity | Blocks build | Blocks CI | Blocks candidate creation | Blocks deployment | Blocks public-contract freeze |
|---|---|---|---|---|---|---|---|
| IDENTITY_DRIFT | (none currently active; latent risk from dual service-id arrays, §8) | ERROR | Yes | Yes | Yes | Yes | Yes |
| VERSION_DRIFT | MCP protocol-version literal repeated instead of one constant (§4) | WARNING | No | Yes | No | No | Yes |
| SCHEMA_DRIFT | JSON Schema (`schemas/services/`) vs. Zod (`packages/contracts`) independently hand-authored (§2) | ERROR | Yes | Yes | Yes | Yes | Yes |
| PRICE_DRIFT | `PROJECT_STATE.yaml` missing 6 `_v2` prices present in `RISK_LIMITS.yaml`/`service-prices.ts`; registry `base_price`/`maximum_price` never cross-checked against `RISK_LIMITS.yaml` (§2, §7) | ERROR | Yes | Yes | Yes | Yes | Yes |
| CAPABILITY_DRIFT | none confirmed active; the `get_quote` case (§3) resolved to **not** a capability drift | ERROR | Yes | Yes | Yes | Yes | Yes |
| EXPOSURE_DRIFT | registry `protocols.{a2a,mcp,x402}` all `"planned"` while live code implements all three (§2, §6) | ERROR (already active, not hypothetical) | No | Yes | Yes | No (doesn't block current live deployment, which doesn't read this field for gating) | Yes |
| ACTIVATION_DRIFT | `production_ready`/`production_enabled` static claims vs. live `env.ts` gate reality (§2, §9) | ERROR for any *public claim*; INFORMATIONAL for the frozen historical file itself once labeled per §9 | No | Yes (for any live-facing projection) | Yes | No | Yes |
| ECONOMIC_DRIFT | none confirmed active; `payTo`/asset resolution verified consistent (§2) | ERROR | Yes | Yes | Yes | Yes | Yes |
| SECURITY_CLAIM_DRIFT | latent risk: A2A card could claim the configured `kid` while actually signing with the ephemeral fallback if not gated per §13 | ERROR | Yes | Yes | Yes | Yes | Yes |
| RELEASE_DIGEST_DRIFT | no projection digesting exists yet (§2) — currently this is a **gap**, not yet a drift, but will become detectable/blocking once VCM introduces digests | INFORMATIONAL today → ERROR once digesting exists | No today | No today → Yes later | No today → Yes later | No | Yes once it exists |
| STALE_STATE_VIEW | `PROJECT_STATE.yaml`, `TASKS.yaml` (§9) | WARNING (once correctly labeled HISTORICAL per §9); ERROR if any of these fields is read by a live process (`OPEN`, needs verification) | No | Yes (a lint step should flag any code that reads these files as a live source) | No | No | No |

---

## 12. Release / Evidence Authority

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

## 13. Security Metadata Truth Law

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

## 14. Migration Sequence

Non-binding sequencing sketch only — no implementation authorized by this checkpoint.

1. **Prove parity, change nothing else**: build the VCM compiler to read
   `registry/services/*.json` + `schemas/services/` + `governance/RISK_LIMITS.yaml` and
   regenerate byte-identical `registry/services/*.json` output (§6 option C, step 1).
2. **Fix the two confirmed-live drifts as separately reviewed diffs**, not silently inside
   the VCM cutover: (a) registry `protocols` block for A2A/MCP/x402 flipped from
   `"planned"` to accurate live values, generated from actual code registration; (b)
   registry `base_price`/`maximum_price` validated against `RISK_LIMITS.yaml` and any
   disagreement resolved by a human, not auto-overwritten.
3. **Collapse the schema duplication** (§2 highest-risk row): make Zod types in
   `packages/contracts` generated from `schemas/services/*.schema.json`, or add a CI diff
   gate if generation isn't feasible yet.
4. **Introduce `pricing_policy_version`** and wire it through every pricing-bearing
   projection.
5. **Generate `SITEBORNE_SERVICE_IDS`/`ALL_BAZAAR_SERVICE_IDS`** from the registry file
   set instead of hand-authoring both.
6. **Add the capability/exposure/activation triple (§3)** to every projection that
   currently uses a single `available`-shaped boolean.
7. **Add projection digests** (§2, §12 gap) once the above are stable.
8. **Add the live-query mechanism for security ACTIVE-level truth (§13)** and gate all
   security claims in projections behind it.
9. **Only then** invert registry authority to VCM-generated (§6 option C, step 2) and
   apply the `PROJECT_STATE.yaml`/`TASKS.yaml` `HISTORICAL_ONLY` banner (§9).
10. AVUF/DID/ERC-8004 remain explicitly out of critical path throughout (per original
    directive constraint); VCM's compiler design should not preclude AVUF later producing
    a Candidate VCM through the same compiler, but no AVUF-specific code is introduced now.

---

## 15. Explicit Invariants

```
✓ ONE normative owner per fact                          — enforced by §2 matrix; §2's
                                                            highest-risk violation (schema
                                                            dual-authorship) is flagged for
                                                            §14 step 3, not silently accepted.
✓ MANY generated projections allowed                     — §10.
✓ ZERO projection-specific redefinition of canonical facts — §10 forbidden-transforms columns.
✓ runtime state may narrow static capability              — §5.
✓ runtime state may never fabricate capability             — §5, worked example §3.
✓ security metadata claims only what evidence proves       — §13 four-level law.
✓ economic metadata claims only what governed state allows — §7, §2 pricing rows.
✓ v1/v2 identities remain stable                           — §4, §8 (no deprecation
                                                            relationship introduced).
✓ current public contracts remain byte/semantically compatible during migration
  unless a separately governed contract change is approved — §14 step 1 (parity-first),
                                                            step 2 (drift fixes as their
                                                            own reviewed diffs, not bundled
                                                            into the cutover).
```

---

## P. Return Block

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
                 after §6 transitional parity proof

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
enumeration (§13); whether `AGENT_CARD_SIGNING_PRIVATE_KEY` holds a live value
(§2, §13 — requires live platform query, out of reach from repo alone); confirming
no live code path reads `PROJECT_STATE.yaml`/`TASKS.yaml` before applying the
`HISTORICAL_ONLY` banner (§9).

Stopping here per instruction. VCM implementation not started.
