import { z } from 'zod';

export const JobStateSchema = z.enum([
  'RECEIVED',
  'VALIDATED',
  'QUOTED',
  'PAYMENT_CHALLENGED',
  'PAYMENT_VERIFIED',
  'LOCKED',
  'ROUTED',
  'EXECUTING',
  'VERIFYING',
  'SETTLING',
  'DELIVERED',
  'REJECTED',
  'REQUOTE_REQUIRED',
  'RETRYABLE',
  'REFUND_REQUIRED',
  'QUARANTINED',
  'TOMBSTONED',
]);
export type JobState = z.infer<typeof JobStateSchema>;

export const ActorClassSchema = z.enum([
  'SYSTEM',
  'CLIENT',
  'PAYMENT_PROVIDER',
  'VERIFIER',
  'ADMIN',
]);
export type ActorClass = z.infer<typeof ActorClassSchema>;

export const TransitionReasonSchema = z.enum([
  'VALIDATION_PASSED',
  'VALIDATION_FAILED',
  'QUOTE_GENERATED',
  'PAYMENT_REQUIRED',
  'PAYMENT_VERIFIED',
  'PAYMENT_FAILED',
  'RESOURCE_LOCKED',
  'RESOURCE_LOCK_FAILED',
  'ROUTED_TO_WORKER',
  'EXECUTION_STARTED',
  'EXECUTION_COMPLETED',
  'EXECUTION_FAILED',
  'VERIFICATION_PASSED',
  'VERIFICATION_FAILED',
  'SETTLEMENT_COMPLETE',
  'CLIENT_REJECTED',
  'REQUOTE_REQUESTED',
  'RETRY_EXHAUSTED',
  'REFUND_INITIATED',
  'QUARANTINE_POLICY',
  'TOMBSTONE_POLICY',
  'IDEMPOTENCY_CONFLICT',
  'SCHEMA_MISMATCH',
  'QUOTA_EXCEEDED',
  'COST_GUARD_REJECTED',
  'PRODUCTION_DISABLED',
  'UNKNOWN_SERVICE',
]);
export type TransitionReason = z.infer<typeof TransitionReasonSchema>;

export const AllowedTransitions: Record<JobState, JobState[]> = {
  RECEIVED: ['VALIDATED', 'REJECTED'],
  VALIDATED: ['QUOTED', 'REJECTED', 'REQUOTE_REQUIRED'],
  QUOTED: ['PAYMENT_CHALLENGED', 'LOCKED', 'REJECTED', 'REQUOTE_REQUIRED'],
  PAYMENT_CHALLENGED: ['PAYMENT_VERIFIED', 'REJECTED', 'RETRYABLE'],
  PAYMENT_VERIFIED: ['LOCKED', 'REJECTED'],
  LOCKED: ['ROUTED', 'REJECTED', 'RETRYABLE'],
  ROUTED: ['EXECUTING', 'REJECTED', 'RETRYABLE'],
  EXECUTING: ['VERIFYING', 'RETRYABLE', 'QUARANTINED'],
  VERIFYING: ['SETTLING', 'RETRYABLE', 'QUARANTINED', 'REJECTED'],
  SETTLING: ['DELIVERED', 'REFUND_REQUIRED', 'RETRYABLE'],
  DELIVERED: [],
  REJECTED: ['TOMBSTONED'],
  REQUOTE_REQUIRED: ['QUOTED', 'REJECTED'],
  RETRYABLE: ['ROUTED', 'REJECTED', 'QUARANTINED'],
  REFUND_REQUIRED: ['REJECTED', 'TOMBSTONED'],
  QUARANTINED: ['REJECTED', 'TOMBSTONED'],
  TOMBSTONED: [],
};

export const TerminalStates: JobState[] = ['DELIVERED', 'TOMBSTONED'];

export const RetryableStates: JobState[] = [
  'LOCKED',
  'ROUTED',
  'EXECUTING',
  'VERIFYING',
  'SETTLING',
  'RETRYABLE',
];

