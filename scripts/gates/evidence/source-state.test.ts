/**
 * Uses an isolated temporary git repository, never the real monorepo working
 * tree: this suite runs concurrently with hundreds of other test files
 * during `pnpm test`, and another test
 * (scripts/verify-secret-scan-scope.regression.test.ts) asserts that
 * `git status` on the real repo is byte-stable across its own run. Mutating
 * real repo-root files here previously raced that assertion.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeSourceStateId } from './source-state.js';

let repoRoot: string;

function git(args: string[]): void {
  execFileSync('git', args, { cwd: repoRoot, stdio: 'pipe' });
}

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'source-state-test-repo-'));
  git(['init', '-q']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  writeFileSync(join(repoRoot, 'committed.txt'), 'initial\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'initial commit']);
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

describe('computeSourceStateId', () => {
  it('is identical across repeated calls with no source change', () => {
    expect(computeSourceStateId(repoRoot)).toBe(computeSourceStateId(repoRoot));
  });

  it('changes when an untracked candidate file is added, and restores when removed', () => {
    const before = computeSourceStateId(repoRoot);

    const scratch = join(repoRoot, 'untracked.txt');
    writeFileSync(scratch, 'v1');
    const afterAdd = computeSourceStateId(repoRoot);
    expect(afterAdd).not.toBe(before);

    writeFileSync(scratch, 'v2');
    const afterMutate = computeSourceStateId(repoRoot);
    expect(afterMutate).not.toBe(afterAdd);

    rmSync(scratch, { force: true });
    const afterRemove = computeSourceStateId(repoRoot);
    expect(afterRemove).toBe(before);
  });

  it('changes when a tracked file is mutated', () => {
    const before = computeSourceStateId(repoRoot);
    writeFileSync(join(repoRoot, 'committed.txt'), 'mutated\n');
    expect(computeSourceStateId(repoRoot)).not.toBe(before);
  });

  it('a one-byte mutation changes the id; reverting it restores the original', () => {
    const scratch = join(repoRoot, 'byte-probe.txt');
    writeFileSync(scratch, 'aaaa');
    git(['add', 'byte-probe.txt']);
    git(['commit', '-q', '-m', 'add byte-probe']);
    const original = computeSourceStateId(repoRoot);

    writeFileSync(scratch, 'aaab');
    const mutated = computeSourceStateId(repoRoot);
    expect(mutated).not.toBe(original);

    writeFileSync(scratch, 'aaaa');
    const reverted = computeSourceStateId(repoRoot);
    expect(reverted).toBe(original);
  });

  it('is unaffected by files under a gitignored directory', () => {
    writeFileSync(join(repoRoot, '.gitignore'), '.release-evidence/\n');
    git(['add', '.gitignore']);
    git(['commit', '-q', '-m', 'add gitignore']);

    const before = computeSourceStateId(repoRoot);
    const ignoredDir = join(repoRoot, '.release-evidence');
    mkdirSync(ignoredDir, { recursive: true });
    writeFileSync(join(ignoredDir, 'scratch.tmp'), 'ignored content');

    expect(computeSourceStateId(repoRoot)).toBe(before);
  });
});
