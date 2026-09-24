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
 * `maxThreads=6` (half the host's logical CPUs) was the first fix tried and
 * looked sufficient in a 12-file diagnostic slice, but a full 381+ file
 * broad-suite run at maxThreads=6 still reproduced the same class of
 * failure (reconcile-payment-attempts D1/Miniflare setup timeout, plus
 * scripts/gates/evidence/source-state.test.ts) — the smaller diagnostic
 * slice didn't reproduce the contention the full suite creates. A full-suite
 * run at maxThreads=2 passed cleanly (383 files, 4794 tests, 0 failures,
 * 248.85s), so this is now the canonical bound. It is a larger concurrency
 * cut than the file-count alone would suggest necessary, which is why it's
 * measured against the full suite rather than a representative slice.
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
  maxThreads: 2,
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
