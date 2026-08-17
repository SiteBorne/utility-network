/**
 * SUN-1000 checkpoint 1O-A — self-tests for the Nevermined credential
 * naming reconciliation in `apps/edge-api/src/control-plane/config/
 * env.ts`. Before this checkpoint, `Env`/`validateProductionBindings`
 * referenced only the deprecated `NEVERMINED_API_KEY` name -- a genuine
 * regression versus `packages/protocol-nevermined/src/config.ts`'s
 * already-correct `resolveNeverminedConfig` boundary, which has always
 * treated `NVM_API_KEY` as canonical and `NEVERMINED_API_KEY` as a
 * deprecated alias. These tests prove `validateProductionBindings`
 * (called only when `ENVIRONMENT === 'production'`) now accepts either
 * name, and still fails closed when neither is present.
 */
import { describe, expect, it } from 'vitest';
import { createControlPlaneConfig, type Env } from '../src/control-plane/config/env';

function baseEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as Env['DB'],
    ARTIFACTS: {} as Env['ARTIFACTS'],
    JOBS: {} as Env['JOBS'],
    EVENTS: {} as Env['EVENTS'],
    CATALOG: {} as Env['CATALOG'],
    AI: {} as Env['AI'],
    BROWSER: {} as Env['BROWSER'],
    ENVIRONMENT: 'production',
    LOG_LEVEL: 'info',
    PCC_VERSION: '1.0.0',
    SELLER_WALLET_ADDRESS: '0x' + '1'.repeat(40),
    CDP_API_KEY_ID: 'cdp-key-id',
    CDP_API_KEY_SECRET: 'cdp-key-secret',
    CDP_WALLET_SECRET: 'cdp-wallet-secret',
    VOYAGE_API_KEY: 'voyage-key',
    MODAL_TOKEN_ID: 'modal-token-id',
    MODAL_TOKEN_SECRET: 'modal-token-secret',
    SENTRY_DSN: 'https://example.invalid/sentry',
    ...overrides,
  };
}

describe('validateProductionBindings — Nevermined credential naming', () => {
  it('accepts the canonical NVM_API_KEY alone', () => {
    const env = baseEnv({ NVM_API_KEY: 'nvm-key', NVM_ENVIRONMENT: 'sandbox' });
    expect(() => createControlPlaneConfig(env)).not.toThrow();
  });

  it('accepts the deprecated NEVERMINED_API_KEY alias alone', () => {
    const env = baseEnv({ NEVERMINED_API_KEY: 'nvm-key', NVM_ENVIRONMENT: 'sandbox' });
    expect(() => createControlPlaneConfig(env)).not.toThrow();
  });

  it('accepts both names set to the same value', () => {
    const env = baseEnv({
      NVM_API_KEY: 'nvm-key',
      NEVERMINED_API_KEY: 'nvm-key',
      NVM_ENVIRONMENT: 'sandbox',
    });
    expect(() => createControlPlaneConfig(env)).not.toThrow();
  });

  it('fails closed when neither NVM_API_KEY nor NEVERMINED_API_KEY is present', () => {
    const env = baseEnv();
    expect(() => createControlPlaneConfig(env)).toThrow(/NVM_API_KEY/);
  });

  it('does not require a new credential under the stale NEVERMINED_API_KEY name merely because the alias is deprecated', () => {
    // NVM_API_KEY alone is fully sufficient -- no requirement to also set
    // the deprecated alias.
    const env = baseEnv({ NVM_API_KEY: 'nvm-key', NVM_ENVIRONMENT: 'sandbox' });
    expect(() => createControlPlaneConfig(env)).not.toThrow();
  });
});
