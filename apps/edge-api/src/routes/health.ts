import { Hono } from 'hono';
import { validateHealthResponse } from '@siteborne/contracts';

export const healthRoute = new Hono();

healthRoute.get('/', (c) => {
  const response = {
    status: 'ok' as const,
    timestamp: new Date().toISOString(),
    version: '0.0.0',
    uptime_seconds: Math.floor(process.uptime()),
  };

  const validated = validateHealthResponse(response);
  return c.json(validated);
});
