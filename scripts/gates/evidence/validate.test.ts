import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CANONICAL_EXECUTION_PROFILE, executionProfileId } from './execution-profile.js';

// Bounded fixture records only — this suite never runs the real broad or
// negative-fixture suites, per the "keep this mechanism small" constraint.

const CURRENT = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const CURRENT_PROFILE = executionProfileId(CANONICAL_EXECUTION_PROFILE);

function validRecord(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    gate_id: 'BROAD_TEST_SUITE',
    source_state_id: CURRENT,
    command: 'vitest run',
    execution_profile: CURRENT_PROFILE,
    started_at: '2020-01-01T00:00:00.000Z',
    completed_at: '2020-01-01T00:01:00.000Z',
    exit_code: 0,
    result: 'PASS',
    summary: {
      test_files_passed: 1,
      test_files_failed: 0,
      test_files_skipped: 0,
      tests_passed: 1,
      tests_failed: 0,
      tests_skipped: 0,
    },
    ...overrides,
  };
}

function negativeFixtureRecord(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    gate_id: 'NEGATIVE_FIXTURE_SUITE',
    source_state_id: CURRENT,
    command: 'vitest run negative fixtures',
    execution_profile: CURRENT_PROFILE,
    started_at: '2020-01-01T00:00:00.000Z',
    completed_at: '2020-01-01T00:01:00.000Z',
    exit_code: 0,
    result: 'PASS',
    summary: { fixtures_total: 3, fixtures_passing: 3, fixtures_failing: 0 },
    ...overrides,
  };
}

let tmpDir: string;

vi.mock('./store.js', () => {
  return {
    readEvidence: (gateId: string) => {
      const path = join(tmpDir, `${gateId}.json`);
      if (!existsSync(path)) return undefined;
      return JSON.parse(readFileSync(path, 'utf8'));
    },
  };
});

function writeFixture(gateId: string, record: unknown) {
  writeFileSync(join(tmpDir, `${gateId}.json`), JSON.stringify(record));
}

