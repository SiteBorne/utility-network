/**
 * SUN-1218 checkpoint X — proves the two real, structural outcomes the
 * production call site (no `explicitTestEvidenceOverride`) can now
 * produce: real production evidence when every ADR-0055 gate holds and
 * the seller-address lookup succeeds, and fail-closed `{unavailable}`
 * whenever real evidence cannot be established -- never a silent
 * fixture fallback.
 *
 * `buildProductionCdpAccountLookupClientFactory` is the ONLY thing
 * mocked here (module-boundary `vi.mock`, `importActual` for
 * everything else in `../config/production-payment`, which stays 100%
 * real and unmodified) -- this proves the composition's own new
 * wiring/fail-closed logic, not `buildCdpSellerAddressLookup`/
 * `resolveProductionCdpEvidenceProvider` themselves (already fully
 * proven by `apps/edge-api/tests/production-payment-gate.test.ts` since
 * SUN-1200 checkpoints C/D). No live CDP call occurs anywhere in this
 * file -- the mock never touches the real `@coinbase/cdp-sdk` import.
 */
import { describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import type * as ProductionPaymentModule from '../config/production-payment';
import type { CdpAccountLookupClient } from '../config/production-payment';

const SELLER = '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1';

vi.mock('../config/production-payment', async (importOriginal) => {
  const actual = await importOriginal<typeof ProductionPaymentModule>();
  return {
    ...actual,
    buildProductionCdpAccountLookupClientFactory: vi.fn(),
  };
});

// Imported AFTER the mock declaration so the mocked module graph is in
// effect (vitest hoists `vi.mock` above imports automatically, but the
// dynamic import pattern below makes the ordering explicit and avoids
// any ambiguity about which `buildProductionCdpAccountLookupClientFactory`
// binding the composition module resolves).
const { buildVerifyAgentOutputV2CdpProductionRouteConfig } = await import(
  './verify-agent-output-v2-cdp-composition'
);
const productionPaymentMocked = await import('../config/production-payment');

function fakeDb(): D1Database {
  return {} as unknown as D1Database;
}

function fullEnvWithAdr0055Authorized() {
  return {
    PAID_RECEIPT_SIGNING_PRIVATE_KEY: Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(''),
    PAID_RECEIPT_SIGNING_KEY_ID: 'kid_prod0123456789abcdefghij',
    SELLER_WALLET_ADDRESS: SELLER,
    CDP_API_KEY_ID: 'test-cdp-key-id',
    CDP_API_KEY_SECRET: 'test-cdp-key-secret',
    PAYMENT_ENVIRONMENT: 'production',
    PRODUCTION_ENABLED: 'true',
    HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP: 'true',
    PRODUCTION_CDP_CREDENTIALS_APPROVED: 'true',
  };
}

describe('SUN-1218: production evidence selection at the composition boundary (no explicitTestEvidenceOverride)', () => {
  it('every ADR-0055 gate true + real bindings + a successful mock seller-address lookup -> evidenceMode: production', async () => {
    const mockClient: CdpAccountLookupClient = {
      evm: {
        async getAccount(options) {
          expect(options).toEqual({ address: SELLER });
          return { address: SELLER };
        },
      },
    };
    vi.mocked(productionPaymentMocked.buildProductionCdpAccountLookupClientFactory).mockReturnValue(
      () => mockClient
    );

    const result = await buildVerifyAgentOutputV2CdpProductionRouteConfig(
      fullEnvWithAdr0055Authorized(),
      fakeDb()
    );
    expect('unavailable' in result).toBe(false);
    if ('unavailable' in result) throw new Error('unreachable');
    expect(result.evidenceMode).toBe('production');
  });

  it('every ADR-0055 gate true + real bindings + a FAILING mock seller-address lookup -> unavailable, never fixture (fail closed, pre-economic)', async () => {
    const mockClient: CdpAccountLookupClient = {
      evm: {
        async getAccount() {
          throw new Error('mock_cdp_account_not_found');
        },
      },
    };
    vi.mocked(productionPaymentMocked.buildProductionCdpAccountLookupClientFactory).mockReturnValue(
      () => mockClient
    );

    const result = await buildVerifyAgentOutputV2CdpProductionRouteConfig(
      fullEnvWithAdr0055Authorized(),
      fakeDb()
    );
    expect('unavailable' in result).toBe(true);
    if (!('unavailable' in result)) throw new Error('unreachable');
    expect(result.reason).toMatch(/production payment evidence unavailable/);
  });

  it('ADR-0055 gates NOT authorized (the real production default today) -> unavailable, the mock seller lookup is never even invoked', async () => {
    let invoked = false;
    const mockClient: CdpAccountLookupClient = {
      evm: {
        async getAccount() {
          invoked = true;
          return { address: SELLER };
        },
      },
    };
    vi.mocked(productionPaymentMocked.buildProductionCdpAccountLookupClientFactory).mockReturnValue(
      () => mockClient
    );

    const env = fullEnvWithAdr0055Authorized();
    env.PRODUCTION_CDP_CREDENTIALS_APPROVED = 'false';
    const result = await buildVerifyAgentOutputV2CdpProductionRouteConfig(env, fakeDb());
    expect('unavailable' in result).toBe(true);
    // gate #1 (isProductionPaymentAuthorized) short-circuits inside the
    // existing, unmodified resolveProductionCdpEvidenceProvider before
    // gate #3 (the seller-address lookup) is ever reached -- proving
    // this checkpoint's new fail-closed behavior does not, itself,
    // trigger any new CDP-adjacent call in the repository's real,
    // current, deliberately-unauthorized production default.
    expect(invoked).toBe(false);
  });
});
