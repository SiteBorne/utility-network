import { Hono } from 'hono';
import { validateReadinessResponse } from '@siteborne/contracts';
import type { Env } from '../control-plane/config/env';
import { derivePublicReleaseState } from './public-release-state';

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
 * SEMANTIC MEANING).
 *
 * PRODUCTION-RELEASE-TRUTHFULNESS-01 separates that capability fact from
 * public-runtime readiness. `derivePublicReleaseState` owns status, phase,
 * real dependency blockers, and reason; paid activation remains an
 * independently derived field and may truthfully be false while the public
 * runtime is ready. */
readinessRoute.get('/', async (c) => {
  const state = await derivePublicReleaseState(c.env);
  const response = {
    status: state.status,
    phase: state.phase,
    production_services_enabled: state.productionServicesEnabled,
    blocked_external: state.blockers,
    reason: state.reason,
  };

  const validated = validateReadinessResponse(response);
  return c.json(validated);
});
