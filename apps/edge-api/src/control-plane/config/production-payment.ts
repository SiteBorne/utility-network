/**
 * SUN-1200 checkpoint A — the edge-api-side (credential-reading) half of
 * the production-payment authorization gate. `@siteborne/protocol-x402`
 * (network/authorization resolution) never reads environment variables or
 * secrets itself, matching the credential-independent package boundary
 * established for protocol-nevermined/protocol-a2a: this file is where
 * real `Env` values are read and turned into the plain-data
 * `ProductionAuthorizationInput` that package's pure functions consume.
 *
 * ADR 0055 (docs/decisions/0055-human-authorized-production-bootstrap-exception.md)
 * authorizes only the GOVERNANCE MECHANISM that a bounded, human-authorized
 * bootstrap exception can exist. It does not itself set any of the four
 * gates below true — every one must be independently, explicitly
 * configured for a specific action.
 */
import { getDefaultAsset } from '@x402/evm';
import type { Network } from '@x402/core/types';
import type { HTTPFacilitatorClient } from '@x402/core/server';
import { isAddress } from 'viem';
import {
  isProductionPaymentAuthorized,
  type PaymentEvidenceMode,
  type PaymentEvidenceProvider,
  type ProductionAuthorizationInput,
  type SiteborneServiceId,
} from '@siteborne/protocol-x402';
import { CdpPaymentEvidenceProvider } from '../evidence/cdp-provider';
import type { Env } from './env';

/** Fails closed: any value other than the exact literal `'production'`
 * resolves to `'preproduction'` — including unset, empty, malformed, or
 * unexpected casing. Never inferred from `ENVIRONMENT`, hostname,
 * `NODE_ENV`, Cloudflare deployment name, or the presence of secrets. */
export function resolvePaymentEnvironment(
  raw: string | undefined
): ProductionAuthorizationInput['environment'] {
  return raw === 'production' ? 'production' : 'preproduction';
}

function resolveTrueFlag(raw: string | undefined): boolean {
  return raw === 'true';
}

/** Reads all four gates from a real `Env` and assembles the plain-data
 * input `isProductionPaymentAuthorized`/`resolvePaymentNetwork` consume.
 * Never logs or returns any secret value — only the resulting booleans. */
export function resolveProductionAuthorizationInput(
  env: Pick<
    Env,
    | 'PAYMENT_ENVIRONMENT'
    | 'PRODUCTION_ENABLED'
    | 'HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP'
    | 'PRODUCTION_CDP_CREDENTIALS_APPROVED'
  >
): ProductionAuthorizationInput {
  return {
    environment: resolvePaymentEnvironment(env.PAYMENT_ENVIRONMENT),
    productionEnabled: resolveTrueFlag(env.PRODUCTION_ENABLED),
    humanBootstrapAuthorized: resolveTrueFlag(env.HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP),
    productionCredentialsApproved: resolveTrueFlag(env.PRODUCTION_CDP_CREDENTIALS_APPROVED),
  };
}

export interface ResolvedPaymentAsset {
  address: string;
  /** EIP-712 domain name (must match the token's own domain separator) --
   * required by `@x402/evm`'s `ExactEvmScheme.createPaymentPayload`
   * (`signEIP3009Authorization`) before it will ever call
   * `signTypedData`. Already computed by the pinned `getDefaultAsset`
   * call below (SUN-1220K/L); previously discarded by this type. */
  name: string;
  /** EIP-712 domain version (must match the token's own domain
   * separator) -- see `name`'s doc comment. */
  version: string;
  decimals: number;
}

/** Resolves the asset strictly FROM the given network — never
 * independently — so a network/asset mismatch is structurally impossible
 * for any caller that goes through this function instead of hardcoding
 * an asset address. */
export function resolvePaymentAsset(network: Network): ResolvedPaymentAsset {
  return getDefaultAsset(network);
}

