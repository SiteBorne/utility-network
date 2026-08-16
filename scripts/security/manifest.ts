/**
 * SUN-1000 checkpoint 1B — pure, network-free logic for resolving and
 * verifying the pinned security-scanner manifest (`security/tool-
 * versions.json`). Deliberately separated from `bootstrap.ts`'s actual
 * network/filesystem side effects so it can be unit-tested without a
 * network call or a multi-hundred-MB vulnerability database download —
 * per this checkpoint's own explicit instruction.
 */
import { createHash } from 'node:crypto';

export type SupportedPlatformKey = 'darwin-arm64' | 'darwin-x64' | 'linux-x64' | 'linux-arm64';

export interface BinaryAsset {
  url: string;
  sha256: string;
}

export interface BinaryToolManifestEntry {
  version: string;
  provenance: string;
  checksums_source: string;
  install_method: 'binary' | 'tarball';
  assets: Partial<Record<SupportedPlatformKey, BinaryAsset>>;
}

export interface SemgrepManifestEntry {
  version: string;
  provenance: string;
  install_method: 'pip';
}

export interface ToolVersionsManifest {
  semgrep: SemgrepManifestEntry;
  'osv-scanner': BinaryToolManifestEntry;
  trivy: BinaryToolManifestEntry;
}

export class UnsupportedPlatformError extends Error {
  constructor(
    public readonly tool: string,
    public readonly platformKey: string
  ) {
    super(`unsupported_platform: ${tool} has no pinned asset for platform "${platformKey}"`);
    this.name = 'UnsupportedPlatformError';
  }
}

export class ChecksumMismatchError extends Error {
  constructor(
    public readonly tool: string,
    public readonly expected: string,
    public readonly actual: string
  ) {
    super(`checksum_mismatch: ${tool} expected sha256 ${expected}, got ${actual}`);
    this.name = 'ChecksumMismatchError';
  }
}

/** Maps Node's own `process.platform`/`process.arch` to the manifest's
 * platform-key naming. Throws (fails closed) on any combination the
 * manifest does not explicitly enumerate — an unsupported platform must
 * never silently fall through to downloading the wrong asset. */
export function resolvePlatformKey(
  nodePlatform: NodeJS.Platform,
  nodeArch: NodeJS.Architecture
): SupportedPlatformKey {
  if (nodePlatform === 'darwin' && nodeArch === 'arm64') return 'darwin-arm64';
  if (nodePlatform === 'darwin' && nodeArch === 'x64') return 'darwin-x64';
  if (nodePlatform === 'linux' && nodeArch === 'x64') return 'linux-x64';
  if (nodePlatform === 'linux' && nodeArch === 'arm64') return 'linux-arm64';
  throw new UnsupportedPlatformError('(platform detection)', `${nodePlatform}-${nodeArch}`);
}

/** Resolves the pinned asset for a tool on the given platform, or throws
 * `UnsupportedPlatformError` — never returns undefined, never guesses a
 * fallback asset. */
export function resolveAsset(
  tool: string,
  entry: BinaryToolManifestEntry,
  platformKey: SupportedPlatformKey
): BinaryAsset {
  const asset = entry.assets[platformKey];
  if (!asset) {
    throw new UnsupportedPlatformError(tool, platformKey);
  }
  return asset;
}

/** Verifies a downloaded buffer's SHA256 against the pinned checksum.
 * Throws `ChecksumMismatchError` (fail closed) rather than returning a
 * boolean a caller could accidentally ignore. */
export function verifyChecksum(tool: string, data: Uint8Array, expectedSha256: string): void {
  const actual = createHash('sha256').update(data).digest('hex');
  if (actual.toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new ChecksumMismatchError(tool, expectedSha256.toLowerCase(), actual);
  }
}

/** Validates the manifest's own structural shape before any tool tries
 * to use it — a malformed or hand-edited manifest fails closed here,
 * not deep inside a network call. */
export function validateManifestShape(raw: unknown): raw is ToolVersionsManifest {
  if (!raw || typeof raw !== 'object') return false;
  const m = raw as Record<string, unknown>;
  const semgrep = m.semgrep as SemgrepManifestEntry | undefined;
  if (!semgrep || semgrep.install_method !== 'pip' || typeof semgrep.version !== 'string') {
    return false;
  }
  for (const key of ['osv-scanner', 'trivy'] as const) {
    const entry = m[key] as BinaryToolManifestEntry | undefined;
    if (
      !entry ||
      typeof entry.version !== 'string' ||
      typeof entry.checksums_source !== 'string' ||
      (entry.install_method !== 'binary' && entry.install_method !== 'tarball') ||
      !entry.assets ||
      typeof entry.assets !== 'object'
    ) {
      return false;
    }
    for (const asset of Object.values(entry.assets)) {
      const a = asset as BinaryAsset;
      if (typeof a.url !== 'string' || !/^[a-f0-9]{64}$/i.test(a.sha256)) {
        return false;
      }
    }
  }
  return true;
}
