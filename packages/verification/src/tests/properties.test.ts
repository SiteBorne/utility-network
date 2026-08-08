/**
 * Property-based tests for the verification mesh's core invariant: the
 * mesh is never a voting system. Uses fast-check with deterministic,
 * bounded, no-network generators — matching the discipline already
 * established in packages/provider-adapters and services/modal-worker.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { runMesh } from '../mesh';
import { buildContext, createTestClock } from '../context';
import { validCandidate } from './fixtures';
import type { Verifier, VerificationResult, VerificationStatus, Severity } from '../types';

const POLICY_HASH = 'sha256:' + '0'.repeat(64);
const VERIFIER_IDS = [
  'schema_verifier',
  'evidence_accessibility_verifier',
  'claim_evidence_verifier',
  'freshness_verifier',
  'completeness_verifier',
  'cross_source_verifier',
  'provenance_verifier',
  'prompt_injection_verifier',
] as const;

const DEPENDS_ON: Record<string, string[]> = {
  schema_verifier: [],
  evidence_accessibility_verifier: ['schema_verifier'],
  claim_evidence_verifier: ['evidence_accessibility_verifier'],
  freshness_verifier: ['schema_verifier'],
  completeness_verifier: ['evidence_accessibility_verifier'],
  cross_source_verifier: ['claim_evidence_verifier'],
  provenance_verifier: ['schema_verifier'],
  prompt_injection_verifier: ['schema_verifier'],
};

function stubResult(
  id: string,
  status: VerificationStatus,
  severity: Severity
): VerificationResult {
  return {
    verifier_id: id,
    verifier_version: '1.0.0',
    status,
    severity,
    rule_id: status === 'fail' ? 'stub_deterministic_failure' : 'stub_pass',
    subject: 'stub',
    claims_checked: 0,
    evidence_checked: 0,
    findings:
      status === 'fail' && severity === 'blocking'
        ? [{ code: 'stub_deterministic_failure', message: 'stub', severity: 'blocking' }]
        : [],
    failure_codes:
      status === 'fail' && severity === 'blocking' ? ['stub_deterministic_failure'] : [],
    warnings: [],
    limitations: [],
    input_hash: 'sha256:' + '1'.repeat(64),
    evidence_hashes: [],
    started_at: '2026-08-05T10:00:00Z',
    completed_at: '2026-08-05T10:00:00Z',
    elapsed_ms: 0,
    deterministic: true,
    retryable: false,
    provenance: [],
    score: status === 'pass' ? 1 : 0,
  };
}

function stubVerifier(id: string, status: VerificationStatus, severity: Severity): Verifier {
  return {
    verifierId: id,
    verifierVersion: '1.0.0',
    capabilities: [],
    dependsOn: DEPENDS_ON[id] ?? [],
    mandatory: true,
    verify: () => stubResult(id, status, severity),
  };
}

// A per-verifier outcome generator: mostly 'pass', sometimes a blocking
// 'fail'. Non-blocking fail/indeterminate outcomes are excluded here
// because the mesh's contract only requires blocking mandatory failures to
// force the verdict — see mesh.test.ts for the indeterminate/conditional
// path, tested with concrete cases rather than at random.
const outcomeArb = fc.constantFrom<{ status: VerificationStatus; severity: Severity }>(
  { status: 'pass', severity: 'info' },
  { status: 'fail', severity: 'blocking' }
);

describe('runMesh property: non-voting fail-closed guarantee', () => {
  it('the decision is `pass` iff none of the 8 mandatory verifiers had a blocking failure — for every combination', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(outcomeArb, { minLength: 8, maxLength: 8 }), async (outcomes) => {
        const verifiers = VERIFIER_IDS.map((id, i) =>
          stubVerifier(id, outcomes[i]!.status, outcomes[i]!.severity)
        );
        const context = buildContext({ clock: createTestClock(), mode: 'standard' });
        const verdict = await runMesh(verifiers, validCandidate(), context, {
          policyHash: POLICY_HASH,
        });

        const anyBlockingFail = outcomes.some(
          (o) => o.status === 'fail' && o.severity === 'blocking'
        );
        if (anyBlockingFail) {
          expect(verdict.decision).not.toBe('pass');
        } else {
          expect(verdict.decision).toBe('pass');
        }
      }),
      { numRuns: 200 }
    );
  });

  it('the decision never becomes `pass` merely because a majority of verifiers passed', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 7 }), async (blockingCount) => {
        // Exactly `blockingCount` of the 8 mandatory verifiers fail
        // (blocking); the rest pass. A numeric-majority voting system
        // would pass this whenever blockingCount < 4 — the mesh must not.
        const outcomes: Array<{ status: VerificationStatus; severity: Severity }> =
          VERIFIER_IDS.map((_, i) =>
            i < blockingCount
              ? { status: 'fail', severity: 'blocking' }
              : { status: 'pass', severity: 'info' }
          );
        const verifiers = VERIFIER_IDS.map((id, i) =>
          stubVerifier(id, outcomes[i]!.status, outcomes[i]!.severity)
        );
        const context = buildContext({ clock: createTestClock(), mode: 'standard' });
        const verdict = await runMesh(verifiers, validCandidate(), context, {
          policyHash: POLICY_HASH,
        });
        expect(verdict.decision).not.toBe('pass');
      }),
      { numRuns: 50 }
    );
  });
});

describe('canonicalize property: deterministic and key-order independent', () => {
  it('re-orders of the same flat object canonicalize identically', async () => {
    const { canonicalize } = await import('../canonical');
    await fc.assert(
      fc.property(fc.dictionary(fc.string({ minLength: 1, maxLength: 8 }), fc.integer()), (obj) => {
        const shuffled = Object.fromEntries(Object.entries(obj).reverse());
        expect(canonicalize(obj)).toBe(canonicalize(shuffled));
      }),
      { numRuns: 100 }
    );
  });
});
