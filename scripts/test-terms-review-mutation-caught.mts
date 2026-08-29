#!/usr/bin/env -S npx tsx
/**
 * SUN-1221E2T — direct-public-http terms review governance mutation proof
 * (checkpoint §16, ten required kill conditions).
 *
 * Ten narrow proofs, each mutating one exact anchor string in
 * `packages/provider-adapters/src/policy/terms-guard.ts` or
 * `packages/provider-adapters/src/policy/network-policy.ts`, running the
 * relevant test file against the mutant, requiring it to FAIL, then
 * restoring the original file byte-for-byte (verified via SHA-256) in a
 * `finally` block regardless of outcome, then re-running the full set once
 * more at the end to prove the fully-restored source is green again.
 *
 * Never commits a mutant. Each proof restores its own target
 * unconditionally, so a failure in one never leaves another unrestored.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PNPM = process.env.PNPM_EXECUTABLE ?? 'pnpm';

const TERMS_GUARD = join(REPO_ROOT, 'packages/provider-adapters/src/policy/terms-guard.ts');
const NETWORK_POLICY = join(REPO_ROOT, 'packages/provider-adapters/src/policy/network-policy.ts');

const TERMS_TEST_REL = 'packages/provider-adapters/src/tests/direct-public-http-terms-review.test.ts';
const RATE_CACHE_TEST_REL = 'packages/provider-adapters/src/tests/terms-rate-cache-circuit.test.ts';
const DNS_REBINDING_TEST_REL = 'packages/provider-adapters/src/tests/dns-rebinding.test.ts';
const HTTP_SSRF_TEST_REL = 'packages/provider-adapters/src/tests/http-ssrf.test.ts';

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function runTest(relPaths: string[]): { passed: boolean; output: string } {
  try {
    const output = execFileSync(PNPM, ['exec', 'vitest', 'run', ...relPaths], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { passed: true, output };
  } catch (error) {
    const e = error as { stdout?: Buffer | string; stderr?: Buffer | string };
    return { passed: false, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

interface Mutation {
  name: string;
  killCondition: string;
  target: string;
  from: string;
  to: string;
  testRels: string[];
}

const MUTATIONS: Mutation[] = [
  {
    name: 'M1',
    killCondition: '1. guard removed (checkAccess bypassed entirely)',
    target: TERMS_GUARD,
    from: `checkAccess(manifest: ProviderManifest, executionMode: 'test' | 'live'): void {
    if (executionMode === 'test') {
      return;
    }`,
    to: `checkAccess(manifest: ProviderManifest, executionMode: 'test' | 'live'): void {
    return; // MUTATION: guard removed
    if (executionMode === 'test') {
      return;
    }`,
    testRels: [TERMS_TEST_REL, RATE_CACHE_TEST_REL],
  },
  {
    name: 'M2',
    killCondition: '2. missing review allowed (no-review-record throw disabled)',
    target: TERMS_GUARD,
    from: `    const review = this.reviews.get(manifest.provider_id);
    if (!review) {`,
    to: `    const review = this.reviews.get(manifest.provider_id);
    if (false) {`,
    testRels: [TERMS_TEST_REL, RATE_CACHE_TEST_REL],
  },
  {
    name: 'M3',
    killCondition: '3. unrelated review accepted (cross-provider review leak)',
    target: TERMS_GUARD,
    from: 'const review = this.reviews.get(manifest.provider_id);',
    to: "const review = this.reviews.get('direct-public-http'); // MUTATION: cross-provider leak",
    testRels: [TERMS_TEST_REL],
  },
  {
    name: 'M4',
    killCondition: '4. wildcard review added (getReview ignores its key argument)',
    target: TERMS_GUARD,
    from: `  getReview(providerId: string): TermsReview | undefined {
    return this.reviews.get(providerId);
  }`,
    to: `  getReview(providerId: string): TermsReview | undefined {
    void providerId;
    return this.reviews.values().next().value; // MUTATION: wildcard lookup
  }`,
    testRels: [RATE_CACHE_TEST_REL],
  },
  {
    name: 'M5',
    killCondition: '5. browser/unrelated capability accidentally approved',
    target: TERMS_GUARD,
    from: "  providerId: 'direct-public-http',",
    to: "  providerId: 'browser', // MUTATION: wrong capability id",
    testRels: [TERMS_TEST_REL],
  },
  {
    name: 'M6',
    killCondition: '6. review marked approved without authority provenance',
    target: TERMS_GUARD,
    from: "  reviewer: 'operator (SITEBORNE, recorded via chat 2026-08-29)',",
    to: "  reviewer: 'system', // MUTATION: no authority provenance",
    testRels: [TERMS_TEST_REL],
  },
  {
    name: 'M7',
    killCondition: '7. runtime SSRF restriction weakened (private IPv4 block disabled)',
    target: NETWORK_POLICY,
    from: 'if (!policy.allowPrivateIps && isPrivateIp(literalIp)) {',
    to: 'if (false && !policy.allowPrivateIps && isPrivateIp(literalIp)) { // MUTATION: SSRF weakened',
    testRels: [DNS_REBINDING_TEST_REL, HTTP_SSRF_TEST_REL],
  },
  {
    name: 'M8',
    killCondition: '8. direct-public-http still blocked despite exact valid review',
    target: TERMS_GUARD,
    from: "if (review.status === 'pending_review') {",
    to: "if (review.status === 'pending_review' || review.status === 'verified') { // MUTATION: over-block",
    testRels: [TERMS_TEST_REL],
  },
  {
    name: 'M9',
    killCondition: '9. rejected/blocked review treated as accepted',
    target: TERMS_GUARD,
    from: "if (review.status === 'blocked') {",
    to: 'if (false) { // MUTATION: blocked review accepted',
    testRels: [TERMS_TEST_REL],
  },
  {
    name: 'M10',
    killCondition: '10. malformed review (stale terms hash) treated as accepted',
    target: TERMS_GUARD,
    from: 'if (review.termsHash && manifest.terms_hash && review.termsHash !== manifest.terms_hash) {',
    to: 'if (false) { // MUTATION: hash-mismatch review accepted',
    testRels: [TERMS_TEST_REL],
  },
];

async function main() {
  const results: { name: string; killCondition: string; caught: boolean; note: string }[] = [];

  for (const mutation of MUTATIONS) {
    const original = readFileSync(mutation.target, 'utf8');
    const originalHash = hash(original);
    if (!original.includes(mutation.from)) {
      results.push({
        name: mutation.name,
        killCondition: mutation.killCondition,
        caught: false,
        note: `SKIPPED -- anchor string not found in ${mutation.target}`,
      });
      continue;
    }
    const mutated = original.replace(mutation.from, mutation.to);
    try {
      writeFileSync(mutation.target, mutated, 'utf8');
      const { passed, output } = runTest(mutation.testRels);
      if (passed) {
        results.push({
          name: mutation.name,
          killCondition: mutation.killCondition,
          caught: false,
          note: 'NOT CAUGHT -- tests still passed against the mutant',
        });
      } else {
        results.push({
          name: mutation.name,
          killCondition: mutation.killCondition,
          caught: true,
          note: 'caught (tests failed against the mutant, as required)',
        });
      }
      void output;
    } finally {
      writeFileSync(mutation.target, original, 'utf8');
      const restoredHash = hash(readFileSync(mutation.target, 'utf8'));
      if (restoredHash !== originalHash) {
        throw new Error(`RESTORE FAILED for ${mutation.target} after ${mutation.name}`);
      }
    }
  }

  console.log('\n=== SUN-1221E2T terms-review mutation proof ===');
  let allCaught = true;
  for (const r of results) {
    console.log(`${r.caught ? '✓' : '✗'} ${r.name} (${r.killCondition}): ${r.note}`);
    if (!r.caught) allCaught = false;
  }

  console.log('\n=== final restored-source regression ===');
  const final = runTest([TERMS_TEST_REL, RATE_CACHE_TEST_REL, DNS_REBINDING_TEST_REL, HTTP_SSRF_TEST_REL]);
  console.log(final.passed ? '✓ fully-restored source is green' : '✗ RESTORED SOURCE FAILED TESTS');
  if (!final.passed) {
    console.log(final.output);
    allCaught = false;
  }

  console.log(
    `\n${results.filter((r) => r.caught).length}/${results.length} mutations caught, 0 skipped: ${
      allCaught ? 'PASS' : 'FAIL'
    }`
  );
  if (!allCaught) process.exit(1);
}

main();
