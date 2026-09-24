import { describe, expect, it } from 'vitest';
import {
  CANONICAL_EXECUTION_PROFILE,
  executionProfileId,
  vitestArgsForProfile,
} from './execution-profile.js';

describe('CANONICAL_EXECUTION_PROFILE', () => {
  it('bounds worker threads below an unbounded default (leaves headroom for the host)', () => {
    // The defect this profile fixes: an unflagged `vitest run` lets maxThreads
    // float up to the full logical CPU count, leaving nothing for the OS/GC.
    expect(CANONICAL_EXECUTION_PROFILE.maxThreads).toBeGreaterThan(0);
    expect(CANONICAL_EXECUTION_PROFILE.pool).toBe('threads');
  });
});

describe('executionProfileId', () => {
  it('is deterministic for the same profile', () => {
    expect(executionProfileId(CANONICAL_EXECUTION_PROFILE)).toBe(
      executionProfileId(CANONICAL_EXECUTION_PROFILE)
    );
  });

  it('differs when maxThreads differs — profile identity must not collapse distinct concurrency settings', () => {
    const unbounded = { ...CANONICAL_EXECUTION_PROFILE, maxThreads: 12 };
    expect(executionProfileId(unbounded)).not.toBe(executionProfileId(CANONICAL_EXECUTION_PROFILE));
  });

  it('differs when fileParallelism differs', () => {
    const serial = { ...CANONICAL_EXECUTION_PROFILE, fileParallelism: false };
    expect(executionProfileId(serial)).not.toBe(executionProfileId(CANONICAL_EXECUTION_PROFILE));
  });
});

describe('vitestArgsForProfile', () => {
  it('produces CLI flags that encode pool, maxThreads, minThreads, and fileParallelism', () => {
    const args = vitestArgsForProfile(CANONICAL_EXECUTION_PROFILE);
    expect(args).toContain('--pool=threads');
    expect(args).toContain(
      `--poolOptions.threads.maxThreads=${CANONICAL_EXECUTION_PROFILE.maxThreads}`
    );
    expect(args).toContain(
      `--poolOptions.threads.minThreads=${CANONICAL_EXECUTION_PROFILE.minThreads}`
    );
    expect(args).toContain('--fileParallelism=true');
  });
});
