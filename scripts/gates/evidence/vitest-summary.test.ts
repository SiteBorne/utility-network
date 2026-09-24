import { describe, expect, it } from 'vitest';
import { fileCounts, shouldRetainRawOutput, type VitestJsonSummary } from './vitest-summary.js';

// Regression fixture for the BROAD_TEST_FILES_PASSED=1209 drift: a real
// vitest --reporter=json run on scripts/gates/evidence/validate.test.ts
// (1 file, 1 top-level describe, 14 tests) reported
// numTotalTestSuites=2 / numPassedTestSuites=2 — proving suite counts
// diverge from file counts even for the simplest possible file. File
// counts must come from testResults instead.
const REAL_SINGLE_FILE_SUMMARY: VitestJsonSummary = {
  numTotalTests: 14,
  numPassedTests: 14,
  numFailedTests: 0,
  numPendingTests: 0,
  testResults: [{ status: 'passed' }],
};

describe('fileCounts', () => {
  it('counts one passed file for a single passing test file, not the suite count', () => {
    expect(fileCounts(REAL_SINGLE_FILE_SUMMARY)).toEqual({ passed: 1, failed: 0, skipped: 0 });
  });

  it('is unaffected by describe-block nesting depth', () => {
    // Same file, hypothetically reported with deeper nesting (more
    // "suites") by vitest — testResults still has exactly one entry.
    expect(fileCounts(REAL_SINGLE_FILE_SUMMARY).passed).not.toBe(2);
  });

  it('separately counts failed and skipped files across a multi-file run', () => {
    const summary: VitestJsonSummary = {
      numTotalTests: 30,
      numPassedTests: 20,
      numFailedTests: 5,
      numPendingTests: 5,
      testResults: [
        { status: 'passed' },
        { status: 'passed' },
        { status: 'failed' },
        { status: 'pending' },
        { status: 'skipped' },
      ],
    };
    expect(fileCounts(summary)).toEqual({ passed: 2, failed: 1, skipped: 2 });
  });

  it('returns all-zero counts for an empty run', () => {
    expect(
      fileCounts({
        numTotalTests: 0,
        numPassedTests: 0,
        numFailedTests: 0,
        numPendingTests: 0,
        testResults: [],
      })
    ).toEqual({
      passed: 0,
      failed: 0,
      skipped: 0,
    });
  });
});

// Regression fixture for the FAILURE_CLASSIFICATION=UNKNOWN_DUE_TO_EVIDENCE_DATA_LOSS
// defect: a real broad run failed (exit_code=1, 1 failed test) but the raw
// output was unconditionally deleted before the specific failing test could
// be inspected, making the failure permanently undiagnosable.
describe('shouldRetainRawOutput', () => {
  const CLEAN: VitestJsonSummary = {
    numTotalTests: 10,
    numPassedTests: 10,
    numFailedTests: 0,
    numPendingTests: 0,
    testResults: [{ status: 'passed' }],
  };
  const WITH_FAILURE: VitestJsonSummary = {
    numTotalTests: 10,
    numPassedTests: 9,
    numFailedTests: 1,
    numPendingTests: 0,
    testResults: [{ status: 'passed' }, { status: 'failed' }],
  };

  it('deletes raw output only for a clean pass (exit 0, zero failed tests)', () => {
    expect(shouldRetainRawOutput(0, CLEAN)).toBe(false);
  });

  it('retains raw output when exit code is non-zero, even if the summary claims zero failures', () => {
    expect(shouldRetainRawOutput(1, CLEAN)).toBe(true);
  });

  it('retains raw output when the summary itself reports a failed test, even with exit code 0', () => {
    expect(shouldRetainRawOutput(0, WITH_FAILURE)).toBe(true);
  });

  it('retains raw output when the summary could not be parsed at all (null)', () => {
    expect(shouldRetainRawOutput(1, null)).toBe(true);
    expect(shouldRetainRawOutput(0, null)).toBe(true);
  });

  it('this is exactly the real failed-run shape that was previously deleted before inspection', () => {
    // The actual observed record: exit_code=1, numFailedTests=1.
    expect(shouldRetainRawOutput(1, WITH_FAILURE)).toBe(true);
  });
});
