/**
 * SUN-1206 production paid-service disposition.
 *
 * Repository authority currently provides no complete Worker-compatible,
 * governed production executor for any paid service: the accepted service
 * registry is explicitly fixture/local-only, paid-service receipt key custody
 * is unimplemented, Browser Rendering and Modal artifact access remain
 * deferred, and the only Cloudflare-compatible artifact/audit composition is
 * not wired.  Production therefore exposes no economic challenge at all.
 *
 * This module deliberately imports no service-runtime, payment provider,
 * fixture, signer, worker bridge, artifact store, or audit sink.  Enabling a
 * route-family flag can only select this pre-economic unavailable response.
 */
import type { Context } from 'hono';
import type { Env } from '../config/env';

export const PRODUCTION_PAID_SERVICE_ROUTES = [
  '/v1/company/evidence-graph',
  '/v1/web/context',
  '/v1/document/evidence-json',
  '/v1/verify/agent-output',
  '/v2/company/evidence-graph',
  '/v2/web/context',
  '/v2/document/evidence-json',
  '/v2/verify/agent-output',
  '/v2/nevermined/company/evidence-graph',
  '/v2/nevermined/web/context',
  '/v2/nevermined/document/evidence-json',
  '/v2/nevermined/verify/agent-output',
] as const;

export type ProductionPaidServiceRoute = (typeof PRODUCTION_PAID_SERVICE_ROUTES)[number];

export const PRODUCTION_SERVICE_EXECUTOR_STATUS = 'UNIMPLEMENTED' as const;

export function productionServiceExecutorUnavailable(
  context: Context<{ Bindings: Env }>
): Response {
  return context.json(
    {
      error: 'service_executor_not_configured',
      message:
        'Paid service execution is unavailable until a governed production executor is configured',
    },
    503
  );
}
