/**
 * SUN-1000 checkpoint 1O-A — self-tests for the canonical preproduction
 * network source of truth and its mainnet fail-closed guard.
 */
import { describe, expect, it } from 'vitest';
import {
  PREPRODUCTION_NETWORK,
  PRODUCTION_NETWORK,
  assertPreproductionNetwork,
  isProductionPaymentAuthorized,
  resolvePaymentNetwork,
  type ProductionAuthorizationInput,
} from './preproduction';

const FULLY_AUTHORIZED: ProductionAuthorizationInput = {
  environment: 'production',
  productionEnabled: true,
  humanBootstrapAuthorized: true,
  productionCredentialsApproved: true,
};

const FULLY_UNAUTHORIZED: ProductionAuthorizationInput = {
  environment: 'preproduction',
  productionEnabled: false,
  humanBootstrapAuthorized: false,
  productionCredentialsApproved: false,
};

describe('preproduction network constants', () => {
  it('PREPRODUCTION_NETWORK is Base Sepolia', () => {
    expect(PREPRODUCTION_NETWORK).toBe('eip155:84532');
  });

  it('PRODUCTION_NETWORK is Base mainnet', () => {
    expect(PRODUCTION_NETWORK).toBe('eip155:8453');
  });

  it('the two constants are distinct', () => {
    expect(PREPRODUCTION_NETWORK).not.toBe(PRODUCTION_NETWORK);
  });
});

describe('assertPreproductionNetwork', () => {
  it('allows the preproduction network with no authorization flag', () => {
    expect(() => assertPreproductionNetwork(PREPRODUCTION_NETWORK)).not.toThrow();
  });

  it('allows the preproduction network with the flag explicitly false', () => {
    expect(() => assertPreproductionNetwork(PREPRODUCTION_NETWORK, false)).not.toThrow();
  });

  it('rejects the production network by default (fail-closed)', () => {
    expect(() => assertPreproductionNetwork(PRODUCTION_NETWORK)).toThrow(
      /preproduction_mainnet_guard/
    );
  });

  it('rejects the production network when the flag is explicitly false', () => {
    expect(() => assertPreproductionNetwork(PRODUCTION_NETWORK, false)).toThrow(
      /preproduction_mainnet_guard/
    );
  });

  it('allows the production network only when explicitly authorized', () => {
    expect(() => assertPreproductionNetwork(PRODUCTION_NETWORK, true)).not.toThrow();
  });
});

describe('isProductionPaymentAuthorized (SUN-1200 checkpoint A, ADR 0055)', () => {
  it('returns true only when all four gates are true', () => {
    expect(isProductionPaymentAuthorized(FULLY_AUTHORIZED)).toBe(true);
  });

  it('returns false when every gate is false (the default)', () => {
    expect(isProductionPaymentAuthorized(FULLY_UNAUTHORIZED)).toBe(false);
  });

  it('kill switch: productionEnabled=false denies even with every other gate true', () => {
    expect(isProductionPaymentAuthorized({ ...FULLY_AUTHORIZED, productionEnabled: false })).toBe(
      false
    );
  });

  it('bootstrap-auth control: humanBootstrapAuthorized=false denies even with every other gate true', () => {
    expect(
      isProductionPaymentAuthorized({ ...FULLY_AUTHORIZED, humanBootstrapAuthorized: false })
    ).toBe(false);
  });

  it('missing-credential-approval control: productionCredentialsApproved=false denies even with every other gate true', () => {
    expect(
      isProductionPaymentAuthorized({ ...FULLY_AUTHORIZED, productionCredentialsApproved: false })
    ).toBe(false);
  });

  it('wrong-environment control: environment=preproduction denies even with every other gate true', () => {
    expect(
      isProductionPaymentAuthorized({ ...FULLY_AUTHORIZED, environment: 'preproduction' })
    ).toBe(false);
  });

  it('each gate is independently necessary: exactly one false anywhere denies', () => {
    const variants: ProductionAuthorizationInput[] = [
      { ...FULLY_AUTHORIZED, environment: 'preproduction' },
      { ...FULLY_AUTHORIZED, productionEnabled: false },
      { ...FULLY_AUTHORIZED, humanBootstrapAuthorized: false },
      { ...FULLY_AUTHORIZED, productionCredentialsApproved: false },
    ];
    for (const variant of variants) {
      expect(isProductionPaymentAuthorized(variant)).toBe(false);
    }
  });
});

describe('resolvePaymentNetwork (SUN-1200 checkpoint A)', () => {
  it('resolves PREPRODUCTION_NETWORK by default (fully unauthorized)', () => {
    expect(resolvePaymentNetwork(FULLY_UNAUTHORIZED)).toBe(PREPRODUCTION_NETWORK);
  });

  it('resolves PRODUCTION_NETWORK only when fully authorized', () => {
    expect(resolvePaymentNetwork(FULLY_AUTHORIZED)).toBe(PRODUCTION_NETWORK);
  });

  it('default-mainnet-reachability control: an all-default/empty-shaped input never resolves production', () => {
    const allFalseDefault: ProductionAuthorizationInput = {
      environment: 'preproduction',
      productionEnabled: false,
      humanBootstrapAuthorized: false,
      productionCredentialsApproved: false,
    };
    expect(resolvePaymentNetwork(allFalseDefault)).toBe(PREPRODUCTION_NETWORK);
  });

  it('kill switch: productionEnabled=false resolves preproduction even with every other gate true', () => {
    expect(resolvePaymentNetwork({ ...FULLY_AUTHORIZED, productionEnabled: false })).toBe(
      PREPRODUCTION_NETWORK
    );
  });
});
