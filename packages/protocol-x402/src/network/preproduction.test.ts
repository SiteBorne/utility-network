/**
 * SUN-1000 checkpoint 1O-A — self-tests for the canonical preproduction
 * network source of truth and its mainnet fail-closed guard.
 */
import { describe, expect, it } from 'vitest';
import {
  PREPRODUCTION_NETWORK,
  PRODUCTION_NETWORK,
  assertPreproductionNetwork,
} from './preproduction';

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
