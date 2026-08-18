/**
 * SUN-1200 checkpoint A (ADR 0055) — deterministic tests for the
 * production-payment authorization/network/asset/seller-identity gate.
 * No real provider call, no real CDP client, no economic mutation
 * anywhere in this file — mocks/test doubles only, exactly per the
 * checkpoint's own §21 instruction.
 */
import { describe, expect, it } from 'vitest';
import {
  PREPRODUCTION_NETWORK,
  PRODUCTION_NETWORK,
  isProductionPaymentAuthorized,
  type ProductionAuthorizationInput,
} from '@siteborne/protocol-x402';
import {
  assertNetworkAssetConsistency,
  assertSellerIdentityConsistent,
  checkProductionBindingsPresent,
  resolvePaymentAsset,
  resolvePaymentEnvironment,
  resolveProductionAuthorizationInput,
} from '../src/control-plane/config/production-payment';

describe('resolvePaymentEnvironment', () => {
  it('resolves the exact literal "production"', () => {
    expect(resolvePaymentEnvironment('production')).toBe('production');
  });

  it('fails closed to preproduction for undefined', () => {
    expect(resolvePaymentEnvironment(undefined)).toBe('preproduction');
  });

  it('fails closed to preproduction for empty string', () => {
    expect(resolvePaymentEnvironment('')).toBe('preproduction');
  });

  it('fails closed to preproduction for unexpected casing', () => {
    expect(resolvePaymentEnvironment('Production')).toBe('preproduction');
    expect(resolvePaymentEnvironment('PRODUCTION')).toBe('preproduction');
  });

  it('fails closed to preproduction for any other value', () => {
    expect(resolvePaymentEnvironment('staging')).toBe('preproduction');
    expect(resolvePaymentEnvironment('prod')).toBe('preproduction');
  });
});

describe('resolveProductionAuthorizationInput', () => {
  it('defaults every gate false when every env var is unset (real default env shape)', () => {
    const input = resolveProductionAuthorizationInput({
      PAYMENT_ENVIRONMENT: undefined,
      PRODUCTION_ENABLED: undefined,
      HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP: undefined,
      PRODUCTION_CDP_CREDENTIALS_APPROVED: undefined,
    });
    expect(input).toEqual<ProductionAuthorizationInput>({
      environment: 'preproduction',
      productionEnabled: false,
      humanBootstrapAuthorized: false,
      productionCredentialsApproved: false,
    });
    expect(isProductionPaymentAuthorized(input)).toBe(false);
  });

  it('resolves all four gates true only when every env var is the exact required literal', () => {
    const input = resolveProductionAuthorizationInput({
      PAYMENT_ENVIRONMENT: 'production',
      PRODUCTION_ENABLED: 'true',
      HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP: 'true',
      PRODUCTION_CDP_CREDENTIALS_APPROVED: 'true',
    });
    expect(isProductionPaymentAuthorized(input)).toBe(true);
  });

  it('a near-miss value (e.g. "1" instead of "true") fails closed', () => {
    const input = resolveProductionAuthorizationInput({
      PAYMENT_ENVIRONMENT: 'production',
      PRODUCTION_ENABLED: '1',
      HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP: 'true',
      PRODUCTION_CDP_CREDENTIALS_APPROVED: 'true',
    });
    expect(isProductionPaymentAuthorized(input)).toBe(false);
  });
});

describe('resolvePaymentAsset / assertNetworkAssetConsistency', () => {
  it('resolves the official Base Sepolia USDC address for the preproduction network', () => {
    const asset = resolvePaymentAsset(PREPRODUCTION_NETWORK);
    expect(asset.address).toBe('0x036CbD53842c5426634e7929541eC2318f3dCF7e');
    expect(asset.decimals).toBe(6);
  });

  it('resolves the official Base mainnet USDC address for the production network', () => {
    const asset = resolvePaymentAsset(PRODUCTION_NETWORK);
    expect(asset.address).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    expect(asset.decimals).toBe(6);
  });

  it('the two resolved asset addresses are distinct', () => {
    expect(resolvePaymentAsset(PREPRODUCTION_NETWORK).address).not.toBe(
      resolvePaymentAsset(PRODUCTION_NETWORK).address
    );
  });

  it('accepts a consistent network/asset pair', () => {
    const asset = resolvePaymentAsset(PRODUCTION_NETWORK);
    expect(() => assertNetworkAssetConsistency(PRODUCTION_NETWORK, asset.address)).not.toThrow();
  });

  it('mainnet negative control: production network + preproduction asset fails closed', () => {
    const preprodAsset = resolvePaymentAsset(PREPRODUCTION_NETWORK);
    expect(() => assertNetworkAssetConsistency(PRODUCTION_NETWORK, preprodAsset.address)).toThrow(
      /network_asset_mismatch/
    );
  });

  it('testnet negative control: preproduction network + production asset fails closed', () => {
    const prodAsset = resolvePaymentAsset(PRODUCTION_NETWORK);
    expect(() => assertNetworkAssetConsistency(PREPRODUCTION_NETWORK, prodAsset.address)).toThrow(
      /network_asset_mismatch/
    );
  });

  it('is case-insensitive on the address comparison', () => {
    const asset = resolvePaymentAsset(PRODUCTION_NETWORK);
    expect(() =>
      assertNetworkAssetConsistency(PRODUCTION_NETWORK, asset.address.toUpperCase())
    ).not.toThrow();
  });
});

