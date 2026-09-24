import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CHECKER_REL = join('scripts', 'security', 'check-security-reporting.ts');
const TSX_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'tsx');

function runCheckerInSandbox(mutate: (sandbox: string) => void): {
  exitCode: number;
  stdout: string;
} {
  const sandbox = mkdtempSync(join(tmpdir(), 'security-reporting-check-'));
  try {
    for (const rel of [
      'SECURITY.md',
      'apps/edge-api/src/routes/security-txt.ts',
      'apps/network-site/.well-known/security.txt',
      'apps/edge-api/tests/security-txt.test.ts',
      CHECKER_REL,
    ]) {
      const dest = join(sandbox, rel);
      cpSync(join(REPO_ROOT, rel), dest, { recursive: false, force: true });
    }
    mutate(sandbox);
    try {
      // Run the SANDBOXED copy of the checker (not the real repo's), so its
      // own REPO_ROOT resolves inside the sandbox and it scans the mutated
      // fixture files, not the real working tree.
      const stdout = execFileSync(TSX_BIN, [join(sandbox, CHECKER_REL)], {
        cwd: sandbox,
        encoding: 'utf-8',
      });
      return { exitCode: 0, stdout };
    } catch (e) {
      const err = e as { status: number; stdout: string };
      return { exitCode: err.status, stdout: err.stdout };
    }
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

// These are genuine negative-fixture executions (Section 9): each mutates a
// sandboxed copy of the real current-surface files to introduce exactly one
// drift, then asserts the checker actually fails on it (not a mocked result).
describe('check-security-reporting (negative fixtures)', () => {
  it('fails when the static security.txt reverts to the stale contact', () => {
    const { exitCode, stdout } = runCheckerInSandbox((sandbox) => {
      const p = join(sandbox, 'apps/network-site/.well-known/security.txt');
      const body = readFileSync(p, 'utf-8').replace(
        'security@alerts.siteborne.net',
        'security@siteborne.net'
      );
      writeFileSync(p, body);
    });
    expect(exitCode).toBe(1);
    const result = JSON.parse(stdout);
    expect(result.SECURITY_REPORTING_CANONICAL_CONFIG).toBe('FAIL');
  });

  it('fails when an invented contact address is introduced', () => {
    const { exitCode, stdout } = runCheckerInSandbox((sandbox) => {
      const p = join(sandbox, 'apps/edge-api/src/routes/security-txt.ts');
      const body = readFileSync(p, 'utf-8').replace(
        "'Contact: mailto:security@alerts.siteborne.net',",
        "'Contact: mailto:security@alerts.siteborne.net',\n  'Contact: mailto:invented@example.com',"
      );
      writeFileSync(p, body);
    });
    expect(exitCode).toBe(1);
    const result = JSON.parse(stdout);
    expect(result.INVENTED_SECURITY_CONTACTS).toMatch(/^FAIL/);
  });

  it('passes cleanly on the unmutated current surfaces (positive control)', () => {
    const { exitCode, stdout } = runCheckerInSandbox(() => {});
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.SECURITY_REPORTING_CANONICAL_CONFIG).toBe('PASS');
    expect(result.SECURITY_CONTACT_CROSS_SURFACE_CONVERGENCE).toBe('PASS');
  });
});
