/**
 * SUN-1201 checkpoint G — DETERMINISTIC POST-SETTLEMENT WORKER-RUNTIME
 * PROOF. A test-only Worker entrypoint, structurally separate from the
 * real production entrypoint (`index.ts`) and the real production
 * `wrangler.toml`, whose ONLY purpose is to let
 * `scripts/test-worker-runtime.mts` drive `verify_agent_output` through
 * real post-settlement execution inside real `workerd` -- the one proof
 * SUN-1200 checkpoint F's own harness could not safely produce, because
 * that harness's `wrangler dev` instance is wired with the real
 * production CDP facilitator client and real seller wallet.
 *
 * THE PRODUCTION WORKER NEVER IMPORTS THIS FILE. `index.ts` -- the file
 * `wrangler.toml`'s `main` field actually points at -- has no import of
 * `worker-runtime-test-entrypoint.ts` anywhere, so esbuild's real
 * `wrangler deploy`/`wrangler deploy --dry-run` bundle for the real
 * Worker never includes this module's code at all (proven, not merely
 * asserted, by `scripts/test-worker-runtime.mts`'s bundle-isolation
 * check: it greps a fresh `wrangler deploy --dry-run` output of the REAL
 * `wrangler.toml` for this file's own distinctive marker string and
 * requires zero matches).
 *
 * This entrypoint calls the exact same, real, unmodified
 * `buildPaidServicesApp` (`control-plane/routes/paid-services.ts`) the
 * real production Worker calls -- same Hono app construction, same
 * route mounting, same `x402-service.ts`, same Profile 1 pre-economic
 * gate (`checkSchemaProfile1`), same `verify_agent_output` service
 * (`schema_valid` via the real `checkSchemaProfile1`/
 * `validateAgainstProfile1`), same `verifyAndSign`/SchemaVerifier
 * output-validation path. The ONLY difference from production: this
 * file hard-codes `evidenceMode: 'fixture'` and a
 * `FixturePaymentEvidenceProvider` instance directly in source code --
 * never read from any `env` binding, query parameter, header, cookie,
 * or D1/KV/R2 value, so there is no request-controlled, environment-
 * controlled, or storage-controlled way to select it. A deployed
 * production Worker (built from `index.ts`/`wrangler.toml`) has no
 * knowledge this file exists.
 *
 * `FixturePaymentEvidenceProvider` produces exclusively
 * `synthetic_fixture`-trust-class evidence
 * (`@siteborne/protocol-x402`'s own doc comment) -- no network call, no
 * facilitator, no credential, ever. `PAID_ROUTES_ENABLED`/D1 binding are
 * still required exactly as in production (this entrypoint does not
 * relax that gate); `wrangler.worker-runtime-test.toml` supplies them
 * pointed at the harness's own isolated `--persist-to` state.
 */
import { Hono } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import { FixturePaymentEvidenceProvider } from '@siteborne/protocol-x402';
import { buildPaidServicesApp } from './control-plane/routes/paid-services';

// `scripts/test-worker-runtime.mts`'s bundle-isolation check searches a
// fresh `wrangler deploy --dry-run` of the REAL `wrangler.toml` for this
// module's own source chunk (esbuild emits a `// apps/edge-api/src/
// worker-runtime-test-entrypoint.ts` comment for every real source file
// it actually bundles) and requires zero matches -- not merely absence
// of a hand-picked marker string, but absence of this file's own
// bundled module chunk entirely.
const WORKER_RUNTIME_TEST_ENTRYPOINT_MARKER = 'SUN-1201-WORKER-RUNTIME-TEST-ENTRYPOINT-b7f2c4';

interface TestEnv {
  DB: D1Database;
}

let cachedApp: Awaited<ReturnType<typeof buildPaidServicesApp>> | undefined;
let cachedDb: D1Database | undefined;

const app = new Hono<{ Bindings: TestEnv }>();

app.all('/v1/*', async (c) => {
  if (!c.env.DB) {
    return c.json({ error: 'configuration_error', message: 'no D1 binding configured' }, 500);
  }
  if (!cachedApp || cachedDb !== c.env.DB) {
    cachedApp = await buildPaidServicesApp({
      db: c.env.DB,
      evidenceMode: 'fixture',
      evidenceProvider: new FixturePaymentEvidenceProvider(),
    });
    cachedDb = c.env.DB;
  }
  return cachedApp.request(c.req.raw);
});

app.all('/v2/*', async (c) => {
  if (!c.env.DB) {
    return c.json({ error: 'configuration_error', message: 'no D1 binding configured' }, 500);
  }
  if (!cachedApp || cachedDb !== c.env.DB) {
    cachedApp = await buildPaidServicesApp({
      db: c.env.DB,
      evidenceMode: 'fixture',
      evidenceProvider: new FixturePaymentEvidenceProvider(),
    });
    cachedDb = c.env.DB;
  }
  return cachedApp.request(c.req.raw);
});

app.get('/', (c) => c.json({ marker: WORKER_RUNTIME_TEST_ENTRYPOINT_MARKER, ok: true }));

export default app;
