/**
 * SUN-1222B-S3R — the production route composition for
 * `document_evidence_json.v2` / CDP. Mirrors `company-evidence-graph-v2-
 * cdp-composition.ts` exactly for every generic primitive
 * (`resolvePaymentNetwork`, `isProductionPaymentAuthorized`,
 * `resolvePaymentAsset`, `resolveProductionCdpEvidenceProvider`,
 * `buildProductionSigner`). Never `buildFixtureRegistry`, never
 * `FixtureDocumentWorkerBridge`, never `SubprocessDocumentWorkerBridge`.
 *
 * Two genuinely new fail-closed gates, both pre-existing, documented
 * external blockers (SUN-1222B-S3R root trace) -- this composition
 * resolves `unavailable: true` for either, never a fixture/degraded
 * fallback:
 *
 * 1. `env.ARTIFACTS` (the R2 bucket binding `DocumentEvidenceJsonService`
 *    genuinely needs, unlike `company_evidence_graph.v2`/
 *    `web_context_verified.v2`) has been commented out in `wrangler.toml`
 *    since SUN-0800B checkpoint 3 ("needs dashboard enablement first") --
 *    a real Cloudflare-account-level action, not a repo change.
 * 2. `MODAL_DOCWORKER_ENDPOINT_URL`/`MODAL_DOCWORKER_PROXY_KEY`/
 *    `MODAL_DOCWORKER_PROXY_SECRET` -- credentials for the NEW
 *    `process_document_http` Modal endpoint (SUN-1222B-S3R, `services/
 *    modal-worker/src/modal_worker/modal_app.py`), which has never been
 *    deployed (`modal deploy` is SUN-0400B's explicit scope, `blocked_
 *    external`). A dedicated credential set, deliberately NOT reusing
 *    `MODAL_WEBCTX_*` -- this is a different Modal App
 *    (`siteborne-document-worker`, not `siteborne-webctx-safe-egress`),
 *    with its own proxy-auth token pair once deployed.
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
  ModalDocumentWorkerBridge,
} from '@siteborne/service-runtime';
import { createCdpFacilitatorClient } from '@coinbase/cdp-sdk/x402';
import {
  buildCdpSellerAddressLookup,
  buildProductionCdpAccountLookupClientFactory,
  resolvePaymentAsset,
  resolveProductionAuthorizationInput,
  resolveProductionCdpEvidenceProvider,
} from '../config/production-payment';
import type { ServiceExecutor, X402ServiceRouteConfig } from '../routes/x402-service';
import type { ArtifactStore as EdgeApiArtifactStore } from '../artifacts/store';
import { buildDocumentEvidenceJsonV2ProductionExecutor } from './document-evidence-json-v2-production-executor';

export interface DocumentEvidenceJsonV2CdpProductionEnv {
  PAID_RECEIPT_SIGNING_PRIVATE_KEY?: string;
  PAID_RECEIPT_SIGNING_KEY_ID?: string;
  SELLER_WALLET_ADDRESS?: string;
  CDP_API_KEY_ID?: string;
  CDP_API_KEY_SECRET?: string;
  PAYMENT_ENVIRONMENT?: string;
  PRODUCTION_ENABLED?: string;
  HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP?: string;
  PRODUCTION_CDP_CREDENTIALS_APPROVED?: string;
  /** SUN-1222B-S3R — a dedicated Modal App/credential set for
   * `siteborne-document-worker`'s new `process_document_http` endpoint.
   * See this file's own doc comment for why it is NOT `MODAL_WEBCTX_*`. */
  MODAL_DOCWORKER_ENDPOINT_URL?: string;
  MODAL_DOCWORKER_PROXY_KEY?: string;
  MODAL_DOCWORKER_PROXY_SECRET?: string;
}

export interface ProductionCompositionUnavailable {
  unavailable: true;
  reason: string;
}

export interface ExplicitTestEvidenceOverride {
  evidenceMode: 'fixture';
  evidenceProvider?: PaymentEvidenceProvider;
}

