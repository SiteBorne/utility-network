/**
 * Protocol-side access to the canonical economic contract owned by
 * `@siteborne/pricing`. Legacy surfaces (A2A card, catalog, Bazaar, OpenAPI)
 * build their economic content ONLY through `projectServiceEconomics`, so no
 * surface can author an amount, scheme, tier, limit, mode, or destination of
 * its own. `@siteborne/protocol-a2a` reaches the contract through this module
 * (it depends on x402, not on pricing directly).
 */
import {
  buildEconomicOffer,
  projectEconomicOffer,
  type EconomicOfferProjection,
  type PaymentDestination,
} from '@siteborne/pricing';
import { canonicalResourceUrl } from '../bazaar/routes';
import type { SiteborneServiceId } from '../types';

export {
  ECONOMIC_SERVICE_IDS,
  buildAllEconomicOffers,
  buildEconomicOffer,
  canonicalEconomicProjectionJson,
  challengePricingKey,
  checkModeAvailability,
  compareEconomicProjections,
  governDeclaredLimitations,
  isEconomicServiceId,
  projectEconomicOffer,
  validateEconomicProjection,
  resolveMaxDocumentPages,
  type EconomicOffer,
  type EconomicOfferProjection,
  type EconomicServiceId,
  type PaymentDestination,
} from '@siteborne/pricing';

export interface ServiceEconomicsRuntime {
  /** OPERATIONAL: derived by the caller from real runtime gates. */
  readonly productionEnabled: boolean;
  /** OPERATIONAL: `null` means not configured -- never a sentinel string. */
  readonly destination: PaymentDestination | null;
}

/** The one legacy-surface entry point: canonical offer + canonical resource
 * URL + injected operational facts. */
export function projectServiceEconomics(
  serviceId: SiteborneServiceId,
  runtime: ServiceEconomicsRuntime
): EconomicOfferProjection {
  return projectEconomicOffer(buildEconomicOffer(serviceId), {
    resource: canonicalResourceUrl(serviceId),
    productionEnabled: runtime.productionEnabled,
    destination: runtime.destination,
  });
}
