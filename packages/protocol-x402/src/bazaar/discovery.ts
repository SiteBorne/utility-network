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
import type { SiteborneServiceId } from '../types';
import {
  BUNDLED_SERVICE_INPUT_SCHEMAS,
  frozenInputExample,
  frozenOutputExample,
} from './frozen-inputs';
import { stripDocumentIdentity } from './schema-bundle';
import { REGISTRY_SERVICES } from './registry-source';
import { resolveServiceRoute } from './routes';
import { SERVICE_CAPABILITY_STATUS } from './capability';
import type { ServiceCapabilityStatus } from './capability';

/** SITEBORNE's own payment-policy binding per service (directive §11-13):
 * which scheme, which governance pricing key, and which network/asset a
 * Bazaar declaration is quoted against. This is a SITEBORNE product
 * decision, not derived from any external source — recorded in ADR 0048.
 * `document_evidence_json.v1`'s `upto` is bound at the *maximum* price
 * (`document_evidence_json_max_job`), matching checkpoint 3's
 * authorization-phase convention (`src/tests/upto-lifecycle.test.ts`) —
 * never a fixed price presented as if it were `exact` (directive §13). */
const BAZAAR_PAYMENT_POLICY: Readonly<
  Record<
    SiteborneServiceId,
    { scheme: 'exact' | 'upto'; pricing_key: PricingKey; network: Network; asset: string }
  >
> = {
  'company_evidence_graph.v1': {
    scheme: 'exact',
    pricing_key: 'company_evidence_graph',
    network: PREPRODUCTION_NETWORK,
    asset: '0xUSDC',
  },
  'web_context_verified.v1': {
    scheme: 'exact',
    pricing_key: 'web_context_verified_direct',
    network: PREPRODUCTION_NETWORK,
    asset: '0xUSDC',
  },
  'document_evidence_json.v1': {
    scheme: 'upto',
    pricing_key: 'document_evidence_json_max_job',
    network: PREPRODUCTION_NETWORK,
    asset: '0xUSDC',
  },
  'verify_agent_output.v1': {
    scheme: 'exact',
    pricing_key: 'verify_agent_output_standard',
    network: PREPRODUCTION_NETWORK,
    asset: '0xUSDC',
  },
  // SUN-1222B-S3: company v2 is the sole version-specific pricing experiment.
  // All other v2 entries retain their previously frozen pricing keys.
  'company_evidence_graph.v2': {
    scheme: 'exact',
    pricing_key: 'company_evidence_graph_v2',
    network: PREPRODUCTION_NETWORK,
    asset: '0xUSDC',
  },
  'web_context_verified.v2': {
    scheme: 'exact',
    pricing_key: 'web_context_verified_direct',
    network: PREPRODUCTION_NETWORK,
    asset: '0xUSDC',
  },
  'document_evidence_json.v2': {
    scheme: 'upto',
    pricing_key: 'document_evidence_json_max_job',
    network: PREPRODUCTION_NETWORK,
    asset: '0xUSDC',
  },
  'verify_agent_output.v2': {
    scheme: 'exact',
    pricing_key: 'verify_agent_output_standard',
    network: PREPRODUCTION_NETWORK,
    asset: '0xUSDC',
  },
};

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
   * everywhere else. */
  payTo?: string;
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

  const inputExample = frozenInputExample(serviceId);
  const outputExample = frozenOutputExample(serviceId);
  const inputHash = await hashPaymentObject(inputExample as Record<string, unknown>);

  const expiresAt = new Date(new Date(nowIso).getTime() + expiresInSeconds * 1000).toISOString();

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
    network: policy.network,
    asset: policy.asset,
    amount,
    payee: input.payTo ?? PAYTO_NOT_CONFIGURED,
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
    payto_configured: (input.payTo ?? PAYTO_NOT_CONFIGURED) !== PAYTO_NOT_CONFIGURED,
    capability_status: capability,
  };
}

/** `BAZAAR.key` — re-exported so callers never hardcode the extension
 * key string themselves. */
export const BAZAAR_EXTENSION_KEY = BAZAAR.key;

export { BAZAAR_PAYMENT_POLICY };
