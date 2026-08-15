/**
 * SUN-0900B checkpoints 2H/2I — recovery-only finalizer for a single document
 * dynamic-credit lifecycle. This surface cannot create delegations/tokens,
 * verify permissions, execute a service, or settle permissions. It only
 * reconciles the already-persisted Payment-Identifier through seller GETs,
 * public Base Sepolia evidence, and the existing D1 artifacts.
 */
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { Payments } from '@nevermined-io/payments';
import { createPublicClient, decodeEventLog, erc20Abi, http, type Address, type Hash } from 'viem';
import { baseSepolia } from 'viem/chains';
import {
  NEVERMINED_PAYMENT_PROVIDER,
  buildNeverminedCreditsSettlementEvidence,
  reconcileNeverminedSettlementForRecovery,
  validateNeverminedCreditsSettlementEvidence,
  validateNeverminedDocumentDynamicPlan,
  type NeverminedAgentReadback,
  type NeverminedDelegationLookupClient,
  type NeverminedDelegationRecoveryRecord,
  type NeverminedPlanReadback,
  type NeverminedSettlementTransaction,
} from '@siteborne/protocol-nevermined';
import {
  acquirePaymentAttempt,
  bindingsAreIdentical,
  buildPaymentServiceLink,
  extendWithSettlement,
  hashPaymentObject,
  verifyPaymentServiceLink,
  type ExternalSettlementEvidence,
  type PaymentServiceLink,
  type UsageResult,
} from '@siteborne/protocol-x402';
import type { VerificationReceipt } from '@siteborne/verification';
import { D1PaymentAttemptRepository } from '../../src/control-plane/repositories/d1/payment-attempts';
import {
  D1JobsRepository,
  D1StateEventsRepository,
} from '../../src/control-plane/repositories/d1/jobs';
import { X402ServiceResultRepository } from '../../src/control-plane/repositories/d1/x402-quotes';
import { resolveLivePersistencePath } from '../../src/control-plane/live-persistence-path';
import { createStateEvent } from '../../src/control-plane/state-machine';

const PAYMENT_ID = process.env.NEVERMINED_RECOVER_DOCUMENT_PAYMENT_ID;
const PARTIAL_BALANCE_RECOVERY = process.env.NEVERMINED_DOCUMENT_PARTIAL_BALANCE === '1';
const REPOSITORY_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const SANDBOX_BACKEND = 'https://api.sandbox.nevermined.app/';
const AGENT_ID = '109760621961288696094411057321700210583752765344624386042713081041578011828571';
const PLAN_ID = '64977106381472769302826211192910538031161833107493020584806963732279386695975';
const SERVICE_ID = 'document_evidence_json.v1';
const NETWORK = 'eip155:84532';
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address;
const SELLER = '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1' as Address;
const PLATFORM = '0x2020949c1B565421AC21b76e70340266c4CA9A90' as Address;
const STARTING_BALANCE = PARTIAL_BALANCE_RECOVERY ? '178000' : '0';
const ACTUAL_USAGE = PARTIAL_BALANCE_RECOVERY ? '190000' : '12000';
const publicClient = createPublicClient({ chain: baseSepolia, transport: http() });

interface PendingDraft {
  kind: 'nevermined_settlement_pending_draft';
  quote_id: string;
  requirement_id: string;
  request_input_hash: string;
  output: unknown;
  output_hash: string;
  receipt_id: string;
  receipt_hash: string;
  receipt: VerificationReceipt;
  pcc: { decision?: unknown };
  verification_evidence: { payer?: string };
  verification_evidence_hash: string;
  actual_amount: string;
  usage_result_hash: string;
  usage_result: UsageResult;
  scheme: 'upto';
  authorized_maximum: string;
}

function requireBuilderKey(): string {
  const value = process.env.NVM_API_KEY;
  if (!value) throw new Error('NVM_API_KEY is required for seller GET-only recovery');
  return value;
}