/** Defense-in-depth: throws if a caller somehow ends up with an asset
 * address that does not belong to the given network (e.g. a stale or
 * hand-constructed value bypassing `resolvePaymentAsset`). Case-
 * insensitive address comparison. */
export function assertNetworkAssetConsistency(network: Network, assetAddress: string): void {
  const expected = getDefaultAsset(network).address;
  if (assetAddress.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(
      `network_asset_mismatch: asset "${assetAddress}" does not belong to network "${network}" ` +
        `(expected "${expected}")`
    );
  }
}

export interface ProductionBindingsCheck {
  ok: boolean;
  missing: string[];
}

/**
 * Presence-only check (never logs or returns secret VALUES) for the governed
 * public receiver plus production-payment-specific credentials. Distinct from this same
 * file's neighbor `env.ts`'s existing `validateProductionBindings`
 * (defined but never wired into the live request path anywhere) — this
 * is the canonical equivalent this checkpoint wires for real.
 *
 * SUN-1200 checkpoint E — `CDP_WALLET_SECRET` deliberately removed from
 * this required set, per direct reconciliation against the installed
 * `@coinbase/cdp-sdk`'s own type definitions and doc comments (not
 * assumed): `createCdpFacilitatorClient`'s `CdpFacilitatorClientArgs`
 * accepts only `apiKeyId`/`apiKeySecret` — there is no `walletSecret`
 * parameter on the facilitator client at all, so `.verify()`/`.settle()`
 * never need it. `CdpClient`'s own constructor doc comment states the
 * Wallet Secret "is used specifically to authenticate requests to POST,
 * and DELETE endpoints in the EVM and Solana Account APIs". Neither real
 * production CDP SDK call site in this repository needs it.
 * The pre-402 request path no longer constructs a general CDP account
 * client merely to rediscover the governed public receiver address. */
export function checkProductionBindingsPresent(
  env: Pick<Env, 'SELLER_WALLET_ADDRESS' | 'CDP_API_KEY_ID' | 'CDP_API_KEY_SECRET'>
): ProductionBindingsCheck {
  const required: Array<keyof typeof env> = [
    'SELLER_WALLET_ADDRESS',
    'CDP_API_KEY_ID',
    'CDP_API_KEY_SECRET',
  ];
  const missing = required.filter((key) => !env[key]);
  return { ok: missing.length === 0, missing };
}

export interface SellerIdentityCheckInput {
  configuredAddress: string;
  authenticatedAddress: string;
}

/**
 * Resolves the governed x402 receiver without I/O.
 *
 * `SELLER_WALLET_ADDRESS` is the committed, deployment-frozen canonical
 * `payTo`; CDP account membership is not data needed to construct a payment
 * requirement. `viem`'s strict address check accepts conventional all-lower
 * or all-upper addresses and validates EIP-55 when the address uses mixed
 * case. The original bytes are retained so the frozen public contract does
 * not change. Missing, malformed, or bad-checksum configuration fails closed
 * before the facilitator is constructed.
 */
export function resolveGovernedSellerAddress(configuredAddress: string): `0x${string}` {
  if (!isAddress(configuredAddress, { strict: true })) {
    throw new Error('seller_wallet_address_malformed_or_bad_checksum');
  }
  return configuredAddress as `0x${string}`;
}

/** Separates the configured canonical public receiver
 * (`SELLER_WALLET_ADDRESS`, a committed Cloudflare ordinary var) from an
 * authenticated CDP wallet/account identity. This pure equality assertion is
 * retained for an explicitly authorized release qualification; it is not a
 * request-time prerequisite for constructing a 402. */
export function assertSellerIdentityConsistent(input: SellerIdentityCheckInput): void {
  if (input.configuredAddress.toLowerCase() !== input.authenticatedAddress.toLowerCase()) {
    throw new Error(
      'seller_identity_mismatch: configured SELLER_WALLET_ADDRESS does not match the ' +
        'authenticated CDP wallet identity -- refusing to proceed'
    );
  }
}

