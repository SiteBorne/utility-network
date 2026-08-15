/**
 * SUN-0900B checkpoint 1B — final credential-free hardening turn.
 * Credential-free, filesystem-free (validation is pure) unit tests for the
 * live persistence path safety guard.
 */
import { homedir, tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SITEBORNE_LIVE_D1_DIR_ENV,
  UnsafeLivePersistencePathError,
  resolveLivePersistencePath,
  validateLivePersistencePath,
} from '../src/control-plane/live-persistence-path';

const REPO_ROOT = resolve('/Users/meta4ickal/SITEBORNE Utility Network');

describe('validateLivePersistencePath', () => {
  it('accepts the default persistent application-data directory', () => {
    const candidate = join(
      homedir(),
      '.local',
      'share',
      'siteborne',
      'live-d1',
      'sun-0900b-checkpoint1'
    );
    expect(validateLivePersistencePath(candidate, REPO_ROOT)).toEqual({
      ok: true,
      path: resolve(candidate),
    });
  });

  it('accepts a safe explicit SITEBORNE_LIVE_D1_DIR-equivalent path', () => {
    const candidate = join(homedir(), '.local', 'state', 'siteborne-live');
    expect(validateLivePersistencePath(candidate, REPO_ROOT)).toEqual({
      ok: true,
      path: resolve(candidate),
    });
  });

  it.each([
    ['/tmp/siteborne-live', 'inside_os_temp_root'],
    [join(tmpdir(), 'siteborne-live'), 'inside_os_temp_root'],
    ['/var/tmp/siteborne-live', 'inside_os_temp_root'],
    [join(REPO_ROOT, '.state'), 'inside_repository_checkout'],
    [join(REPO_ROOT, 'node_modules', 'live-d1'), 'inside_repository_checkout'],
    ['/', 'is_root'],
    [homedir(), 'is_home_directory_itself'],
    ['', 'empty_path'],
  ] as const)('rejects %s as %s', (candidate, reason) => {
    expect(validateLivePersistencePath(candidate, REPO_ROOT)).toEqual({ ok: false, reason });
  });

  it('rejects any path containing a node_modules segment, even outside the repo checkout', () => {
    const candidate = join(homedir(), 'some-project', 'node_modules', 'live-d1');
    expect(validateLivePersistencePath(candidate, REPO_ROOT)).toEqual({
      ok: false,
      reason: 'inside_node_modules',
    });
  });

  it('a directory that merely starts with the same characters as a temp root is not falsely rejected', () => {
    // e.g. "/tmpfoo" is not "inside" "/tmp" — must not be a naive prefix
    // match on unterminated strings.
    const candidate = '/tmpfoo-not-actually-tmp/siteborne-live';
    const result = validateLivePersistencePath(candidate, REPO_ROOT);
    expect(result.ok).toBe(true);
  });
});

describe('resolveLivePersistencePath', () => {
  it('uses the default path when SITEBORNE_LIVE_D1_DIR is unset', () => {
    const path = resolveLivePersistencePath({ env: {}, repositoryRoot: REPO_ROOT });
    expect(path).toBe(
      resolve(homedir(), '.local', 'share', 'siteborne', 'live-d1', 'sun-0900b-checkpoint1')
    );
  });

  it('prefers an explicit, safe SITEBORNE_LIVE_D1_DIR override', () => {
    const override = join(homedir(), '.local', 'state', 'siteborne-live-override');
    const path = resolveLivePersistencePath({
      env: { [SITEBORNE_LIVE_D1_DIR_ENV]: override },
      repositoryRoot: REPO_ROOT,
    });
    expect(path).toBe(resolve(override));
  });

  it('throws UnsafeLivePersistencePathError immediately for an unsafe override — never lazily, never silently falling back to the default', () => {
    expect(() =>
      resolveLivePersistencePath({
        env: { [SITEBORNE_LIVE_D1_DIR_ENV]: '/tmp/siteborne-live-unsafe' },
        repositoryRoot: REPO_ROOT,
      })
    ).toThrow(UnsafeLivePersistencePathError);
  });

  it('never includes credential-shaped content in its own output — the resolved value is only ever a filesystem path', () => {
    const path = resolveLivePersistencePath({ env: {}, repositoryRoot: REPO_ROOT });
    expect(path).not.toMatch(/nvm|api[-_]?key|token|secret/i);
  });
});
