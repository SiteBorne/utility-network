/**
 * Local timing benchmark for the verifier mesh (no network, no external
 * services) — reports p50/p95/p99 wall-clock time for a full standard-mode
 * runMesh() call against the valid-pass fixture, so a future regression in
 * mesh overhead (e.g. an accidentally serialized wave) is visible.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMesh } from '../src/mesh';
import { buildContext, createTestClock } from '../src/context';
import { buildStandardVerifiers } from '../src/index';
import type { CandidateResult } from '../src/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const POLICY_ID = 'pol_' + '0'.repeat(24);
const ITERATIONS = 200;

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

async function main(): Promise<void> {
  const candidate = JSON.parse(
    readFileSync(join(__dirname, '..', 'fixtures', 'candidates', '01-valid-pass.json'), 'utf-8')
  ) as CandidateResult;

  const durationsMs: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const context = buildContext({ clock: createTestClock(), mode: 'standard' });
    const start = performance.now();
    await runMesh(buildStandardVerifiers(), candidate, context, { policyId: POLICY_ID });
    durationsMs.push(performance.now() - start);
  }

  durationsMs.sort((a, b) => a - b);
  console.log(
    `runMesh() over ${ITERATIONS} iterations (valid-pass fixture, 8 standard verifiers):`
  );
  console.log(`  p50: ${percentile(durationsMs, 50).toFixed(3)}ms`);
  console.log(`  p95: ${percentile(durationsMs, 95).toFixed(3)}ms`);
  console.log(`  p99: ${percentile(durationsMs, 99).toFixed(3)}ms`);
  console.log(`  max: ${durationsMs[durationsMs.length - 1]!.toFixed(3)}ms`);

  const budgetMs = 30_000; // context.budget.totalTimeoutMs default
  const p99 = percentile(durationsMs, 99);
  if (p99 > budgetMs * 0.1) {
    console.warn(
      `\nWARNING: p99 (${p99.toFixed(3)}ms) exceeds 10% of the total mesh timeout budget (${budgetMs}ms).`
    );
  } else {
    console.log(`\np99 is well within the ${budgetMs}ms total mesh timeout budget.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