export type ProductionCdpProviderBindings = Pick<
  Env,
  'SELLER_WALLET_ADDRESS' | 'CDP_API_KEY_ID' | 'CDP_API_KEY_SECRET'
>;

/**
 * SUN-1220P2 — the route-specific two-flag gate `verify-agent-output-v2-
 * cdp-route.ts` already checks inline (`PAID_ROUTES_ENABLED` AND
 * `VERIFY_V2_CDP_ROUTE_ENABLED`, both the exact literal `'true'`).
 * Extracted here as the single reusable definition so the public
 * discovery overlay (`catalog.ts`, `a2a.ts`) can ask the identical
 * question the real route activation asks, rather than maintaining a
 * second, independently-drifting copy of the same two comparisons. The
 * route module itself now calls this too (SUN-1220P2) -- behavior is
 * byte-identical, only the comparison's home moved.
 */
export function isVerifyAgentOutputV2CdpRouteFlagEnabled(
  env: Pick<Env, 'PAID_ROUTES_ENABLED' | 'VERIFY_V2_CDP_ROUTE_ENABLED'>
): boolean {
  return env.PAID_ROUTES_ENABLED === 'true' && env.VERIFY_V2_CDP_ROUTE_ENABLED === 'true';
}

/** Non-network, non-secret-value inputs `resolveVerifyAgentOutputV2CdpEffectiveDiscoveryStatus`
 * needs beyond the two route flags and the four ADR-0055 gates -- exactly
 * the presence checks `buildVerifyAgentOutputV2CdpProductionRouteConfig`
 * performs synchronously, before it ever attempts to construct a signer
 * or a CDP client. */
export type VerifyAgentOutputV2CdpDiscoveryEnv = Pick<
  Env,
  | 'PAID_ROUTES_ENABLED'
  | 'VERIFY_V2_CDP_ROUTE_ENABLED'
  | 'PAYMENT_ENVIRONMENT'
  | 'PRODUCTION_ENABLED'
  | 'HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP'
  | 'PRODUCTION_CDP_CREDENTIALS_APPROVED'
  | 'PAID_RECEIPT_SIGNING_PRIVATE_KEY'
  | 'PAID_RECEIPT_SIGNING_KEY_ID'
  | 'SELLER_WALLET_ADDRESS'
  | 'CDP_API_KEY_ID'
  | 'CDP_API_KEY_SECRET'
>;

/**
 * SUN-1220P2 — version-local effective public-discovery availability for
 * `verify_agent_output.v2` / CDP. Deliberately narrower than "will the
 * next real request definitely succeed": it reuses every synchronous,
 * non-network gate/presence check the real route activation path
 * (`production-verify-v2-cdp-route.ts` →
 * `buildVerifyAgentOutputV2CdpProductionRouteConfig`) already performs
 * before it ever constructs a signer or a CDP client -- the two route
 * flags, all four ADR-0055 gates (`isProductionPaymentAuthorized`, not
 * re-implemented), the receipt-signing key material's presence, and the
 * CDP/seller binding presence (`checkProductionBindingsPresent`, not
 * re-implemented). It deliberately does NOT attempt a live CDP account
 * lookup (`resolveProductionCdpEvidenceProvider`'s seller-identity
 * check) -- that is a real network call to an external service, and
 * this function may run on every public, unauthenticated `/catalog`/
 * agent-card request; making discovery pay for a live CDP round trip
 * per visitor would be both wasteful and a new, unreviewed live-call
 * surface neither SUN-1220P nor SUN-1220P1 authorized. A signing-key or
 * CDP-credential misconfiguration that only a live call could catch
 * still fails closed at actual execution time exactly as before --
 * runtime route activation remains the sole authority for whether a
 * request actually succeeds; this function only governs what discovery
 * is permitted to *claim* about that. */
