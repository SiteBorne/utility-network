import { describe, expect, it } from 'vitest';
import { checkSupportedVersion, SUPPORTED_X402_VERSION } from './version';

describe('checkSupportedVersion', () => {
  it('accepts the current supported version', () => {
    expect(checkSupportedVersion(SUPPORTED_X402_VERSION)).toEqual({
      supported: true,
      version: SUPPORTED_X402_VERSION,
    });
  });

  it('is sourced from @x402/core, and is 2', () => {
    expect(SUPPORTED_X402_VERSION).toBe(2);
  });

  it('rejects V1 (never silently treats it as V2)', () => {
    const result = checkSupportedVersion(1);
    expect(result.supported).toBe(false);
    expect(result).toMatchObject({ reason: 'unsupported_version' });
  });

  it('rejects a hypothetical future V3', () => {
    const result = checkSupportedVersion(3);
    expect(result.supported).toBe(false);
  });

  it('rejects non-numeric input', () => {
    expect(checkSupportedVersion('2').supported).toBe(false);
    expect(checkSupportedVersion(undefined).supported).toBe(false);
    expect(checkSupportedVersion(null).supported).toBe(false);
    expect(checkSupportedVersion(NaN).supported).toBe(false);
  });
});
