/**
 * Real `A2aProjectionContext` builder for runtime shadow comparison
 * (METADATA-VCM-IMPL-04A). Every literal/typed-export source here is
 * exactly the one METADATA-VCM-IMPL-03B's own real-data parity test
 * (`a2a-shadow.test.ts`'s `AGENT_CARD_LITERALS`/`realContext`) already
 * proved reproduces `buildUnsignedSiteborneAgentCard()` byte-for-byte --
 * this module exists only so that same context construction is callable
 * from production integration code, not re-derived independently.
 *
 * `name`/`description`/`version`/`documentationUrl`/`provider` are hand-
 * copied literals because `card.ts` hardcodes them inline with no other
 * typed authority (confirmed by 03B); every other field is a real typed
 * export, never re-authored here.
 */
import {
  A2A_PROTOCOL_VERSION,
  SITEBORNE_A2A_INTERFACE_URL,
  SITEBORNE_A2A_ORIGIN,
  SITEBORNE_MTLS_SECURITY_SCHEME_DESCRIPTION,
  SITEBORNE_MTLS_SECURITY_SCHEME_KEY,
  SITEBORNE_SERVICE_IDS,
  SITEBORNE_X402_EXTENSION_URI,
} from '@siteborne/protocol-a2a';
import {
  BAZAAR_PAYMENT_POLICY,
  resolveServiceRoute,
  type PaymentDestination,
} from '@siteborne/protocol-x402';
import type { SiteborneServiceId } from '@siteborne/protocol-x402';
import type { CanonicalServiceIdValue } from '../service-id';
import type { A2aProjectionContext } from './types';

const AGENT_CARD_LITERALS = {
  agentName: 'SITEBORNE Utility Network',
  agentDescription:
    'Four bounded evidence, context, document, and verification services with PCC receipts and x402 payment enforcement.',
  agentVersion: '1.0.0',
  documentationUrl: 'https://siteborne.net/docs/a2a',
  provider: { organization: 'SITEBORNE', url: 'https://siteborne.com' },
} as const;

export function buildRealA2aShadowContext(
  effectiveProductionStatusByServiceId: Partial<Record<SiteborneServiceId, boolean>>,
  mtlsProductionActive: boolean,
  paymentDestination: PaymentDestination | null = null,
  securityDeclarationExtension: A2aProjectionContext['securityDeclarationExtension'] = null
): A2aProjectionContext {
  return {
    ...AGENT_CARD_LITERALS,
    interfaceUrl: SITEBORNE_A2A_INTERFACE_URL,
    protocolVersion: A2A_PROTOCOL_VERSION,
    x402ExtensionUri: SITEBORNE_X402_EXTENSION_URI,
    x402Version: 2,
    resourceOrigin: SITEBORNE_A2A_ORIGIN,
    serviceOrder: SITEBORNE_SERVICE_IDS as readonly CanonicalServiceIdValue[],
    resourcePath: (serviceId) => resolveServiceRoute(serviceId as SiteborneServiceId).path,
    scheme: (serviceId) => BAZAAR_PAYMENT_POLICY[serviceId as SiteborneServiceId].scheme,
    effectiveProductionStatusByServiceId: effectiveProductionStatusByServiceId as Readonly<
      Partial<Record<CanonicalServiceIdValue, boolean>>
    >,
    mtlsSecurityScheme: mtlsProductionActive
      ? {
          key: SITEBORNE_MTLS_SECURITY_SCHEME_KEY,
          description: SITEBORNE_MTLS_SECURITY_SCHEME_DESCRIPTION,
        }
      : null,
    paymentDestination,
    ...(securityDeclarationExtension ? { securityDeclarationExtension } : {}),
  };
}
