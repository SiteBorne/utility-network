import { describe, expect, it } from 'vitest';
import { canonicalize, contentHash, hashCanonical, sha256Hex } from '../canonical';

describe('canonical.ts', () => {
  it('canonicalize is order-independent for object keys (JCS)', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
  });

  it('hashCanonical is deterministic', async () => {
    const value = { z: [1, 2, 3], a: 'text' };
    expect(await hashCanonical(value)).toBe(await hashCanonical(value));
  });

  it('sha256Hex/contentHash agree with the sha256: prefix convention', async () => {
    const hex = await sha256Hex('abc');
    expect(await contentHash('abc')).toBe(`sha256:${hex}`);
  });
});
