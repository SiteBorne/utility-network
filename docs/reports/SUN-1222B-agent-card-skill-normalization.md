# SUN-1222B — Agent Card Skill Normalization

**Date:** 2026-09-01 **Scope:** repo-only. No deploy, no Cloudflare mutation,
no traffic change, no economic activity. Base HEAD: `bc0bef1`.

## 0. Symptom (as reported)

Agenstry's discovery listing showed 8 declared skills as 4 visually-identical
pairs:

- Company Evidence Graph ×2
- Verified Web Context ×2
- Document Evidence JSON ×2
- Agent Output Verification ×2

## 1. Root cause — PROVEN

`AGENT_SKILL_DUPLICATION_ROOT_CAUSE=PROVEN`

`packages/protocol-a2a/src/card.ts`'s `buildSkill()` set `AgentSkill.name` and
`.description` directly from the registry's `title`/`description`, and
`registry/services/*.v1.json` / `*.v2.json` carry **byte-identical**
`title`, `description`, and `capabilities` for all four families (verified by
direct diff of the 8 JSON files — 0 differences in any human-facing field).
This is intentional and documented: `constants.ts`'s own comment says v2 was
"added alongside v1" with "v1 remains frozen historical evidence, v2 is
additive" (SUN-1000 checkpoint 1M), and the four `registry-source.ts` v2
imports are commented "same economics, same schemas, only
service_id/service_version differ". So every v1/v2 pair produced two
`AgentSkill` objects with different `id`s but identical everything else a
human or a naive discovery UI renders — exactly the symptom observed.

**Before skill inventory** (`buildUnsignedSiteborneAgentCard()` output,
pre-fix):

| id | name | description |
| --- | --- | --- |
| `company_evidence_graph.v1` | Company Evidence Graph | Resolves and verifies canonical company identity, SEC submissions, XBRL facts, website evidence, regulatory mentions, and public repository signals into a structured evidence graph. |
| `company_evidence_graph.v2` | Company Evidence Graph | *(identical)* |
| `web_context_verified.v1` | Verified Web Context | Fetches and verifies web content from direct HTTP requests or browser-rendered pages, extracting structured data with cryptographic proof of retrieval and content integrity. |
| `web_context_verified.v2` | Verified Web Context | *(identical)* |
| `document_evidence_json.v1` | Document Evidence JSON | Processes documents (PDF, images, native text) through OCR, table extraction, and structured data extraction, producing verified JSON evidence with page-level provenance. |
| `document_evidence_json.v2` | Document Evidence JSON | *(identical)* |
| `verify_agent_output.v1` | Agent Output Verification | Verifies the output of another agent against provided criteria, performing independent reproduction and comparison to produce a verification receipt. |
| `verify_agent_output.v2` | Agent Output Verification | *(identical)* |

## 2. Are version-specific skill IDs contractual? — YES

`VERSION_SPECIFIC_SKILL_IDS_CONTRACTUAL=YES`

Traced every consumer of the full `<family>.v<n>` id (431 repo hits across
schemas, tests, contracts releases, docs); the load-bearing ones:

- **A2A dispatch itself**: `packages/protocol-a2a/src/executor.ts`'s
  `parseInvocation()` builds `SERVICE_ID_SET = new Set(SITEBORNE_SERVICE_IDS)`
  (the exact 8 ids) and rejects any `skillId` not in that set
  (`unknown_skill`); the accepted `skillId` is passed straight through to
  `boundary.execute(serviceId, ...)`. The version is not a separate
  parameter — it's encoded in the id a caller must send.
- **Input validation**: `inputValidators` in the same file is
  `Record<SiteborneServiceId, ValidateFunction>` — one compiled Ajv
  validator per id, selected by the same id.
- **Frozen contract releases**: `contracts/releases/{1.0.0,1.0.1,2.0.0}/`
  each version their own `metadata/*.v1.json` / `*.v2.json` and schema
  hashes independently.
- **`docs/contracts/VERSIONING.md`** codifies `.v1`/`.v2` as a "**stable
  public service-major identity**" where "breaking changes require a new
  service ID: `.v2`" — an explicit, permanent compatibility contract, not
  decorative metadata.
- Pricing, Nevermined registration, PCC receipts, and the x402 extension's
  own `services[]` array are all keyed by the same 8 ids.

Collapsing to 4 `AgentSkill` entries would have broken real A2A dispatch
(a caller sending `skillId: "verify_agent_output.v2"` would get
`unknown_skill`), not just cosmetics.

## 3. Semantic model selected

