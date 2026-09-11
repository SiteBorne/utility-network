import type { D1Database } from '@cloudflare/workers-types';
import type { WorkflowContinuationInput } from '../../continuation/types';
import { getD1Failure } from './shared';

export type WorkflowOwnerIntentStatus =
  | 'pending'
  | 'workflow_created'
  | 'completed'
  | 'retry_exhausted';

export interface WorkflowOwnerIntent {
  readonly id: string;
  readonly paymentAttemptId: string;
  readonly paymentIdentifier: string;
  readonly workflowInstanceId: string;
  readonly workflowInput: WorkflowContinuationInput;
  readonly status: WorkflowOwnerIntentStatus;
  readonly dispatchAttemptCount: number;
  readonly nextAttemptAt: string | null;
  readonly lastErrorCode: string | null;
}

function mapRow(row: Record<string, unknown>): WorkflowOwnerIntent {
  return {
    id: row.id as string,
    paymentAttemptId: row.payment_attempt_id as string,
    paymentIdentifier: row.payment_identifier as string,
    workflowInstanceId: row.workflow_instance_id as string,
    workflowInput: JSON.parse(row.workflow_input_json as string) as WorkflowContinuationInput,
    status: row.status as WorkflowOwnerIntentStatus,
    dispatchAttemptCount: Number(row.dispatch_attempt_count),
    nextAttemptAt: (row.next_attempt_at as string | null) ?? null,
    lastErrorCode: (row.last_error_code as string | null) ?? null,
  };
}

export class D1WorkflowOwnerIntentRepository {
  constructor(private readonly db: D1Database) {}

  async commitVerifiedWithIntent(input: {
    readonly paymentIdentifier: string;
    readonly intentId: string;
    readonly workflowInstanceId: string;
    readonly workflowInput: WorkflowContinuationInput;
    readonly createdAt: string;
  }): Promise<{ status: 'committed' | 'already_committed' }> {
    const existing = await this.getByPaymentIdentifier(input.paymentIdentifier);
    if (existing) return { status: 'already_committed' };
    try {
      const results = await this.db.batch([
        this.db
          .prepare(
            `UPDATE payment_attempts SET lifecycle_stage = 'verified'
          WHERE payment_identifier = ? AND lifecycle_stage = 'acquired'`
          )
          .bind(input.paymentIdentifier),
        this.db
          .prepare(
            `INSERT INTO payment_workflow_owner_intents (
          id, payment_attempt_id, payment_identifier, workflow_instance_id,
          workflow_input_json, status, created_at, updated_at
        ) SELECT ?, id, payment_identifier, ?, ?, 'pending', ?, ?
          FROM payment_attempts WHERE payment_identifier = ? AND lifecycle_stage = 'verified'`
          )
          .bind(
            input.intentId,
            input.workflowInstanceId,
            JSON.stringify(input.workflowInput),
            input.createdAt,
            input.createdAt,
            input.paymentIdentifier
          ),
      ]);
      const failures = results
        .map(getD1Failure)
        .filter((failure): failure is string => Boolean(failure));
      if (failures.length > 0) throw new Error(failures.join('; '));
      const committed = await this.getByPaymentIdentifier(input.paymentIdentifier);
      if (!committed) throw new Error('verified transition committed without owner intent');
      return { status: 'committed' };
    } catch (error) {
      const raced = await this.getByPaymentIdentifier(input.paymentIdentifier);
      if (raced) return { status: 'already_committed' };
      throw error;
    }
  }

  async getByPaymentIdentifier(paymentIdentifier: string): Promise<WorkflowOwnerIntent | null> {
    const row = await this.db
      .prepare(`SELECT * FROM payment_workflow_owner_intents WHERE payment_identifier = ?`)
      .bind(paymentIdentifier)
      .first<Record<string, unknown>>();
    return row ? mapRow(row) : null;
  }

  async listRecoverable(now: string, limit = 25): Promise<readonly WorkflowOwnerIntent[]> {
    const result = await this.db
      .prepare(
        `SELECT * FROM payment_workflow_owner_intents
      WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
      ORDER BY created_at ASC LIMIT ?`
      )
      .bind(now, limit)
      .all<Record<string, unknown>>();
    if (!result.success) throw new Error(result.error ?? 'owner-intent scan failed');
    return result.results.map(mapRow);
  }

  async markAttemptFailed(
    id: string,
    now: string,
    errorCode: string,
    nextAttemptAt: string,
    maxAttempts: number
  ): Promise<void> {
    const result = await this.db
      .prepare(
        `UPDATE payment_workflow_owner_intents SET
      dispatch_attempt_count = dispatch_attempt_count + 1,
      status = CASE WHEN dispatch_attempt_count + 1 >= ? THEN 'retry_exhausted' ELSE 'pending' END,
      last_attempt_at = ?, next_attempt_at = ?, last_error_code = ?, updated_at = ?
      WHERE id = ? AND status = 'pending'`
      )
      .bind(maxAttempts, now, nextAttemptAt, errorCode, now, id)
      .run();
    const failure = getD1Failure(result);
    if (failure) throw new Error(failure);
  }

  async markWorkflowCreated(id: string, now: string): Promise<void> {
    const result = await this.db
      .prepare(
        `UPDATE payment_workflow_owner_intents SET
      status = 'workflow_created', dispatch_attempt_count = dispatch_attempt_count + 1,
      last_attempt_at = ?, next_attempt_at = NULL, last_error_code = NULL, updated_at = ?
      WHERE id = ? AND status = 'pending'`
      )
      .bind(now, now, id)
      .run();
    const failure = getD1Failure(result);
    if (failure) throw new Error(failure);
  }

  async markCompletedByPaymentIdentifier(paymentIdentifier: string, now: string): Promise<void> {
    const result = await this.db
      .prepare(
        `UPDATE payment_workflow_owner_intents SET
      status = 'completed', completed_at = COALESCE(completed_at, ?), updated_at = ?
      WHERE payment_identifier = ? AND status <> 'completed'`
      )
      .bind(now, now, paymentIdentifier)
      .run();
    const failure = getD1Failure(result);
    if (failure) throw new Error(failure);
  }
}
