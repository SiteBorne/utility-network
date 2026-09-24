import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export interface GrepImportProofDeps {
  exec: typeof execFileSync;
}

const defaultDeps: GrepImportProofDeps = { exec: execFileSync };

/**
 * Proves no non-test file under `dir` has an import/require/dynamic-import
 * specifier referencing `needle`. Unlike a raw recursive string grep, this
 * only matches actual module-specifier syntax and excludes `*.test.ts`
 * files -- those are never reachable from wrangler's `main` entrypoint
 * (see wrangler.toml) and are routinely used to document a sibling test
 * file's path in a comment, which is not an import edge.
 *
 * A subprocess failure that is not grep's own "no match" exit (1) --
 * ENOENT from a bad cwd, a permission error, an invalid pattern -- is
 * re-thrown rather than treated as "no matches", so a broken proof fails
 * loudly instead of passing vacuously.
 */
export function findImportSpecifierMatches(
  repoRootUrl: string | URL,
  dir: string,
  needle: string,
  deps: GrepImportProofDeps = defaultDeps
): string {
  const repoRoot = typeof repoRootUrl === 'string' ? repoRootUrl : fileURLToPath(repoRootUrl);
  const pattern = String.raw`(from\s+['"]|require\(\s*['"]|import\(\s*['"])[^'"]*${needle}`;
  try {
    return deps.exec(
      'grep',
      ['-rlE', '--include=*.ts', '--exclude=*.test.ts', pattern, dir],
      { cwd: repoRoot, encoding: 'utf-8' }
    );
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: string; code?: string };
    if (e.code || e.status === undefined || e.status > 1) {
      throw err;
    }
    return e.stdout ?? '';
  }
}
