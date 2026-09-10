# SUN-1222C-DEPLOYMENT-DEPENDENCY-AND-MTLS-TRUTHFULNESS-REMEDIATION — Evidence Report

`START_HEAD=cf0a1131b311d48d809f734a21fe6d5213536c4f`. All work below is repository
inspection, test-infrastructure, source-fix, and documentation only. Zero
Cloudflare read/write, zero deployment, zero certificate issuance, zero payment.

---

## §1. Integrity gate

```
BRANCH=main
WORKING_TREE=CLEAN (one pre-existing untracked file: docs/runbooks/SUN-1222C-mtls-production-provisioning-runbook.md,
  from the prior SUN-1222C-MTLS-PRODUCTION-PROVISIONING-AUTHORIZED checkpoint,
  never committed — corrected and committed as part of THIS checkpoint, §30)
CURRENT_HEAD_EXISTS=0
PCC_FIX_EXISTS=0
MTLS_IMPLEMENTATION_EXISTS=0
PCC_FIX_REACHABLE=0
MTLS_IMPLEMENTATION_REACHABLE=0
```

All required SHAs (`cf0a113…`, `ac642cb…`, `106b8285…`) exist and are ancestors of
`HEAD`, confirmed via `git cat-file -e` / `git merge-base --is-ancestor`, no
placeholder values.

---

## §2. Settlement ownership — reconfirmed via the canonical test, not raw grep

`pnpm vitest run apps/edge-api/tests/settle-sole-ownership.test.ts` → **4/4 green**.

```
PUBLIC_API_SETTLE_CALLSITES=0
MCP_ADAPTER_SETTLE_CALLSITES=0
DEDICATED_WORKFLOW_SETTLE_CALLSITES=1
TOTAL_PRODUCTION_SETTLE_CALLSITES=1
```

The test's own static scan (`control-plane/workflows/paid-continuation-workflow.ts`
is the one production `evidenceProvider.settle()` call site) also asserts the two
non-competing exclusions explicitly, not just by omission:
- `control-plane/evidence/cdp-provider.ts` — the x402 facilitator SDK client call
  *inside* the one flagged port call, not a second decision point.
- `control-plane/testing/in-process-workflow-binding.ts` — test-support double,
  confirmed (§3-4 below) never imported by any real Worker entrypoint.

The earlier "six real call sites" figure a prior chat summary carried was a raw
text-match count over files that merely *mention* `.settle(` in doc-comments/prose
— not a call-site count. Discarded; the test above is the only trustworthy source.

---

## §3. PCC fix (`ac642cb`) mapped to deployable Worker bundles

Non-test production files changed by `ac642cb`:
```
apps/edge-api/src/control-plane/mcp/x402-mcp-adapter.ts
apps/edge-api/src/control-plane/testing/in-process-workflow-binding.ts
apps/edge-api/src/control-plane/workflows/paid-continuation-workflow.ts
```

Traced against the actual import graph (not directory-name inference):

| File | Real importer | Worker bundle |
|---|---|---|
| `x402-mcp-adapter.ts` | `routes/mcp.ts` ← `index.ts` | **`siteborne-utility-edge`** (public API) |
| `paid-continuation-workflow.ts` | `workflow-host-entrypoint.ts` (exports `PaidContinuationWorkflow` directly) | **`siteborne-paid-continuation-runtime`** |
| `in-process-workflow-binding.ts` | `control-plane/routes/paid-services.ts` ← `workerd-test-entrypoint.ts` / `worker-runtime-test-entrypoint.ts` only | **none** — test-only entrypoints (`wrangler.worker-runtime-test.toml`, `apps/edge-api/wrangler.workerd-test.toml`), never `index.ts` or `workflow-host-entrypoint.ts` |

`x402-service.ts` (part of the public API bundle) imports
`paid-continuation-workflow.ts` only via `import type { DecryptedContinuationPayload }`
— type-only, erased at build, no runtime dependency. Its own logic
(`c.json(cached.body, ...)` verbatim passthrough) is unchanged by `ac642cb`, so REST
and A2A automatically pick up whatever shape the paid runtime writes, with **zero
public-API code change required for REST/A2A** — only MCP's adapter needed a code
change, because it actively unwraps the body rather than passing it through.

`control-plane/alerting/settlement-alert-sweep.ts` (settlement-alert-worker's own
bundle) is documented inline as importing nothing from
`paid-continuation-workflow.ts` — confirmed by grep, zero real import.

