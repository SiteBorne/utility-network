/**
 * SUN-1214 checkpoint T — production route composition for
 * verify_agent_output.v2 / CDP. Fail-closed config assembly, never
 * mutation of the real production entrypoint.
 */
import { describe, expect, it } from 'vitest';
import { buildVerifyAgentOutputV2CdpProductionRouteConfig } from './verify-agent-output-v2-cdp-composition';

function randomPrivateKeyHex(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fakeDb() {
  // A minimal stand-in -- this test never issues a query, it only
  // proves config assembly/fail-closed behavior.
  return {} as unknown as import('@cloudflare/workers-types').D1Database;
}

function fullEnv() {
  return {
    PAID_RECEIPT_SIGNING_PRIVATE_KEY: randomPrivateKeyHex(),
    PAID_RECEIPT_SIGNING_KEY_ID: 'kid_prod0123456789abcdefghij',
    SELLER_WALLET_ADDRESS: '0x' + '1'.repeat(40),
    CDP_API_KEY_ID: 'test-cdp-key-id',
    CDP_API_KEY_SECRET: 'test-cdp-key-secret',
    PAYMENT_ENVIRONMENT: undefined,
    PRODUCTION_ENABLED: undefined,
    HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP: undefined,
    PRODUCTION_CDP_CREDENTIALS_APPROVED: undefined,
  };
}

describe('buildVerifyAgentOutputV2CdpProductionRouteConfig', () => {
  it('assembles a well-formed X402ServiceRouteConfig when every dependency is present', async () => {
    const result = await buildVerifyAgentOutputV2CdpProductionRouteConfig(fullEnv(), fakeDb());
    expect('unavailable' in result).toBe(false);
    if ('unavailable' in result) throw new Error('unreachable');
    expect(result.serviceId).toBe('verify_agent_output.v2');
    expect(result.path).toBe('/v2/verify/agent-output');
    expect(result.pricingKey).toBe('verify_agent_output_standard');
    expect(result.contractRelease).toBe('2.0.0');
    expect(result.pccDependency).toBe('1.1.0');
    expect(typeof result.executor).toBe('function');
    expect(result.evidenceMode).toBe('fixture'); // getAuthenticatedSellerAddress is never
    // supplied anywhere in this repository today (a deliberate, pre-existing,
    // separate external blocker -- see the closure report) -- resolution
    // always falls back to fixture mode regardless of secret presence.
  });

  it('returns unavailable, never throws, when the signing key is missing', async () => {
    const env = fullEnv();
    env.PAID_RECEIPT_SIGNING_PRIVATE_KEY = '';
    const result = await buildVerifyAgentOutputV2CdpProductionRouteConfig(env, fakeDb());
    expect('unavailable' in result).toBe(true);
  });

  it('returns unavailable when the signing key ID is missing', async () => {
    const env = fullEnv();
    env.PAID_RECEIPT_SIGNING_KEY_ID = '';
    const result = await buildVerifyAgentOutputV2CdpProductionRouteConfig(env, fakeDb());
    expect('unavailable' in result).toBe(true);
  });

  it('returns unavailable when the signing key is malformed', async () => {
    const env = fullEnv();
    env.PAID_RECEIPT_SIGNING_PRIVATE_KEY = 'not-hex';
    const result = await buildVerifyAgentOutputV2CdpProductionRouteConfig(env, fakeDb());
    expect('unavailable' in result).toBe(true);
  });

  it('returns unavailable when no D1 database is supplied', async () => {
    const result = await buildVerifyAgentOutputV2CdpProductionRouteConfig(
      fullEnv(),
      undefined as unknown as import('@cloudflare/workers-types').D1Database
    );
    expect('unavailable' in result).toBe(true);
  });

  it('never falls back to a fixture signer on any failure path', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const source = fs.readFileSync(
      path.join(import.meta.dirname, 'verify-agent-output-v2-cdp-composition.ts'),
      'utf-8'
    );
    const importLines = source
      .split('\n')
      .filter((line) => /^\s*import\b/.test(line))
      .join('\n');
    expect(importLines).not.toMatch(/createFixtureSigner/);
    expect(importLines).not.toMatch(/buildFixtureRegistry/);
  });
});
