/**
 * Boundary between the service-runtime INTERNAL finalized-result artifact and
 * the paid-continuation Workflow's `ExecutorOutcome`.
 *
 * `invoke-executor` is a durable Workflow step whose return value is persisted,
 * so the full internal artifact (semantic PCC + frozen snapshots) is NOT carried
 * across it: only the small typed `linkEvidenceInputs` the persistence layer
 * needs is projected out, and the artifact is dropped from `result`. Everything
 * else in `result` (including the current public `receipt`) is unchanged, so
 * this checkpoint leaves the released wire body byte-identical.
 */
import type { ServiceExecutionResult } from '@siteborne/service-runtime';
import type { ExecutorOutcome } from '../routes/x402-service';

export function toExecutorOutcomeResult(result: ServiceExecutionResult): {
  result: ExecutorOutcome['result'];
  linkEvidenceInputs?: ExecutorOutcome['linkEvidenceInputs'];
} {
  const { finalized, ...publicResult } = result;
  return {
    result: publicResult,
    ...(finalized ? { linkEvidenceInputs: finalized.linkEvidenceInputs } : {}),
  };
}
