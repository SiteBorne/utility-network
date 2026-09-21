/**
 * INTERNAL closed vocabularies for verifier finding codes and failure codes.
 *
 * No pre-existing canonical runtime vocabulary exists: verifiers emit codes as
 * bare strings (packages/verification/src/verifiers/*.ts), the mesh adds
 * verifier_timeout/verifier_exception, and prompt-injection findings are
 * `injection_${signal.type}` with signal types listed in
 * packages/provider-adapters/src/html/injection-signals.ts. This module
 * enumerates them once so the internal finalized artifact can reject anything
 * else (arbitrary provider strings, LLM-generated codes) before it is bound
 * into a proof. It is not a public schema.
 */
import type { ServiceFailureCode } from '../types';

export class UnknownCodeError extends Error {
  constructor(
    public readonly vocabulary: 'finding' | 'verifier_failure' | 'service_failure',
    public readonly code: string
  ) {
    super(`unknown_${vocabulary}_code:${code}`);
    this.name = 'UnknownCodeError';
  }
}

const INJECTION_SIGNAL_TYPES = [
  'act_as',
  'bypass_safety',
  'conflicting_instructions',
  'disregard_instructions',
  'dynamic_code_execution',
  'eval_injection',
  'execute_code',
  'exposed_secret',
  'function_constructor',
  'hidden_content',
  'hidden_content_css',
  'ignore_guardrails',
  'ignore_instructions',
  'jailbreak_attempt',
  'output_prompt',
  'override_instructions',
  'pretend_to_be',
  'print_prompt',
  'reveal_prompt',
  'rtl_override',
  'run_code',
  'setinterval_injection',
  'settimeout_injection',
  'show_prompt',
  'system_prompt_leak',
  'zero_width_chars',
] as const;

export const FINDING_CODES: ReadonlySet<string> = new Set([
  'absence_from_disqualified_source',
  'claim_references_missing_evidence',
  'completeness_overstated',
  'cross_source_disagreement',
  'evidence_disqualified',
  'evidence_no_hash',
  'evidence_no_locator',
  'inconsistent_completeness_counts',
  'invalid_retrieved_at',
  'negative_field_count',
  'reproduction_mismatch',
  'reproduction_unavailable',
  'schema_violation',
  'unknown_authorization_classification',
  'unknown_result_class',
  'unknown_service',
  'unsupported_material_claim',
  'verified_absent_without_evidence',
  // Emitted by the mesh itself (mesh.ts runVerifier) for a timed-out / throwing verifier.
  'verifier_exception',
  'verifier_timeout',
  ...INJECTION_SIGNAL_TYPES.map((type) => `injection_${type}`),
]);

export const VERIFIER_FAILURE_CODES: ReadonlySet<string> = new Set([
  'completeness_inconsistent',
  'evidence_inaccessible',
  'prompt_injection_confirmed',
  'provenance_invalid',
  'reproduction_mismatch',
  'reproduction_unavailable',
  'schema_not_found',
  'schema_not_registered',
  'schema_violation',
  'unknown_service',
  'unsupported_claim',
  'verifier_exception',
  'verifier_timeout',
]);

const SERVICE_FAILURE_CODE_LIST: readonly ServiceFailureCode[] = [
  'invalid_request',
  'unknown_service',
  'contract_mismatch',
  'dependency_unavailable',
  'provider_rate_limited',
  'provider_policy_blocked',
  'source_changed',
  'artifact_unavailable',
  'ocr_permission_required',
  'document_processing_failed',
  'verification_failed',
  'reproduction_unavailable',
  'execution_timeout',
  'result_limit_exceeded',
  'internal_verification_failed',
  'internal_error',
];

export const SERVICE_FAILURE_CODES: ReadonlySet<string> = new Set(SERVICE_FAILURE_CODE_LIST);

export function assertKnownFindingCode(code: string): void {
  if (!FINDING_CODES.has(code)) throw new UnknownCodeError('finding', code);
}

export function assertKnownVerifierFailureCode(code: string): void {
  if (!VERIFIER_FAILURE_CODES.has(code)) throw new UnknownCodeError('verifier_failure', code);
}

export function assertKnownServiceFailureCode(code: string): asserts code is ServiceFailureCode {
  if (!SERVICE_FAILURE_CODES.has(code)) throw new UnknownCodeError('service_failure', code);
}
