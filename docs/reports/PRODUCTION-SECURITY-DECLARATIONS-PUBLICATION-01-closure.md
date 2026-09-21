# PRODUCTION-SECURITY-DECLARATIONS-PUBLICATION-01 — closure (merged)

This report covers both phases of the checkpoint:

- **Part A** — local/source publication qualification (commit `35ed3d6`,
  preserved verbatim from `182bfb5`, where it was 220 lines).
- **Part B** — immutable upload, 0%-traffic deployment and live exact-version
  readback (commit `940b81b`, preserved verbatim).

The commit `940b81b` had overwritten Part A with Part B. This revision restores
Part A from history and appends Part B; nothing was reverted repo-wide. Part A's
statement that nothing was uploaded/deployed is true of Part A only; see Part B
and its accounting for the later cloud mutations.

---

## Part A — local/source phase

**Classification: `LOCAL_PUBLICATION_SOURCE_QUALIFIED_PENDING_MCP_NAMING`**

Governance class: `ADDITIVE_PUBLIC_METADATA_ONLY`. This report covers the
local/source phase only. Cloud publication is deferred until
`MCP-CANONICAL-TOOL-NAMING-01`. Nothing was uploaded, deployed, promoted, or
pushed.

### 1. Provenance

- Starting HEAD: `6c450807898044f23887b88869b31d28c1eabdc0`
  (`PRODUCTION-SECURITY-DECLARATIONS-01`, source-qualified, unpublished)
- Branch `metadata-vcm-qualification`; tree clean at start of the checkpoint.
- Working diff preserved at `/tmp/pub01/working.diff` before the resumed phase.
- Every modified path belongs to this checkpoint; no unrelated work existed.

| Area                           | Paths                                                                                                                                                                 |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical security publication | `packages/vcm/src/security/publication.ts`, `security/index.ts`, `security/declaration.ts` (provenance `publicationState` → `additive_metadata_projection`)           |
| MCP projection                 | `packages/protocol-mcp/src/server.ts`, `types.ts`; `packages/vcm/src/projections/mcp-real-context.ts`, `mcp-shadow.ts`, `types.ts`                                    |
| A2A projection                 | `packages/protocol-a2a/src/card.ts`, `transport.ts`, `types.ts`; `packages/vcm/src/projections/a2a-real-context.ts`, `a2a-shadow.ts`                                  |
| OpenAPI projection             | `packages/protocol-x402/src/openapi/paid-operations.ts`                                                                                                               |
| Catalog projection             | `apps/edge-api/src/control-plane/routes/catalog.ts`                                                                                                                   |
| Edge composition / injection   | `apps/edge-api/src/control-plane/security-publication.ts`, `routes/a2a.ts`, `routes/mcp.ts`                                                                           |
| Tests                          | `packages/vcm/src/security/publication.test.ts`, `packages/protocol-mcp/src/security-meta.test.ts`, `apps/edge-api/tests/security-publication-local-surfaces.test.ts` |

### 2. Architecture and dependency direction

```
@siteborne/vcm  (canonical declaration + publication builder)
        ↓  plain, validated, allowlisted data
apps/edge-api  (composition / injection boundary)
        ↓
existing MCP / A2A / OpenAPI / catalog builders (accept optional injected data)
```

- `@siteborne/vcm` depends on `protocol-mcp` and `protocol-a2a`; neither imports
  `@siteborne/vcm`. **No cycle.** Confirmed by grep of all protocol/pricing
  sources and by a clean repo-wide typecheck.
- `CANONICAL_SECURITY_AUTHORITY=@siteborne/vcm`,
  `SECURITY_COMPOSITION_BOUNDARY=edge-api`, `PARALLEL_SECURITY_TRUTH_SOURCE=NO`.
- Protocol builders accept injected data only; with nothing injected their
  output is unchanged (asserted in `security-meta.test.ts`).
- `NEW_PUBLIC_ENDPOINTS=0`. Only existing surfaces are extended.

