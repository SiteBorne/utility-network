/**
 * Composes SUN-0700A checkpoints 1-3 (quote/requirement building,
 * pricing) with the official `@x402/extensions/bazaar`
 * `declareDiscoveryExtension` to produce SITEBORNE's four Bazaar discovery
 * resource declarations (directive §5, §7). Local declaration + local
 * validation only — nothing here submits to a facilitator, queries
 * `/discovery/resources`, or claims a live listing (directive §4, §21;
 * see `catalog-status.ts`).
 *
 * `resourceUrl`/`method` come from the accepted OpenAPI source
 * (`routes.ts`); input schema/example come from the frozen contract
 * schemas (`frozen-inputs.ts`); price/scheme come from
 * `governance/RISK_LIMITS.yaml` via `@siteborne/pricing`
 * (`../pricing/mapping`) and this package's own checkpoint-1/2
 * `exact`/`upto` requirement builders — never a second, hand-maintained
 * copy of any of those.
 */
import {
  BAZAAR,
  declareDiscoveryExtension,
  isValidServiceName,
  sanitizeTags,
} from '@x402/extensions/bazaar';
import type { Network, PaymentRequirements } from '@x402/core/types';
import { PREPRODUCTION_NETWORK } from '../network/preproduction';
import { buildQuote } from '../quote/quote';
import { buildExactPaymentRequirement } from '../requirements/exact';
import { buildUptoPaymentRequirement } from '../requirements/upto';
import {
  resolvePricingSourceVersion,
  resolveServiceMaxPriceUsd,
  usdToAtomicUnits,
  type PricingKey,
} from '../pricing/mapping';
import { hashPaymentObject } from '../canonical';
import { SUPPORTED_X402_VERSION } from '../version';
import {
  ECONOMIC_SERVICE_IDS,
  buildEconomicOffer,
  challengePricingKey,
  projectServiceEconomics,
  validateEconomicProjection,
  type EconomicOfferProjection,
  type PaymentDestination,
} from '../pricing/economic';
import type { SiteborneServiceId } from '../types';
import {
  BUNDLED_SERVICE_INPUT_SCHEMAS,
  frozenOutputExample,
  purchasableInputExample,
} from './frozen-inputs';
import { stripDocumentIdentity } from './schema-bundle';
import { REGISTRY_SERVICES } from './registry-source';
import { resolveServiceRoute } from './routes';
import { SERVICE_CAPABILITY_STATUS } from './capability';
import type { ServiceCapabilityStatus } from './capability';

/** SITEBORNE's payment-policy binding per service: which scheme, which
 * governance pricing key, and which network/asset a Bazaar declaration is
 * quoted against (ADR 0048).
 *
 * PRODUCTION-ECONOMICS-DISCOVERY-01: `scheme` and `pricing_key` are no longer
 * hand-maintained here -- they are derived from the canonical economic
 * contract (`@siteborne/pricing`), the same definition every other surface
 * projects. The `upto` document offer is bound at its authorization ceiling
 * (`document_evidence_json_max_job`), never a fixed price presented as
 * `exact`. Only the local-fixture `network`/`asset` remain declared here; a
 * real destination is injected through `BuildDiscoveryDeclarationInput`. */
const BAZAAR_PAYMENT_POLICY = Object.fromEntries(
  ECONOMIC_SERVICE_IDS.map((serviceId) => [
    serviceId,
    {
      scheme: buildEconomicOffer(serviceId).scheme,
      pricing_key: challengePricingKey(serviceId),
      network: PREPRODUCTION_NETWORK,
      asset: '0xUSDC',
    },
  ])
) as Readonly<
  Record<
    SiteborneServiceId,
    { scheme: 'exact' | 'upto'; pricing_key: PricingKey; network: Network; asset: string }
  >
>;

/** SUN-0700A has no production wallet (directive §12) — this sentinel is
 * deliberately not address-shaped, so it can never be mistaken for a real
 * `payTo` and never survives `isValidPayee`-style production checks
 * unnoticed. A real `payTo` is a SUN-0700B/wallet-provisioning concern. */
export const PAYTO_NOT_CONFIGURED = 'siteborne-fixture:payto-not-configured';

