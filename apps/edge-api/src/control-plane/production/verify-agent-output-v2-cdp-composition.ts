/**
 * SUN-1214 checkpoint T — the production route composition for
 * `verify_agent_output.v2` / CDP. Assembles a real
 * `X402ServiceRouteConfig` around the Task 3 production executor and
 * the repository's existing, real, unmodified machinery
 * (`resolvePaymentNetwork`, `isProductionPaymentAuthorized`,
 * `resolvePaymentAsset`, `resolveProductionCdpEvidenceProvider`) --
 * never `buildFixtureRegistry`, never `createFixtureSigner`.
 *
 * SUN-1216 wired this module into the real, bundle-reachable production
 * entrypoint (`production-verify-v2-cdp-route.ts`, imported by
 * `index.ts`).
 *
 * SUN-1218 checkpoint X closes the payment-evidence trust gap this
 * exposed: production evidence selection is fail-closed and this function
 * enforces, structurally, the permanent invariant
 *
 *   PRODUCTION_PAYMENT_EVIDENCE_FALLBACK_TO_SYNTHETIC = IMPOSSIBLE
 *
 * PRODUCTION_EVIDENCE_SELECTION = real provider OR unavailable, never
 * real provider OR synthetic fallback. Fixture/synthetic evidence is
 * selectable ONLY via the explicit, narrowly-typed
 * `explicitTestEvidenceOverride` third parameter, which the real
 * production route module never supplies -- see that parameter's own
 * doc comment for the full reasoning. No ambient signal (an env var
 * value, secret presence/absence, or a provider-construction failure)
 * may ever implicitly select fixture evidence for a real caller.
 *
 * Fails closed (`{unavailable: true, reason}`) rather than throwing on
 * any missing/malformed dependency: missing signing key material,
 * missing signing key ID, malformed key material, no D1 database, or
 * (new in SUN-1218) real production payment evidence being unavailable
 * with no explicit test override supplied. Never falls back to a
 * fixture signer or fixture registry on any path.
 */
import type { D1Database } from '@cloudflare/workers-types';
import { createCdpFacilitatorClient } from '@coinbase/cdp-sdk/x402';
import { buildRealJwtDiagnosticDeps } from '../evidence/cdp-jwt-diagnostic-sdk';
import {
  BUNDLED_SERVICE_INPUT_SCHEMAS,
  assertPreproductionNetwork,
  isProductionPaymentAuthorized,
  resolvePaymentNetwork,
  type PaymentEvidenceProvider,
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
import {
  composePreEconomicValidators,
  modeAvailabilityValidator,
} from '../routes/pre-economic-mode-gate';
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
  /** Diagnostic-canary-only, non-secret; exact literal 'true' enables the local JWT controls. */
  JWT_RUNTIME_DIAGNOSTIC_ENABLED?: string;
}

export interface ProductionCompositionUnavailable {
  unavailable: true;
  reason: string;
}

/**
 * SUN-1218 checkpoint X — the ONLY way this composition may ever resolve
 * fixture/synthetic payment evidence. Deliberately narrow, deliberately
 * explicit: no ambient signal (an env var value, secret presence/
 * absence, or a provider-construction failure) may ever implicitly
 * select this on the real production call site's behalf. The real
 * production route module (`production-verify-v2-cdp-route.ts`) never
 * supplies this argument at all -- only `worker-runtime-test-entrypoint.ts`
 * (a file `index.ts` never imports, proven by the existing bundle-
 * isolation checks) constructs and passes one, explicitly, for its own
 * real-workerd qualification purpose. This is the literal mechanism
 * behind the required invariant:
 *
 *   PRODUCTION_EVIDENCE_SELECTION = real provider OR unavailable
 *   TEST_EVIDENCE_SELECTION       = explicitly injected controlled test provider
 *
 * never "real provider OR synthetic fallback."
 */
