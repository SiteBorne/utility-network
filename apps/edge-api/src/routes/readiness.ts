import { Hono } from 'hono';
import { validateReadinessResponse } from '@siteborne/contracts';
import { EFFECTIVE_DISCOVERY_RESOLVERS } from '../control-plane/config/production-payment';
import type { Env } from '../control-plane/config/env';

export const readinessRoute = new Hono<{ Bindings: Env }>();

/** SUN-1220Q2 -- `production_services_enabled` was a compile-time-constant
 * `false` literal (`readinessRoute` never read `c.env`), directly
 * contradicting live reality once a real paid route was active on this
 * exact Worker version (SUN-1220Q's rollback). Reuses the identical
 * version-local resolvers `/catalog`'s discovery-truthfulness fix
 * (SUN-1220P2) already uses -- no gate logic is duplicated here.
 *
 * SUN-1221C generalized this from a single hardcoded resolver call to an
 * OR across every entry in `EFFECTIVE_DISCOVERY_RESOLVERS` (SUN-1221CD
 * §23: this field's own documented meaning has always been "at least one
 * paid production service active", never specifically "verify_agent_
 * output.v2 active" -- proven by this comment's own prior wording, not
 * assumed; adding a second service changes the IMPLEMENTATION, not the
 * SEMANTIC MEANING). `status`/`phase`/`reason` remain unchanged
 * (SUN-1220Q1 §9/§4D): they describe broader platform readiness, not any
 * one service's runtime state. */
readinessRoute.get('/', (c) => {
  const hasDb = Boolean(c.env?.DB);
  const env = c.env;
  const productionServicesEnabled = env
    ? Object.values(EFFECTIVE_DISCOVERY_RESOLVERS)
        .filter((resolve): resolve is NonNullable<typeof resolve> => resolve !== undefined)
        .some((resolve) => resolve(env, hasDb))
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