### 3. Projection implementation (additive only)

- **MCP**: per-tool `_meta` keys `net.siteborne/securityDeclaration` and
  `net.siteborne/security`. The injection helper accepts only keys prefixed
  `net.siteborne/security`; existing keys can never be overridden (mutation
  test: removing the prefix filter fails 2 of 3 tests; restored).
- **A2A**: one extra `capabilities.extensions` entry, `required:false`,
  identified by the URN `urn:siteborne:a2a:extension:security-declaration:v1`. A
  URN, not an https URL: a URL would have to resolve to a newly published
  resource, which this publication class forbids (an https URI was caught by the
  existing canonical-URL projection test and replaced). No `securitySchemes`, no
  `securityRequirements`.
- **OpenAPI**: document-level `x-siteborne-security-declaration` and
  per-operation `x-siteborne-security` on the four v2 paid operations.
- **Catalog**: top-level `security_declaration` reference; per-service
  `security` block on list and service-metadata responses (optional in the
  schemas).
- Every fragment carries the `truthLevelCeiling` (`CONFIGURED`) beside the
  implementation status. Fragments are built by explicit field copy through the
  validated allowlist projector; canonical private fields cannot be spread.
- Publication self-checks on build: canonical validation, narrowing (never
  stronger than canonical, never enabling what canonical keeps closed), and
  private-leak scan. A contradictory canonical declaration fails closed.

### 4. Tests

New tests: 25 (10 publication, 3 MCP injection, 12 surface/integration).

- Publication refuses: contradictory identity claims, a closed capability made
  purchasable, an unsupported mechanism marked enforced; injected private
  canonical fields (`privateEvidenceRef`, extra keys) never appear in output.
- Real-Worker integration (Agent Card + JWKS, `/mcp` tools/list,
  `/openapi.json`, `/catalog`, `/services/:id`) in `legacy`, `shadow_compare`
  and `vcm_primary_compare`: security metadata present and byte-identical across
  modes; the VCM-primary path succeeds without fallback and with no semantic
  mismatch event.
- Cross-surface parity: for `web_context_verified.v2` and
  `verify_agent_output.v2` the MCP, OpenAPI, catalog and A2A fragments equal the
  canonical bindings on mode, profile, status, availability, purchasability,
  economic-authorization requirement, execution/economic effects, assurance and
  runtime qualification. Only the Release-1 pair has a purchasable mode; all
  closed capabilities remain `UNSUPPORTED` and non-purchasable. Existing
  `checkMcpParity`, `checkA2aParity` and `checkOpenApiParity` return zero
  violations on the served output.
- The existing security-declaration suite (canonical, negatives, bindings,
  effects, runtime qualification, result, economic, credential, key-purpose,
  hostile content, public/private, semantic-hygiene, contradiction 29 cases,
  property 12, parity) is included in the broad run and passes.
- `PRIVATE_SECURITY_IP_LEAKS=0` on the served A2A, MCP, OpenAPI and catalog
  security material.

### 5. A2A signature and digests

- `A2A_CARD_REGEN_REQUIRED=YES` in the sense that the served card content
  changes, so its signature changes. No signed card is committed; the card is
  signed at Worker runtime. The signature covers the extension: a tampered
  extension fails verification (asserted).
- `A2A_CARD_JWS_LOCAL=PASS` — verified against the local signing identity's
  JWKS. Verification against the **production** key/JWKS is not possible locally
  and is a required post-publication check.
- Pins re-verified unchanged and passing: `mcp:spec:verify`,
  `mcp:metadata:verify`, `a2a:fixtures:verify`, `a2a:spec:verify`,
  `x402:fixtures:verify`, `contracts:baseline:verify`,
  `contracts:release:verify`, `contracts:compat:check`,
  `openapi:generate:check`, `schemas:check`.

