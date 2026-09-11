import type { D1Database } from '@cloudflare/workers-types';
import { getD1Failure } from './shared';

export const RECONCILIATION_CLASSIFICATIONS = [
  'legacy_execution_failed_unsettled',
  'legacy_verified_unrouted_unsettled',
  'legacy_execution_outcome_unknown',
  'legacy_settled_external_finalization_incomplete',
  'active_workflow_owned',
  'current_execution_failed_unsettled',
  'current_settlement_finalization_unresolved',
  'unreconciled',
] as const;

export type ReconciliationClassification = (typeof RECONCILIATION_CLASSIFICATIONS)[number];
export type ReconciliationActionability = 'actionable' | 'non_actionable';
export type ReconciliationOwnerKind = 'workflow' | 'owner_intent' | 'none';
export type ReconciliationSource = 'operator' | 'workflow' | 'owner_recovery';

export interface AppendReconciliationInput {
  readonly id: string;
  readonly paymentAttemptId: string;
  readonly classification: ReconciliationClassification;
  readonly actionability: ReconciliationActionability;
  readonly ownerKind: ReconciliationOwnerKind;
  readonly ownerReference?: string;
  readonly reasonCode: string;
  readonly evidenceRef: string;
  readonly source: ReconciliationSource;
  readonly supersedesReconciliationId?: string;
  readonly operatorCheckpoint?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly dedupeKey: string;
  readonly createdAt: string;
}

export interface ReconciliationRecord extends AppendReconciliationInput {
  readonly sequence: number;
}

export const EFFECTIVE_RECONCILIATION_QUERY = `
SELECT * FROM payment_attempt_reconciliations
WHERE payment_attempt_id = ?
ORDER BY sequence DESC
LIMIT 1`;

/**
 * Unknown and ownerless nonterminal attempts fail closed. Only an explicit,
 * latest, non-actionable legacy classification may remove a raw historical row
 * from the cutover-blocking count. Current settlement finalization remains
 * blocking even if a malformed/operator event attempts to call it inert.
 */
export const OWNERSHIP_AWARE_DRAIN_GATE_SQL = `
WITH latest_reconciliation AS (
  SELECT r.*
  FROM payment_attempt_reconciliations r
  JOIN (
    SELECT payment_attempt_id, MAX(sequence) AS sequence
    FROM payment_attempt_reconciliations
    GROUP BY payment_attempt_id
  ) latest ON latest.payment_attempt_id = r.payment_attempt_id
          AND latest.sequence = r.sequence
),
raw_nonterminal AS (
  SELECT p.id, p.lifecycle_stage, r.classification, r.actionability
  FROM payment_attempts p
  LEFT JOIN latest_reconciliation r ON r.payment_attempt_id = p.id
  WHERE p.lifecycle_stage NOT IN ('verification_failed', 'settled')
),
blocking_attempts AS (
  SELECT id FROM raw_nonterminal
  WHERE classification IS NULL
     OR actionability <> 'non_actionable'
     OR classification NOT IN (
       'legacy_execution_failed_unsettled',
       'legacy_verified_unrouted_unsettled',
       'legacy_execution_outcome_unknown',
       'legacy_settled_external_finalization_incomplete',
       'current_execution_failed_unsettled'
     )
),
blocking_intents AS (
  SELECT payment_attempt_id AS id
  FROM payment_workflow_owner_intents
  WHERE status IN ('pending', 'workflow_created', 'retry_exhausted')
)
SELECT
  (SELECT COUNT(*) FROM raw_nonterminal) AS raw_nonterminal_lifecycle_count,
  (SELECT COUNT(*) FROM (
    SELECT id FROM blocking_attempts
    UNION
    SELECT id FROM blocking_intents
  )) AS active_cutover_blocking_work_count,
  (SELECT COUNT(*) FROM payment_workflow_owner_intents WHERE status IN ('pending', 'retry_exhausted')) AS owner_intent_pending_count,
  (SELECT COUNT(*) FROM payment_workflow_owner_intents WHERE status = 'workflow_created') AS active_workflow_owned_attempts,
  (SELECT COUNT(*) FROM raw_nonterminal WHERE classification IS NULL OR classification = 'unreconciled') AS unreconciled_actionable_attempts,
  (SELECT COUNT(*) FROM raw_nonterminal WHERE classification = 'current_settlement_finalization_unresolved') AS unresolved_settlement_finalization_count`;

