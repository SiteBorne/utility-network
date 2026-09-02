# SUN-1222B-S3-R3-RS — MCP interoperability hardening, repo/spec-only rebase

**Status: PASS.** No genuine MCP interoperability defect was found in the current repository. Every previously-claimed failure class (`initialize` rejection, protocol negotiation, `Mcp-Method` header behavior) is proven — by direct execution against the real Hono app, not by narration — to already be handled correctly, either by the `legacy: 'stateless'` fix already on `main` (commit `88078b9`) or by the installed MCP SDK's own SEP-2243 standard-header contract, which SITEBORNE never overrides. The only real gap this checkpoint closed was **test coverage**, not behavior: 13 new regression tests now lock in cases that were previously true but unproven in this repo (`Mcp-Method` absence specifically, the HTTP method matrix, the content-type matrix, and several JSON-RPC envelope edge cases).

This is a rebase of the blocked **SUN-1222B-S3-R3** checkpoint. That checkpoint could not proceed past its own §2 because the "2000-event Cloudflare capture with T0–T25 analysis" it was meant to validate against was never persisted anywhere retrievable this session — not as a repo file, not in full inside any conversation bookmark. Per this checkpoint's own explicit instruction, that gap is **not** patched over here: every traffic-derived claim from that missing addendum (client identities, event counts, the T0–T25 findings, the specific P0 ranking) is carried forward as `UNVERIFIED`, not `PROVEN` or `DISPROVEN`.

## 0–1. Start-state reconciliation

```
$ git rev-parse HEAD
b3878f5e7007f1867ee237bf1feab143c2b1ac16
$ git merge-base --is-ancestor b3878f5 HEAD && echo YES
YES
$ git status --porcelain
(empty)
$ git log --oneline b3878f5..HEAD
(empty)
```

```
R3_RS_START_HEAD=b3878f5e7007f1867ee237bf1feab143c2b1ac16
B3878F5_REACHABLE=YES
WORKING_TREE_CLEAN=YES
```

No commits landed between the blocked R3 checkpoint and this one; HEAD is exactly `b3878f5`.

## 2. Frozen evidence limitation

```
RAW_TRAFFIC_DATASET_AVAILABLE=NO
TRAFFIC_DERIVED_CLIENT_IDENTITIES=UNVERIFIED
TRAFFIC_DERIVED_EVENT_COUNTS=UNVERIFIED
TRAFFIC_DERIVED_T0_T25_FINDINGS=UNVERIFIED
TRAFFIC_DERIVED_P0_RANKING=UNVERIFIED
```

Nothing below treats any of the above as a premise. Every finding in this report traces to one of: installed SDK source/types, the MCP spec the SDK implements, or a request this checkpoint actually executed against the real `createSiteborneMcpHonoApp` in this repo.

## 3. The actual MCP implementation

| File | Symbol | Responsibility |
|---|---|---|
| [`packages/protocol-mcp/src/server.ts`](../../packages/protocol-mcp/src/server.ts) | `createSiteborneMcpServer` | Builds one `McpServer` instance (fresh per request), registers the four paid tools + `siteborne_get_quote` + `siteborne_get_service_health`. Owns the payment-boundary gate and hostile-key rejection. |
| same | `createSiteborneMcpHandler` | Wraps `@modelcontextprotocol/server`'s `createMcpHandler(..., { legacy: 'stateless' })`. Owns exactly one piece of pre-SDK logic: a `containsHostileObjectKey` pass on the raw POST body before handing off. |
| same | `createSiteborneMcpHonoApp` | Wraps `@modelcontextprotocol/hono`'s `createMcpHonoApp` (Host/Origin validation) and mounts the handler at `app.all('/mcp', ...)`. |
| [`apps/edge-api/src/routes/mcp.ts`](../../apps/edge-api/src/routes/mcp.ts) | `mcpRoute` | The production-relevant HTTP entry (`app.all('/mcp', mcpRoute)` in `index.ts`). Enforces a 1 MiB streamed-read body cap (`MCP_MAX_REQUEST_BYTES`) before the SDK ever sees the body, resolves per-service runtime status for the health tool, and — critically — **never overrides `serviceBoundary`**, so every request goes through protocol-mcp's `defaultBoundary`, which unconditionally returns `payment_required`. |
| `@modelcontextprotocol/server@2.0.0` (installed, not vendored) | `createMcpHandler`, `classifyInboundRequest`, `validateStandardRequestHeaders` | Owns all transport-level behavior: era classification (legacy 2025-11-25 vs. modern 2026-07-28), JSON-RPC envelope/shape validation, the `Mcp-Method`/`Mcp-Name` standard-header contract (SEP-2243), and error-code/HTTP-status mapping. SITEBORNE code never reimplements or bypasses any of this. |
| `@modelcontextprotocol/hono@2.0.0` (installed) | `createMcpHonoApp` | Host-header DNS-rebinding protection, parsed-body passthrough. |

