/**
 * SUN-1218 checkpoint X — proves the two real, structural outcomes the
 * production call site (no `explicitTestEvidenceOverride`) can now
 * produce: real production evidence when every ADR-0055 gate holds and
 * the governed seller address passes local validation, and fail-closed `{unavailable}`
 * whenever real evidence cannot be established -- never a silent
 * fixture fallback.
 *
 * No account client is mocked or constructed: seller resolution is now the
 * deterministic local validation performed by the real
 * `resolveProductionCdpEvidenceProvider`. No live CDP call occurs.
 */
import { describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';

const SELLER = '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1';

const { buildVerifyAgentOutputV2CdpProductionRouteConfig } = await import(
  './verify-agent-output-v2-cdp-composition'
);

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
  it('every ADR-0055 gate true + real bindings + locally valid governed seller -> evidenceMode: production', async () => {
    const result = await buildVerifyAgentOutputV2CdpProductionRouteConfig(
      fullEnvWithAdr0055Authorized(),
      fakeDb()
    );
    expect('unavailable' in result).toBe(false);
    if ('unavailable' in result) throw new Error('unreachable');
    expect(result.evidenceMode).toBe('production');
  });

  it('every ADR-0055 gate true + real bindings + malformed seller -> unavailable, never fixture (fail closed, pre-economic)', async () => {
    const env = fullEnvWithAdr0055Authorized();
    env.SELLER_WALLET_ADDRESS = 'not-an-address';
    const result = await buildVerifyAgentOutputV2CdpProductionRouteConfig(env, fakeDb());
    expect('unavailable' in result).toBe(true);
    if (!('unavailable' in result)) throw new Error('unreachable');
    expect(result.reason).toMatch(/production payment evidence unavailable/);
  });

  it('ADR-0055 gates NOT authorized (the real production default today) -> unavailable before facilitator construction', async () => {
    const env = fullEnvWithAdr0055Authorized();
    env.PRODUCTION_CDP_CREDENTIALS_APPROVED = 'false';
    const result = await buildVerifyAgentOutputV2CdpProductionRouteConfig(env, fakeDb());
    expect('unavailable' in result).toBe(true);
  });
});
