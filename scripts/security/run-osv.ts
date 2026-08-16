#!/usr/bin/env tsx
/**
 * SUN-1000 checkpoint 1B — deterministic dependency-vulnerability gate
 * (OSV-Scanner). Scans actual dependency manifests/locks
 * (`pnpm-lock.yaml` for the Node workspace; `services/modal-worker`'s
 * Python dependency state) using the pinned OSV-Scanner version.
 *
 * Blocking threshold: this repository has no separately documented
 * severity-threshold security policy (checked: no such policy exists in
 * `governance/`, `docs/decisions/`, or `docs/adrs/`). Per this
 * checkpoint's own instruction, a missing threshold policy is recorded
 * as a real security-governance gap, not silently invented — this
 * script's own conservative default (documented below) blocks on any
 * finding with a known fix available, which is deliberately a stand-in,
 * not an authoritative policy.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { bootstrapAll } from './bootstrap';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const OUTPUT_DIR = join(REPO_ROOT, 'security', 'output');
const OUTPUT_PATH = join(OUTPUT_DIR, 'osv-scanner.json');

interface OsvPackageVuln {
  id: string;
  aliases?: string[];
  summary?: string;
  severity?: Array<{ type: string; score: string }>;
  database_specific?: { severity?: string };
  affected?: Array<{ ranges?: Array<{ events?: Array<{ fixed?: string }> }> }>;
}

function vulnHasFix(vuln: OsvPackageVuln): boolean {
  return (vuln.affected ?? []).some((a) =>
    (a.ranges ?? []).some((r) => (r.events ?? []).some((e) => typeof e.fixed === 'string'))
  );
}
interface OsvPackageGroup {
  package: { name: string; version: string; ecosystem: string };
  vulnerabilities: OsvPackageVuln[];
  groups?: Array<{ ids: string[]; fixedVersions?: string[] }>;
}
interface OsvSource {
  source: { path: string; type: string };
  packages: OsvPackageGroup[];
}
interface OsvReport {
  results: OsvSource[];
}

async function main(): Promise<void> {
  const { osvScanner } = await bootstrapAll();
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const result = spawnSync(
    osvScanner,
    [
      'scan',
      'source',
      '--recursive',
      '--format',
      'json',
      '--output-file',
      OUTPUT_PATH,
      '--experimental-exclude',
      'node_modules',
      '--experimental-exclude',
      '.security-tools',
      '--experimental-exclude',
      'dist',
      '--experimental-exclude',
      '.venv',
      REPO_ROOT,
    ],
    { cwd: REPO_ROOT, stdio: 'inherit' }
  );

  // OSV-Scanner exit codes: 0 = clean, 1 = vulnerabilities found (a
  // successful run), 127/other = a genuine tool error.
  if (result.status !== 0 && result.status !== 1) {
    console.error(`OSV-SCANNER TOOL ERROR: exit code ${result.status}`);
    process.exitCode = 1;
    return;
  }
  if (!existsSync(OUTPUT_PATH)) {
    console.error('OSV-SCANNER FAILED: no structured output produced.');
    process.exitCode = 1;
    return;
  }

  const report = JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8')) as OsvReport;
  let total = 0;
  let withFix = 0;
  let withoutFix = 0;
  for (const source of report.results ?? []) {
    for (const pkg of source.packages) {
      for (const vuln of pkg.vulnerabilities) {
        total += 1;
        if (vulnHasFix(vuln)) withFix += 1;
        else withoutFix += 1;
      }
    }
  }

  // eslint-disable-next-line no-console
  console.log('OSV-Scanner summary:', {
    sources_scanned: report.results?.length ?? 0,
    total_vulnerabilities: total,
    with_fix_available: withFix,
    without_fix_available: withoutFix,
    blocking_policy:
      'STAND-IN: blocks only on findings with a known fix available (no documented repository severity-threshold policy exists — recorded as a governance gap, see checkpoint 1B report)',
    output: OUTPUT_PATH,
  });

  if (withFix > 0) {
    console.error(
      `OSV-SCANNER: ${withFix} vulnerabilit${withFix === 1 ? 'y' : 'ies'} with a fix available. See ${OUTPUT_PATH}.`
    );
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(
    'OSV-SCANNER BOOTSTRAP/EXECUTION FAILURE:',
    e instanceof Error ? e.message : String(e)
  );
  process.exitCode = 1;
});