```
MCP_DIGESTS_AFFECTED=none (no committed digest covers served tools/list; runtime VCM projection digests are telemetry only)
A2A_DIGESTS_AFFECTED=served card bytes and runtime JWS only; no committed baseline changed
OPENAPI_HASHES_AFFECTED=none committed (served /openapi.json is dynamic; generated release files unchanged)
CATALOG_HASHES_AFFECTED=none
OTHER_PUBLIC_HASHES_AFFECTED=none (no static network-site file changed)
```

### 6. Reproducibility

`SECURITY_PUBLICATION_REPRODUCIBLE=PASS`. Two independent generations of the
card, tools/list, OpenAPI and catalog are byte-identical after removing
`generated_at`, which is a timestamp and not an identity field. (The card
signature is stable within an isolate because the signed card is cached.)

### 7. Local artifact scope

Dry-run builds (no upload) of HEAD `6c45080` (baseline) and the working tree,
compared per module after normalising path prefixes and bundler rename suffixes:

- Public Worker: **6 added modules** (all security: `vocabulary`, `declaration`,
  `validate`, `project`, `publication`, `security-publication`) and **11 changed
  modules**, all on the intended list (paid-operations, A2A card/transport, MCP
  server, VCM a2a/mcp projections, edge `mcp`/`a2a` routes, catalog). Nothing
  removed. No change in payment, settlement, provider, pricing, admission or
  route code. Bundle 4,478,794 → 4,502,733 bytes (+23,939).
- Continuation host: **byte-identical** to baseline after path normalisation; no
  security modules included. No host redeploy is implied by this change.

`LOCAL_PUBLICATION_ARTIFACT_SCOPE=PASS`

### 8. MCP name impact map (no rename performed)

`MCP_NAMES_CURRENT`: `siteborne_company_evidence_graph`,
`siteborne_web_context_verified`, `siteborne_document_evidence_json`,
`siteborne_verify_agent_output`, `siteborne_get_quote`,
`siteborne_get_service_health`. Read from
`packages/protocol-mcp/src/constants.ts`.

References in non-report, non-worktree files:

| Where                   | Detail                                                                                                                                                                                                                                                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP registry / dispatch | `constants.ts` (`MCP_SERVICE_TOOLS`, `MCP_TOOL_NAMES`), `server.ts` (registration, tools/list, tools/call)                                                                                                                                                                                                            |
| VCM                     | `current-exposure.ts` (utility names hard-coded), `projections/mcp-real-context.ts`, tests                                                                                                                                                                                                                            |
| Security declaration    | `declaration.ts` utility binding ids `mcp:siteborne_get_quote` / `mcp:siteborne_get_service_health`; `apps/edge-api/.../security-publication.ts` `UTILITY_TOOL_NAMES`. Paid tools are bound by **service id** and mapped to tool names at runtime via `MCP_SERVICE_TOOLS`, so a rename follows automatically for them |
| A2A card                | none (skills use service ids); one prose mention in `apps/network-site/docs/a2a`                                                                                                                                                                                                                                      |
| OpenAPI / catalog       | none                                                                                                                                                                                                                                                                                                                  |
| Pinned / generated      | `packages/protocol-mcp/fixtures/mcp-spec-baseline.json` (6 names; checked by `mcp:spec:verify`)                                                                                                                                                                                                                       |
| Tests                   | `transport.test.ts`, `tdqs.test.ts`, `mcp-shadow.test.ts`, `mcp-route.test.ts`, `mcp-metadata-shadow-compare.test.ts`, `digests.test.ts`, `mcp-server/tests/stdio.test.ts`, the new tests                                                                                                                             |
| Scripts / packaging     | `scripts/test-worker-runtime.mts`, `packages/mcp-server/scripts/verify-packed-install.ts`                                                                                                                                                                                                                             |
| Docs                    | `docs/operations/MCP_TOOLS.md`, master directive, VCM plan, cutover runbook, network-site a2a page                                                                                                                                                                                                                    |
| Directory metadata      | `packages/mcp-server/server.json` lists no tool names                                                                                                                                                                                                                                                                 |

