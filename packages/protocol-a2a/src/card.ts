import type { AgentCard, AgentSkill } from '@a2a-js/sdk';
import {
  BAZAAR_PAYMENT_POLICY,
  REGISTRY_SERVICES,
  projectServiceEconomics,
  resolveServiceRoute,
  type PaymentDestination,
  type SiteborneServiceId,
} from '@siteborne/protocol-x402';
import {
  A2A_PROTOCOL_VERSION,
  SITEBORNE_A2A_INTERFACE_URL,
  SITEBORNE_A2A_ORIGIN,
  SITEBORNE_MTLS_SECURITY_SCHEME_DESCRIPTION,
  SITEBORNE_MTLS_SECURITY_SCHEME_KEY,
  SITEBORNE_SERVICE_IDS,
  SITEBORNE_X402_EXTENSION_URI,
} from './constants';

const JSON_MEDIA_TYPE = 'application/json';

/** SUN-1222B (Agent Card skill normalization): `company_evidence_graph.v1`
 * and `.v2` (and the other three families) carry byte-identical
 * `title`/`description`/`capabilities` in the registry -- SUN-1000
 * checkpoint 1M added v2 alongside v1 with "same economics, same schemas,
 * only service_id/service_version differ" -- so before this fix `buildSkill`
 * produced two visually-indistinguishable `AgentSkill` entries per family
 * (external machine discovery, observed live via Agenstry, reported this as
 * duplicate skills). The eight IDs stay: `executor.ts`'s `SERVICE_ID_SET`
 * dispatches directly on the full `<family>.v<n>` id, every frozen
 * input/output schema and x402 price is keyed by it, and
 * `docs/contracts/VERSIONING.md` documents `.v1`/`.v2` as a "stable public
 * service-major identity" -- a real, permanent compatibility contract, not
 * decorative metadata `AgentSkill` has no standard `versions` field to
 * collapse into anyway. So the fix distinguishes the human-facing name and
 * description per skill instead of reducing skill count: the service
 * contract major is now stated explicitly in both, and each description
 * points to this same Agent Card's x402 extension `services[]` (and the
 * public catalog/OpenAPI) for that id's current production status, pricing,
 * and schema -- rather than duplicating (and risking drifting from) values
 * this file already emits elsewhere. */
function buildSkill(serviceId: (typeof SITEBORNE_SERVICE_IDS)[number]): AgentSkill {
  const service = REGISTRY_SERVICES[serviceId];
  const versionLabel = service.service_version.toUpperCase();

  return {
    id: service.service_id,
    name: `${service.title} (${versionLabel})`,
    description:
      `${service.description} SITEBORNE service contract major ` +
      `${service.service_version} -- see this id ("${service.service_id}") in this ` +
      `Agent Card's x402 extension params and the SITEBORNE service catalog/OpenAPI ` +
      'for its exact schema, pricing, and current production status.',
    tags: [...service.capabilities, service.service_version],
    examples: [],
    inputModes: [JSON_MEDIA_TYPE],
    outputModes: [JSON_MEDIA_TYPE],
    securityRequirements: [],
  };
}

/** SUN-1222B (post-release hardening) -- superseding the SUN-1220P2 stance.
 * That checkpoint hardcoded the top-level `productionEnabled` to a literal
 * `false` regardless of any per-service value, on the reasoning that it was
 * a conservative "blanket disclosure" that predated any service being
 * truthfully active. That reasoning stopped holding the moment SUN-1221G
 * promoted a real service to production (confirmed live, SUN-1222A §4):
 * the deployed card now reads top-level `productionEnabled: false` while
 * `verify_agent_output.v2` and `web_context_verified.v2` underneath it both
 * read `productionEnabled: true` -- the exact "even if intentional, this
 * creates machine-consumer ambiguity" case the field exists to prevent, not
 * cause. A machine client that trusts only the top-level summary (a
 * reasonable reading of a field named identically to, and positioned above,
 * the per-service ones) concludes nothing is callable and never discovers
 * the two services that actually are.
 *
 * Fixed by deriving the top-level flag as a true aggregate ("at least one
 * declared service is production-callable") instead of a hand-set literal,
 * so it can never again silently disagree with the per-service values it
 * summarizes -- no separate invariant to remember to keep in sync, because
 * there is only one source of truth (`effectiveProductionStatusByServiceId`)
 * and the top-level field is computed from it, not set independently. */
