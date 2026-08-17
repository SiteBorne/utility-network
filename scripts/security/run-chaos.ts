#!/usr/bin/env tsx
/**
 * SUN-1000 checkpoint 1N-A — deterministic v2 chaos / failure-injection
 * gate orchestrator.
 *
 * Runs the real, credential-free chaos matrix
 * (`apps/edge-api/tests/chaos-v2.test.ts`) via Vitest's JSON reporter,
 * then fails closed unless *every* named scenario in
 * `security/chaos/CHAOS_MATRIX.md` actually ran and passed — not merely
 * that the overall process exit code was 0. This catches the case a
 * generic "did vitest exit 0" check would miss: a scenario silently
 * skipped, renamed, or removed without anyone noticing, since Vitest
 * itself would still report success for the remaining tests.
 *
 * No provider credentials are used or required — every fault in the
 * matrix is injected at the `PaymentEvidenceProvider`/executor seam
 * already exposed by `apps/edge-api/src/control-plane/routes/
 * paid-services.ts`, never a real network call.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const OUTPUT_DIR = join(REPO_ROOT, 'security', 'output');
const OUTPUT_PATH = join(OUTPUT_DIR, 'chaos.json');
const TEST_FILE = join(REPO_ROOT, 'apps', 'edge-api', 'tests', 'chaos-v2.test.ts');
const VITEST_JSON_PATH = join(OUTPUT_DIR, 'chaos-vitest-report.json');

/** The exact, named, deterministic scenario set this gate requires —
 * kept here (not derived from the JSON report alone) so a scenario
 * silently dropped from the test file is a build-time-visible diff in
 * this file too, not just a runtime report artifact. */
export const REQUIRED_CHAOS_SCENARIOS = [
  'VERIFY_REJECTED: explicit provider rejection never executes the v2 service or settles',
  'VERIFY_TIMEOUT: a thrown verify failure returns a safe error, never a false success',
  'SERVICE_EXECUTION_ERROR: a throwing v2 executor never produces a false success or settlement',
  'SETTLEMENT_REJECTED: explicit settlement rejection never reports a paid success',
  'CONCURRENT_DUPLICATE_REQUEST: 10 concurrent same-binding v2 requests never double-execute or double-settle',
  'REPLAY_AFTER_SUCCESS: resubmitting a completed v2 payment reconstructs, never re-executes',
  'CROSS_MAJOR_COLLISION: a Payment-Identifier already bound on v1 is a conflict when reused on v2, never an independent lifecycle',
  'V2_NEVERMINED_FAIL_CLOSED: a Nevermined-shaped access token against a v2 route is rejected, never processed as a valid payment',
  'MODEL_D_RAIL_ISOLATION: a Nevermined-configured app still settles v2 exclusively via CDP, never Nevermined',
  'D1_TRANSIENT_ACQUIRE_FAILURE: a D1 failure during acquire never produces a false success',
  'PROCESS_RESTART_AT_PERSISTED_BOUNDARY: a v2 payment consumed through one app instance is recognized by a brand-new instance sharing the same D1',
  'DOCUMENT_WORKER_FAILURE: an unrecognized v2 document artifact fails safely, no false success, no settlement',
  'NO_SECRET_LEAK: a v2 verify-rejection response never leaks raw signature material or internal paths',
] as const;

export interface VitestJsonReport {
  testResults: Array<{
    assertionResults: Array<{ fullName: string; status: string }>;
  }>;
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  success: boolean;
}

/** Fails closed if any required scenario is missing from the report, or
 * present but not passed. Returns the list of problems (empty = clean). */
export function evaluateChaosReport(
  report: VitestJsonReport,
  required: readonly string[]
): string[] {
  const problems: string[] = [];
  const seen = new Map<string, string>();
  for (const file of report.testResults) {
    for (const assertion of file.assertionResults) {
      seen.set(assertion.fullName, assertion.status);
    }
  }
  for (const name of required) {
    const found = [...seen.entries()].find(([full]) => full.includes(name));
    if (!found) {
      problems.push(`missing required chaos scenario: "${name}"`);
      continue;
    }
    if (found[1] !== 'passed') {
      problems.push(`required chaos scenario did not pass (status=${found[1]}): "${name}"`);
    }
  }
  return problems;
}

async function main(): Promise<void> {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const result = spawnSync(
    'npx',
    ['vitest', 'run', TEST_FILE, '--reporter=json', `--outputFile=${VITEST_JSON_PATH}`],
    { cwd: REPO_ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }
  );

  if (!existsSync(VITEST_JSON_PATH)) {
    console.error('CHAOS: vitest did not produce a JSON report.');
    console.error(result.stdout);
    console.error(result.stderr);
    process.exitCode = 1;
    return;
  }

  const report = JSON.parse(readFileSync(VITEST_JSON_PATH, 'utf-8')) as VitestJsonReport;
  const problems = evaluateChaosReport(report, REQUIRED_CHAOS_SCENARIOS);

  const summary = {
    test_file: TEST_FILE,
    required_scenario_count: REQUIRED_CHAOS_SCENARIOS.length,
    total_tests: report.numTotalTests,
    passed_tests: report.numPassedTests,
    failed_tests: report.numFailedTests,
    vitest_exit_code: result.status,
    problems,
    report_path: VITEST_JSON_PATH,
  };
  writeFileSync(OUTPUT_PATH, JSON.stringify(summary, null, 2));

  // eslint-disable-next-line no-console
  console.log('Chaos summary:', summary);

  if (result.status !== 0 || problems.length > 0) {
    console.error('CHAOS: gate failed. See', OUTPUT_PATH);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error('CHAOS BOOTSTRAP/EXECUTION FAILURE:', e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  });
}
