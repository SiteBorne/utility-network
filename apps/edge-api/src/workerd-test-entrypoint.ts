/**
 * SUN-1200 checkpoint F remediation — a TEST-ONLY Worker entrypoint,
 * used exclusively by `tests/workerd/*.workerd-test.ts`
 * (`wrangler.workerd-test.toml`'s `main`). Never referenced by the real
 * `wrangler.toml`, never deployed.
 *
 * Deliberately mounts only `buildPaidServicesApp` (the real,
 * unmocked production code path for `createX402ServiceRoute`'s input-
 * schema validation, the exact thing this checkpoint's incident and fix
 * concern) rather than the full `index.ts` app. `index.ts` also
 * unconditionally mounts `/a2a`, whose real, already-accepted,
 * module-top-level `Ajv` usage (`packages/protocol-a2a/src/executor.ts`)
 * hits an unrelated CJS/ESM interop limitation specific to this pinned
 * `@cloudflare/vitest-pool-workers` version's own module loader when
 * `require()`-ing one of AJV's internal `.json` ref files -- confirmed
 * NOT a genuine `workerd` runtime restriction (that exact code already
 * runs successfully in the real deployed Worker's `/a2a` route today;
 * only this specific test-tooling version's loader trips on it).
 * Scoping this entrypoint to just the paid-service routes keeps the
 * real regression proof (does `createX402ServiceRoute` crash under real
 * workerd) intact without depending on unrelated, already-proven code.
 */
import { Hono } from 'hono';
import { buildPaidServicesApp } from './control-plane/routes/paid-services';
import { healthRoute } from './routes/health';
import type { Env } from './control-plane/config/env';

let cachedApp: Hono | undefined;
let cachedDb: Env['DB'] | undefined;

const app = new Hono<{ Bindings: Env }>();
app.route('/health', healthRoute);
app.all('/v2/*', async (c) => {
  if (!cachedApp || cachedDb !== c.env.DB) {
    cachedApp = await buildPaidServicesApp({ db: c.env.DB, evidenceMode: 'fixture' });
    cachedDb = c.env.DB;
  }
  return cachedApp.fetch(c.req.raw, c.env);
});

export default app;
