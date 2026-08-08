import { describe, expect, it } from 'vitest';
import { computeWaves, topologicalSort } from '../graph';
import { MeshError } from '../failures';
import type { Verifier } from '../types';

function stubVerifier(id: string, dependsOn: string[] = []): Verifier {
  return {
    verifierId: id,
    verifierVersion: '1.0.0',
    capabilities: [],
    dependsOn,
    mandatory: true,
    verify: () => {
      throw new Error('not implemented in this stub');
    },
  };
}

describe('topologicalSort', () => {
  it('orders dependencies before dependents', () => {
    const order = topologicalSort([
      stubVerifier('c', ['b']),
      stubVerifier('b', ['a']),
      stubVerifier('a'),
    ]);
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
  });

  it('is deterministic across differing registration order (lexicographic tie-break)', () => {
    const orderA = topologicalSort([stubVerifier('a'), stubVerifier('b')]);
    const orderB = topologicalSort([stubVerifier('b'), stubVerifier('a')]);
    expect(orderA).toEqual(orderB);
  });

  it('throws on a duplicate verifier id', () => {
    expect(() => topologicalSort([stubVerifier('a'), stubVerifier('a')])).toThrowError(MeshError);
  });

  it('throws on a dependency on an unknown verifier', () => {
    expect(() => topologicalSort([stubVerifier('a', ['ghost'])])).toThrowError(MeshError);
  });

  it('throws on a dependency cycle', () => {
    expect(() =>
      topologicalSort([stubVerifier('a', ['b']), stubVerifier('b', ['a'])])
    ).toThrowError(MeshError);
  });
});

describe('computeWaves', () => {
  it('groups independent verifiers into the same wave', () => {
    const waves = computeWaves([stubVerifier('a'), stubVerifier('b')]);
    expect(waves).toEqual([['a', 'b']]);
  });

  it('places a dependent verifier strictly after its dependency wave', () => {
    const waves = computeWaves([stubVerifier('a'), stubVerifier('b', ['a'])]);
    expect(waves).toEqual([['a'], ['b']]);
  });

  it('places a verifier after the latest of multiple dependencies', () => {
    const waves = computeWaves([
      stubVerifier('a'),
      stubVerifier('b'),
      stubVerifier('c', ['a', 'b']),
    ]);
    expect(waves[waves.length - 1]).toEqual(['c']);
  });
});
