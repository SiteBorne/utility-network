#!/usr/bin/env tsx
/**
 * SITEBORNE-FINAL-LOCAL-CONVERGENCE-01 — local pre-freeze gate aggregator.
 * Reuses governance/RELEASE_GATE_MANIFEST.yaml as the single authoritative
 * gate list rather than duplicating gate names here. For each
 * `phase: local_predeployment` gate it either runs the real command in
 * `evidence_source` (EXISTING_CHECK / NEW_CHECK_REQUIRED) or derives the
 * result from `gates:v3-service-parity`'s own JSON output
 * (DERIVED_FROM_EXISTING_EVIDENCE) — it never re-implements a check that
 * already exists elsewhere, per the governed mission's "do not duplicate
 * expensive suites unnecessarily" instruction.
 *
 * A local release-blocking FAIL/NOT_RUN/UNCLASSIFIED gate produces a
 * non-zero exit. External and not-verifiable-in-this-repo gates never
 * block local convergence — they are counted and reported, not silently
 * turned into a PASS.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { computeSourceStateId } from './evidence/source-state.js';
import { validateGateEvidence } from './evidence/validate.js';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

interface GateDef {
  name: string;
  semantic_invariant: string;
  canonical_authority: string;
  evidence_source: string;
  phase: 'local_predeployment' | 'cutover' | 'production_activation';
  release_blocking: boolean;
  classification:
    | 'EXISTING_CHECK'
    | 'DERIVED_FROM_EXISTING_EVIDENCE'
    | 'NEW_CHECK_REQUIRED'
    | 'EXTERNALLY_VERIFIED_LATER'
    | 'NOT_VERIFIABLE_IN_THIS_REPO'
    | 'GENUINELY_NOT_APPLICABLE';
}

type GateStatus =
  | 'PASS'
  | 'FAIL'
  | 'NOT_RUN'
  | 'EXTERNALLY_VERIFIED_LATER'
  | 'NOT_VERIFIABLE_IN_THIS_REPO'
  | 'GENUINELY_NOT_APPLICABLE';

const DERIVED_FIELD_BY_GATE: Record<string, string[]> = {
  MIXED_RELEASE_SWEEP: ['MIXED_RELEASE_CURRENT_PROJECTIONS', 'STALE_V2_CURRENT_DEFAULT_REFERENCES'],
  ECONOMIC_PROJECTION_PARITY: ['OPENAPI_V3_ECONOMIC_PARITY'],
  RESULT_AUTHORIZATION_PROJECTION_PARITY: ['OPENAPI_V3_AUTHORIZATION_PARITY'],
};

// Runs the multi-command `evidence_source` strings verbatim via a real
// shell, exactly as a human would type them — no re-implementation of what
// each command does.
function runShell(command: string): { ok: boolean; output: string } {
  try {
    const output = execSync(command, { cwd: REPO_ROOT, encoding: 'utf-8', stdio: 'pipe' });
    return { ok: true, output };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, output: `${err.stdout ?? ''}\n${err.stderr ?? ''}` };
  }
}

function main(): void {
  const manifestText = readFileSync(
    join(REPO_ROOT, 'governance/RELEASE_GATE_MANIFEST.yaml'),
    'utf-8'
  );
  const manifest = parseYaml(manifestText) as { gates: GateDef[] };

  const unclassified = manifest.gates.filter((g) => !g.classification);
  if (unclassified.length > 0) {
    console.error(
      'GATES_UNCLASSIFIED > 0:',
      unclassified.map((g) => g.name)
    );
    process.exit(1);
  }

  const localGates = manifest.gates.filter((g) => g.phase === 'local_predeployment');
  const deferredGates = manifest.gates.filter((g) => g.phase !== 'local_predeployment');

  // Run gates:v3-service-parity once; several local gates derive from it.
  const v3ParityResult = runShell('pnpm gates:v3-service-parity');
  let v3Parity: Record<string, unknown> = {};
  try {
    // pnpm/npm may prepend warning lines before the checker's own JSON
    // output; the JSON object itself always starts at the first `{`.
    const jsonStart = v3ParityResult.output.indexOf('{');
    v3Parity = JSON.parse(v3ParityResult.output.slice(jsonStart));
  } catch {
    v3Parity = {};
  }

  const gateResults: Record<string, GateStatus> = {};
  const gateOutputs: Record<string, string> = {};
  let currentSourceStateId: string | undefined;

  for (const gate of localGates) {
    if (gate.classification === 'NOT_VERIFIABLE_IN_THIS_REPO') {
      gateResults[gate.name] = 'NOT_VERIFIABLE_IN_THIS_REPO';
      continue;
    }
    if (gate.classification === 'GENUINELY_NOT_APPLICABLE') {
      gateResults[gate.name] = 'GENUINELY_NOT_APPLICABLE';
      continue;
    }
    if (gate.classification === 'DERIVED_FROM_EXISTING_EVIDENCE') {
      const fields = DERIVED_FIELD_BY_GATE[gate.name] ?? [];
      const derivedPass = fields.every((f) => {
        const v = v3Parity[f];
        return v === 'PASS' || v === 0;
      });
      gateResults[gate.name] = fields.length > 0 ? (derivedPass ? 'PASS' : 'FAIL') : 'NOT_RUN';
      continue;
    }
    if (gate.evidence_source === 'pnpm gates:v3-service-parity') {
      gateResults[gate.name] = v3ParityResult.ok ? 'PASS' : 'FAIL';
      gateOutputs[gate.name] = v3ParityResult.output.slice(0, 2000);
      continue;
    }
    if (gate.name === 'NEGATIVE_FIXTURE_SUITE' || gate.name === 'BROAD_TEST_SUITE') {
      // These are the most expensive suites in the repo, so this aggregator
      // never re-runs them itself. Instead it validates evidence produced by
      // `pnpm release:gates:evidence:broad|negative` — a real, previously
      // captured run — bound to the exact SOURCE_STATE_ID of the current
      // working tree. Stale, missing, malformed, or failing evidence is
      // never silently read back as PASS.
      const sourceStateId = currentSourceStateId ?? (currentSourceStateId = computeSourceStateId());
      const validation = validateGateEvidence(gate.name, sourceStateId);
      gateResults[gate.name] = validation.status === 'PASS' ? 'PASS' : 'NOT_RUN';
      gateOutputs[gate.name] = JSON.stringify(validation);
      continue;
    }
    const { ok, output } = runShell(gate.evidence_source);
    gateResults[gate.name] = ok ? 'PASS' : 'FAIL';
    gateOutputs[gate.name] = output.slice(0, 2000);
  }

  for (const gate of deferredGates) {
    gateResults[gate.name] = gate.classification as GateStatus;
  }

  const releaseBlockingLocalFailures = localGates.filter(
    (g) =>
      g.release_blocking && (gateResults[g.name] === 'FAIL' || gateResults[g.name] === 'NOT_RUN')
  );

  const summary = {
    LOCAL_PREDEPLOYMENT_GATES_PASSING: localGates.filter((g) => gateResults[g.name] === 'PASS')
      .length,
    LOCAL_PREDEPLOYMENT_GATES_FAILING: localGates.filter((g) => gateResults[g.name] === 'FAIL')
      .length,
    LOCAL_PREDEPLOYMENT_GATES_NOT_RUN: localGates.filter((g) => gateResults[g.name] === 'NOT_RUN')
      .length,
    EXTERNAL_GATES_DEFERRED: deferredGates.filter(
      (g) => g.classification === 'EXTERNALLY_VERIFIED_LATER'
    ).length,
    GATES_NOT_VERIFIABLE_IN_THIS_REPO: manifest.gates.filter(
      (g) => g.classification === 'NOT_VERIFIABLE_IN_THIS_REPO'
    ).length,
    GATES_GENUINELY_NOT_APPLICABLE: manifest.gates.filter(
      (g) => g.classification === 'GENUINELY_NOT_APPLICABLE'
    ).length,
    GATES_UNCLASSIFIED: unclassified.length,
    RELEASE_BLOCKING_LOCAL_FAILURES: releaseBlockingLocalFailures.map((g) => g.name),
    gate_results: gateResults,
  };

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(summary, null, 2));
  if (process.env.RELEASE_GATES_VERBOSE) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(gateOutputs, null, 2));
  }

  if (releaseBlockingLocalFailures.length > 0 || unclassified.length > 0) {
    process.exitCode = 1;
  }
}

main();
