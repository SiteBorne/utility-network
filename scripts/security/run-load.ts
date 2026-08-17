#!/usr/bin/env tsx
/**
 * SUN-1000 checkpoint 1N-B — deterministic v2 load/capacity gate
 * orchestrator.
 *
 * Mirrors run-chaos.ts's proven pattern exactly: shells out to Vitest
 * against the real, self-contained load campaign
 * (`apps/edge-api/tests/load-v2.test.ts`, which boots a real
 * @hono/node-server HTTP listener on a real ephemeral port and runs
 * bounded WARMUP/STEADY_CONCURRENCY/BURST/D1_CONTENTION/MIXED_SERVICE/
 * DUPLICATE_ID_CONTENTION/RESOURCE_STABILITY profiles against it), then
 * fails closed unless *every* required named scenario actually ran and
 * passed -- not merely that the overall vitest process exited 0. This
 * is the same protection run-chaos.ts already relies on: a scenario
 * silently skipped, renamed, or removed would otherwise go unnoticed.
 *
 * This gate is a regression guard against measured local capacity, not
 * a production SLA/SLO. No provider credentials are used or required;
 * every request is a real local HTTP round-trip against the real v2
 * routes using the accepted synthetic buyer-signature fixture pattern
 * already used throughout security:chaos and security:schemathesis.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const OUTPUT_DIR = join(REPO_ROOT, 'security', 'output');
const OUTPUT_PATH = join(OUTPUT_DIR, 'load.json');
const TEST_FILES = [join(REPO_ROOT, 'apps', 'edge-api', 'tests', 'load-v2.test.ts')];
const VITEST_JSON_PATH = join(OUTPUT_DIR, 'load-vitest-report.json');

/** The exact, named, deterministic profile set this gate requires --
 * kept here (not derived from the JSON report alone) so a profile
 * silently dropped from the test file is a build-time-visible diff in
 * this file too, not just a runtime report artifact. */
export const REQUIRED_LOAD_SCENARIOS = [
  'WARMUP: a small, low-concurrency run against all four v2 services establishes the release-gate baseline',
  'STEADY_CONCURRENCY: bounded sustained concurrency across all four v2 services stays within the release-gate threshold',
  'BURST: a short bounded concurrency spike completes with zero unexpected failures',
  'D1_CONTENTION: concurrent unique-identifier requests against the same service exercise real D1 acquire/settle paths with zero contention errors',
  'MIXED_SERVICE: an even distribution across all four v2 services reports no single service silently dominating or failing',
  'DUPLICATE_ID_CONTENTION: 10 concurrent requests sharing one Payment-Identifier and the same quote binding produce at most one successful lifecycle, never duplicate execution',
  'RESOURCE_STABILITY: memory does not grow catastrophically across the full campaign',
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
export function evaluateLoadReport(
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
      problems.push(`missing required load scenario: "${name}"`);
      continue;
    }
    if (found[1] !== 'passed') {
      problems.push(`required load scenario did not pass (status=${found[1]}): "${name}"`);
    }
  }
  return problems;
}

async function main(): Promise<void> {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const result = spawnSync(
    'npx',
    ['vitest', 'run', ...TEST_FILES, '--reporter=json', `--outputFile=${VITEST_JSON_PATH}`],
    { cwd: REPO_ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }
  );

  if (!existsSync(VITEST_JSON_PATH)) {
    console.error('LOAD: vitest did not produce a JSON report.');
    console.error(result.stdout);
    console.error(result.stderr);
    process.exitCode = 1;
    return;
  }

  const report = JSON.parse(readFileSync(VITEST_JSON_PATH, 'utf-8')) as VitestJsonReport;
  const problems = evaluateLoadReport(report, REQUIRED_LOAD_SCENARIOS);

  const summary = {
    test_files: TEST_FILES,
    required_scenario_count: REQUIRED_LOAD_SCENARIOS.length,
    total_tests: report.numTotalTests,
    passed_tests: report.numPassedTests,
    failed_tests: report.numFailedTests,
    vitest_exit_code: result.status,
    problems,
    report_path: VITEST_JSON_PATH,
  };
  writeFileSync(OUTPUT_PATH, JSON.stringify(summary, null, 2));

  // eslint-disable-next-line no-console
  console.log('Load summary:', summary);

  if (result.status !== 0 || problems.length > 0) {
    console.error('LOAD: gate failed. See', OUTPUT_PATH);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error('LOAD BOOTSTRAP/EXECUTION FAILURE:', e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  });
}
