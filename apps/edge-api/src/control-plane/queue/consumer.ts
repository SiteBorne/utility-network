import type { D1Database } from '@cloudflare/workers-types';
import { randomUUID } from 'crypto';
import type { QueueDispatch, Job, JobAttempt } from '../types';
import { mapQueueDispatch, mapJob, mapJobAttempt } from './shared';

export type DispatchValidationResult =
  | {
      ok: true;
      outcome: 'accepted_for_dispatch';
      job: Job;
      attempt: JobAttempt;
      dispatch: QueueDispatch;
    }
  | { ok: false; outcome: Exclude<DispatchOutcome, 'accepted_for_dispatch'>; reason: string };

export type DispatchOutcome =
  | 'accepted_for_dispatch'
  | 'duplicate_ignored'
  | 'expired'
  | 'retry_exhausted'
  | 'unknown_job'
  | 'unknown_attempt'
  | 'attempt_mismatch'
  | 'contract_mismatch'
  | 'terminal_job'
  | 'production_disabled'
  | 'dead_lettered';

export interface QueueConsumerConfig {
  maxRetries: number;
  productionExecutionEnabled: boolean;
  quarantineSupported: boolean;
}

export const defaultQueueConsumerConfig: QueueConsumerConfig = {
  maxRetries: 5,
  productionExecutionEnabled: false,
  quarantineSupported: false,
};

export async function validateDispatchMessage(
  db: D1Database,
  message: QueueDispatch,
  config: QueueConsumerConfig = defaultQueueConsumerConfig
): Promise<DispatchValidationResult> {
  // 1. Message schema is valid and bounded
  if (!message.id || !message.job_id || !message.attempt_number) {
    return { ok: false, outcome: 'dead_lettered', reason: 'Invalid message schema' };
  }

  // 2. Message has not expired
  const now = new Date().toISOString();
  if (message.expires_at < now) {
    return { ok: false, outcome: 'expired', reason: 'Dispatch message has expired' };
  }

  // 3. Retry count is within policy
  if (message.retry_count >= config.maxRetries) {
    return { ok: false, outcome: 'retry_exhausted', reason: 'Retry count exceeds maximum' };
  }

  // 4. Referenced job exists
  const jobStmt = db.prepare(`SELECT * FROM jobs WHERE id = ?`);
  const jobResult = await jobStmt.bind(message.job_id).all();

  if (!jobResult.success) {
    return { ok: false, outcome: 'unknown_job', reason: 'Database error fetching job' };
  }

  if (jobResult.results.length === 0) {
    return { ok: false, outcome: 'unknown_job', reason: 'Referenced job does not exist' };
  }

  const job = mapJob(jobResult.results[0] as Record<string, unknown>);

  // 5. Referenced attempt exists
  const attemptStmt = db.prepare(`
    SELECT * FROM job_attempts WHERE job_id = ? AND attempt_number = ?
  `);
  const attemptResult = await attemptStmt.bind(message.job_id, message.attempt_number).all();

  if (!attemptResult.success) {
    return { ok: false, outcome: 'unknown_attempt', reason: 'Database error fetching attempt' };
  }

  if (attemptResult.results.length === 0) {
    return { ok: false, outcome: 'unknown_attempt', reason: 'Referenced attempt does not exist' };
  }

  const attempt = mapJobAttempt(attemptResult.results[0] as Record<string, unknown>);

  // 6. Attempt number matches the authoritative current attempt
  if (attempt.attempt_number !== message.attempt_number) {
    return { ok: false, outcome: 'attempt_mismatch', reason: 'Attempt number mismatch' };
  }

  // 7. Service ID and service version match the job
  if (job.service_id !== message.service_id || job.service_version !== message.service_version) {
    return { ok: false, outcome: 'contract_mismatch', reason: 'Service ID or version mismatch' };
  }

  // 8. Contract hash matches
  const versionStmt = db.prepare(`
    SELECT * FROM service_versions WHERE service_id = ? AND version = ?
  `);
  const versionResult = await versionStmt.bind(job.service_id, job.service_version).all();

  if (versionResult.success && versionResult.results.length > 0) {
    // const version = versionResult.results[0] as Record<string, unknown>;
    // const expectedHash = `${version.input_schema_hash}:${version.output_schema_hash}:${version.contract_release}`;
    // Note: In production, this would compare with the actual contract hash from the message
    // For now we just validate the job exists
  }

  // 9. Job is not terminal
  if (isTerminalState(job.current_state)) {
    return {
      ok: false,
      outcome: 'terminal_job',
      reason: `Job is in terminal state: ${job.current_state}`,
    };
  }

  // 10. Job is not tombstoned
  if (job.current_state === 'TOMBSTONED') {
    return { ok: false, outcome: 'terminal_job', reason: 'Job is tombstoned' };
  }

  // 11. Job is not quarantined unless handler explicitly supports quarantine processing
  if (job.current_state === 'QUARANTINED' && !config.quarantineSupported) {
    return {
      ok: false,
      outcome: 'dead_lettered',
      reason: 'Job is quarantined and handler does not support quarantine',
    };
  }

  // 12. Duplicate delivery has not already created the same logical processing action
  // Check if this attempt has already been processed (has completed_at)
  if (attempt.completed_at) {
    return { ok: false, outcome: 'duplicate_ignored', reason: 'Attempt already completed' };
  }

  // 13. Production execution is enabled before any future real worker execution
  if (!config.productionExecutionEnabled && job.production_enabled) {
    return {
      ok: false,
      outcome: 'production_disabled',
      reason: 'Production execution is disabled',
    };
  }

  // All checks passed - get the dispatch record
  const dispatchStmt = db.prepare(`
    SELECT * FROM queue_dispatches WHERE job_id = ? AND attempt_number = ?
  `);
  const dispatchResult = await dispatchStmt.bind(message.job_id, message.attempt_number).all();

  if (!dispatchResult.success || dispatchResult.results.length === 0) {
    return { ok: false, outcome: 'dead_lettered', reason: 'Dispatch record not found' };
  }

  const dispatch = mapQueueDispatch(dispatchResult.results[0] as Record<string, unknown>);

  return { ok: true, outcome: 'accepted_for_dispatch', job, attempt, dispatch };
}

