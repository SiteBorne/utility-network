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
import { CdpClient } from '@coinbase/cdp-sdk';
import {
  isProductionPaymentAuthorized,
  type PaymentEvidenceMode,
  type PaymentEvidenceProvider,
  type ProductionAuthorizationInput,
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
 * Presence-only check (never reads, logs, or returns secret VALUES) for
 * the production-payment-specific secrets. Distinct from this same
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
 * and DELETE endpoints in the EVM and Solana Account APIs" — the
 * seller-identity operation this repository performs,
 * `evm.getAccount(...)`, is a read (GET), never a POST/DELETE write.
 * Neither of this repository's two real CDP SDK call sites needs it.
 * `CdpAccountLookupClient`/`buildProductionCdpAccountLookupClientFactory`
 * still accept an optional wallet secret (the SDK itself still allows
 * one to be supplied) — this checkpoint stops *requiring* it, it does
 * not forbid a caller from ever providing one. */
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

/** Separates "configured seller public address" (`SELLER_WALLET_ADDRESS`,
 * a Cloudflare secret) from "authenticated CDP wallet/account identity"
 * (what a real CDP client resolves once given real credentials).
 * Production authorization must require these to match before any
 * economic execution. No real CDP wallet client is constructed by this
 * checkpoint; `authenticatedAddress` is supplied by the caller — a real
 * CDP client in a future credential-provisioning checkpoint, a mock in
 * this checkpoint's own deterministic tests. */
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
 * SUN-1200 checkpoint C — seller-identity architecture decision.
 *
 * Three options were on the table: (A) require the seller to be a
 * CDP-managed wallet, authenticated via the CDP SDK itself, checked
 * against `SELLER_WALLET_ADDRESS`; (B) allow an arbitrary external EVM
 * seller address with no CDP-side authentication at all; (C) leave the
 * question ambiguous/deferred.
 *
 * This repository already, unambiguously chose (A) in checkpoint A/B:
 * `ProductionCdpProviderDependencies.getAuthenticatedSellerAddress`
 * exists specifically to be resolved from an authenticated CDP identity
 * (its own doc comment: "what a real CDP client resolves once given
 * real credentials"), and `resolveProductionCdpEvidenceProvider` already
 * fails closed to fixture mode unless that hook is both supplied AND its
 * result matches `SELLER_WALLET_ADDRESS`
 * (`assertSellerIdentityConsistent`). There is no code path anywhere in
 * this repository that accepts an external, CDP-unauthenticated EVM
 * seller — (B) was never built and is not being introduced now. This
 * checkpoint completes (A) by providing the real implementation of that
 * already-decided hook, rather than re-opening the architecture
 * question.
 *
 * `CdpAccountLookupClient` is the minimal read-only surface this
 * repository needs from `@coinbase/cdp-sdk`'s `CdpClient.evm.getAccount`
 * — narrowed to exactly the one call this boundary makes, so a test can
 * supply a mock without depending on the real SDK's full client shape.
 * Real construction (`new CdpClient({...})` with real credentials) is
 * the caller's job (a future credential-provisioning checkpoint's
 * `index.ts` wiring) — this file never imports `@coinbase/cdp-sdk`
 * itself, preserving the credential-independent package boundary this
 * file already documents at its own top.
 */
export interface CdpAccountLookupClient {
  evm: {
    getAccount(options: { address: `0x${string}` }): Promise<{ address: string }>;
  };
}

/**
 * The real (not fixture, not a stub) implementation of
 * `getAuthenticatedSellerAddress`: asks a CDP client to resolve the
 * account at the configured `SELLER_WALLET_ADDRESS` and returns the
 * address the CDP API itself confirms for that account. Read-only — a
 * wallet lookup, never a transaction, never a signature. `createClient`
 * is injected (never constructed here) so this function makes no
 * decision about credentials or network access itself; a caller that
 * never invokes it (every caller in this repository today) never
 * triggers a CDP API call at all — this checkpoint proves the function
 * against `CdpAccountLookupClientMock`-shaped test doubles only, and it
 * is not wired into `index.ts`'s live request path, matching the
 * seller-identity hook's existing disclosed-unwired pattern (`index.ts`
 * still passes no `getAuthenticatedSellerAddress` at all, so production
 * evidence-provider construction continues to fail closed to fixture
 * mode regardless of every other flag, exactly as before this
 * checkpoint).
 */
const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export function buildCdpSellerAddressLookup(
  createClient: () => CdpAccountLookupClient,
  sellerWalletAddress: string
): () => Promise<string> {
  return async () => {
    if (!EVM_ADDRESS_PATTERN.test(sellerWalletAddress)) {
      // Malformed configuration -- refuse to even attempt the lookup
      // rather than passing an unvalidated string into the CDP SDK.
      // Propagates to `resolveProductionCdpEvidenceProvider`'s existing
      // try/catch, which fails closed to fixture mode exactly like every
      // other lookup failure.
      throw new Error('seller_wallet_address_malformed');
    }
    const client = createClient();
    const account = await client.evm.getAccount({
      address: sellerWalletAddress as `0x${string}`,
    });
    return account.address;
  };
}

/**
 * SUN-1200 checkpoint D — the real (not stubbed) production client
 * factory for `buildCdpSellerAddressLookup`'s `createClient` parameter.
 * Constructs a real `@coinbase/cdp-sdk` `CdpClient` from real credential
 * bindings — but only inside the closure this function returns, never
 * eagerly: calling `buildProductionCdpAccountLookupClientFactory(...)`
 * itself makes no network call and constructs nothing; only invoking the
 * returned factory (which only happens inside
 * `buildCdpSellerAddressLookup`'s own closure, which itself only runs
 * once `resolveProductionCdpEvidenceProvider` has already confirmed every
 * ADR 0055 gate and required binding) constructs the client, and even
 * that construction makes no network call on its own — `CdpClient`'s own
 * constructor does no I/O (matches the same "construction ≠ network
 * call" property already confirmed and relied on for
 * `createCdpFacilitatorClient` in checkpoint A/B).
 */
export function buildProductionCdpAccountLookupClientFactory(
  bindings: Pick<Env, 'CDP_API_KEY_ID' | 'CDP_API_KEY_SECRET'>
): () => CdpAccountLookupClient {
  return () =>
    new CdpClient({
      apiKeyId: bindings.CDP_API_KEY_ID,
      apiKeySecret: bindings.CDP_API_KEY_SECRET,
      // Deliberately no `walletSecret` -- see this file's own
      // `checkProductionBindingsPresent` doc comment for the full
      // reconciliation. `evm.getAccount(...)` is a read-only GET; the SDK
      // only requires the Wallet Secret for POST/DELETE Account-API
      // writes, which this repository never performs.
    });
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
  /** Resolves the authenticated CDP wallet's public address. SUN-1200
   * checkpoint B deliberately wires NO real implementation of this hook
   * into the live request path — omitting it (the default everywhere
   * today) fails closed to fixture mode exactly like every other missing
   * gate, regardless of every other flag. A real implementation is a
   * separate, future credential-provisioning checkpoint's job. */
  getAuthenticatedSellerAddress?: () => Promise<string>;
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
 *   3. `deps.getAuthenticatedSellerAddress` is supplied and resolves
 *      without throwing;
 *   4. the resolved authenticated address matches the configured
 *      `SELLER_WALLET_ADDRESS` (`assertSellerIdentityConsistent`).
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
  if (!deps.getAuthenticatedSellerAddress) {
    return { evidenceMode: 'fixture' };
  }
  let authenticatedAddress: string;
  try {
    authenticatedAddress = await deps.getAuthenticatedSellerAddress();
  } catch {
    return { evidenceMode: 'fixture' };
  }
  try {
    assertSellerIdentityConsistent({
      configuredAddress: bindings.SELLER_WALLET_ADDRESS,
      authenticatedAddress,
    });
  } catch {
    return { evidenceMode: 'fixture' };
  }
  const facilitator = deps.createFacilitatorClient();
  return {
    evidenceMode: 'production',
    evidenceProvider: new CdpPaymentEvidenceProvider(facilitator),
  };
}
