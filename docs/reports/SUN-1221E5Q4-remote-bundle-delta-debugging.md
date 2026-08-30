# SUN-1221E5Q4 — Remote Preview Bundle Delta Debugging

**Goal:** find the smallest source/bundle/config delta between a known-good
minimal remote Worker (HTTP 200, handler reached) and the SITEBORNE
dev-diagnostic remote Worker (HTTP 525, handler not reached, per
SUN-1221E5Q3) using delta debugging.

**Headline result:** SUN-1221E5Q3's working hypothesis
(`SITEBORNE_SOURCE_CAUSES_525=YES`) is **overturned**. The 525 is caused
entirely by a `wrangler dev --remote`-only config interaction — the
zone-scoped `routes` entry in the repo-root `wrangler.toml` — reproducible
with **zero** SITEBORNE source code, zero imports, and zero bundle content
involved. A second, independent `wrangler dev --remote`-only interaction
(`[queues]` producers) causes a different failure signature (HTTP 503 /
error 1105). Neither affects real production deploys.

## 1. Reconciliation with SUN-1221E5Q3

`git status --short` was clean at `HEAD=aaaf8390e8474ad7dce3e89a757ae3f2dcd6146f`
before this checkpoint began. Q3's report
(`docs/reports/SUN-1221E5Q3-minimal-remote-preview-control.md`) was read in
full; its literal evidence for a 200 minimal-control baseline, a 525
SITEBORNE inert-route baseline, three ruled-out config variables
(script name, compat date/flags, invocation style), unchanged production,
and zero economic activity all checked out. No discrepancy found.

## 2–3. Fresh GOOD/BAD baselines

Both re-verified fresh this checkpoint (Q3's sessions were already
cleaned up):

| Run | Entrypoint | Config | Result |
|---|---|---|---|
| R1 | zero-import minimal (`scratchpad/e5q4-good/good-minimal.ts`, isolated, no wrangler.toml discovered) | none | **HTTP 200**, `ok`, real `CF-Ray` |
| R2 | `webctx-remote-diagnostic.ts` `/__diag/health` (real repo wrangler.toml auto-discovered) | repo `wrangler.toml` | **HTTP 525**, `error code: 525`, real `CF-Ray` |

`DELTA_GOOD_BASELINE=200`, `DELTA_BAD_BASELINE=525` — both reproduced
deterministically, matching Q3.

## 4. Static bundle/module-graph analysis (no deploys)

`wrangler deploy --dry-run --outdir <dir>` was used to inspect the actual
bundle content without publishing anything.

