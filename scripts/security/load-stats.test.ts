/**
 * SUN-1000 checkpoint 1N-B — self-tests for the load gate's statistics
 * implementation, against known, hand-computed samples.
 */
import { describe, expect, it } from 'vitest';
import {
  computeLatencyStats,
  percentile,
  runWithConcurrency,
  throughputPerSecond,
} from './load-stats';

describe('percentile', () => {
  it('p50 of [1..10] is the 5th value (nearest-rank, not interpolated)', () => {
    const samples = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(samples, 50)).toBe(5);
  });

  it('p95 of [1..100] is 95', () => {
    const samples = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(samples, 95)).toBe(95);
  });

  it('p99 of [1..100] is 99', () => {
    const samples = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(samples, 99)).toBe(99);
  });

  it('p0 is the minimum, p100 is the maximum', () => {
    const samples = [5, 1, 9, 3];
    expect(percentile(samples, 0)).toBe(1);
    expect(percentile(samples, 100)).toBe(9);
  });

  it('a single-element sample returns that element for any percentile', () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 99)).toBe(42);
  });

  it('is unaffected by input order', () => {
    const a = [3, 1, 4, 1, 5, 9, 2, 6];
    const b = [...a].reverse();
    expect(percentile(a, 95)).toBe(percentile(b, 95));
  });

  it('rejects an empty sample set', () => {
    expect(() => percentile([], 50)).toThrow();
  });

  it('rejects an out-of-range percentile', () => {
    expect(() => percentile([1, 2, 3], -1)).toThrow();
    expect(() => percentile([1, 2, 3], 101)).toThrow();
  });
});

describe('computeLatencyStats', () => {
  it('computes count/min/mean/percentiles/max on a known sample', () => {
    const stats = computeLatencyStats([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(stats.count).toBe(10);
    expect(stats.min).toBe(10);
    expect(stats.max).toBe(100);
    expect(stats.mean).toBe(55);
    expect(stats.p50).toBe(50);
  });

  it('rejects an empty sample set', () => {
    expect(() => computeLatencyStats([])).toThrow();
  });
});

describe('throughputPerSecond', () => {
  it('100 requests in 1000ms is 100 req/s', () => {
    expect(throughputPerSecond(100, 1000)).toBe(100);
  });

  it('rejects zero or negative duration', () => {
    expect(() => throughputPerSecond(10, 0)).toThrow();
    expect(() => throughputPerSecond(10, -5)).toThrow();
  });
});

describe('runWithConcurrency', () => {
  it('runs every task exactly once and preserves result order', async () => {
    const tasks = Array.from({ length: 20 }, (_, i) => async () => i * 2);
    const results = await runWithConcurrency(tasks, 4);
    expect(results).toEqual(Array.from({ length: 20 }, (_, i) => i * 2));
  });

  it('never exceeds the requested concurrency', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const tasks = Array.from({ length: 30 }, () => async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return null;
    });
    await runWithConcurrency(tasks, 5);
    expect(maxInFlight).toBeLessThanOrEqual(5);
  });

  it('rejects non-positive concurrency', async () => {
    await expect(runWithConcurrency([async () => 1], 0)).rejects.toThrow();
  });

  it('propagates a task rejection', async () => {
    const tasks = [
      async () => 1,
      async () => {
        throw new Error('boom');
      },
    ];
    await expect(runWithConcurrency(tasks, 2)).rejects.toThrow('boom');
  });
});