describe('checkProductionBindingsPresent', () => {
  it('reports missing when every required secret is absent', () => {
    const result = checkProductionBindingsPresent({
      SELLER_WALLET_ADDRESS: '',
      CDP_API_KEY_ID: '',
      CDP_API_KEY_SECRET: '',
      CDP_WALLET_SECRET: '',
    });
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([
      'SELLER_WALLET_ADDRESS',
      'CDP_API_KEY_ID',
      'CDP_API_KEY_SECRET',
      'CDP_WALLET_SECRET',
    ]);
  });

  it('missing-credential control: reports exactly the missing subset', () => {
    const result = checkProductionBindingsPresent({
      SELLER_WALLET_ADDRESS: '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1',
      CDP_API_KEY_ID: 'present',
      CDP_API_KEY_SECRET: '',
      CDP_WALLET_SECRET: '',
    });
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(['CDP_API_KEY_SECRET', 'CDP_WALLET_SECRET']);
  });

  it('reports ok when every required secret is present', () => {
    const result = checkProductionBindingsPresent({
      SELLER_WALLET_ADDRESS: '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1',
      CDP_API_KEY_ID: 'present',
      CDP_API_KEY_SECRET: 'present',
      CDP_WALLET_SECRET: 'present',
    });
    expect(result).toEqual({ ok: true, missing: [] });
  });

  it('never includes a secret VALUE anywhere in its output, only field names', () => {
    const result = checkProductionBindingsPresent({
      SELLER_WALLET_ADDRESS: '',
      CDP_API_KEY_ID: 'super-secret-value-should-never-appear',
      CDP_API_KEY_SECRET: 'present',
      CDP_WALLET_SECRET: 'present',
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('super-secret-value-should-never-appear');
  });
});

describe('assertSellerIdentityConsistent', () => {
  const CONFIGURED = '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1';

  it('accepts a matching configured/authenticated address', () => {
    expect(() =>
      assertSellerIdentityConsistent({
        configuredAddress: CONFIGURED,
        authenticatedAddress: CONFIGURED,
      })
    ).not.toThrow();
  });

  it('is case-insensitive', () => {
    expect(() =>
      assertSellerIdentityConsistent({
        configuredAddress: CONFIGURED,
        authenticatedAddress: CONFIGURED.toLowerCase(),
      })
    ).not.toThrow();
  });

  it('seller-mismatch control: throws on a genuinely different authenticated address', () => {
    expect(() =>
      assertSellerIdentityConsistent({
        configuredAddress: CONFIGURED,
        authenticatedAddress: '0x0000000000000000000000000000000000dEaD',
      })
    ).toThrow(/seller_identity_mismatch/);
  });
});

describe('mock production positive construction (§21 — mocks only, no real provider call)', () => {
  it('with every gate deliberately true, the resolved network/asset/environment are exactly the governed production values', () => {
    const input: ProductionAuthorizationInput = {
      environment: 'production',
      productionEnabled: true,
      humanBootstrapAuthorized: true,
      productionCredentialsApproved: true,
    };
    expect(isProductionPaymentAuthorized(input)).toBe(true);

    const bindings = checkProductionBindingsPresent({
      SELLER_WALLET_ADDRESS: '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1',
      CDP_API_KEY_ID: 'mock-key-id',
      CDP_API_KEY_SECRET: 'mock-key-secret',
      CDP_WALLET_SECRET: 'mock-wallet-secret',
    });
    expect(bindings.ok).toBe(true);

    // A mock "authenticated CDP wallet identity" -- no real CdpClient
    // constructed anywhere in this test file.
    const mockAuthenticatedWalletAddress = '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1';
    expect(() =>
      assertSellerIdentityConsistent({
        configuredAddress: '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1',
        authenticatedAddress: mockAuthenticatedWalletAddress,
      })
    ).not.toThrow();

    const asset = resolvePaymentAsset(PRODUCTION_NETWORK);
    expect(asset.address).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    expect(() => assertNetworkAssetConsistency(PRODUCTION_NETWORK, asset.address)).not.toThrow();
  });
});
