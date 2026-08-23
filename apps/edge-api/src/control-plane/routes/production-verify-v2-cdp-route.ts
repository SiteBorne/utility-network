/**
 * SUN-1216 checkpoint V — bundle integration for `verify_agent_output.v2`
 * / CDP.
 *
 * This is the one new entrypoint-reachable module for this checkpoint.
 * It does not redesign, duplicate, or modify any of the three SUN-1214
 * production modules (`buildProductionSigner`,
 * `buildVerifyAgentOutputV2ProductionExecutor`,
 * `buildVerifyAgentOutputV2CdpProductionRouteConfig`) or the shared
 * `createX402ServiceRoute` lifecycle handler -- it only makes the
 * already-real composition reachable from the actual Worker bundle.
 *
 * SUN-1218 checkpoint X: gated behind TWO flags, both required --
 * `PAID_ROUTES_ENABLED` (the global master/emergency-kill-switch, shared
 * with every other paid route family) AND `VERIFY_V2_CDP_ROUTE_ENABLED`
 * (new, route-specific, additive). `PAID_ROUTES_ENABLED` alone is no
 * longer sufficient to reach this route, and — critically — no longer
 * affects any *other* paid route's disposition either: the `/v1/*`/
 * `/v2/*` wildcards in `index.ts` are now unconditional 404s,
 * independent of any flag (see `index.ts`'s own SUN-1218 comment).
 *
 * Registered for exactly `POST /v2/verify/agent-output` (the one HTTP
 * method `createX402ServiceRoute` itself uses -- see
 * `x402-service.ts`'s `app.post(config.path, ...)`), mounted in
 * `index.ts` before the generic `app.all('/v2/*', ...)` fallback so
 * Hono matches this route first for this one path only. Every other
 * method on this path, and every other of the 12 paid routes, continues
 * through the existing, untouched wildcard handlers exactly as before.
 *
 * Disabled (either flag absent): returns `c.notFound()` -- byte-identical
 * to the pre-SUN-1216 behavior, with zero construction of the signer,
 * executor, or route config.
 *
 * Enabled + composition unavailable (missing/malformed signing key
 * material, missing key ID, or no D1 binding): falls back to the
 * existing, unmodified `productionServiceExecutorUnavailable` --  the
 * same governed 503 every other paid route already returns when its own
 * dependency chain is incomplete. No new response shape.
 *
 * Enabled + composition available: mounts a fresh `Hono` sub-app via
 * `createX402ServiceRoute` (mirroring the exact pattern already proven
 * under real workerd by `worker-runtime-test-entrypoint.ts`) and
 * forwards the request to it, reaching the real SUN-1214 production
 * composition.
 *
 * Caching: per the approved design's explicit caveat ("if there is any
 * doubt, do not cache in the first implementation"), only the
 * successfully-built sub-app is cached, keyed on the `DB` binding
 * identity (the same per-isolate identity check `index.ts`'s own
 * middleware already uses to select the D1-backed repository). The
 * unavailable outcome is never cached -- that branch is cheap (a few
 * string checks plus one key-derivation attempt) and re-evaluating it on
 * every request avoids any possibility of a stale negative result
 * surviving a config change within the same isolate.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { setPrecompiledOutputValidators } from '@siteborne/verification';
import type { Env } from '../config/env';
import { productionServiceExecutorUnavailable } from './production-paid-services';
import { createX402ServiceRoute } from './x402-service';
import { buildVerifyAgentOutputV2CdpProductionRouteConfig } from '../production/verify-agent-output-v2-cdp-composition';
import { outputValidatorsById } from '../../generated/output-validators.generated.js';

// SUN-1200 checkpoint F (P0-A) registered these build-time-precompiled
// output-schema validators once at real Worker module-load time -- but
// it did so from `paid-services.ts` (the fixture-backed module),
// documented at the time as "this file is imported by index.ts". SUN-
// 1206 correctly excluded `paid-services.ts` from the real production
// entrypoint (that file must remain fixture-isolated -- directive
// boundary, unchanged here), which silently broke that registration's
// only real-Worker trigger. Nothing caught it because no production-
// reachable code exercised `SchemaVerifier`'s output-validation step
// (via `verifyAndSign`) until this checkpoint's own composition did --
// confirmed live: without this call, the real production entrypoint's
// first genuine execution hit `getAjv().getSchema(...)`'s runtime
// filesystem-based compile fallback and crashed with
// `EvalError: Code generation from strings disallowed for this
// context`, the exact class of incident SUN-1200 checkpoint F already
// fixed once for `inputSchema` (see `x402-service.ts`'s own comment on
// `config.inputSchema`). Registering the same precompiled validators
// from this module (rather than from `paid-services.ts`) fixes the
// real gap without importing anything fixture-shaped and without
// touching `paid-services.ts`, `x402-service.ts`,
// `VerifyAgentOutputService`, or any receipt/pricing/D1-schema surface.
// Idempotent and side-effect-free beyond this in-memory registration --
// safe to run at module load, unconditionally, regardless of whether
// `PAID_ROUTES_ENABLED` is ever set.
setPrecompiledOutputValidators(outputValidatorsById);

let cachedSubApp: Hono | undefined;
let cachedDb: Env['DB'] | undefined;

export async function verifyAgentOutputV2CdpProductionRoute(
  c: Context<{ Bindings: Env }>
): Promise<Response> {
  // SUN-1218 checkpoint X: two-level gate. The global master switch is
  // checked first, unconditionally -- setting it back to false makes
  // this route 404 immediately, regardless of the route-specific gate's
  // value (the emergency kill switch is preserved exactly). The
  // route-specific gate is checked second; both must be the exact
  // literal 'true' before any dependency construction is attempted.
  if (c.env?.PAID_ROUTES_ENABLED !== 'true') {
    return c.notFound();
  }
  if (c.env?.VERIFY_V2_CDP_ROUTE_ENABLED !== 'true') {
    return c.notFound();
  }

  if (cachedSubApp && cachedDb === c.env.DB) {
    return cachedSubApp.request(c.req.raw);
  }

  // Explicit field-by-field extraction (mirroring
  // `worker-runtime-test-entrypoint.ts`'s own real-signer branch)
  // rather than passing `c.env` through directly -- the composition
  // module's `VerifyAgentOutputV2CdpProductionEnv` is intentionally a
  // narrower, standalone interface, not a structural subtype relied on
  // implicitly.
  const config = await buildVerifyAgentOutputV2CdpProductionRouteConfig(
    {
      PAID_RECEIPT_SIGNING_PRIVATE_KEY: c.env.PAID_RECEIPT_SIGNING_PRIVATE_KEY,
      PAID_RECEIPT_SIGNING_KEY_ID: c.env.PAID_RECEIPT_SIGNING_KEY_ID,
      SELLER_WALLET_ADDRESS: c.env.SELLER_WALLET_ADDRESS,
      CDP_API_KEY_ID: c.env.CDP_API_KEY_ID,
      CDP_API_KEY_SECRET: c.env.CDP_API_KEY_SECRET,
      PAYMENT_ENVIRONMENT: c.env.PAYMENT_ENVIRONMENT,
      PRODUCTION_ENABLED: c.env.PRODUCTION_ENABLED,
      HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP: c.env.HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP,
      PRODUCTION_CDP_CREDENTIALS_APPROVED: c.env.PRODUCTION_CDP_CREDENTIALS_APPROVED,
    },
    c.env.DB
  );
  if ('unavailable' in config) {
    return productionServiceExecutorUnavailable(c);
  }

  const subApp = new Hono();
  createX402ServiceRoute(subApp, config);
  cachedSubApp = subApp;
  cachedDb = c.env.DB;

  return subApp.request(c.req.raw);
}
