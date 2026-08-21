#!/usr/bin/env -S npx tsx
/**
 * SUN-1206 mutation proof. Temporarily reintroduces the test/sandbox paid
 * service graph into the real production entrypoint's module graph, requires
 * the credential-free production preflight to reject it, and restores the
 * exact original bytes in a finally block.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TARGET = join(REPO_ROOT, 'apps/edge-api/src/index.ts');
const PNPM = process.env.PNPM_EXECUTABLE ?? 'pnpm';
const ANCHOR =
  "import { productionServiceExecutorUnavailable } from './control-plane/routes/production-paid-services';";
const MUTANT =
  `${ANCHOR}\n` +
  "import { buildPaidServicesApp } from './control-plane/routes/paid-services'; // mutation proof only";

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

const original = readFileSync(TARGET, 'utf8');
if (!original.includes(ANCHOR)) {
  throw new Error('production fixture mutation anchor not found; refusing an ambiguous mutation');
}
if (original.includes("from './control-plane/routes/paid-services'")) {
  throw new Error(
    'production entrypoint already imports the fixture graph; canonical state is unsafe'
  );
}

let caught = false;
try {
  writeFileSync(TARGET, original.replace(ANCHOR, MUTANT), 'utf8');
  try {
    execFileSync(PNPM, ['production:preflight', '--config-only'], {
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
    caught =
      output.includes('production paid-service fixture isolation is invalid') &&
      output.includes('fail-closed route count: 12/12');
    if (!caught) throw new Error(`preflight failed for an unexpected reason:\n${output}`);
  }
} finally {
  writeFileSync(TARGET, original, 'utf8');
}

const restored = readFileSync(TARGET, 'utf8');
if (hash(restored) !== hash(original)) {
  throw new Error('production entrypoint was not restored byte-for-byte');
}
if (!caught) throw new Error('preflight accepted a production-reachable fixture import');

console.log(
  '[fixture-reintroduction-proof] PASS: production preflight rejected the fixture import and canonical source was restored byte-for-byte.'
);
