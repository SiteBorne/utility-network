import { Hono } from 'hono';
import { validateReadinessResponse } from '@siteborne/contracts';

export const readinessRoute = new Hono();

readinessRoute.get('/', (c) => {
  const response = {
    status: 'not_ready' as const,
    phase: 'foundation',
    production_services_enabled: false,
    blocked_external: [
      'cloudflare_account_configuration',
      'ionos_dns_migration',
      'seller_wallet',
      'cdp_credentials',
      'nevermined_credentials',
      'registry_publication',
    ],
    reason:
      'Service contracts and production dependencies are not yet verified. Only health/readiness endpoints available.',
  };

  const validated = validateReadinessResponse(response);
  return c.json(validated);
});
