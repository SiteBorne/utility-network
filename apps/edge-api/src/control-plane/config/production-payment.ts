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
import type { ProductionAuthorizationInput } from '@siteborne/protocol-x402';
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

/** Presence-only check (never reads, logs, or returns secret VALUES) for
 * the production-payment-specific secrets. Distinct from this same
 * file's neighbor `env.ts`'s existing `validateProductionBindings`
 * (defined but never wired into the live request path anywhere) — this
 * is the canonical equivalent this checkpoint wires for real. */
export function checkProductionBindingsPresent(
  env: Pick<
    Env,
    'SELLER_WALLET_ADDRESS' | 'CDP_API_KEY_ID' | 'CDP_API_KEY_SECRET' | 'CDP_WALLET_SECRET'
  >
): ProductionBindingsCheck {
  const required: Array<keyof typeof env> = [
    'SELLER_WALLET_ADDRESS',
    'CDP_API_KEY_ID',
    'CDP_API_KEY_SECRET',
    'CDP_WALLET_SECRET',
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