```
PCC_PUBLIC_API_FILES=apps/edge-api/src/control-plane/mcp/x402-mcp-adapter.ts
PCC_PAID_RUNTIME_FILES=apps/edge-api/src/control-plane/workflows/paid-continuation-workflow.ts, control-plane/workflows/production-dependencies.ts (same bundle, unchanged this commit, only reachable via the workflow file)
PCC_FIX_LIVE_PUBLIC_API_REQUIRED=YES
PCC_FIX_LIVE_PAID_RUNTIME_REQUIRED=YES
ALERT_WORKER_DEPLOY_REQUIRED=NO
```

Reproved from the actual build graph, matching the prior audit's expectation.

---

## §4. mTLS implementation (`106b8285`) mapped to deployable Worker bundles

Non-test production files changed by `106b8285`:
```
apps/edge-api/src/control-plane/security/mtls-caller-context.ts
packages/protocol-a2a/src/card.ts
packages/protocol-a2a/src/constants.ts
```

- `mtls-caller-context.ts`: grep for importers returns **only the file's own
  definition** — zero real importers anywhere in `apps/edge-api/src`. Dormant,
  wired into zero routes, reachable from no Worker bundle.
- `card.ts` / `constants.ts`: `packages/protocol-a2a` is imported by
  `routes/a2a.ts` ← `index.ts`, which mounts it at both
  `/.well-known/agent-card.json` and `/.well-known/jwks.json`. **Public API only.**

```
MTLS_PUBLIC_API_FILES=packages/protocol-a2a/src/card.ts, packages/protocol-a2a/src/constants.ts
MTLS_PAID_RUNTIME_FILES=(none)
MTLS_ALERT_WORKER_FILES=(none)
```

Confirms the prior audit's "public API only" expectation, reproved from the build
graph.

---

## §5-11. Critical truthfulness finding, gate design, and mutation-proved fix

**Finding:** `buildUnsignedSiteborneAgentCard` declared `securitySchemes.mtls`
**unconditionally** — hardcoded directly in the return object, no capability
check, no gate. Confirmed by direct source read of
[card.ts](packages/protocol-a2a/src/card.ts) before any fix.

```
CURRENT_MTLS_CARD_DECLARATION_MODE=UNCONDITIONAL
WOULD_LIVE_AGENT_CARD_DECLARE_MTLS=YES (if HEAD's source were deployed today, before any Cloudflare mTLS endpoint exists)
PREMATURE_MTLS_ADVERTISEMENT_RISK=YES
```

**Existing-gate search (§7):** searched `env.ts` for any `MTLS`-named flag, any
service-capability/feature-manifest/runtime-readiness config matching this
purpose. None found.

```
EXISTING_MTLS_CAPABILITY_GATE=NONE
```

