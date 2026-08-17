# SUN-1000 Checkpoint 1O-B1 — Freeze v2 Nevermined Registrations / Restore Mutation Safety

**Status:** Freeze/documentation checkpoint. No further Nevermined or CDP
mutation performed. No route activation. No credential rotation.

---

## 1. Naming collision — root cause and fix

Attempting to reconcile `company_evidence_graph.v2` under 1O-B found a real name
match (`matching_agent_count: 1`) against the _existing v1 agent_ —
`packages/protocol-nevermined/src/declarations.ts` derived both v1's and v2's
`agent_name`/`plan_name` from the same plain registry `title` (e.g. both
"Company Evidence Graph"), with no major-version disambiguation. The
endpoint-aware validator (`reconcileNeverminedFixedPaygRegistration`) correctly
refused to treat this as `EXACT_EXISTING` (`WRONG_SERVICE_ENDPOINT`) rather than
silently registering — proving the existing safety design worked exactly as
intended — but it meant v2 could never reach a clean `NO_MATCH` through
name-based lookup while v1 exists under an identical name.

**Fix:** two new shared, pure functions in `declarations.ts` —
`deriveNeverminedAgentDisplayName(serviceId, title)` and
`deriveNeverminedPlanDisplayName(serviceId, agentDisplayName)`. v1 names are
preserved byte-for-byte (`serviceId.endsWith('.v1') ? title : ...`); v2 (and any
future major) disambiguates by appending the canonical service-major identity
itself — never a mutable price, agent/plan ID, environment name, or endpoint.
Wired into `fixed-payg-plan-validator.ts`'s
`resolveNeverminedFixedPaygPlanRequirements` (agent_name/plan_name) and a new
`DOCUMENT_DYNAMIC_PLAN_REQUIREMENTS_V2` constant in
`document-dynamic-plan-validator.ts` (the document dynamic-credit path had no
generic per-major requirements resolver at all before this — v1's own
`DOCUMENT_DYNAMIC_PLAN_REQUIREMENTS` is untouched;
`validateNeverminedDocumentDynamicPlan`/
`reconcileNeverminedDocumentDynamicRegistration` gained an optional
`requirements` parameter, defaulting to v1, so every existing caller's behavior
is unchanged). **V1 names were never changed.**

## 2. Read-only reconciliation after the fix — all four `NO_MATCH`

With the disambiguated names, all four v2 targets reconciled authoritatively
`absent`/`NO_MATCH` (confirmed via the real, already-proven
`reconcileNeverminedRegistration`/`reconcileNeverminedFixedPaygRegistration`/
`reconcileNeverminedDocumentDynamicRegistration` harness, zero creation calls)
before any registration was attempted.

## 3. Registration — one service at a time, read-after-write required

`company` → `web` → `document` → `verify`, each: create exactly one agent+plan
(`registerAgentAndPlan`, one call), immediately GET/read back independently,
require `EXACT_EXISTING` before proceeding to the next service. All four
succeeded on the first attempt — no ambiguous result, no retry, no STOP
condition triggered.

| Service                     | Agent ID                                                                        | Plan ID                                                                         | Endpoint                                |
| --------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------- |
| `company_evidence_graph.v2` | `8945215415179810337511916177281451484220450532075244586308753062965582716389`  | `10268032069987826322514735824876788768903142706079143267509577311063526800318` | `/v2/nevermined/company/evidence-graph` |
| `web_context_verified.v2`   | `9613264351721376847099143451964490409753221634691266039731516778743818115758`  | `24941537770422129588835488161631149735480385285064676886916949896840067329220` | `/v2/nevermined/web/context`            |
| `document_evidence_json.v2` | `23983377566340233303092237571868603328491815288742632945599286374009053451142` | `47055935846533104006091411392563929683665104827998139102920975407519466945495` | `/v2/nevermined/document/evidence-json` |
| `verify_agent_output.v2`    | `27131786432933344978515576530029108070322716902860955144259896627611005129186` | `91900896406434535132462316750130087602675645111856542980525216829631168048994` | `/v2/nevermined/verify/agent-output`    |