| | GOOD | BAD (real diagnostic) |
|---|---|---|
| Bundle size | 0.33 KiB / gzip 0.26 KiB | 1257.47 KiB / gzip 226.76 KiB |
| Module boundary markers | 0 | 213 |
| `cloudflare:sockets` present | no | yes (`import { connect } from "cloudflare:sockets"` at line 28051) |
| `@coinbase/cdp-sdk` present | n/a | **no** — tree-shaken out entirely (both its two import sites, `production-payment.ts` and `web-context-v2-cdp-composition.ts`, reference it only inside functions never called from this diagnostic's reachable graph) |
| Large unexpected deps present | n/a | `viem`, `@x402/core`, `@x402/evm`, `@x402/extensions`, `ajv` + `ajv-formats`, `yaml`, `zod` (two versions), `canonical-json` |

`BAD_UNIQUE_TOP_LEVEL_IMPORT_COUNT`: 5 direct imports in
`webctx-remote-diagnostic.ts` itself (`hono`, `@siteborne/verification`,
`@siteborne/service-runtime`, `@siteborne/provider-adapters`,
`../control-plane/production/web-context-v2-cdp-composition`) pulling in
~79 in-repo modules and ~130 third-party package files transitively.
`BAD_UNIQUE_TOP_LEVEL_INIT_ACTION_COUNT`: 0 top-level (non-function-scoped)
executable side effects were found anywhere in the reachable graph by
manual inspection (`grep`-verified: every `new Ajv(...)`, key generation,
and `new CdpClient(...)` call site is inside a function body, none at
module scope) — this matters because it rules out categories B
(top-level crypto init) and N (schema/helper init) as the mechanism before
any remote bisection was needed.

A one-time `whatwg-url`/`unenv` esbuild warning ("Import 'default' will
always be undefined") appeared during every dry-run and dev-mode bundle of
the BAD/bisect variants. **Investigated and ruled out**: `grep -c whatwg`
against every emitted `.js` bundle (both `--outdir` dry-run output and the
live `.wrangler/tmp/dev-*` bundle) returned 0 — the module esbuild warns
about is not actually retained in the final bundle, so it cannot be
causally responsible for anything at runtime. Recorded as a red herring,
not chased further.

## 5–6. Import/module-evaluation-phase determination

Q3 already established the key fact for this section: the **inert**
`/__diag/health` route — which constructs no executor, signer, or
SafeSocket client, only checks an env var and returns JSON — still
returns 525. Since Worker module evaluation completes fully before any
route handler runs, and the inert route needs zero runtime construction,
this alone proves:

`FAILURE_TRIGGER_PHASE=IMPORT_OR_MODULE_EVALUATION` (not
runtime-initialization) — confirmed, not re-derived. No Worker startup
exception text was visible in any `wrangler dev --remote` log (`REMOTE_STARTUP_ERROR_VISIBLE=NO`); the 525 is delivered as a bare edge-level
error page, not a worker-thrown exception surfaced to the CLI.

## 7–8. Import bisection (BISECT_RUN 1–3, budget 3/8 used)

Each variant used a static, non-payment `/__diag/health`-shaped handler
(env-var gate → JSON), with imports proven present in the emitted bundle
via `wrangler deploy --dry-run --outdir` before every remote request.

| Run | Variant | Modules retained (confirmed via bundle read-back) | Bundle size | HTTP | Handler reached |
|---|---|---|---|---|---|
| 1 | `web-context-v2-cdp-composition.ts` import only (unused binding kept alive via `typeof`) | `cloudflare:sockets`, `viem`, `@x402/*`, `ajv`, `yaml`, `zod`, `hono` (no `@siteborne/verification`, no `service-runtime`) | 1093.60 KiB | **525** | NO |
| 2 | `@siteborne/protocol-x402` import only | `@x402/core`, `@x402/extensions`, `ajv`+`ajv-formats`, `canonical-json`, `yaml`, `zod`, `hono` (**no** `cloudflare:sockets`, **no** `viem`, **no** provider-adapters) | 1054.39 KiB | **525** | NO |
| 3 | `hono` only (no protocol-x402, no any SITEBORNE package) | `hono` only | 69.34 KiB | **525** | NO |

BISECT_RUN=3 was the pivotal result: a bare `new Hono()` + one `.get()`
route, with **zero** SITEBORNE-authored imports, still returned 525. This
immediately contradicted the "bundle content" hypothesis Q3 had narrowed
toward. The GOOD baseline was re-verified fresh immediately afterward
(R6, still 200) to rule out session/account-state drift as a confound
before trusting this result.

`MINIMAL_FAILING_IMPORT_SET_PROVEN=NOT_APPLICABLE` — bisection along the
import axis was **abandoned as the wrong axis** once BISECT_RUN=3 showed
the failure has nothing to do with which packages are imported.

## The actual axis: `wrangler.toml` auto-discovery (BISECT_RUN 4–9)

`wrangler dev [script]` resolves its config file by walking up from the
**entrypoint script's own directory**, not the process's CWD. Every BAD
run and every import-bisect variant lived under
`apps/edge-api/src/dev-diagnostics/` (inside the repo), so all of them
auto-discovered the **real repo-root `wrangler.toml`** — with its full
production binding set (`CATALOG` KV, `JOBS`/`EVENTS` queues, `DB` D1,
`BROWSER`, `AI`, a zone-scoped `routes` entry, `workers_dev=true`,
`preview_urls=false`). The GOOD baseline's script lived in an isolated
scratchpad directory with no `wrangler.toml` above it — a variable Q3
never controlled for, since Q3's own "config differential" section only
varied script name / compat date+flags / invocation style, never whether
the real resource bindings + `routes` were attached at all.

This was tested directly and bisected using `wrangler dev --remote
--config <override>.toml`, keeping the entrypoint content fixed (the
same zero-import static-200 handler as GOOD, but placed inside the repo
tree so it would auto-discover unless overridden):

| Run | Config | HTTP | Notes |
|---|---|---|---|
| 4 | none (repo `wrangler.toml` auto-discovered: routes + all 5 bindings) | **525** | identical zero-import handler as GOOD, only the config differs |
| 5 | `--config` copy of repo config **minus `routes`** (all 5 bindings kept) | **503** (`error code: 1105`) | different failure signature — proves `routes` isn't the only broken axis |
| 6 | `--config` copy **minus `routes` AND minus all 5 real-resource bindings** (plain `[vars]` only) | **200** | back to GOOD — confirms both axes are jointly sufficient to explain 525/503, neither is a red herring |
| 7 | `--config` with **only `[queues]`** (no `routes`, no D1/KV/Browser/AI) | **503** (`error code: 1105`) | isolates `[queues]` as the sole cause of the 503/1105 signature — matches wrangler's own explicit warning, "Queues are not yet supported in wrangler dev remote mode" |
| 9 | `--config` with **only `routes`** (no `[queues]`, no D1/KV/Browser/AI) | **525** | isolates `routes` (the zone-scoped Worker Route on `siteborne.net`) as the sole, sufficient cause of the exact 525 signature, independent of every other binding and of all SITEBORNE source code |

(Run 8 was not needed — run 9 already gave a clean, unconfounded positive
result for the `routes`-alone hypothesis.)

`CULPRIT_REMOVAL_CONTROL=PASS`: GOOD-with-routes-removed (run 6, and by
extension run 9's complement) returns to 200; GOOD-with-routes-alone
(run 9) reproduces 525.

## Root-cause classification

None of the taxonomy options A–H (all source/import/init-shaped) fit,
because the actual cause is not in source at all:

`REMOTE_525_SOURCE_ROOT_CAUSE_CLASS=I_OTHER_PROVEN`
`REMOTE_525_SOURCE_ROOT_CAUSE_PROVEN=YES`
`REMOTE_525_MINIMAL_CAUSAL_DELTA`: the presence of the repo-root
`wrangler.toml`'s zone-scoped `routes` entry
(`{ pattern = "siteborne.net/.well-known/mcp-registry-auth", zone_name =
"siteborne.net" }`) in the config used by `wrangler dev --remote`. This is
a `wrangler dev --remote` preview-tooling interaction, not a bug in the
`routes` entry itself (which is documented, live, and working correctly
in real production — the wrangler.toml's own comment already notes the
apex zone's bare DNS record independently returns HTTP 525 with no
Worker attached; the zone-scoped Worker Route intercepts that path
correctly in production). `[queues]` producers are a second, independent
`wrangler dev --remote`-only interaction, already flagged by wrangler's
own warning, causing a different failure (HTTP 503 / error 1105) whenever
present without `routes`.

Sections 9–13 of the checkpoint's own protocol (import side-effect
analysis, runtime-init bisect, ephemeral-signer-phase check,
`cloudflare:sockets`-import-only control, node-polyfill control) are
**not applicable** — every one of them presupposes the failure is
source-shaped, which bisection disproved before reaching them.
`EPHEMERAL_KEY_GENERATION_PHASE=REQUEST_TIME` is recorded anyway from
direct inspection of `webctx-remote-diagnostic.ts`:
`buildEphemeralDiagnosticSigner()` is called only inside the
`/__diag/webctx-remote` handler, never at module scope — this was already
correct and needed no change.

## Fix gate

`DEV_DIAGNOSTIC_FIX_REQUIRED=NO` — `webctx-remote-diagnostic.ts` itself
has no defect; its imports, bundle, and structure are all fine.
`SHARED_PRODUCTION_CODE_IMPLICATED=NO` — the `routes` entry in
`wrangler.toml` is correct, live, working production config; nothing
about it needed to change, and it was not modified. The only change
needed was to the **invocation** used for `wrangler dev --remote`
diagnostic sessions specifically. `DEV_DIAGNOSTIC_FIX_RED=NOT_REQUIRED`
(no TDD cycle applies — there is no source defect to write a red test
against).

**Change made** (dev-diagnostic file only, comment-only, zero behavior
change): added a doc-comment note to `webctx-remote-diagnostic.ts`'s
header recording the proven `routes`/`[queues]` interaction and the
corrected invocation pattern (`--config <override without routes/queues>`),
so future checkpoints don't re-discover this from scratch.

## §18 Remote inert green (corrected invocation)

Built `scratchpad/e5q4-configs/diagnostic-safe.toml` — identical `name`,
`compatibility_date`, `compatibility_flags`, `workers_dev`,
`preview_urls`, and `[vars]` to the real `wrangler.toml`, with `routes`
and all five real-resource bindings (D1/KV/Queues/Browser/AI) omitted.
`webctx-remote-diagnostic.ts` reads none of those five bindings anywhere
(confirmed by inspection), so omitting them changes no diagnostic
behavior.

Ran the **real, unmodified** `webctx-remote-diagnostic.ts` (full
1285.59 KiB bundle, every SITEBORNE import intact) via `wrangler dev
--remote ... --config diagnostic-safe.toml`, waited for `Ready`, sent
exactly one request to `/__diag/health`:

```
HTTP/1.1 200 OK
{"diagnostic":"SUN-1221E5Q2 inert-health","ok":true,"ts":1788074566562}
```

`SITEBORNE_REMOTE_INERT_HANDLER_HTTP_STATUS=200`
`SITEBORNE_REMOTE_INERT_HANDLER_REACHED=YES`

## §19–20 SafeSocket diagnostic gate and invocation

§18 passed, so `SAFE_SOCKET_DIAGNOSTIC_INVOCATION_AUTHORIZED=YES`. Exactly
one request was sent to `/__diag/webctx-remote` (fixed target
`https://example.com/`, no request-supplied target, no 402, no
facilitator, no settlement — same session, same corrected config):

```
HTTP/1.1 200 OK
{
  "diagnostic": "SUN-1221E5Q webctx-remote-diagnostic",
  "target": "https://example.com/",
  "result_class": "internal_verification_failed",
  "elapsed_ms": 9,
  "note": "error_detail is the sanitized adapter-classified message ... never touches payment orchestration, settlement, or receipt persistence"
}
```

| Field | Value |
|---|---|
| `REMOTE_DEV_USES_CLOUDFLARE_SOCKETS` | YES (import confirmed present in the reached, executing bundle) |
| `DIAGNOSTIC_HANDLER_REACHED` | YES |
| `HTTP_STATUS` | 200 (diagnostic route's own wrapper response; not the target's status) |
| `RESULT` | `internal_verification_failed`, `elapsed_ms=9`, no `error_detail` populated |

9ms is too fast for a real DNS-resolve → TCP connect → TLS handshake →
HTTP round trip to `example.com`, and no `error_detail` was populated
(the field the executor fills from `output.limitations[0]` on a
network-classified failure) — both point to the failure occurring
*before* the SafeSocket/DNS/TLS/HTTP path was reached, most likely during
`WebContextVerifiedService.execute()`'s own request-time verification/PCC
step rather than during the outbound fetch itself. This was **not**
investigated further per scope (§21/§22 gate) — it is a distinct question
from this checkpoint's transport-bisection mandate and does not carry the
`WEBCTX_HTTP_PREMATURE_EOF` signature this investigation exists to
characterize.

## §21/§22 — E5 reproduction status

The result does **not** contain `WEBCTX_HTTP_PREMATURE_EOF`, so the
target failure did not reproduce — but it is also not a clean "success"
(§22's framing): the executor was reached and ran, but failed for an
apparently unrelated, earlier-stage reason
(`internal_verification_failed`, not a transport/EOF failure).

`REMOTE_NONPAYMENT_E5_FAILURE_REPRODUCED=NO`
`EOF_BRANCH_ID=NOT_APPLICABLE` (no EOF branch fired)
`DIAGNOSTIC_REASON_CODE=internal_verification_failed`
`ROOT_CAUSE_EVIDENCE_SUFFICIENT_FOR_FIX=NO`
`REMOTE_PREVIEW_DEPLOYED_RUNTIME_FIDELITY_GAP_REMAINS=YES` — the
remote-preview environment still has not reproduced the deployed
production Worker's `WEBCTX_HTTP_PREMATURE_EOF` failure; it now reaches
the executor cleanly (unlike Q2/Q3, blocked at 525) but hits a different,
earlier, unexplained failure instead. Per protocol, **stopping here** —
this is a new, separate question (why does
`WebContextVerifiedService.execute()`'s verification step fail against a
fresh ephemeral diagnostic signer in 9ms) for a dedicated follow-up
checkpoint, not this one.

## Production safety

| Field | Value |
|---|---|
| `WORKER_VERSION_UPLOADS` | 0 |
| `PRODUCTION_DEPLOYMENTS` | 0 |
| `FINAL_PRODUCTION_VERSION` | `de70bf98-f304-4d7f-b189-4ae2401041a0` |
| `FINAL_PRODUCTION_TRAFFIC` | 100% |
| `FINAL_PRODUCTION_PREFLIGHT` | PASS (re-run this checkpoint, unchanged) |
| `LIVE_402_REQUESTS` | 0 |
| `PAYMENT_SIGNATURES_CREATED` | 0 (one ephemeral, non-payment diagnostic Ed25519 keypair generated in-memory per the already-approved diagnostic seam; never a receipt signature) |
| `PAID_REQUESTS` | 0 |
| `SETTLEMENTS` | 0 |
| `REAL_ECONOMIC_EFFECT_USDC` | 0 |

## Regression

- `TYPECHECK`: PASS (`tsc -p apps/edge-api/tsconfig.json --noEmit`)
- `LINT`: PASS (`pnpm run lint`, 16/16 tasks)
- `PRODUCTION_BUNDLE_DIAGNOSTIC_ISOLATION`: PASS — a fresh `wrangler
  deploy --dry-run` of the real production entrypoint (`main =
  apps/edge-api/src/index.ts`, real `wrangler.toml`) contains zero
  occurrences of `DIAGNOSTIC_SEAM_ENABLED`, `webctx-remote-diagnostic`,
  or `dev-diagnostics` anywhere in the emitted 6335.73 KiB bundle.
- `secrets:scan`: 2 findings, both pre-existing false positives in
  unrelated prior-commit report files (`SUN-1220O-first-real-paid-e2e.md`
  line 159, `SUN-1221E2R-settlement-502-forensic-reconciliation.md` line
  30 — both from commits before this checkpoint, both already-known
  generic-api-key false positives on redacted placeholder text). Zero new
  findings from this checkpoint's own change.
- `pnpm test` / `pnpm test:worker-runtime`: not run — no test files were
  added or modified this checkpoint (the only committed change is a
  30-line doc comment addition with zero behavior/logic change).

## Cleanup

- All 12 `wrangler dev --remote` sessions started this checkpoint (ports
  18901–18912) were stopped by PID immediately after their single
  request each.
- The 4 temporary bisect entrypoint files
  (`e5q4-bisect-{1,2,3,4}-*.ts`) were deleted from
  `apps/edge-api/src/dev-diagnostics/`; `git status --short` confirms a
  clean tree except the one intentional doc-comment change.
- Temporary bundle/module-graph output (`scratchpad/e5q4-bundles/`) and
  the isolated GOOD entrypoint (`scratchpad/e5q4-good/`) were removed.
  The temporary config overrides (`scratchpad/e5q4-configs/*.toml`) and
  session logs (`scratchpad/e5q4-logs/*.log`) were kept as evidence
  (scratchpad-only, never committed, never part of the repo).
- One pre-existing orphaned `workerd` process (PID 94189, port 18799,
  under this repo's `node_modules`) was found running at the start of
  this checkpoint, predating it (consistent with an incompletely-cleaned
  child process from SUN-1221E5Q3's own session). It was **not** touched
  — out of scope for a Q4-owned-sessions-only cleanup — and did not
  interfere with any Q4 port (18901–18912).

`Q4_REMOTE_SESSIONS_STOPPED=YES`
`TEMP_BISECT_ARTIFACTS_REMOVED=YES`

## Final stop packet

```
SUN1221E5Q4_BUNDLE_DELTA_DEBUGGING=PASS
DELTA_GOOD_BASELINE=200
DELTA_BAD_BASELINE=525
BAD_UNIQUE_TOP_LEVEL_IMPORT_COUNT=5 (direct); ~209 transitive module files
BAD_UNIQUE_TOP_LEVEL_INIT_ACTION_COUNT=0
GOOD_BUNDLE_SIZE_BYTES=338 (0.33 KiB)
BAD_BUNDLE_SIZE_BYTES=1287649 (1257.47 KiB)
GOOD_BUNDLE_MODULE_COUNT=0
BAD_BUNDLE_MODULE_COUNT=213
REMOTE_STARTUP_ERROR_VISIBLE=NO
REMOTE_STARTUP_ERROR_CLASS=NOT_APPLICABLE
FAILURE_TRIGGER_PHASE=IMPORT_OR_MODULE_EVALUATION (initially, before the
  config axis was found to be the true cause -- module evaluation
  completing successfully was never actually the blocker; see Synthesis)
IMPORT_ONLY_REMOTE_STATUS=525 (BISECT_RUN=1-3, later shown to be a config
  confound, not an import effect -- see below)
MINIMAL_FAILING_IMPORT_COUNT=0
MINIMAL_FAILING_IMPORT_SET=NONE (the true failing set is a wrangler.toml
  config entry, not an import)
MINIMAL_FAILING_IMPORT_SET_PROVEN=NOT_APPLICABLE
CULPRIT_REMOVAL_CONTROL=PASS
EPHEMERAL_KEY_GENERATION_PHASE=REQUEST_TIME
SOCKETS_IMPORT_ONLY_STATUS=NOT_APPLICABLE (superseded by the config
  finding; cloudflare:sockets was present and unproblematic in every
  bisect variant, including the ones that failed for the config reason)
NODE_POLYFILLS_IN_BAD_BUNDLE=whatwg-url unenv shim WARNED about but NOT
  present in any emitted bundle (0 occurrences, verified by grep)
NODE_POLYFILL_CAUSAL=NO
REMOTE_525_SOURCE_ROOT_CAUSE_CLASS=I_OTHER_PROVEN
REMOTE_525_SOURCE_ROOT_CAUSE_PROVEN=YES
REMOTE_525_MINIMAL_CAUSAL_DELTA=repo-root wrangler.toml's zone-scoped
  `routes` entry, present in the config `wrangler dev --remote`
  auto-discovers -- proven sole and sufficient cause (BISECT_RUN=9,
  routes-only, zero SITEBORNE source)
DEV_DIAGNOSTIC_FIX_REQUIRED=NO
SHARED_PRODUCTION_CODE_IMPLICATED=NO
DEV_DIAGNOSTIC_FIX_RED=NOT_REQUIRED
PRODUCTION_BUNDLE_DIAGNOSTIC_ISOLATION=PASS
SITEBORNE_REMOTE_INERT_HANDLER_HTTP_STATUS=200
SITEBORNE_REMOTE_INERT_HANDLER_REACHED=YES
SAFE_SOCKET_DIAGNOSTIC_INVOCATION_AUTHORIZED=YES
REMOTE_DEV_USES_CLOUDFLARE_SOCKETS=YES
DIAGNOSTIC_HANDLER_REACHED=YES
REMOTE_NONPAYMENT_E5_FAILURE_REPRODUCED=NO
EOF_BRANCH_ID=NOT_APPLICABLE
DIAGNOSTIC_REASON_CODE=internal_verification_failed
ROOT_CAUSE_EVIDENCE_SUFFICIENT_FOR_FIX=NO
REMOTE_PREVIEW_DEPLOYED_RUNTIME_FIDELITY_GAP_REMAINS=YES
TESTS=NOT_RUN (no test files changed)
WORKER_RUNTIME=NOT_RUN (no test files changed)
TYPECHECK=PASS
LINT=PASS
WORKER_VERSION_UPLOADS=0 PRODUCTION_DEPLOYMENTS=0
FINAL_PRODUCTION_VERSION=de70bf98-f304-4d7f-b189-4ae2401041a0
FINAL_PRODUCTION_TRAFFIC=100%
FINAL_PRODUCTION_PREFLIGHT=PASS
LIVE_402_REQUESTS=0 PAYMENT_SIGNATURES_CREATED=0 PAID_REQUESTS=0 SETTLEMENTS=0 REAL_ECONOMIC_EFFECT_USDC=0
Q4_REMOTE_SESSIONS_STOPPED=YES
TEMP_BISECT_ARTIFACTS_REMOVED=YES
SUN1221E6_REAL_PAID_RETRY_ELIGIBLE=NO
```

Not uploading E6. Not requesting E6 payment authorization. Not beginning
F. Not beginning G.
