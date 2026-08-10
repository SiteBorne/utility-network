import { describe, expect, it } from 'vitest';
import { isSchemeSupportedOnNetwork, isSupportedScheme, parseCaip2Network } from './schemes';

describe('parseCaip2Network', () => {
  it('parses a well-formed EVM CAIP-2 identifier', () => {
    expect(parseCaip2Network('eip155:84532')).toEqual({
      valid: true,
      namespace: 'eip155',
      reference: '84532',
    });
  });

  it('parses a well-formed Solana CAIP-2 identifier', () => {
    expect(parseCaip2Network('solana:devnet')).toEqual({
      valid: true,
      namespace: 'solana',
      reference: 'devnet',
    });
  });

  it('rejects a bare string with no namespace separator', () => {
    expect(parseCaip2Network('ethereum').valid).toBe(false);
  });

  it('rejects an empty namespace or reference', () => {
    expect(parseCaip2Network(':84532').valid).toBe(false);
    expect(parseCaip2Network('eip155:').valid).toBe(false);
  });

  it('rejects a string shorter than the minimum length', () => {
    expect(parseCaip2Network('a:').valid).toBe(false);
    expect(parseCaip2Network('').valid).toBe(false);
  });
});

describe('isSchemeSupportedOnNetwork', () => {
  it('exact is supported on a recognized EVM network', () => {
    expect(isSchemeSupportedOnNetwork('exact', 'eip155:8453')).toEqual({ supported: true });
  });

  it('exact is supported on a recognized Solana network', () => {
    expect(isSchemeSupportedOnNetwork('exact', 'solana:mainnet')).toEqual({ supported: true });
  });

  it('upto is supported on EVM', () => {
    expect(isSchemeSupportedOnNetwork('upto', 'eip155:8453')).toEqual({ supported: true });
  });

  it('upto is NOT supported on Solana (EVM-only per current spec)', () => {
    expect(isSchemeSupportedOnNetwork('upto', 'solana:mainnet')).toEqual({
      supported: false,
      reason: 'upto_not_evm',
    });
  });

  it('rejects a malformed network', () => {
    expect(isSchemeSupportedOnNetwork('exact', 'not-a-caip2-id')).toEqual({
      supported: false,
      reason: 'malformed_network',
    });
  });

  it('rejects an unrecognized namespace even for exact', () => {
    expect(isSchemeSupportedOnNetwork('exact', 'cosmos:cosmoshub-4')).toEqual({
      supported: false,
      reason: 'unrecognized_namespace',
    });
  });
});

describe('isSupportedScheme', () => {
  it('accepts exact and upto', () => {
    expect(isSupportedScheme('exact')).toBe(true);
    expect(isSupportedScheme('upto')).toBe(true);
  });

  it('rejects batch-settlement (not targeted by this checkpoint) and unknown schemes', () => {
    expect(isSupportedScheme('batch-settlement')).toBe(false);
    expect(isSupportedScheme('made-up-scheme')).toBe(false);
    expect(isSupportedScheme('')).toBe(false);
  });
});
