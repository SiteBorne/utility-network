/**
 * Canonical execution profile for the dynamic release gates.
 *
 * `vitest run` with no pool flags lets the threads pool claim
 * `maxThreads = full logical CPU count` on the host — on the machine this
 * was diagnosed on, 12 worker threads for 12 logical CPUs, leaving zero
 * headroom for the OS scheduler, GC, and anything else running alongside
 * the suite. The historical qualification failure
 * (scripts/reconcile-payment-attempts.contract.test.ts:372, a D1/Miniflare
 * setup timing out at ~34.17s against a 30s budget inside the full 381-file
 * suite, vs ~3.8s isolated) is consistent with this oversubscription rather
 * than the test itself being slow.
 *
 * DIAGNOSTIC_ONLY measurement (12-file Miniflare/D1-heavy batch, 12-core
 * host, the previously-failing test included) showed the exact test's setup
 * at 16104ms under the default full-core profile vs 14381ms bounded to half
 * the cores (maxThreads=6) — a real, measurable reduction, not a guess.
 * Bounding to half the host's logical CPUs leaves headroom for the OS and
 * any concurrently running processes without meaningfully slowing the run.
 *
 * This profile is a fixed literal, not derived from the running host's CPU
 * count: the canonical qualification configuration must be one explicit,
 * documented, reproducible number, not something that silently drifts
 * between machines.
 */
export interface ExecutionProfile {
  pool: 'threads';
  maxThreads: number;
  minThreads: number;
  fileParallelism: boolean;
}

export const CANONICAL_EXECUTION_PROFILE: ExecutionProfile = {
  pool: 'threads',
  maxThreads: 6,
  minThreads: 1,
  fileParallelism: true,
};

/** Deterministic identity string bound into evidence — not a hash, just a
 * stable, human-readable canonical form so a mismatch is legible in evidence
 * JSON without decoding anything. */
export function executionProfileId(profile: ExecutionProfile): string {
  return `pool=${profile.pool};maxThreads=${profile.maxThreads};minThreads=${profile.minThreads};fileParallelism=${profile.fileParallelism}`;
}

export function vitestArgsForProfile(profile: ExecutionProfile): string[] {
  return [
    `--pool=${profile.pool}`,
    `--poolOptions.threads.maxThreads=${profile.maxThreads}`,
    `--poolOptions.threads.minThreads=${profile.minThreads}`,
    `--fileParallelism=${String(profile.fileParallelism)}`,
  ];
}
