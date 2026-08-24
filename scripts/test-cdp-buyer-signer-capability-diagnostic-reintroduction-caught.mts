#!/usr/bin/env -S npx tsx
/**
 * SUN-1220D mutation proof: `SIGNER_DIAGNOSTIC_SAFETY_REINTRODUCTION_CAUGHT`.
 *
 * Two independent proofs, each mutating
 * `production-cdp-buyer-signer-capability-diagnostic-route.ts` in place,
 * requiring the route's own test file to catch the mutation, then
 * restoring the exact original bytes in a `finally` block so a failure
 * never leaves a mutation in place. Matches the established convention
 * in `test-production-fixture-reintroduction-caught.mts` and
 * `test-cdp-buyer-provenance-diagnostic-reintroduction-caught.mts`.
 *
 * Proof A -- forbidden CDP capability reintroduction: a call to
 * `client.evm.getOrCreateAccount(...)` reintroduced immediately after
 * the diagnostic's one legitimate `getAccount` call. The route's test
 * file's mock client (`mockCdpClient`) wires every other CDP method to
 * throw immediately if invoked, so this mutation must be caught.
 *
 * Proof B -- signature-leak reintroduction: the raw `signature` value
 * added into the success response object. The route's test file's
 * `AD/AE/AF` test and the "X" full-success `toEqual` assertion (which
 * checks the exact response shape) must both reject an extra
 * `signature` key.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TARGET = join(
  REPO_ROOT,
  'apps/edge-api/src/control-plane/routes/production-cdp-buyer-signer-capability-diagnostic-route.ts'
);
const TEST_ARGS = [
  'vitest',
  'run',
  'apps/edge-api/src/control-plane/routes/production-cdp-buyer-signer-capability-diagnostic-route.test.ts',
];

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function runVitest(): { failed: boolean; output: string } {
  try {
    const output = execFileSync('npx', TEST_ARGS, { cwd: REPO_ROOT, encoding: 'utf8', stdio: 'pipe' });
    return { failed: false, output };
  } catch (error) {
    const output =
      typeof error === 'object' && error && 'stdout' in error
        ? String((error as { stdout?: unknown }).stdout ?? '') +
          String((error as { stderr?: unknown }).stderr ?? '')
        : String(error);
    return { failed: true, output };
  }
}

function runMutationProof(name: string, anchor: string, mutant: string, expectedSignals: string[]): void {
  const original = readFileSync(TARGET, 'utf8');
  if (!original.includes(anchor)) {
    throw new Error(`[${name}] mutation anchor not found; refusing an ambiguous mutation`);
  }

  let caught = false;
  try {
    writeFileSync(TARGET, original.replace(anchor, mutant), 'utf8');
    const { failed, output } = runVitest();
    caught = failed && expectedSignals.every((signal) => output.includes(signal));
    if (!caught) {
      throw new Error(`[${name}] vitest did not fail for the expected reason:\n${output}`);
    }
  } finally {
    writeFileSync(TARGET, original, 'utf8');
  }

  const restored = readFileSync(TARGET, 'utf8');
  if (hash(restored) !== hash(original)) {
    throw new Error(`[${name}] source was not restored byte-for-byte`);
  }
  if (!caught) {
    throw new Error(`[${name}] mutation went undetected`);
  }

  console.log(`[${name}] PASS: the route's own test file rejected the mutation, source restored byte-for-byte.`);
}

function main(): void {
  runMutationProof(
    'cdp-buyer-signer-capability-diagnostic: forbidden-capability reintroduction',
    'account = await client.evm.getAccount({ address: CONTROLLED_BUYER_ADDRESS });',
    'account = await client.evm.getAccount({ address: CONTROLLED_BUYER_ADDRESS });\n' +
      '    await (client.evm as unknown as { getOrCreateAccount: () => Promise<unknown> }).getOrCreateAccount(); // mutation proof only',
    ['FAIL', 'AG/AH/AI/AJ/AK/AL']
  );

  runMutationProof(
    'cdp-buyer-signer-capability-diagnostic: signature-leak reintroduction',
    '  return {\n    ok: true,\n    buyer_found: true,\n    account_kind: \'server_account\',\n    typed_data_signing_succeeded: true,\n    signature_recovered_to_buyer: true,\n    credential_signing_authorized: true,\n  };',
    '  return {\n    ok: true,\n    buyer_found: true,\n    account_kind: \'server_account\',\n    typed_data_signing_succeeded: true,\n    signature_recovered_to_buyer: true,\n    credential_signing_authorized: true,\n    signature, // mutation proof only\n  };',
    ['FAIL']
  );
}

main();
