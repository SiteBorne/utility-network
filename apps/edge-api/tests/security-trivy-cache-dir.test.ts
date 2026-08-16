import { describe, expect, it } from 'vitest';
import { resolveCacheDir, RepositoryCacheDirError } from '../../../scripts/security/run-trivy';

/**
 * SUN-1000 checkpoint 1F — credential-free unit tests for the Trivy
 * cache-directory override introduced to work around this host's
 * repeated local disk-capacity constraint (checkpoint 1B: 1.1 GiB free;
 * checkpoint 1F: 2.9 GiB free — the same single APFS container both
 * times, no separate higher-capacity volume exists on this host). No
 * network access, no Trivy binary invocation, no credentials — pure
 * function tests only.
 */
describe('resolveCacheDir', () => {
  const REPO_ROOT = '/Users/example/SITEBORNE Utility Network';

  it('returns undefined when TRIVY_CACHE_DIR is unset (default Trivy cache location applies)', () => {
    expect(resolveCacheDir({}, REPO_ROOT)).toBeUndefined();
  });

  it('returns undefined when TRIVY_CACHE_DIR is empty string', () => {
    expect(resolveCacheDir({ TRIVY_CACHE_DIR: '' }, REPO_ROOT)).toBeUndefined();
  });

  it('returns the explicit override path when set to a safe external location', () => {
    const safePath = '/Users/example/Library/Caches/siteborne-security/trivy-cache';
    expect(resolveCacheDir({ TRIVY_CACHE_DIR: safePath }, REPO_ROOT)).toBe(safePath);
  });

  it('rejects a cache path exactly equal to the repository root', () => {
    expect(() => resolveCacheDir({ TRIVY_CACHE_DIR: REPO_ROOT }, REPO_ROOT)).toThrow(
      RepositoryCacheDirError
    );
  });

  it('rejects a cache path nested inside the repository root', () => {
    const insideRepo = `${REPO_ROOT}/.security-tools/trivy-cache`;
    expect(() => resolveCacheDir({ TRIVY_CACHE_DIR: insideRepo }, REPO_ROOT)).toThrow(
      RepositoryCacheDirError
    );
  });

  it('does not reject a sibling path that merely shares the repo root as a string prefix', () => {
    // "/Users/example/SITEBORNE Utility Network-other" is NOT inside
    // REPO_ROOT even though it shares the same string prefix — the
    // check must be directory-boundary-aware (repoRoot + '/'), not a
    // bare string startsWith(repoRoot).
    const sibling = `${REPO_ROOT}-other/trivy-cache`;
    expect(resolveCacheDir({ TRIVY_CACHE_DIR: sibling }, REPO_ROOT)).toBe(sibling);
  });
});
