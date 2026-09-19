#!/usr/bin/env -S npx tsx
/**
 * SUN-1221E1 — MCP/REST production-discovery coherence mutation proof.
 *
 * Each deliberate mutant changes one exact production-source anchor, runs
 * the cross-surface test against that mutant, requires a failure, and then
 * restores the target byte-for-byte in a finally block. The final canonical
 * run proves every target is fully restored and green.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PNPM = process.env.PNPM_EXECUTABLE ?? 'pnpm';
const TEST = 'apps/edge-api/tests/multi-service-discovery.test.ts';

const MCP_ROUTE = join(REPO_ROOT, 'apps/edge-api/src/routes/mcp.ts');
const PRODUCTION_PAYMENT = join(
  REPO_ROOT,
  'apps/edge-api/src/control-plane/config/production-payment.ts'
);
const CATALOG = join(REPO_ROOT, 'apps/edge-api/src/control-plane/routes/catalog.ts');

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function runCoherenceTest(): { passed: boolean; output: string } {
  try {
    const output = execFileSync(PNPM, ['exec', 'vitest', 'run', TEST], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { passed: true, output };
  } catch (error) {
    const failure = error as { stdout?: string | Buffer; stderr?: string | Buffer };
    return { passed: false, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

interface Mutation {
  name: string;
  target: string;
  from: string;
  to: string;
}

const MUTATIONS: Mutation[] = [
  {
    name: '1. hardcode MCP production_disabled',
    target: MCP_ROUTE,
    from: "production: status.productionEnabled ? 'production_enabled' : 'production_disabled',",
    to: "production: 'production_disabled', // MUTATED: stale literal",
  },
  {
    name: '2. hardcode MCP external not_live',
    target: MCP_ROUTE,
    from: "external: status.externalConfigured ? 'configured' : 'not_live',",
    to: "external: 'not_live', // MUTATED: stale literal",
  },
  {
    name: '3. reintroduce the fixture implementation label for real executors',
    target: MCP_ROUTE,
    from: "implementation: status.hasProductionExecutor ? 'real_executor' : 'local_fixture_verified',",
    to: "implementation: 'local_fixture_verified', // MUTATED: fixture-era claim",
  },
  {
    name: '4. ignore the route-specific service identity when resolving MCP status',
    target: MCP_ROUTE,
    from: 'const status = resolveEffectiveServiceRuntimeStatus(serviceId, context.env, hasDb);',
    to: "const status = resolveEffectiveServiceRuntimeStatus('verify_agent_output.v2', context.env, hasDb); // MUTATED: web follows verify",
  },
  {
    name: '5. ignore all production-authorization gates in the shared status layer',
    target: PRODUCTION_PAYMENT,
    from: 'const productionEnabled = Boolean(env && resolver?.(env, hasDb));',
    to: 'const productionEnabled = Boolean(env && hasDb && hasProductionExecutor); // MUTATED: resolver and authorization bypassed',
  },
  {
    name: '6. report MCP active while REST reports inactive',
    target: MCP_ROUTE,
    from: "production: status.productionEnabled ? 'production_enabled' : 'production_disabled',",
    to: "production: 'production_enabled', // MUTATED: false-positive activation",
  },
  {
    name: '7. report MCP inactive while REST reports active',
    target: MCP_ROUTE,
    from: "production: status.productionEnabled ? 'production_enabled' : 'production_disabled',",
    to: "production: 'production_disabled', // MUTATED: false-negative activation",
  },
  {
    name: '8. keep verify correct while web-context remains stale',
    target: MCP_ROUTE,
    from: "production: status.productionEnabled ? 'production_enabled' : 'production_disabled',",
    to: "production: serviceId === 'web_context_verified.v2' ? 'production_disabled' : status.productionEnabled ? 'production_enabled' : 'production_disabled', // MUTATED: web-only stale state",
  },
  {
    name: '9. accidentally advertise an unsupported remaining paid service active',
    target: MCP_ROUTE,
    from: "production: status.productionEnabled ? 'production_enabled' : 'production_disabled',",
    to: "production: serviceId === 'company_evidence_graph.v2' || status.productionEnabled ? 'production_enabled' : 'production_disabled', // MUTATED: unsupported activation",
  },
  {
    name: '10. let Nevermined route activation leak into MCP CDP health',
    target: MCP_ROUTE,
    from: "production: status.productionEnabled ? 'production_enabled' : 'production_disabled',",
    to: "production: context.env?.NEVERMINED_ROUTES_ENABLED === 'true' || status.productionEnabled ? 'production_enabled' : 'production_disabled', // MUTATED: rail leakage",
  },
  {
    name: '11. change the REST projection without MCP following it',
    target: CATALOG,
    // Anchor follows the catalog overlay's canonical-economics rewrite
    // (PRODUCTION-ECONOMICS-DISCOVERY-01): same projection line, new variable name.
    from: 'production_enabled: productionEnabled,',
    to: 'production_enabled: false, // MUTATED: REST/MCP divergence',
  },
  {
    name: '12. replace the shared resolver with bespoke MCP-only route-flag logic',
    target: MCP_ROUTE,
    from: 'const status = resolveEffectiveServiceRuntimeStatus(serviceId, context.env, hasDb);',
    to: "const routeOnlyEnabled = context.env?.PAID_ROUTES_ENABLED === 'true' && (serviceId === 'verify_agent_output.v2' ? context.env?.VERIFY_V2_CDP_ROUTE_ENABLED === 'true' : serviceId === 'web_context_verified.v2' ? context.env?.WEB_CONTEXT_V2_CDP_ROUTE_ENABLED === 'true' : false);\n    const status = { hasProductionExecutor: serviceId === 'verify_agent_output.v2' || serviceId === 'web_context_verified.v2', productionEnabled: routeOnlyEnabled, externalConfigured: routeOnlyEnabled }; // MUTATED: duplicated stale gate logic",
  },
];

function applyAndRun(mutation: Mutation): { caught: boolean; detail: string } {
  const original = readFileSync(mutation.target, 'utf8');
  const originalHash = sha256(original);
  const occurrences = original.split(mutation.from).length - 1;
  if (occurrences !== 1) {
    return {
      caught: false,
      detail: `anchor occurrence count was ${occurrences}, expected exactly 1`,
    };
  }

  try {
    writeFileSync(mutation.target, original.replace(mutation.from, mutation.to), 'utf8');
    const result = runCoherenceTest();
    return {
      caught: !result.passed,
      detail: result.passed
        ? 'NOT CAUGHT: coherence test remained green'
        : 'caught: coherence test failed as required',
    };
  } finally {
    writeFileSync(mutation.target, original, 'utf8');
    const restoredHash = sha256(readFileSync(mutation.target, 'utf8'));
    if (restoredHash !== originalHash) {
      throw new Error(`restoration hash mismatch for ${mutation.target}`);
    }
  }
}

function main(): void {
  console.log('[mcp-coherence-mutation-proof] SUN-1221E1 -- running 12 deliberate mutations\n');
  const results = MUTATIONS.map((mutation) => {
    console.log(`--- ${mutation.name} ---`);
    const result = applyAndRun(mutation);
    console.log(`  ${result.caught ? 'CAUGHT' : 'NOT CAUGHT'}: ${result.detail}\n`);
    return { name: mutation.name, ...result };
  });

  const final = runCoherenceTest();
  const caught = results.filter((result) => result.caught).length;
  console.log(`--- final canonical source: ${final.passed ? 'PASS' : 'FAIL'} ---`);
  console.log(`[mcp-coherence-mutation-proof] ${caught}/${results.length} caught`);

  if (caught !== results.length || !final.passed) {
    console.error('[mcp-coherence-mutation-proof] FAIL');
    for (const result of results.filter((entry) => !entry.caught)) {
      console.error(`  ${result.name}: ${result.detail}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('[mcp-coherence-mutation-proof] PASS');
}

main();