export interface SiteborneDiscoveryResource {
  resourceUrl: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  type: 'http';
  x402Version: number;
  description: string;
  mimeType: 'application/json';
  serviceName?: string;
  tags?: string[];
  accepts: PaymentRequirements[];
  /** `{ bazaar: { info, schema } }` — the exact shape
   * `declareDiscoveryExtension` returns, keyed by `BAZAAR.key`. */
  extensions: Record<string, unknown>;
  /** Never `true` in this checkpoint — see `catalog-status.ts`. */
  status: 'not_live';
  production_enabled: false;
  payto_configured: boolean;
  /** The canonical economic contract for this service -- the same projection
   * object every other surface embeds. `payment` is `null` until a real
   * destination is injected. */
  economics: EconomicOfferProjection;
  /** SITEBORNE's own capability-truthfulness bookkeeping (directive §10)
   * — deliberately outside `extensions.bazaar`, which only carries fields
   * the official extension itself defines (directive §16's "respect
   * upstream validation constraints"). */
  capability_status: ServiceCapabilityStatus;
}

export interface BuildDiscoveryDeclarationInput {
  serviceId: SiteborneServiceId;
  nowIso: string;
  expiresInSeconds: number;
  maxTimeoutSeconds: number;
  /** Overridable only for tests — production callers never have a real
   * payTo to supply yet (directive §12), so the default sentinel is used
   * everywhere else. Superseded by `destination` when both are given. */
  payTo?: string;
  /** PRODUCTION-ECONOMICS-DISCOVERY-01: the public projection of the
   * governed payment destination (network, asset, payTo), injected from real
   * runtime configuration by the caller. Never defaulted or invented here;
   * absent means "not configured" and the local fixture defaults apply. */
  destination?: PaymentDestination;
}

/**
 * Builds one service's Bazaar discovery declaration end-to-end: quote ->
 * exact/upto requirement -> official Bazaar `declareDiscoveryExtension`.
 * Deterministic given identical inputs (quote/requirement identity is
 * itself deterministic — see `quote/quote.ts`, `requirements/exact.ts`,
 * `requirements/upto.ts`) — directive §34's "one service -> one canonical
 * discovery identity".
 */