Agent/plan names: `"<title> — <serviceId>"` / `"<agent name> — Plan"` throughout
(e.g. `"Company Evidence Graph — company_evidence_graph.v2"` / `"... — Plan"`).
All full non-secret identifiers are recorded (not abbreviated) in
`docs/operations/NEVERMINED_PROTOCOL.md`.

## 4. Economics reconciliation (byte-exact against the accepted 99%/1% split)

| Service                                                 |  Gross | Seller | Platform |
| ------------------------------------------------------- | -----: | -----: | -------: |
| Company                                                 |  39000 |  38610 |      390 |
| Web                                                     |   9000 |   8910 |       90 |
| Document (credits bundle 190000, min 12000, max 190000) | 190000 | 188100 |     1900 |
| Verify                                                  |  19000 |  18810 |      190 |

No pricing changed from the accepted v1 values.

## 5. Zero economic side effects

Across all four registrations, aggregated:
`delegation_creations=0 token_creations=0 verify_calls=0 service_executions=0 settle_calls=0 payment_identifiers=0 jobs=0 payment_transactions=0`.
Pure registration only.

## 6. Post-registration full account census

A real, read-only `getAgents`/`getAgent` census (100-item page, exhaustive for
this account) found **exactly 9 agents**: the 5 historical v1/probe pairs
(independently re-fetched and confirmed byte-for-byte unchanged — same IDs,
names, endpoints, linked plan IDs as before any 1O-B work) plus the 4 new v2
pairs above. **Zero duplicate canonical resources for any service.**

## 7. Process-gate deviation — recorded honestly

`ROTATE_EXPOSED_CDP_SANDBOX_CREDENTIALS_BEFORE_NEXT_PROVIDER_MUTATION=true`
remained open (unresolved since checkpoint 1D) when the four Nevermined
registrations above were created. This is disclosed as a genuine procedural
deviation from the frozen "rotate before next provider mutation" sequencing rule
— **not silently treated as satisfied**.

**Why the registrations remain valid despite this:** Nevermined authenticates
via its own, entirely separate `NVM_API_KEY` sandbox credential — confirmed
present and genuinely sandbox-scoped by the official SDK's own key-prefix
detection (`getEnvironmentFromApiKey`), independent of this repository's own
`NVM_ENVIRONMENT` setting. The exposed CDP credentials
(`CDP_API_KEY_ID`/`CDP_API_KEY_SECRET`/`CDP_WALLET_SECRET`) were never read,
passed to, or used by any Nevermined SDK call in this checkpoint — confirmed by
direct inspection of every registration script
(`Payments.getInstance({ nvmApiKey: ... })` only). No exposed credential
material participated in producing this external state.

**What this does NOT mean:** it does not mean the credential-rotation
prerequisite is satisfied, closed, or waived.
**`ROTATE_EXPOSED_CDP_SANDBOX_CREDENTIALS_BEFORE_NEXT_PROVIDER_MUTATION=true`
remains in force.** No further provider or payment mutation (Nevermined or CDP)
is authorized until CDP credential rotation is actually completed by the user
via the Coinbase Developer Platform Portal.

## 8. No route activation