`SELECTED_AGENT_SKILL_MODEL=EIGHT_VERSION_SPECIFIC_DISTINGUISHED`

Per the decision rule ("semantic cleanliness must never break
interoperability"), all 8 skill declarations are retained. The installed
`@a2a-js/sdk@1.0.1` `AgentSkill` interface has exactly
`{ id, name, description, tags, examples, inputModes, outputModes,
securityRequirements }` — no `versions` field exists in the actual schema, so
none was invented. Instead, `buildSkill()` now derives a distinguishing
`name` and `description` per skill from the registry's own
`service_version` field:

```ts
name: `${service.title} (${versionLabel})`,   // "Company Evidence Graph (V1)"
description: `${service.description} SITEBORNE service contract major ` +
  `${service.service_version} -- see this id ("${service.service_id}") in ` +
  `this Agent Card's x402 extension params and the SITEBORNE service ` +
  'catalog/OpenAPI for its exact schema, pricing, and current production status.',
tags: [...service.capabilities, service.service_version],
```

The description addendum states only verifiably-true, static facts (the
service-contract major and the id itself) and points to this same card's
x402 `extensions[].params.services[]` array — which already carries the
dynamic per-id `productionEnabled`/pricing/schema data — rather than
duplicating those values into two separately-maintained places that could
drift.

**After skill inventory** (`buildUnsignedSiteborneAgentCard()` output,
post-fix; ordering unchanged, deterministic):

| id | name |
| --- | --- |
| `company_evidence_graph.v1` | Company Evidence Graph (V1) |
| `web_context_verified.v1` | Verified Web Context (V1) |
| `document_evidence_json.v1` | Document Evidence JSON (V1) |
| `verify_agent_output.v1` | Agent Output Verification (V1) |
| `company_evidence_graph.v2` | Company Evidence Graph (V2) |
| `web_context_verified.v2` | Verified Web Context (V2) |
| `document_evidence_json.v2` | Document Evidence JSON (V2) |
| `verify_agent_output.v2` | Agent Output Verification (V2) |

`CURRENT_SKILL_COUNT_BEFORE=8`, `CURRENT_SKILL_COUNT_AFTER=8`.

## 4. Version discovery model (Phase D)

No `AgentSkill.versions` extension field added. Both majors of each family
stay discoverable exactly the way they always were: through the distinct
`id` itself, the distinguishing `name`, the `tags` array (now also carrying
the literal `v1`/`v2` tag), the x402 extension's `services[]` entries
(`serviceId`, `serviceVersion`, schema URIs), the public service catalog, and
OpenAPI. `V1_DISCOVERABILITY=PASS`, `V2_DISCOVERABILITY=PASS` — proven by the
new regression test (§7) which requires a distinct, `family`-matching,
version-labeled skill entry for both majors of all four families.

## 5. A2A dispatch / signing / R1 / R2 non-regression

- `A2A_SCHEMA_VALIDATION=PASS` — `AgentCard`/`AgentSkill` shape unchanged
  (only string field content changed); `spec:verify`
  (`scripts/verify-spec-fixture.ts`) still reports `A2A spec baseline OK:
  @a2a-js/sdk@1.0.1, spec 1.0, JSONRPC`.
- `A2A_DISPATCH_REGRESSION=PASS` — `executor.ts` dispatches on `skill.id`,
  never `name`/`description`; untouched by this change.
  `apps/edge-api/tests/a2a-route.test.ts` (2 tests),
  `protocol.property.test.ts`'s "never dispatches an unsupported skill" and
  "keeps skill identity ... invariant" properties, and
  `apps/edge-api/tests/multi-service-discovery.test.ts` (25 tests) all pass
  unchanged.
- `AGENT_CARD_JWS_VALID=YES`, `SERVED_CARD_MATCHES_SIGNED_CONTENT=YES` —
  `protocol.property.test.ts`'s canonicalization/signature property tests
  (10 + 20 fast-check runs) pass against the new content; no golden
  signed-bytes fixture exists (signing is always computed fresh over
  whatever `buildUnsignedSiteborneAgentCard()` currently returns), so there
  was nothing to go stale. No key rotation performed.
- `AGENT_CARD_ORDER_DETERMINISTIC=YES` — `card.skills.map(s=>s.id)` still
  equals `SITEBORNE_SERVICE_IDS` in declared order (existing assertion,
  still passes); `protocol.property.test.ts`'s 25-run determinism property
  also passes.
- `R2_PRODUCTION_ENABLED_REGRESSION=PASS` — `buildX402ExtensionParams`
  (the SUN-1222B R2 fix) is untouched; `card.test.ts`'s existing
  "derives the top-level x402 productionEnabled from the per-service map"
  test still passes unmodified.
- `MCP_STATELESS_FIX_PRESERVED=YES`, `MCP_REGRESSION=PASS` — no MCP file
  touched; `protocol-mcp` test suite (33/33, part of the full run below)
  unaffected.
- `X402_NON_REGRESSION=PASS` — no pricing/`payTo`/network/asset/settlement
  code touched; `x402-service-route.test.ts` (36/36, including replay,
  concurrency, and duplicate-detection cases) passes unchanged.
- `DUPLICATE_SKILL_IDS=0`, `DUPLICATE_HUMAN_NAMES=0` (were 4 before this fix
  — proven via RED below).

## 6. TDD / RED-GREEN proof (§17)

Added to `packages/protocol-a2a/src/card.test.ts`:
`'gives every skill a unique human-facing name distinguishing its
service-contract major'` — asserts `new Set(names).size === names.length`,
same for descriptions, and that every family has a distinct, correctly
version-labeled `v1`/`v2` entry.

- **RED** (run against the pre-fix `buildSkill`):
  `expected 4 to be 8 // Object.is equality` — 8 skills collapsed to 4
  unique names. Genuinely executed, not narrated (`vitest run
  src/card.test.ts`, 1 failed / 2 passed).
- Implemented the `buildSkill` fix.
- **GREEN**: same command, 3/3 passed.
- Mutation proof: reverted `buildSkill` to the old `name: service.title` /
  `description: service.description` form, re-ran the new test — failed
  again identically (`expected 4 to be 8`), confirming the test actually
  exercises the fix rather than passing vacuously. Restored the fix.

`fixtures.test.ts`'s pre-existing exact-equality assertion
(`toMatchObject({ name: service.title, description: service.description })`)
was itself encoding the bug as "expected" behavior — updated to assert
containment/derivation (`skill.name` contains `service.title` and the
uppercased `service_version`; `skill.description` contains
`service.description` and the full `service_id`) so it still proves
traceability to the registry without re-asserting byte-for-byte identity.

## 7. Targeted verification

| Suite | Result |
| --- | --- |
| `packages/protocol-a2a` `pnpm run check` (format, lint, typecheck, test, test:property, fixtures:verify, spec:verify) | **PASS** — 46/46 unit tests, 6/6 property tests, fixture + spec baseline OK |
| `apps/edge-api` `a2a-route.test.ts`, `discovery-truthfulness.test.ts`, `multi-service-discovery.test.ts`, `network-metadata-consistency.test.ts`, `catalog-d1-wiring.test.ts` | **PASS** — 49/49 |

## 8. Full repository verification (§19)

Baseline for comparison: SUN-1222B checkpoint (`bc0bef1`) — 23/23
typecheck, 12/12 build, 16/16 lint, 215/215 test files (2596/2596
non-skipped tests, 74 intentional skips), wrangler dry-run clean, secret
scan 0 findings.

| Gate | Result |
| --- | --- |
| `turbo run typecheck` | **23/23 packages clean** |
| `turbo run build` | **12/12 clean** |
| `turbo run lint` | **16/16 clean** |
| `pnpm test` (repo-wide vitest) | **215/215 test files passed \| 22 skipped (237 total); 2597/2671 tests passed, 74 skipped** — one more passing test than the prior baseline (the new `card.test.ts` regression test), same skip count |
| `wrangler deploy --dry-run` (apps/edge-api) | **Clean** — 6315.25 KiB / gzip 1038.13 KiB, no deploy performed |
| `pnpm secrets:scan` (`gitleaks git .` + `gitleaks dir .`) | **9 pre-existing findings, unrelated to this change** — see §9 below |

## 9. Secret-scan findings — proven pre-existing, out of scope

`gitleaks dir .`/`gitleaks git .` reported 9 findings, none in any file this
subtask touched (`card.ts`, `card.test.ts`, `fixtures.test.ts` scan clean —
verified directly with `git diff` against a secret-pattern grep, 0 matches).
All 9 are one of two known false-positive classes already partially
allowlisted in `.gitleaks.toml`:

1. **Public on-chain contract/wallet addresses printed in forensic evidence
   reports** (`docs/reports/SUN-1221E2R-...`, `SUN-1220O-...`,
   `SUN-1221E6R-H2B2-...`) — e.g. `BASESCAN_TOKEN_CONTRACT =
   0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, Circle's well-known Base
   **mainnet** USDC contract, matched by gitleaks' `generic-api-key` rule
   purely on its position after an `=`/`:` — the exact same false-positive
   pattern `.gitleaks.toml` already allowlists one instance of (the Base
   **Sepolia** USDC address). The mainnet address was never added to that
   allowlist.
2. **`.dev.vars`** (gitignored, untracked — `git check-ignore -v .dev.vars`
   confirms; `git ls-files -- .dev.vars` returns nothing) — a local
   developer environment file that never enters git history, so it cannot
   leak via any commit or deploy.

All 3 doc-report files predate this session (`git log` shows their last
touch at `3984aff`, 2026-09-01 07:44 — hours before this checkpoint's base
HEAD `bc0bef1` at 16:18 the same day), so these are proven pre-existing, not
introduced or regressed by this subtask. Not fixed here — expanding
`.gitleaks.toml`'s allowlist is exactly the kind of unrelated,
broader-scope change §23/§27 direct against folding into this focused
commit. Flagged as the next concrete item for the P2 "secrets/configuration
exposure audit" backlog category (§21C).

## 10. Files changed

- `packages/protocol-a2a/src/card.ts` — `buildSkill()`: distinguishable
  per-version `name`/`description`/`tags`.
- `packages/protocol-a2a/src/card.test.ts` — new regression test (unique
  names/descriptions, both majors of all 4 families discoverable).
- `packages/protocol-a2a/src/fixtures.test.ts` — updated the
  now-intentionally-stale exact-equality assertion to containment.

## 11. Final packet

```
SUN1222B_AGENT_CARD_NORMALIZATION=PASS
AGENT_SKILL_DUPLICATION_ROOT_CAUSE=PROVEN
CURRENT_SKILL_COUNT_BEFORE=8
CURRENT_SKILL_COUNT_AFTER=8
SELECTED_AGENT_SKILL_MODEL=EIGHT_VERSION_SPECIFIC_DISTINGUISHED
VERSION_SPECIFIC_SKILL_IDS_CONTRACTUAL=YES
FOUR_SERVICE_FAMILIES_DISCOVERABLE=YES
V1_DISCOVERABILITY=PASS
V2_DISCOVERABILITY=PASS
A2A_SCHEMA_VALIDATION=PASS
A2A_DISPATCH_REGRESSION=PASS
AGENT_CARD_JWS_VALID=YES
SERVED_CARD_MATCHES_SIGNED_CONTENT=YES
AGENT_CARD_ORDER_DETERMINISTIC=YES
DUPLICATE_SKILL_IDS=0
DUPLICATE_HUMAN_NAMES=0
R2_PRODUCTION_ENABLED_REGRESSION=PASS
MCP_STATELESS_FIX_PRESERVED=YES
MCP_REGRESSION=PASS
X402_NON_REGRESSION=PASS
PRODUCTION_FLAGS_CHANGED=0
PRODUCTION_TRAFFIC_CHANGED=0
PRODUCTION_MUTATIONS=0
EXTERNAL_MUTATIONS=0
TESTS=215/215 files, 2597/2671 (74 intentional skips)
TYPECHECK=23/23
LINT=16/16
BUILD=12/12
SECRET_SCAN=9 pre-existing findings, proven unrelated (see §9); 0 new
EVIDENCE_REPORT=docs/reports/SUN-1222B-agent-card-skill-normalization.md
COMMIT_SHA=6c40111
WORKING_TREE=clean after commit
REMAINING_RISKS=(1) v1 skills for all 4 families and v2 for
  company_evidence_graph/document_evidence_json have no wired production
  executor at all (EFFECTIVE_DISCOVERY_RESOLVERS only covers
  verify_agent_output.v2/web_context_verified.v2) -- unrelated pre-existing
  state, correctly reflected today via each service's own x402
  productionEnabled, not something this subtask needed to change.
  (2) executor.ts's parseInvocation hardcodes `serviceVersion !== 'v1'` as
  invalid even when skillId targets a .v2 id -- appears to be inert legacy
  validation (skillId alone drives dispatch/schema selection) but was not
  investigated further as out of scope for Agent Card metadata; flag for a
  future A2A semantic-hardening pass (§21A).
  (3) gitleaks allowlist gap for the Base mainnet USDC address (§9).
NEXT_REPO_ONLY_HARDENING_AREA=B (x402 economic-path audit) or C
  (secrets/configuration exposure audit, given the gitleaks gap surfaced
  in §9) per your priority.
```