## 4. Pinned SDK version

```
MCP_SDK_PACKAGE=@modelcontextprotocol/server + @modelcontextprotocol/hono
MCP_SDK_VERSION=2.0.0 (both; pnpm-lock.yaml confirms the same resolution package.json declares)
MCP_HANDLER_API=createMcpHandler(factory, { legacy }) -> { fetch(Request): Promise<Response> }
SDK_DEFAULT_LEGACY_MODE='stateless' (per the SDK's own doc comment on ProtocolOptions/createMcpHandler)
SITEBORNE_CONFIGURED_LEGACY_MODE='stateless' (server.ts:384, matches the SDK default; set explicitly, not left implicit, per the SUN-1222A code comment)
```

`@modelcontextprotocol/server` v2 implements the [2026-07-28 MCP spec](https://modelcontextprotocol.io/specification/2026-07-28) per its own README, with documented legacy-era (2025-11-25 family) compatibility serving.

## 5. Re-proving the `legacy: 'stateless'` fix

```
MCP_LEGACY_MODE_CURRENT=stateless
```

Source: `packages/protocol-mcp/src/server.ts:384`, unchanged since commit `88078b9` ("fix(mcp): serve the 2025-11-25 legacy handshake instead of rejecting it"). Proven live by execution, not just by reading the option:

```
$ pnpm --filter @siteborne/protocol-mcp test
 ✓ src/transport.test.ts (37 tests)
   ✓ 2025-11-25 legacy handshake compatibility (SUN-1222A)
     ✓ answers a bare 2025-11-25 `initialize` request (no envelope, no version header)
     ✓ answers a bare legacy `tools/list` request with the six frozen tools
     ✓ still serves the modern 2026-07-28 envelope path unchanged alongside legacy
```

No scanner-specific branch exists anywhere in `server.ts` — both eras are served through the identical `createSiteborneMcpServer` factory.

## 6–7. Protocol families and initialize matrix (executed, not assumed)

Every row below was captured by sending the actual request through `createSiteborneMcpHonoApp(...).request('/mcp', ...)` in this repo and reading the real response (see `packages/protocol-mcp/src/transport.test.ts`, describe block `protocol interoperability hardening matrix (SUN-1222B-S3-R3-RS)`, plus the pre-existing `2025-11-25 legacy handshake compatibility` block).

| Request class | HTTP status | JSON-RPC result | Classification |
|---|---|---|---|
| Legacy `initialize`, no envelope, no version header | 200 | `result` with `protocolVersion`, `serverInfo` | `SUPPORTED` (legacy stateless) |
| Legacy `tools/list`, no prior `initialize` | 200 | `result.tools` (6 tools) | `SUPPORTED` (stateless — no session required) |
| Legacy `initialize`, well-formed but unrecognized `protocolVersion` (`'1999-01-01'`) | 200 | `result.protocolVersion: '2025-11-25'` (counter-offer) | `COMPATIBILITY_SUPPORTED` — SDK-documented fallback-to-first-2025-entry behavior, not a rejection |
| Legacy `initialize`, malformed `protocolVersion` (wrong JSON type) | 200 (JSON-RPC error inside) | `error.code: -32603` with a zod validation message | `INTENTIONALLY_REJECTED` at the JSON-RPC layer; boundary never called |
| Modern envelope request, correct headers | 200 | normal result | `SUPPORTED` |
| Modern envelope request, unsupported `MCP-Protocol-Version` (`'2099-01-01'`) | 400 | `error.code: -32022` | `INTENTIONALLY_REJECTED` (pre-existing test, unchanged) |
| Modern envelope request, unknown method | 404 | `error.code: -32601` | `INTENTIONALLY_REJECTED` (pre-existing test) |

`INITIALIZE_FAILURE_COUNT` against the current repo, for any request shape actually reproducible from spec/SDK knowledge: **0**. The one "failure" case (malformed protocolVersion type) is a client-input validation error, not an interoperability defect — a real 2025-era client sending a spec-conformant `initialize` is never rejected.

## 8. `Mcp-Method` / `Mcp-Name` header audit — the checkpoint's central question

**Where it originates:** SEP-2243 "Standard Request Headers." The installed `@modelcontextprotocol/server@2.0.0` SDK's own bundled source (`dist/src-CX2iR2pK.mjs`, function `validateStandardRequestHeaders`) implements it directly:

```js
if (request.mcpMethodHeader === void 0)
  return crossCheckMismatch("method-header-missing", "(missing)",
    `the body names method ${method} but the required Mcp-Method header is absent`,
    "standard-header-validation");
```

**Whether MCP requires it:** Yes — but only for **modern-classified** (2026-07-28 per-request-envelope) requests. The SDK's own doc comment is explicit: *"Never enforced on legacy traffic — the entry only calls this on a modern route."* Confirmed live: every legacy-path request in this repo's test suite (no envelope, no `Mcp-Method` header at all) succeeds; the header is genuinely optional there.

**Whether the SDK consumes it:** Yes, unconditionally, inside `classifyInboundRequest`/`validateStandardRequestHeaders` — SITEBORNE code never touches `request.headers.get('mcp-method')` itself. `createSiteborneMcpHandler`'s only pre-SDK step is a hostile-object-key scan of the parsed body; it passes the raw `Request` straight to `handler.fetch(request)`.

**Whether SITEBORNE ignores/requires/rejects it:** SITEBORNE does none of these itself — it delegates entirely to the SDK's contract. This matters directly for this checkpoint's constraint: *"Do NOT create a scanner-specific header hack. If support is required, implement through protocol-general semantics."* There is nothing to implement — protocol-general semantics are already the only thing running.

**Whether adding/supporting it differently would alter security semantics:** Yes, negatively. `Mcp-Name` cross-checks the header against `params.name`/`params.uri` on `tools/call`/`prompts/get`/`resources/read` — this is a real anti-confusion control (SEP-2243's purpose is letting a reverse proxy or gateway route/audit by header without parsing the JSON-RPC body, and catching a body/header disagreement that would otherwise silently dispatch the wrong tool). Weakening it to tolerate absence on modern requests would reopen exactly that class of confusion.

Executed proof, new test (`fails closed when the required Mcp-Method header is entirely absent on a modern request`):
```
POST /mcp, modern envelope, Mcp-Method header omitted
→ 400, error.code -32020, boundary.execute NOT called
```

```
MCP_METHOD_HEADER_CONTRACT=SEP-2243 standard-header validation, owned entirely by @modelcontextprotocol/server@2.0.0
MCP_METHOD_HEADER_REQUIRED=YES (modern-classified requests only; never required on legacy)
HEADER_BODY_DISAGREEMENT_BEHAVIOR=400, JSON-RPC -32020 (HeaderMismatch), boundary never invoked
MCP_METHOD_HEADER_DEFECT=NOT_A_DEFECT
```

This is the direct answer to the earlier addendum's headline P0 claim, evaluated on the only axis available this session (repo/spec, not the missing traffic): **the behavior the addendum flagged is already correct and already SDK-enforced.** Whether any specific real client actually hit this in production remains `UNVERIFIED` — that requires the still-missing raw capture (see §12/next steps).

## 9–11. HTTP method / content-type / JSON-RPC envelope matrices

All executed against the real fixture app; all now permanently regression-tested in `transport.test.ts`.

| Case | Result |
|---|---|
| `GET /mcp` | 405, boundary not called |
| `HEAD /mcp` | 405, boundary not called |
| `OPTIONS /mcp` | 405, boundary not called |
| POST, no `Content-Type` | 415, boundary not called |
| POST, `Content-Type: text/plain` | 415, boundary not called |
| POST, `Content-Type: application/json; charset=utf-8` | 200 (charset-qualified accepted) |
| Notification (no `id`) | 202, boundary not called |
| `jsonrpc: '1.0'` (wrong version) | 400, `-32600`, boundary not called |
| Non-object `params` | 400, `-32600`, boundary not called |
| `id: null` | 400, `-32600`, boundary not called |
| Oversized body (>1 MiB) | 413, at the `apps/edge-api/src/routes/mcp.ts` streaming-read layer, before the SDK ever runs (pre-existing coverage: `apps/edge-api/tests/mcp-route.test.ts`) |

```
MCP_HTTP_METHOD_MATRIX=PASS
MCP_CONTENT_TYPE_MATRIX=PASS
MCP_JSONRPC_MATRIX=PASS
```

`GET /mcp → 405` is correct by design (POST is the only intended transport for this streamable-HTTP server) and is not classified as a defect, per this checkpoint's own §9 instruction.

## 12–13. Four-service tool inventory and schemas

```
MCP_TOOL_COUNT=6 (4 paid services + siteborne_get_quote + siteborne_get_service_health)
```

Exact mapping, from `packages/protocol-mcp/src/constants.ts` (`MCP_SERVICE_TOOLS`), proven live by `client.listTools()` in the test suite:

| Tool name | Service ID |
|---|---|
| `siteborne_company_evidence_graph` | `company_evidence_graph.v2` |
| `siteborne_web_context_verified` | `web_context_verified.v2` |
| `siteborne_document_evidence_json` | `document_evidence_json.v2` |
| `siteborne_verify_agent_output` | `verify_agent_output.v2` |

No `.v1` tool exists anywhere in `MCP_SERVICE_TOOLS`; no tool silently maps to v1.

```
SERVICE_TOOL_MATRIX_V2_EXACT=PASS
```

Input/output schemas are the frozen contracts in `frozen-contracts.ts`, validated by `frozen-contracts.test.ts` (8 tests, unchanged, still green) and exercised end-to-end by `transport.test.ts`'s `it.each(SERVICE_TOOL_MATRIX)` block, which also proves `rejects invalid service input at the SDK schema boundary without execution` and `rejects unknown tools, unsupported quote modes, hostile keys, and production spoofing`.

## 14. Payment-gated fail-closed regression

`apps/edge-api/src/routes/mcp.ts` never passes a `serviceBoundary` override — every request through the production route uses protocol-mcp's `defaultBoundary`, which unconditionally returns:
```js
{ outcome: 'payment_required', code: 'payment_required', message: '... requires the accepted SITEBORNE x402 paid-service boundary', details: { free_execution_enabled: false } }
```
This is structural, not conditional — there is no code path in the MCP route that could reach a paid executor. Confirmed by `apps/edge-api/tests/mcp-route.test.ts`'s `does not expose useful service execution without the paid boundary`, and by every `transport.test.ts` case that asserts `boundary.execute).not.toHaveBeenCalled()` on a malformed/rejected request.

```
UNPAID_PROVIDER_INVOCATIONS=0
MCP_UNPAID_PROVIDER_INVOCATIONS=0
```

## 15. Stateless semantics

`legacy: 'stateless'` means, in the installed SDK: each request (legacy or modern) is served by a **fresh, isolated `McpServer` instance** built by the same factory — no session ID, no server-side connection state carried between requests. Proven, not assumed, by `uses a fresh server instance for every modern request and never exposes a session id` and `keeps two clients metadata-isolated and reconstructs repeated stateless results` (both pre-existing, both green): two concurrent clients' tool-call contexts never cross-contaminate, and a `tools/list` sent with no prior `initialize` on the same connection still succeeds.

```
MCP_STATELESS_SEMANTICS=PASS
STATELESS_DEPLOYMENT_COMPATIBILITY=PASS
```

## 16. Response framing

Legacy-era responses may arrive as `text/event-stream` (SSE-framed) rather than a bare JSON body — both this repo's tests and a real legacy client must handle either. The shared `readJsonRpcResult` helper (hoisted to module scope in this checkpoint so both the SUN-1222A suite and the new R3-RS matrix use one implementation) parses both shapes from the actual response rather than assuming one.

```
MCP_RESPONSE_FRAMING_MATRIX=application/json (modern, most legacy POSTs without SSE negotiation) | text/event-stream (legacy initialize/negotiated) — both handled, both tested — PASS
```

## 17. Generic client compatibility classes (replaces the missing client-name matrix)

Per this checkpoint's explicit instruction not to name specific external clients without independently-verified traffic evidence:

| Class | Result |
|---|---|
| `MODERN_STATELESS_CLIENT` (per-request envelope, correct `Mcp-Method`/`MCP-Protocol-Version`) | WORKS |
| `COMPATIBLE_INITIALIZE_CLIENT` (2025-11-25 `initialize` → `notifications/initialized` → `tools/list`, no envelope) | WORKS |
| `TOOLS_LIST_ONLY_CLIENT` (bare `tools/list`, no prior `initialize`, stateless) | WORKS |
| `LEGACY_SESSION_EXPECTING_CLIENT` (expects a server-assigned session id to persist across requests) | `UNPROVEN` — the installed SDK's stateless legacy fallback issues no session id by design; a client that *requires* one to function is not supported by this deployment posture, and no evidence (traffic or otherwise) proves any real client actually requires it |
| `MALFORMED_SCANNER` (wrong JSON-RPC version, non-object params, oversized body) | `FAILS_BY_DESIGN` (400/413, fail-closed, never reaches the boundary) |

```
GENERIC_CLIENT_COMPATIBILITY_MATRIX=PASS
```

## 18. Spec cross-check

`@modelcontextprotocol/server@2.0.0`'s own README states it implements the [2026-07-28 MCP specification](https://modelcontextprotocol.io/specification/2026-07-28), with a documented, intentional 2025-11-25 legacy compatibility mode (not a newer/older spec substitution — both eras are first-class per the SDK's own type system, `ProtocolEra = 'legacy' | 'modern'`). No code in this repo was changed to chase a newer spec revision; the existing `legacy: 'stateless'` choice already matches the SDK's documented default and this checkpoint found no reason to deviate from it.

## 19. Live external probe

Not executed. The authorization for this checkpoint permits "safe non-economic public production probes... where required for evidence," but every finding above was fully provable from repo/SDK/spec evidence alone — no live call was needed to reach a conclusion, so none was made, consistent with minimizing outward-facing action to what's actually necessary.

```
REPO_BEHAVIOR=proven throughout this report (executed against the real Hono app)
PRODUCTION_BEHAVIOR=NOT_EXECUTED (no live probe made; not needed for this checkpoint's conclusions)
```

## 20–21. Defect standard and TDD

No case in this report met the genuine-defect bar (§20: executed reproducer contradicting the repo, contradiction with the installed SDK/spec, a deterministic wrong-branch, or a live response proving deployed-wrong behavior). Consequently there is **no RED→fix→GREEN cycle in this checkpoint** — there was nothing to fix. What *was* missing was regression coverage locking in already-correct behavior, which this checkpoint added and mutation-proved instead (see below), rather than manufacturing a defect narrative to fit the RED/GREEN template.

### Mutation-proof of the new coverage

Three of the new assertions were temporarily flipped to a wrong expected value, confirmed to fail, then restored and reconfirmed green — proving the new tests actually discriminate rather than being tautological:

```
Mutation 1: `expect(response.status).toBe(405)` → `.toBe(200)` on the GET/HEAD/OPTIONS matrix
Mutation 2: `expect(payload.error.code).toBe(-32020)` → `.toBe(-32021)` on the Mcp-Method-absent test
Mutation 3: `expect(payload.error).toBeUndefined()` → `.toBeDefined()` on the legacy counter-offer test

$ npx vitest run src/transport.test.ts
 Test Files  1 failed (1)
      Tests  5 failed | 32 passed (37)     ← RED, all 3 mutations caught (5 cases: it.each expands to 3)

$ diff /tmp/transport.test.ts.orig-backup src/transport.test.ts   # exactly the 3 injected lines, nothing else
$ npx vitest run src/transport.test.ts
 Test Files  1 passed (1)
      Tests  37 passed (37)                ← GREEN, byte-for-byte restore confirmed by diff
```

## 22. Full MCP gate

```
$ pnpm --filter @siteborne/protocol-mcp run check
format:check  PASS
lint          PASS
typecheck     PASS
build         PASS (dist/index.js 2.4 MiB)
test          PASS — 46 tests (3 files: transport.test.ts 37, frozen-contracts.test.ts 8, transport.property.test.ts 1)
test:property PASS — 46 tests
spec:verify   PASS — "MCP spec fixture OK: 2026-07-28, 3 SDK pins, 6 tools"

$ npx vitest run apps/edge-api/tests/mcp-route.test.ts apps/edge-api/tests/mcp-registry-auth.test.ts \
    apps/edge-api/src/control-plane/artifacts/document-upload.test.ts \
    apps/edge-api/src/control-plane/routes/document-artifact-upload-route.test.ts \
    apps/edge-api/src/control-plane/production/document-evidence-json-v2-production-executor.test.ts \
    apps/edge-api/src/control-plane/production/document-evidence-json-v2-cdp-composition.test.ts
 Test Files  6 passed (6)
      Tests  50 passed (50)
```

```
PROTOCOL_MCP_TESTS=46 passed
EDGE_API_MCP_TESTS=9 passed (mcp-route.test.ts 5, mcp-registry-auth.test.ts 4)
MCP_PACKAGE_CHECK=PASS
```

## 21 (cont.). §21 document R2 non-regression (checkpoint §21)

The four document-upload test files (`document-upload.test.ts`, `document-artifact-upload-route.test.ts`, `document-evidence-json-v2-production-executor.test.ts`, `document-evidence-json-v2-cdp-composition.test.ts`) all pass unchanged — **41 tests**, none touched by this checkpoint's changes.

```
DOCUMENT_R2_REGRESSION=PASS
```

## 23. Full repo gate

```
$ pnpm run typecheck        → 23/23 packages, PASS (turbo, no cache misses failing)
$ pnpm run lint              → 16/16 packages, PASS
$ pnpm run format:check      → FAIL — 439 pre-existing files outside this checkpoint's scope
                                (none touched by SUN-1222B-S3-R3-RS; `transport.test.ts` itself
                                is prettier-clean, confirmed separately). This drift predates
                                this checkpoint and is reported honestly rather than silently
                                fixed under an unrelated changeset.
$ npx vitest run              → 222 files passed, 22 skipped (live/paid, correctly gated off);
                                2690 tests passed, 74 skipped; 0 failed
$ gitleaks detect --source .  → committed history (653 commits): "no leaks found"
                                (working-tree-only scan flags 2 entries in .dev.vars — gitignored,
                                untracked, local dev credentials, pre-existing, unrelated to this
                                checkpoint's changes)
$ pnpm run production:preflight → PASS (12/12 paid routes structurally unavailable before
                                economics; production imports no fixture executor; zero
                                mutating Cloudflare calls)
$ npx wrangler deploy --dry-run → succeeds, bundles 6420.47 KiB, exits before upload
                                ("--dry-run: exiting now.")
$ pnpm run schemas:check      → PASS (input/output validators up to date)
$ pnpm run services:generate:check → PASS ("ALL 18 MODELS MATCH - NO DRIFT")
$ pnpm run governance:validate → PASS (77/77)
$ pnpm run state:validate     → PASS (30/30)
$ pnpm run tasks:validate     → PASS (252/252)
```

```
TYPECHECK=PASS (23/23 packages)
BUILD=PASS (protocol-mcp build verified directly; wrangler dry-run bundles the Worker successfully)
LINT=PASS (16/16 packages)
TEST_FILES=222 passed, 22 skipped (244 total)
TESTS_PASS=2690
TESTS_SKIPPED=74
SECRETS_SCAN=PASS (git history clean; .dev.vars pre-existing/gitignored, out of scope)
PRODUCTION_PREFLIGHT=PASS
WRANGLER_DRY_RUN=PASS
SCHEMAS_CHECK=PASS
SERVICES_GENERATE_CHECK=PASS
GOVERNANCE_CHECK=PASS (governance 77/77, state 30/30, tasks 252/252)
```

`format:check` is the one FAIL in this gate, and it is pre-existing repo-wide drift (439 files, none in this checkpoint's diff) — reported per this checkpoint's own instruction not to hide pre-existing failures, not silently fixed under this changeset's scope.

## 24. No live-status overclaim

```
db7054c9 remains the current production Worker version until separately changed by a future, separately-authorized checkpoint.
Every fix/coverage change in this checkpoint is REPO_READY, not DEPLOYED.
document_evidence_json.v2 upload-reference path (SUN-1222B-S3-R2): still REPO_READY, not yet PRODUCTION_LIVE — unaffected by this checkpoint.
```

## 25/28. Future traffic supplement

If the original raw 2000-event capture is ever recovered (as a file, a re-paste, or any other retrievable form), it should be validated as **SUN-1222B-S3-R3T-TRAFFIC-VALIDATION-SUPPLEMENT**, comparing real observed client behavior against the compatibility matrix this report establishes. This checkpoint's conclusions do not depend on that future work — every repo/spec-level MCP defect the earlier addendum could plausibly have been describing is already closed.

## 26. Final packet

```
SUN1222B_S3_R3_RS=PASS
R3_RS_START_HEAD=b3878f5e7007f1867ee237bf1feab143c2b1ac16
R3_RS_END_HEAD=6b7a7ea293678b55e23e669e8cb8cafabfcd9fe8
RAW_TRAFFIC_DATASET_AVAILABLE=NO
TRAFFIC_DERIVED_CLIENT_IDENTITIES=UNVERIFIED
TRAFFIC_DERIVED_EVENT_COUNTS=UNVERIFIED
TRAFFIC_DERIVED_T0_T25_FINDINGS=UNVERIFIED
MCP_SDK_PACKAGE=@modelcontextprotocol/server + @modelcontextprotocol/hono
MCP_SDK_VERSION=2.0.0
MCP_LEGACY_MODE_CURRENT=stateless
MCP_PROTOCOL_MATRIX=PASS
MCP_INITIALIZE_MATRIX=PASS
MCP_METHOD_HEADER_CONTRACT=SEP-2243 standard-header validation, SDK-owned
MCP_METHOD_HEADER_REQUIRED=YES (modern-classified requests only)
MCP_HTTP_METHOD_MATRIX=PASS
MCP_CONTENT_TYPE_MATRIX=PASS
MCP_JSONRPC_MATRIX=PASS
MCP_RESPONSE_FRAMING_MATRIX=PASS
MCP_STATELESS_SEMANTICS=PASS
SERVICE_TOOL_MATRIX_V2_EXACT=PASS
UNPAID_PROVIDER_INVOCATIONS=0
GENERIC_CLIENT_COMPATIBILITY_MATRIX=PASS
REPLAY_VECTOR_COUNT=13 (new deterministic protocol-semantic cases; provenance: SDK for all — SEP-2243/JSON-RPC 2.0/HTTP semantics — none traffic-derived)
NEW_PROVEN_MCP_DEFECTS=0
NEW_MCP_FIX_COMMITS=0 (no fix needed; 1 test-coverage commit)
PROTOCOL_MCP_TESTS=46 passed
EDGE_API_MCP_TESTS=9 passed
MCP_PACKAGE_CHECK=PASS
TYPECHECK=PASS
FULL_REPO_TESTS=2690 passed, 74 skipped, 0 failed
LINT=PASS
BUILD=PASS
PRODUCTION_MUTATIONS=0
ECONOMIC_TRANSACTIONS=0
EVIDENCE_COMMIT_SHA=6b7a7ea293678b55e23e669e8cb8cafabfcd9fe8 (this report); 28e89b6 (test-coverage change)
WORKING_TREE=clean after commit
NEXT_REQUIRED_CHECKPOINT=SUN-1222B-S3-CONTINUE
OPTIONAL_SUPPLEMENT=SUN-1222B-S3-R3T-TRAFFIC-VALIDATION-SUPPLEMENT (only if the raw capture is recovered)
```

No source-code defect was found or fixed in the MCP transport this checkpoint — only test coverage was added (`packages/protocol-mcp/src/transport.test.ts`, +282/-29 lines, 13 new tests, mutation-proved). Because `MCP_MACHINE_BUYABILITY` reduces to `MCP_PROTOCOL_MATRIX ∧ SERVICE_TOOL_MATRIX_V2_EXACT ∧ UNPAID_PROVIDER_INVOCATIONS=0`, all PASS, and no P0 remains on the repo/spec axis (the only axis available this session):

```
NEXT_REQUIRED_CHECKPOINT=SUN-1222B-S3-CONTINUE
```
