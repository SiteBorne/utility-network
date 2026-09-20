/**
 * PRODUCTION-SECURITY-DECLARATIONS-01 -- checks that need edge-api or x402
 * runtime configuration, which `@siteborne/vcm` deliberately does not import.
 */
import { describe, expect, it } from 'vitest';
import { buildSecurityDeclarationV1 } from '@siteborne/vcm';
import {
  assertNetworkAssetConsistency,
  resolvePaymentAsset,
} from '../src/control-plane/config/production-payment';
import { resolveMtlsProductionActive } from '../src/control-plane/config/mtls-production-capability';

const d = buildSecurityDeclarationV1();

describe('declared economic network and asset match governed payment configuration', () => {
  it('Base mainnet resolves to USDC with the declared signing domain', () => {
    const asset = resolvePaymentAsset('eip155:8453');
    expect(asset.name).toBe('USD Coin');
    expect(asset.version).toBe('2');
    expect(asset.decimals).toBe(6);
    expect(asset.address.toLowerCase()).toBe('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');
    expect(() => assertNetworkAssetConsistency('eip155:8453', asset.address)).not.toThrow();
    const stmt = d.economicSecurity.find((s) => s.id === 'settlement_network_asset')!.statement;
    expect(stmt).toContain('eip155:8453');
    expect(stmt).toContain('USDC');
  });
});

describe('the mTLS declaration cannot be silently contradicted by configuration', () => {
  it('the agent-card mTLS gate fails closed and the declaration keeps mTLS unsupported', () => {
    expect(resolveMtlsProductionActive({})).toBe(false);
    expect(resolveMtlsProductionActive({ MTLS_PRODUCTION_ACTIVE: 'True' })).toBe(false);
    expect(resolveMtlsProductionActive({ MTLS_PRODUCTION_ACTIVE: '1' })).toBe(false);
    expect(d.unsupportedSecurityFeatures.find((n) => n.feature === 'mtls')!.status).toBe(
      'UNSUPPORTED'
    );
  });
});