export interface ExplicitTestEvidenceOverride {
  evidenceMode: 'fixture';
  evidenceProvider?: PaymentEvidenceProvider;
}

/** Mirrors `paid-services.ts`'s private `verifyAgentOutputPreEconomicCheck`
 * exactly (that function is not exported, and this checkpoint does not
 * modify that frozen file) -- both are thin argument-extraction glue
 * around the one real, shared, unmodified Profile 1 engine
 * (`checkSchemaProfile1`); neither duplicates verification logic. */
function verifyAgentOutputSchemaProfileCheck(
  body: unknown
): { ok: true } | { ok: false; code: string; message: string } {
  const requiredSchema = (body as { required_schema?: unknown } | null)?.required_schema;
  const check = checkSchemaProfile1(requiredSchema);
  if (check.supported) return { ok: true };
  return { ok: false, code: check.code, message: check.reason };
}

/** PRODUCTION-ECONOMICS-DISCOVERY-01: an unavailable mode
 * (`independent_reproduction`) is rejected before the schema profile check and
 * before any quote/402 -- it must never be quoted at the standard price. */
const verifyAgentOutputPreEconomicCheck = composePreEconomicValidators(
  modeAvailabilityValidator('verify_agent_output.v2'),
  verifyAgentOutputSchemaProfileCheck
);

export async function buildVerifyAgentOutputV2CdpProductionRouteConfig(
  env: VerifyAgentOutputV2CdpProductionEnv,
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

  // SUN-1222C determinism remediation: the governed seller address is
  // validated locally inside `resolveProductionCdpEvidenceProvider`.
  // Provider selection performs no authenticated account lookup, retry,
  // telemetry, or other external I/O before a 402 can be constructed.
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
        ...(env.JWT_RUNTIME_DIAGNOSTIC_ENABLED === 'true'
          ? {
              jwtDiagnostic: {
                apiKeyId: env.CDP_API_KEY_ID,
                apiKeySecret: env.CDP_API_KEY_SECRET,
                deps: buildRealJwtDiagnosticDeps(),
              },
            }
          : {}),
      }
    );
    // SUN-1218's central invariant, enforced structurally, not by an
    // ambient signal: PRODUCTION_EVIDENCE_SELECTION = real provider OR
    // unavailable, NEVER real provider OR synthetic fallback. Any
    // resolution other than 'production' fails closed here,
    // unconditionally -- regardless of which secrets are present,
    // absent, or malformed, and regardless of ENVIRONMENT/any other
    // ambient config. The only way this composition ever mounts a
    // fixture-evidenced route is via `explicitTestEvidenceOverride`
    // above, which the real production route module never supplies.
    if (resolved.evidenceMode !== 'production') {
      return {
        unavailable: true,
        reason:
          'production payment evidence unavailable and no explicit test evidence override was supplied',
      };
    }
    cdpEvidence = resolved;
  }

  const executor: ServiceExecutor = buildVerifyAgentOutputV2ProductionExecutor(signer, registry);

  // SUN-1220L: the official pinned x402 exact/EIP-3009 signing path
  // (`ExactEvmScheme.createPaymentPayload` -> `signEIP3009Authorization`)
  // requires `paymentRequirements.extra.name`/`.version` (the asset's own
  // EIP-712 domain name/version) before it will ever call
  // `signTypedData` -- both already computed by `resolvePaymentAsset`'s
  // own pinned `getDefaultAsset(network)` call, previously discarded here
  // (only `.address` was read). Sourced from the official library, never
  // hardcoded (SUN-1220K root cause / remediation design).
  const asset = resolvePaymentAsset(network);

  return {
    serviceId: 'verify_agent_output.v2',
    scheme: 'exact',
    pricingKey: 'verify_agent_output_standard_v2',
    rail: 'cdp',
    network,
    asset: asset.address,
    paymentRequirementExtra: { name: asset.name, version: asset.version },
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