export async function buildDocumentEvidenceJsonV2CdpProductionRouteConfig(
  env: DocumentEvidenceJsonV2CdpProductionEnv,
  db: D1Database,
  /** SUN-1222B-S3R — `env.ARTIFACTS` typed generically here (rather than
   * importing the ambient Workers `R2Bucket` global into this env
   * interface) so this composition stays testable with a plain mock
   * satisfying `EdgeApiArtifactStore`'s shape, exactly like `db` above
   * already is via Miniflare. The real route module (`production-
   * document-evidence-v2-cdp-route.ts`) is the one place that actually
   * constructs `R2ArtifactStoreAdapter` from `c.env.ARTIFACTS`. */
  artifactStore: EdgeApiArtifactStore | undefined,
  explicitTestEvidenceOverride?: ExplicitTestEvidenceOverride
): Promise<X402ServiceRouteConfig | ProductionCompositionUnavailable> {
  if (!db) {
    return { unavailable: true, reason: 'no D1 database binding supplied' };
  }
  // SUN-0800B checkpoint 3 / SUN-1222B-S3R: fails closed, never falls
  // back to an in-memory/fixture artifact store in production mode.
  if (!artifactStore) {
    return {
      unavailable: true,
      reason:
        'ARTIFACTS R2 bucket binding is not configured (commented out in wrangler.toml since ' +
        'SUN-0800B checkpoint 3, pending Cloudflare dashboard R2 enablement)',
    };
  }
  if (!env.PAID_RECEIPT_SIGNING_PRIVATE_KEY) {
    return { unavailable: true, reason: 'PAID_RECEIPT_SIGNING_PRIVATE_KEY is missing' };
  }
  if (!env.PAID_RECEIPT_SIGNING_KEY_ID) {
    return { unavailable: true, reason: 'PAID_RECEIPT_SIGNING_KEY_ID is missing' };
  }
  if (
    !env.MODAL_DOCWORKER_ENDPOINT_URL ||
    !env.MODAL_DOCWORKER_PROXY_KEY ||
    !env.MODAL_DOCWORKER_PROXY_SECRET
  ) {
    return {
      unavailable: true,
      reason:
        'MODAL_DOCWORKER_* document-worker executor credentials are missing (the process_document_http ' +
        'Modal endpoint has not been deployed -- SUN-0400B, blocked_external)',
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
        getAuthenticatedSellerAddress: buildCdpSellerAddressLookup(
          buildProductionCdpAccountLookupClientFactory({
            CDP_API_KEY_ID: env.CDP_API_KEY_ID ?? '',
            CDP_API_KEY_SECRET: env.CDP_API_KEY_SECRET ?? '',
          }),
          env.SELLER_WALLET_ADDRESS ?? ''
        ),
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

  const worker = new ModalDocumentWorkerBridge({
    endpointUrl: env.MODAL_DOCWORKER_ENDPOINT_URL,
    proxyKey: env.MODAL_DOCWORKER_PROXY_KEY,
    proxySecret: env.MODAL_DOCWORKER_PROXY_SECRET,
  });
  const executor: ServiceExecutor = buildDocumentEvidenceJsonV2ProductionExecutor(
    signer,
    registry,
    worker,
    artifactStore
  );

  const asset = resolvePaymentAsset(network);

  return {
    serviceId: 'document_evidence_json.v2',
    scheme: 'upto',
    pricingKey: 'document_evidence_json_max_job',
    rail: 'cdp',
    network,
    asset: asset.address,
    paymentRequirementExtra: { name: asset.name, version: asset.version },
    payTo: env.SELLER_WALLET_ADDRESS,
    path: '/v2/document/evidence-json',
    inputSchema: BUNDLED_SERVICE_INPUT_SCHEMAS['document_evidence_json.v2'] as Record<
      string,
      unknown
    >,
    contractRelease: '2.0.0',
    // Computed directly from `contracts/releases/2.0.0/schemas/services/
    // document-evidence-*.schema.json` (`shasum -a 256`) -- matches the
    // value `paid-services.ts`'s existing fixture route already declares
    // for this same service ID.
    inputSchemaHash: 'sha256:19e64c92f088ed8b7a45eef561c5426bb59ce5cc3576b85482aded4f620e57ba',
    outputSchemaHash: 'sha256:df91ed115ae0e29d8f4c211d95462ddd96e9714bc5f5e0ce0b820b370e0d5dde',
    pccDependency: '1.1.0',
    db,
    clock: () => new Date().toISOString(),
    evidenceMode: cdpEvidence.evidenceMode,
    evidenceProvider: cdpEvidence.evidenceProvider,
    executor,
  };
}
