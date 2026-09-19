/**
 * PRODUCTION-ECONOMICS-DISCOVERY-01 -- the pre-economic gate for capability
 * modes that have a governed price but no production implementation
 * (`web_context_verified` `rendered`, `verify_agent_output`
 * `independent_reproduction`).
 *
 * Wired as (part of) `X402ServiceRouteConfig.preEconomicBodyValidator`, which
 * `createX402ServiceRoute` runs AFTER frozen-schema validation and BEFORE any
 * quote is minted, any 402 challenge is emitted, any payment header is read,
 * any authorization is bound, or any provider is invoked. The mode table it
 * consults is the canonical economic contract in `@siteborne/pricing` -- the
 * same table every discovery surface projects -- so what a buyer is told is
 * purchasable and what the route will accept cannot drift apart.
 */
import { checkModeAvailability, type EconomicServiceId } from '@siteborne/pricing';

export type PreEconomicResult = { ok: true } | { ok: false; code: string; message: string };
export type PreEconomicValidator = (body: unknown) => PreEconomicResult;

/** Rejects a request that selects a defined-but-unavailable mode. */
export function modeAvailabilityValidator(serviceId: EconomicServiceId): PreEconomicValidator {
  return (body) => {
    const check = checkModeAvailability(serviceId, body);
    return check.ok ? { ok: true } : { ok: false, code: check.code, message: check.message };
  };
}

/** Runs validators in order; the first rejection wins and later ones never run. */
export function composePreEconomicValidators(
  ...validators: readonly PreEconomicValidator[]
): PreEconomicValidator {
  return (body) => {
    for (const validate of validators) {
      const result = validate(body);
      if (!result.ok) return result;
    }
    return { ok: true };
  };
}
