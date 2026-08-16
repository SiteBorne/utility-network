/**
 * SUN-1000 checkpoint 1B — credential-free, network-free tests for the
 * security-scanner provisioning manifest's pure logic
 * (`scripts/security/manifest.ts`). Deliberately never downloads a real
 * binary or a vulnerability database — per this checkpoint's own
 * instruction, that would make an ordinary `pnpm test` run slow and
 * network-dependent. Only the checksum/platform/shape logic that
 * `bootstrap.ts` relies on before ever touching the network is exercised
 * here.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ChecksumMismatchError,
  UnsupportedPlatformError,
  resolveAsset,
  resolvePlatformKey,
  validateManifestShape,
  verifyChecksum,
  type BinaryToolManifestEntry,
} from '../../../scripts/security/manifest';

const MANIFEST_PATH = fileURLToPath(
  new URL('../../../security/tool-versions.json', import.meta.url)
);

describe('security scanner manifest — pure logic', () => {
  it('the real committed security/tool-versions.json parses and validates its own shape', () => {
    const raw: unknown = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
    expect(validateManifestShape(raw)).toBe(true);
  });

  it('rejects a malformed manifest (missing required field) — fails closed', () => {
    expect(validateManifestShape({})).toBe(false);
    expect(validateManifestShape({ semgrep: { version: '1.0.0' } })).toBe(false);
    expect(
      validateManifestShape({
        semgrep: { version: '1.0.0', install_method: 'pip', provenance: 'x' },
        'osv-scanner': { version: '1.0.0', install_method: 'binary', checksums_source: 'x' }, // missing assets
        trivy: { version: '1.0.0', install_method: 'tarball', checksums_source: 'x', assets: {} },
      })
    ).toBe(false);
  });

  it('rejects a manifest asset with a non-sha256-shaped checksum', () => {
    expect(
      validateManifestShape({
        semgrep: { version: '1.0.0', install_method: 'pip', provenance: 'x' },
        'osv-scanner': {
          version: '1.0.0',
          install_method: 'binary',
          checksums_source: 'x',
          assets: { 'darwin-arm64': { url: 'https://example.test', sha256: 'not-a-real-hash' } },
        },
        trivy: { version: '1.0.0', install_method: 'tarball', checksums_source: 'x', assets: {} },
      })
    ).toBe(false);
  });

  it('resolvePlatformKey maps every supported Node platform/arch pair exactly, and fails closed on an unsupported one', () => {
    expect(resolvePlatformKey('darwin', 'arm64')).toBe('darwin-arm64');
    expect(resolvePlatformKey('darwin', 'x64')).toBe('darwin-x64');
    expect(resolvePlatformKey('linux', 'x64')).toBe('linux-x64');
    expect(resolvePlatformKey('linux', 'arm64')).toBe('linux-arm64');
    expect(() => resolvePlatformKey('win32', 'x64')).toThrow(UnsupportedPlatformError);
    expect(() => resolvePlatformKey('darwin', 'ia32')).toThrow(UnsupportedPlatformError);
  });

  it('resolveAsset returns the pinned asset for a supported platform, and fails closed for one the tool has no asset for', () => {
    const entry: BinaryToolManifestEntry = {
      version: '9.9.9',
      provenance: 'test',
      checksums_source: 'test',
      install_method: 'binary',
      assets: {
        'darwin-arm64': { url: 'https://example.test/bin', sha256: 'a'.repeat(64) },
      },
    };
    expect(resolveAsset('test-tool', entry, 'darwin-arm64')).toEqual({
      url: 'https://example.test/bin',
      sha256: 'a'.repeat(64),
    });
    expect(() => resolveAsset('test-tool', entry, 'linux-x64')).toThrow(UnsupportedPlatformError);
  });

  it('verifyChecksum accepts a matching digest and fails closed (throws) on a mismatch, case-insensitively', () => {
    const data = new TextEncoder().encode('siteborne-security-checkpoint-1b');
    const realSha = createHash('sha256').update(data).digest('hex');

    expect(() => verifyChecksum('test-tool', data, realSha)).not.toThrow();
    expect(() => verifyChecksum('test-tool', data, realSha.toUpperCase())).not.toThrow();
    expect(() => verifyChecksum('test-tool', data, 'f'.repeat(64))).toThrow(ChecksumMismatchError);
  });

  it("every asset URL in the real manifest points at the tool's own official GitHub releases host", () => {
    const raw = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')) as {
      'osv-scanner': BinaryToolManifestEntry;
      trivy: BinaryToolManifestEntry;
    };
    for (const [tool, expectedRepo] of [
      ['osv-scanner', 'google/osv-scanner'],
      ['trivy', 'aquasecurity/trivy'],
    ] as const) {
      const entry = raw[tool];
      for (const asset of Object.values(entry.assets)) {
        expect(asset!.url).toContain(`github.com/${expectedRepo}/releases/download/`);
      }
      expect(entry.checksums_source).toContain(`github.com/${expectedRepo}/releases/download/`);
    }
  });
});
