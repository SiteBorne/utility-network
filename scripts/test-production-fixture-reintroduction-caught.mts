#!/usr/bin/env -S npx tsx
/**
 * SUN-1206 mutation proof, extended by SUN-1214 checkpoint T and
 * SUN-1216 checkpoint V.
 *
 * Proof A (SUN-1206): temporarily reintroduces the test/sandbox paid
 * service graph into the real production entrypoint's module graph,
 * requires the credential-free production preflight to reject it, and
 * restores the exact original bytes in a finally block.
 *
 * Proof B (SUN-1214): temporarily reintroduces the fixture signer into
 * the new verify_agent_output.v2/CDP production executor
 * (`verify-agent-output-v2-production-executor.ts`) -- a module
 * `production:preflight` has no knowledge of, since it is not wired
 * into `index.ts` -- and requires that module's own structural
 * fixture-exclusion test (Task 3) to catch the mutation, then restores
 * the exact original bytes.
 *
 * Proof C (SUN-1216): unlike Proof B's target, `production-verify-v2-
 * cdp-route.ts` IS now wired into `index.ts`'s real module graph -- this
 * proof reintroduces a fixture-signer import directly into that new
 * integration point and requires its own structural fixture-exclusion
 * test to catch it, then restores the exact original bytes.
 *
 * All three proofs run in the same process, each restoring its own
 * target unconditionally in its own `finally` block, so a failure in
 * one never leaves another unrestored.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PNPM = process.env.PNPM_EXECUTABLE ?? 'pnpm';

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function runProofA(): void {
  const TARGET = join(REPO_ROOT, 'apps/edge-api/src/index.ts');
  const ANCHOR =
    "import { productionServiceExecutorUnavailable } from './control-plane/routes/production-paid-services';";
  const MUTANT =
    `${ANCHOR}\n` +
    "import { buildPaidServicesApp } from './control-plane/routes/paid-services'; // mutation proof only";

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
    '[fixture-reintroduction-proof A] PASS: production preflight rejected the fixture import and canonical source was restored byte-for-byte.'
  );
}

function runProofB(): void {
  const TARGET = join(
    REPO_ROOT,
    'apps/edge-api/src/control-plane/production/verify-agent-output-v2-production-executor.ts'
  );
  const ANCHOR = "import type { KeyRegistry, Signer } from '@siteborne/verification';";
  const MUTANT =
    `${ANCHOR}\n` +
    "import { createFixtureSigner } from '@siteborne/service-runtime'; // mutation proof only";

  const original = readFileSync(TARGET, 'utf8');
  const originalImportLines = original
    .split('\n')
    .filter((line) => /^\s*import\b/.test(line))
    .join('\n');
  if (!original.includes(ANCHOR)) {
    throw new Error('verify v2 production executor mutation anchor not found; refusing');
  }
  if (originalImportLines.includes('createFixtureSigner')) {
    throw new Error(
      'verify v2 production executor already imports createFixtureSigner; canonical state is unsafe'
    );
  }

  let caught = false;
  try {
    writeFileSync(TARGET, original.replace(ANCHOR, MUTANT), 'utf8');
    try {
      execFileSync(
        PNPM,
        [
          'exec',
          'vitest',
          'run',
          'apps/edge-api/src/control-plane/production/verify-agent-output-v2-production-executor.test.ts',
        ],
        { cwd: REPO_ROOT, encoding: 'utf8', stdio: 'pipe' }
      );
      // No throw means every test (including the structural
      // fixture-exclusion check) passed against the mutant -- that
      // would mean the mutation went undetected.
    } catch (error) {
      const output =
        typeof error === 'object' && error && 'stdout' in error
          ? String((error as { stdout?: unknown }).stdout ?? '') +
            String((error as { stderr?: unknown }).stderr ?? '')
          : String(error);
      caught =
        output.includes('never references any fixture symbol') &&
        (output.includes('FAIL') || output.includes('failed'));
      if (!caught) throw new Error(`vitest failed for an unexpected reason:\n${output}`);
    }
  } finally {
    writeFileSync(TARGET, original, 'utf8');
  }

  const restored = readFileSync(TARGET, 'utf8');
  if (hash(restored) !== hash(original)) {
    throw new Error('verify v2 production executor was not restored byte-for-byte');
  }
  if (!caught) {
    throw new Error(
      'the structural fixture-exclusion test accepted a fixture-signer import into the production executor'
    );
  }

  console.log(
    '[fixture-reintroduction-proof B] PASS: the structural fixture-exclusion test rejected the fixture-signer import and canonical source was restored byte-for-byte.'
  );
}

function runProofC(): void {
  const TARGET = join(
    REPO_ROOT,
    'apps/edge-api/src/control-plane/routes/production-verify-v2-cdp-route.ts'
  );
  const ANCHOR = "import { Hono } from 'hono';";
  const MUTANT =
    `${ANCHOR}\n` +
    "import { createFixtureSigner } from '@siteborne/service-runtime'; // mutation proof only";

  const original = readFileSync(TARGET, 'utf8');
  const originalImportLines = original
    .split('\n')
    .filter((line) => /^\s*import\b/.test(line))
    .join('\n');
  if (!original.includes(ANCHOR)) {
    throw new Error('verify v2 CDP production route mutation anchor not found; refusing');
  }
  if (originalImportLines.includes('createFixtureSigner')) {
    throw new Error(
      'verify v2 CDP production route already imports createFixtureSigner; canonical state is unsafe'
    );
  }

  let caught = false;
  try {
    writeFileSync(TARGET, original.replace(ANCHOR, MUTANT), 'utf8');
    try {
      execFileSync(
        PNPM,
        [
          'exec',
          'vitest',
          'run',
          'apps/edge-api/src/control-plane/routes/production-verify-v2-cdp-route.test.ts',
        ],
        { cwd: REPO_ROOT, encoding: 'utf8', stdio: 'pipe' }
      );
    } catch (error) {
      const output =
        typeof error === 'object' && error && 'stdout' in error
          ? String((error as { stdout?: unknown }).stdout ?? '') +
            String((error as { stderr?: unknown }).stderr ?? '')
          : String(error);
      caught =
        output.includes('never imports a fixture signer') &&
        (output.includes('FAIL') || output.includes('failed'));
      if (!caught) throw new Error(`vitest failed for an unexpected reason:\n${output}`);
    }
  } finally {
    writeFileSync(TARGET, original, 'utf8');
  }

  const restored = readFileSync(TARGET, 'utf8');
  if (hash(restored) !== hash(original)) {
    throw new Error('verify v2 CDP production route was not restored byte-for-byte');
  }
  if (!caught) {
    throw new Error(
      'the structural fixture-exclusion test accepted a fixture-signer import into the bundle-reachable production route'
    );
  }

  console.log(
    '[fixture-reintroduction-proof C] PASS: the structural fixture-exclusion test rejected the fixture-signer import into the bundle-reachable integration point, and canonical source was restored byte-for-byte.'
  );
}

runProofA();
runProofB();
runProofC();

console.log(
  '[fixture-reintroduction-proof] PASS: proofs A, B, and C each caught their mutation and each restored its own target byte-for-byte.'
);
