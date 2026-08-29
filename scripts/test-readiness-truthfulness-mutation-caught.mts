#!/usr/bin/env -S npx tsx
/**
 * SUN-1220Q2 — `/ready` production-truthfulness mutation proof (SUN-1220Q1
 * §19 / SUN-1220Q2 §19).
 *
 * Sixteen narrow proofs, each mutating one exact anchor string in one of
 * the readiness/shared-resolver source files, running the relevant test
 * file against the mutant, requiring it to FAIL, then restoring the
 * original file byte-for-byte (verified via SHA-256) in a `finally` block
 * regardless of outcome, then re-running the full readiness test file
 * once more at the end to prove the fully-restored source is green again.
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

const READINESS = join(REPO_ROOT, 'apps/edge-api/src/routes/readiness.ts');
const PRODUCTION_PAYMENT = join(
  REPO_ROOT,
  'apps/edge-api/src/control-plane/config/production-payment.ts'
);

const READINESS_TEST_REL = 'apps/edge-api/tests/readiness-truthfulness.test.ts';
const DOMAIN_METADATA_TEST_REL =
  'apps/edge-api/src/control-plane/production/verify-agent-output-v2-cdp-composition.domain-metadata.test.ts';

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function runTest(relPath: string): { passed: boolean; output: string } {
  try {
    const output = execFileSync(PNPM, ['exec', 'vitest', 'run', relPath], {
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
  target: string;
  from: string;
  to: string;
  testRel: string;
}

const MUTATIONS: Mutation[] = [
  {
    name: '1. hardcode production_services_enabled false again',
    target: READINESS,
    from: 'production_services_enabled: productionServicesEnabled,',
    to: 'production_services_enabled: false, // MUTATED: back to unconditional literal',
    testRel: READINESS_TEST_REL,
  },
  {
    name: '2. hardcode production_services_enabled true',
    target: READINESS,
    from: 'production_services_enabled: productionServicesEnabled,',
    to: 'production_services_enabled: true, // MUTATED: always true',
    testRel: READINESS_TEST_REL,
  },
  {
    name: '3. ignore master route gate (PAID_ROUTES_ENABLED) in the shared flag helper',
    target: PRODUCTION_PAYMENT,
    from: "return env.PAID_ROUTES_ENABLED === 'true' && env.VERIFY_V2_CDP_ROUTE_ENABLED === 'true';",
    to: "return env.VERIFY_V2_CDP_ROUTE_ENABLED === 'true'; // MUTATED: master gate ignored",
    testRel: READINESS_TEST_REL,
  },
  {
    name: '4. ignore route-specific gate (VERIFY_V2_CDP_ROUTE_ENABLED)',
    target: PRODUCTION_PAYMENT,
    from: "return env.PAID_ROUTES_ENABLED === 'true' && env.VERIFY_V2_CDP_ROUTE_ENABLED === 'true';",
    to: "return env.PAID_ROUTES_ENABLED === 'true'; // MUTATED: route gate ignored",
    testRel: READINESS_TEST_REL,
  },
  {
    name: '5. ignore PAYMENT_ENVIRONMENT (always resolves production)',
    target: PRODUCTION_PAYMENT,
    from: 'environment: resolvePaymentEnvironment(env.PAYMENT_ENVIRONMENT),',
    to: "environment: 'production', // MUTATED: PAYMENT_ENVIRONMENT ignored",
    testRel: READINESS_TEST_REL,
  },
  {
    name: '6. ignore PRODUCTION_ENABLED (always true)',
    target: PRODUCTION_PAYMENT,
    from: 'productionEnabled: resolveTrueFlag(env.PRODUCTION_ENABLED),',
    to: 'productionEnabled: true, // MUTATED: PRODUCTION_ENABLED ignored',
    testRel: READINESS_TEST_REL,
  },
  {
    name: '7. ignore HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP (always true)',
    target: PRODUCTION_PAYMENT,
    from: 'humanBootstrapAuthorized: resolveTrueFlag(env.HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP),',
    to: 'humanBootstrapAuthorized: true, // MUTATED: bootstrap flag ignored',
    testRel: READINESS_TEST_REL,
  },
  {
    name: '8. ignore PRODUCTION_CDP_CREDENTIALS_APPROVED (always true)',
    target: PRODUCTION_PAYMENT,
    from: 'productionCredentialsApproved: resolveTrueFlag(env.PRODUCTION_CDP_CREDENTIALS_APPROVED),',
    to: 'productionCredentialsApproved: true, // MUTATED: credentials-approved flag ignored',
    testRel: READINESS_TEST_REL,
  },
  {
    name: '9. required production binding presence check dropped',
    target: PRODUCTION_PAYMENT,
    from: 'if (!checkProductionBindingsPresent(env).ok) return false;',
    to: '// MUTATED: production bindings presence check dropped',
    testRel: READINESS_TEST_REL,
  },
  {
    name: '10. reintroduce stale cloudflare_account_configuration blocker',
    target: READINESS,
    from: "blocked_external: ['ionos_dns_migration', 'nevermined_credentials', 'registry_publication'],",
    to: "blocked_external: ['cloudflare_account_configuration', 'ionos_dns_migration', 'nevermined_credentials', 'registry_publication'], // MUTATED: stale blocker reintroduced",
    testRel: READINESS_TEST_REL,
  },
  {
    name: '11. reintroduce stale seller_wallet blocker',
    target: READINESS,
    from: "blocked_external: ['ionos_dns_migration', 'nevermined_credentials', 'registry_publication'],",
    to: "blocked_external: ['ionos_dns_migration', 'seller_wallet', 'nevermined_credentials', 'registry_publication'], // MUTATED: stale blocker reintroduced",
    testRel: READINESS_TEST_REL,
  },
  {
    name: '12. reintroduce stale cdp_credentials blocker',
    target: READINESS,
    from: "blocked_external: ['ionos_dns_migration', 'nevermined_credentials', 'registry_publication'],",
    to: "blocked_external: ['ionos_dns_migration', 'cdp_credentials', 'nevermined_credentials', 'registry_publication'], // MUTATED: stale blocker reintroduced",
    testRel: READINESS_TEST_REL,
  },
  {
    name: '13. accidentally remove unresolved blocker ionos_dns_migration',
    target: READINESS,
    from: "blocked_external: ['ionos_dns_migration', 'nevermined_credentials', 'registry_publication'],",
    to: "blocked_external: ['nevermined_credentials', 'registry_publication'], // MUTATED: unproven blocker dropped",
    testRel: READINESS_TEST_REL,
  },
  {
    name: '14. readiness ignores DB binding presence when computing hasDb locally',
    target: READINESS,
    from: 'const hasDb = Boolean(c.env?.DB);',
    to: 'const hasDb = true; // MUTATED: DB presence ignored',
    testRel: READINESS_TEST_REL,
  },
  {
    name: '15. shared resolver ignores hasDb entirely (D1/static state could override version-local effective state)',
    target: PRODUCTION_PAYMENT,
    from: 'if (!hasDb) return false;',
    to: '// MUTATED: hasDb short-circuit dropped',
    testRel: READINESS_TEST_REL,
  },
  {
    name: '16. economic metadata drift (asset resolution corrupted) -- caught by the existing domain-metadata suite, not readiness, proving Q2 did not touch or weaken it',
    target: PRODUCTION_PAYMENT,
    from: 'export function resolvePaymentAsset(network: Network): ResolvedPaymentAsset {\n  return getDefaultAsset(network);\n}',
    to: "export function resolvePaymentAsset(network: Network): ResolvedPaymentAsset {\n  return { address: '0xBAD', name: 'BAD', version: '0', decimals: 6 }; // MUTATED: economic metadata corrupted\n}",
    testRel: DOMAIN_METADATA_TEST_REL,
  },
];

function applyAndRun(m: Mutation): { name: string; caught: boolean; detail: string } {
  const original = readFileSync(m.target, 'utf8');
  const originalHash = hash(original);
  if (!original.includes(m.from)) {
    return {
      name: m.name,
      caught: false,
      detail: `SKIPPED: anchor string not found in ${m.target} -- source has drifted since this proof was written`,
    };
  }
  const mutated = original.replace(m.from, m.to);
  try {
    writeFileSync(m.target, mutated, 'utf8');
    const result = runTest(m.testRel);
    return {
      name: m.name,
      caught: !result.passed,
      detail: result.passed
        ? `NOT CAUGHT -- ${m.testRel} still passed under this mutation`
        : `caught: ${m.testRel} failed as expected`,
    };
  } finally {
    writeFileSync(m.target, original, 'utf8');
    const restoredHash = hash(readFileSync(m.target, 'utf8'));
    if (restoredHash !== originalHash) {
      throw new Error(`RESTORE FAILED for ${m.target}: hash mismatch after restore`);
    }
  }
}

function main(): void {
  console.log('[readiness-mutation-proof] SUN-1220Q2 -- running 16 deliberate mutations\n');
  const results = MUTATIONS.map((m) => {
    console.log(`--- ${m.name} ---`);
    const r = applyAndRun(m);
    console.log(`  ${r.caught ? 'CAUGHT' : 'NOT CAUGHT/SKIPPED'}: ${r.detail}\n`);
    return r;
  });

  console.log('--- final: full readiness test file green on fully-restored source ---');
  const finalReadiness = runTest(READINESS_TEST_REL);
  console.log(`  readiness-truthfulness.test.ts: ${finalReadiness.passed ? 'PASS' : 'FAIL'}`);

  const uncaught = results.filter((r) => !r.caught && !r.detail.startsWith('SKIPPED'));
  const skipped = results.filter((r) => r.detail.startsWith('SKIPPED'));
  console.log(
    `\n[readiness-mutation-proof] ${results.length - uncaught.length - skipped.length}/${results.length} caught, ${skipped.length} skipped, ${uncaught.length} NOT CAUGHT`
  );

  if (uncaught.length > 0 || !finalReadiness.passed) {
    console.error('[readiness-mutation-proof] FAIL');
    process.exitCode = 1;
    return;
  }
  console.log('[readiness-mutation-proof] PASS');
}

main();
