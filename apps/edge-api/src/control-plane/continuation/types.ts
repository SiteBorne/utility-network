/**
 * SUN-1221E6R-H2AWI-1a -- durable paid-continuation domain types.
 *
 * Frozen interfaces per
 * docs/superpowers/plans/2026-08-31-siteborne-durable-paid-continuation-workflow.md
 * (Task 1.1) and
 * docs/reports/SUN-1221E6R-H2AW-durable-paid-continuation-workflow-design.md
 * (SS8-10). Pure structural types only -- no runtime logic, no branching,
 * no I/O. Every field here is either already-clear economic/job data (the
 * same fields already persisted in plaintext in D1 today, per design SS7)
 * or an opaque AEAD envelope wrapper -- never the signed payment material
 * itself, which only ever exists as ciphertext inside
 * `ContinuationEnvelopeV1.ciphertext_b64` (see `./envelope.ts`).
 */

export interface ContinuationEnvelopeMetadata {
  readonly job_id: string;
  readonly payment_identifier: string;
  readonly service: string; // e.g. "web_context_verified.v2"
  readonly network: string; // e.g. "eip155:8453"
  readonly asset: string; // ERC-20 contract address, lowercase
  readonly pay_to: string; // seller address, lowercase
  readonly amount_atomic: string; // decimal string, exact atomic units
  readonly valid_before_unix: number; // EIP-3009 validBefore, seconds
}

export interface ContinuationEnvelopeV1 {
  readonly v: 1;
  readonly key_id: string; // identifies which secret version sealed this
  readonly iv_b64: string; // 12-byte GCM IV, base64
  readonly ciphertext_b64: string; // AES-256-GCM ciphertext+tag, base64
  readonly aad_fingerprint: string; // sha256 hex of canonicalized AAD, for logging only (never the AAD itself)
}

export interface WorkflowContinuationInput {
  readonly envelope: ContinuationEnvelopeV1;
  readonly metadata: ContinuationEnvelopeMetadata; // clear-text copy of the AAD fields, needed to route without opening the envelope
  readonly request_id: string;
}

export type WorkflowTerminalStatus =
  | 'settled'
  | 'executor_rejected'
  | 'executor_timeout'
  | 'pcc_failed'
  | 'authorization_expired'
  | 'settlement_rejected'
  | 'settlement_ambiguous'
  | 'persistence_failed_after_settlement'
  | 'workflow_internal_error';

export interface WorkflowContinuationResult {
  readonly status: WorkflowTerminalStatus;
  readonly job_id: string;
  readonly receipt_id?: string;
  readonly settlement_transaction_reference?: string;
  readonly error_code?: string;
}

export interface SettlementReconciliationResult {
  readonly outcome: 'confirmed' | 'not_found' | 'inconclusive';
  readonly settlement_transaction_reference?: string;
  readonly checked_at_unix: number;
}
