import type { D1Database } from '@cloudflare/workers-types';
import { hashPaymentObject, type PaymentServiceLink } from '@siteborne/protocol-x402';
import { D1LifecycleReconciliationRepository } from './lifecycle-reconciliation';
import { D1WorkflowOwnerIntentRepository } from './workflow-owner-intents';
import { D1PaymentAttemptRepository } from './payment-attempts';

export interface PersistLinkEvidenceInput {
  readonly paymentIdentifier: string;
  readonly jobId: string;
  readonly paymentServiceLink: PaymentServiceLink;
  readonly settlementTransactionReference: string;
  readonly settlementEvidenceHash: string;
  readonly pcc: unknown;
  readonly buyerReceiptId: string;
  readonly createdAt: string;
}

export class D1PaymentFinalizationRepository {
  private readonly reconciliation: D1LifecycleReconciliationRepository;
  private readonly ownerIntents: D1WorkflowOwnerIntentRepository;
  private readonly paymentAttempts: D1PaymentAttemptRepository;

  constructor(private readonly db: D1Database) {
    this.reconciliation = new D1LifecycleReconciliationRepository(db);
    this.ownerIntents = new D1WorkflowOwnerIntentRepository(db);
    this.paymentAttempts = new D1PaymentAttemptRepository(db);
  }

  private async attemptId(paymentIdentifier: string): Promise<string> {
    const row = await this.db
      .prepare(`SELECT id FROM payment_attempts WHERE payment_identifier = ?`)
      .bind(paymentIdentifier)
      .first<{ id: string }>();
    if (!row) throw new Error('payment attempt not found');
    return row.id;
  }

  async recordProviderFailure(input: {
    readonly paymentIdentifier: string;
    readonly jobId: string;
    readonly reasonCode: string;
    readonly createdAt: string;
  }): Promise<void> {
    const paymentAttemptId = await this.attemptId(input.paymentIdentifier);
    await this.reconciliation.append({
      id: crypto.randomUUID(),
      paymentAttemptId,
      classification: 'current_execution_failed_unsettled',
      actionability: 'non_actionable',
      ownerKind: 'none',
      reasonCode: input.reasonCode,
      evidenceRef: `d1:jobs/${input.jobId}`,
      source: 'workflow',
      dedupeKey: `${paymentAttemptId}:provider-terminal-failure`,
      createdAt: input.createdAt,
      metadata: { job_id: input.jobId, settlement_occurred: false },
    });
    await this.ownerIntents.markCompletedByPaymentIdentifier(
      input.paymentIdentifier,
      input.createdAt
    );
  }

  async recordSettlementFinalizationUnresolved(input: {
    readonly paymentIdentifier: string;
    readonly jobId: string;
    readonly reasonCode: string;
    readonly createdAt: string;
  }): Promise<void> {
    const paymentAttemptId = await this.attemptId(input.paymentIdentifier);
    await this.reconciliation.append({
      id: crypto.randomUUID(),
      paymentAttemptId,
      classification: 'current_settlement_finalization_unresolved',
      actionability: 'actionable',
      ownerKind: 'workflow',
      reasonCode: input.reasonCode,
      ownerReference: `d1:payment_workflow_owner_intents/${input.paymentIdentifier}`,
      evidenceRef: `d1:jobs/${input.jobId}`,
      source: 'workflow',
      dedupeKey: `${paymentAttemptId}:settlement-finalization-unresolved:${input.reasonCode}`,
      createdAt: input.createdAt,
    });
  }

  async persistLinkEvidence(input: PersistLinkEvidenceInput): Promise<void> {
    const paymentAttemptId = await this.attemptId(input.paymentIdentifier);
    const pcc = input.pcc as { signing_key_id?: unknown; signature?: unknown } | null;
    if (!pcc || typeof pcc.signing_key_id !== 'string' || typeof pcc.signature !== 'string') {
      throw new Error('settled requires durable signed PCC receipt evidence');
    }
    const buyerReceiptHash = await hashPaymentObject(input.pcc);
    const link = input.paymentServiceLink;
    const result = await this.db
      .prepare(
        `INSERT INTO payment_service_link_evidence (
      payment_attempt_id, payment_identifier, job_id, link_id, link_hash,
      payment_service_link_json, settlement_transaction_reference,
      settlement_evidence_hash, service_output_hash, verification_receipt_id,
      verification_receipt_hash, verification_evidence_hash, buyer_receipt_id,
      buyer_receipt_hash, signing_key_id, verified_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(payment_attempt_id) DO NOTHING`
      )
      .bind(
        paymentAttemptId,
        input.paymentIdentifier,
        input.jobId,
        link.link_id,
        link.link_hash,
        JSON.stringify(link),
        input.settlementTransactionReference,
        input.settlementEvidenceHash,
        link.service_output_hash,
        link.verification_receipt_id,
        link.verification_receipt_hash,
        link.verification_evidence_hash,
        input.buyerReceiptId,
        buyerReceiptHash,
        pcc.signing_key_id,
        input.createdAt
      )
      .run();
    if (!result.success) throw new Error(result.error ?? 'link-evidence persistence failed');
    const existing = await this.db
      .prepare(
        `SELECT link_hash, settlement_transaction_reference,
      buyer_receipt_hash FROM payment_service_link_evidence WHERE payment_attempt_id = ?`
      )
      .bind(paymentAttemptId)
      .first<{
        link_hash: string;
        settlement_transaction_reference: string;
        buyer_receipt_hash: string;
      }>();
    if (
      !existing ||
      existing.link_hash !== link.link_hash ||
      existing.settlement_transaction_reference !== input.settlementTransactionReference ||
      existing.buyer_receipt_hash !== buyerReceiptHash
    ) {
      throw new Error('conflicting durable link/receipt evidence');
    }
  }

  async finalizeSettled(paymentIdentifier: string, now: string): Promise<void> {
    const paymentAttemptId = await this.attemptId(paymentIdentifier);
    const evidence = await this.db
      .prepare(
        `SELECT payment_attempt_id FROM payment_service_link_evidence
      WHERE payment_attempt_id = ?`
      )
      .bind(paymentAttemptId)
      .first();
    if (!evidence) throw new Error('settled requires durable link evidence');
    const stage = await this.paymentAttempts.getLifecycleStage(paymentIdentifier);
    if (stage === 'settled_external') {
      const linked = await this.paymentAttempts.transitionLifecycleStage(
        paymentIdentifier,
        'settled_external',
        'link_verified'
      );
      if (linked.status === 'error') throw new Error(linked.reason);
    }
    const afterLink = await this.paymentAttempts.getLifecycleStage(paymentIdentifier);
    if (afterLink === 'link_verified') {
      const settled = await this.paymentAttempts.transitionLifecycleStage(
        paymentIdentifier,
        'link_verified',
        'settled'
      );
      if (settled.status === 'error') throw new Error(settled.reason);
    }
    if ((await this.paymentAttempts.getLifecycleStage(paymentIdentifier)) !== 'settled') {
      throw new Error('payment lifecycle did not reach settled');
    }
    await this.db
      .prepare(
        `UPDATE payment_service_link_evidence SET settled_at = COALESCE(settled_at, ?)
      WHERE payment_attempt_id = ?`
      )
      .bind(now, paymentAttemptId)
      .run();
    await this.ownerIntents.markCompletedByPaymentIdentifier(paymentIdentifier, now);
  }
}
