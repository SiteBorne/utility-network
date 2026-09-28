import { Hono } from 'hono';
import { validateHealthResponse } from '@siteborne/contracts';
import type { Env } from '../control-plane/config/env';
import { runtimeVersionReport } from '../runtime-observation';

/** Deployment unit this route is served by (the public API Worker). */
export const EDGE_DEPLOYMENT_UNIT = 'siteborne-utility-edge';

export const healthRoute = new Hono<{ Bindings: Env }>();

healthRoute.get('/', (c) => {
  // R3-A4-55: the executing Worker's own version metadata, when bound.
  const runtime = runtimeVersionReport(c.env?.CF_VERSION_METADATA, EDGE_DEPLOYMENT_UNIT);
  const response = {
    status: 'ok' as const,
    timestamp: new Date().toISOString(),
    version: '0.0.0',
    uptime_seconds: Math.floor(process.uptime()),
    ...(runtime ? { runtime } : {}),
  };

  const validated = validateHealthResponse(response);
  return c.json(validated);
});