function mapRecord(row: Record<string, unknown>): ReconciliationRecord {
  return {
    sequence: Number(row.sequence),
    id: row.id as string,
    paymentAttemptId: row.payment_attempt_id as string,
    classification: row.classification as ReconciliationClassification,
    actionability: row.actionability as ReconciliationActionability,
    ownerKind: row.owner_kind as ReconciliationOwnerKind,
    ...(row.owner_reference ? { ownerReference: row.owner_reference as string } : {}),
    reasonCode: row.reason_code as string,
    evidenceRef: row.evidence_ref as string,
    source: row.source as ReconciliationSource,
    ...(row.supersedes_reconciliation_id
      ? { supersedesReconciliationId: row.supersedes_reconciliation_id as string }
      : {}),
    ...(row.operator_checkpoint ? { operatorCheckpoint: row.operator_checkpoint as string } : {}),
    metadata: JSON.parse((row.metadata_json as string) || '{}') as Record<string, unknown>,
    dedupeKey: row.dedupe_key as string,
    createdAt: row.created_at as string,
  };
}

export class D1LifecycleReconciliationRepository {
  constructor(private readonly db: D1Database) {}

  async append(input: AppendReconciliationInput): Promise<ReconciliationRecord> {
    const result = await this.db
      .prepare(
        `INSERT INTO payment_attempt_reconciliations (
      id, payment_attempt_id, classification, actionability, owner_kind,
      owner_reference, reason_code, evidence_ref, source,
      supersedes_reconciliation_id, operator_checkpoint, metadata_json,
      dedupe_key, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(dedupe_key) DO NOTHING`
      )
      .bind(
        input.id,
        input.paymentAttemptId,
        input.classification,
        input.actionability,
        input.ownerKind,
        input.ownerReference ?? null,
        input.reasonCode,
        input.evidenceRef,
        input.source,
        input.supersedesReconciliationId ?? null,
        input.operatorCheckpoint ?? null,
        JSON.stringify(input.metadata ?? {}),
        input.dedupeKey,
        input.createdAt
      )
      .run();
    const failure = getD1Failure(result);
    if (failure) throw new Error(failure);
    const row = await this.db
      .prepare(`SELECT * FROM payment_attempt_reconciliations WHERE dedupe_key = ?`)
      .bind(input.dedupeKey)
      .first<Record<string, unknown>>();
    if (!row) throw new Error('reconciliation insert could not be read back');
    return mapRecord(row);
  }

  async getEffectiveByAttemptId(paymentAttemptId: string): Promise<ReconciliationRecord | null> {
    const row = await this.db
      .prepare(EFFECTIVE_RECONCILIATION_QUERY)
      .bind(paymentAttemptId)
      .first<Record<string, unknown>>();
    return row ? mapRecord(row) : null;
  }

  async getDrainGateMetrics(): Promise<{
    rawNonterminalLifecycleCount: number;
    activeCutoverBlockingWorkCount: number;
    ownerIntentPendingCount: number;
    activeWorkflowOwnedAttempts: number;
    unreconciledActionableAttempts: number;
    unresolvedSettlementFinalizationCount: number;
  }> {
    const row = await this.db
      .prepare(OWNERSHIP_AWARE_DRAIN_GATE_SQL)
      .first<Record<string, unknown>>();
    if (!row) throw new Error('drain-gate query returned no row');
    return {
      rawNonterminalLifecycleCount: Number(row.raw_nonterminal_lifecycle_count),
      activeCutoverBlockingWorkCount: Number(row.active_cutover_blocking_work_count),
      ownerIntentPendingCount: Number(row.owner_intent_pending_count),
      activeWorkflowOwnedAttempts: Number(row.active_workflow_owned_attempts),
      unreconciledActionableAttempts: Number(row.unreconciled_actionable_attempts),
      unresolvedSettlementFinalizationCount: Number(row.unresolved_settlement_finalization_count),
    };
  }
}