export function resolveVerifyAgentOutputV2CdpEffectiveDiscoveryStatus(
  env: VerifyAgentOutputV2CdpDiscoveryEnv,
  hasDb: boolean
): boolean {
  if (!hasDb) return false;
  if (!isVerifyAgentOutputV2CdpRouteFlagEnabled(env)) return false;
  if (!isProductionPaymentAuthorized(resolveProductionAuthorizationInput(env))) return false;
  if (!env.PAID_RECEIPT_SIGNING_PRIVATE_KEY || !env.PAID_RECEIPT_SIGNING_KEY_ID) return false;
  if (!checkProductionBindingsPresent(env).ok) return false;
  return true;
}

/** SUN-1221C — mirrors `isVerifyAgentOutputV2CdpRouteFlagEnabled` exactly
 * for `web_context_verified.v2` / CDP. Independent of the verify route's
 * own flag: either service can be active while the other is not
 * (SUN-1221B §20). */
export function isWebContextV2CdpRouteFlagEnabled(
  env: Pick<Env, 'PAID_ROUTES_ENABLED' | 'WEB_CONTEXT_V2_CDP_ROUTE_ENABLED'>
): boolean {
  return env.PAID_ROUTES_ENABLED === 'true' && env.WEB_CONTEXT_V2_CDP_ROUTE_ENABLED === 'true';
}

/** Mirrors `VerifyAgentOutputV2CdpDiscoveryEnv` exactly, substituting the
 * web-context route flag. */
export type WebContextV2CdpDiscoveryEnv = Pick<
  Env,
  | 'PAID_ROUTES_ENABLED'
  | 'WEB_CONTEXT_V2_CDP_ROUTE_ENABLED'
  | 'PAYMENT_ENVIRONMENT'
  | 'PRODUCTION_ENABLED'
  | 'HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP'
  | 'PRODUCTION_CDP_CREDENTIALS_APPROVED'
  | 'PAID_RECEIPT_SIGNING_PRIVATE_KEY'
  | 'PAID_RECEIPT_SIGNING_KEY_ID'
  | 'SELLER_WALLET_ADDRESS'
  | 'CDP_API_KEY_ID'
  | 'CDP_API_KEY_SECRET'
>;

/** Mirrors `resolveVerifyAgentOutputV2CdpEffectiveDiscoveryStatus` exactly
 * -- see that function's own doc comment for the full reasoning (fails
 * closed on missing DB/flags/ADR-0055 authorization/signing-key
 * presence/CDP binding presence; deliberately never attempts a live CDP
 * account lookup from a public discovery request). */
export function resolveWebContextV2CdpEffectiveDiscoveryStatus(
  env: WebContextV2CdpDiscoveryEnv,
  hasDb: boolean
): boolean {
  if (!hasDb) return false;
  if (!isWebContextV2CdpRouteFlagEnabled(env)) return false;
  if (!isProductionPaymentAuthorized(resolveProductionAuthorizationInput(env))) return false;
  if (!env.PAID_RECEIPT_SIGNING_PRIVATE_KEY || !env.PAID_RECEIPT_SIGNING_KEY_ID) return false;
  if (!checkProductionBindingsPresent(env).ok) return false;
  return true;
}

/** SUN-1222B-S3R — mirrors `isWebContextV2CdpRouteFlagEnabled` exactly for
 * `company_evidence_graph.v2` / CDP. Independent of the other routes' own
 * flags: any of the three services can be active while the others are
 * not. */
export function isCompanyEvidenceGraphV2CdpRouteFlagEnabled(
  env: Pick<Env, 'PAID_ROUTES_ENABLED' | 'COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED'>
): boolean {
  return (
    env.PAID_ROUTES_ENABLED === 'true' && env.COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED === 'true'
  );
}

/** Mirrors `WebContextV2CdpDiscoveryEnv` exactly, substituting the
 * company-evidence route flag. */
