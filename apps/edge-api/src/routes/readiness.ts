import { Hono } from 'hono';
import { validateReadinessResponse } from '@siteborne/contracts';
import { resolveVerifyAgentOutputV2CdpEffectiveDiscoveryStatus } from '../control-plane/config/production-payment';
import type { Env } from '../control-plane/config/env';

export const readinessRoute = new Hono<{ Bindings: Env }>();

/** SUN-1220Q2 -- `production_services_enabled` was a compile-time-constant
 * `false` literal (`readinessRoute` never read `c.env`), directly
 * contradicting live reality once a real paid route was active on this
 * exact Worker version (SUN-1220Q's rollback). Reuses the identical
 * version-local resolver `/catalog`'s discovery-truthfulness fix
 * (SUN-1220P2) already uses -- no gate logic is duplicated here. See
 * `resolveVerifyAgentOutputV2CdpEffectiveDiscoveryStatus`'s own doc
 * comment for exactly which gates/bindings this checks. `status`/
 * `phase`/`reason` are unchanged (SUN-1220Q1 §9/§4D): they describe
 * broader platform readiness, not this one service's runtime state. */
readinessRoute.get('/', (c) => {
  const hasDb = Boolean(c.env?.DB);
  const productionServicesEnabled = c.env
    ? resolveVerifyAgentOutputV2CdpEffectiveDiscoveryStatus(c.env, hasDb)
    : false;

  const response = {
    status: 'not_ready' as const,
    phase: 'foundation',
    production_services_enabled: productionServicesEnabled,
    // SUN-1220Q1: `cloudflare_account_configuration`, `seller_wallet`, and
    // `cdp_credentials` are proven resolved by direct evidence (this
    // session's own `production:preflight` PASS; SUN-1220O's real
    // settlement). The remaining three have no evidence source in this
    // repository to check and are carried forward unchanged, not guessed.
    blocked_external: ['ionos_dns_migration', 'nevermined_credentials', 'registry_publication'],
    reason:
      'Service contracts and production dependencies are not yet verified. Only health/readiness endpoints available.',
  };

  const validated = validateReadinessResponse(response);
  return c.json(validated);
});
