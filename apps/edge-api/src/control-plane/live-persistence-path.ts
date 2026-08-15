/**
 * Persistent live D1 storage location for the Nevermined checkpoint live
 * harness (SUN-0900B checkpoint 1B, final credential-free hardening turn).
 *
 * The prior design stored the sole durable recovery substrate for a real
 * payment under `$TMPDIR` (a real, now-materialized failure mode: the
 * directory was gone by the next turn, most likely reclaimed by the host
 * OS's own temp-directory lifecycle — proven conclusion:
 * `TEMPORARY_STORAGE_INSUFFICIENT_FOR_MULTI_DAY_PAYMENT_RECOVERY`, not a
 * specific claim about which cleanup mechanism did it). This module
 * resolves a location outside any OS-temporary root, and rejects unsafe
 * locations (temp roots, the repository checkout, `node_modules`, `/`,
 * `$HOME` itself, empty) before any live external mutation can occur.
 *
 * The resolved path is never secret and never enters any payment hash,
 * PCC, receipt, or `PaymentServiceLink` — it is purely an operational
 * filesystem location.
 */
import { homedir, tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import { mkdirSync, chmodSync } from 'node:fs';

export const SITEBORNE_LIVE_D1_DIR_ENV = 'SITEBORNE_LIVE_D1_DIR' as const;

const DEFAULT_RELATIVE_PATH = ['.local', 'share', 'siteborne', 'live-d1', 'sun-0900b-checkpoint1'];

export type LivePersistencePathRejection =
  | 'inside_os_temp_root'
  | 'inside_repository_checkout'
  | 'inside_node_modules'
  | 'is_root'
  | 'is_home_directory_itself'
  | 'empty_path';

export type LivePersistencePathResolution =
  | { ok: true; path: string }
  | { ok: false; reason: LivePersistencePathRejection };

function normalized(path: string): string {
  // Trailing separators make prefix comparison unreliable
  // ("/tmpfoo".startsWith("/tmp") is a false positive the other direction,
  // but "/tmp".startsWith("/tmp/") is a false negative) — comparing
  // resolved, separator-terminated forms avoids both.
  const r = resolve(path);
  return r.endsWith(sep) ? r : r + sep;
}

function isInside(candidate: string, root: string): boolean {
  return normalized(candidate).startsWith(normalized(root));
}

/** Every OS-temp-shaped root this guard rejects, resolved once. macOS's
 * per-user `/var/folders/.../T` (what `os.tmpdir()` actually returns there)
 * is covered by resolving `tmpdir()` itself, not by hardcoding `/tmp`. */
function knownTempRoots(): string[] {
  const roots = new Set<string>(['/tmp', '/var/tmp', tmpdir()]);
  if (process.env.TMPDIR) roots.add(process.env.TMPDIR);
  return [...roots];
}

/**
 * Validates a candidate persistence directory against the live path safety
 * policy. Pure — never touches the filesystem. Called BEFORE any live
 * external mutation (delegation creation, token acquisition, verify,
 * execution, settlement) is ever reachable.
 */
export function validateLivePersistencePath(
  candidate: string,
  repositoryRoot: string
): LivePersistencePathResolution {
  if (!candidate || candidate.trim().length === 0) {
    return { ok: false, reason: 'empty_path' };
  }
  const resolvedPath = resolve(candidate);
  const home = resolve(homedir());
  if (resolvedPath === resolve('/')) {
    return { ok: false, reason: 'is_root' };
  }
  if (resolvedPath === home) {
    return { ok: false, reason: 'is_home_directory_itself' };
  }
  for (const root of knownTempRoots()) {
    if (isInside(resolvedPath, root)) {
      return { ok: false, reason: 'inside_os_temp_root' };
    }
  }
  if (isInside(resolvedPath, repositoryRoot)) {
    return { ok: false, reason: 'inside_repository_checkout' };
  }
  if (resolvedPath.split(sep).includes('node_modules')) {
    return { ok: false, reason: 'inside_node_modules' };
  }
  return { ok: true, path: resolvedPath };
}

export class UnsafeLivePersistencePathError extends Error {
  constructor(public readonly reason: LivePersistencePathRejection) {
    super(`unsafe_live_persistence_path:${reason}`);
    this.name = 'UnsafeLivePersistencePathError';
  }
}

/**
 * Resolution order: explicit `SITEBORNE_LIVE_D1_DIR` env override, else
 * `$HOME/.local/share/siteborne/live-d1/sun-0900b-checkpoint1`. Throws
 * immediately (never lazily, never after a live call has already started)
 * if the resolved path fails `validateLivePersistencePath`. Never logs or
 * returns credential material — the path itself is the only output.
 */
export function resolveLivePersistencePath(options: {
  env?: NodeJS.ProcessEnv;
  repositoryRoot: string;
}): string {
  const env = options.env ?? process.env;
  const override = env[SITEBORNE_LIVE_D1_DIR_ENV];
  const candidate = override && override.trim().length > 0 ? override : defaultPath();
  const validation = validateLivePersistencePath(candidate, options.repositoryRoot);
  if (!validation.ok) {
    throw new UnsafeLivePersistencePathError(validation.reason);
  }
  return validation.path;
}

function defaultPath(): string {
  return resolve(homedir(), ...DEFAULT_RELATIVE_PATH);
}

/**
 * Creates the resolved directory (and its parents) if it doesn't exist,
 * and — where the platform supports it — restricts it to the owning user
 * only (`0700`). Never prints credential contents; this function never
 * receives any.
 */
export function ensureLivePersistenceDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  try {
    chmodSync(path, 0o700);
  } catch {
    // Best-effort on platforms where chmod semantics differ (e.g. some
    // Windows filesystems) — directory creation above already succeeded,
    // and this is a defense-in-depth hardening step, not the sole control.
  }
}
