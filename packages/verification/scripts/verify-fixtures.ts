/**
 * Runs every candidate in fixtures/FIXTURE_MATRIX.yaml through the real
 * standard-mode mesh and asserts the decision matches what the matrix
 * documents. A regression gate — not a file-existence check — so a
 * behavioral drift in mesh.ts, the verifiers, or the fixture JSON itself
 * is caught by `pnpm verification:fixtures:verify` (and root `pnpm check`).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { runMesh } from '../src/mesh';
import { buildContext, createTestClock } from '../src/context';
import { buildStandardVerifiers } from '../src/index';
import type { CandidateResult, VerificationDecision } from '../src/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '..', 'fixtures');
const POLICY_HASH = 'sha256:' + '0'.repeat(64);

interface MatrixRow {
  id: string;
  file: string;
  expected_decision: VerificationDecision;
  description: string;
}

interface Matrix {
  fixtures: MatrixRow[];
}

async function main(): Promise<void> {
  const matrix = parse(readFileSync(join(FIXTURES_DIR, 'FIXTURE_MATRIX.yaml'), 'utf-8')) as Matrix;
  let failures = 0;

  for (const row of matrix.fixtures) {
    const candidate = JSON.parse(
      readFileSync(join(FIXTURES_DIR, row.file), 'utf-8')
    ) as CandidateResult;
    const context = buildContext({ clock: createTestClock(), mode: 'standard' });
    const verdict = await runMesh(buildStandardVerifiers(), candidate, context, {
      policyHash: POLICY_HASH,
    });

    if (verdict.decision !== row.expected_decision) {
      failures++;
      console.error(
        `FIXTURE MISMATCH [${row.id}]: expected decision "${row.expected_decision}", got "${verdict.decision}"\n` +
          `  deterministic_failures: ${JSON.stringify(verdict.verification.deterministic_failures)}`
      );
    } else {
      console.log(`ok [${row.id}]: decision=${verdict.decision}`);
    }
  }

  if (failures > 0) {
    console.error(
      `\n${failures} of ${matrix.fixtures.length} fixture(s) drifted from FIXTURE_MATRIX.yaml.`
    );
    process.exit(1);
  }
  console.log(`\nAll ${matrix.fixtures.length} fixtures match their documented decision.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