export async function buildSiteborneDiscoveryDeclaration(
  input: BuildDiscoveryDeclarationInput
): Promise<SiteborneDiscoveryResource> {
  const { serviceId, nowIso, expiresInSeconds, maxTimeoutSeconds } = input;
  const policy = BAZAAR_PAYMENT_POLICY[serviceId];
  const registryEntry = REGISTRY_SERVICES[serviceId];
  const route = resolveServiceRoute(serviceId);
  const capability = SERVICE_CAPABILITY_STATUS[serviceId];

  const priceUsd = resolveServiceMaxPriceUsd(policy.pricing_key);
  const amount = usdToAtomicUnits(priceUsd, 6);
  const pricingSourceVersion = resolvePricingSourceVersion();

  const inputExample = purchasableInputExample(serviceId);
  const outputExample = frozenOutputExample(serviceId);
  const inputHash = await hashPaymentObject(inputExample as Record<string, unknown>);

  const expiresAt = new Date(new Date(nowIso).getTime() + expiresInSeconds * 1000).toISOString();

  const network = input.destination?.network ?? policy.network;
  const asset = input.destination?.asset ?? policy.asset;
  const payee = input.destination?.payTo ?? input.payTo ?? PAYTO_NOT_CONFIGURED;

  const quote = await buildQuote({
    x402_version: SUPPORTED_X402_VERSION,
    service_id: serviceId,
    // SUN-1000 checkpoint 1M: derived from the registry entry's own
    // declared service_version rather than a hardcoded v1 literal.
    service_version: registryEntry.service_version as 'v1' | 'v2',
    contract_release: registryEntry.pcc_version,
    input_hash: inputHash,
    pricing_key: policy.pricing_key,
    pricing_source_version: pricingSourceVersion,
    scheme: policy.scheme,
    network: network as Network,
    asset,
    amount,
    payee,
    issued_at: nowIso,
    expires_at: expiresAt,
  });

  const resourceUrl = `https://utility.siteborne.net${route.path}`;

  const { requirement } =
    policy.scheme === 'exact'
      ? await buildExactPaymentRequirement({ quote, resource_id: resourceUrl, maxTimeoutSeconds })
      : await buildUptoPaymentRequirement({ quote, resource_id: resourceUrl, maxTimeoutSeconds });

  // The official public `declareDiscoveryExtension` input type omits
  // `method` at declare time (it documents `method` as normally filled in
  // later by a server-framework enrichment hook, e.g.
  // `bazaarResourceServerExtension`, once a route is actually attached).
  // SITEBORNE has no live route yet — this checkpoint's declaration is
  // the pre-route-wiring case — but the route's real HTTP method is
  // already known from the accepted OpenAPI source (`routes.ts`), so it
  // is supplied directly here (the function's runtime implementation
  // accepts and uses it identically to enrichment-time `method`,
  // verified directly against the compiled `createBodyDiscoveryExtension`
  // in dist/cjs/bazaar/index.js).
  const extension = declareDiscoveryExtension({
    method: 'POST',
    bodyType: 'json',
    input: inputExample as Record<string, unknown>,
    inputSchema: stripDocumentIdentity(BUNDLED_SERVICE_INPUT_SCHEMAS[serviceId]) as Record<
      string,
      unknown
    >,
    output: { example: outputExample as Record<string, unknown> },
  } as unknown as Parameters<typeof declareDiscoveryExtension>[0]);

  const rawServiceName = `SITEBORNE ${registryEntry.title}`;
  const serviceName = isValidServiceName(rawServiceName) ? rawServiceName : undefined;
  const tags = sanitizeTags(registryEntry.capabilities);

  return {
    resourceUrl,
    method: route.method,
    type: 'http',
    x402Version: quote.x402_version ?? SUPPORTED_X402_VERSION,
    description: registryEntry.description,
    mimeType: 'application/json',
    ...(serviceName ? { serviceName } : {}),
    ...(tags ? { tags } : {}),
    accepts: [requirement],
    extensions: extension as Record<string, unknown>,
    status: 'not_live',
    production_enabled: false,
    payto_configured: payee !== PAYTO_NOT_CONFIGURED,
    economics: projectServiceEconomics(serviceId, {
      productionEnabled: false,
      destination: input.destination ?? null,
    }),
    capability_status: capability,
  };
}

/** Deterministic self-consistency findings for one Bazaar declaration: the
 * `accepts` requirement must be exactly what the embedded canonical economics
 * says. An empty list means the declaration cannot contradict itself. */
export function validateBazaarDeclarationEconomics(resource: SiteborneDiscoveryResource): string[] {
  const problems = validateEconomicProjection(resource.economics).map((p) => `economics: ${p}`);
  const requirement = resource.accepts[0];
  const economics = resource.economics;
  if (!requirement) return [...problems, 'declaration has no payment requirement'];
  if (requirement.scheme !== economics.scheme) {
    problems.push(`accepts scheme ${requirement.scheme} !== economics scheme ${economics.scheme}`);
  }
  const usd =
    economics.scheme === 'exact' ? economics.list_amount : economics.authorization_maximum;
  if (usd !== null && requirement.amount !== usdToAtomicUnits(usd, 6)) {
    problems.push(
      `accepts amount ${requirement.amount} does not equal the canonical amount ${usd}`
    );
  }
  if (economics.payment === null) {
    if (requirement.payTo !== PAYTO_NOT_CONFIGURED) {
      problems.push('accepts carries a payTo but economics declares no payment destination');
    }
  } else {
    if (requirement.network !== economics.payment.network) problems.push('accepts network differs');
    if (requirement.asset !== economics.payment.asset) problems.push('accepts asset differs');
    if (requirement.payTo !== economics.payment.pay_to) problems.push('accepts payTo differs');
  }
  if (resource.payto_configured !== (economics.payment !== null)) {
    problems.push('payto_configured disagrees with the economics payment destination');
  }
  if (resource.resourceUrl !== economics.resource) {
    problems.push('resourceUrl differs from the economics resource');
  }
  return problems;
}

/** `BAZAAR.key` — re-exported so callers never hardcode the extension
 * key string themselves. */
export const BAZAAR_EXTENSION_KEY = BAZAAR.key;

export { BAZAAR_PAYMENT_POLICY };
