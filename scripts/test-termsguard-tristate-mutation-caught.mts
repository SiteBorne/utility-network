#!/usr/bin/env -S npx tsx
/**
 * SUN-1221E2T1 §19: mutation-proof for TermsGuard tri-state semantics.
 *
 * Each mutation deliberately reintroduces one specific defect into
 * `packages/provider-adapters/src/policy/terms-guard.ts`, runs the relevant
 * test suites, requires a FAILURE (i.e. the mutation is caught), then
 * restores the file byte-for-byte. Follows the established pattern from
 * scripts/test-discovery-truthfulness-mutation-caught.mts and
 * scripts/test-web-context-v2-mutation-caught.mts.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dirname, '..');
const TARGET = join(
  REPO_ROOT,
  'packages/provider-adapters/src/policy/terms-guard.ts'
);
const TEST_CMD =
  'pnpm --filter @siteborne/provider-adapters exec vitest run src/tests/termsguard-tri-state.test.ts src/tests/direct-public-http-terms-review.test.ts src/tests/terms-rate-cache-circuit.test.ts';

const original = readFileSync(TARGET, 'utf-8');

interface Mutation {
  name: string;
  apply: (src: string) => string;
}

const mutations: Mutation[] = [
  {
    name: '1. unknown accepted under provider_terms_review (revert isExplicitlyAllowed to bare truthiness)',
    apply: (s) =>
      s.replace(
        'export function isExplicitlyAllowed(value: boolean | \'unknown\'): boolean {\n  return value === true;\n}',
        'export function isExplicitlyAllowed(value: boolean | \'unknown\'): boolean {\n  return Boolean(value);\n}'
      ),
  },
  {
    name: '2. false accepted (invert one permission check)',
    apply: (s) =>
      s.replace(
        "if (!isExplicitlyAllowed(manifest.commercial_application_allowed)) {",
        "if (isExplicitlyAllowed(manifest.commercial_application_allowed)) {"
      ),
  },
  {
    name: '3. true rejected under provider_terms_review (force isExplicitlyAllowed to always false)',
    apply: (s) =>
      s.replace(
        'export function isExplicitlyAllowed(value: boolean | \'unknown\'): boolean {\n  return value === true;\n}',
        'export function isExplicitlyAllowed(value: boolean | \'unknown\'): boolean {\n  return false;\n}'
      ),
  },
  {
    name: '4. operator acceptance removed (isCapabilityRiskAccepted always false)',
    apply: (s) =>
      s.replace(
        'export function isCapabilityRiskAccepted(\n  review: TermsReview | undefined,\n  providerId: string\n): boolean {\n  return (\n    review !== undefined &&\n    review.providerId === providerId &&\n    review.status === \'verified\' &&\n    review.reviewBasis === \'operator_risk_acceptance\'\n  );\n}',
        'export function isCapabilityRiskAccepted(\n  review: TermsReview | undefined,\n  providerId: string\n): boolean {\n  return false;\n}'
      ),
  },
  {
    name: '5. operator acceptance applied to wrong capability (drop providerId match)',
    apply: (s) =>
      s.replace(
        "review.providerId === providerId &&\n    review.status === 'verified' &&",
        "review.status === 'verified' &&"
      ),
  },
  {
    name: '6. wildcard risk acceptance (isCapabilityRiskAccepted always true)',
    apply: (s) =>
      s.replace(
        'export function isCapabilityRiskAccepted(\n  review: TermsReview | undefined,\n  providerId: string\n): boolean {\n  return (\n    review !== undefined &&\n    review.providerId === providerId &&\n    review.status === \'verified\' &&\n    review.reviewBasis === \'operator_risk_acceptance\'\n  );\n}',
        'export function isCapabilityRiskAccepted(\n  review: TermsReview | undefined,\n  providerId: string\n): boolean {\n  return true;\n}'
      ),
  },
  {
    name: '7. browser implicitly approved (checkAccess skips review lookup)',
    apply: (s) =>
      s.replace(
        "    const review = this.reviews.get(manifest.provider_id);\n    if (!review) {",
        "    const review = this.reviews.get(manifest.provider_id);\n    if (!review && manifest.provider_id !== 'browser') {"
      ),
  },
  {
    name: '8. review basis ignored (checkAccess never calls isCapabilityRiskAccepted)',
    apply: (s) =>
      s.replace(
        'if (isCapabilityRiskAccepted(review, manifest.provider_id)) {\n      return;\n    }\n\n',
        ''
      ),
  },
  {
    name: '9. notes alone treated as approval (isCapabilityRiskAccepted checks notes instead of reviewBasis)',
    apply: (s) =>
      s.replace(
        "review.reviewBasis === 'operator_risk_acceptance'",
        "review.notes.length > 0"
      ),
  },
  {
    name: "10. direct-public-http relies on unknown truthiness (reviewBasis flipped to provider_terms_review)",
    apply: (s) =>
      s.replace(
        "  status: 'verified',\n  reviewBasis: 'operator_risk_acceptance',\n  reviewer: 'operator (SITEBORNE, recorded via chat 2026-08-29)',",
        "  status: 'verified',\n  reviewBasis: 'provider_terms_review',\n  reviewer: 'operator (SITEBORNE, recorded via chat 2026-08-29)',"
      ),
  },
];

let caught = 0;
let skipped = 0;

for (const mutation of mutations) {
  const mutated = mutation.apply(original);
  if (mutated === original) {
    console.log(`SKIPPED (anchor not found): ${mutation.name}`);
    skipped++;
    continue;
  }
  writeFileSync(TARGET, mutated);
  try {
    execSync(TEST_CMD, { cwd: REPO_ROOT, stdio: 'pipe' });
    console.log(`NOT CAUGHT (tests still passed): ${mutation.name}`);
  } catch {
    console.log(`CAUGHT: ${mutation.name}`);
    caught++;
  } finally {
    writeFileSync(TARGET, original);
  }
}

// Restore + verify byte-identical
writeFileSync(TARGET, original);
const restored = readFileSync(TARGET, 'utf-8');
if (restored !== original) {
  console.error('FATAL: file not restored byte-for-byte');
  process.exit(1);
}

console.log(`\n${caught}/${mutations.length} caught, ${skipped} skipped.`);
console.log('File restored byte-for-byte.');
if (caught !== mutations.length) {
  process.exit(1);
}
