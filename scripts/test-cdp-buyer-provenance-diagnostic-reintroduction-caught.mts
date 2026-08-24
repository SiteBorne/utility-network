#!/usr/bin/env -S npx tsx
/**
 * SUN-1220C mutation proof: `DIAGNOSTIC_SIGNING_REINTRODUCTION_CAUGHT`.
 *
 * Temporarily reintroduces a call to a signing-capable CDP operation
 * (`client.evm.signTypedData(...)`) directly after the diagnostic's one
 * legitimate `getAccount` call in
 * `production-cdp-buyer-provenance-diagnostic-route.ts`, requires the
 * route's own test file to catch it (the mock client's `signTypedData`
 * throws immediately if invoked -- see that test file's `mockCdpClient`
 * helper), then restores the exact original bytes in a `finally` block
 * so a failure never leaves the mutation in place.
 *
 * Matches the established convention in
 * `test-production-fixture-reintroduction-caught.mts`: mutate, run the
 * real check, assert it fails for the expected reason, restore,
 * byte-for-byte-verify the restoration, then fail the proof itself if
 * the mutation went uncaught.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function runProof(): void {
  const TARGET = join(
    REPO_ROOT,
    'apps/edge-api/src/control-plane/routes/production-cdp-buyer-provenance-diagnostic-route.ts'
  );
  const ANCHOR = 'await client.evm.getAccount({ address: CONTROLLED_BUYER_ADDRESS });';
  const MUTANT =
    `${ANCHOR}\n` +
    '    await client.evm.signTypedData({} as never); // mutation proof only';

  const original = readFileSync(TARGET, 'utf8');
  if (!original.includes(ANCHOR)) {
    throw new Error('diagnostic route mutation anchor not found; refusing an ambiguous mutation');
  }
  if (original.includes('client.evm.signTypedData(')) {
    throw new Error('diagnostic route already calls client.evm.signTypedData; canonical state is unsafe');
  }

  let caught = false;
  try {
    writeFileSync(TARGET, original.replace(ANCHOR, MUTANT), 'utf8');
    try {
      execFileSync(
        'npx',
        [
          'vitest',
          'run',
          'apps/edge-api/src/control-plane/routes/production-cdp-buyer-provenance-diagnostic-route.test.ts',
        ],
        { cwd: REPO_ROOT, encoding: 'utf8', stdio: 'pipe' }
      );
    } catch (error) {
      const output =
        typeof error === 'object' && error && 'stdout' in error
          ? String((error as { stdout?: unknown }).stdout ?? '') +
            String((error as { stderr?: unknown }).stderr ?? '')
          : String(error);
      // The structural-violation message thrown by the mock's
      // signTypedData is caught internally by resolveCdpBuyerProvenance's
      // own fail-closed try/catch (by design -- see that function's doc
      // comment), so it never surfaces as literal text in vitest output.
      // The observable signal is the resulting assertion failures: the
      // Q/R/S/T test (which asserts `result.ok === true` on a mock whose
      // getAccount succeeds) now fails because the reintroduced
      // signTypedData call throws before that success result is built.
      caught =
        (output.includes('FAIL') || output.includes('failed')) &&
        output.includes(
          'Q/R/S/T: getOrCreateAccount, listAccounts, signTypedData, and every other CDP method are structurally never invoked'
        ) &&
        output.includes('expected false to be true');
      if (!caught) throw new Error(`vitest failed for an unexpected reason:\n${output}`);
    }
  } finally {
    writeFileSync(TARGET, original, 'utf8');
  }

  const restored = readFileSync(TARGET, 'utf8');
  if (hash(restored) !== hash(original)) {
    throw new Error('diagnostic route source was not restored byte-for-byte');
  }
  if (!caught) {
    throw new Error(
      'a mutation reintroducing a signing-capable CDP call into the buyer-provenance diagnostic went undetected'
    );
  }

  console.log(
    '[cdp-buyer-provenance-diagnostic reintroduction proof] PASS: the route\'s own test file rejected the reintroduced signTypedData() call, and canonical source was restored byte-for-byte.'
  );
}

runProof();