export const QuarantineStates: JobState[] = ['QUARANTINED'];

export function isValidTransition(from: JobState, to: JobState): boolean {
  return AllowedTransitions[from]?.includes(to) ?? false;
}

export function isTerminalState(state: JobState): boolean {
  return TerminalStates.includes(state);
}

export function isRetryableState(state: JobState): boolean {
  return RetryableStates.includes(state);
}

export function canTransitionFrom(state: JobState): boolean {
  return !isTerminalState(state);
}

export const StateEventSchema = z.object({
  id: z.string().uuid(),
  job_id: z.string().uuid(),
  attempt_number: z.number().int().positive(),
  from_state: JobStateSchema,
  to_state: JobStateSchema,
  reason: TransitionReasonSchema,
  actor: ActorClassSchema,
  evidence_ref: z.string().optional(),
  previous_state_hash: z.string().optional(),
  timestamp: z.string().datetime({ offset: true }),
  attempt_hash: z.string().optional(),
});
export type StateEvent = z.infer<typeof StateEventSchema>;

export const JobSchema = z.object({
  id: z.string().uuid(),
  request_id: z.string().uuid(),
  service_id: z.string(),
  service_version: z.string(),
  input_hash: z.string(),
  input_schema_hash: z.string(),
  output_schema_hash: z.string(),
  idempotency_key: z.string(),
  contract_release: z.string(),
  pcc_dependency: z.string(),
  current_state: JobStateSchema,
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
  expires_at: z.string().datetime({ offset: true }),
  attempt_count: z.number().int().nonnegative(),
  max_authorized_cost: z.string().optional(),
  production_enabled: z.boolean(),
});
export type Job = z.infer<typeof JobSchema>;

export const JobAttemptSchema = z.object({
  id: z.string().uuid(),
  job_id: z.string().uuid(),
  attempt_number: z.number().int().positive(),
  state: JobStateSchema,
  input_artifact_ref: z.string().optional(),
  output_artifact_ref: z.string().optional(),
  error_code: z.string().optional(),
  error_message: z.string().optional(),
  dispatched_at: z.string().datetime({ offset: true }).optional(),
  started_at: z.string().datetime({ offset: true }).optional(),
  completed_at: z.string().datetime({ offset: true }).optional(),
  worker_id: z.string().optional(),
  trace_context: z.string().optional(),
  created_at: z.string().datetime({ offset: true }).optional(),
  updated_at: z.string().datetime({ offset: true }).optional(),
});
export type JobAttempt = z.infer<typeof JobAttemptSchema>;

export const IdempotencyRecordSchema = z.object({
  id: z.string().uuid(),
  idempotency_key: z.string(),
  service_id: z.string(),
  service_version: z.string(),
  input_hash: z.string(),
  input_schema_hash: z.string(),
  requester_identity_class: z.string().optional(),
  quote_id: z.string().optional(),
  created_at: z.string().datetime({ offset: true }),
  expires_at: z.string().datetime({ offset: true }),
  original_job_id: z.string().uuid(),
  original_result_ref: z.string().optional(),
});
export type IdempotencyRecord = z.infer<typeof IdempotencyRecordSchema>;

export const ArtifactRecordSchema = z.object({
  id: z.string().uuid(),
  content_hash: z.string(),
  media_type: z.string(),
  byte_length: z.number().int().positive(),
  created_at: z.string().datetime({ offset: true }),
  expires_at: z.string().datetime({ offset: true }).optional(),
  authorization_class: z.enum(['public', 'buyer_authorized', 'private']),
  retention_class: z.enum(['ephemeral', 'standard', 'archival']),
  job_id: z.string().uuid().optional(),
  artifact_type: z.enum(['input', 'output', 'intermediate', 'receipt', 'audit']),
});
export type ArtifactRecord = z.infer<typeof ArtifactRecordSchema>;

