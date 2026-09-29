import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const SCRIPT = `${REPO}scripts/release/check-evidence-firewall.mts`;
const run = (cwd: string, extra: string[] = []) =>
  spawnSync('npx', ['--no-install', 'tsx', '--tsconfig', `${REPO}tsconfig.base.json`, SCRIPT, ...extra], {
    cwd,
    encoding: 'utf8',
  });
const json = (s: string) => JSON.parse(s.slice(s.indexOf('{')));

describe('R3-57A evidence firewall is location independent and non-vacuous', () => {
  for (const [name, cwd] of [
    ['repo root', REPO],
    ['package dir', `${REPO}packages/evidence-graph`],
    ['unrelated dir', tmpdir()],
  ] as const) {
    it(`scans real files from ${name}`, () => {
      const r = run(cwd);
      expect(r.status).toBe(0);
      const j = json(r.stdout);
      expect(j.runtime_files_checked).toBeGreaterThan(0);
      expect(j.authority_modules_present).toBeGreaterThan(0);
      expect(j.EVIDENCE_AUTHORITY_FIREWALL).toBe('PASS');
    });
  }
  it('FAILS when pointed at a tree with nothing to check', () => {
    const r = run(REPO, ['--root', tmpdir()]);
    expect(r.status).toBe(1);
    const j = json(r.stdout);
    expect(j.runtime_files_checked).toBe(0);
    expect(j.EVIDENCE_AUTHORITY_FIREWALL).toBe('FAIL');
  });
});
