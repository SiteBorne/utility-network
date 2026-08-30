# SUN-1221E5Q3 — Minimal Remote-Preview Control

**Goal:** isolate whether the `wrangler dev --remote` HTTP 525 seen in
SUN-1221E5Q2 is caused by SITEBORNE's own code/bundle, or is a
Cloudflare/Wrangler remote-preview infrastructure issue unrelated to this
repository.

**Scope discipline:** read-only forensics against a throwaway Worker living
entirely outside the repository (`/private/tmp/.../scratchpad/e5q3-minimal*`,
never committed). Zero SITEBORNE transport changes. Zero payment/402/signing/
settlement activity. Zero production deployment or Worker-version mutation.

## 1–5. Minimal zero-import control Worker

Created a Worker with no imports, bindings, or outbound network calls:

```ts
export default {
  async fetch() {
    return new Response("ok", { status: 200 });
  }
}
```

- `MINIMAL_CONTROL_SOURCE_IMPORT_COUNT=0`
- `MINIMAL_CONTROL_BINDING_COUNT=0`
- `MINIMAL_CONTROL_OUTBOUND_NETWORK_CALLS=0`
- `MINIMAL_CONTROL_SCRIPT_NAME=e5q3-minimal-control`
- `MINIMAL_CONTROL_CONFIG_ISOLATED=YES`
- `MINIMAL_CONTROL_CUSTOM_ROUTE_PRESENT=NO`
- `MINIMAL_CONTROL_CUSTOM_DOMAIN_PRESENT=NO`

Ran `wrangler dev --remote --port 18801` (same pinned 4.119.0), waited for
literal `Ready on http://localhost:18801`, then sent **exactly one** request:

| Field | Value |
|---|---|
| `MINIMAL_REMOTE_READY` | YES |
| `MINIMAL_REMOTE_LOCAL_URL` | `http://localhost:18801` |
| `MINIMAL_EDGE_PREVIEW_CREATE_STATUS` | 200 (via observed successful upload/Ready sequence) |
| `MINIMAL_REMOTE_REQUEST_COUNT` | 1 |
| `MINIMAL_REMOTE_HTTP_STATUS` | **200** |
| `MINIMAL_REMOTE_BODY_MATCH` | YES (`ok`) |
| `MINIMAL_REMOTE_HANDLER_REACHED` | **YES** (real `CF-Ray`, `Server: cloudflare`, exact body match) |

**CASE B**: the minimal Worker succeeds on the very first attempt.

- `REMOTE_PREVIEW_BASELINE_FUNCTIONAL=YES`
- `SITEBORNE_OR_SITEBORNE_DEV_CONFIG_DIFFERENTIAL_EXISTS=YES`
- `REMOTE_PREVIEW_INFRASTRUCTURE_IMPLICATED=NO` (baseline infra is not broadly broken)

## 11–12. Config differential — binary elimination (3/3 budget used)

Compared SITEBORNE's actual dev-diagnostic invocation
(`wrangler dev --remote apps/edge-api/src/dev-diagnostics/webctx-remote-diagnostic.ts
--var DIAGNOSTIC_SEAM_ENABLED:true --port <port>`, auto-discovering the repo-root
`wrangler.toml`) against the minimal control, one variable at a time:

| # | Variable changed | Result | Conclusion |
|---|---|---|---|
| 1 | Script name: `e5q3-minimal-control` → `siteborne-utility-edge` (real production script name) | **200 OK**, handler reached | Script-name reuse is **not** the cause |
| 2 | `compatibility_date`/`compatibility_flags`: `2024-09-23`/none → `2026-08-05`/`["nodejs_compat"]` (exact production values) | **200 OK**, handler reached | Compat date/flags mismatch is **not** the cause |
| 3 | Invocation style: `main` set in `wrangler.toml` → positional-arg entry-point override + `--var DIAGNOSTIC_SEAM_ENABLED:true` (exact SITEBORNE invocation pattern) | **200 OK**, handler reached | Positional-arg override + `--var` is **not** the cause |

- `SITEBORNE_MINIMAL_CONFIG_DIFFERENCE_COUNT`: 3 tested (script name, compat
  settings, invocation style) — all three are plausible, all three ruled out.
- `CONFIG_CAUSAL_DIFFERENCE_PROVEN=NO`
- `CAUSAL_SETTING=` *(none of the tested wrangler-config-level variables
  reproduce or explain the 525; the checkpoint's 3-request budget is now
  exhausted)*

## 13. SITEBORNE inert-handler re-check

