import { describe, expect, it } from 'vitest';
import {
  parseEvmAddress,
  parseGitSha,
  parseIsoTimestamp,
  parseSemVer,
  parseSha256Digest,
  parseUriString,
  parseUsdAmount,
  VcmPrimitiveError,
} from './primitives';

describe('primitive parsers reject malformed input', () => {
  it('rejects a malformed EVM address', () => {
    expect(() => parseEvmAddress('not-an-address')).toThrow(VcmPrimitiveError);
    expect(() => parseEvmAddress('0x123')).toThrow(VcmPrimitiveError);
  });

  it('accepts a well-formed EVM address', () => {
    expect(parseEvmAddress('0x833589fCD6EDb6E08f4c7C32D4f71b54bdA02913')).toBeTruthy();
  });

  it('rejects a malformed URI', () => {
    expect(() => parseUriString('not a uri at all')).toThrow(VcmPrimitiveError);
  });

  it('accepts an https and a mailto URI', () => {
    expect(parseUriString('https://siteborne.com')).toBeTruthy();
    expect(parseUriString('mailto:test@example.com')).toBeTruthy();
  });

  it('rejects a malformed SHA-256 digest', () => {
    expect(() => parseSha256Digest('sha256:not-hex')).toThrow(VcmPrimitiveError);
    expect(() => parseSha256Digest(`sha256:${'A'.repeat(64)}`)).toThrow(VcmPrimitiveError); // uppercase rejected
    expect(() => parseSha256Digest(`md5:${'a'.repeat(32)}`)).toThrow(VcmPrimitiveError);
  });

  it('rejects a malformed SemVer', () => {
    expect(() => parseSemVer('1.0')).toThrow(VcmPrimitiveError);
    expect(() => parseSemVer('1.0.0-beta')).toThrow(VcmPrimitiveError);
  });

  it('rejects a malformed GitSha', () => {
    expect(() => parseGitSha('abc123')).toThrow(VcmPrimitiveError);
    expect(() => parseGitSha('G'.repeat(40))).toThrow(VcmPrimitiveError);
  });

  it('accepts a well-formed 40-hex GitSha', () => {
    expect(parseGitSha('a'.repeat(40))).toBeTruthy();
  });

  it('rejects a malformed IsoTimestamp', () => {
    expect(() => parseIsoTimestamp('2026-13-45')).toThrow(VcmPrimitiveError);
    expect(() => parseIsoTimestamp('not a date')).toThrow(VcmPrimitiveError);
  });

  it('rejects a malformed UsdAmount', () => {
    expect(() => parseUsdAmount('-1.00')).toThrow(VcmPrimitiveError);
    expect(() => parseUsdAmount('1.2345678')).toThrow(VcmPrimitiveError); // > 6 fractional digits
    expect(() => parseUsdAmount('abc')).toThrow(VcmPrimitiveError);
  });
});
