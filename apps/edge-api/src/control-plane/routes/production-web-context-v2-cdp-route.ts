/**
 * SUN-1221C — bundle integration for `web_context_verified.v2` / CDP,
 * mirroring `production-verify-v2-cdp-route.ts` exactly.
 *
 * Registered for exactly `POST /v2/web/context`, mounted in `index.ts`
 * before the generic `app.all('/v2/*', ...)` 404 fallback, so Hono
 * matches this route first for this one path only -- every other method
 * on this path, and every other of the (now) 10 remaining paid routes,
 * continues through the existing, untouched wildcard handlers exactly as
 * before. Gated by `PAID_ROUTES_ENABLED` AND `WEB_CONTEXT_V2_CDP_ROUTE_ENABLED`
 * (both required, checked inside the handler itself) -- independent of
 * `VERIFY_V2_CDP_ROUTE_ENABLED`; default-absent on either -> 404,
 * identical to the pre-SUN-1221C behavior for this path.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { setPrecompiledOutputValidators } from '@siteborne/verification';
import type { Env } from '../config/env';
import { productionServiceExecutorUnavailable } from './production-paid-services';
import { createX402ServiceRoute } from './x402-service';
import { buildWebContextV2CdpProductionRouteConfig } from '../production/web-context-v2-cdp-composition';
import { isWebContextV2CdpRouteFlagEnabled } from '../config/production-payment';
import { outputValidatorsById } from '../../generated/output-validators.generated.js';

// Mirrors `production-verify-v2-cdp-route.ts`'s own registration exactly
// (see that file's doc comment for the full SUN-1200/SUN-1214 history).
// `outputValidatorsById` is a single shared map already covering every
// bundled service's output schema, not verify-specific -- registering it
// again here is redundant with verify's own module-load call whenever
// both routes are imported together (as they are, in `index.ts`), but
// keeps this route module correct and self-sufficient on its own,
// independent of import order. Idempotent and side-effect-free.
setPrecompiledOutputValidators(outputValidatorsById);

let cachedSubApp: Hono | undefined;
let cachedDb: Env['DB'] | undefined;

export async function webContextVerifiedV2CdpProductionRoute(
  c: Context<{ Bindings: Env }>
): Promise<Response> {
  // Two-level gate, mirroring the verify route exactly: the global master
  // switch and this route's own specific gate must both be the exact
  // literal 'true' before any dependency construction is attempted --
  // setting the master switch back to false makes this route 404
  // immediately regardless of this route's own flag (the emergency kill
  // switch is preserved exactly, and is shared/global across every paid
  // route, including this one).
  if (!c.env || !isWebContextV2CdpRouteFlagEnabled(c.env)) {
    return c.notFound();
  }

  if (cachedSubApp && cachedDb === c.env.DB) {
    return cachedSubApp.request(c.req.raw);
  }

  const config = await buildWebContextV2CdpProductionRouteConfig(
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
