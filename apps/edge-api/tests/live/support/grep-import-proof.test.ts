import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { findImportSpecifierMatches, type GrepImportProofDeps } from './grep-import-proof';

function throwing(props: Record<string, unknown>): never {
  throw Object.assign(new Error('exec failed'), props);
}

describe('findImportSpecifierMatches', () => {
  it('resolves this repo checkout (whatever its own path looks like) to a real, existing directory', () => {
    const repoRootUrl = new URL('../../../../../', import.meta.url);
    const repoRoot = fileURLToPath(repoRootUrl);
    expect(repoRoot).not.toMatch(/%20/);
    expect(existsSync(repoRoot)).toBe(true);
    expect(existsSync(`${repoRoot}/apps/edge-api/src`)).toBe(true);
  });

  it('decodes a URL pathname containing an encoded space back to a literal space (the bug this replaces)', () => {
    // Regression proof for the actual defect: new URL(...).pathname left the
    // space percent-encoded ("%20"), producing a cwd that does not exist on
    // disk and made grep fail with ENOENT. fileURLToPath decodes it correctly.
    const synthetic = new URL('file:///Users/example/Some%20Directory%20With%20Spaces/');
    expect(synthetic.pathname).toBe('/Users/example/Some%20Directory%20With%20Spaces/');
    expect(fileURLToPath(synthetic)).toBe('/Users/example/Some Directory With Spaces/');
  });

  it('returns empty when the injected grep reports its real "no match" exit (1)', () => {
    const deps: GrepImportProofDeps = { exec: (() => throwing({ status: 1, stdout: '' })) as never };
    const matches = findImportSpecifierMatches('/repo', 'apps/edge-api/src', 'needle', deps);
    expect(matches).toBe('');
  });

  it('returns the match list when the injected grep reports a real match (exit 0)', () => {
    const deps: GrepImportProofDeps = {
      exec: (() => 'apps/edge-api/src/offender.ts\n') as never,
    };
    const matches = findImportSpecifierMatches('/repo', 'apps/edge-api/src', 'needle', deps);
    expect(matches.trim()).toBe('apps/edge-api/src/offender.ts');
  });

  it('re-throws (does not vacuously pass) on ENOENT from an invalid cwd', () => {
    const deps: GrepImportProofDeps = {
      exec: (() => throwing({ code: 'ENOENT', message: 'spawnSync grep ENOENT' })) as never,
    };
    expect(() => findImportSpecifierMatches('/nonexistent', 'apps/edge-api/src', 'needle', deps)).toThrow();
  });

  it('re-throws (does not vacuously pass) on a grep-internal error exit (2)', () => {
    const deps: GrepImportProofDeps = {
      exec: (() => throwing({ status: 2, stdout: '' })) as never,
    };
    expect(() => findImportSpecifierMatches('/repo', 'apps/edge-api/src', 'needle', deps)).toThrow();
  });
});
