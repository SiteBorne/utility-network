/**
 * SUN-1221C — the production route composition for
 * `web_context_verified.v2` / CDP. Mirrors
 * `verify-agent-output-v2-cdp-composition.ts` exactly (SUN-1221B §10:
 * every primitive it uses -- `resolvePaymentNetwork`,
 * `isProductionPaymentAuthorized`, `resolvePaymentAsset`,
 * `resolveProductionCdpEvidenceProvider`, `buildProductionSigner` -- is
 * already generic and non-service-specific; nothing here reimplements
 * gate logic). Never `buildFixtureRegistry`, never `createFixtureSigner`.
 *
 * The one genuinely new piece: `web_context_verified.v2` makes real
 * outbound HTTP fetches to buyer-supplied URLs, which the plain platform
 * `fetch()` cannot do safely (SUN-1221B §9 / SUN-1221C's own DNS-rebinding
 * fix). The `InjectedHttpClient` wired into the executor below is always
 * `SafeSocketHttpClient` (`@siteborne/provider-adapters`), constructed
 * here with the REAL `cloudflare:sockets` `connect` and a DoH client that
 * only ever calls Cloudflare's own fixed, trusted DoH endpoint -- never
 * the buyer-supplied target. This is the one place in this composition
 * that touches a Workers-runtime-only global; the package itself stays
 * fully dependency-injected and test-friendly (see
 * `dns-rebinding.test.ts`).
 *
 * See `verify-agent-output-v2-cdp-composition.ts`'s own doc comment for
 * the full ADR-0055/evidence-provider reasoning this file reuses
 * verbatim: `PRODUCTION_EVIDENCE_SELECTION = real provider OR
 * unavailable`, never a synthetic fallback; `explicitTestEvidenceOverride`
 * is the only escape hatch, and the real production route module never
 * supplies it.
 */
import type { D1Database } from '@cloudflare/workers-types';
import { connect as cloudflareConnect } from '../../cloudflare-sockets-ambient';
import { createCdpFacilitatorClient } from '@coinbase/cdp-sdk/x402';
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
import {
  SafeSocketHttpClient,
  ModalSafeEgressClient,
  type ConnectFn,
  type InjectedHttpClient,
} from '@siteborne/provider-adapters';
import {
  buildCdpSellerAddressLookup,
  buildProductionCdpAccountLookupClientFactory,
  resolvePaymentAsset,
  resolveProductionAuthorizationInput,
  resolveProductionCdpEvidenceProvider,
} from '../config/production-payment';
import type { ServiceExecutor, X402ServiceRouteConfig } from '../routes/x402-service';
import { buildWebContextV2ProductionExecutor } from './web-context-v2-production-executor';

export interface WebContextV2CdpProductionEnv {
  PAID_RECEIPT_SIGNING_PRIVATE_KEY?: string;
  PAID_RECEIPT_SIGNING_KEY_ID?: string;
  SELLER_WALLET_ADDRESS?: string;
  CDP_API_KEY_ID?: string;
  CDP_API_KEY_SECRET?: string;
  PAYMENT_ENVIRONMENT?: string;
  PRODUCTION_ENABLED?: string;
  HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP?: string;
  PRODUCTION_CDP_CREDENTIALS_APPROVED?: string;
  /** SUN-1221E5Q6G — dedicated, environment-scoped credentials for the
   * off-Cloudflare safe-egress executor. See `env.ts`'s own doc comment;
   * all three optional, fail-closed (`unavailable: true`) when absent,
   * exactly like the CDP/receipt-signing fields above. */
  MODAL_WEBCTX_ENDPOINT_URL?: string;
  MODAL_WEBCTX_PROXY_KEY?: string;
  MODAL_WEBCTX_PROXY_SECRET?: string;
}

export interface ProductionCompositionUnavailable {
  unavailable: true;
  reason: string;
}

/** See `verify-agent-output-v2-cdp-composition.ts`'s own doc comment for
 * this type's full reasoning -- the ONLY way this composition may ever
 * resolve fixture/synthetic payment evidence, never supplied by the real
 * production route module. */
export interface ExplicitTestEvidenceOverride {
  evidenceMode: 'fixture';
  evidenceProvider?: PaymentEvidenceProvider;
}

/**
 * Builds the DNS-rebinding-safe `InjectedHttpClient` every real outbound
 * fetch `web_context_verified.v2` makes goes through. `connectFn`
 * defaults to the real `cloudflare:sockets` `connect` -- overridable only
 * so `test:worker-runtime`-style real-workerd proofs can supply the same
 * real function explicitly rather than this module re-importing it
 * differently in two places.
 */
export function buildWebContextV2SafeHttpClient(connectFn: ConnectFn = cloudflareConnect) {
  return new SafeSocketHttpClient({
    connect: connectFn,
    // The DoH lookup itself always targets Cloudflare's own fixed,
    // trusted resolver (`safe-dns-resolve.ts`'s `TRUSTED_DOH_ENDPOINT`) --
    // never the buyer-supplied hostname -- so the plain platform `fetch`
    // is safe to use here without going through the same safety pipeline
    // it exists to protect.
    dohHttpClient: { fetch: (input, init) => globalThis.fetch(input, init) },
    clock: {
      now: () => new Date(),
      nowMs: () => Date.now(),
      setTimeout: (cb: () => void, delay: number) => globalThis.setTimeout(cb, delay),
      clearTimeout: (id: unknown) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
      advance: () => {
        throw new Error('real_clock_cannot_advance');
      },
      setTime: () => {
        throw new Error('real_clock_cannot_setTime');
      },
      getCurrentTime: () => Date.now(),
    },
  });
}