```
MCP_NAMES_AFFECT_SECURITY_DECLARATION_DIGESTS=YES  (utility binding ids and the utility-name list in edge composition; paid tools follow automatically)
MCP_NAMES_AFFECT_AGENT_CARD=NO
MCP_NAMES_AFFECT_OPENAPI=NO
MCP_NAMES_AFFECT_CATALOG=NO
MCP_NAMES_AFFECT_OTHER_PUBLIC_HASHES=mcp-spec-baseline.json fixture; served tools/list and tools/call; network-site a2a page text (static hash parity)
```

Note for the naming checkpoint: no committed hash covers the security
declaration itself today, but the declaration content changes if utility tool
names change, and the security-publication utility list and the VCM
`current-exposure.ts` list must change together.

### 9. Static qualification

- Typecheck (repo-wide): pass. Prettier on all changed files: pass. ESLint on
  all changed files: no errors (one `import()` type annotation was fixed).
- Secret scope verify, working-tree scan and full-history gitleaks: no leaks.
- Broad suite, default concurrency: **exit nonzero** — 29 failed / 4003 passed,
  in five files: `load-v2.test.ts`, `production-cdp-full-stack-mock.test.ts`,
  `production-route-continuation-wiring.test.ts`,
  `worker-bridge.subprocess.test.ts`,
  `reconcile-payment-attempts.contract.test.ts`. All are timeout-shaped (5–60 s)
  under load.
- Isolated: the first four pass; `reconcile-payment-attempts.contract.test.ts`
  passes 38/38 alone.
