/**
 * SUN-1000 checkpoint 1N-B — deterministic latency/statistics helpers for
 * the v2 load gate. Pure functions, no I/O, so they can be unit-tested
 * directly against known samples (directive §16: "test the statistics
 * implementation") independent of any real HTTP campaign.
 */

export interface LatencyStats {
  count: number;
  min: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

/** Nearest-rank percentile over a sorted-ascending copy of `samples`.
 * Deterministic: `p` in `[0, 100]`, index = `ceil(p/100 * n) - 1`,
 * clamped into range. Never interpolates, so the result is always one of
 * the actual observed values — reproducible independent of distribution
 * shape. */
export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) throw new Error('percentile: empty sample set');
  if (p < 0 || p > 100) throw new Error(`percentile: p out of range: ${p}`);
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  const index = Math.min(Math.max(rank, 0), sorted.length - 1);
  return sorted[index];
}

export function computeLatencyStats(samplesMs: readonly number[]): LatencyStats {
  if (samplesMs.length === 0) {
    throw new Error('computeLatencyStats: empty sample set');
  }
  const sum = samplesMs.reduce((acc, v) => acc + v, 0);
  return {
    count: samplesMs.length,
    min: Math.min(...samplesMs),
    mean: sum / samplesMs.length,
    p50: percentile(samplesMs, 50),
    p95: percentile(samplesMs, 95),
    p99: percentile(samplesMs, 99),
    max: Math.max(...samplesMs),
  };
}

export function throughputPerSecond(count: number, durationMs: number): number {
  if (durationMs <= 0) throw new Error('throughputPerSecond: durationMs must be positive');
  return (count / durationMs) * 1000;
}

/** A bounded async concurrency runner — never more than `concurrency`
 * in-flight tasks at once. Deterministic ordering of task *starts* is not
 * guaranteed (this is exactly what exercises real concurrency), but every
 * task's own result is preserved in its original index. */
export async function runWithConcurrency<T>(
  tasks: ReadonlyArray<() => Promise<T>>,
  concurrency: number
): Promise<T[]> {
  if (concurrency <= 0) throw new Error('runWithConcurrency: concurrency must be positive');
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = nextIndex++;
      if (i >= tasks.length) return;
      results[i] = await tasks[i]();
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