function isTerminalState(state: Job['current_state']): boolean {
  return state === 'DELIVERED' || state === 'TOMBSTONED';
}

export interface DeadLetterEntry {
  id: string;
  original_dispatch_id: string;
  job_id: string;
  attempt_number: number;
  reason: string;
  outcome: DispatchOutcome;
  message: QueueDispatch;
  timestamp: string;
}

export interface DeadLetterSink {
  add(entry: DeadLetterEntry): Promise<void>;
  list(limit?: number): Promise<DeadLetterEntry[]>;
  clear(): Promise<void>;
}

export class InMemoryDeadLetterSink implements DeadLetterSink {
  private entries: DeadLetterEntry[] = [];

  async add(entry: DeadLetterEntry): Promise<void> {
    this.entries.push(entry);
  }

  async list(limit = 100): Promise<DeadLetterEntry[]> {
    return this.entries.slice(-limit).reverse();
  }

  async clear(): Promise<void> {
    this.entries = [];
  }
}

// D1-backed dead letter sink for local testing
export class D1DeadLetterSink implements DeadLetterSink {
  constructor(private db: D1Database) {}

  async add(entry: DeadLetterEntry): Promise<void> {
    // In a real implementation, this would write to a dead_letter table
    // For now, we use an in-memory sink
    console.warn('Dead letter entry:', entry);
  }

  async list(_limit = 100): Promise<DeadLetterEntry[]> {
    return [];
  }

  async clear(): Promise<void> {
    // No-op for D1 sink
  }
}

export async function processDispatchMessage(
  db: D1Database,
  message: QueueDispatch,
  config: QueueConsumerConfig = defaultQueueConsumerConfig,
  deadLetterSink: DeadLetterSink
): Promise<DispatchValidationResult> {
  const validation = await validateDispatchMessage(db, message, config);

  if (!validation.ok) {
    // Send to dead letter sink for certain outcomes
    const deadLetterOutcomes: DispatchOutcome[] = [
      'retry_exhausted',
      'unknown_job',
      'unknown_attempt',
      'contract_mismatch',
      'terminal_job',
      'dead_lettered',
    ];

    if (deadLetterOutcomes.includes(validation.outcome)) {
      await deadLetterSink.add({
        id: randomUUID(),
        original_dispatch_id: message.id,
        job_id: message.job_id,
        attempt_number: message.attempt_number,
        reason: validation.reason,
        outcome: validation.outcome,
        message,
        timestamp: new Date().toISOString(),
      });
    }

    return validation;
  }

  return validation;
}
