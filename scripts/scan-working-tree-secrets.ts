import { spawnSync } from 'node:child_process';
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const configPath = join(repositoryRoot, '.gitleaks.toml');

function runGit(args: string[]): string {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed with status ${String(result.status)}`);
  }
  return result.stdout;
}

/**
 * Return the working-tree files that can enter a commit: tracked files plus
 * non-ignored untracked files. Intentionally ignored local credential stores
 * and ignored nested worktrees are not direct-scan inputs; if either is ever
 * committed, the preceding full-history `gitleaks git` phase scans it.
 */
export function listWorkingTreeScanPaths(): string[] {
  return runGit(['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
    .split('\0')
    .filter((path) => path.length > 0)
    .sort();
}

export function scanWorkingTree(): void {
  const scanRoot = mkdtempSync(join(tmpdir(), 'siteborne-working-tree-secrets-'));
  const paths = listWorkingTreeScanPaths();

  try {
    let copiedFiles = 0;
    for (const relativePath of paths) {
      const sourcePath = join(repositoryRoot, relativePath);
      const sourceStat = lstatSync(sourcePath);
      // Match `gitleaks dir`'s default: do not follow symlinks. Git history
      // still scans the committed link target text.
      if (!sourceStat.isFile()) continue;
      const destinationPath = join(scanRoot, relativePath);
      mkdirSync(dirname(destinationPath), { recursive: true });
      copyFileSync(sourcePath, destinationPath);
      copiedFiles += 1;
    }

    const result = spawnSync(
      'gitleaks',
      ['dir', '.', `--config=${configPath}`, '--redact', '--verbose'],
      { cwd: scanRoot, encoding: 'utf8', stdio: 'inherit' }
    );
    if (result.error || result.status === null) {
      throw new Error('Gitleaks working-tree scanner failed to execute');
    }
    if (result.status !== 0) process.exitCode = result.status;
    if (result.status === 0) {
      console.log(
        `Working-tree secret scan OK: ${copiedFiles} tracked/non-ignored-untracked files`
      );
    }
  } finally {
    rmSync(scanRoot, { recursive: true, force: true });
  }
}

scanWorkingTree();
