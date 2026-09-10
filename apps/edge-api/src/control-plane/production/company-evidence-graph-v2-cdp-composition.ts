/**
 * SUN-1222B-S3R — the production route composition for
 * `company_evidence_graph.v2` / CDP. Mirrors
 * `web-context-v2-cdp-composition.ts` exactly (every primitive it uses --
 * `resolvePaymentNetwork`, `isProductionPaymentAuthorized`,
 * `resolvePaymentAsset`, `resolveProductionCdpEvidenceProvider`,
 * `buildProductionSigner` -- is already generic and non-service-specific;
 * nothing here reimplements gate logic). Never `buildFixtureRegistry`,
 * never `SEC_EDGAR_FIXTURE`, never `createFixtureSigner`.
 *
 * `company_evidence_graph.v2`'s `website_evidence` field group fetches an
 * arbitrary buyer-supplied URL (`input.buyer_urls`) -- the identical
 * "arbitrary public URL" SSRF profile `web_context_verified.v2`'s direct
 * retrieval mode has (SUN-1221E5Q6E/F/G). Rather than standing up a second,
 * functionally-identical off-Cloudflare safe-egress Modal deployment, this
 * composition reuses the SAME already-deployed `MODAL_WEBCTX_*` endpoint --
 * it is a general arbitrary-URL egress proxy, not scoped to
 * `web_context_verified.v2`'s own request shape, and SEC EDGAR / Federal
 * Register (fixed, non-buyer-supplied domains) are safe to route through
 * it as well (Approach C: unconditional, no hybrid/CIDR-based routing
 * split -- SUN-1221E5Q6F's reasoning applies without narrowing). This is a
 * SUN-1222B-S3R composition decision, not a change to the existing
 * `web_context_verified.v2` deployment or its credentials -- both services
 * share the one endpoint, exactly as two independently-gated paid routes
 * already share `PAID_ROUTES_ENABLED`.
 */
import type { D1Database } from '@cloudflare/workers-types';
import {
  BUNDLED_SERVICE_INPUT_SCHEMAS,
  assertPreproductionNetwork,
  isProductionPaymentAuthorized,
  resolvePaymentNetwork,
  type PaymentEvidenceProvider,
} from '@siteborne/protocol-x402';
import {
  buildProductionSigner,
  ProductionSignerConfigurationError,
} from '@siteborne/service-runtime';
import { ModalSafeEgressClient, type InjectedHttpClient } from '@siteborne/provider-adapters';
import { createCdpFacilitatorClient } from '@coinbase/cdp-sdk/x402';
import {
  resolvePaymentAsset,
  resolveProductionAuthorizationInput,
  resolveProductionCdpEvidenceProvider,
} from '../config/production-payment';
import type { ServiceExecutor, X402ServiceRouteConfig } from '../routes/x402-service';
import { buildCompanyEvidenceGraphV2ProductionExecutor } from './company-evidence-graph-v2-production-executor';

export interface CompanyEvidenceGraphV2CdpProductionEnv {
  PAID_RECEIPT_SIGNING_PRIVATE_KEY?: string;
  PAID_RECEIPT_SIGNING_KEY_ID?: string;
  SELLER_WALLET_ADDRESS?: string;
  CDP_API_KEY_ID?: string;
  CDP_API_KEY_SECRET?: string;
  PAYMENT_ENVIRONMENT?: string;
  PRODUCTION_ENABLED?: string;
  HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP?: string;
  PRODUCTION_CDP_CREDENTIALS_APPROVED?: string;
  /** SUN-1222B-S3R — reused verbatim from `web_context_verified.v2`'s own
   * already-deployed safe-egress executor. See this file's own doc
   * comment for why sharing is correct here rather than a new deployment. */
  MODAL_WEBCTX_ENDPOINT_URL?: string;
  MODAL_WEBCTX_PROXY_KEY?: string;
  MODAL_WEBCTX_PROXY_SECRET?: string;
}

export interface ProductionCompositionUnavailable {
  unavailable: true;
  reason: string;
}

/** Mirrors `web-context-v2-cdp-composition.ts`'s `ExplicitTestEvidenceOverride`
 * exactly -- the ONLY way this composition may ever resolve
 * fixture/synthetic payment evidence, never supplied by the real
 * production route module. */
export interface ExplicitTestEvidenceOverride {
  evidenceMode: 'fixture';
  evidenceProvider?: PaymentEvidenceProvider;
}

function buildCompanyEvidenceGraphV2ModalSafeEgressClient(env: {
  MODAL_WEBCTX_ENDPOINT_URL: string;
  MODAL_WEBCTX_PROXY_KEY: string;
  MODAL_WEBCTX_PROXY_SECRET: string;
}): InjectedHttpClient {
  return new ModalSafeEgressClient({
    endpointUrl: env.MODAL_WEBCTX_ENDPOINT_URL,
    proxyKey: env.MODAL_WEBCTX_PROXY_KEY,
    proxySecret: env.MODAL_WEBCTX_PROXY_SECRET,
  });
}

