/**
 * Deterministic SOURCE_STATE_ID: a content-addressed fingerprint of the exact
 * working tree a dynamic gate ran against. Reuses git's own content-addressing
 * (`git hash-object`) rather than inventing a new one — HEAD alone is
 * insufficient because the candidate is not committed yet, so tracked diffs
 * and untracked files must participate too.
 *
 * `git status --porcelain` never lists gitignored paths, so the evidence
 * directory itself (gitignored) naturally never affects this id — that is
 * what makes evidence storage candidate-neutral, with no special-casing.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

export function computeSourceStateId(repoRoot: string = REPO_ROOT): string {
  const headSha = git(['rev-parse', 'HEAD'], repoRoot).trim();
  const statusOutput = git(['status', '--porcelain=v1', '--untracked-files=all'], repoRoot);

  const deletedPaths: string[] = [];
  const pathsToHash: string[] = [];
  for (const rawLine of statusOutput.split('\n')) {
    if (!rawLine.trim()) continue;
    const statusCode = rawLine.slice(0, 2);
    let filePath = rawLine.slice(3);

    if (statusCode.includes('R')) {
      // "old -> new"
      filePath = filePath.split(' -> ')[1] ?? filePath;
    }

    if (statusCode.includes('D')) {
      deletedPaths.push(`DELETED:${filePath}`);
      continue;
    }

    pathsToHash.push(filePath);
  }

  // One `git hash-object` call for every changed path, instead of one spawn
  // per file — each spawn costs ~100ms+, which adds up fast on a large diff.
  const entries: string[] = [...deletedPaths];
  if (pathsToHash.length > 0) {
    const hashes = git(['hash-object', ...pathsToHash], repoRoot)
      .trim()
      .split('\n');
    pathsToHash.forEach((filePath, i) => {
      entries.push(`${filePath}:${hashes[i]}`);
    });
  }

  entries.sort();

  const hasher = createHash('sha256');
  hasher.update(headSha);
  hasher.update('\n');
  hasher.update(entries.join('\n'));
  return hasher.digest('hex');
}
