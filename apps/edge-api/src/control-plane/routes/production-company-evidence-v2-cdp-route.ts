/**
 * SUN-1222B-S3R — bundle integration for `company_evidence_graph.v2` /
 * CDP, mirroring `production-web-context-v2-cdp-route.ts` exactly.
 *
 * Registered for exactly `POST /v2/company/evidence-graph`, mounted in
 * `index.ts` before the generic `app.all('/v2/*', ...)` 404 fallback, so
 * Hono matches this route first for this one path only -- every other
 * paid route continues through the existing, untouched wildcard handlers
 * exactly as before. Gated by `PAID_ROUTES_ENABLED` AND
 * `COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED` (both required, checked
 * inside the handler itself) -- independent of `VERIFY_V2_CDP_ROUTE_ENABLED`
 * and `WEB_CONTEXT_V2_CDP_ROUTE_ENABLED`; default-absent on either -> 404,
 * identical to the pre-SUN-1222B-S3R behavior for this path.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { setPrecompiledOutputValidators } from '@siteborne/verification';
import type { Env } from '../config/env';
import { productionServiceExecutorUnavailable } from './production-paid-services';
import { createX402ServiceRoute } from './x402-service';
import { buildCompanyEvidenceGraphV2CdpProductionRouteConfig } from '../production/company-evidence-graph-v2-cdp-composition';
import { isCompanyEvidenceGraphV2CdpRouteFlagEnabled } from '../config/production-payment';
import { outputValidatorsById } from '../../generated/output-validators.generated.js';
import { importContinuationEnvelopeKey } from '../continuation/envelope';

// Mirrors `production-web-context-v2-cdp-route.ts`'s own registration
// exactly. `outputValidatorsById` is a single shared map already covering
// every bundled service's output schema, not company-specific --
// registering it again here is redundant with the other production
// routes' own module-load calls whenever all are imported together (as
// they are, in `index.ts`), but keeps this route module correct and
// self-sufficient on its own, independent of import order. Idempotent and
// side-effect-free.
setPrecompiledOutputValidators(outputValidatorsById);

let cachedSubApp: Hono | undefined;
let cachedDb: Env['DB'] | undefined;

export async function companyEvidenceGraphV2CdpProductionRoute(
  c: Context<{ Bindings: Env }>
): Promise<Response> {
  // Two-level gate, mirroring the web-context/verify routes exactly: the
  // global master switch and this route's own specific gate must both be
  // the exact literal 'true' before any dependency construction is
  // attempted -- setting the master switch back to false makes this route
  // 404 immediately regardless of this route's own flag.
  if (!c.env || !isCompanyEvidenceGraphV2CdpRouteFlagEnabled(c.env)) {
    return c.notFound();
  }

  if (cachedSubApp && cachedDb === c.env.DB) {
    return cachedSubApp.request(c.req.raw);
  }

  const config = await buildCompanyEvidenceGraphV2CdpProductionRouteConfig(
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
      // Reused verbatim from `web_context_verified.v2`'s own safe-egress
      // executor -- see the composition module's doc comment.
      MODAL_WEBCTX_ENDPOINT_URL: c.env.MODAL_WEBCTX_ENDPOINT_URL,
      MODAL_WEBCTX_PROXY_KEY: c.env.MODAL_WEBCTX_PROXY_KEY,
      MODAL_WEBCTX_PROXY_SECRET: c.env.MODAL_WEBCTX_PROXY_SECRET,
    },
    c.env.DB
  );
  if ('unavailable' in config) {
    return productionServiceExecutorUnavailable(c);
  }

  // Mirrors `production-web-context-v2-cdp-route.ts`'s own H2AWI-3 fix:
  // the durable Workflow is the only settlement path -- fail closed
  // explicitly rather than letting each request discover this
  // individually.
  if (!c.env.PAID_CONTINUATION_WORKFLOW || !c.env.PAYMENT_CONTINUATION_ENCRYPTION_KEY) {
    return productionServiceExecutorUnavailable(c);
  }
  config.workflow = c.env.PAID_CONTINUATION_WORKFLOW;
  config.continuationEnvelopeKey = await importContinuationEnvelopeKey(
    c.env.PAYMENT_CONTINUATION_ENCRYPTION_KEY
  );

  const subApp = new Hono();
  createX402ServiceRoute(subApp, config);
  cachedSubApp = subApp;
  cachedDb = c.env.DB;

  return subApp.request(c.req.raw);
}