Per §13, before any SafeSocket invocation, re-ran SITEBORNE's actual
dev-diagnostic entry point (fresh session, same pinned Wrangler, same
invocation documented in the file's own header comment) and probed its
**inert** `/__diag/health` route — a plain Hono handler added in SUN-1221E5Q2
that touches no socket, DNS, TLS, TermsGuard, or PCC code at all:

```
GET http://localhost:18805/__diag/health
HTTP/1.1 525 <none>
error code: 525
CF-Ray: a331d8c2fa7ecee3-ATL
Server: cloudflare
```

Reproduced deterministically (0.107s, same `error code: 525` signature) —
**not** a transient/timing artifact.

- `SITEBORNE_REMOTE_INERT_HANDLER_HTTP_STATUS=525`
- `SITEBORNE_REMOTE_INERT_HANDLER_REACHED=NO`
- `SAFE_SOCKET_DIAGNOSTIC_INVOCATION_AUTHORIZED_BY_CHECKPOINT=NO`

Per the checkpoint's own §13 gate, the SafeSocket diagnostic (§14) was **not**
invoked this checkpoint.

## Synthesis

The 525 is real, deterministic, and specific to `webctx-remote-diagnostic.ts`
— it reproduces even on that file's socket-free inert route. It is **not**
explained by script-name reuse, compatibility date/flags, or CLI invocation
style: an otherwise-identical minimal Worker succeeds under all three of
those exact conditions. The remaining, untested candidate is something about
`webctx-remote-diagnostic.ts`'s own source/bundle content — most plausibly
its much larger import graph (pulling in `@siteborne/verification`,
`@siteborne/provider-adapters`, `@siteborne/service-runtime`, Hono, and the
full `WebContextVerifiedService` → `PublicHttpAdapter` →
`SafeSocketHttpClient` chain) versus the minimal control's zero imports —
but this checkpoint's evidence does not prove that; it only narrows the
search space by eliminating three other plausible causes.

- `REMOTE_PREVIEW_FAILURE_BOUNDARY`: Wrangler CLI authenticated → preview
  script registration succeeds (both sessions) → local proxy reaches Ready
  (both sessions) → request accepted locally (both sessions) → **remote
  forwarding/TLS leg fails for the SITEBORNE bundle specifically, succeeds
  for the minimal bundle** → SITEBORNE Worker fetch handler never executes.
- `SITEBORNE_APPLICATION_BELOW_FAILURE_BOUNDARY=YES` (in the narrow sense
  that *some* property of the SITEBORNE bundle — not yet identified — sits
  below the observed failure boundary; not proven to be transport code
  specifically, since even the inert route fails).
- `REMOTE_PREVIEW_525_ROOT_CAUSE_CLASS`: does not cleanly fit any of
  A–E as originally enumerated (none is a proven local-proxy/TLS-interference
  or account/zone-config cause, and it is demonstrably not a blanket
  Cloudflare-wide preview outage, since the minimal control succeeded
  throughout, including during the same time window as the failing SITEBORNE
  probes). Recorded as **`F_UNRESOLVED`** — genuinely unresolved, but
  substantially narrowed rather than a bare unknown.
- `REMOTE_PREVIEW_525_ROOT_CAUSE_PROVEN=NO`
- `CLOUDFLARE_ISSUE_PACKET_READY=NOT_REQUIRED` (the checkpoint's own criterion
  for that packet is a root cause that implicates Cloudflare/Wrangler
  infrastructure broadly; this evidence points toward something specific to
  SITEBORNE's own bundle instead, so a Cloudflare-support packet is not the
  right next artifact).

## Production safety

| Field | Value |
|---|---|
| `WORKER_VERSION_UPLOADS` | 0 |
| `PRODUCTION_DEPLOYMENTS` | 0 |
| `FINAL_PRODUCTION_VERSION` | `de70bf98-f304-4d7f-b189-4ae2401041a0` |
| `FINAL_PRODUCTION_TRAFFIC` | 100% |
| `FINAL_PRODUCTION_PREFLIGHT` | PASS |
| `LIVE_402_REQUESTS` | 0 |
| `PAYMENT_SIGNATURES_CREATED` | 0 |
| `PAID_REQUESTS` | 0 |
| `SETTLEMENTS` | 0 |
| `REAL_ECONOMIC_EFFECT_USDC` | 0 |

## Cleanup

- All checkpoint-owned `wrangler dev --remote` / `workerd` sessions (ports
  18799, 18801–18805) stopped by exact PID.
- Temporary minimal-control directories removed from scratchpad; nothing
  committed from them.
- One orphaned, already-in-use SUN-1221E5Q2 route (`/__diag/health`, the
  inert probe this checkpoint relied on) was found as an uncommitted local
  diff and committed separately for evidence hygiene (commit `4a64e6b`) — it
  is unrelated to this checkpoint's own findings, pre-dates it, and changes
  no transport/payment behavior.
- 7 unrelated `workerd` processes found running under a different, unrelated
  project directory (`/Users/meta4ickal/siteborne-sun1216/`, dated 2026-08-22)
  were identified and deliberately left untouched — out of scope, not
  checkpoint-owned.

`CHECKPOINT_REMOTE_SESSIONS_STOPPED=YES`
`TEMP_MINIMAL_CONTROL_REMOVED=YES`
`PRODUCTION_ARTIFACTS_REMOVED=NOT_APPLICABLE`

## Next step

`ROOT_CAUSE_FIX_CHECKPOINT_REQUIRED=NO` (no fix is eligible — no proven
defect exists in SITEBORNE source, and no Cloudflare/Wrangler defect is
proven either). The next productive investigation step, if pursued, is
bisecting `webctx-remote-diagnostic.ts`'s own import graph/bundle (not its
wrangler config) against the minimal control — e.g. by incrementally adding
its actual dependencies to an otherwise-minimal Worker — rather than further
wrangler-config permutation, since this checkpoint's 3-request config budget
already ruled out every wrangler-config-level candidate.

`SUN1221E6_REAL_PAID_RETRY_ELIGIBLE=NO`
