#!/usr/bin/env tsx
/**
 * SUN-1000 checkpoint 1B — deterministic Semgrep security gate.
 *
 * Scans first-party security-relevant code (apps/, packages/, services/,
 * scripts/) using the pinned Semgrep version, provisioned via
 * `bootstrap.ts` (never assumes a global install). Emits structured JSON
 * evidence to `security/output/semgrep.json` (gitignored) plus a
 * human-readable summary, and fails closed — a tool/config error is
 * never silently reported as "zero findings."
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { bootstrapAll } from './bootstrap';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const OUTPUT_DIR = join(REPO_ROOT, 'security', 'output');
const OUTPUT_PATH = join(OUTPUT_DIR, 'semgrep.json');

const SCAN_TARGETS = ['apps', 'packages', 'services', 'scripts'];
// Community ruleset, free, no login required — covers OWASP-class
// findings across this project's actual languages (TS/JS, Python).
const RULESET = 'p/ci';

async function main(): Promise<void> {
  const { semgrep } = await bootstrapAll();
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const result = spawnSync(
    semgrep,
    [
      'scan',
      `--config=${RULESET}`,
      '--json',
      '--output',
      OUTPUT_PATH,
      '--exclude',
      'node_modules',
      '--exclude',
      'dist',
      '--exclude',
      '.venv',
      '--exclude',
      '.security-tools',
      // Deliberately NOT excluding *.test.ts/*.test.py — tests, live
      // payment harnesses, document-processing code, and network
      // adapters must stay in scope (this checkpoint's own explicit
      // instruction: no blanket exclusion of those categories).
      ...SCAN_TARGETS.filter((t) => existsSync(join(REPO_ROOT, t))),
    ],
    { cwd: REPO_ROOT, stdio: 'inherit' }
  );

  // Semgrep's own exit codes: 0 = ran clean, 1 = findings present (still
  // a successful run, not a tool error), >1 = genuine tool/config error.
  if (result.status !== 0 && result.status !== 1) {
    console.error(`SEMGREP TOOL/CONFIG ERROR: exit code ${result.status}`);
    process.exitCode = 1;
    return;
  }
  if (!existsSync(OUTPUT_PATH)) {
    console.error('SEMGREP FAILED: no structured output produced despite a non-error exit code.');
    process.exitCode = 1;
    return;
  }

  const report = JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8')) as {
    results: Array<{
      check_id: string;
      path: string;
      start: { line: number };
      extra: { severity: string; message: string };
    }>;
    errors?: unknown[];
  };
  const blocking = report.results.filter((r) => r.extra.severity === 'ERROR');
  const nonBlocking = report.results.filter((r) => r.extra.severity !== 'ERROR');

  // eslint-disable-next-line no-console
  console.log('Semgrep summary:', {
    total_findings: report.results.length,
    blocking_error_severity: blocking.length,
    nonblocking: nonBlocking.length,
    tool_errors: report.errors?.length ?? 0,
    output: OUTPUT_PATH,
  });

  if (blocking.length > 0) {
    console.error(
      `SEMGREP: ${blocking.length} blocking (error-severity) finding(s). See ${OUTPUT_PATH}.`
    );
    process.exitCode = 1;
  }
  if ((report.errors?.length ?? 0) > 0) {
    console.error(`SEMGREP: ${report.errors!.length} tool-reported scan error(s).`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('SEMGREP BOOTSTRAP/EXECUTION FAILURE:', e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
