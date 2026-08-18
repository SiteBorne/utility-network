/**
 * SUN-1200 checkpoint D — the real, read-only on-chain transaction-receipt
 * checker satisfying `X402ServiceRouteConfig.cdpChainReceiptChecker`
 * (`packages/protocol-x402`-adjacent seam introduced in checkpoint C, left
 * unwired there). Uses `viem` — already a real, declared `apps/edge-api`
 * dependency (transitively required by `@x402/evm`/`@coinbase/cdp-sdk`),
 * so wiring it here adds no new Trivy-scanned dependency surface, matching
 * the same reasoning checkpoint B recorded for `@coinbase/cdp-sdk` itself.
 *
 * Read-only by construction: this file calls exactly one viem client
 * method, `getTransactionReceipt`, on an already-mined transaction hash.
 * It never signs, sends a transaction, or touches any private key/wallet
 * material — there is no credential input to this file at all, only a
 * public RPC URL (which is not secret; see `Env.BASE_RPC_URL`'s own doc
 * comment).
 */
import { createPublicClient, http } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { PREPRODUCTION_NETWORK, PRODUCTION_NETWORK, type Network } from '@siteborne/protocol-x402';

export type ChainReceiptResult = 'SETTLED' | 'FAILED' | 'STILL_UNKNOWN';

/** The minimal read-only surface this file needs from a viem
 * `PublicClient` — narrowed so a test can supply a mock without depending
 * on viem's full client shape (mirrors `CdpAccountLookupClient`'s own
 * narrowing pattern in `production-payment.ts`). */
export interface ChainReceiptClient {
  getTransactionReceipt(args: { hash: `0x${string}` }): Promise<{ status: 'success' | 'reverted' }>;
}

export interface ChainRpcConfig {
  /** Non-secret. Absent/undefined falls back to viem's own built-in
   * default public Base mainnet RPC. */
  productionRpcUrl?: string;
  /** Non-secret. Absent/undefined falls back to viem's own built-in
   * default public Base Sepolia RPC. */
  preproductionRpcUrl?: string;
}

const TRANSACTION_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

/** The real (not mocked, not a viem wrapper stub) production-capable
 * client factory: constructs a viem `PublicClient` scoped to exactly one
 * chain, using that chain's configured (or default public) RPC URL.
 * Construction itself makes no network call — viem's `createPublicClient`
 * is lazy, matching the same "construction ≠ network call" property this
 * checkpoint already relies on for `createCdpFacilitatorClient` and
 * `CdpClient`. */
export function createViemChainReceiptClient(
  network: Network,
  rpcConfig: ChainRpcConfig
): ChainReceiptClient | undefined {
  if (network === PRODUCTION_NETWORK) {
    return createPublicClient({ chain: base, transport: http(rpcConfig.productionRpcUrl) });
  }
  if (network === PREPRODUCTION_NETWORK) {
    return createPublicClient({
      chain: baseSepolia,
      transport: http(rpcConfig.preproductionRpcUrl),
    });
  }
  // No other network is ever governed by this repository's payment
  // architecture (see `preproduction.ts`) — an unrecognized network value
  // here would mean a caller bypassed `resolvePaymentNetwork` entirely.
  // Refuse to guess a chain rather than silently defaulting to one.
  return undefined;
}

/**
 * Builds the real `cdpChainReceiptChecker` function
 * (`X402ServiceRouteConfig`'s own type). `createClient` is injected
 * (never constructed inside this function directly) so:
 *   - the live request path can supply `createViemChainReceiptClient`
 *     (real, production-capable, still makes zero network calls until the
 *     returned function is actually invoked during a genuine recovery);
 *   - deterministic tests can supply a `ChainReceiptClient`-shaped mock,
 *     with no real viem client or RPC endpoint involved at all.
 *
 * Classification (directive §7): a receipt is never `SETTLED` merely
 * because it exists — only `status === 'success'` (the chain's own
 * authoritative outcome, per the EIP-658 receipt status field viem
 * surfaces) counts. `status === 'reverted'` is a definitive on-chain
 * failure → `FAILED`. Every other outcome — the transaction not yet
 * mined, not found, a malformed/absent hash, or any transport failure
 * (timeout, RPC 5xx, network unavailable) — is `STILL_UNKNOWN` (directive
 * §8): RPC uncertainty is never silently upgraded into a definitive
 * `FAILED`, and a checker failure never manufactures a `SETTLED` either.
 */
export function buildCdpChainReceiptChecker(
  createClient: (network: Network) => ChainReceiptClient | undefined
): (transactionReference: string, network: Network) => Promise<ChainReceiptResult> {
  return async (transactionReference, network) => {
    if (!TRANSACTION_HASH_PATTERN.test(transactionReference)) {
      return 'STILL_UNKNOWN';
    }
    const client = createClient(network);
    if (!client) {
      return 'STILL_UNKNOWN';
    }
    try {
      const receipt = await client.getTransactionReceipt({
        hash: transactionReference as `0x${string}`,
      });
      if (receipt.status === 'success') return 'SETTLED';
      if (receipt.status === 'reverted') return 'FAILED';
      return 'STILL_UNKNOWN';
    } catch {
      // Not found (not yet mined / never broadcast), transport timeout,
      // RPC 5xx, malformed response -- all genuinely inconclusive, never
      // treated as a definitive failure.
      return 'STILL_UNKNOWN';
    }
  };
}

/** The real, non-injected convenience wired into `index.ts`'s live
 * request path: pairs `createViemChainReceiptClient` with a given
 * `ChainRpcConfig` (read from `Env` at the call site, never inside this
 * file). Constructing this checker makes no network call — only invoking
 * the returned function (which only ever happens from inside
 * `attemptCdpRecovery`'s own optional chain-check branch during a
 * genuine ambiguous CDP settlement, itself unreachable in fixture mode)
 * does. */
export function buildProductionCdpChainReceiptChecker(
  rpcConfig: ChainRpcConfig
): (transactionReference: string, network: Network) => Promise<ChainReceiptResult> {
  return buildCdpChainReceiptChecker((network) => createViemChainReceiptClient(network, rpcConfig));
}
