#!/usr/bin/env -S npx tsx
/**
 * SUN-1221E2D §15 — web-context executor diagnostics mutation proof.
 *
 * Ten narrow proofs, each mutating one exact anchor string in one of the
 * four SUN-1221E2D source files, running the relevant test file against
 * the mutant, requiring it to FAIL, then restoring the original file
 * byte-for-byte (verified via SHA-256) in a `finally` block regardless
 * of outcome, then re-running every touched test file once more at the
 * end to prove the fully-restored source is green again.
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

const ERRORS_TS = join(REPO_ROOT, 'packages/provider-adapters/src/errors.ts');
const SOCKET_CLIENT = join(REPO_ROOT, 'packages/provider-adapters/src/http/socket-http-client.ts');
const SERVICE_TS = join(REPO_ROOT, 'packages/service-runtime/src/services/web-context/service.ts');
const X402_SERVICE = join(REPO_ROOT, 'apps/edge-api/src/control-plane/routes/x402-service.ts');

const CLASSIFICATION_TEST = 'packages/provider-adapters/src/tests/web-context-diagnostic-classification.test.ts';
const TRANSPORT_TEST = 'packages/provider-adapters/src/tests/web-context-transport-diagnostics.test.ts';
const SERVICE_TEST = 'packages/service-runtime/src/services/web-context/service.test.ts';
const ROUTE_TEST = 'apps/edge-api/tests/x402-service-route.test.ts';

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
    name: '1. classifyGenericAdapterErrorReason always returns the catch-all bucket (silences every specific reason code)',
    target: ERRORS_TS,
    from: "export function classifyGenericAdapterErrorReason(error: Error): string {",
    to: "export function classifyGenericAdapterErrorReason(_error: Error): string {\n  return 'WEBCTX_UPSTREAM_PROTOCOL_ERROR'; // MUTATED: every reason collapses to the catch-all\n  // eslint-disable-next-line no-unreachable\n  const error = _error;",
    testRel: CLASSIFICATION_TEST,
  },
  {
    name: '2. toAdapterResult reverts to the old generic INTERNAL_ERROR code (drops the classifier call entirely)',
    target: ERRORS_TS,
    from: 'code: classifyGenericAdapterErrorReason(error),',
    to: "code: 'INTERNAL_ERROR', // MUTATED: classifier bypassed",
    testRel: CLASSIFICATION_TEST,
  },
  {
    name: '3. connect/TLS transport wrap tags the wrong reason prefix (silent branch re-opened under a decoy label)',
    target: SOCKET_CLIENT,
    from: '`WEBCTX_UPSTREAM_CONNECTION_FAILED: ${err instanceof Error ? err.message : String(err)}`,',
    to: "`WEBCTX_REQUEST_WRITE_FAILED: ${err instanceof Error ? err.message : String(err)}`, // MUTATED: wrong stage tag",
    testRel: TRANSPORT_TEST,
  },
  {
    name: '4. request-write transport wrap tags the wrong reason prefix',
    target: SOCKET_CLIENT,
    from: '`WEBCTX_REQUEST_WRITE_FAILED: ${err instanceof Error ? err.message : String(err)}`,',
    to: "`WEBCTX_UPSTREAM_CONNECTION_FAILED: ${err instanceof Error ? err.message : String(err)}`, // MUTATED: wrong stage tag",
    testRel: TRANSPORT_TEST,
  },
  {
    name: '5. connect/TLS wrap drops the { cause } option (the original raw error becomes unrecoverable)',
    target: SOCKET_CLIENT,
    from: "`WEBCTX_UPSTREAM_CONNECTION_FAILED: ${err instanceof Error ? err.message : String(err)}`,\n        { cause: err }\n      );",
    to: "`WEBCTX_UPSTREAM_CONNECTION_FAILED: ${err instanceof Error ? err.message : String(err)}`\n        // MUTATED: cause dropped\n      );",
    testRel: TRANSPORT_TEST,
  },
  {
    name: "6. WebContextVerifiedService.execute never detects an HTTP-layer failure (httpFetchFailed hardcoded false -- SUN-1221E2's exact real gap re-opened)",
    target: SERVICE_TS,
    from: 'const httpFetchFailed = resultClass !== \'success\';',
    to: "const httpFetchFailed = false; // MUTATED: SUN-1221E2's exact gap re-opened",
    testRel: SERVICE_TEST,
  },
  {
    name: '7. diagnostic_stage value silently changed (breaks correlation with the real failure boundary)',
    target: SERVICE_TS,
    from: "diagnostic_stage: 'direct_public_http_fetch' as const,",
    to: "diagnostic_stage: 'somewhere' as const, // MUTATED: wrong stage label",
    testRel: SERVICE_TEST,
  },
  {
    name: '8. composition boundary stops writing the diagnostic audit event entirely (silent branch re-opened at the route layer)',
    target: X402_SERVICE,
    from: "      const failureDetails = outcome.result.failure?.details;\n      await audit('service_execution_diagnostic', {\n        job_id: jobId,\n        request_id: requestId,\n        result_class: outcome.result.result_class,\n        ...(failureDetails && typeof failureDetails === 'object' ? failureDetails : {}),\n      });\n",
    to: "      // MUTATED: diagnostic audit event write removed\n",
    testRel: ROUTE_TEST,
  },
  {
    name: '9. composition boundary writes the diagnostic event TWICE per failure (duplicate-event regression)',
    target: X402_SERVICE,
    from: "        ...(failureDetails && typeof failureDetails === 'object' ? failureDetails : {}),\n      });\n",
    to: "        ...(failureDetails && typeof failureDetails === 'object' ? failureDetails : {}),\n      });\n      await audit('service_execution_diagnostic', { job_id: jobId, request_id: requestId, result_class: outcome.result.result_class, duplicate: true }); // MUTATED: fires twice\n",
    testRel: ROUTE_TEST,
  },
  {
    name: '10. public 502 body leaks the internal diagnostic details (the exact "no new detail in the public body" rule violated)',
    target: X402_SERVICE,
    from: "      return jsonError(\n        c,\n        502,\n        'service_execution_failed',\n        outcome.result.failure?.message ?? `result_class=${outcome.result.result_class}`\n      );",
    to: "      return jsonError(\n        c,\n        502,\n        'service_execution_failed',\n        outcome.result.failure?.message ?? `result_class=${outcome.result.result_class}`,\n        failureDetails // MUTATED: internal details leaked into the public response\n      );",
    testRel: ROUTE_TEST,
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
  console.log('[web-context-diagnostics-mutation-proof] SUN-1221E2D -- running 10 deliberate mutations\n');
  const results = MUTATIONS.map((m) => {
    console.log(`--- ${m.name} ---`);
    const r = applyAndRun(m);
    console.log(`  ${r.caught ? 'CAUGHT' : 'NOT CAUGHT/SKIPPED'}: ${r.detail}\n`);
    return r;
  });

  console.log('--- final: all four touched test files green on fully-restored source ---');
  const finalResults = [CLASSIFICATION_TEST, TRANSPORT_TEST, SERVICE_TEST, ROUTE_TEST].map((t) => ({
    test: t,
    result: runTest(t),
  }));
  for (const { test, result } of finalResults) {
    console.log(`  ${test}: ${result.passed ? 'PASS' : 'FAIL'}`);
  }

  const uncaught = results.filter((r) => !r.caught && !r.detail.startsWith('SKIPPED'));
  const skipped = results.filter((r) => r.detail.startsWith('SKIPPED'));
  console.log(
    `\n[web-context-diagnostics-mutation-proof] ${results.length - uncaught.length - skipped.length}/${results.length} caught, ${skipped.length} skipped, ${uncaught.length} NOT CAUGHT`
  );

  const anyFinalFailed = finalResults.some((f) => !f.result.passed);
  if (uncaught.length > 0 || anyFinalFailed) {
    console.error('[web-context-diagnostics-mutation-proof] FAIL');
    process.exitCode = 1;
    return;
  }
  console.log('[web-context-diagnostics-mutation-proof] PASS');
}

main();
