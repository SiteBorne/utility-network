# SUN-1000 Checkpoint 1L — Service-Major v2 Coexistence Migration Plan

**Status:** Migration planning only. Zero runtime, contract, dependency,
service-ID, or provider mutation. **HEAD at start and end:** `d503ef6`
(unchanged — this checkpoint adds only this report and `TASKS.yaml` evidence).

---

## 1. Baseline

- `git status --short`: empty. `git rev-parse --short HEAD`: `d503ef6`.
- `pnpm check`: exit 0 (full chain green).
- `pnpm security:semgrep`: PASS, 0 findings (498 files, 50 rules).
- `pnpm security:osv`: PASS, CRITICAL=0 (57 total, all with fixes, none CRITICAL
  — consistent with the accepted post-1E/1G state).
- `pnpm security:trivy`: **BLOCKED_EXTERNAL**, HIGH=3 (unchanged — the
  Traceloop/OpenTelemetry upstream-release blocker from checkpoint 1H).
- `pnpm security:schemathesis`: **FAIL_INTERNAL**, 12 findings, all
  `response_schema_conformance` violations against `StructuredError` on the
  400/402 responses — exclusively defect B, exactly as expected after checkpoint
  1K-A.
- `pnpm secrets:scan`, `pnpm governance:validate` (77/77), `pnpm state:validate`
  (30/30), `pnpm tasks:validate` (252/252): all PASS.

No result deviates from the expected pre-1L state. Nothing was mutated to
improve any of these.

## 2. Freeze 1K-B governance (not reopened)

`error_contract_changed` remains classified **major**, Parallel Major Required
remains **YES**, and — per `COMPATIBILITY_POLICY.md` §3.3/§12 — a major service
change requires a new public service-major identifier. All four affected
services (`company_evidence_graph`, `web_context_verified`,
`document_evidence_json`, `verify_agent_output`) require `.v2`. This checkpoint
answers **how**, not **whether**.

## 3. Version-axis map

| Axis                     | Current            | Future                                                                                                                                                                                    |
| ------------------------ | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Service Contract Release | 1.0.1              | 2.0.0                                                                                                                                                                                     |
| Service API Versions     | `.v1` (4 services) | parallel `.v2` (4 services) introduced; `.v1` frozen historical (§5)                                                                                                                      |
| PCC Schema Release       | 1.0.1              | **1.0.2 required** — see §15, a genuine discovery this checkpoint, not the "unchanged unless explicitly required" default                                                                 |
| PCC Document Version     | 1.0.0              | unchanged (content-compatibility version carried in signed receipts; not affected by adding a new closed-enum member's _availability_, only by changing what a receipt's own fields mean) |
| Package versions (npm)   | independent        | independent, not entangled with any of the above                                                                                                                                          |

These four axes are tracked independently throughout this plan; no step below
conflates them.

## 4. v1 preservation requirements

Inventoried every frozen artifact/evidence tied to `.v1`:

| Artifact class               | Location                                                                                                      | Preservation requirement                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Service contracts/schemas    | `contracts/releases/1.0.0/`, `contracts/releases/1.0.1/`                                                      | Frozen, read-only, `baseline:verify`-checked forever. Not touched by 2.0.0.                                                                              |
| Pricing declarations         | `registry/services/*.v1.json`                                                                                 | Frozen files remain; new `*.v2.json` files are additive, not replacements.                                                                               |
| x402 declarations            | `paid-services.ts`, `bazaar/registry-source.ts`, `bazaar/discovery.ts`                                        | v1 route-building code and its declarations remain in the tree as historical/tested code; not deleted.                                                   |
| Nevermined agents/plans      | `protocol-nevermined/src/declarations.ts` (`siteborne:{serviceId}:agent`/`:payg`, keyed by full `.v1` string) | Real sandbox registrations already accepted (SUN-0900B) — external Nevermined-side resources, cannot be renamed or reused; remain exactly as registered. |
| D1 historical rows           | `payment_attempts`, `x402_quotes`, `jobs`, etc.                                                               | No rewriting; `service_id` is a free-text `TEXT` column (§13) — old rows keep their literal `.v1` values undisturbed by any future migration.            |
| Payment-Identifier bindings  | `payment_attempts.payment_identifier` (globally unique, §14)                                                  | Untouched; new v2 traffic mints new identifiers under the same global-uniqueness rule.                                                                   |
| UsageResult / receipts / PSL | TS-typed only (`protocol-x402`, `protocol-nevermined`) — no JSON Schema                                       | Historical values retain their literal `.v1` `service_id`; not reinterpreted.                                                                            |
| MCP tools                    | `protocol-mcp/src/constants.ts` (`MCP_SERVICE_TOOLS`)                                                         | Historical protocol evidence (checkpoint tests) preserved; live tool→service mapping is a forward-looking decision (§16).                                |
| A2A skills/Agent Card        | `protocol-a2a/src/card.ts`                                                                                    | Historical fixtures/tests preserved; live Agent Card generation is forward-looking (§17).                                                                |
| Registration fixtures/tests  | `protocol-nevermined/fixtures/declarations-baseline.json`, checkpoint-fixture.ts, etc.                        | Frozen, not retroactively relabeled v2 (§21).                                                                                                            |
| Reports                      | `docs/reports/SUN-1000-checkpoint-1[a-l]*.md`, `SUN-0700A/0900B` reports                                      | Untouched historical record.                                                                                                                             |

