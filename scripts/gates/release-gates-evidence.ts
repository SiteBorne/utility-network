#!/usr/bin/env tsx
/**
 * Canonical execution command for the two dynamic release gates
 * (BROAD_TEST_SUITE, NEGATIVE_FIXTURE_SUITE): run the real suite to
 * completion, capture its exit code and real counts, and bind the result to
 * the exact SOURCE_STATE_ID it ran against. release-gates-local.ts trusts
 * nothing here except the written evidence file — a killed/interrupted run
 * simply never writes valid evidence, so it can never read back as PASS.
 *
 * Usage: tsx scripts/gates/release-gates-evidence.ts <broad|negative>
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CANONICAL_EXECUTION_PROFILE,
  executionProfileId,
  vitestArgsForProfile,
} from './evidence/execution-profile.js';
import { computeSourceStateId } from './evidence/source-state.js';
import { writeEvidence } from './evidence/store.js';
import type { BroadTestSuiteEvidence, NegativeFixtureSuiteEvidence } from './evidence/types.js';
import {
  fileCounts,
  shouldRetainRawOutput,
  type VitestJsonSummary,
} from './evidence/vitest-summary.js';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

function runVitestJson(
  args: string[],
  outputFile: string
): { exitCode: number; summary: VitestJsonSummary | null } {
  let exitCode = 0;
  try {
    execFileSync(
      'npx',
      [
        'vitest',
        'run',
        '--reporter=json',
        `--outputFile=${outputFile}`,
        ...vitestArgsForProfile(CANONICAL_EXECUTION_PROFILE),
        ...args,
      ],
      {
        cwd: REPO_ROOT,
        stdio: 'pipe',
      }
    );
  } catch (e) {
    const err = e as { status?: number };
    exitCode = typeof err.status === 'number' ? err.status : 1;
  }

  let summary: VitestJsonSummary | null = null;
  try {
    summary = JSON.parse(readFileSync(outputFile, 'utf8'));
  } catch {
    summary = null;
  }
  return { exitCode, summary };
}

function runBroadTestSuite(): void {
  const sourceStateIdBefore = computeSourceStateId();
  const startedAt = new Date().toISOString();
  const rawOutputFile = join(REPO_ROOT, '.release-evidence', 'broad-raw.json');

  const { exitCode, summary } = runVitestJson([], rawOutputFile);
  const completedAt = new Date().toISOString();
  // Keep the raw per-test output when the run failed so the specific
  // failing file/test can be diagnosed; only clean up on a clean pass.
  if (!shouldRetainRawOutput(exitCode, summary)) rmSync(rawOutputFile, { force: true });

  if (!summary) {
    console.error('BROAD_TEST_SUITE: could not parse vitest JSON summary; no evidence written');
    process.exitCode = 1;
    return;
  }

  const files = fileCounts(summary);
  const record: BroadTestSuiteEvidence = {
    schema_version: 1,
    gate_id: 'BROAD_TEST_SUITE',
    // Bind to the state the run actually executed against, not whatever
    // exists after it (the suite itself never touches candidate source, but
    // this is the correct binding semantics regardless).
    source_state_id: sourceStateIdBefore,
    command: `vitest run ${vitestArgsForProfile(CANONICAL_EXECUTION_PROFILE).join(' ')}`,
    execution_profile: executionProfileId(CANONICAL_EXECUTION_PROFILE),
    started_at: startedAt,
    completed_at: completedAt,
    exit_code: exitCode,
    result: exitCode === 0 && summary.numFailedTests === 0 ? 'PASS' : 'FAIL',
    summary: {
      test_files_passed: files.passed,
      test_files_failed: files.failed,
      test_files_skipped: files.skipped,
      tests_passed: summary.numPassedTests,
      tests_failed: summary.numFailedTests,
      tests_skipped: summary.numPendingTests,
    },
  };
  writeEvidence(record);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(record, null, 2));
  if (record.result !== 'PASS') process.exitCode = 1;
}

const NEGATIVE_FIXTURE_FILES = [
  'scripts/gates/check-v3-service-parity.test.ts',
  'scripts/security/check-security-reporting.test.ts',
];

function runNegativeFixtureSuite(): void {
  const sourceStateIdBefore = computeSourceStateId();
  const startedAt = new Date().toISOString();
  const rawOutputFile = join(REPO_ROOT, '.release-evidence', 'negative-fixture-raw.json');

  const { exitCode, summary } = runVitestJson(NEGATIVE_FIXTURE_FILES, rawOutputFile);
  const completedAt = new Date().toISOString();
  if (!shouldRetainRawOutput(exitCode, summary)) rmSync(rawOutputFile, { force: true });

  if (!summary) {
    console.error(
      'NEGATIVE_FIXTURE_SUITE: could not parse vitest JSON summary; no evidence written'
    );
    process.exitCode = 1;
    return;
  }

  const record: NegativeFixtureSuiteEvidence = {
    schema_version: 1,
    gate_id: 'NEGATIVE_FIXTURE_SUITE',
    source_state_id: sourceStateIdBefore,
    command: `vitest run ${vitestArgsForProfile(CANONICAL_EXECUTION_PROFILE).join(' ')} ${NEGATIVE_FIXTURE_FILES.join(' ')}`,
    execution_profile: executionProfileId(CANONICAL_EXECUTION_PROFILE),
    started_at: startedAt,
    completed_at: completedAt,
    exit_code: exitCode,
    result: exitCode === 0 && summary.numFailedTests === 0 ? 'PASS' : 'FAIL',
    summary: {
      fixtures_total: summary.numTotalTests,
      fixtures_passing: summary.numPassedTests,
      fixtures_failing: summary.numFailedTests,
    },
  };
  writeEvidence(record);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(record, null, 2));
  if (record.result !== 'PASS') process.exitCode = 1;
}

function main(): void {
  const which = process.argv[2];
  if (which === 'broad') runBroadTestSuite();
  else if (which === 'negative') runNegativeFixtureSuite();
  else {
    console.error('Usage: tsx scripts/gates/release-gates-evidence.ts <broad|negative>');
    process.exitCode = 1;
  }
}

main();
