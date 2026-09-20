/**
 * SETTLEMENT-OBSERVABILITY-01 -- continuation-host Worker probe entry
 * (`wrangler.paid-continuation-runtime.toml`).
 *
 * Bundled by Wrangler (esbuild) with the REAL host entrypoint graph
 * (`workflow-host-entrypoint.ts`: `PaidContinuationWorkflow`, the settle step
 * and the CDP provider it composes). Re-exports the host's Workflow class
 * unchanged so the host config's `[[workflows]] class_name` still resolves; the
 * host's inert 404 default handler is preserved for every non-probe path.
 */
import host from '../../../src/workflow-host-entrypoint';
import { PROBE_PATH, probe } from './cdp-jwt-probe-core';

export { PaidContinuationWorkflow } from '../../../src/workflow-host-entrypoint';

export default {
  async fetch(request: Request, env: unknown, ctx: unknown): Promise<Response> {
    if (new URL(request.url).pathname === PROBE_PATH) return probe();
    return (host as { fetch: (r: Request, e: unknown, c: unknown) => Promise<Response> }).fetch(
      request,
      env,
      ctx
    );
  },
};