export type CompanyEvidenceGraphV2CdpDiscoveryEnv = Pick<
  Env,
  | 'PAID_ROUTES_ENABLED'
  | 'COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED'
  | 'PAYMENT_ENVIRONMENT'
  | 'PRODUCTION_ENABLED'
  | 'HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP'
  | 'PRODUCTION_CDP_CREDENTIALS_APPROVED'
  | 'PAID_RECEIPT_SIGNING_PRIVATE_KEY'
  | 'PAID_RECEIPT_SIGNING_KEY_ID'
  | 'SELLER_WALLET_ADDRESS'
  | 'CDP_API_KEY_ID'
  | 'CDP_API_KEY_SECRET'
>;

/** Mirrors `resolveWebContextV2CdpEffectiveDiscoveryStatus` exactly -- see
 * that function's own doc comment for the full reasoning. */
export function resolveCompanyEvidenceGraphV2CdpEffectiveDiscoveryStatus(
  env: CompanyEvidenceGraphV2CdpDiscoveryEnv,
  hasDb: boolean
): boolean {
  if (!hasDb) return false;
  if (!isCompanyEvidenceGraphV2CdpRouteFlagEnabled(env)) return false;
  if (!isProductionPaymentAuthorized(resolveProductionAuthorizationInput(env))) return false;
  if (!env.PAID_RECEIPT_SIGNING_PRIVATE_KEY || !env.PAID_RECEIPT_SIGNING_KEY_ID) return false;
  if (!checkProductionBindingsPresent(env).ok) return false;
  return true;
}

/** SUN-1222B-S3R — mirrors `isCompanyEvidenceGraphV2CdpRouteFlagEnabled`
 * exactly for `document_evidence_json.v2` / CDP. */
export function isDocumentEvidenceJsonV2CdpRouteFlagEnabled(
  env: Pick<Env, 'PAID_ROUTES_ENABLED' | 'DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED'>
): boolean {
  return (
    env.PAID_ROUTES_ENABLED === 'true' && env.DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED === 'true'
  );
}

/** Mirrors `CompanyEvidenceGraphV2CdpDiscoveryEnv` exactly, substituting
 * the document-evidence route flag. */
export type DocumentEvidenceJsonV2CdpDiscoveryEnv = Pick<
  Env,
  | 'PAID_ROUTES_ENABLED'
  | 'DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED'
  | 'PAYMENT_ENVIRONMENT'
  | 'PRODUCTION_ENABLED'
  | 'HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP'
  | 'PRODUCTION_CDP_CREDENTIALS_APPROVED'
  | 'PAID_RECEIPT_SIGNING_PRIVATE_KEY'
  | 'PAID_RECEIPT_SIGNING_KEY_ID'
  | 'SELLER_WALLET_ADDRESS'
  | 'CDP_API_KEY_ID'
  | 'CDP_API_KEY_SECRET'
>;

/** Mirrors `resolveCompanyEvidenceGraphV2CdpEffectiveDiscoveryStatus`
 * exactly -- see that function's own doc comment for the full reasoning.
 * Deliberately does NOT (and cannot, without a live network probe) check
 * `env.ARTIFACTS`/R2 presence or MODAL_DOCWORKER_* -- consistent with
 * every other resolver here, discovery reflects synchronous
 * signing-key/CDP-binding presence only; the route itself is the sole
 * authority on whether a real request can actually succeed. */
export function resolveDocumentEvidenceJsonV2CdpEffectiveDiscoveryStatus(
  env: DocumentEvidenceJsonV2CdpDiscoveryEnv,
  hasDb: boolean
): boolean {
  if (!hasDb) return false;
  if (!isDocumentEvidenceJsonV2CdpRouteFlagEnabled(env)) return false;
  if (!isProductionPaymentAuthorized(resolveProductionAuthorizationInput(env))) return false;
  if (!env.PAID_RECEIPT_SIGNING_PRIVATE_KEY || !env.PAID_RECEIPT_SIGNING_KEY_ID) return false;
  if (!checkProductionBindingsPresent(env).ok) return false;
  return true;
}

