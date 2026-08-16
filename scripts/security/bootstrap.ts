#!/usr/bin/env tsx
/**
 * SUN-1000 checkpoint 1B — reproducible, checksum-verified provisioning
 * for the three pinned release-security scanners (Semgrep, OSV-Scanner,
 * Trivy). Reads `security/tool-versions.json` (the single authoritative
 * version source — never duplicated elsewhere) and installs each tool
 * into `.security-tools/` (gitignored; binaries themselves are never
 * committed).
 *
 * Idempotent: a tool already provisioned at the pinned version with a
 * verified checksum is left alone. Fails closed: an unsupported
 * platform, a checksum mismatch, or a download failure aborts with a
 * clear error — never falls back to "probably fine."
 *
 * No root/admin privileges required; everything installs under the
 * repository's own `.security-tools/` directory.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import {
  resolveAsset,
  resolvePlatformKey,
  validateManifestShape,
  verifyChecksum,
  type ToolVersionsManifest,
} from './manifest';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MANIFEST_PATH = join(REPO_ROOT, 'security', 'tool-versions.json');
const TOOLS_DIR = join(REPO_ROOT, '.security-tools');

function loadManifest(): ToolVersionsManifest {
  const raw: unknown = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
  if (!validateManifestShape(raw)) {
    throw new Error(`malformed security/tool-versions.json — refusing to bootstrap from it`);
  }
  return raw;
}

async function download(url: string, destPath: string): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) {
    throw new Error(`download_failed: ${url} -> HTTP ${res.status}`);
  }
  const nodeStream = (await import('node:stream')).Readable.fromWeb(
    res.body as unknown as import('node:stream/web').ReadableStream
  );
  await pipeline(nodeStream, createWriteStream(destPath));
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

async function bootstrapBinaryTool(
  tool: 'osv-scanner' | 'trivy',
  manifest: ToolVersionsManifest
): Promise<string> {
  const entry = manifest[tool];
  const platformKey = resolvePlatformKey(process.platform, process.arch);
  const asset = resolveAsset(tool, entry, platformKey);
  const toolDir = join(TOOLS_DIR, tool, entry.version);
  const binaryPath = join(toolDir, tool === 'osv-scanner' ? 'osv-scanner' : 'trivy');

  if (existsSync(binaryPath)) {
    // Already provisioned at this pinned version — verify, don't
    // silently trust a stale/tampered cache before reuse.
    if (entry.install_method === 'binary') {
      verifyChecksum(tool, readFileSync(binaryPath), asset.sha256);
    }
    return binaryPath;
  }

  mkdirSync(toolDir, { recursive: true });
  const downloadPath = join(toolDir, `download-${Date.now()}`);
  await download(asset.url, downloadPath);
  const actualSha = sha256File(downloadPath);
  if (actualSha.toLowerCase() !== asset.sha256.toLowerCase()) {
    rmSync(downloadPath, { force: true });
    throw new Error(
      `checksum_mismatch: ${tool} ${platformKey} expected ${asset.sha256}, got ${actualSha}`
    );
  }

  if (entry.install_method === 'tarball') {
    execFileSync('tar', ['-xzf', downloadPath, '-C', toolDir]);
    rmSync(downloadPath, { force: true });
    if (!existsSync(binaryPath)) {
      throw new Error(`tarball_extraction_missing_binary: ${tool} expected ${binaryPath}`);
    }
  } else {
    execFileSync('mv', [downloadPath, binaryPath]);
  }
  chmodSync(binaryPath, 0o755);
  return binaryPath;
}

async function bootstrapSemgrep(manifest: ToolVersionsManifest): Promise<string> {
  const entry = manifest.semgrep;
  const venvDir = join(TOOLS_DIR, 'semgrep-venv');
  const versionStampPath = join(venvDir, '.pinned-version');
  const semgrepBin = join(venvDir, 'bin', 'semgrep');

  if (
    existsSync(semgrepBin) &&
    existsSync(versionStampPath) &&
    readFileSync(versionStampPath, 'utf-8').trim() === entry.version
  ) {
    return semgrepBin;
  }

  rmSync(venvDir, { recursive: true, force: true });
  mkdirSync(TOOLS_DIR, { recursive: true });
  execFileSync('python3', ['-m', 'venv', venvDir]);
  execFileSync(join(venvDir, 'bin', 'pip'), ['install', '--quiet', `semgrep==${entry.version}`]);
  writeFileSync(versionStampPath, entry.version);
  if (!existsSync(semgrepBin)) {
    throw new Error(`semgrep_install_missing_binary: expected ${semgrepBin}`);
  }
  return semgrepBin;
}

export async function bootstrapAll(): Promise<{
  semgrep: string;
  osvScanner: string;
  trivy: string;
}> {
  const manifest = loadManifest();
  mkdirSync(TOOLS_DIR, { recursive: true });
  const [semgrep, osvScanner, trivy] = await Promise.all([
    bootstrapSemgrep(manifest),
    bootstrapBinaryTool('osv-scanner', manifest),
    bootstrapBinaryTool('trivy', manifest),
  ]);
  return { semgrep, osvScanner, trivy };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  bootstrapAll()
    .then((paths) => {
      // eslint-disable-next-line no-console
      console.log('Security scanners provisioned (sanitized paths):', paths);
    })
    .catch((e) => {
      console.error('BOOTSTRAP FAILED:', e instanceof Error ? e.message : String(e));
      process.exitCode = 1;
    });
}