export async function buildCompanyEvidenceGraphV2CdpProductionRouteConfig(
  env: CompanyEvidenceGraphV2CdpProductionEnv,
  db: D1Database,
  explicitTestEvidenceOverride?: ExplicitTestEvidenceOverride
): Promise<X402ServiceRouteConfig | ProductionCompositionUnavailable> {
  if (!db) {
    return { unavailable: true, reason: 'no D1 database binding supplied' };
  }
  if (!env.PAID_RECEIPT_SIGNING_PRIVATE_KEY) {
    return { unavailable: true, reason: 'PAID_RECEIPT_SIGNING_PRIVATE_KEY is missing' };
  }
  if (!env.PAID_RECEIPT_SIGNING_KEY_ID) {
    return { unavailable: true, reason: 'PAID_RECEIPT_SIGNING_KEY_ID is missing' };
  }
  // Fail closed, never fall back to a raw/direct client -- mirrors
  // `web_context_verified.v2`'s own SUN-1221E5Q6G decision exactly.
  if (
    !env.MODAL_WEBCTX_ENDPOINT_URL ||
    !env.MODAL_WEBCTX_PROXY_KEY ||
    !env.MODAL_WEBCTX_PROXY_SECRET
  ) {
    return {
      unavailable: true,
      reason: 'MODAL_WEBCTX_* safe-egress executor credentials are missing',
    };
  }

  let signer: Awaited<ReturnType<typeof buildProductionSigner>>['signer'];
  let registry: Awaited<ReturnType<typeof buildProductionSigner>>['registry'];
  try {
    ({ signer, registry } = await buildProductionSigner(
      env.PAID_RECEIPT_SIGNING_PRIVATE_KEY,
      env.PAID_RECEIPT_SIGNING_KEY_ID
    ));
  } catch (err) {
    if (err instanceof ProductionSignerConfigurationError) {
      return { unavailable: true, reason: err.message };
    }
    throw err;
  }

  const productionAuthorization = resolveProductionAuthorizationInput(env);
  const network = resolvePaymentNetwork(productionAuthorization);
  assertPreproductionNetwork(network, isProductionPaymentAuthorized(productionAuthorization));

  let cdpEvidence: {
    evidenceMode: 'fixture' | 'production';
    evidenceProvider?: PaymentEvidenceProvider;
  };
  if (explicitTestEvidenceOverride) {
    cdpEvidence = explicitTestEvidenceOverride;
  } else {
    const resolved = await resolveProductionCdpEvidenceProvider(
      productionAuthorization,
      {
        SELLER_WALLET_ADDRESS: env.SELLER_WALLET_ADDRESS ?? '',
        CDP_API_KEY_ID: env.CDP_API_KEY_ID ?? '',
        CDP_API_KEY_SECRET: env.CDP_API_KEY_SECRET ?? '',
      },
      {
        createFacilitatorClient: () =>
          createCdpFacilitatorClient({
            apiKeyId: env.CDP_API_KEY_ID,
            apiKeySecret: env.CDP_API_KEY_SECRET,
          }),
      }
    );
    if (resolved.evidenceMode !== 'production') {
      return {
        unavailable: true,
        reason:
          'production payment evidence unavailable and no explicit test evidence override was supplied',
      };
    }
    cdpEvidence = resolved;
  }

  const httpClient = buildCompanyEvidenceGraphV2ModalSafeEgressClient({
    MODAL_WEBCTX_ENDPOINT_URL: env.MODAL_WEBCTX_ENDPOINT_URL,
    MODAL_WEBCTX_PROXY_KEY: env.MODAL_WEBCTX_PROXY_KEY,
    MODAL_WEBCTX_PROXY_SECRET: env.MODAL_WEBCTX_PROXY_SECRET,
  });
  const executor: ServiceExecutor = buildCompanyEvidenceGraphV2ProductionExecutor(
    signer,
    registry,
    httpClient,
    db
  );

  const asset = resolvePaymentAsset(network);

  return {
    serviceId: 'company_evidence_graph.v2',
    scheme: 'exact',
    pricingKey: 'company_evidence_graph_v2',
    rail: 'cdp',
    network,
    asset: asset.address,
    paymentRequirementExtra: { name: asset.name, version: asset.version },
    payTo: env.SELLER_WALLET_ADDRESS,
    path: '/v2/company/evidence-graph',
    inputSchema: BUNDLED_SERVICE_INPUT_SCHEMAS['company_evidence_graph.v2'] as Record<
      string,
      unknown
    >,
    contractRelease: '2.0.0',
    // SUN-1222B-S3R: `company_evidence_graph.v2`'s output schema (unlike
    // `web_context_verified.v2`'s) genuinely differs from its v1 sibling --
    // the `service_id`/`service_version` fields widen from `const` to
    // `enum` to admit both. Computed directly from
    // `contracts/releases/2.0.0/schemas/services/company-evidence-*.schema.json`
    // (`shasum -a 256`), not copied from the 1.0.0-only frozen release
    // manifest -- matches the value `paid-services.ts`'s existing fixture
    // route already declares for this same service ID.
    inputSchemaHash: 'sha256:8d9a6c432b019e24a2df4d48dd93424a8782febb49c0c88f7cf9208cf0204dd7',
    outputSchemaHash: 'sha256:5593736dfc60089aa3f01de664eb67ccba3a58e03449a66e91f477324e24861b',
    pccDependency: '1.1.0',
    db,
    clock: () => new Date().toISOString(),
    evidenceMode: cdpEvidence.evidenceMode,
    evidenceProvider: cdpEvidence.evidenceProvider,
    executor,
  };
}
