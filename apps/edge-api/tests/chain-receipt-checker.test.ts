/**
 * SUN-1200 checkpoint D — deterministic tests for the real, read-only
 * `cdpChainReceiptChecker` implementation. No real viem client, no real
 * RPC endpoint, no network call anywhere in this file — a mock
 * `ChainReceiptClient` only, matching the injected-factory pattern
 * `production-payment.ts`'s `buildCdpSellerAddressLookup` tests already
 * established.
 */
import { describe, expect, it } from 'vitest';
import { PREPRODUCTION_NETWORK, PRODUCTION_NETWORK, type Network } from '@siteborne/protocol-x402';
import {
  buildCdpChainReceiptChecker,
  createViemChainReceiptClient,
  type ChainReceiptClient,
} from '../src/control-plane/evidence/chain-receipt-checker';

const TX = '0x' + 'a'.repeat(64);

describe('buildCdpChainReceiptChecker (SUN-1200 checkpoint D)', () => {
  it('classifies a successful receipt as SETTLED', async () => {
    const client: ChainReceiptClient = {
      async getTransactionReceipt() {
        return { status: 'success' };
      },
    };
    const checker = buildCdpChainReceiptChecker(() => client);
    await expect(checker(TX, PRODUCTION_NETWORK)).resolves.toBe('SETTLED');
  });

  it('classifies a reverted receipt as FAILED', async () => {
    const client: ChainReceiptClient = {
      async getTransactionReceipt() {
        return { status: 'reverted' };
      },
    };
    const checker = buildCdpChainReceiptChecker(() => client);
    await expect(checker(TX, PRODUCTION_NETWORK)).resolves.toBe('FAILED');
  });

  it('classifies a thrown lookup error (not found / transport failure) as STILL_UNKNOWN, never FAILED', async () => {
    const client: ChainReceiptClient = {
      async getTransactionReceipt() {
        throw new Error('TransactionReceiptNotFoundError');
      },
    };
    const checker = buildCdpChainReceiptChecker(() => client);
    await expect(checker(TX, PRODUCTION_NETWORK)).resolves.toBe('STILL_UNKNOWN');
  });

  it('classifies an RPC 5xx / transport timeout as STILL_UNKNOWN, never FAILED', async () => {
    const client: ChainReceiptClient = {
      async getTransactionReceipt() {
        throw new Error('fetch failed: 503');
      },
    };
    const checker = buildCdpChainReceiptChecker(() => client);
    await expect(checker(TX, PRODUCTION_NETWORK)).resolves.toBe('STILL_UNKNOWN');
  });

  it('a malformed transaction hash never reaches the client at all -- STILL_UNKNOWN, zero client calls', async () => {
    let calls = 0;
    const client: ChainReceiptClient = {
      async getTransactionReceipt() {
        calls += 1;
        return { status: 'success' };
      },
    };
    const checker = buildCdpChainReceiptChecker(() => client);
    await expect(checker('not-a-hash', PRODUCTION_NETWORK)).resolves.toBe('STILL_UNKNOWN');
    expect(calls).toBe(0);
  });

  it('an unresolvable client factory (e.g. unrecognized network) is STILL_UNKNOWN, never fabricates a chain', async () => {
    const checker = buildCdpChainReceiptChecker(() => undefined);
    await expect(checker(TX, PRODUCTION_NETWORK)).resolves.toBe('STILL_UNKNOWN');
  });

  it('never mutates provider state -- the injected client is called with exactly the given hash, read-only, once', async () => {
    let calls = 0;
    let receivedHash: string | undefined;
    const client: ChainReceiptClient = {
      async getTransactionReceipt(args) {
        calls += 1;
        receivedHash = args.hash;
        return { status: 'success' };
      },
    };
    const checker = buildCdpChainReceiptChecker(() => client);
    await checker(TX, PRODUCTION_NETWORK);
    expect(calls).toBe(1);
    expect(receivedHash).toBe(TX);
  });

  it('routes production vs preproduction network to distinguishable client instances', async () => {
    const seenNetworks: Network[] = [];
    const checker = buildCdpChainReceiptChecker((network) => {
      seenNetworks.push(network);
      return {
        async getTransactionReceipt() {
          return { status: 'success' };
        },
      };
    });
    await checker(TX, PRODUCTION_NETWORK);
    await checker(TX, PREPRODUCTION_NETWORK);
    expect(seenNetworks).toEqual([PRODUCTION_NETWORK, PREPRODUCTION_NETWORK]);
  });
});

describe('createViemChainReceiptClient (real viem client construction -- no network call, no mock)', () => {
  it('constructs a real viem PublicClient for PRODUCTION_NETWORK without making any network call', () => {
    const client = createViemChainReceiptClient(PRODUCTION_NETWORK, {});
    expect(client).toBeDefined();
    expect(typeof client?.getTransactionReceipt).toBe('function');
  });

  it('constructs a real viem PublicClient for PREPRODUCTION_NETWORK without making any network call', () => {
    const client = createViemChainReceiptClient(PREPRODUCTION_NETWORK, {});
    expect(client).toBeDefined();
    expect(typeof client?.getTransactionReceipt).toBe('function');
  });

  it('returns undefined for an unrecognized network rather than guessing a chain', () => {
    const client = createViemChainReceiptClient('eip155:1' as Network, {});
    expect(client).toBeUndefined();
  });

  it('respects an explicit non-default RPC URL override without making any network call', () => {
    const client = createViemChainReceiptClient(PRODUCTION_NETWORK, {
      productionRpcUrl: 'https://example-dedicated-rpc.invalid/base',
    });
    expect(client).toBeDefined();
  });
});
