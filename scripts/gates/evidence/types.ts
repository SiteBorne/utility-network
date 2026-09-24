export type EvidenceGateId = 'BROAD_TEST_SUITE' | 'NEGATIVE_FIXTURE_SUITE';

export interface BaseEvidenceRecord {
  schema_version: 1;
  gate_id: EvidenceGateId;
  source_state_id: string;
  command: string;
  execution_profile: string;
  started_at: string;
  completed_at: string;
  exit_code: number;
  result: 'PASS' | 'FAIL';
}

export interface BroadTestSuiteEvidence extends BaseEvidenceRecord {
  gate_id: 'BROAD_TEST_SUITE';
  summary: {
    test_files_passed: number;
    test_files_failed: number;
    test_files_skipped: number;
    tests_passed: number;
    tests_failed: number;
    tests_skipped: number;
  };
}

export interface NegativeFixtureSuiteEvidence extends BaseEvidenceRecord {
  gate_id: 'NEGATIVE_FIXTURE_SUITE';
  summary: {
    fixtures_total: number;
    fixtures_passing: number;
    fixtures_failing: number;
  };
}

export type EvidenceRecord = BroadTestSuiteEvidence | NegativeFixtureSuiteEvidence;

export type EvidenceValidationResult =
  | { status: 'PASS'; evidence: EvidenceRecord }
  | { status: 'NO_EVIDENCE' }
  | { status: 'INVALID_EVIDENCE'; reason: string }
  | { status: 'STALE_EVIDENCE'; recordedSourceStateId: string; currentSourceStateId: string }
  | {
      status: 'EXECUTION_PROFILE_MISMATCH';
      recordedExecutionProfile: string;
      currentExecutionProfile: string;
    }
  | { status: 'FAILED_EVIDENCE'; evidence: EvidenceRecord };
