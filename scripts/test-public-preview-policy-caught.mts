#!/usr/bin/env -S npx tsx
/**
 * SUN-1207 M3 mutation proof. Runs the production preflight against an
 * isolated Wrangler configuration whose public version-preview policy is
 * deliberately unsafe. The canonical repository configuration is never
 * modified and no Cloudflare API is contacted (`--config-only`).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CANONICAL_CONFIG = join(REPO_ROOT, 'wrangler.toml');
const PNPM = process.env.PNPM_EXECUTABLE ?? 'pnpm';

const original = readFileSync(CANONICAL_CONFIG, 'utf8');
const unsafe = /^preview_urls\s*=\s*false\s*$/m.test(original)
  ? original.replace(/^preview_urls\s*=\s*false\s*$/m, 'preview_urls = true')
  : original.replace(/^workers_dev\s*=\s*true\s*$/m, 'workers_dev = true\npreview_urls = true');

if (unsafe === original || !/^preview_urls\s*=\s*true\s*$/m.test(unsafe)) {
  throw new Error('could not construct the isolated unsafe preview-policy mutation');
}

const tempRoot = mkdtempSync(join(tmpdir(), 'siteborne-preview-policy-'));
const mutatedConfig = join(tempRoot, 'wrangler.toml');
let caught = false;

try {
  writeFileSync(mutatedConfig, unsafe, 'utf8');
  try {
    execFileSync(PNPM, ['production:preflight', '--config-only', '--config-path', mutatedConfig], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
      env: {
        ...process.env,
        NVM_API_KEY: undefined,
        NVM_SUBSCRIBER_API_KEY: undefined,
        NEVERMINED_API_KEY: undefined,
        RUN_LIVE_NEVERMINED: undefined,
        RUN_LIVE_X402: undefined,
        CDP_API_KEY_ID: undefined,
        CDP_API_KEY_SECRET: undefined,
        CDP_WALLET_SECRET: undefined,
      },
    });
  } catch (error) {
    const output =
      typeof error === 'object' && error && 'stdout' in error
        ? String((error as { stdout?: unknown }).stdout ?? '') +
          String((error as { stderr?: unknown }).stderr ?? '')
        : String(error);
    caught = output.includes('preview_urls must be explicitly false');
    if (!caught) throw new Error(`preflight failed for an unexpected reason:\n${output}`);
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (!caught) throw new Error('production preflight accepted public Worker preview URLs');

console.log(
  '[public-preview-policy-proof] PASS: production preflight rejected preview_urls=true in isolated configuration.'
);
