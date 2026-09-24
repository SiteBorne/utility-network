import type { EvidenceGateId, EvidenceRecord, EvidenceValidationResult } from './types.js';
import { readEvidence } from './store.js';
import { CANONICAL_EXECUTION_PROFILE, executionProfileId } from './execution-profile.js';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function failureCount(gateId: EvidenceGateId, summary: Record<string, unknown>): number | null {
  if (gateId === 'BROAD_TEST_SUITE') {
    const v = summary.tests_failed;
    return typeof v === 'number' ? v : null;
  }
  const v = summary.fixtures_failing;
  return typeof v === 'number' ? v : null;
}

/** Structural validation only — does not check source_state_id or exit_code. */
function parseRecord(gateId: EvidenceGateId, raw: unknown): EvidenceRecord | { error: string } {
  if (!isPlainObject(raw)) return { error: 'evidence is not an object' };
  if (raw.schema_version !== 1)
    return { error: `unsupported schema_version ${String(raw.schema_version)}` };
  if (raw.gate_id !== gateId)
    return { error: `evidence gate_id ${String(raw.gate_id)} does not match ${gateId}` };
  for (const field of [
    'source_state_id',
    'command',
    'execution_profile',
    'started_at',
    'completed_at',
    'exit_code',
    'result',
    'summary',
  ]) {
    if (!(field in raw)) return { error: `evidence missing field ${field}` };
  }
  if (typeof raw.exit_code !== 'number') return { error: 'exit_code is not a number' };
  if (raw.result !== 'PASS' && raw.result !== 'FAIL') return { error: 'result is not PASS/FAIL' };
  if (typeof raw.execution_profile !== 'string' || raw.execution_profile.length === 0)
    return { error: 'execution_profile is not a non-empty string' };
  if (!isPlainObject(raw.summary)) return { error: 'summary is not an object' };
  return raw as unknown as EvidenceRecord;
}

export function validateGateEvidence(
  gateId: EvidenceGateId,
  currentSourceStateId: string
): EvidenceValidationResult {
  const raw = readEvidence(gateId);
  if (raw === undefined) return { status: 'NO_EVIDENCE' };

  const parsed = parseRecord(gateId, raw);
  if ('error' in parsed) return { status: 'INVALID_EVIDENCE', reason: parsed.error };

  const currentExecutionProfile = executionProfileId(CANONICAL_EXECUTION_PROFILE);
  if (parsed.execution_profile !== currentExecutionProfile) {
    return {
      status: 'EXECUTION_PROFILE_MISMATCH',
      recordedExecutionProfile: parsed.execution_profile,
      currentExecutionProfile,
    };
  }

  if (parsed.source_state_id !== currentSourceStateId) {
    return {
      status: 'STALE_EVIDENCE',
      recordedSourceStateId: parsed.source_state_id,
      currentSourceStateId,
    };
  }

  const failures = failureCount(gateId, parsed.summary as Record<string, unknown>);
  const passes =
    parsed.exit_code === 0 && parsed.result === 'PASS' && (failures === null || failures === 0);

  return passes
    ? { status: 'PASS', evidence: parsed }
    : { status: 'FAILED_EVIDENCE', evidence: parsed };
}
