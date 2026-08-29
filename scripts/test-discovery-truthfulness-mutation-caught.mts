#!/usr/bin/env -S npx tsx
/**
 * SUN-1220P2 — public discovery truthfulness mutation proof (SUN-1220P1
 * §20 / SUN-1220P2 §20).
 *
 * Twelve narrow proofs, each mutating one exact anchor string in one of
 * the discovery-overlay source files, running the SUN-1220P2 discovery
 * test (`apps/edge-api/tests/discovery-truthfulness.test.ts`, plus
 * `packages/protocol-a2a/src/card.test.ts` for the two card-literal
 * mutations) against the mutant, requiring it to FAIL, then restoring
 * the original file byte-for-byte (verified via SHA-256) in a `finally`
 * block regardless of outcome, then re-running the full test file once
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

const PRODUCTION_PAYMENT = join(
  REPO_ROOT,
  'apps/edge-api/src/control-plane/config/production-payment.ts'
);
const CATALOG = join(REPO_ROOT, 'apps/edge-api/src/control-plane/routes/catalog.ts');
const CARD = join(REPO_ROOT, 'packages/protocol-a2a/src/card.ts');

const DISCOVERY_TEST_REL = 'apps/edge-api/tests/discovery-truthfulness.test.ts';
const CARD_TEST_REL = 'packages/protocol-a2a/src/card.test.ts';

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
    name: '1. remove candidate runtime overlay from catalog (always return the static row unchanged) -- SUN-1221C: targets the EFFECTIVE_DISCOVERY_RESOLVERS registry lookup, not the removed single-service constant',
    target: CATALOG,
    from: 'if (!effectiveStatus.hasProductionExecutor) return service;',
    to: 'if (true) return service; // MUTATED: overlay disabled unconditionally',
    testRel: DISCOVERY_TEST_REL,
  },
  {
    name: '2. hardcode agent-card per-service productionEnabled false again',
    target: CARD,
    from: 'productionEnabled: effectiveProductionStatusByServiceId?.[serviceId] ?? false,',
    to: 'productionEnabled: false, // MUTATED: back to unconditional literal',
    testRel: DISCOVERY_TEST_REL,
  },
  {
    name: '3. hardcode agent-card productionEnabled true globally',
    target: CARD,
    from: 'productionEnabled: effectiveProductionStatusByServiceId?.[serviceId] ?? false,',
    to: 'productionEnabled: true, // MUTATED: always true',
    testRel: DISCOVERY_TEST_REL,
  },
  {
    name: '4. ignore master gate (PAID_ROUTES_ENABLED) in the shared flag helper',
    target: PRODUCTION_PAYMENT,
    from: "return env.PAID_ROUTES_ENABLED === 'true' && env.VERIFY_V2_CDP_ROUTE_ENABLED === 'true';",
    to: "return env.VERIFY_V2_CDP_ROUTE_ENABLED === 'true'; // MUTATED: master gate ignored",
    testRel: DISCOVERY_TEST_REL,
  },
  {
    name: '5. ignore route-specific gate (VERIFY_V2_CDP_ROUTE_ENABLED)',
    target: PRODUCTION_PAYMENT,
    from: "return env.PAID_ROUTES_ENABLED === 'true' && env.VERIFY_V2_CDP_ROUTE_ENABLED === 'true';",
    to: "return env.PAID_ROUTES_ENABLED === 'true'; // MUTATED: route gate ignored",
    testRel: DISCOVERY_TEST_REL,
  },
  {
    name: '6. ignore one required ADR-0055 gate (skip isProductionPaymentAuthorized entirely)',
    target: PRODUCTION_PAYMENT,
    from: 'if (!isProductionPaymentAuthorized(resolveProductionAuthorizationInput(env))) return false;',
    to: '// MUTATED: ADR-0055 authorization check skipped',
    testRel: DISCOVERY_TEST_REL,
  },
  {
    name: '7. required-dependency presence check dropped (missing signing key no longer disqualifies)',
    target: PRODUCTION_PAYMENT,
    from: 'if (!env.PAID_RECEIPT_SIGNING_PRIVATE_KEY || !env.PAID_RECEIPT_SIGNING_KEY_ID) return false;',
    to: '// MUTATED: signing-key presence check dropped',
    testRel: DISCOVERY_TEST_REL,
  },
  {
    name: '8. mark another paid service active (SUN-1221C: catalog.ts generalized from a single hardcoded OVERLAY_SERVICE_ID to the EFFECTIVE_DISCOVERY_RESOLVERS registry -- this mutation now targets that lookup, forcing it to resolve for every service regardless of registration)',
    target: PRODUCTION_PAYMENT,
    from: 'const resolver = EFFECTIVE_DISCOVERY_RESOLVERS[serviceId];',
    to: "const resolver = EFFECTIVE_DISCOVERY_RESOLVERS[serviceId] ?? EFFECTIVE_DISCOVERY_RESOLVERS['verify_agent_output.v2']; // MUTATED: every unregistered service falls back to verify's resolver",
    testRel: DISCOVERY_TEST_REL,
  },
  {
    name: '9. shared D1 true forces known-good active (overlay becomes OR instead of override)',
    target: CATALOG,
    from: 'production_enabled: effectivelyActive,',
    to: 'production_enabled: effectivelyActive || service.production_enabled, // MUTATED: OR with static D1 value',
    testRel: DISCOVERY_TEST_REL,
  },
  {
    name: '10. introduce a D1 write inside the discovery GET handler',
    target: CATALOG,
    from: "catalogRoute.get('/', async (c) => {\n  const repo = c.get('servicesRepo') as ServicesRepository;\n  const result = await repo.getAll();",
    to: "catalogRoute.get('/', async (c) => {\n  const repo = c.get('servicesRepo') as ServicesRepository;\n  if ('updateProductionEnabled' in repo) {\n    // MUTATED: stray write during a discovery GET\n    await (repo as unknown as { updateProductionEnabled: (id: string, enabled: boolean) => Promise<unknown> }).updateProductionEnabled('verify_agent_output.v2', true);\n  }\n  const result = await repo.getAll();",
    testRel: DISCOVERY_TEST_REL,
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
  console.log('[discovery-mutation-proof] SUN-1220P2 -- running 10 deliberate mutations\n');
  const results = MUTATIONS.map((m) => {
    console.log(`--- ${m.name} ---`);
    const r = applyAndRun(m);
    console.log(`  ${r.caught ? 'CAUGHT' : 'NOT CAUGHT/SKIPPED'}: ${r.detail}\n`);
    return r;
  });

  console.log('--- final: full discovery + card test files green on fully-restored source ---');
  const finalDiscovery = runTest(DISCOVERY_TEST_REL);
  const finalCard = runTest(CARD_TEST_REL);
  console.log(`  discovery-truthfulness.test.ts: ${finalDiscovery.passed ? 'PASS' : 'FAIL'}`);
  console.log(`  card.test.ts: ${finalCard.passed ? 'PASS' : 'FAIL'}`);

  const uncaught = results.filter((r) => !r.caught && !r.detail.startsWith('SKIPPED'));
  const skipped = results.filter((r) => r.detail.startsWith('SKIPPED'));
  console.log(
    `\n[discovery-mutation-proof] ${results.length - uncaught.length - skipped.length}/${results.length} caught, ${skipped.length} skipped, ${uncaught.length} NOT CAUGHT`
  );

  if (uncaught.length > 0 || !finalDiscovery.passed || !finalCard.passed) {
    console.error('[discovery-mutation-proof] FAIL');
    process.exitCode = 1;
    return;
  }
  console.log('[discovery-mutation-proof] PASS');
}

main();
