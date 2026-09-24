/**
 * Parses vitest's `--reporter=json` summary into file-level pass/fail/skip
 * counts. vitest's numTotal/Passed/Failed/PendingTestSuites fields count
 * internal describe-block "suite" hierarchy nodes, not test files — a
 * single file with one top-level describe already reports 2 suites, which
 * previously caused BROAD_TEST_FILES_PASSED to report suite counts (e.g.
 * 1209) instead of the actual file count (e.g. 355). File counts must come
 * from `testResults`, which has exactly one entry per test file.
 */
export interface VitestFileResult {
  status: 'passed' | 'failed' | 'pending' | 'skipped';
}

export interface VitestJsonSummary {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests: number;
  testResults: VitestFileResult[];
}

export interface FileCounts {
  passed: number;
  failed: number;
  skipped: number;
}

export function fileCounts(summary: VitestJsonSummary): FileCounts {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const file of summary.testResults) {
    if (file.status === 'passed') passed++;
    else if (file.status === 'failed') failed++;
    else skipped++;
  }
  return { passed, failed, skipped };
}

/**
 * Whether the raw per-test vitest JSON output should be kept for diagnosis
 * rather than deleted. Regression fixture for the data-loss defect found
 * during the FINAL-PREDEPLOYMENT-REVIEW freeze investigation: a real broad
 * run failed (exit_code=1, 1 test failed) but the raw output was
 * unconditionally deleted before anyone could inspect it, leaving the
 * specific failing file/test permanently unrecoverable
 * (FAILURE_CLASSIFICATION=UNKNOWN_DUE_TO_EVIDENCE_DATA_LOSS). Retain
 * whenever the run was not a clean pass, or the summary itself couldn't be
 * parsed (`summary === null`) — never trust absence of a summary as
 * evidence of success.
 */
export function shouldRetainRawOutput(
  exitCode: number,
  summary: VitestJsonSummary | null
): boolean {
  return summary === null || exitCode !== 0 || summary.numFailedTests !== 0;
}
