#!/usr/bin/env -S npx tsx
/**
 * SUN-1220L — domain-metadata mutation proof (SUN-1220K §13/§14).
 *
 * Six narrow proofs, each mutating one exact anchor string, running the
 * new SUN-1220L integration test
 * (verify-agent-output-v2-cdp-composition.domain-metadata.test.ts) against
 * the mutant, requiring it to FAIL for the expected reason, then restoring
 * the original file byte-for-byte (verified via SHA-256) in a `finally`
 * block regardless of outcome, then re-running the same test to prove the
 * restored source is green again.
 *
 * Proof 1: remove `extra.name` propagation           -> new test FAILS
 * Proof 2: remove `extra.version` propagation         -> new test FAILS
 * Proof 3: resolved name drifts from official "USD Coin" -> new test FAILS
 * Proof 4: resolved version drifts from official "2"     -> new test FAILS
 * Proof 5: paymentRequirementExtra leaks onto an unintended route
 *          (paid-services.ts's v2CdpRoute)            -> route-isolation
 *          assertion in the new test FAILS
 * Proof 6: payTo drifts while touching this same code region
 *          (verify-agent-output-v2-cdp-composition.ts)  -> the new test's
 *          economic-invariant assertion (H) FAILS
 *
 * Never commits a mutant. Each proof restores its own target
 * unconditionally in its own `finally` block, so a failure in one never
 * leaves another unrestored.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PNPM = process.env.PNPM_EXECUTABLE ?? 'pnpm';

const COMPOSITION_TARGET = join(
  REPO_ROOT,
  'apps/edge-api/src/control-plane/production/verify-agent-output-v2-cdp-composition.ts'
);
const PAID_SERVICES_TARGET = join(
  REPO_ROOT,
  'apps/edge-api/src/control-plane/routes/paid-services.ts'
);
const NEW_TEST_REL =
  'apps/edge-api/src/control-plane/production/verify-agent-output-v2-cdp-composition.domain-metadata.test.ts';

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function runNewTest(): { passed: boolean; output: string } {
  try {
    const output = execFileSync(PNPM, ['exec', 'vitest', 'run', NEW_TEST_REL], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { passed: true, output };
  } catch (error) {
    const output =
      typeof error === 'object' && error && 'stdout' in error
        ? String((error as { stdout?: unknown }).stdout ?? '') +
          String((error as { stderr?: unknown }).stderr ?? '')
        : String(error);
    return { passed: false, output };
  }
}

function runMutationProof(
  label: string,
  target: string,
  anchor: string,
  mutant: string,
  expectFailureSubstrings: string[]
): void {
  const original = readFileSync(target, 'utf8');
  if (!original.includes(anchor)) {
    throw new Error(`[${label}] ABORT: anchor not found in ${target}`);
  }

  let caught = false;
  let mutantOutput = '';
  try {
    writeFileSync(target, original.replace(anchor, mutant), 'utf8');
    const mutantResult = runNewTest();
    mutantOutput = mutantResult.output;
    if (mutantResult.passed) {
      throw new Error(
        `[${label}] FAIL: the mutant did NOT cause the new test to fail -- ` +
          'this mutation would go undetected by the release gate.'
      );
    }
    caught = expectFailureSubstrings.every((s) => mutantOutput.includes(s));
    if (!caught) {
      throw new Error(
        `[${label}] FAIL: test failed, but not for the expected reason. ` +
          `Expected all of ${JSON.stringify(expectFailureSubstrings)} in output. ` +
          `Actual (last 2000 chars):\n${mutantOutput.slice(-2000)}`
      );
    }
  } finally {
    writeFileSync(target, original, 'utf8');
  }

  const restored = readFileSync(target, 'utf8');
  if (hash(restored) !== hash(original)) {
    throw new Error(`[${label}] CRITICAL: ${target} was not restored byte-for-byte`);
  }

  const restoredResult = runNewTest();
  if (!restoredResult.passed) {
    throw new Error(
      `[${label}] FAIL: restored source does not pass the new test:\n` +
        restoredResult.output.slice(-2000)
    );
  }

  console.log(
    `[domain-metadata-mutation-proof: ${label}] PASS: mutant caught (${expectFailureSubstrings.join(', ')}), ` +
      'source restored byte-for-byte, restored source passes again.'
  );
}

function proof1RemoveName(): void {
  runMutationProof(
    'Mutation 1 (remove extra.name propagation)',
    COMPOSITION_TARGET,
    'paymentRequirementExtra: { name: asset.name, version: asset.version },',
    'paymentRequirementExtra: { version: asset.version },',
    ['expected undefined to be', "'USD Coin'"]
  );
}

function proof2RemoveVersion(): void {
  runMutationProof(
    'Mutation 2 (remove extra.version propagation)',
    COMPOSITION_TARGET,
    'paymentRequirementExtra: { name: asset.name, version: asset.version },',
    'paymentRequirementExtra: { name: asset.name },',
    ['expected undefined to be', "'2'"]
  );
}

function proof3WrongName(): void {
  runMutationProof(
    'Mutation 3 (resolved name drifts from official "USD Coin")',
    COMPOSITION_TARGET,
    'paymentRequirementExtra: { name: asset.name, version: asset.version },',
    "paymentRequirementExtra: { name: 'Wrong Name', version: asset.version },",
    ["'Wrong Name'", "'USD Coin'"]
  );
}

function proof4WrongVersion(): void {
  runMutationProof(
    'Mutation 4 (resolved version drifts from official "2")',
    COMPOSITION_TARGET,
    'paymentRequirementExtra: { name: asset.name, version: asset.version },',
    "paymentRequirementExtra: { name: asset.name, version: '99' },",
    ["'99'", "'2'"]
  );
}

function proof5RouteLeak(): void {
  runMutationProof(
    'Mutation 5 (paymentRequirementExtra leaks onto an unintended route)',
    PAID_SERVICES_TARGET,
    `    return {\n      rail: 'cdp' as const,\n      network,\n      asset: resolvePaymentAsset(network).address,\n      payTo: config.payTo ?? PAYTO_NOT_CONFIGURED,\n      path,\n    };`,
    `    return {\n      rail: 'cdp' as const,\n      network,\n      asset: resolvePaymentAsset(network).address,\n      paymentRequirementExtra: { name: 'x', version: 'y' }, // mutation proof only\n      payTo: config.payTo ?? PAYTO_NOT_CONFIGURED,\n      path,\n    };`,
    ['route isolation', 'toEqual']
  );
}

function proof6PayToDrift(): void {
  runMutationProof(
    'Mutation 6 (payTo drifts while touching this same code region)',
    COMPOSITION_TARGET,
    'payTo: env.SELLER_WALLET_ADDRESS,',
    "payTo: '0x9999999999999999999999999999999999999a', // mutation proof only",
    ['payTo', 'H']
  );
}

proof1RemoveName();
proof2RemoveVersion();
proof3WrongName();
proof4WrongVersion();
proof5RouteLeak();
proof6PayToDrift();

console.log(
  '[domain-metadata-mutation-proof] PASS: all six mutations were caught and every target was restored byte-for-byte.'
);