Nothing in this list requires modification for this checkpoint, and nothing was
modified.

## 5. Coexistence model

**Selected: B — `PREPRODUCTION_V2_REPLACEMENT`.**

Evidence, read directly rather than assumed:

- `production_enabled: false` and `x-production-enabled: false` are set on every
  one of the 4 service operations, unconditionally, everywhere in the stack
  (registry metadata, OpenAPI, route-construction gate).
- **All 4 v1 operations in the live OpenAPI document already declare
  `x-implementation-status: "not_implemented"`** (verified directly against
  `packages/contracts/generated/openapi/service-contracts.openapi.json`). This
  is decisive: the _publicly declared_ v1 contract has never promised live
  availability in the first place. There is no external promise to keep.
- Full-repository grep (repeated from checkpoints 1J/1K-A) confirms zero real
  external consumers, zero generated client SDK, zero live production traffic.
  The only evidence of v1 "working" is internal fixture-mode tests and the
  SUN-0900B sandbox registrations (real Nevermined-side resources, but sandbox,
  not production).
- `COMPATIBILITY_POLICY.md` §11 permits — but does not mandate — "major versions
  may coexist," and explicitly allows a documented `ACTIVE→DEPRECATED→RETIRED`
  lifecycle. It also forbids `.v1` being _silently repointed_ to `.v2` — a
  distinct, narrower prohibition than "must remain permanently mounted."
  Retiring v1's active-development target while leaving its identity, schemas,
  and historical evidence completely intact (§4) is not a repoint; it is a
  governed retirement.

Given zero real consumers ever depended on v1 being live, running a full
parallel production implementation (Model A) would double the ongoing
Nevermined/x402/MCP/A2A maintenance surface for a version nothing outside this
repository has ever used. Model B is the evidence-supported choice: **v1's
schemas, code, tests, and all historical/sandbox evidence remain frozen and
permanently available; v1 stops being the target of new development and public
discoverability once v2 is the accepted contract.** This is not
`POLICY_CONTRADICTION` (D) — the policy's own retirement lifecycle and its "no
external evidence to protect" carve-outs (§5's
production_enabled/lack-of-customer-evidence hints) coherently support it.

## 6. HTTP route versioning

Read the actual routing code rather than assuming a pattern:

- CDP paths are **hardcoded literal strings per service**, not derived
  programmatically from the service ID
  (`paymentRoute('company_evidence_graph.v1', '/v1/company/evidence-graph')` in
  `apps/edge-api/src/control-plane/routes/paid-services.ts`).
- Nevermined paths are a **separate hardcoded map** (`NEVERMINED_ROUTES` in
  `packages/protocol-nevermined/src/routes.ts`), also literal
  `/v1/nevermined/...` strings.
- Rail selection (`selectPaymentRail`) is **route-string-keyed** via two `Set`s
  built from these maps — confirming the "no fallback, no stacking" Model D
  guarantee is structural, not incidental: an unrecognized route simply has no
  rail and fails closed.

**Future model:** new literal `/v2/...` and `/v2/nevermined/...` route strings,
added the same way `/v1/...` was — an explicit new entry per service in the same
two maps. `/v2` **does become required** (§ answer to directive item 11) because
there is no route-derivation mechanism that would produce it automatically;
every route is hand-authored today and will continue to be.

## 7. v2 contract model

For each of the 4 services:

| Field             | v2 change                                                                                                                                                                                                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request schema    | **Unchanged** — same input JSON Schema, same hash, reused as-is (no defect touches request shape).                                                                                                                                                                                                  |
| Success response  | **Unchanged** — same output schema.                                                                                                                                                                                                                                                                 |
| `400`             | Replaced `StructuredError` `$ref` with the schema that matches the real runtime `jsonError()` shape: `{ error: string, message: string, details?: unknown }`.                                                                                                                                       |
| `402`             | Replaced `StructuredError` `$ref` with the real x402 `PaymentRequired` challenge shape already defined/tested in `protocol-x402` (`{ error: 'payment_required', x402_version, quote_id, requirement_id }`, CDP rail; Nevermined rail has its own header-encoded shape already used in the runtime). |
| Pricing           | Unchanged (§9).                                                                                                                                                                                                                                                                                     |
| PCC behavior      | Unchanged content-compatibility semantics; only the closed `service_id` enum gains new members (§15).                                                                                                                                                                                               |
| Service semantics | Unchanged except the public major identity string itself.                                                                                                                                                                                                                                           |

