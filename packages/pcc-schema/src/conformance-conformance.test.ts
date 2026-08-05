import { describe, it, expect } from 'vitest';
import { canonicalize, loadCanonicalJson, hashCanonical } from './index';
import * as fs from 'fs';
import * as path from 'path';

describe('RFC 8785 / JCS Cross-Language Conformance', () => {
  beforeAll(async () => {
    await loadCanonicalJson();
  });

  const vectorsPath = path.resolve(__dirname, '../tests/conformance/vectors.json');
  const vectors = JSON.parse(fs.readFileSync(vectorsPath, 'utf-8'));

  for (const vector of vectors.vectors) {
    it(`canonicalizes "${vector.name}" identically to RFC 8785 reference`, () => {
      const canonical = canonicalize(vector.input);
      expect(canonical).toBe(vector.expected_canonical);
    });

    it(`hashes "${vector.name}" identically to RFC 8785 reference`, async () => {
      const hash = await hashCanonical(vector.input);
      expect(hash).toBe(vector.expected_sha256);
    });
  }
});

describe('JCS Number Validation', () => {
  beforeAll(async () => {
    await loadCanonicalJson();
  });

  it('rejects integer exceeding max safe integer', () => {
    expect(() => canonicalize({ large: 9007199254740992 })).toThrow('exceeds safe range');
  });

  it('rejects integer below min safe integer', () => {
    expect(() => canonicalize({ small: -9007199254740992 })).toThrow('exceeds safe range');
  });

  it('rejects NaN', () => {
    expect(() => canonicalize({ nan: NaN })).toThrow('non-finite numbers');
  });

  it('rejects Infinity', () => {
    expect(() => canonicalize({ inf: Infinity })).toThrow('non-finite numbers');
  });

  it('rejects -Infinity', () => {
    expect(() => canonicalize({ negInf: -Infinity })).toThrow('non-finite numbers');
  });

  it('accepts max safe integer', () => {
    const result = canonicalize({ max: 9007199254740991 });
    expect(result).toBe('{"max":9007199254740991}');
  });

  it('accepts min safe integer', () => {
    const result = canonicalize({ min: -9007199254740991 });
    expect(result).toBe('{"min":-9007199254740991}');
  });
});
