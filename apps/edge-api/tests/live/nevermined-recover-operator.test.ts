/**
 * SUN-0900B checkpoint 1B — narrow operator recovery entry point.
 *
 * Resumes and finalizes an ALREADY-PAID Nevermined fixed-PAYG payment from
 * the persistent live D1 store, by Payment-Identifier, using ONLY:
 *   - existing durable local artifacts (never regenerated, never guessed)
 *   - seller-side (`NVM_API_KEY`) GET-only external reconciliation
 *
 * This file cannot create a delegation, mint a token, call
 * `verifyPermissions`, execute a service, or call `settlePermissions` —
 * none of those operations are implemented here at all; the capability
 * surface is deliberately narrow.
 *
 * Gated so it is a no-op (zero network calls) in every normal
 * `pnpm test`/`pnpm check`/CI run:
 *
 *   describe.skipIf(!process.env.NEVERMINED_RECOVER_PAYMENT_ID)
 *
 * Deliberately its OWN gate, never `RUN_LIVE_NEVERMINED` — recovery is a
 * read-only-external, local-write-only operation, categorically different
 * from the live payment-flow test suite that flag gates, and the
 * authorizing directive explicitly forbids requiring it here.
 *
 * Run via `pnpm nevermined:recover -- --payment-id <id>` (see
 * scripts/nevermined-recover.ts, a thin zero-workspace-import CLI wrapper
 * that sets NEVERMINED_RECOVER_PAYMENT_ID and shells out to
 * `vitest run` scoped to this exact file — chosen because it reuses this
 * project's already-proven vitest module-resolution aliases
 * (vitest.config.ts) for the deep `@siteborne/*` workspace import graph,
 * rather than fighting tsx's tsconfig-paths resolution from a bare
 * root-level script).
 *
 * Requires:
 *   NEVERMINED_RECOVER_PAYMENT_ID=<Payment-Identifier> (run signal)
 *   NVM_API_KEY (seller credential — GET-only; NVM_SUBSCRIBER_API_KEY is
 *     never read by this file)
 *   SITEBORNE_LIVE_D1_DIR optional override, else the same default
 *     persistent path the live harness uses.
 *
 * `controlled_sandbox_self_test`: independent_customer=false, revenue=false,
 * open_market_purchase=false, production_ready=false, production_enabled=false.
 */
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import {
  NEVERMINED_PAYMENT_PROVIDER,
  reconcileNeverminedSettlementForRecovery,
  type NeverminedDelegationLookupClient,
  type NeverminedDelegationRecoveryRecord,
  type NeverminedSettlementTransaction,
} from '@siteborne/protocol-nevermined';
import {
  buildPaymentServiceLink,
  extendWithSettlement,
  hashPaymentObject,
} from '@siteborne/protocol-x402';
import { D1PaymentAttemptRepository } from '../../src/control-plane/repositories/d1/payment-attempts';
import {
  D1JobsRepository,
  D1StateEventsRepository,
} from '../../src/control-plane/repositories/d1/jobs';
import { X402ServiceResultRepository } from '../../src/control-plane/repositories/d1/x402-quotes';
import { resolveLivePersistencePath } from '../../src/control-plane/live-persistence-path';
import { createStateEvent } from '../../src/control-plane/state-machine';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const SANDBOX_BACKEND = 'https://api.sandbox.nevermined.app/';

const PAYMENT_ID = process.env.NEVERMINED_RECOVER_PAYMENT_ID;

interface PendingNeverminedSettlementDraft {
  kind: 'nevermined_settlement_pending_draft';
  quote_id: string;
  requirement_id: string;
  request_input_hash: string;
  output: unknown;
  output_hash: string;
  receipt_id: string;
  receipt_hash: string;
  verification_evidence: { payer?: string };
  verification_evidence_hash: string;
  actual_amount: string;
  usage_result_hash?: string;
  scheme: 'exact' | 'upto';
  authorized_maximum: string;
}

/**
 * Seller-side (`NVM_API_KEY`), GET-only reconciliation client. Deliberately
 * NOT `NeverminedSandboxReconciliationClient` (which gates construction
 * behind `RUN_LIVE_NEVERMINED==='1'`, correct for the live payment-flow
 * test suite it exists for, but wrong here). Implements exactly
 * `NeverminedDelegationLookupClient` — two GET operations, no mutating
 * method exists on this object at all.
 */