function buildX402ExtensionParams(
  effectiveProductionStatusByServiceId?: Partial<Record<SiteborneServiceId, boolean>>,
  paymentDestination: PaymentDestination | null = null
): Record<string, unknown> {
  const services = SITEBORNE_SERVICE_IDS.map((serviceId) => {
    const service = REGISTRY_SERVICES[serviceId];
    const route = resolveServiceRoute(serviceId);
    const productionEnabled = effectiveProductionStatusByServiceId?.[serviceId] ?? false;
    return {
      serviceId,
      serviceVersion: service.service_version,
      scheme: BAZAAR_PAYMENT_POLICY[serviceId].scheme,
      resource: `${SITEBORNE_A2A_ORIGIN}${route.path}`,
      inputSchemaUri: service.input_schema_uri,
      outputSchemaUri: service.output_schema_uri,
      declaredLimitations: [...service.declared_limitations],
      productionEnabled,
      // PRODUCTION-ECONOMICS-DISCOVERY-01: the canonical economic contract for
      // this service, embedded verbatim -- never authored in this file.
      economics: projectServiceEconomics(serviceId, {
        productionEnabled,
        destination: paymentDestination,
      }),
    };
  });
  return {
    x402Version: 2,
    paymentRequiredForUsefulExecution: true,
    productionEnabled: services.some((service) => service.productionEnabled),
    services,
  };
}

/**
 * Builds the unsigned, immutable public Agent Card from SITEBORNE's accepted
 * registry and x402 payment-policy sources. Signing is a separate boundary so
 * no private key material can enter this credential-independent package API.
 */
export function buildUnsignedSiteborneAgentCard(
  effectiveProductionStatusByServiceId?: Partial<Record<SiteborneServiceId, boolean>>,
  /** SUN-1222C-DEPLOYMENT-DEPENDENCY-AND-MTLS-TRUTHFULNESS-REMEDIATION:
   * defaults `false`, matching every other production-activation flag's
   * fail-closed convention in this codebase (`PRODUCTION_ENABLED`,
   * `PAID_ROUTES_ENABLED`, etc.) -- the same "absent means the
   * production-compatible, not-yet-active state" discipline as
   * `effectiveProductionStatusByServiceId` above. `false` is also the
   * only value every caller before this checkpoint implicitly used
   * (nobody passed a second argument), so this default preserves every
   * existing caller's actual intended behavior even though it changes
   * the unconditional-`true` bug this checkpoint fixes. This
   * credential-independent package never reads `env`/config itself --
   * `edge-api`'s `resolveMtlsProductionActive` computes this from real
   * deployment configuration and injects it via
   * `CreateSiteborneA2aOptions.mtlsProductionActive`, the same
   * dependency direction as `signingIdentity`. */
  mtlsProductionActive = false,
  /** PRODUCTION-ECONOMICS-DISCOVERY-01: OPERATIONAL public payment
   * destination, resolved by the caller (edge-api) from real configuration;
   * `null` means not configured. This package never reads env or secrets. */
  paymentDestination: PaymentDestination | null = null
): AgentCard {
  return {
    name: 'SITEBORNE Utility Network',
    description:
      'Four bounded evidence, context, document, and verification services with PCC receipts and x402 payment enforcement.',
    supportedInterfaces: [
      {
        url: SITEBORNE_A2A_INTERFACE_URL,
        protocolBinding: 'JSONRPC',
        protocolVersion: A2A_PROTOCOL_VERSION,
        tenant: '',
      },
    ],
    provider: {
      organization: 'SITEBORNE',
      url: 'https://siteborne.com',
    },
    version: '1.0.0',
    documentationUrl: 'https://siteborne.net/docs/a2a',
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extendedAgentCard: false,
      extensions: [
        {
          uri: SITEBORNE_X402_EXTENSION_URI,
          description:
            'SITEBORNE binding from A2A skill selection to existing x402 paid-service resources.',
          required: false,
          params: buildX402ExtensionParams(
            effectiveProductionStatusByServiceId,
            paymentDestination
          ),
        },
      ],
    },
    // SUN-1222C-AGENT-TRUST-100-IMPLEMENTATION-A: declares native A2A
    // mutualTLS caller-identity *capability* only. Root securityRequirements
    // stays `[]` (below) so this never gates the public agent root or any
    // skill -- see docs/reports/SUN-1222C-agent-trust-100-design.md §9 and
    // §11 (Option B: x402 remains the sole economic-authorization gate;
    // mTLS may only ever *enrich* an already-x402-authorized request, and
    // only where a future, separately authorized checkpoint wires a
    // specific skill's own securityRequirements to it).
    //
    // SUN-1222C-DEPLOYMENT-DEPENDENCY-AND-MTLS-TRUTHFULNESS-REMEDIATION:
    // that declaration was unconditional from the checkpoint above --
    // truthful only once a real, operator-qualified production mTLS
    // interface exists. `mtlsProductionActive` (`false` by default) gates
    // it: an empty `securitySchemes` object is A2A's own "no scheme
    // declared" representation, exactly parallel to `securityRequirements:
    // []` below meaning "no requirement".
    securitySchemes: mtlsProductionActive
      ? {
          [SITEBORNE_MTLS_SECURITY_SCHEME_KEY]: {
            scheme: {
              $case: 'mtlsSecurityScheme',
              value: { description: SITEBORNE_MTLS_SECURITY_SCHEME_DESCRIPTION },
            },
          },
        }
      : {},
    securityRequirements: [],
    defaultInputModes: [JSON_MEDIA_TYPE],
    defaultOutputModes: [JSON_MEDIA_TYPE],
    skills: SITEBORNE_SERVICE_IDS.map(buildSkill),
    signatures: [],
  };
}