- Broad suite, `--maxWorkers=3`: **exit nonzero** — 1 failed / 4031 passed; the
  single failure is `reconcile-payment-attempts.contract.test.ts` ("fresh
  exact-17 apply", a 5 s timeout), the known load-sensitive test. It touches no
  file changed here.
- Classification: `PRE_EXISTING` load-sensitivity, not a regression from this
  change. **The full suite is not reported green.**

### 10. Cloud mutation accounting

```
REAL_PAYMENT_ATTEMPTS=0
WORKER_UPLOADS=0
WORKER_DEPLOYMENT_MUTATIONS=0
PUBLIC_TRAFFIC_MUTATIONS=0
CLOUD_SECRET_MUTATIONS=0
```

Only `wrangler deploy --dry-run` was used (local build). No push.

### 11. Deferral and next step

Cloud publication (upload, exact-version qualification, production-key JWS
verification against production JWKS, MCP/A2A/OpenAPI/catalog live parity) is
withheld until `MCP-CANONICAL-TOOL-NAMING-01`. Renaming after this point changes
the utility bindings and the served surfaces, so it must precede the upload to
avoid publishing twice.

`NEXT_RECOMMENDED_CHECKPOINT=MCP-CANONICAL-TOOL-NAMING-01`

---

## Part B — immutable upload, 0% deployment, live readback

Status: **PASS (0%-traffic candidate qualified; not promoted)**

### Identity

| Item                          | Value                                      |
| ----------------------------- | ------------------------------------------ |
| Candidate Worker version      | `3b35f9e7-6fb8-47e4-acff-c5736eff6da6`     |
| Tag                           | `security-declarations-publication-01`     |
| Source commit                 | `182bfb5f4473c904ddaefb113f69a15979f68144` |
| Ordinary production (100%)    | `369b4bf5-c2f7-4e05-8454-7f5514a3bd45`     |
| Removed old canary (was 0%)   | `0456f44c-1c28-4919-9fdb-ab4673bac8f6`     |
| Continuation host (unchanged) | `9b1e9b10-beed-4ff3-914c-2221aada9b45`     |
| Deployment created            | 2026-09-21T01:16:52Z                       |

Rollback target (not needed): `369b4bf5` = 100%, `0456f44c` = 0%.

### Deployment

Operator-executed `wrangler versions deploy` placed `369b4bf5@100` and
`3b35f9e7@0`. `wrangler deployments status` confirmed the state read-back.

### Frozen MCP names (candidate, exact-version)

`siteborne_build_company_evidence_graph`,
`siteborne_retrieve_verified_web_context`,
`siteborne_extract_document_evidence_json`, `siteborne_verify_agent_output`,
`siteborne_get_quote`, `siteborne_get_service_health` (6 tools). Ordinary
production (no override) still advertises the six historical names. `tools/call`
with a legacy name on the candidate returns `Tool … not found`
(`NO_COMPATIBILITY_ALIAS`, as decided). Legacy names advertised by candidate: 0.

### Gate results

| Gate                                        | Result                                                                      |
| ------------------------------------------- | --------------------------------------------------------------------------- |
| Exact-version attribution                   | PASS — `wrangler tail --version-id`: 50/50 records `3b35f9e7`, 0 exceptions |
| Health                                      | PASS — `/health` 200                                                        |
| MCP `tools/list` / `tools/call`             | PASS — 6 frozen names; `get_service_health` call OK                         |
| Security metadata on MCP                    | PASS — `net.siteborne/securityDeclaration` + `/security` on all 6           |
| A2A Agent Card + JWS                        | PASS — signature verified against live JWKS (public key only)               |
| OpenAPI                                     | PASS — `x-siteborne-security-declaration` + 4 `/v2` op extensions           |
| Catalog                                     | PASS — `security_declaration` ref + security block on 8 services            |
| Cross-surface parity                        | PASS — 36 entries, 0 value conflicts; `dataFlow` consistent                 |
| Private-IP leak scan (repo `LEAK_PATTERNS`) | PASS — 1,630 strings, 0 leaks                                               |
| Unpaid admission regression                 | PASS — see below                                                            |
| Carrier flags non-public                    | PASS — flag names absent from all public payloads; diag paths 404           |
| Production invariants                       | PASS — 100% on `369b4bf5`; continuation host unchanged                      |
| Rollback rule                               | Not triggered                                                               |
| Live TDQS                                   | NOT_YET_OBSERVABLE (not re-run per directive)                               |

#### Unpaid admission (candidate via override vs. production)

- `/v1/*` and `/v2/company/*`, `/v2/document/*`: 404 on both.
- `/v2/web/context`, `/v2/verify/agent-output`: schema-invalid body → 400;
  schema-valid, no payment → **402** `payment_required` with x402 v2
  `payment-required` header. Production: 404.
- No provider work, no settlement, no payment attempted.

### Findings to carry forward

1. **Candidate carries `PAID_ROUTES_ENABLED=true`** (as did the retired canary).
   Candidate `/ready` reports `production_services_enabled:true` / "paid
   services active"; production reports `false`. Promoting `3b35f9e7` would
   therefore also activate the two paid routes. This is an activation decision,
   not a metadata-only change. Reachable only via version override at 0%.
2. **Legacy MCP tool names return unknown-tool** on the candidate. Revisit only
   if external callers of the old names exist.
3. **Unpaid 402 probes issue quotes** (`qte_…`) which may be persisted; two were
   issued. No payment followed.
4. Declaration reports `company_evidence_graph.v2` `available:false` /
   `UNSUPPORTED`; `web_context_verified.v2/direct` and
   `verify_agent_output.v2/standard` `IMPLEMENTED_ENFORCED`. Declaration matches
   actual qualification.

### Cloud mutation accounting

```
WORKER_UPLOADS=1
WORKER_DEPLOYMENT_MUTATIONS=1
PUBLIC_TRAFFIC_MUTATIONS=0
CLOUD_SECRET_MUTATIONS=0
REAL_PAYMENT_ATTEMPTS=0
CANDIDATE_ROLLBACK_EXECUTED=NO
```

Next recommended checkpoint: `FINAL-PAID-PRODUCTION-ACTIVATION-01`.