/** SUN-1221C — a small, additive per-service discovery-resolver registry
 * (SUN-1221CD §22: "prefer generic... rather than adding another chain
 * of hardcoded single-service special cases"). Each existing per-service
 * resolver above is reused verbatim, not reimplemented -- this is purely
 * an enumeration layer for `catalog.ts`/`readiness.ts` to iterate over
 * without hardcoding a growing if/else chain as more services are added.
 * `Partial` because only paid services with a real production
 * composition have an entry; every other `SiteborneServiceId` is simply
 * absent (never truthfully claimable as active). */
export type EffectiveDiscoveryEnv = VerifyAgentOutputV2CdpDiscoveryEnv &
  WebContextV2CdpDiscoveryEnv &
  CompanyEvidenceGraphV2CdpDiscoveryEnv &
  DocumentEvidenceJsonV2CdpDiscoveryEnv;

export const EFFECTIVE_DISCOVERY_RESOLVERS: Partial<
  Record<SiteborneServiceId, (env: EffectiveDiscoveryEnv, hasDb: boolean) => boolean>
> = {
  'verify_agent_output.v2': resolveVerifyAgentOutputV2CdpEffectiveDiscoveryStatus,
  'web_context_verified.v2': resolveWebContextV2CdpEffectiveDiscoveryStatus,
  // SUN-1222B-S3R — company_evidence_graph.v2 and document_evidence_json.v2
  // now have real production compositions; added the same way the first
  // two were. Neither resolver checks env.ARTIFACTS/MODAL_DOCWORKER_*/
  // MODAL_WEBCTX_* presence (a live-call-avoidance limitation this
  // registry already accepted for the first two) -- the route itself
  // remains the sole authority on whether a real request actually
  // succeeds.
  'company_evidence_graph.v2': resolveCompanyEvidenceGraphV2CdpEffectiveDiscoveryStatus,
  'document_evidence_json.v2': resolveDocumentEvidenceJsonV2CdpEffectiveDiscoveryStatus,
};

/** The single surface-neutral runtime status consumed by every public
 * production-discovery serializer. `hasProductionExecutor` describes whether
 * the production Worker has a governed composition for the service;
 * `productionEnabled` is the exact version-local resolver result; and
 * `externalConfigured` deliberately means that the resolver's synchronous
 * dependency-presence checks passed, not that a public discovery request made
 * a live provider call. */
export interface EffectiveServiceRuntimeStatus {
  hasProductionExecutor: boolean;
  productionEnabled: boolean;
  externalConfigured: boolean;
}

export function resolveEffectiveServiceRuntimeStatus(
  serviceId: SiteborneServiceId,
  env: EffectiveDiscoveryEnv | undefined,
  hasDb: boolean
): EffectiveServiceRuntimeStatus {
  const resolver = EFFECTIVE_DISCOVERY_RESOLVERS[serviceId];
  const hasProductionExecutor = resolver !== undefined;
  const productionEnabled = Boolean(env && resolver?.(env, hasDb));
  return {
    hasProductionExecutor,
    productionEnabled,
    // No live network probe is permitted on an unauthenticated discovery
    // request. Today every registered resolver includes all synchronous
    // external credential/dependency presence checks, so configured external
    // readiness is exactly the effective-production result.
    externalConfigured: productionEnabled,
  };
}

export function resolveEffectiveProductionStatusByServiceId(
  env: EffectiveDiscoveryEnv | undefined,
  hasDb: boolean
): Partial<Record<SiteborneServiceId, boolean>> {
  const result: Partial<Record<SiteborneServiceId, boolean>> = {};
  for (const serviceId of Object.keys(EFFECTIVE_DISCOVERY_RESOLVERS) as SiteborneServiceId[]) {
    result[serviceId] = resolveEffectiveServiceRuntimeStatus(
      serviceId,
      env,
      hasDb
    ).productionEnabled;
  }
  return result;
}

