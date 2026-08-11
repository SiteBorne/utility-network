import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { beforeEach, expect, it, vi } from 'vitest';

const scannerState = vi.hoisted(() => ({
  mode: 'real' as 'real' | 'execution-error',
  targets: [] as string[],
}));

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    // Reproduce the old canary defect without embedding a token literal:
    // these 27 synthetic bytes Base64URL-encode to 36 token-shaped but
    // insufficiently entropic characters, which Gitleaks correctly rejects.
    randomBytes: () => Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij', 'base64url'),
  };
});

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawnSync: (...args: Parameters<typeof actual.spawnSync>) => {
      const [command, commandArgs] = args;
      if (command === 'gitleaks') {
        const target = Array.isArray(commandArgs) ? commandArgs[1] : undefined;
        if (typeof target === 'string') scannerState.targets.push(target);
        if (scannerState.mode === 'execution-error') {
          return {
            pid: 0,
            output: [null, '', ''],
            stdout: '',
            stderr: '',
            status: null,
            signal: null,
            error: new Error('synthetic scanner execution failure'),
          };
        }
      }
      return actual.spawnSync(...args);
    },
  };
});

const repositoryRoot = resolve(import.meta.dirname, '..');
const configPath = join(repositoryRoot, '.gitleaks.toml');

function scopeProbeRoots(): string[] {
  return readdirSync(tmpdir())
    .filter((entry) => entry.startsWith('siteborne-secret-scope-'))
    .sort();
}

function gitStatus(): string {
  const result = spawnSync('git', ['status', '--short'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error('git status failed in regression test');
  return result.stdout;
}

beforeEach(() => {
  vi.resetModules();
  scannerState.mode = 'real';
  scannerState.targets = [];
});

it('keeps the source-scope canary detectable regardless of random-byte output', async () => {
  await expect(import('./verify-secret-scan-scope')).resolves.toBeDefined();
}, 30_000);

it('runs Gitleaks against every required risk-class probe, including source and reports', async () => {
  await import('./verify-secret-scan-scope');

  const expectedSuffixes = [
    'apps/edge-api/src/secret-scope-probe.ts',
    'package.json',
    'TASKS.yaml',
    'PROJECT_STATE.yaml',
    'docs/reports/secret-scope-probe.md',
    'migrations/secret-scope-probe.sql',
    'scripts/secret-scope-probe.sh',
    'packages/contracts/generated/secret-scope-probe.json',
    'apps/edge-api/tests/live/secret-scope-probe.ts',
  ];

  for (const suffix of expectedSuffixes) {
    expect(scannerState.targets.some((target) => target.endsWith(suffix))).toBe(true);
  }
}, 30_000);

it('does not classify a clean untracked source file as a detected canary', () => {
  const root = mkdtempSync(join(tmpdir(), 'siteborne-secret-clean-control-'));
  const path = join(root, 'apps/edge-api/src/secret-scope-probe.ts');
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'secret_scan_canary=synthetic-clean-control\n', { mode: 0o600 });
    const result = spawnSync(
      'gitleaks',
      ['dir', path, `--config=${configPath}`, '--redact', '--no-banner', '--exit-code=7'],
      { cwd: repositoryRoot, encoding: 'utf8' }
    );
    expect(result.status).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('fails closed with a distinct scanner-execution error and cleans the temporary probe tree', async () => {
  const rootsBefore = scopeProbeRoots();
  scannerState.mode = 'execution-error';

  await expect(import('./verify-secret-scan-scope')).rejects.toThrow(
    'Gitleaks scanner failed to execute'
  );
  expect(scopeProbeRoots()).toEqual(rootsBefore);
}, 30_000);

it('cleans every temporary probe and preserves repository status after successful verification', async () => {
  const rootsBefore = scopeProbeRoots();
  const statusBefore = gitStatus();

  await import('./verify-secret-scan-scope');

  expect(scopeProbeRoots()).toEqual(rootsBefore);
  expect(gitStatus()).toBe(statusBefore);
}, 30_000);

it('does not require ignored dependency or virtual-environment trees in tracked scan scope', async () => {
  const ignoredTrees = spawnSync('git', ['ls-files', 'node_modules', '.venv', 'venv'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  expect(ignoredTrees.status).toBe(0);
  expect(ignoredTrees.stdout).toBe('');
  await expect(import('./verify-secret-scan-scope')).resolves.toBeDefined();
}, 30_000);