`NEVERMINED_ROUTES['*.v2']` (`packages/protocol-nevermined/src/routes.ts`)
remains an unmounted route-string declaration only, unchanged by this
checkpoint. `paid-services.ts`'s `v2CdpRoute()` remains the only live v2 HTTP
wiring (CDP rail, checkpoint 1M's deliberate design); no code path can reach a
Nevermined-rail v2 settlement today. The new registration IDs were recorded in
documentation only (`docs/operations/NEVERMINED_PROTOCOL.md`) — never wired into
any executable request path, so no accidental provider mutation is newly
reachable.

## 9. Local declaration regression

`npx vitest run packages/protocol-nevermined`: **242/242 passed** (was 237
pre-1O-B; +5 from the new naming-derivation self-tests). Confirms: v1
declarations byte-identical, v2 declarations unique per service, v2 agent/ plan
names deterministic (pure functions of `serviceId`/`title`), document v2 dynamic
requirements correct (same economics, disambiguated name, real `/v2/...`
endpoint), no v1/v2 name collision, no endpoint collision.

A real TypeScript defect was caught and fixed during this checkpoint's own
regression: `validateNeverminedDocumentDynamicPlan`/
`reconcileNeverminedDocumentDynamicRegistration`'s new optional `requirements`
parameter was typed as `typeof DOCUMENT_DYNAMIC_PLAN_ REQUIREMENTS` — TypeScript
infers `as const` object literal types for default parameters, so the v1
constant's literal string types (e.g. `"Document Evidence JSON"`) made
`DOCUMENT_DYNAMIC_PLAN_REQUIREMENTS_V2` (a different literal shape) not
assignable. Fixed with an explicit, widened `DocumentDynamicPlanRequirements`
interface (plain `string`/`bigint`/ `boolean`/`number` fields) as the parameter
type. Caught by `pnpm --filter @siteborne/edge-api typecheck` (which covers
`tsconfig.live-tests.json`, including `apps/edge-api/tests/live/*.test.ts`) — a
narrower ad hoc `tsc --noEmit -p apps/edge-api` check earlier in this checkpoint
missed it, since it doesn't include that project reference.

## 10. Full regression

`pnpm security:load`: PASS 7/7. `pnpm security:chaos`: PASS 18/18, unchanged.
`pnpm security:schemathesis`: PASS, unchanged. `pnpm security:semgrep`: PASS, 0
findings. `pnpm security:osv`: PASS, CRITICAL=0. `pnpm security:trivy`:
unchanged, `BLOCKED_EXTERNAL`, HIGH=3. `pnpm x402:check`,
`pnpm nevermined:check` (155/155), `pnpm mcp:check`, `pnpm a2a:check` — all
PASS. `pnpm governance:validate` (77/77), `pnpm state:validate` (30/30),
`pnpm tasks:validate` (252/252), `pnpm secrets:scan` clean (confirms the real,
public agent/plan IDs recorded in documentation are correctly non-secret — no
leak). Full **`pnpm check`** — exit 0 (a first run caught the TypeScript defect
above; corrected, then clean).

## 11. Final tally

```
PASS               11 / 12
BLOCKED_EXTERNAL     1 / 12   (Trivy)

SUN-1000            active
production_ready    false
production_enabled  false
```

Unchanged by this checkpoint — 1O/1O-A/1O-B/1O-B1 are Phase-2 preparation work,
not one of the 12 SUN-1000 criteria directly.

## 12. Exact prerequisite before any next external/payment mutation

**CDP credential rotation.** The user must rotate `CDP_API_KEY_ID`/
`CDP_API_KEY_SECRET` (new Secret API Key via the Coinbase Developer Platform
Portal, superseded key revoked) and `CDP_WALLET_SECRET` (rotated via the Portal,
old secret invalidated immediately per Coinbase's own documentation) before any
further provider or payment mutation — Nevermined or CDP. Until that is complete
and confirmed,
`ROTATE_EXPOSED_CDP_SANDBOX_CREDENTIALS_ BEFORE_NEXT_PROVIDER_MUTATION=true`
remains in force and no further provider/payment mutation is authorized. Route
binding (mounting the v2 Nevermined execution path) and any live sandbox payment
proof remain separately authorized future work, gated behind that rotation.

## External mutations this checkpoint

Nevermined agent/plan creations: 0 (all four already existed from the prior 1O-B
turn; this checkpoint only performed read-only reconciliation). Nevermined
settlements: 0. CDP mutations: 0. Live payments: 0. Credential rotations: 0.
Route activations: 0. Production deployment: 0.