function sellerGetClient(apiKey: string): NeverminedDelegationLookupClient {
  async function get(path: string): Promise<unknown> {
    const response = await fetch(new URL(path, SANDBOX_BACKEND), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'Nevermined-Version': '1.1',
      },
    });
    if (!response.ok) throw new Error(`nevermined_document_recovery_http_${response.status}`);
    return response.json();
  }
  return {
    async listDelegationTransactions(delegationId) {
      const body = (await get(
        `/api/v1/delegation/${encodeURIComponent(delegationId)}/transactions`
      )) as { transactions?: NeverminedSettlementTransaction[] };
      if (!Array.isArray(body.transactions)) {
        throw new Error('nevermined_document_recovery_malformed_transactions');
      }
      return { transactions: body.transactions };
    },
    async getDelegation(delegationId) {
      return (await get(
        `/api/v1/delegation/${encodeURIComponent(delegationId)}`
      )) as NeverminedDelegationRecoveryRecord;
    },
  };
}

function readCashTransfers(
  receipt: Awaited<ReturnType<typeof publicClient.getTransactionReceipt>>
) {
  let seller = 0n;
  let platform = 0n;
  const payers = new Set<string>();
  const transfers: Array<{ from: string; to: string; value: bigint }> = [];
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== USDC.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: erc20Abi, data: log.data, topics: log.topics });
      if (decoded.eventName !== 'Transfer') continue;
      const args = decoded.args as { from: Address; to: Address; value: bigint };
      transfers.push({
        from: args.from.toLowerCase(),
        to: args.to.toLowerCase(),
        value: args.value,
      });
      if (args.to.toLowerCase() === SELLER.toLowerCase()) {
        seller += args.value;
        payers.add(args.from.toLowerCase());
      }
      if (args.to.toLowerCase() === PLATFORM.toLowerCase()) {
        platform += args.value;
        payers.add(args.from.toLowerCase());
      }
    } catch {
      // Non-Transfer logs are irrelevant; exact totals below remain the gate.
    }
  }
  return { seller, platform, gross: seller + platform, payers: [...payers], transfers };
}