/**
 * SUN-1221E5Q6G — the production `InjectedHttpClient` `web_context_
 * verified.v2`'s `retrieval_mode: 'direct'` transport actually uses
 * (`PRODUCTION_WEBCTX_DIRECT_HTTP_USES_MODAL_EXECUTOR=YES`,
 * `PRODUCTION_WEBCTX_DIRECT_HTTP_USES_SAFESOCKET=NO`). Calls the
 * dedicated off-Cloudflare safe-egress executor (`services/webctx-safe-
 * egress`) instead of dialing `cloudflare:sockets` directly --
 * `SUN-1221E5Q6E` proved Cloudflare Workers cannot reach any target whose
 * resolved address falls inside Cloudflare's own IP ranges, and `web_
 * context_verified.v2`'s contract ("Public HTTP/HTTPS only") has no
 * Cloudflare-hosted-site carve-out (`SUN-1221E5Q6F`, human-approved
 * Approach C: unconditional, never a hybrid/CIDR-based routing split --
 * see `buildWebContextV2SafeHttpClient` above, retained only for the dev-
 * diagnostic seam and its own tests, never called from this function).
 *
 * `buildWebContextV2CdpProductionRouteConfig` returns `unavailable: true`
 * (never falls back to `SafeSocketHttpClient`) when any of the three
 * `MODAL_WEBCTX_*` credentials are absent -- exactly the same fail-closed
 * pattern already established for `PAID_RECEIPT_SIGNING_PRIVATE_KEY`/CDP
 * credentials above.
 */
export function buildWebContextV2ModalSafeEgressClient(env: {
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

export async function buildWebContextV2CdpProductionRouteConfig(
  env: WebContextV2CdpProductionEnv,
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
  // SUN-1221E5Q6G — fail closed, never fall back to SafeSocketHttpClient
  // (Approach C: unconditional, no hybrid/CIDR-based routing split).
  if (!env.MODAL_WEBCTX_ENDPOINT_URL || !env.MODAL_WEBCTX_PROXY_KEY || !env.MODAL_WEBCTX_PROXY_SECRET) {
    return { unavailable: true, reason: 'MODAL_WEBCTX_* safe-egress executor credentials are missing' };
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
    // Same structural invariant as verify's composition: real provider OR
    // unavailable, never a synthetic fallback, regardless of ambient
    // config.
    if (resolved.evidenceMode !== 'production') {
      return {
        unavailable: true,
        reason:
          'production payment evidence unavailable and no explicit test evidence override was supplied',
      };
    }
    cdpEvidence = resolved;
  }

  const httpClient = buildWebContextV2ModalSafeEgressClient({
    MODAL_WEBCTX_ENDPOINT_URL: env.MODAL_WEBCTX_ENDPOINT_URL,
    MODAL_WEBCTX_PROXY_KEY: env.MODAL_WEBCTX_PROXY_KEY,
    MODAL_WEBCTX_PROXY_SECRET: env.MODAL_WEBCTX_PROXY_SECRET,
  });
  const executor: ServiceExecutor = buildWebContextV2ProductionExecutor(
    signer,
    registry,
    httpClient
  );

  // Same domain-metadata sourcing as verify's composition (SUN-1220K/L):
  // `resolvePaymentAsset` is generic, not service-specific -- reused
  // verbatim, never hardcoded.
  const asset = resolvePaymentAsset(network);

  return {
    serviceId: 'web_context_verified.v2',
    scheme: 'exact',
    pricingKey: 'web_context_verified_direct',
    rail: 'cdp',
    network,
    asset: asset.address,
    paymentRequirementExtra: { name: asset.name, version: asset.version },
    payTo: env.SELLER_WALLET_ADDRESS,
    path: '/v2/web/context',
    inputSchema: BUNDLED_SERVICE_INPUT_SCHEMAS['web_context_verified.v2'] as Record<
      string,
      unknown
    >,
    contractRelease: '2.0.0',
    // SUN-1221B §6: v1/v2 share the exact same schema files -- these
    // hashes are copied verbatim from the frozen release manifest
    // (docs/contracts/SERVICE_CONTRACT_RELEASE_1.0.0.md, the
    // `web_context_verified.v1` row), never recomputed or invented.
    inputSchemaHash: 'sha256:d3b0762020d4cc1d1e846960ed978cf1237b1741f90213adabe8ed931c2845ea',
    outputSchemaHash: 'sha256:138bccc34ad8c320daec36890b8867fca9f709040b80c689710fd4bde49042de',
    pccDependency: '1.1.0',
    db,
    clock: () => new Date().toISOString(),
    evidenceMode: cdpEvidence.evidenceMode,
    evidenceProvider: cdpEvidence.evidenceProvider,
    // Unlike verify_agent_output.v2, web_context_verified.v2's schema has
    // no comparable buyer-supplied `required_schema`/Profile-1 field the
    // executor actually consumes (SUN-1221B §8/§18: `buyer_schema` is
    // schema-declared but never read) -- there is no real pre-economic
    // check to perform, so this is honestly omitted rather than invented.
    executor,
  };
}
