import { MeshError } from './failures';
import type { Verifier } from './types';

/** Deterministic topological sort of the verifier dependency graph.
 * Ordering: stable — ties are broken by verifierId (lexicographic), so the
 * same verifier set always produces the same execution order regardless of
 * registration order. Independent verifiers (no edge between them) may be
 * run in parallel by the mesh; this function only fixes a valid sequential
 * order that respects every dependency edge. */
export function topologicalSort(verifiers: readonly Verifier[]): string[] {
  const byId = new Map(verifiers.map((v) => [v.verifierId, v]));

  const seen = new Set<string>();
  for (const v of verifiers) {
    if (seen.has(v.verifierId)) {
      throw new MeshError('duplicate_verifier_id', `duplicate verifier id: ${v.verifierId}`);
    }
    seen.add(v.verifierId);
  }

  for (const v of verifiers) {
    for (const dep of v.dependsOn) {
      if (!byId.has(dep)) {
        throw new MeshError(
          'missing_dependency',
          `verifier ${v.verifierId} depends on unknown verifier ${dep}`
        );
      }
    }
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();
  const order: string[] = [];

  const sortedIds = [...byId.keys()].sort();

  function visit(id: string): void {
    if (visited.has(id)) return;
    if (inStack.has(id)) {
      throw new MeshError('dependency_cycle', `dependency cycle detected at verifier ${id}`);
    }
    inStack.add(id);
    const v = byId.get(id);
    if (v) {
      for (const dep of [...v.dependsOn].sort()) {
        visit(dep);
      }
    }
    inStack.delete(id);
    visited.add(id);
    order.push(id);
  }

  for (const id of sortedIds) {
    visit(id);
  }

  return order;
}

/** Groups the topological order into sequential "waves" — verifiers within
 * a wave have no dependency on each other and may run in parallel; each
 * wave depends only on verifiers in earlier waves. */
export function computeWaves(verifiers: readonly Verifier[]): string[][] {
  const order = topologicalSort(verifiers);
  const byId = new Map(verifiers.map((v) => [v.verifierId, v]));
  const waveOf = new Map<string, number>();

  for (const id of order) {
    const v = byId.get(id);
    const deps = v ? v.dependsOn : [];
    const wave = deps.length === 0 ? 0 : Math.max(...deps.map((d) => (waveOf.get(d) ?? 0) + 1));
    waveOf.set(id, wave);
  }

  const maxWave = Math.max(0, ...waveOf.values());
  const waves: string[][] = Array.from({ length: maxWave + 1 }, () => []);
  for (const id of order) {
    waves[waveOf.get(id) ?? 0].push(id);
  }
  return waves.map((w) => [...w].sort());
}
