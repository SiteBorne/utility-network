/** Closed set of mesh-level (not per-verifier) failure codes. Mirrors
 * packages/provider-adapters/src/errors.ts and the document-worker's
 * FailureCode taxonomy. */
export type MeshFailureCode =
  | 'unknown_verifier_id'
  | 'duplicate_verifier_id'
  | 'missing_dependency'
  | 'dependency_cycle'
  | 'missing_mandatory_verifier'
  | 'verifier_exception'
  | 'verifier_timeout'
  | 'budget_exceeded'
  | 'unknown_policy_version'
  | 'unknown_service'
  | 'malformed_candidate';

export class MeshError extends Error {
  constructor(
    public readonly code: MeshFailureCode,
    message: string,
    public readonly detail?: unknown
  ) {
    super(message);
    this.name = 'MeshError';
  }
}