v2 schemas **can and should** reuse the semantically-identical v1 input/output
JSON Schema files verbatim — the request/response body schemas were never the
defect; only the _declared error contract_ was wrong.

## 8. Service-ID source of truth (inventory, not refactor)

Located every current declaration site — confirmed there is **no single source
of truth today**; each is an independently hand-maintained, type-checked
enumeration:

1. `packages/service-runtime/src/types.ts` — `ServiceId` union +
   `ALL_SERVICE_IDS` array.
2. `packages/protocol-x402/src/types.ts` — `SiteborneServiceId` union
   (explicitly documented as "kept in sync by convention, not cross-package
   import").
3. `packages/protocol-a2a/src/constants.ts` — `SITEBORNE_SERVICE_IDS` array
   (`as const satisfies readonly SiteborneServiceId[]`, so at least type-checked
   against #2).
4. `packages/protocol-mcp/src/constants.ts` — `MCP_SERVICE_TOOLS` map (tool-name
   → service-ID).
5. `packages/protocol-nevermined/src/routes.ts` — `NEVERMINED_ROUTES` map.
6. `apps/edge-api/src/control-plane/routes/paid-services.ts` — 4 inline
   `createX402ServiceRoute` calls, each hardcoding its `serviceId`.
7. `packages/protocol-x402/src/bazaar/registry-source.ts` — 4 explicit static
   JSON imports of `registry/services/*.v1.json` (not glob-based).
8. `schemas/proof-carrying-context.schema.json` — closed `service_id` enum
   (§15).
9. **A genuine, previously-undiscovered landmine**:
   `packages/protocol-x402/src/bazaar/routes.ts`'s `resolveServiceRoute()`
   statically imports
   `contracts/releases/1.0.0/openapi/service-contracts.openapi.json` — a
   **literal, version-pinned path to the 1.0.0 snapshot specifically**, not the
   active-descriptor-derived path pattern checkpoint 1K-A's `compat.ts` was
   corrected to use. This has been harmless so far only because 1.0.1 never
   touched routing (`x-service-id`/`x-implementation-status`) fields — but a v2
   implementation phase must decide whether this reads from the _current_ active
   release (via `contracts/CONTRACT_RELEASE.yaml`) instead of a hardcoded
   `1.0.0` literal, to avoid recreating exactly the bug class checkpoint 1K-A
   fixed in `compat.ts`. **Flagged for the implementation checkpoint; not fixed
   here (no mutation authorized).**

**Design for the implementation checkpoint:** each of the 7 hand-maintained
enumerations (#1–7) gets one new parallel entry per service for `.v2`; none can
be collapsed into a single generated source without a larger refactor this
checkpoint does not authorize. This is disclosed as `MODERATE` risk (§30) —
omitting a site fails closed (TypeScript union exhaustiveness, `satisfies`
constraints, `ServiceRouteNotFoundError`), not silently, but the scatter itself
is real, pre-existing engineering debt, not something introduced by this
migration.

## 9. Pricing model

Registry metadata (`registry/services/*.v1.json`) confirms current prices match
the directive's cited figures exactly: company evidence `base_price: 0.039 USD`
(39000 micro-units at 6 decimals), `maximum_price: 0.19 USD` (matches the
directive's `190000` document-max figure), web context and verify base prices
likewise consistent with the `9000`/`19000` figures once expressed in the same
micro-unit convention.

**Recorded: `SAME_ECONOMICS_NEW_SERVICE_MAJOR`.** No price change is authorized
or intended by defect B; v2 registry files carry byte-identical
`pricing_schemes`/`base_price`/`maximum_price` blocks to their v1 counterparts,
differing only in `service_id`/`service_version`.

## 10. x402 migration

- **New Bazaar/resource declaration:** required — `registry-source.ts`'s 4
  static imports become 8 (v1 kept, v2 added), and `bazaar/discovery.ts`'s route
  resolution needs the new `/v2/...` `resolveServiceRoute()` entries (§6/§8).
- **New route identity:** required (§6).
- **New quote `service_id`:** required — `Quote`/`PaymentContextBinding` already
  carry `service_id: SiteborneServiceId`, so extending the union (§8) is
  sufficient; no structural change to the quote-building code path.
- **New PaymentServiceLink binding:** the PSL type is TS-only (§15) — a new
  `service_id` value flows through unchanged code.
- **New x402 service metadata:** required, new `registry/services/*.v2.json`
  (§4).
- **v1/v2 coexistence in code:** safe — `paymentRoute()`/route maps are
  per-service-ID keyed, so v1 and v2 entries coexist as ordinary sibling map
  entries with no shared mutable state.
- **Historical v1 payment evidence:** untouched (§4/§14).
- **No CDP mutation performed or required this checkpoint.**

## 11. Nevermined migration

Mapped the 4 accepted v1 registrations (SUN-0900B): each has a real,
externally-registered `local_agent_id`/`local_plan_id` derived as
`siteborne:{serviceId}:agent` / `siteborne:{serviceId}:payg` — i.e., the ID
string itself already embeds the full `.v1` service identity.

- **Are new v2 agents required?** Yes — Nevermined agent/plan resources are
  provider-side registered entities; there is no mechanism to "retarget" an
  existing registered v1 agent to a different (v2) semantic service without
  violating the same "no silent repoint" principle governing `.v1`/`.v2`
  identity generally.
- **Are new v2 plans required?** Yes, same reasoning.
- **Can existing plans legally/semantically serve v2?** No — a plan is
  registered against a specific declared agent/service description; serving v2
  traffic through a v1-registered plan would misattribute payment/usage records
  to the wrong declared service.
- **Must old v1 registrations remain historical only?** Yes, under Model B (§5)
  — they remain real, accepted, immutable sandbox evidence, never reused for v2
  traffic.
- **Can v1 and v2 coexist simultaneously (provider-side)?** Yes — nothing in the
  Nevermined SDK or SUN-0900B's accepted evidence suggests agent/plan IDs
  collide across different `serviceId` strings; `siteborne:{serviceId}:*`
  naturally produces distinct, non-colliding IDs for `.v1` vs `.v2`.

**No registration performed or attempted this checkpoint.**

## 12. Nevermined routes

Current: `/v1/nevermined/...` (4 literal paths, `NEVERMINED_ROUTES`).

**Future v2 requirement:** parallel literal `/v2/nevermined/...` entries in the
same map (§6/§8), keyed by the new `.v2` service IDs. `selectPaymentRail`
continues to derive from `OPEN_ROUTES`/`NVM_ROUTES` `Set`s built from these maps
— extending the maps automatically extends rail selection with zero additional
logic. **Model D remains exactly preserved**: one authoritative rail per route,
no fallback, no stacking, no double execution — this is structural (route-keyed
`Set` membership, mutually exclusive by construction), not a policy statement
that could be accidentally weakened by adding v2 entries.

## 13. D1 data model

Audited every `service_id`-bearing column across all 3 migrations
(`0001_control_plane_foundation.sql`, `0002_payment_attempt_replay.sql`,
`0004_x402_quotes.sql`): every one is declared `service_id TEXT NOT NULL` (or
nullable `TEXT` in a few optional-reference cases) — **no `CHECK` constraint,
foreign key to an enum table, or index anywhere restricts the literal value to
the current `.v1` set.** Confirmed by direct grep: zero `CHECK` clauses
reference `service_id`.

**No D1 schema migration is required.** New `.v2` string values are valid `TEXT`
inserts under the existing schema with zero structural change. Historical `.v1`
rows are untouched by definition (existing rows, no rewrite performed or
needed).

## 14. Payment-Identifier semantics

Read the actual constraint, not inferred: `idx_payment_attempts_identifier` is
`CREATE UNIQUE INDEX ... ON payment_attempts(payment_identifier)` — **the
uniqueness scope is `payment_identifier` alone, already global across every
service, not composite with `service_id`.**

- **Can the same Payment-Identifier be valid independently for different
  service-major IDs?** No — and this is **already true today** across the 4
  existing v1 services; nothing about v2 changes this rule.
- **Does service identity participate in binding uniqueness?** No.
- **Same Payment-Identifier + same rail + different service major** ⇒
  **`duplicate_conflict`** (DB-enforced at the unique-index layer, identical to
  reusing an identifier across any two services today). This is not a new case
  v2 introduces — it is the existing, already-tested rule, simply exercised
  across a wider set of `service_id` values. Buyers are already required (by
  x402 protocol convention and this repository's existing behavior) to mint a
  fresh identifier per attempt; nothing in the frozen payment architecture needs
  to change.

## 15. Receipt / UsageResult / PSL / PCC

Split, as instructed, between schema changes and ordinary value changes — and
the actual result **contradicts the directive's own "expected likely result"
hint**, disclosed explicitly rather than silently forced to match:

- **UsageResult, receipts, PaymentServiceLink:** TS-typed only
  (`protocol-x402`/`protocol-nevermined`), **not governed by any JSON Schema
  file** — confirmed via repository-wide search (no `usage-result.schema.json`,
  `receipt.schema.json`, or `payment-service-link.schema.json` exists anywhere).
  Extending `SiteborneServiceId` (§8) is sufficient; these are ordinary value
  changes under an already-open TypeScript union, not a schema-release event.
- **PCC (proof-carrying-context.schema.json):** **schema change IS required.**
  Direct inspection of `schemas/proof-carrying-context.schema.json` shows its
  `service_id` definition is a **closed enum**:

  ```json
  "service_id": {
    "type": "string",
    "enum": [
      "company_evidence_graph.v1", "web_context_verified.v1",
      "document_evidence_json.v1", "verify_agent_output.v1"
    ]
  }
  ```

  Adding `.v2` members is `enum_value_added` per `COMPATIBILITY_POLICY.md` §4 —
  itself classified `major`, human review required, parallel major required.
  This means the PCC Schema Release axis (currently 1.0.1 per ADR 0012) **must
  also advance** (to 1.0.2 or equivalent) as part of this migration — **not**
  "unchanged unless explicitly required," as the directive's own template
  speculated. This is the single most important corrective finding of this
  checkpoint's research: proving the answer rather than assuming it changed the
  version-axis map in §3.

  (`service_version` in the same schema uses an open
  `pattern: "^v\\d+(\\.\\d+)*$"`, already compatible with `v2` — no change
  needed there.)

**No PCC document version (1.0.0) change** — receipts' content-compatibility
version is unaffected; only the schema's own closed-enum _domain_ grows.

## 16. MCP migration

`MCP_SERVICE_TOOLS` maps **tool names that are not version-suffixed**
(`siteborne_company_evidence_graph`, not `siteborne_company_evidence_graph_v1`)
to a versioned `service_id` value. This is favorable: the existing naming
convention already supports **"same tool name pointing to v2"** without any
tool-rename or client-visible breaking change to tool discovery — only the
mapped `service_id` value changes from `.v1` to `.v2`, consistent with Model B
(v1 is retired, v2 becomes canonical under the same public tool names). Parallel
v1/v2 tools were considered and rejected: since v1 was never publicly declared
implemented (§5), there is no real MCP client depending on its continued
exposure. **No public npm publication performed or planned this checkpoint.**

## 17. A2A migration

Skill IDs (`AgentSkill.id = service.service_id`) and the x402-extension
`services[]` array both derive directly from `SITEBORNE_SERVICE_IDS`/
`REGISTRY_SERVICES`, iterated with `.map()` — **fully additive by
construction**: extending the underlying service-ID list (§8) automatically
produces new skill entries with zero special-casing required in `card.ts`
itself. Under Model B, once v2 registry entries replace v1 as the canonical set
fed into `SITEBORNE_SERVICE_IDS`, the live Agent Card generation naturally
reflects only v2 — v1 remains in frozen test fixtures (`card.test.ts`,
`fixtures.test.ts`) as historical protocol evidence, not in the live-generation
path. **No publication performed this checkpoint.**

## 18. OpenAPI / contract release 2.0.0 (definition only)

`contracts/releases/2.0.0/` (future, not created this checkpoint) would:

- Preserve `1.0.0` and `1.0.1` exactly as-is (never modified — same discipline
  as 1K-A's treatment of `1.0.0`).
- Be assembled the same way `1.0.1` was: copy the prior release's structure,
  replace only what genuinely changed.
- `openapi/service-contracts.openapi.json`: new `/v2/...` paths for all 4
  services (§6), `x-service-id` values updated to `.v2`, `400`/`402` responses
  `$ref`ing the two new real-shape schemas (§7) instead of `StructuredError`,
  request/success-response `$ref`s reused unchanged (§7). Whether v1's
  now-historical paths remain _in the same document_ (marked
  `x-implementation-status: "retired"` or equivalent) or move to a purely
  historical artifact is an open sub-decision for the implementation checkpoint
  — **recommendation: remove v1 paths from the live generated document
  entirely** (they already carry `not_implemented`/`false` everywhere; the
  frozen `1.0.0`/`1.0.1` release snapshots remain the permanent historical
  record, so nothing is lost by not duplicating v1 into the live
  2.0.0-generation source).
- `contracts/CONTRACT_RELEASE.yaml` (active descriptor): version `2.0.0`,
  `parent_release: '1.0.1'`, `classification: 'major'`, full rationale citing
  1J/1K-B's governed decision chain.
- `COMPATIBILITY_REPORT.json`: raw checker output (genuinely `major`, this time
  correctly so — not overridden) plus a `human_review` addendum recording the
  full 1K-B/1L decision trail, consistent with the pattern established in
  `1.0.1`'s report.
- `SHA256SUMS`: recomputed using `1.0.1`'s own tracked-file list as the template
  (repeating 1K-A's precedent, avoiding the `examples/` scope landmine already
  found and worked around once).

**Nothing in this section was created.**

## 19. Schemathesis migration (target definition)

Post-implementation target: schema loads directly from the committed
`2.0.0`-generated artifact (no ephemeral patch, matching 1K-A's already-restored
capability), all 4 v2 operations tested, **0 unexpected 5xx, 0 response-schema
violations, 0 known defect-B failures** — the explicit SUN-1000 exit criterion
for this gate.

Per §18's recommendation, v1 does not remain in the same live OpenAPI document
Schemathesis tests against — it is superseded there, while permanently preserved
in the frozen `contracts/releases/{1.0.0,1.0.1}/` snapshots. **No test
workaround for defect B is planned or authorized** — the actual fix (real
400/402 schemas) is what closes this gate, not a scope exclusion.

## 20. v1 runtime lifecycle question

Given Model B (§5): v1's code (`createX402ServiceRoute` calls for the 4 `.v1`
service IDs, its tests, its Nevermined/CDP declarations) **remains in the tree
permanently as regression evidence** — nothing is deleted. Whether it stays
_mounted_ behind `PAID_ROUTES_ENABLED` (which has never been set `true`
anywhere) is a genuinely low-stakes implementation-checkpoint decision, since
mounted-but-gated and unmounted are behaviorally identical in every environment
that exists today (the gate is unset everywhere). **Recommendation for that
future checkpoint:** leave v1 routes mounted (cheapest, zero behavioral
difference, preserves the exact tested SUN-0700A/SUN-0900B code paths as living
regression tests) rather than introducing a 404/410 distinction that has no real
audience to serve.

## 21. Sandbox registration history

All accepted v1 Nevermined/CDP sandbox evidence (SUN-0900B's four canonical
registrations, settlement/recovery proofs, D1 rows) is preserved exactly as
accepted. **Explicitly prohibited, and not performed:** relabeling any past
`payment_identifier`, delegation ID, transaction hash, receipt, PSL, or job ID
as `.v2`. Future v2 sandbox tests (Phase 2, §24) must produce entirely distinct
evidence under freshly-minted identifiers — no retrospective migration of any
historical record.

## 22. Production/publication order (evaluated, not executed)

1. Implement internal v2 contracts/IDs (Phase 1, §24)
2. Pass deterministic regressions + Schemathesis (Phase 1 exit gate)
3. Build and pass chaos/load against v2 (§27)
4. Rotate exposed CDP sandbox credentials (§23 — required immediately before
   step 5)
5. Create required v2 Nevermined agent/plan registrations (Phase 2, §24)
6. Verify v2 sandbox payment paths (CDP + Nevermined)
7. Publish MCP/A2A/public endpoints pointing at v2
8. Registry/discoverability
9. Launch (production enable — separate, later governance decision, not implied
   by any step here)

**No step executed.**

## 23. Credential rotation gate

Existing tracked item:
`ROTATE_EXPOSED_CDP_SANDBOX_CREDENTIALS_BEFORE_NEXT_PROVIDER_MUTATION=true`
(open since checkpoint 1D).

**First future checkpoint performing a real provider mutation:** Phase 2 (§24) —
new Nevermined agent/plan registrations and any CDP-side interaction for v2.
**Credential rotation is now made an explicit prerequisite immediately before
Phase 2 begins**, recorded in `TASKS.yaml`'s `next_action`. **No rotation
performed this checkpoint; no credential value printed.**

## 24. Implementation phasing

**Selected: B — `TWO_PHASE`.**

- **Phase 1 (credential-independent, entirely local):** internal v2
  identities/contracts/routes/PCC-schema-enum extension; Schemathesis made to
  PASS against the real v2 surface; new chaos/load suites built and run against
  v2 (§27) — all without touching CDP or Nevermined externally.
- **Phase 2 (external, credential-gated):** credential rotation (§23), real
  Nevermined v2 agent/plan registrations, live v2 sandbox payment-path proof,
  MCP/A2A public wiring, registry/discoverability.

`THREE_PHASE` (C) was considered — splitting Phase 2 into "local
payment/protocol integration" vs "external registrations" — but nothing in this
repository's payment/protocol integration layer (Model D rail selection,
PSL/receipt wiring, MCP/A2A metadata generation) has any credential dependency
of its own; it is either purely local (belongs in Phase 1) or purely
external-registration-dependent (belongs in Phase 2). A third phase would not
isolate any additional real boundary — `TWO_PHASE` is the smallest sequence that
actually preserves rollback and v1 evidence without an artificial split.

## 25. Implementation checkpoint definitions (not executed)

**Checkpoint 1M — v2 internal contract/runtime implementation (Phase 1).**

- Expected HEAD: this checkpoint's commit.
- Allowed: `SiteborneServiceId`/`ServiceId`/`SITEBORNE_SERVICE_IDS`/
  `MCP_SERVICE_TOOLS`/`NEVERMINED_ROUTES` extensions (§8); new
  `registry/services/*.v2.json` files (§4/§9);
  `schemas/proof-carrying-context.schema.json` `service_id` enum extension + new
  PCC schema release (§15); new `contracts/releases/2.0.0/` (§18); new `/v2/...`
  routes wired in `paid-services.ts` (§6); the `resolveServiceRoute()`
  hardcoded-path fix (§8, item 9) generalized the same way `compat.ts` was in
  1K-A.
- Prohibited: any CDP/Nevermined network call, any production-enable flag flip,
  any deletion of v1 code/tests/frozen releases.
- Acceptance gate: full regression green, Schemathesis PASS on v2 operations,
  `pnpm check` exit 0, `contracts:compat:check` correctly classifying the change
  as the pre-authorized major (this checkpoint's own decision, not a surprise).
- Rollback point: a single revertible commit range; v1 completely undisturbed
  throughout (frozen releases untouched, so rollback needs no external-evidence
  cleanup).
- Criterion effect: Schemathesis FAIL_INTERNAL → PASS (if defect B was truly the
  sole remaining blocker, per §28).

**Checkpoint 1N — chaos/load suite construction and execution (v2 target).**

- Scope: build the chaos and load suites SUN-1000 has never had (checkpoint 1A
  already found neither exists anywhere in the repository), targeting the v2
  architecture that will actually launch, not the superseded v1 surface.
- Prohibited: any external provider mutation.
- Criterion effect: Chaos/Load FAIL_INTERNAL → PASS (or a newly-scoped,
  honestly-reported result — not forced).

**Checkpoint 1O — external v2 provider registration + rollout (Phase 2).**

- Prerequisite: credential rotation (§23) completed immediately before this
  checkpoint starts.
- Scope: real Nevermined v2 agent/plan registrations, live v2 sandbox
  payment-path proof (CDP + Nevermined), MCP/A2A public wiring, registry/
  discoverability updates.
- Status until credentials are available: `BLOCKED_EXTERNAL`, exactly like
  SUN-0700B/SUN-0800B/SUN-1100/SUN-1200 today.

## 26. Internal vs external boundary

Everything in Phase 1 (1M) and 1N is credential-independent. Only Phase 2 (1O)
requires CDP/Nevermined credentials, public DNS/endpoints, or npm publication.
**The next executable checkpoint (1M) maximizes credential-independent
progress**, consistent with every prior SUN-1000 checkpoint's discipline.

## 27. Chaos/load ordering

**Selected: after internal v2 implementation (Phase 1 / checkpoint 1M), before
external v2 provider registration (checkpoint 1O).**

Evidence: no chaos or load suite exists at all yet (checkpoint 1A). Building
either now, against the v1 surface that Model B (§5) determines will no longer
be the forward-facing implementation target, would spend real engineering effort
exercising an architecture about to be superseded. Building them against v2
instead — once v2's internal contracts/routes exist but before external
registrations are live — tests the actual architecture that will launch, per
this checkpoint's own explicit preference and the user's own stated rationale.
This does **not** mean chaos/load "should precede v2" — the evidence points the
opposite direction from that alternative, and is stated explicitly here rather
than defaulted to.

## 28. SUN-1000 criteria impact

**Which future phase can close Schemathesis?** Checkpoint 1M (Phase 1) alone —
Schemathesis only needs the real 400/402 response schemas to exist and be
correctly declared against a real, reachable local server; no external
Nevermined/CDP registration is required to satisfy that gate, exactly as the
user's closing note anticipated.

**Chaos/load target:** v2 only (checkpoint 1N), per §27 — not v1+v2, since v1 is
being retired under Model B and testing a superseded surface would not represent
the architecture that actually launches.

**No criterion transitions performed this checkpoint** — all 12 remain in their
pre-1L state (§33).

## 29. Rollback model

| Phase                      | Rollback mechanism                                                                                                                                                                                                                   | v1/external evidence exposure                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1M (internal v2)           | Single revertible commit range; `contracts/releases/{1.0.0,1.0.1}/` untouched throughout                                                                                                                                             | None — v1 contracts, sandbox evidence, D1 history all completely undisturbed                                                                          |
| 1N (chaos/load)            | New test/suite files only; revertible independently of 1M                                                                                                                                                                            | None                                                                                                                                                  |
| 1O (external registration) | Cannot "roll back" a real Nevermined registration once created (external system of record) — but rollback here means **halting further v2 rollout steps**, not deleting the registration; v1's registrations remain valid regardless | Real external v2 resources, once created, are permanent (same as v1's already were) — no rollback deletes external payment evidence, for either major |

No planned rollback at any phase requires deleting v1 historical contracts, v1
sandbox evidence, payment history, or D1 history — consistent with
`COMPATIBILITY_POLICY.md` §11's retention requirements.

## 30. Migration risk matrix

| Subsystem                       | Risk                                | Evidence                                                                                                                                                                                                                               |
| ------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contracts (OpenAPI/JSON Schema) | LOW                                 | Mechanical extension of an already-proven pattern (1K-A); request/success schemas reused verbatim; only 400/402 truly change, and the real target shapes are already known/tested in runtime code.                                     |
| Service IDs                     | MODERATE                            | 7 independently hand-maintained enumeration sites (§8) — each fails closed on omission (TS exhaustiveness/`satisfies`), but the scatter is real, pre-existing debt, not eliminated by this plan.                                       |
| HTTP routing                    | LOW                                 | Purely additive literal-string route maps (§6); Model D's rail-selection guarantee is structural, not weakened by more entries.                                                                                                        |
| D1                              | LOW                                 | No schema migration needed at all (§13) — plain `TEXT` columns, no enum constraints.                                                                                                                                                   |
| x402                            | LOW-MODERATE                        | Code-level changes are additive/parallel (§10); the one MODERATE factor is the `resolveServiceRoute()` hardcoded-1.0.0-path landmine (§8 item 9), which must be deliberately addressed during 1M, not rediscovered mid-implementation. |
| Nevermined                      | MODERATE (real external dependency) | Requires genuinely new, real, credential-gated registrations (§11) — the only subsystem in Phase 1's story that has an unavoidable external-system dependency, deferred correctly to Phase 2.                                          |
| PCC schema                      | MODERATE                            | Genuine schema-release bump required (§15) — a real, disclosed finding this checkpoint proved rather than assumed away; not a blocker, but not "unchanged" either.                                                                     |
| MCP/A2A                         | LOW                                 | Both are structurally additive/parametric over the service-ID list (§16/§17) — no special-casing needed in either package's core logic.                                                                                                |
| Public discoverability          | Not yet assessed (Phase 2 scope)    | No public endpoint exists today for any of this; deferred to 1O by design.                                                                                                                                                             |

## 31. Final migration architecture (frozen)

- **v1 lifecycle:** frozen historical — schemas/contracts (`1.0.0`, `1.0.1`)
  permanently preserved and `baseline:verify`-checked; code/tests retained as
  regression evidence; routes may remain mounted (behaviorally inert, §20);
  never the target of new public discoverability or documentation once v2
  exists; identity string never reused or repointed.
- **v2 lifecycle:** becomes the sole forward-facing implementation target once
  Phase 1 (1M) lands; carries corrected 400/402 contracts, identical economics,
  identical request/success semantics.
- **Route lifecycle:** new literal `/v2/...` (CDP) and `/v2/nevermined/...`
  (Nevermined) paths, hand-authored the same way `/v1/...` was (§6); v1 routes
  remain mounted but functionally retired under Model B.
- **Contract lifecycle:** `contracts/releases/2.0.0/` created per §18, never
  modifying `1.0.0`/`1.0.1`; active descriptor repoints to `2.0.0`.
- **Payment identity:** `SiteborneServiceId` union extended with 4 new `.v2`
  members across the 7 hand-maintained sites (§8); Payment-Identifier semantics
  entirely unchanged (§14).
- **Provider registration strategy:** new, real, distinct v2 Nevermined
  agent/plan registrations in Phase 2 (§11/§24); v1's registrations remain
  untouched, permanent, real sandbox evidence.
- **Protocol metadata strategy:** MCP tool names stay stable, remapped to v2
  service IDs (§16); A2A skills/Agent Card regenerate additively/ replacively
  from the same service-ID list feed (§17).
- **Release order:** Phase 1 (internal, 1M) → chaos/load build-and-run against
  v2 (1N) → credential rotation → Phase 2 (external, 1O) → later, separate
  production-enable governance decision (not implied here).

No unresolved "maybe" remains on core identity behavior: v1 is frozen and
retired-from-active-development, not deleted; v2 is additive and becomes
canonical; nothing is silently repointed.

## 32. Selected next checkpoint

**Checkpoint 1M — v2 internal contract/runtime implementation (Phase 1).**
Credential-independent, internally executable, and the smallest safe first phase
per §24/§25. Chaos was explicitly evaluated (§27) and correctly **not** selected
— building/running it now would target the soon-to-be- retired v1 surface, and
the evidence points at 1M first.

## 33. Current state (no transitions)

```
PASS               8 / 12
FAIL_INTERNAL      3 / 12   (Schemathesis, Chaos, Load)
BLOCKED_EXTERNAL   1 / 12   (Trivy)

Schemathesis       FAIL_INTERNAL
Chaos              FAIL_INTERNAL
Load               FAIL_INTERNAL
Trivy              BLOCKED_EXTERNAL

SUN-1000           active
production_ready   false
production_enabled false
```

## 34. Regression

`pnpm security:semgrep`, `pnpm security:osv`, `pnpm security:trivy`,
`pnpm security:schemathesis`, `pnpm secrets:scan`, `pnpm governance:validate`,
`pnpm state:validate`, `pnpm tasks:validate`, `pnpm check` — all re-run after
report/state bookkeeping (§1's results). Schemathesis remains on defect B (12
findings, unchanged). Trivy remains unchanged (HIGH=3, `BLOCKED_EXTERNAL`). No
regression.

## 35–36. Report and task/state update

This report: `docs/reports/SUN-1000-checkpoint-1l-service-v2-migration-plan.md`.
`TASKS.yaml` updated with the 1L decision, the frozen
`PREPRODUCTION_V2_REPLACEMENT` coexistence model, and a `next_action` pointing
at checkpoint 1M. No criterion state changes made.

## 37. External mutations

Production deployment: 0. DNS mutation: 0. Package publication: 0. Nevermined
registration: 0. Nevermined payment: 0. CDP mutation: 0. Live payment: 0.
(Public docs/package-metadata reads only — none were even needed this
checkpoint, all evidence was gathered from the local repository.)
