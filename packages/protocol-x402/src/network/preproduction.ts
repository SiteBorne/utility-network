/**
 * SUN-1000 checkpoint 1O-A — the single canonical preproduction/production
 * network source of truth for every first-party CDP-rail payment
 * declaration in this repository (payment-executing routes, Bazaar
 * discovery metadata, MCP quote metadata).
 *
 * Root cause this module closes: `apps/edge-api/src/control-plane/routes/
 * paid-services.ts` hardcoded `eip155:8453` (Base **mainnet**) in its CDP
 * route declarations since the very first v1 wiring commit
 * (`e363128`, "feat(x402): wire local paid service http flow") —
 * `PREEXISTING_V1_MAINNET_DEFAULT`, carried forward unchanged into v2's
 * `v2CdpRoute()` under the accepted `SAME_ECONOMICS_NEW_SERVICE_MAJOR`
 * policy (checkpoint 1L). This was never caught by any accepted live-proof
 * checkpoint because the ONLY test file that has ever called a real CDP
 * facilitator (`apps/edge-api/tests/live/x402-live-exact.test.ts`,
 * SUN-0700B checkpoint 1) deliberately mounts its own parallel route with
 * its own hardcoded `eip155:84532` constant specifically to avoid
 * `paid-services.ts`'s "mainnet-labeled placeholder wiring" — its own
 * module comment says so explicitly. The live-proof harness worked around
 * the defect instead of the defect being fixed at its source.
 *
 * `docs/decisions/0054-buyer-surface-specific-payment-rails.md` confirms
 * the project's own frozen intent: "SITEBORNE already has accepted
 * CDP-backed Base Sepolia `exact` and `upto`" — Base Sepolia, not Base
 * mainnet, is and has always been the accepted preproduction network.
 *
 * No contract-schema axis is affected by this correction: every frozen
 * release's `schemas/common/money.schema.json`'s `network`/
 * `payment_network` fields are `type: string` with only a generic
 * `pattern: "^[a-z0-9-]+$"` constraint — no enum pins a specific chain
 * value anywhere in the frozen, versioned contract surface. This is a
 * pure runtime/application correction, not a contract release event.
 */
import type { Network } from '@x402/core/types';

/** Base Sepolia — the only network any first-party payment-executing
 * route, Bazaar discovery declaration, or MCP/A2A quote may declare while
 * `production_ready`/`production_enabled` are `false` (true everywhere in
 * this repository today). */
export const PREPRODUCTION_NETWORK: Network = 'eip155:84532';

/** Base mainnet — defined here only for documentation, testing, and the
 * mainnet fail-closed guard below. No first-party call site currently
 * has, or is intended to have, any parameter or code path that resolves
 * to this value — introducing one is a deliberate, separate, future
 * production-authorization decision, not a side effect of this module. */
export const PRODUCTION_NETWORK: Network = 'eip155:8453';

/**
 * The mainnet fail-closed guard (directive §8): throws if a candidate
 * network is `PRODUCTION_NETWORK` unless the caller passes the explicit,
 * separate `productionNetworkAuthorized: true` flag — which nothing in
 * this repository currently sets. Every payment-executing/discovery/
 * metadata call site should route its network value through this
 * assertion (directly or by construction, since they only ever pass
 * `PREPRODUCTION_NETWORK`) so a future accidental reintroduction of
 * `eip155:8453` fails a real assertion instead of silently shipping.
 */
export function assertPreproductionNetwork(
  network: Network,
  productionNetworkAuthorized = false
): void {
  if (network === PRODUCTION_NETWORK && !productionNetworkAuthorized) {
    throw new Error(
      `preproduction_mainnet_guard: network "${network}" (Base mainnet) requires explicit ` +
        'productionNetworkAuthorized=true; no first-party caller sets this today. ' +
        'See packages/protocol-x402/src/network/preproduction.ts.'
    );
  }
}

/**
 * SUN-1200 checkpoint A — the credential-independent half of the
 * production-payment authorization gate (ADR 0055). This module never
 * reads environment variables or secrets itself (unchanged boundary); the
 * caller (apps/edge-api's own config layer) resolves each of these four
 * booleans from real env/secret state and passes them in here as plain
 * data. ADR 0055 itself authorizes only the governance MECHANISM that a
 * bounded, human-authorized bootstrap exception can exist — it does not
 * itself set any of these four booleans true for any specific future
 * mutation; each must be independently, explicitly true at the call site.
 */
export type PaymentEnvironment = 'preproduction' | 'production';

export interface ProductionAuthorizationInput {
  /** Explicit environment selector — never inferred from hostname,
   * `NODE_ENV`, Cloudflare `ENVIRONMENT`, deployment name, or the
   * presence of secrets/wallet addresses. */
  environment: PaymentEnvironment;
  /** The standing, deliberately-set kill switch. `false` (the default
   * everywhere today) makes production economically unreachable
   * regardless of every other flag. */
  productionEnabled: boolean;
  /** ADR 0055's per-action human authorization — true only for a
   * specific, bounded, explicitly-authorized bootstrap action, never a
   * standing configuration value left on indefinitely. */
  humanBootstrapAuthorized: boolean;
  /** Separate from `productionEnabled`: whether the CDP credentials
   * currently configured have been explicitly approved for MAINNET use.
   * Previously-exposed sandbox/testnet credentials never automatically
   * satisfy this — it requires its own future, explicit
   * credential-provisioning decision. */
  productionCredentialsApproved: boolean;
}

/** The single runtime answer to "is production economic execution
 * permitted right now" — every one of the four inputs must be true
 * simultaneously; none may substitute for another. */
export function isProductionPaymentAuthorized(input: ProductionAuthorizationInput): boolean {
  return (
    input.environment === 'production' &&
    input.productionEnabled === true &&
    input.humanBootstrapAuthorized === true &&
    input.productionCredentialsApproved === true
  );
}

/**
 * The single canonical network resolver. Replaces every previously
 * unconditional `PREPRODUCTION_NETWORK` call site in this repository.
 * Returns `PRODUCTION_NETWORK` only when `isProductionPaymentAuthorized`
 * is true for the given input; otherwise always `PREPRODUCTION_NETWORK`,
 * fail-closed. Still routes through `assertPreproductionNetwork` even in
 * the unauthorized branch, for defense in depth.
 */
export function resolvePaymentNetwork(input: ProductionAuthorizationInput): Network {
  if (isProductionPaymentAuthorized(input)) {
    return PRODUCTION_NETWORK;
  }
  const network = PREPRODUCTION_NETWORK;
  assertPreproductionNetwork(network);
  return network;
}

/**
 * Asset resolution (`resolvePaymentAsset`/`assertNetworkAssetConsistency`)
 * deliberately lives in `apps/edge-api`'s own production-payment config
 * layer, not here — this package depends only on `@x402/core`/
 * `@x402/extensions`, never `@x402/evm` (the EVM-specific asset-table
 * package), matching its existing minimal-dependency boundary. Network
 * and authorization resolution (above) is protocol-agnostic; asset-table
 * lookups are not.
 */
