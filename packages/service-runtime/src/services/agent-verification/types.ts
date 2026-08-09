export type ClaimPredicate =
  | 'equals'
  | 'contains'
  | 'matches'
  | 'greater_than'
  | 'less_than'
  | 'exists'
  | 'not_exists';
export type DeterministicCheck =
  | 'schema_valid'
  | 'hash_match'
  | 'signature_valid'
  | 'evidence_resolves'
  | 'no_pii'
  | 'no_secrets';

export interface AgentVerificationInput {
  verification_contract: {
    claims: Array<{
      claim_id: string;
      predicate: ClaimPredicate;
      expected_value: unknown;
      tolerance?: number;
      materiality?: 'material' | 'supporting' | 'contextual';
    }>;
    deterministic_requirements: Array<{
      requirement_id: string;
      check: DeterministicCheck;
      parameters?: Record<string, unknown>;
    }>;
  };
  candidate_output: Record<string, unknown>;
  required_schema: Record<string, unknown>;
  verification_mode: 'standard' | 'independent_reproduction';
  minimum_score?: number;
}

export interface AgentVerificationExtension {
  verification_mode?: 'standard' | 'independent_reproduction';
  outcome?: 'pass' | 'fail' | 'conditional';
  score?: number;
  requirement_results?: Array<{
    requirement_id: string;
    passed: boolean;
    details?: string;
    evidence_ids?: string[];
  }>;
  schema_result?: { valid: boolean; errors?: string[] };
  claim_support_result?: {
    supported: boolean;
    supported_count?: number;
    unsupported_count: number;
    conflicting_count?: number;
  };
  failed_requirements?: string[];
  deterministic_failures?: string[];
  unverifiable_assertions?: string[];
  limitations?: string[];
  candidate_output_hash?: string;
  reproduction_agreement_score?: number;
  verifier_classes_used?: string[];
  policy_version?: string;
}
