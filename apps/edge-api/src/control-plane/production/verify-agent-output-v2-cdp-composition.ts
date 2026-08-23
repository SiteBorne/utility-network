/**
 * SUN-1214 checkpoint T — the production route composition for
 * `verify_agent_output.v2` / CDP. Assembles a real
 * `X402ServiceRouteConfig` around the Task 3 production executor and
 * the repository's existing, real, unmodified machinery
 * (`resolvePaymentNetwork`, `isProductionPaymentAuthorized`,
 * `resolvePaymentAsset`, `resolveProductionCdpEvidenceProvider`) --
 * never `buildFixtureRegistry`, never `createFixtureSigner`.
 *
 * This module is never imported by `index.ts` in this checkpoint. It
 * exists to be proven under real workerd via the test-only entrypoint
 * (Task 5) and to be a candidate for a future checkpoint's wiring
 * decision -- not this one's.
 *
 * Fails closed (`{unavailable: true, reason}`) rather than throwing on
 * any missing/malformed dependency: missing signing key material,
 * missing signing key ID, malformed key material, or no D1 database.
 * Never falls back to a fixture signer or fixture registry on any path.
 */
import type { D1Database } from '@cloudflare/workers-types';
import { createCdpFacilitatorClient } from '@coinbase/cdp-sdk/x402';
import {
  BUNDLED_SERVICE_INPUT_SCHEMAS,
  assertPreproductionNetwork,
  isProductionPaymentAuthorized,
  resolvePaymentNetwork,
} from '@siteborne/protocol-x402';
import {
  buildProductionSigner,
  checkSchemaProfile1,
  ProductionSignerConfigurationError,
} from '@siteborne/service-runtime';
import {
  resolvePaymentAsset,
  resolveProductionAuthorizationInput,
  resolveProductionCdpEvidenceProvider,
} from '../config/production-payment';
import type { ServiceExecutor, X402ServiceRouteConfig } from '../routes/x402-service';
import { buildVerifyAgentOutputV2ProductionExecutor } from './verify-agent-output-v2-production-executor';

export interface VerifyAgentOutputV2CdpProductionEnv {
  PAID_RECEIPT_SIGNING_PRIVATE_KEY?: string;
  PAID_RECEIPT_SIGNING_KEY_ID?: string;
  SELLER_WALLET_ADDRESS?: string;
  CDP_API_KEY_ID?: string;
  CDP_API_KEY_SECRET?: string;
  PAYMENT_ENVIRONMENT?: string;
  PRODUCTION_ENABLED?: string;
  HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP?: string;
  PRODUCTION_CDP_CREDENTIALS_APPROVED?: string;
}

export interface ProductionCompositionUnavailable {
  unavailable: true;
  reason: string;
}

/** Mirrors `paid-services.ts`'s private `verifyAgentOutputPreEconomicCheck`
 * exactly (that function is not exported, and this checkpoint does not
 * modify that frozen file) -- both are thin argument-extraction glue
 * around the one real, shared, unmodified Profile 1 engine
 * (`checkSchemaProfile1`); neither duplicates verification logic. */
function verifyAgentOutputPreEconomicCheck(
  body: unknown
): { ok: true } | { ok: false; code: string; message: string } {
  const requiredSchema = (body as { required_schema?: unknown } | null)?.required_schema;
  const check = checkSchemaProfile1(requiredSchema);
  if (check.supported) return { ok: true };
  return { ok: false, code: check.code, message: check.reason };
}

export async function buildVerifyAgentOutputV2CdpProductionRouteConfig(
  env: VerifyAgentOutputV2CdpProductionEnv,
  db: D1Database
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

  // The real, existing, unmodified provider-construction boundary
  // (SUN-1200 checkpoint B). `getAuthenticatedSellerAddress` is
  // deliberately omitted here -- exactly as it is omitted everywhere
  // else in this repository today (see that function's own doc
  // comment: wiring a real implementation is "a separate, future
  // credential-provisioning checkpoint's job") -- so this resolves to
  // `{evidenceMode: 'fixture'}` unconditionally today, regardless of
  // which secrets are present. This is a real, pre-existing, external
  // gap this checkpoint does not close and does not need to: no live
  // CDP evidence can be produced through this composition until that
  // future checkpoint exists, which is strictly safer than SUN-1214
  // requires.
  const cdpEvidence = await resolveProductionCdpEvidenceProvider(
    productionAuthorization,
    {
      SELLER_WALLET_ADDRESS: env.SELLER_WALLET_ADDRESS ?? '',
      CDP_API_KEY_ID: env.CDP_API_KEY_ID ?? '',
      CDP_API_KEY_SECRET: env.CDP_API_KEY_SECRET ?? '',
    },
    {
      // Only ever invoked past a live authenticated-seller-address
      // resolution this repository does not wire anywhere today -- see
      // the comment above. Constructed with the real SDK function,
      // matching production convention, in case a future checkpoint
      // supplies `getAuthenticatedSellerAddress` and this path becomes
      // genuinely reachable.
      createFacilitatorClient: () =>
        createCdpFacilitatorClient({
          apiKeyId: env.CDP_API_KEY_ID,
          apiKeySecret: env.CDP_API_KEY_SECRET,
        }),
    }
  );

  const executor: ServiceExecutor = buildVerifyAgentOutputV2ProductionExecutor(signer, registry);

  return {
    serviceId: 'verify_agent_output.v2',
    scheme: 'exact',
    pricingKey: 'verify_agent_output_standard',
    rail: 'cdp',
    network,
    asset: resolvePaymentAsset(network).address,
    payTo: env.SELLER_WALLET_ADDRESS,
    path: '/v2/verify/agent-output',
    inputSchema: BUNDLED_SERVICE_INPUT_SCHEMAS['verify_agent_output.v2'] as Record<string, unknown>,
    contractRelease: '2.0.0',
    inputSchemaHash: 'sha256:66d459905cd1a18b57ccb3fc40043a4e4c1a77bc7dba40676fcaf674cacb0f34',
    outputSchemaHash: 'sha256:a9a462b89b290ecba1aa62ec6d2fd030572f326ed79f498a43690244b38ad679',
    pccDependency: '1.1.0',
    db,
    clock: () => new Date().toISOString(),
    evidenceMode: cdpEvidence.evidenceMode,
    evidenceProvider: cdpEvidence.evidenceProvider,
    preEconomicBodyValidator: verifyAgentOutputPreEconomicCheck,
    executor,
  };
}