/**
 * Narrow, transport-agnostic account lookup shape retained exclusively for an
 * explicitly authorized release qualification/preflight. It is not wired into
 * normal request handling. Callers control the transport policy; this module
 * adds no retries, analytics, signing, or transaction behavior.
 */
export interface CdpAccountLookupClient {
  evm: {
    getAccount(options: { address: `0x${string}` }): Promise<{ address: string }>;
  };
}

/**
 * Builds the separately-invoked authenticated seller membership assertion.
 * Keeping this pure boundary preserves the historical governance check while
 * removing it from anonymous pre-402 route construction. The high-level CDP
 * SDK factory is intentionally absent: any future live use must provide a
 * separately reviewed deterministic transport.
 */
export function buildCdpSellerAddressLookup(
  createClient: () => CdpAccountLookupClient,
  sellerWalletAddress: string
): () => Promise<string> {
  return async () => {
    const address = resolveGovernedSellerAddress(sellerWalletAddress);
    const account = await createClient().evm.getAccount({ address });
    assertSellerIdentityConsistent({
      configuredAddress: address,
      authenticatedAddress: account.address,
    });
    return account.address;
  };
}

export interface ProductionCdpProviderDependencies {
  /** Constructs the real facilitator client. Injectable so tests supply a
   * mock `HTTPFacilitatorClient` and the real live request path supplies
   * the real `createCdpFacilitatorClient` from `@coinbase/cdp-sdk/x402`.
   * Construction itself makes no network call (confirmed: the accepted
   * SUN-0700B checkpoint 1 live-proof harness constructs it in
   * `beforeAll`, before any credential validation step) — only
   * `.verify()`/`.settle()` do. */
  createFacilitatorClient: () => HTTPFacilitatorClient;
}

export interface ResolvedCdpEvidence {
  evidenceMode: PaymentEvidenceMode;
  evidenceProvider?: PaymentEvidenceProvider;
}

/**
 * The single provider-construction boundary (§5 of the checkpoint B
 * directive). Returns `{evidenceMode: 'fixture'}` — the existing,
 * always-safe default — unless EVERY one of the following holds:
 *   1. `isProductionPaymentAuthorized(authorization)` is true (all four
 *      ADR 0055 gates);
 *   2. every required production secret is present
 *      (`checkProductionBindingsPresent`);
 *   3. the governed `SELLER_WALLET_ADDRESS` passes deterministic local
 *      EVM syntax/checksum validation (`resolveGovernedSellerAddress`).
 * Only then does it construct a real `CdpPaymentEvidenceProvider` —
 * never eagerly, never at Worker startup, only inside this function, only
 * on this exact success path. Any failure anywhere falls back to fixture
 * mode rather than throwing — the same fail-closed shape as every other
 * gate in this system (an unauthorized/misconfigured request still gets a
 * normal, safe, non-economic answer, never a 500 that could be mistaken
 * for a provider defect).
 */
export async function resolveProductionCdpEvidenceProvider(
  authorization: ProductionAuthorizationInput,
  bindings: ProductionCdpProviderBindings,
  deps: ProductionCdpProviderDependencies
): Promise<ResolvedCdpEvidence> {
  if (!isProductionPaymentAuthorized(authorization)) {
    return { evidenceMode: 'fixture' };
  }
  const bindingsCheck = checkProductionBindingsPresent(bindings);
  if (!bindingsCheck.ok) {
    return { evidenceMode: 'fixture' };
  }
  try {
    resolveGovernedSellerAddress(bindings.SELLER_WALLET_ADDRESS);
  } catch {
    return { evidenceMode: 'fixture' };
  }
  const facilitator = deps.createFacilitatorClient();
  return {
    evidenceMode: 'production',
    evidenceProvider: new CdpPaymentEvidenceProvider(facilitator),
  };
}