describe.skipIf(!PAYMENT_ID)(
  PARTIAL_BALANCE_RECOVERY
    ? 'SUN-0900B checkpoint 2I — document partial-balance same-payment recovery'
    : 'SUN-0900B checkpoint 2H — document zero-balance same-payment recovery',
  () => {
    let mf: Miniflare;
    let db: D1Database;
    let persistencePath: string;

    async function openD1(): Promise<void> {
      mf = new Miniflare({
        modules: true,
        script: `export default { async fetch() { return new Response('OK'); } }`,
        d1Databases: ['DB'],
        resourcePersistencePath: persistencePath,
      });
      db = await mf.getD1Database('DB');
    }

    beforeAll(async () => {
      if (process.env.RUN_LIVE_NEVERMINED || process.env.RUN_LIVE_X402) {
        throw new Error('live execution flags must remain absent during recovery');
      }
      if (process.env.NVM_SUBSCRIBER_API_KEY) {
        // The host may carry it, but this recovery surface deliberately never
        // reads it. Presence is harmless; all authenticated calls use only the
        // builder key captured below.
      }
      persistencePath = resolveLivePersistencePath({ repositoryRoot: REPOSITORY_ROOT });
      await openD1();
    });

    afterAll(async () => {
      if (mf) await mf.dispose();
    });

    it('reconciles exact external cash/credits and finalizes the original Payment-Identifier with zero provider/work calls', async () => {
      const paymentIdentifier = PAYMENT_ID!;
      const paymentAttempts = new D1PaymentAttemptRepository(db);
      const jobs = new D1JobsRepository(db);
      const results = new X402ServiceResultRepository(db);
      const attempt = await paymentAttempts.getByIdentifier(paymentIdentifier);
      const recovery = await paymentAttempts.getSettlementRecoveryRecord(paymentIdentifier);
      expect(attempt).toBeTruthy();
      expect(recovery).toBeTruthy();
      expect(attempt?.binding).toMatchObject({
        service_id: SERVICE_ID,
        network: NETWORK,
        amount: '190000',
        payment_rail: 'nevermined',
        nevermined_agent_id: AGENT_ID,
        nevermined_plan_id: PLAN_ID,
      });
      expect(recovery?.neverminedDelegationId).toBeTruthy();

      if (attempt?.consumed) {
        expect(recovery?.lifecycleStage).toBe('settled');
        const completedJob = await jobs.getByIdempotencyKey(paymentIdentifier);
        expect(completedJob.ok && completedJob.value?.current_state).toBe('DELIVERED');
        if (!completedJob.ok || !completedJob.value) return;
        const cached = await results.getByJobId<{
          status: number;
          body: { actual_amount: string; authorized_maximum: string };
          durableEvidence: {
            settlement_evidence: {
              nevermined_credits_settlement: unknown;
            };
            payment_service_link: PaymentServiceLink;
          };
        }>(completedJob.value.id);
        const cachedCredit = cached!.durableEvidence.settlement_evidence
          .nevermined_credits_settlement as {
          starting_balance: string;
          credits_acquired: string;
          credits_redeemed: string;
          remaining_balance: string;
          cash_movement_atomic: string;
        };
        expect(cached).toMatchObject({
          status: 200,
          body: { actual_amount: ACTUAL_USAGE, authorized_maximum: '190000' },
          durableEvidence: {
            settlement_evidence: {
              nevermined_credits_settlement: {
                starting_balance: STARTING_BALANCE,
                credits_redeemed: ACTUAL_USAGE,
              },
            },
          },
        });
        expect(
          await verifyPaymentServiceLink(cached!.durableEvidence.payment_service_link)
        ).toEqual({ valid: true });
        expect(
          await validateNeverminedCreditsSettlementEvidence(
            cached!.durableEvidence.settlement_evidence.nevermined_credits_settlement,
            {
              payment_identifier: paymentIdentifier,
              plan_id: PLAN_ID,
              authorized_maximum: '190000',
              actual_usage: ACTUAL_USAGE,
              expected_starting_balance: STARTING_BALANCE,
              expected_acquisition: cachedCredit.credits_acquired,
            }
          )
        ).toEqual({ valid: true });
        const conflict = await acquirePaymentAttempt(paymentAttempts, {
          binding: {
            ...attempt.binding,
            request_input_hash: 'sha256:' + 'f'.repeat(64),
          },
          nowIso: attempt.created_at,
          ttlMs: 3_600_000,
        });
        expect(conflict.status).toBe('already_consumed');
        expect(
          conflict.status === 'already_consumed' &&
            !bindingsAreIdentical(conflict.existing.binding, {
              ...attempt.binding,
              request_input_hash: 'sha256:' + 'f'.repeat(64),
            })
        ).toBe(true);
        console.log(
          PARTIAL_BALANCE_RECOVERY
            ? 'SUN-0900B 2I RECOVERY AUDIT (sanitized):'
            : 'SUN-0900B 2H RECOVERY AUDIT (sanitized):',
          {
            payment_identifier: paymentIdentifier,
            lifecycle_stage: recovery?.lifecycleStage,
            job_id: completedJob.value.id,
            link_id: cached!.durableEvidence.payment_service_link.link_id,
            duplicate_conflict: 'replay_conflict',
            replay_additional_verify: 0,
            replay_additional_execute: 0,
            replay_additional_settle: 0,
            replay_additional_jobs: 0,
          }
        );
        return;
      }

      expect(attempt?.consumed).toBe(false);
      expect(recovery?.lifecycleStage).toBe('settlement_pending');

      const jobResult = await jobs.getByIdempotencyKey(paymentIdentifier);
      expect(jobResult.ok && jobResult.value).toBeTruthy();
      if (!jobResult.ok || !jobResult.value || !attempt || !recovery) return;
      const job = jobResult.value;
      expect(job.current_state).toBe('SETTLING');
      const draft = await results.getByJobId<PendingDraft>(job.id);
      expect(draft?.kind).toBe('nevermined_settlement_pending_draft');
      if (!draft || draft.kind !== 'nevermined_settlement_pending_draft') return;
      expect(draft).toMatchObject({
        actual_amount: ACTUAL_USAGE,
        authorized_maximum: '190000',
        scheme: 'upto',
        usage_result: { actual_amount: ACTUAL_USAGE, authorized_maximum: '190000' },
        pcc: { decision: 'pass' },
      });
      expect(draft.usage_result.usage_result_hash).toBe(draft.usage_result_hash);
      expect(draft.verification_evidence.payer).toMatch(/^0x[0-9a-fA-F]{40}$/);

      // The fixture public-key registry is intentionally process-local and
      // was lost with the crashed live process. That process self-verified
      // the receipt before persisting this draft. Recovery independently
      // proves that the exact immutable receipt survived unchanged and still
      // binds the same service/job/output; it does not fabricate a second
      // signature-verification claim with a newly generated test key.
      expect(await hashPaymentObject(draft.receipt as unknown as Record<string, unknown>)).toBe(
        draft.receipt_hash
      );
      expect(draft.receipt).toMatchObject({
        service_id: SERVICE_ID,
        output_hash: draft.output_hash,
        receipt_id: draft.receipt_id,
        decision: 'pass',
      });
      expect(draft.receipt.job_id).toMatch(/^job_[a-z0-9]{24}$/);

      const builderKey = requireBuilderKey();
      const builder = Payments.getInstance({ nvmApiKey: builderKey, environment: 'sandbox' });
      const agent = (await builder.agents.getAgent(AGENT_ID)) as NeverminedAgentReadback;
      const plan = (await builder.plans.getPlan(PLAN_ID)) as NeverminedPlanReadback;
      expect(validateNeverminedDocumentDynamicPlan(agent, plan)).toEqual({ valid: true });

      const reconciliation = await reconcileNeverminedSettlementForRecovery(
        sellerGetClient(builderKey),
        recovery.neverminedDelegationId!,
        {
          planId: PLAN_ID,
          provider: 'erc4337',
          currency: 'usdc',
          payer: draft.verification_evidence.payer,
        }
      );
      expect(reconciliation.state).toBe('SETTLED');
      if (reconciliation.state !== 'SETTLED') return;
      expect(reconciliation.transaction).toMatchObject({
        status: 'succeeded',
        currency: 'USDC',
      });
      const transactionReference = reconciliation.transaction.providerTransactionId;
      expect(transactionReference).toMatch(/^0x[0-9a-fA-F]{64}$/);

      const receipt = await publicClient.getTransactionReceipt({
        hash: transactionReference as Hash,
      });
      expect(receipt.status).toBe('success');
      const cash = readCashTransfers(receipt);
      expect(cash.payers).toHaveLength(1);
      const settlementSource = cash.payers[0]!;
      const verifiedPayer = draft.verification_evidence.payer!.toLowerCase();
      const planBalance = await builder.plans.getPlanBalance(
        PLAN_ID,
        draft.verification_evidence.payer as Address
      );
      const remainingBalance = String(planBalance.balance);
      const acquired = BigInt(remainingBalance) + BigInt(ACTUAL_USAGE) - BigInt(STARTING_BALANCE);
      const deficit = BigInt(ACTUAL_USAGE) - BigInt(STARTING_BALANCE);
      expect(acquired).toBeGreaterThanOrEqual(deficit);
      expect(cash.gross).toBe(acquired);
      expect(cash.seller * 100n).toBe(cash.gross * 99n);
      expect(cash.platform * 100n).toBe(cash.gross);
      if (settlementSource !== verifiedPayer) {
        expect(
          cash.transfers.some(
            (transfer) =>
              transfer.from === verifiedPayer &&
              transfer.to === settlementSource &&
              transfer.value === acquired
          )
        ).toBe(true);
      }

      const creditEvidence = await buildNeverminedCreditsSettlementEvidence({
        payment_identifier: paymentIdentifier,
        plan_id: PLAN_ID,
        starting_balance: STARTING_BALANCE,
        credits_acquired: String(acquired),
        credits_redeemed: ACTUAL_USAGE,
        usage_value_atomic: ACTUAL_USAGE,
        remaining_balance: remainingBalance,
        cash_movement_atomic: String(cash.gross),
        transaction: transactionReference!,
        observed_at: reconciliation.transaction.createdAt,
      });
      expect(
        await validateNeverminedCreditsSettlementEvidence(creditEvidence, {
          payment_identifier: paymentIdentifier,
          plan_id: PLAN_ID,
          authorized_maximum: '190000',
          actual_usage: ACTUAL_USAGE,
          expected_starting_balance: STARTING_BALANCE,
          expected_acquisition: String(acquired),
        })
      ).toEqual({ valid: true });

      const recoveredPublicEvidence = {
        kind: 'nevermined_settlement_recovered',
        payment_identifier: paymentIdentifier,
        plan_id: PLAN_ID,
        delegation_id: recovery.neverminedDelegationId,
        transaction: transactionReference,
        amount_cents: reconciliation.transaction.amountCents,
        credits_redeemed: ACTUAL_USAGE,
        remaining_balance: remainingBalance,
      };
      const settlementEvidence: ExternalSettlementEvidence & {
        nevermined_credits_settlement: typeof creditEvidence;
      } = {
        x402_version: 2,
        scheme: 'upto',
        network: NETWORK,
        asset: attempt.binding.asset,
        payer: draft.verification_evidence.payer,
        payee: attempt.binding.payee,
        actual_amount: ACTUAL_USAGE,
        authorized_maximum: '190000',
        quote_id: draft.quote_id,
        requirement_id: draft.requirement_id,
        payment_identifier: paymentIdentifier,
        transaction_reference: transactionReference!,
        success: true,
        settled_at: reconciliation.transaction.createdAt,
        facilitator_identity: NEVERMINED_PAYMENT_PROVIDER,
        raw_evidence_hash: await hashPaymentObject(recoveredPublicEvidence),
        verification_evidence_hash: draft.verification_evidence_hash,
        usage_result_hash: draft.usage_result_hash,
        trust_class: 'external_verified',
        nevermined_credits_settlement: creditEvidence,
      };

      let link = await buildPaymentServiceLink({
        link_version: 2,
        payment_rail: 'nevermined',
        payment_provider: NEVERMINED_PAYMENT_PROVIDER,
        nevermined_agent_id: AGENT_ID,
        nevermined_plan_id: PLAN_ID,
        payment_identifier: paymentIdentifier,
        quote_id: draft.quote_id,
        requirement_id: draft.requirement_id,
        service_id: SERVICE_ID,
        service_version: 'v1',
        request_input_hash: draft.request_input_hash,
        job_id: job.id,
        service_output_hash: draft.output_hash,
        verification_receipt_id: draft.receipt_id,
        verification_receipt_hash: draft.receipt_hash,
        usage_result_hash: draft.usage_result_hash,
        verification_evidence_hash: draft.verification_evidence_hash,
      });
      link = await extendWithSettlement(link, await hashPaymentObject(settlementEvidence));
      expect(await verifyPaymentServiceLink(link)).toEqual({ valid: true });

      const recorded = await paymentAttempts.recordSettledExternal(
        paymentIdentifier,
        transactionReference!,
        ['settlement_pending']
      );
      expect(recorded.status).toBe('transitioned');
      const responseBody = {
        service_id: SERVICE_ID,
        result_class: 'success',
        output: draft.output,
        receipt_id: draft.receipt_id,
        link_id: link.link_id,
        link_hash: link.link_hash,
        authorized_maximum: '190000',
        actual_amount: ACTUAL_USAGE,
      };
      const settleResponse = {
        success: true,
        transaction: transactionReference!,
        network: NETWORK,
        payer: draft.verification_evidence.payer,
        creditsRedeemed: ACTUAL_USAGE,
        remainingBalance,
      };
      await results.finalize(
        job.id,
        {
          status: 200,
          body: responseBody,
          settleResponse,
          durableEvidence: {
            usage_result: draft.usage_result,
            pcc: draft.pcc,
            receipt: draft.receipt,
            settlement_evidence: settlementEvidence,
            payment_service_link: link,
          },
        },
        new Date().toISOString()
      );
      expect(
        (
          await paymentAttempts.transitionLifecycleStage(
            paymentIdentifier,
            'settled_external',
            'link_verified'
          )
        ).status
      ).toBe('transitioned');
      expect(
        (
          await paymentAttempts.transitionLifecycleStage(
            paymentIdentifier,
            'link_verified',
            'settled'
          )
        ).status
      ).toBe('transitioned');
      await paymentAttempts.markConsumed(paymentIdentifier);
      const event = createStateEvent(
        job.id,
        1,
        'SETTLING',
        'DELIVERED',
        'SETTLEMENT_COMPLETE',
        'SYSTEM'
      );
      await new D1StateEventsRepository(db).create(event);
      expect((await jobs.updateState(job.id, 'DELIVERED')).ok).toBe(true);

      await mf.dispose();
      await openD1();
      const reopenedAttempts = new D1PaymentAttemptRepository(db);
      const reopenedJobs = new D1JobsRepository(db);
      const reopenedResults = new X402ServiceResultRepository(db);
      const reopened = await reopenedAttempts.getByIdentifier(paymentIdentifier);
      expect(reopened).toMatchObject({ consumed: true });
      expect(
        (await reopenedAttempts.getSettlementRecoveryRecord(paymentIdentifier))?.lifecycleStage
      ).toBe('settled');
      const reopenedJob = await reopenedJobs.getByIdempotencyKey(paymentIdentifier);
      expect(reopenedJob.ok && reopenedJob.value?.current_state).toBe('DELIVERED');
      const cached = await reopenedResults.getByJobId<{
        status: number;
        body: typeof responseBody;
        durableEvidence: { payment_service_link: PaymentServiceLink };
      }>(job.id);
      expect(cached).toMatchObject({ status: 200, body: responseBody });
      expect(await verifyPaymentServiceLink(cached!.durableEvidence.payment_service_link)).toEqual({
        valid: true,
      });

      const conflict = await acquirePaymentAttempt(reopenedAttempts, {
        binding: {
          ...attempt.binding,
          request_input_hash: 'sha256:' + 'f'.repeat(64),
        },
        nowIso: attempt.created_at,
        ttlMs: 3_600_000,
      });
      expect(conflict.status).toBe('already_consumed');
      expect(
        conflict.status === 'already_consumed' &&
          !bindingsAreIdentical(conflict.existing.binding, {
            ...attempt.binding,
            request_input_hash: 'sha256:' + 'f'.repeat(64),
          })
      ).toBe(true);
      const finalJobCount = await db
        .prepare('SELECT COUNT(*) AS count FROM jobs WHERE idempotency_key = ?')
        .bind(paymentIdentifier)
        .first<{ count: number }>();
      expect(finalJobCount?.count).toBe(1);

      console.log(
        PARTIAL_BALANCE_RECOVERY
          ? 'SUN-0900B 2I RECOVERY COMPLETE (sanitized):'
          : 'SUN-0900B 2H RECOVERY COMPLETE (sanitized):',
        {
          payment_identifier: paymentIdentifier,
          delegation_id: recovery.neverminedDelegationId,
          agent_id: AGENT_ID,
          plan_id: PLAN_ID,
          job_id: job.id,
          transaction_hash: transactionReference,
          cash_movement_atomic: String(cash.gross),
          seller_atomic: String(cash.seller),
          platform_atomic: String(cash.platform),
          transaction_amount_cents: reconciliation.transaction.amountCents,
          starting_credits: STARTING_BALANCE,
          credits_acquired: String(acquired),
          credits_redeemed: ACTUAL_USAGE,
          remaining_credits: remainingBalance,
          usage_result_hash: draft.usage_result_hash,
          receipt_id: draft.receipt_id,
          receipt_hash: draft.receipt_hash,
          link_id: link.link_id,
          link_hash: link.link_hash,
          recovery_added_verify: 0,
          recovery_added_execute: 0,
          recovery_added_settle: 0,
          recovery_added_jobs: 0,
        }
      );
    }, 180_000);
  }
);