export const QueueDispatchSchema = z.object({
  id: z.string().uuid(),
  job_id: z.string().uuid(),
  attempt_number: z.number().int().positive(),
  service_id: z.string(),
  service_version: z.string(),
  input_artifact_ref: z.string(),
  contract_hash: z.string(),
  trace_context: z.string(),
  dispatched_at: z.string().datetime({ offset: true }),
  expires_at: z.string().datetime({ offset: true }),
  retry_count: z.number().int().nonnegative(),
});
export type QueueDispatch = z.infer<typeof QueueDispatchSchema>;

export const QuotaReservationSchema = z.object({
  id: z.string().uuid(),
  job_id: z.string().uuid(),
  resource_class: z.string(),
  requested_units: z.number().int().positive(),
  remaining_units: z.number().int().nonnegative(),
  reserved_units: z.number().int().nonnegative(),
  replacement_cost: z.string(),
  scarcity_multiplier: z.string(),
  failure_risk_multiplier: z.string(),
  max_authorized_cost: z.string(),
  paid_overflow_enabled: z.boolean(),
  reserved_at: z.string().datetime({ offset: true }),
  expires_at: z.string().datetime({ offset: true }),
  released_at: z.string().datetime({ offset: true }).optional(),
});
export type QuotaReservation = z.infer<typeof QuotaReservationSchema>;

export const AuditEventSchema = z.object({
  id: z.string().uuid(),
  event_type: z.string(),
  job_id: z.string().uuid().optional(),
  attempt_number: z.number().int().positive().optional(),
  service_id: z.string().optional(),
  actor: ActorClassSchema,
  details: z.record(z.unknown()),
  timestamp: z.string().datetime({ offset: true }),
  correlation_id: z.string().optional(),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

export const SecurityEventSchema = z.object({
  id: z.string().uuid(),
  event_type: z.string(),
  job_id: z.string().uuid().optional(),
  attempt_number: z.number().int().positive().optional(),
  service_id: z.string().optional(),
  details: z.record(z.unknown()),
  timestamp: z.string().datetime({ offset: true }),
  correlation_id: z.string().optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
});
export type SecurityEvent = z.infer<typeof SecurityEventSchema>;

export const QuotaReservationRecordSchema = z.object({
  id: z.string().uuid(),
  job_id: z.string().uuid(),
  resource_class: z.string(),
  requested_units: z.number().int().positive(),
  remaining_units: z.number().int().nonnegative(),
  reserved_units: z.number().int().nonnegative(),
  replacement_cost: z.string(),
  scarcity_multiplier: z.string(),
  failure_risk_multiplier: z.string(),
  max_authorized_cost: z.string(),
  paid_overflow_enabled: z.boolean(),
  reserved_at: z.string().datetime({ offset: true }),
  expires_at: z.string().datetime({ offset: true }),
  released_at: z.string().datetime({ offset: true }).optional(),
});
export type QuotaReservationRecord = z.infer<typeof QuotaReservationRecordSchema>;

export const ServiceMetadataSchema = z.object({
  service_id: z.string(),
  version: z.string(),
  title: z.string(),
  description: z.string(),
  input_schema: z.string(),
  output_schema: z.string(),
  price_usd: z.string(),
  production_enabled: z.boolean(),
  production_ready: z.boolean(),
  protocol_status: z.enum(['preproduction', 'production']),
});
export type ServiceMetadata = z.infer<typeof ServiceMetadataSchema>;

export const ServiceVersionSchema = z.object({
  id: z.string().uuid(),
  service_id: z.string(),
  version: z.string(),
  input_schema_hash: z.string(),
  output_schema_hash: z.string(),
  contract_release: z.string(),
  pcc_dependency: z.string(),
  created_at: z.string().datetime({ offset: true }),
  deprecated_at: z.string().datetime({ offset: true }).optional(),
});
export type ServiceVersion = z.infer<typeof ServiceVersionSchema>;
