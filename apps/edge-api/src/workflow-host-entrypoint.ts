/**
 * SUN-1221E6R-H2BF4 — dedicated Workflow-host entrypoint.
 *
 * This is the `main` module of a SEPARATE Worker script
 * (`siteborne-paid-continuation-runtime`, see
 * `wrangler.paid-continuation-runtime.toml`) whose only job is to host
 * `PaidContinuationWorkflow` so the `siteborne-paid-continuation` Workflow
 * resource can be registered against it via a normal, single-version
 * `wrangler deploy` (the one command Cloudflare documents as producing a
 * compiled Workflow DAG — see
 * `docs/design/SUN-1221E6R-H2BF4-dedicated-workflow-host-architecture.md`
 * and `docs/reports/SUN-1221E6R-H2BF3-workflow-version-id-graph-forensics.md`
 * §12/§19 for why the public API Worker's own `versions upload` /
 * `versions deploy` / `triggers deploy` release pipeline can never do
 * this directly) WITHOUT that single-version `wrangler deploy` ever
 * touching the public SITEBORNE API Worker's own 100%/0% traffic split.
 *
 * This file exports EXACTLY:
 *   - `PaidContinuationWorkflow` (named export, real, unmodified —
 *     `class_name` in the host Wrangler config).
 *   - a default export satisfying the Workers module-worker format
 *     requirement (`cloudflare:workers` imports require ES module format;
 *     empirically confirmed this checkpoint via `wrangler deploy --dry-run`
 *     against a throwaway probe script: a Worker with zero default export
 *     fails to build with "Unexpected external import of
 *     'cloudflare:workers'... Your worker has no default export"). This
 *     default export's `fetch` handler is permanently, unconditionally a
 *     404 — it exists ONLY to satisfy that platform build requirement, not
 *     to serve any request. It never imports, mounts, or forwards to
 *     `index.ts`'s Hono app, the MCP route, the A2A route, any
 *     `/v1/*`/`/v2/*` paid route, or any diagnostic/test handler.
 *
 * `WORKFLOW_RUNTIME_PUBLIC_ROUTES=0`, `WORKFLOW_RUNTIME_HTTP_API_SURFACE=0`
 * (H2BF4 design doc §4 hard invariants) — this inert 404 is the entire
 * HTTP surface of this script.
 *
 * SUN-1221E6R-H2B2-R1: also registers the build-time-precompiled
 * output-schema validators at module load, exactly like the two real
 * production API route entrypoints already do (see
 * `production-web-context-v2-cdp-route.ts` / `production-verify-v2-cdp-route.ts`
 * and the SUN-1200 checkpoint F incident report). The first real H2B2
 * payment attempt reached this host's `PaidContinuationWorkflow` and threw
 * `EvalError: Code generation from strings disallowed for this context`
 * inside `SchemaVerifier`'s output-validation step: this host never made
 * this call, so `getPrecompiledOutputValidator()` returned `undefined` and
 * execution fell through to `getAjv()`'s runtime AJV-compilation path,
 * which the real Workers isolate blocks. Idempotent and side-effect-free
 * if called more than once (see `setPrecompiledOutputValidators`'s own
 * doc comment) -- safe to keep alongside the public API Worker's own,
 * separate module-load registration.
 */
import { setPrecompiledOutputValidators } from '@siteborne/verification';
import { outputValidatorsById } from './generated/output-validators.generated.js';

setPrecompiledOutputValidators(outputValidatorsById);

export { PaidContinuationWorkflow } from './control-plane/workflows/paid-continuation-workflow';

export default {
  async fetch(_request: Request): Promise<Response> {
    return new Response('not found', { status: 404 });
  },
};