function sellerReconciliationClient(apiKey: string): NeverminedDelegationLookupClient {
  async function get(path: string): Promise<unknown> {
    const url = new URL(path, SANDBOX_BACKEND);
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'Nevermined-Version': '1.1',
      },
    });
    if (!res.ok) throw new Error(`nevermined_recovery_http_${res.status}`);
    return res.json();
  }
  return {
    async listDelegationTransactions(delegationId: string) {
      const body = (await get(
        `/api/v1/delegation/${encodeURIComponent(delegationId)}/transactions`
      )) as {
        transactions?: NeverminedSettlementTransaction[];
      };
      if (!Array.isArray(body.transactions))
        throw new Error('nevermined_recovery_malformed_transactions_response');
      return { transactions: body.transactions };
    },
    async getDelegation(delegationId: string) {
      let body: unknown;
      try {
        body = await get(`/api/v1/delegation/${encodeURIComponent(delegationId)}`);
      } catch (e) {
        if (e instanceof Error && /nevermined_recovery_http_(404|403)/.test(e.message)) return null;
        throw e;
      }
      return body as NeverminedDelegationRecoveryRecord;
    },
  };
}

describe.skipIf(!PAYMENT_ID)(
  'SUN-0900B checkpoint 1B — Nevermined recovery-only operator path',
  () => {
    let mf: Miniflare;
    let db: D1Database;

    beforeAll(async () => {
      const persistPath = resolveLivePersistencePath({ repositoryRoot: REPO_ROOT });
      // eslint-disable-next-line no-console
      console.log('Persistent D1 path (sanitized):', persistPath);
      mf = new Miniflare({
        modules: true,
        script: `export default { async fetch() { return new Response('OK'); } }`,
        d1Databases: ['DB'],
        resourcePersistencePath: persistPath,
      });
      db = await mf.getD1Database('DB');
    });

    afterAll(async () => {
      await mf.dispose();
    });

    it('recovers exactly one durable settlement_pending Nevermined payment to consumed, via seller-side GET reconciliation only', async () => {
      const paymentId = PAYMENT_ID!;
      const apiKey = process.env.NVM_API_KEY;
      if (!apiKey)
        throw new Error(
          'NVM_API_KEY must be set (seller credential — subscriber key is never used for recovery)'
        );

      const paymentAttempts = new D1PaymentAttemptRepository(db);
      const jobsRepo = new D1JobsRepository(db);
      const results = new X402ServiceResultRepository(db);

      // ---------------------------------------------------------------
      // STEP 2: inspect the durable payment BEFORE modifying anything.
      // ---------------------------------------------------------------
      const recovery = await paymentAttempts.getSettlementRecoveryRecord(paymentId);
      const attemptRow = await paymentAttempts.getByIdentifier(paymentId);
      expect(recovery, `no durable payment_attempts row for ${paymentId}`).toBeTruthy();
      expect(attemptRow, `no durable payment_attempts row for ${paymentId}`).toBeTruthy();
      if (!recovery || !attemptRow) return;

      // eslint-disable-next-line no-console
      console.log('Durable payment state (sanitized):', {
        payment_identifier: paymentId,
        lifecycle_stage: recovery.lifecycleStage,
        consumed: attemptRow.consumed,
        delegation_id: recovery.neverminedDelegationId,
        settlement_pending_at: recovery.settlementPendingAt,
        agent_id: attemptRow.binding.nevermined_agent_id,
        plan_id: attemptRow.binding.nevermined_plan_id,
        gross_amount: attemptRow.binding.amount,
        network: attemptRow.binding.network,
        asset: attemptRow.binding.asset,
        payee: attemptRow.binding.payee,
        rail: attemptRow.binding.payment_rail,
      });

      // ---------------------------------------------------------------
      // STEP 5: recovery eligibility — fail closed unless every condition
      // holds. `settlement_failed` is deliberately NOT accepted here
      // (narrower than the route's own eligibility, per this turn's
      // explicit "do not broaden historical settlement_failed recovery
      // unnecessarily" instruction) — only `settlement_pending`.
      // ---------------------------------------------------------------
      expect(attemptRow.binding.payment_rail).toBe('nevermined');

      if (attemptRow.consumed) {
        // eslint-disable-next-line no-console
        console.log(
          'ALREADY_CONSUMED: this payment was already recovered/consumed. No further action taken.'
        );
        // eslint-disable-next-line no-console
        console.log('verify+=0 execute+=0 settle+=0 jobs+=0 (idempotent no-op)');
        return;
      }

      expect(recovery.lifecycleStage).toBe('settlement_pending');
      expect(recovery.neverminedDelegationId).toBeTruthy();
      expect(attemptRow.binding.nevermined_agent_id).toBeTruthy();
      expect(attemptRow.binding.nevermined_plan_id).toBeTruthy();

      const jobResult = await jobsRepo.getByIdempotencyKey(paymentId);
      expect(jobResult.ok && jobResult.value, 'ineligible: no durable job record').toBeTruthy();
      if (!jobResult.ok || !jobResult.value) return;
      const job = jobResult.value;

      // ---------------------------------------------------------------
      // STEP 3: load, never regenerate, existing durable artifacts.
      // ---------------------------------------------------------------
      const draft = await results.getByJobId<PendingNeverminedSettlementDraft>(job.id);
      expect(draft?.kind).toBe('nevermined_settlement_pending_draft');
      if (!draft || draft.kind !== 'nevermined_settlement_pending_draft') return;
      expect(draft.output_hash).toBeTruthy();
      expect(draft.receipt_id).toBeTruthy();
      expect(draft.receipt_hash).toBeTruthy();
      expect(draft.verification_evidence_hash).toBeTruthy();
      // eslint-disable-next-line no-console
      console.log(
        'Durable artifacts loaded (sanitized): job=' + job.id,
        'receipt_id=' + draft.receipt_id,
        'output_hash=' + draft.output_hash
      );
      // eslint-disable-next-line no-console
      console.log(
        'Note: the raw signed receipt object is intentionally not part of the durable recovery draft (by design, ' +
          'since SUN-0900B checkpoint 3) — this validates receipt id/hash presence and consistency, not a full ' +
          'cryptographic re-verification of the original receipt signature.'
      );

      // ---------------------------------------------------------------
      // STEP 6-8: seller-side GET-only reconciliation + classification.
      // ---------------------------------------------------------------
      const client = sellerReconciliationClient(apiKey);
      const reconciliation = await reconcileNeverminedSettlementForRecovery(
        client,
        recovery.neverminedDelegationId!,
        {
          planId: attemptRow.binding.nevermined_plan_id!,
          provider: 'erc4337',
          currency: 'usdc',
          payer: draft.verification_evidence.payer,
        }
      );
      // eslint-disable-next-line no-console
      console.log('External reconciliation classification:', reconciliation.state);
      if (reconciliation.state !== 'SETTLED') {
        // eslint-disable-next-line no-console
        console.log(
          'STOP:',
          reconciliation.state === 'AMBIGUOUS'
            ? (reconciliation as { reason: string }).reason
            : 'not settled'
        );
        expect(
          reconciliation.state,
          'reconciliation did not classify SETTLED — stopping, no local mutation'
        ).toBe('SETTLED');
        return;
      }
      // eslint-disable-next-line no-console
      console.log('Settled transaction (sanitized):', {
        status: reconciliation.transaction.status,
        providerTransactionId: reconciliation.transaction.providerTransactionId,
        amountCents: reconciliation.transaction.amountCents,
        createdAt: reconciliation.transaction.createdAt,
      });

      // ---------------------------------------------------------------
      // STEP 9: settlement_pending -> settled_external.
      // ---------------------------------------------------------------
      const transactionReference = reconciliation.transaction.providerTransactionId ?? undefined;
      const recorded = await paymentAttempts.recordSettledExternal(
        paymentId,
        transactionReference,
        ['settlement_pending']
      );
      expect(recorded.status).toBe('transitioned');
      // eslint-disable-next-line no-console
      console.log('Transitioned: settlement_pending -> settled_external');

      // ---------------------------------------------------------------
      // STEP 10: PaymentServiceLink from ORIGINAL durable artifacts only.
      // ---------------------------------------------------------------
      let link = await buildPaymentServiceLink({
        link_version: 2,
        payment_rail: 'nevermined',
        payment_provider: NEVERMINED_PAYMENT_PROVIDER,
        nevermined_agent_id: attemptRow.binding.nevermined_agent_id!,
        nevermined_plan_id: attemptRow.binding.nevermined_plan_id!,
        payment_identifier: paymentId,
        quote_id: draft.quote_id,
        requirement_id: draft.requirement_id,
        service_id: attemptRow.binding.service_id,
        service_version: 'v1',
        request_input_hash: draft.request_input_hash,
        job_id: job.id,
        service_output_hash: draft.output_hash,
        verification_receipt_id: draft.receipt_id,
        verification_receipt_hash: draft.receipt_hash,
        verification_evidence_hash: draft.verification_evidence_hash,
        ...(draft.usage_result_hash ? { usage_result_hash: draft.usage_result_hash } : {}),
      });
      const recoveredSettlementEvidenceHash = await hashPaymentObject({
        kind: 'nevermined_settlement_recovered',
        payment_identifier: paymentId,
        transaction: reconciliation.transaction.providerTransactionId,
      });
      link = await extendWithSettlement(link, recoveredSettlementEvidenceHash);
      // eslint-disable-next-line no-console
      console.log('PaymentServiceLink built and extended:', {
        link_id: link.link_id,
        link_hash: link.link_hash,
      });

      // ---------------------------------------------------------------
      // STEP 11: settled_external -> link_verified -> settled -> consumed.
      // ---------------------------------------------------------------
      const toLinkVerified = await paymentAttempts.transitionLifecycleStage(
        paymentId,
        'settled_external',
        'link_verified'
      );
      expect(toLinkVerified.status).toBe('transitioned');
      const toSettled = await paymentAttempts.transitionLifecycleStage(
        paymentId,
        'link_verified',
        'settled'
      );
      expect(toSettled.status).toBe('transitioned');
      await paymentAttempts.markConsumed(paymentId);
      // eslint-disable-next-line no-console
      console.log('Transitioned: link_verified -> settled -> consumed');

      if (job.current_state === 'SETTLING') {
        const stateEventsRepo = new D1StateEventsRepository(db);
        const event = createStateEvent(
          job.id,
          1,
          'SETTLING',
          'DELIVERED',
          'SETTLEMENT_COMPLETE',
          'SYSTEM'
        );
        await stateEventsRepo.create(event);
        await jobsRepo.updateState(job.id, 'DELIVERED');
        // eslint-disable-next-line no-console
        console.log('Job transitioned: SETTLING -> DELIVERED');
      } else {
        // eslint-disable-next-line no-console
        console.log(
          `Job stays at ${job.current_state} (no legal edge to DELIVERED from there in the frozen JobState machine) ` +
            '— payment_attempts.lifecycle_stage/consumed_at and the PaymentServiceLink above are the authoritative record.'
        );
      }

      // Persist the final result shape into x402_service_results, same as
      // the route's own finalize() call, so a subsequent HTTP replay
      // reconstructs it exactly.
      const responseBody = {
        service_id: attemptRow.binding.service_id,
        result_class: 'success',
        output: draft.output,
        receipt_id: draft.receipt_id,
        link_id: link.link_id,
        link_hash: link.link_hash,
      };
      const settleResponse = {
        success: true,
        transaction: transactionReference ?? 'recovered:unknown',
        network: attemptRow.binding.network,
        creditsRedeemed: draft.actual_amount,
      };
      await results.finalize(
        job.id,
        { status: 200, body: responseBody, settleResponse },
        new Date().toISOString()
      );
      // eslint-disable-next-line no-console
      console.log('Final result persisted to x402_service_results.');

      // eslint-disable-next-line no-console
      console.log(
        'RECOVERY COMPLETE. verify+=0 execute+=0 settle+=0 delegation_creations+=0 tokens+=0 jobs+=0'
      );
    });
  }
);