describe('validateGateEvidence', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'release-evidence-test-'));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('missing broad evidence -> NO_EVIDENCE', async () => {
    const { validateGateEvidence } = await import('./validate.js');
    expect(validateGateEvidence('BROAD_TEST_SUITE', CURRENT)).toEqual({ status: 'NO_EVIDENCE' });
  });

  it('missing negative-fixture evidence -> NO_EVIDENCE', async () => {
    const { validateGateEvidence } = await import('./validate.js');
    expect(validateGateEvidence('NEGATIVE_FIXTURE_SUITE', CURRENT)).toEqual({
      status: 'NO_EVIDENCE',
    });
  });

  it('broad evidence wrong gate_id -> INVALID_EVIDENCE', async () => {
    writeFixture('BROAD_TEST_SUITE', validRecord({ gate_id: 'NEGATIVE_FIXTURE_SUITE' }));
    const { validateGateEvidence } = await import('./validate.js');
    const result = validateGateEvidence('BROAD_TEST_SUITE', CURRENT);
    expect(result.status).toBe('INVALID_EVIDENCE');
  });

  it('broad evidence wrong source-state ID -> STALE_EVIDENCE', async () => {
    writeFixture('BROAD_TEST_SUITE', validRecord({ source_state_id: OTHER }));
    const { validateGateEvidence } = await import('./validate.js');
    const result = validateGateEvidence('BROAD_TEST_SUITE', CURRENT);
    expect(result.status).toBe('STALE_EVIDENCE');
  });

  it('broad evidence nonzero exit code -> FAILED_EVIDENCE', async () => {
    writeFixture('BROAD_TEST_SUITE', validRecord({ exit_code: 1, result: 'FAIL' }));
    const { validateGateEvidence } = await import('./validate.js');
    const result = validateGateEvidence('BROAD_TEST_SUITE', CURRENT);
    expect(result.status).toBe('FAILED_EVIDENCE');
  });

  it('broad evidence tests_failed > 0 -> FAILED_EVIDENCE', async () => {
    writeFixture(
      'BROAD_TEST_SUITE',
      validRecord({ summary: { ...validRecord().summary, tests_failed: 2 } })
    );
    const { validateGateEvidence } = await import('./validate.js');
    const result = validateGateEvidence('BROAD_TEST_SUITE', CURRENT);
    expect(result.status).toBe('FAILED_EVIDENCE');
  });

  it('broad evidence incomplete execution (missing completed_at) -> INVALID_EVIDENCE', async () => {
    const record = validRecord() as Record<string, unknown>;
    delete record.completed_at;
    writeFixture('BROAD_TEST_SUITE', record);
    const { validateGateEvidence } = await import('./validate.js');
    const result = validateGateEvidence('BROAD_TEST_SUITE', CURRENT);
    expect(result.status).toBe('INVALID_EVIDENCE');
  });

  it('negative-fixture wrong source-state ID -> STALE_EVIDENCE', async () => {
    writeFixture('NEGATIVE_FIXTURE_SUITE', negativeFixtureRecord({ source_state_id: OTHER }));
    const { validateGateEvidence } = await import('./validate.js');
    const result = validateGateEvidence('NEGATIVE_FIXTURE_SUITE', CURRENT);
    expect(result.status).toBe('STALE_EVIDENCE');
  });

  it('negative-fixture nonzero exit code -> FAILED_EVIDENCE', async () => {
    writeFixture('NEGATIVE_FIXTURE_SUITE', negativeFixtureRecord({ exit_code: 1, result: 'FAIL' }));
    const { validateGateEvidence } = await import('./validate.js');
    const result = validateGateEvidence('NEGATIVE_FIXTURE_SUITE', CURRENT);
    expect(result.status).toBe('FAILED_EVIDENCE');
  });

  it('negative-fixture fixtures_failing > 0 -> FAILED_EVIDENCE', async () => {
    writeFixture(
      'NEGATIVE_FIXTURE_SUITE',
      negativeFixtureRecord({
        summary: { fixtures_total: 3, fixtures_passing: 2, fixtures_failing: 1 },
      })
    );
    const { validateGateEvidence } = await import('./validate.js');
    const result = validateGateEvidence('NEGATIVE_FIXTURE_SUITE', CURRENT);
    expect(result.status).toBe('FAILED_EVIDENCE');
  });

  it('malformed evidence (not an object) -> INVALID_EVIDENCE', async () => {
    writeFixture('BROAD_TEST_SUITE', 'not-an-object');
    const { validateGateEvidence } = await import('./validate.js');
    const result = validateGateEvidence('BROAD_TEST_SUITE', CURRENT);
    expect(result.status).toBe('INVALID_EVIDENCE');
  });

  it('unsupported evidence schema version -> INVALID_EVIDENCE', async () => {
    writeFixture('BROAD_TEST_SUITE', validRecord({ schema_version: 2 }));
    const { validateGateEvidence } = await import('./validate.js');
    const result = validateGateEvidence('BROAD_TEST_SUITE', CURRENT);
    expect(result.status).toBe('INVALID_EVIDENCE');
  });

  it('valid current broad evidence -> PASS', async () => {
    writeFixture('BROAD_TEST_SUITE', validRecord());
    const { validateGateEvidence } = await import('./validate.js');
    const result = validateGateEvidence('BROAD_TEST_SUITE', CURRENT);
    expect(result.status).toBe('PASS');
  });

  it('valid current negative-fixture evidence -> PASS', async () => {
    writeFixture('NEGATIVE_FIXTURE_SUITE', negativeFixtureRecord());
    const { validateGateEvidence } = await import('./validate.js');
    const result = validateGateEvidence('NEGATIVE_FIXTURE_SUITE', CURRENT);
    expect(result.status).toBe('PASS');
  });

  it('broad evidence missing execution_profile -> INVALID_EVIDENCE', async () => {
    const record = validRecord() as Record<string, unknown>;
    delete record.execution_profile;
    writeFixture('BROAD_TEST_SUITE', record);
    const { validateGateEvidence } = await import('./validate.js');
    const result = validateGateEvidence('BROAD_TEST_SUITE', CURRENT);
    expect(result.status).toBe('INVALID_EVIDENCE');
  });

  // Section 7: evidence generated under a different governed execution
  // profile (e.g. an unbounded default `vitest run`, or a stale profile from
  // before a concurrency-bound change) must never be trusted as if it ran
  // under the current canonical qualification configuration — a profile
  // change is exactly the kind of execution-semantic drift command identity
  // must catch, even when source_state_id still matches.
  it('broad evidence recorded under a different execution profile -> EXECUTION_PROFILE_MISMATCH, even with a matching source_state_id', async () => {
    writeFixture(
      'BROAD_TEST_SUITE',
      validRecord({
        execution_profile: 'pool=threads;maxThreads=12;minThreads=1;fileParallelism=true',
      })
    );
    const { validateGateEvidence } = await import('./validate.js');
    const result = validateGateEvidence('BROAD_TEST_SUITE', CURRENT);
    expect(result.status).toBe('EXECUTION_PROFILE_MISMATCH');
    if (result.status === 'EXECUTION_PROFILE_MISMATCH') {
      expect(result.currentExecutionProfile).toBe(CURRENT_PROFILE);
      expect(result.recordedExecutionProfile).not.toBe(CURRENT_PROFILE);
    }
  });

  it('negative-fixture evidence recorded under a different execution profile -> EXECUTION_PROFILE_MISMATCH', async () => {
    writeFixture(
      'NEGATIVE_FIXTURE_SUITE',
      negativeFixtureRecord({
        execution_profile: 'pool=threads;maxThreads=1;minThreads=1;fileParallelism=false',
      })
    );
    const { validateGateEvidence } = await import('./validate.js');
    const result = validateGateEvidence('NEGATIVE_FIXTURE_SUITE', CURRENT);
    expect(result.status).toBe('EXECUTION_PROFILE_MISMATCH');
  });

  it('a profile mismatch is reported even when the evidence is otherwise stale, since it is the more structural defect', async () => {
    writeFixture(
      'BROAD_TEST_SUITE',
      validRecord({
        source_state_id: OTHER,
        execution_profile: 'pool=threads;maxThreads=12;minThreads=1;fileParallelism=true',
      })
    );
    const { validateGateEvidence } = await import('./validate.js');
    const result = validateGateEvidence('BROAD_TEST_SUITE', CURRENT);
    expect(result.status).toBe('EXECUTION_PROFILE_MISMATCH');
  });
});