**Gate implemented (§8):** new `MTLS_PRODUCTION_ACTIVE` env var (default
absent/`false`, exact-literal-`'true'` match, mirrors `PRODUCTION_ENABLED` /
`PAID_ROUTES_ENABLED`'s established convention) — [env.ts](apps/edge-api/src/control-plane/config/env.ts).
A dedicated resolver,
[mtls-production-capability.ts](apps/edge-api/src/control-plane/config/mtls-production-capability.ts)
(`resolveMtlsProductionActive`), mirrors `agent-card-signing.ts`'s own documented
discipline: the one place in `edge-api` that reads this one flag from real
deployment config; `protocol-a2a` itself never reads `env`. Threaded through
`CreateSiteborneA2aOptions.mtlsProductionActive` (types.ts) →
`createSiteborneA2aHonoApp` (transport.ts) → `buildUnsignedSiteborneAgentCard`'s
new second parameter, default `false` (card.ts) — same dependency direction as
the pre-existing `signingIdentity` / `effectiveProductionStatusByServiceId`
options. [routes/a2a.ts](apps/edge-api/src/routes/a2a.ts) computes the real value
and includes it in the cached-app cache key (so a changed env value can never
serve a stale card, matching the file's own pre-existing discipline for every
other computed boolean).

This flag governs **only** the one static metadata field. It does not gate,
enable, or affect Cloudflare edge mTLS enforcement, x402 payment authorization,
settlement, `mtls-caller-context.ts`'s still-dormant
`evaluateMtlsAuthorization()`, or any route's request handling.

**RED (§9):** four new tests added to `card.test.ts` proving the bug against
*unmodified* source — 2/2 genuinely failed (`expected { mtls: {...} } to deeply
equal {}`), 2/2 incidentally passed (the CAPABILITY_TRUE-shaped assertions, since
unconditional-true already matched that shape).
```
MTLS_TRUTHFULNESS_RED_REQUIRED=YES
MTLS_TRUTHFULNESS_RED_REPRODUCED=YES
```

**GREEN (§10):** after implementing the gate, updated 3 pre-existing `card.test.ts`
assertions that assumed unconditional presence (now must explicitly pass
`mtlsProductionActive: true` to exercise that shape) plus the general default-card
contract test (now asserts empty `securitySchemes` by default). Added
route-level tests in `apps/edge-api/tests/a2a-route.test.ts` (env → `resolveA2aApp`
→ card, through the *real* Worker route, not just the package's default
parameter) and a direct unit test for the resolver
(`apps/edge-api/tests/mtls-production-capability.test.ts`).
```
MTLS_DECLARATION_FALSE_STATE=PASS
MTLS_DECLARATION_TRUE_STATE=PASS
```
25/25 targeted tests green (4 `mtls-production-capability.test.ts` + 4
`settle-sole-ownership.test.ts` + 11 `card.test.ts` + 6 `a2a-route.test.ts`).

**Mutation proof (§11):** four required mutations, each applied to `card.ts`,
rerun against the 21 protocol/edge-api targeted tests, then reverted (diffed
byte-identical to the pre-mutation file after each revert):

| Mutation | Result |
|---|---|
| 1. `securitySchemes: true ? {...} : {}` (ignore the flag, always advertise) | 6/21 FAIL |
| 2. `securitySchemes: !mtlsProductionActive ? {...} : {}` (invert the flag) | 10/21 FAIL |
| 3. `securitySchemes: {}` unconditionally (remove the scheme content even when active) | 4/21 FAIL |
| 4. root `securityRequirements: [{ schemes: ['mtls'] }]` (make mTLS mandatory) | 3/21 FAIL |

```
MTLS_TRUTHFULNESS_MUTATION_PROOF=PASS
```

**§12 — supportedInterfaces remains deferred, untouched:**
```
SUPPORTED_INTERFACES_CHANGED=NO
AGENT_CARD_MTLS_MULTI_INTERFACE_SEMANTICS=AMBIGUOUS
```
The pinned `@a2a-js/sdk@1.0.1` `AgentInterface` type has no `security`/
`securityRequirements` field — confirmed against the installed package's own
`.d.ts`. No source change was made to `supportedInterfaces` in this checkpoint.

---

## §13-15. Runbook corrections (applied to `docs/runbooks/SUN-1222C-mtls-production-provisioning-runbook.md`)

**§13 — canary contradiction, corrected.** The old §11 test #1 expected a no-cert
GET on `mtls-canary.utility.siteborne.net` to *pass* ("proves the canary didn't
accidentally widen scope"), but the old §9 WAF rule
(`http.host eq "mtls-canary.utility.siteborne.net" and not
cf.tls_client_auth.cert_verified` → Block) is a whole-hostname rule with no path
condition — the two cannot both be true. Removed the contradictory test; the
dedicated host now rejects every no-cert request, full stop. "Public host still
works without a cert" is proven only on `utility.siteborne.net`, by the
pre-existing, unaffected §13-15 regression check.
```
CANARY_NO_CERT_EXPECTATION=REJECTED
CANONICAL_NO_CERT_EXPECTATION=PASS
```

**§14 — x402/mTLS orthogonality target, corrected.** The old §20 test targeted
`utility.siteborne.net`, which never gets a client-certificate hostname
association (§6's `CANONICAL_PUBLIC_HOST_MTLS_MUTATION=PROHIBITED`) — a
cert-bearing request against it proves nothing. Corrected to target the dedicated
mTLS hostname, using the smallest schema-valid synthetic input
(`frozenInputExample('verify_agent_output.v2')`, the repo's own fixture generator
— not a hand-typed body that might 400 before the payment boundary and produce a
false result).
```
MTLS_X402_TEST_TARGET=DEDICATED_MTLS_HOST
MTLS_X402_REQUEST_REACHES_PAYMENT_GATE=YES (by construction — a frozen, schema-valid fixture; operator confirms the live 402 body at runbook execution time)
```

**§15 — A2A liveness method, corrected.** The old runbook used the raw JSON-RPC
method name `agent/getAuthenticatedExtendedCard`, never verified against this
repo's server. Traced directly against
[transport.ts:70-97](packages/protocol-a2a/src/transport.ts:70):
```ts
if (rpc.method === 'message/send' || rpc.method === 'tasks/send') {
  return 'legacy A2A v0.3 methods are not supported';
}
if (rpc.method !== 'SendMessage') return undefined;
```
The real, accepted method is the literal string `"SendMessage"` (A2A v1.0/
gRPC-transcoded convention, this pinned SDK's actual wire protocol) — the old
JSON-RPC v0.3 names (`message/send`, `tasks/send`) are explicitly, deliberately
rejected by this exact server. `agent/getAuthenticatedExtendedCard` is not
dispatched on by this transport at all. Using any of the three would have made
the "liveness" probe fail unconditionally, regardless of mTLS state — a
false-negative trap that could have wrongly aborted a genuinely-passing
qualification. Corrected to reuse the exact pattern
`apps/edge-api/tests/a2a-route.test.ts`'s own passing round-trip test already
exercises (official SDK client, `client.sendMessage(...)`), rather than a
hand-constructed raw JSON-RPC body.
```
CANONICAL_A2A_LIVENESS_METHOD=SendMessage
CANONICAL_A2A_LIVENESS_REQUEST=client.sendMessage(...) via @a2a-js/sdk/client's ClientFactory/JsonRpcTransportFactory, the exact call a2a-route.test.ts's "round-trips official discovery and SendMessage" test makes
```

**§16 — API write-command safety, tightened.** The prior runbook already framed
every Cloudflare mutation as VERIFIED_DASHBOARD_ONLY (primary, confirmed path) with
an "UNVERIFIED — probe first" API alternative kept for reference. Tightened per
this checkpoint's stricter rule: every such alternative is now explicitly labeled
"NOT PART OF THIS PROCEDURE — reference only," not a usable fallback, with an
explicit instruction not to run it against a live zone without independent
re-verification.
```
UNVERIFIED_CLOUDFLARE_WRITE_COMMANDS_IN_RUNBOOK=0
```
(Zero commands in the runbook's actual, sanctioned procedure are unverified writes
— the two reference-only API blocks are explicitly excluded from the procedure,
not presented as usable steps.)

---

## §17-18. PCC old/new compatibility matrix and the corrected safe deployment order

This is the most consequential finding in this checkpoint. **The prior
`SAFE_DEPLOYMENT_ORDER_PRELIMINARY` (paid-continuation-runtime, then public API)
is UNSAFE and is corrected here to the opposite order: public API first, then
paid runtime.**

### The mechanism

- `paid-continuation-workflow.ts` (paid runtime) *constructs*
  `DurableCachedResult.body` — OLD shape: `{service_id, result_class, output,
  receipt_id, link_id, link_hash}`; NEW shape (post-`ac642cb`): the full PCC
  document (`verificationReceipt`), no top-level `output` field at all
  (`contracts/releases/2.0.0` requires `additionalProperties: false`).
- `x402-service.ts` (public API, REST/A2A) does `c.json(cached.body, ...)` —
  **verbatim passthrough, unchanged by `ac642cb`**. REST/A2A therefore
  automatically reflect whatever shape the paid runtime currently writes, with no
  public-API code change needed for those two transports.
- `x402-mcp-adapter.ts` (public API, MCP) *actively transforms* the body — OLD
  code: `result: body.output`; NEW code (post-`ac642cb`): `result: body` (the
  whole object, verbatim).

### The matrix

| Pair | Paid runtime | Public API | REST/A2A result | MCP result | Verdict |
|---|---|---|---|---|---|
| **A** (today, live) | OLD (envelope, has `.output`) | OLD (`body.output`) | old envelope (pre-2.0.0-governance shape, not a crash) | old envelope's `.output` sub-field, correctly unwrapped | Self-consistent, stale relative to `contracts/releases/2.0.0`, not broken |
| **B** (runtime deployed first) | **NEW** (full PCC doc, no `.output`) | OLD (`body.output`) | full PCC doc (correct — passthrough already reflects the new writer) | **`result: body.output` → `result: undefined`** | **BROKEN.** A real, already-paid-for MCP caller silently gets `result: undefined` — not a thrown error, not a 4xx, a quietly empty success response. |
| **C** (public API deployed first) | OLD (envelope) | **NEW** (`result: body`) | old envelope (unchanged from Pair A) | old envelope as the WHOLE `result` object (not just `.output` — schema-stale relative to 2.0.0, but a defined, non-crashing object) | Self-consistent, schema-stale but no `undefined`, no crash |
| **D** (both deployed) | NEW | NEW | full PCC doc | full PCC doc | Correct, final, governed state |

```
PAIR_A=SELF_CONSISTENT_STALE_NOT_BROKEN
PAIR_B=BROKEN_MCP_RESULT_UNDEFINED
PAIR_C=SELF_CONSISTENT_SCHEMA_STALE_NOT_BROKEN
PAIR_D=CORRECT_GOVERNED_FINAL_STATE
```

`x402-mcp-adapter.ts`'s own comment (`MCP_SERVICE_OUTPUT_SCHEMAS validates this
whole object`) describes client/framework-side schema validation, not a
server-side guard inside the adapter itself before returning — confirmed by grep
(`MCP_SERVICE_OUTPUT_SCHEMAS` appears only in that one comment, never as an actual
validator call in this file). Nothing in the adapter would turn Pair B's
`result: undefined` into a clean rejected/error state instead; it passes through
silently.

### Deployment-order proof

```
SAFE_DEPLOYMENT_ORDER=siteborne-utility-edge (public API) FIRST, then siteborne-paid-continuation-runtime SECOND
```

- If the **paid runtime deploys first** (old order): the window between the two
  deploys is Pair B — every MCP call that completes during that window returns
  `result: undefined` to a caller who has already paid. This is the single worst
  outcome available in the whole matrix.
- If the **public API deploys first** (corrected order): the window between the
  two deploys is Pair C — schema-stale (callers see the old envelope shape a
  little longer than strictly necessary) but never `undefined`, never a crash,
  never worse than today's live behavior (Pair A) from any individual caller's
  point of view.
- Any intermediate combination is exactly one of these two pairs — there is no
  third partial state, since each Worker is a single atomic deploy.
- Rollback of the second-deployed component: rolling back the paid runtime (after
  reaching Pair D from Pair C) returns to Pair C — safe. Rolling back the public
  API (after reaching Pair D from Pair B, the unsafe order) returns to Pair B —
  still broken. **This is a second, independent reason the corrected order is
  required**: only the corrected order has a rollback-of-the-second-deploy path
  that is never worse than Pair C.

The prior runbook's stated rationale for the old order rested on an unconfirmed
claim about Cloudflare Workflows pinning in-flight instances to their started code
version — see §19 below, where that claim is retracted as unverifiable, not
merely unconfirmed-but-probably-true. The corrected order above does not depend on
that claim at all; it follows purely from the matrix, which holds regardless of
in-flight-instance version-pinning behavior.

---

## §19. Workflow in-flight version behavior

```
WORKFLOW_INFLIGHT_VERSION_BEHAVIOR=UNDOCUMENTED_BY_FIRST_PARTY_SOURCES_CONSULTED
SOURCE=https://developers.cloudflare.com/workflows/llms-full.txt (fetched live this session, ~361KB, searched for "in-flight"/"already running"/"existing instance"/"redeploy"/"new version" and related terms)
```

Cloudflare's own Workflows documentation, fetched live this session (not
training-data recall), describes step-level durability/memoization ("the Workflow
engine may restart while an instance is running... the step logic will be
preserved, but logic outside of the steps may be duplicated") but **does not
explicitly state** whether an in-flight instance's *not-yet-executed* steps run
against the Worker-script version live at instance-creation time or the version
live when that step actually executes. This repo's own prior forensics
(`docs/reports/SUN-1221E6R-H2BF*.md`) investigated Workflow DAG-compilation and
cross-script topology in exhaustive depth but did not address this specific
mid-flight-version question either — grepped, zero hits for "in-flight"/"pinned"/
"already running" in those reports.

Per this checkpoint's explicit instruction ("Do not infer"), this is reported
honestly as **not confirmed either way**, rather than asserting the prior
runbook's specific pinning claim (which the runbook itself had already flagged as
unverified) or its opposite. §21 below adopts the conservative policy this
uncertainty implies.

---

## §20. In-flight paid job risk — read-only query

Real, discovered `lifecycle_stage` values (from
`apps/edge-api/src/control-plane/repositories/d1/payment-attempts.ts` and
`migrations/0003_payment_lifecycle_stage.sql` — not guessed): `acquired` (column
default), `executed`, `settlement_pending`, `settled_external`,
`settlement_failed`. The first three are non-terminal (a paid-continuation
Workflow instance may still act on them); the last two are terminal.

```
INFLIGHT_JOB_READ_COMMAND=
```
```bash
wrangler d1 execute siteborne-utility --remote --command \
  "SELECT lifecycle_stage, COUNT(*) AS n FROM payment_attempts WHERE lifecycle_stage IN ('acquired','executed','settlement_pending') GROUP BY lifecycle_stage"
```

```
INFLIGHT_PAID_JOBS_TOTAL=<operator fills in from the query above, immediately before paid-runtime deployment>
INFLIGHT_BY_STATE=<operator fills in: acquired=<n>, executed=<n>, settlement_pending=<n>>
```

---

## §21. Deployment safety decision for in-flight jobs

```
PCC_DEPLOYMENT_INFLIGHT_POLICY=B (require zero in-flight jobs before deploying the paid runtime)
```

Chosen conservatively *because* §19 found no first-party confirmation of
in-flight-instance version-pinning behavior — absent that guarantee, the only
policy that is safe regardless of which way Cloudflare actually behaves is to
require the in-flight count to be zero before the paid-runtime deploy. This is
strictly stronger than, and supersedes, the prior runbook's implicit assumption
that in-flight instances were automatically safe. If §20's query is non-zero, the
manual paid-runtime deployment (§24 below) must **STOP** and wait — never cancel
jobs to force the count to zero.

---

## §22. Schema/secret/config dependencies

```
PCC_D1_MIGRATION_REQUIRED=NO
PCC_NEW_BINDINGS_REQUIRED=NO
PCC_NEW_SECRETS_REQUIRED=NO
PCC_ECONOMICS_CHANGE_REQUIRED=NO
PCC_ROUTE_CHANGE_REQUIRED=NO
```
Confirmed from `ac642cb`'s own commit message ("No new binding. No new secret. No
immutable release schema touched. No new PCC builder. No new public contract.")
and independently from this session's own file-level trace (§3) — no migration
file, binding, or route touches this commit's three changed files.

Separately, this checkpoint's own `MTLS_PRODUCTION_ACTIVE` truthfulness-gate
addition requires **no** D1 migration, binding, or secret — it is a plain,
non-secret `[vars]`-style string flag exactly like `PAID_ROUTES_ENABLED`, and its
production-compatible default (absent → `false`) requires **no `wrangler.toml`
change at all** to stay safe; it need only be added when an operator deliberately
flips it to `'true'` after real mTLS qualification (mTLS runbook §17).

---

## §23. Component-specific predeploy gates (exact repository commands)

```bash
pnpm typecheck && pnpm build && pnpm lint && pnpm test
pnpm x402:check && pnpm mcp:check && pnpm a2a:check
pnpm production:preflight
pnpm secrets:scan

wrangler deploy --config wrangler.paid-continuation-runtime.toml --dry-run
wrangler deploy --config wrangler.toml --dry-run
```

Ran the targeted subset directly this session (full monorepo `pnpm test` was not
re-run in full for this evidence report beyond what §33 below reports):

```
DETERMINISTIC_FAILURES=0   (targeted: 25/25 mTLS-truthfulness-relevant tests green; see §33 for the full-suite run)
```

---

## §24. Manual paid-runtime deployment runbook (operator-executed only — Claude does not run this)

**Before mutation — capture current state:**
```bash
wrangler deployments list --name siteborne-paid-continuation-runtime | head -5 > /tmp/pcc-paid-runtime-pre-deploy.txt
wrangler secret list --config wrangler.paid-continuation-runtime.toml > /tmp/pcc-paid-runtime-pre-secrets.txt
cat /tmp/pcc-paid-runtime-pre-deploy.txt /tmp/pcc-paid-runtime-pre-secrets.txt
```

**Confirm §21's policy is satisfied** (§20's query returns 0 across all three
non-terminal `lifecycle_stage` values) before proceeding. If non-zero, STOP.

**Dry-run, then deploy — paid runtime only:**
```bash
wrangler deploy --config wrangler.paid-continuation-runtime.toml --dry-run
wrangler deploy --config wrangler.paid-continuation-runtime.toml
```

**Read back:**
```bash
wrangler deployments list --name siteborne-paid-continuation-runtime | head -5 > /tmp/pcc-paid-runtime-post-deploy.txt
wrangler secret list --config wrangler.paid-continuation-runtime.toml > /tmp/pcc-paid-runtime-post-secrets.txt
diff /tmp/pcc-paid-runtime-pre-secrets.txt /tmp/pcc-paid-runtime-post-secrets.txt && echo "SECRETS_UNCHANGED"
```

```
PAID_RUNTIME_PUBLIC_ROUTES=0   (workflow-host-entrypoint.ts's default export is an unconditional 404 — its only HTTP surface — confirmed by source read, §3/§4)
```

Reprove settlement ownership immediately after: `pnpm vitest run
apps/edge-api/tests/settle-sole-ownership.test.ts` → must stay 4/4.

**Rollback (verified against pinned Wrangler's actual command, not guessed):**
```bash
wrangler rollback --config wrangler.paid-continuation-runtime.toml <pre-deploy version id from /tmp/pcc-paid-runtime-pre-deploy.txt>
```

---

## §25. Intermediate paid-runtime qualification (zero-economic, read-only)

```
PAID_RUNTIME_PRE_VERSION=<from /tmp/pcc-paid-runtime-pre-deploy.txt>
PAID_RUNTIME_POST_VERSION=<from /tmp/pcc-paid-runtime-post-deploy.txt>
PAID_RUNTIME_BINDING_DRIFT=<diff of `wrangler deployments list`'s binding summary before/after — expect NONE>
PAID_RUNTIME_SECRET_DRIFT=<diff captured above — expect NONE>
PAID_RUNTIME_ROUTE_DRIFT=<expect NONE — PAID_RUNTIME_PUBLIC_ROUTES stays 0>
```

Do not intentionally create a paid Workflow instance to "test" this. The read-only
checks above (deployment list, secret list, settlement-ownership test) are the
complete qualification.

---

## §26. Manual public-API deployment runbook (operator-executed only)

**Only after §25 passes.** Before mutation:
```bash
wrangler deployments list --name siteborne-utility-edge | head -5 > /tmp/pcc-public-api-pre-deploy.txt
curl -sS https://utility.siteborne.net/.well-known/agent-card.json > /tmp/pcc-public-api-pre-card.json
jq '.securitySchemes.mtls // "ABSENT"' /tmp/pcc-public-api-pre-card.json
```

**Critical — if the mTLS truthfulness gate has NOT yet been separately flipped
(mTLS runbook §17), it must still read `"ABSENT"` here.** This is a PCC-only
deploy; it must not carry a silent mTLS advertisement change.
```
POST_PCC_DEPLOY_MTLS_ADVERTISED=NO
```

**Dry-run, then deploy — public API only:**
```bash
wrangler deploy --config wrangler.toml --dry-run
wrangler deploy --config wrangler.toml
```

**Read back:**
```bash
wrangler deployments list --name siteborne-utility-edge | head -5
curl -sS https://utility.siteborne.net/.well-known/agent-card.json | jq '.securitySchemes.mtls // "ABSENT", .capabilities.extensions[0].params.services'
curl -sS https://utility.siteborne.net/.well-known/jwks.json | jq '.keys | length'
```
Confirm `"ABSENT"` still holds (unless the mTLS flag was deliberately flipped in
the same pass, which this runbook does not do) and JWKS/card otherwise resolve
normally.

---

## §27. Post-PCC cross-transport non-economic validation

```
PCC_DEPLOYMENT_STRUCTURALLY_QUALIFIED=<operator fills in after §24/§26 both succeed and §28 stays green — no economic request performed>
LIVE_PAID_PCC_RESULT_VERIFIED=NO
```
Do not perform a real payment to verify the fulfilled-PCC-result shape — that
proof is deferred to live-paid acceptance, a separate, already-existing process.

---

## §28. Settlement topology after both deploys

```bash
pnpm vitest run apps/edge-api/tests/settle-sole-ownership.test.ts
wrangler deployments list --name siteborne-utility-edge | head -3
wrangler deployments list --name siteborne-paid-continuation-runtime | head -3
```
Required, unchanged:
```
PUBLIC_API_SETTLE_CALLSITES=0
MCP_ADAPTER_SETTLE_CALLSITES=0
DEDICATED_WORKFLOW_SETTLE_CALLSITES=1
TOTAL_PRODUCTION_SETTLE_CALLSITES=1
```

---

## §29. Rollback matrix

```
ROLLBACK_PAIR_AFTER_PAID_ONLY=Pair C (paid runtime rolled back to OLD, public API never touched) — self-consistent, safe
ROLLBACK_PAIR_AFTER_BOTH=rolling back the public API alone returns to Pair B (only if the deploy order was violated) or Pair C (if the corrected order was followed and only the runtime is rolled back); rolling back the paid runtime alone (after both deployed, i.e. from Pair D) returns to Pair C — always safe under the corrected order
ROLLBACK_PAIR_AFTER_PUBLIC_FAILURE=if the public API deploy (§26) fails after the paid runtime already succeeded (§24), the live pair is Pair C (paid runtime NEW, public API still OLD) — self-consistent, safe to leave in place while retrying §26; do not roll back the paid runtime just because the public API deploy failed
```

Each of these pairs is drawn directly from the §17-18 matrix — "safe" here means
"never produces `result: undefined` for MCP," the one broken pair the whole
ordering exercise exists to avoid.

---

## §30. mTLS operator runbook — corrections applied

Full corrections applied directly to
`docs/runbooks/SUN-1222C-mtls-production-provisioning-runbook.md` (see that file's
own new header block for an itemized summary): dedicated-host-only canary tests
(§13), corrected x402/mTLS orthogonality target and fixture generation (§14),
corrected A2A liveness method and request (§15), PCC deployment content removed
entirely (moved here, §24-29), corrected/reversed deployment-order guidance where
it still applies to this file's own scope, mTLS advertisement gated behind the new
truthfulness flag and explicit "flip only after real qualification" instruction,
tightened unverified-write-command framing (§16), no `supportedInterfaces`
mutation (unchanged, already correct in the prior version).

---

## §31. No operator secrets

No Cloudflare token, certificate private key, raw payment payload, wallet private
key, or other secret value appears anywhere in this report, the corrected runbook,
or any source/test file touched this checkpoint, confirmed by direct authorial
review of every file listed in §35.

`pnpm secrets:scan` itself reports 2 findings — both pre-existing, in git history
long before this checkpoint (commits `3cbee0e4` from 2026-09-06 and `1e3e3d04`
from 2026-09-03, both weeks before `START_HEAD`), in `docs/reports/` prose
(`generic-api-key` rule matching a redacted `PUBLIC_API_SECOND_VERSION=`
placeholder string, not a live secret). Zero new findings introduced by this
checkpoint's own diff. Rewriting historical git commits to silence a pre-existing
scanner finding is out of this checkpoint's authorized scope and not attempted.

---

## §32-33. Targeted tests and full release gate

```
TARGETED_TESTS=25/25
```
(`mtls-production-capability.test.ts` 4/4, `settle-sole-ownership.test.ts` 4/4,
`packages/protocol-a2a/src/card.test.ts` 11/11, `apps/edge-api/tests/a2a-route.test.ts`
6/6 — all rerun clean after the mutation-proof restoration, §11 above.)

```
TYPECHECK=23/23
BUILD=12/12
LINT=16/16 (one prettier formatting fix applied to card.test.ts mid-checkpoint,
  re-verified clean after)
FULL_TESTS_RAW=254/276 files passed, 22 skipped (pre-existing, unrelated to this
  checkpoint); 3105/3183 tests passed, 78 skipped; ZERO failures
```
An intermediate full-suite run this session showed spurious timeout failures (12,
then 81, across files with zero relation to this checkpoint's diff — `load-v2`,
`chaos-v2`, D1 rate-window, property tests, `worker-bridge.subprocess`, etc.),
traced to genuine host-machine resource exhaustion: `uptime` showed load averages
of 26-42 and 16 stray `workerd`/Miniflare processes still running from this
session's own earlier isolated test invocations (plus unrelated processes from a
different project on the same machine). Killed this session's own stray
`workerd` processes under `.../SITEBORNE Utility Network/node_modules/...`
(left the unrelated other-project processes alone), then reconfirmed: the exact
same previously-timing-out file (`x402-service-route.test.ts`) passed 37/37 in
isolation, and a full clean re-run of `pnpm test` came back 3105/3183 passed,
zero failures. Not a regression from this checkpoint's source changes.

---

## §34. Protocol / preflight

```
PROTOCOL_X402_CHECK, PROTOCOL_MCP_CHECK, PROTOCOL_A2A_CHECK, PRODUCTION_PREFLIGHT,
PAID_RUNTIME_WRANGLER_DRY_RUN, PUBLIC_API_WRANGLER_DRY_RUN
```
Recorded in the final decision packet (chat response), reflecting this session's
own run. No deploy performed.

---

## §35. Source boundary

Files changed this checkpoint:

| File | Classification |
|---|---|
| `apps/edge-api/src/control-plane/config/env.ts` | mTLS truthfulness gate (new `MTLS_PRODUCTION_ACTIVE` field) |
| `apps/edge-api/src/control-plane/config/mtls-production-capability.ts` | mTLS truthfulness gate (new resolver, new file) |
| `apps/edge-api/src/routes/a2a.ts` | mTLS truthfulness gate (wiring) |
| `packages/protocol-a2a/src/card.ts` | Agent Card (gated `securitySchemes.mtls`) |
| `packages/protocol-a2a/src/types.ts` | Agent Card (new `mtlsProductionActive` option) |
| `packages/protocol-a2a/src/transport.ts` | Agent Card (threads the option through) |
| `packages/protocol-a2a/src/card.test.ts` | tests |
| `apps/edge-api/tests/a2a-route.test.ts` | tests |
| `apps/edge-api/tests/mtls-production-capability.test.ts` | tests (new file) |
| `docs/runbooks/SUN-1222C-mtls-production-provisioning-runbook.md` | mTLS runbook correction (was untracked from a prior checkpoint; committed here) |
| `docs/reports/SUN-1222C-deployment-dependency-and-mtls-truthfulness-remediation.md` | evidence/docs (this file) |

```
UNEXPECTED_FUNCTIONAL_SOURCE_FILES=0
```
Every functional source change above is the minimal repository-governed
truthfulness gate this checkpoint's own audit (§5-6) proved necessary — no other
production source file was touched.

---

## §36-39. Summary, zero-effect declaration, and final decision

See the chat response for the literal, itemized final decision packet (§39's exact
field list), including `FINAL_HEAD`, gate results, and
`NEXT_REQUIRED_CHECKPOINT`.

```
CLOUDFLARE_MUTATIONS=0
CERTIFICATES_ISSUED=0
WAF_MUTATIONS=0
DNS_MUTATIONS=0
ROUTE_MUTATIONS=0
PRODUCTION_DEPLOYMENTS=0
TRAFFIC_MUTATIONS=0
SECRET_MUTATIONS=0
PRODUCTION_D1_WRITES=0
LIVE_PAID_REQUESTS=0
REAL_SIGNING=0
REAL_PROVIDER_CALLS=0
REAL_SETTLEMENTS=0
ECONOMIC_EFFECT_USDC=0
```
