/**
 * Public edge-API Worker probe entry (root `wrangler.toml`). The behavioural
 * probe itself lives in `cdp-jwt-probe-core.ts`; this entry only bundles it
 * together with the ENTIRE public production Worker graph.
 */
import worker from '../../../src/index';
import { PROBE_PATH, probe } from './cdp-jwt-probe-core';

export default {
  ...worker,
  async fetch(request: Request, env: unknown, ctx: unknown): Promise<Response> {
    if (new URL(request.url).pathname === PROBE_PATH) return probe();
    return (worker as { fetch: (r: Request, e: unknown, c: unknown) => Promise<Response> }).fetch(
      request,
      env,
      ctx
    );
  },
};
