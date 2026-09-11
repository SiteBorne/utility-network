/**
 * SUN-1221E6R-H2AWI-3 test support — an in-process `WorkflowBindingLike`
 * double that drives the REAL H2AWI-2 `runPaidContinuationWorkflow`
 * orchestration function against real D1 repositories, so the large
 * pre-existing HTTP-level test suite (`x402-service-route.test.ts` and
 * siblings) keeps exercising real business logic end-to-end through the
 * new durable-continuation route wiring, without any live Cloudflare
 * Workflow resource.
 *
 * NOT a Cloudflare Workflow: no cross-request durability, no step
 * memoization, no crash/restart semantics. Those properties are H2AWI-2's
 * own concern and are already exhaustively proven against
 * `runPaidContinuationWorkflow` directly in
 * `paid-continuation-workflow-crash-matrix.test.ts` (12 cases) — this
 * double exists purely so HTTP-level tests can keep asserting on the
 * final response shape/D1 side effects without re-deriving that coverage
 * a second time at this layer.
 *
 * Lives under `src/control-plane/testing/` (not `tests/`) so it can be
 * imported by `routes/paid-services.ts` (itself dev/fixture-only wiring,
 * never imported by the real Worker entrypoint `index.ts` — confirmed
 * this checkpoint) — the same "fixture implementation shipped in src/"
 * precedent `FixturePaymentEvidenceProvider` already established in
 * `@siteborne/protocol-x402`. NEVER imported by any real production
 * route composition file
 * (`production/web-context-v2-cdp-composition.ts`,
 * `production/verify-agent-output-v2-cdp-composition.ts`).
 */
import type { D1Database } from '@cloudflare/workers-types';
import type {
  Network,
  PaymentEvidenceMode,
  PaymentEvidenceProvider,
  PaymentServiceLink,
  SettleResponse,
} from '@siteborne/protocol-x402';
import {
  CDP_PAYMENT_PROVIDER,
  buildPaymentServiceLink,
  extendWithSettlement,
  hashPaymentObject,
  verifyPaymentServiceLink,
} from '@siteborne/protocol-x402';
import {
  NEVERMINED_PAYMENT_PROVIDER,
  type NeverminedPaymentResponse,
} from '@siteborne/protocol-nevermined';
import { D1PaymentAttemptRepository } from '../repositories/d1/payment-attempts';
import { D1JobsRepository, D1StateEventsRepository } from '../repositories/d1/jobs';
import { X402ServiceResultRepository } from '../repositories/d1/x402-quotes';
import {
  runPaidContinuationWorkflow,
  type PaidContinuationWorkflowDependencies,
  type PaidContinuationWorkflowStep,
  type JobStatePersistence,
  type JobRecord,
  type PersistResultInput,
} from '../workflows/paid-continuation-workflow';
import type { ExecutorOutcome, ServiceExecutor } from '../routes/x402-service';
import type { WorkflowBindingLike, WorkflowInstanceLike } from '../continuation/handoff';
import type { WorkflowContinuationInput, WorkflowContinuationResult } from '../continuation/types';

export interface InProcessWorkflowBindingOptions {
  readonly db: D1Database;
  readonly executor: ServiceExecutor;
  readonly evidenceProvider: Pick<PaymentEvidenceProvider, 'settle'>;
  readonly envelopeKey: CryptoKey;
  readonly network: Network;
  readonly evidenceMode?: PaymentEvidenceMode;
  readonly rail?: 'cdp' | 'nevermined';
  readonly neverminedAgentId?: string;
  readonly neverminedPlanId?: string;
  readonly clock?: () => number;
  readonly chainReceiptChecker?: (
    transactionReference: string,
    network: Network
  ) => Promise<'SETTLED' | 'FAILED' | 'STILL_UNKNOWN'>;
  readonly onExecutorCall?: () => void;
  readonly onSettleCall?: () => void;
}

class InProcessWorkflowInstance implements WorkflowInstanceLike {
  private settledFlag = false;
  private output: WorkflowContinuationResult | undefined;
  private erroredInfo: { name: string; message: string } | undefined;
  readonly ready: Promise<void>;

  constructor(
    readonly id: string,
    run: () => Promise<WorkflowContinuationResult>
  ) {
    this.ready = run().then(
      (result) => {
        this.settledFlag = true;
        this.output = result;
      },
      (err: unknown) => {
        this.settledFlag = true;
        this.erroredInfo = {
          name: err instanceof Error ? err.name : 'Error',
          message: err instanceof Error ? err.message : String(err),
        };
      }
    );
  }

  async status(): ReturnType<WorkflowInstanceLike['status']> {
    if (!this.settledFlag) return { status: 'running' };
    if (this.erroredInfo) return { status: 'errored', error: this.erroredInfo };
    return { status: 'complete', output: this.output };
  }
}

export function createInProcessWorkflowBinding(
  options: InProcessWorkflowBindingOptions
): WorkflowBindingLike {
  const instances = new Map<string, InProcessWorkflowInstance>();
  const rail = options.rail ?? 'cdp';

  return {
    async create({ id, params }: { id: string; params: WorkflowContinuationInput }) {
      if (instances.has(id)) {
        throw new Error(`Workflow instance ${id} already exists`);
      }

      const paymentAttempts = new D1PaymentAttemptRepository(options.db);
      const jobsRepo = new D1JobsRepository(options.db);
      const stateEventsRepo = new D1StateEventsRepository(options.db);
      const results = new X402ServiceResultRepository(options.db);

      // Recording state scoped to THIS one Workflow run -- never shared
      // across instances, so concurrent different-payment runs never
      // race on each other's captured output.
      let capturedOutcome: ExecutorOutcome | undefined;
      let capturedSettlement: { transactionReference?: string; payer?: string } | undefined;
      // SUN-1222C-PCC-WIRE-RESULT-IMPLEMENTATION: the real, already-fixed
      // `DurableCachedResult` the workflow itself constructs (governed PCC
      // wire body included) -- captured here so `persistReceipt` below can
      // use this ONE real object as its source of truth instead of
      // independently re-deriving a second, drift-prone response shape
      // from raw executor output.
      let capturedCachedResult: PersistResultInput['cachedResult'] | undefined;

      const recordingExecutor: ServiceExecutor = async (input, ctx) => {
        options.onExecutorCall?.();
        const outcome = await options.executor(input, ctx);
        capturedOutcome = outcome;
        return outcome;
      };

      const jobStatePersistence: JobStatePersistence = {
        async getJob(jobId): Promise<JobRecord | null> {
          const result = await jobsRepo.getById(jobId);
          if (!result.ok || !result.value) return null;
          return {
            id: result.value.id,
            current_state: result.value.current_state,
            attempt_number: 1,
          };
        },
        async appendStateEvent(event) {
          await stateEventsRepo.create(event);
        },
        async setCurrentState(jobId, state) {
          await jobsRepo.updateState(jobId, state);
        },
      };

      const deps: PaidContinuationWorkflowDependencies = {
        envelopeKey: options.envelopeKey,
        clock: options.clock ?? (() => Math.floor(Date.now() / 1000)),
        evidenceMode: options.evidenceMode ?? 'fixture',
        executor: recordingExecutor,
        validatePcc: (outcome) => ({ valid: true, pcc: outcome.result.verification }),
        settlement: {
          repository: paymentAttempts,
          evidenceProvider: {
            settle: async (settlementContext, verificationEvidence, actualAmount) => {
              options.onSettleCall?.();
              const evidence = await options.evidenceProvider.settle(
                settlementContext,
                verificationEvidence,
                actualAmount
              );
              capturedSettlement = {
                transactionReference: evidence.transaction_reference,
                payer: evidence.payer,
              };
              return evidence;
            },
          },
        },
        reconciliation: {
          checker: options.chainReceiptChecker ?? (async () => 'STILL_UNKNOWN' as const),
          network: options.network,
        },
        persistence: {
          job: jobStatePersistence,
          resultReceipt: {
            async persistResult({ cachedResult }) {
              capturedCachedResult = cachedResult;
              return { status: 'written' as const };
            },
            async persistReceipt({ jobId, paymentIdentifier }) {
              const metadata = params.metadata;
              const fallbackReceiptId = `rcpt_inprocess_${jobId}`;
              if (!capturedOutcome || !capturedSettlement) {
                return { status: 'written' as const, receiptId: fallbackReceiptId };
              }
              const receiptId = capturedOutcome.result.receipt_id ?? fallbackReceiptId;

              let link: PaymentServiceLink = await buildPaymentServiceLink({
                link_version: 2,
                payment_rail: rail,
                payment_provider:
                  rail === 'nevermined' ? NEVERMINED_PAYMENT_PROVIDER : CDP_PAYMENT_PROVIDER,
                ...(rail === 'nevermined'
                  ? {
                      nevermined_agent_id: options.neverminedAgentId ?? 'in-process-agent',
                      nevermined_plan_id: options.neverminedPlanId ?? 'in-process-plan',
                    }
                  : {}),
                payment_identifier: paymentIdentifier,
                quote_id: `quote_${jobId}`,
                requirement_id: `req_${jobId}`,
                service_id: metadata.service as never,
                service_version: metadata.service.endsWith('.v2') ? 'v2' : 'v1',
                request_input_hash: await hashPaymentObject({ jobId }),
                job_id: jobId,
                service_output_hash: capturedOutcome.result.output_hash ?? '',
                verification_receipt_id: receiptId,
                verification_receipt_hash: await hashPaymentObject(
                  (capturedOutcome.result.receipt ?? {}) as Record<string, unknown>
                ),
                verification_evidence_hash: await hashPaymentObject({ jobId, paymentIdentifier }),
              });
              const settlementEvidenceHash = await hashPaymentObject({
                jobId,
                paymentIdentifier,
                transactionReference: capturedSettlement.transactionReference,
              });
              link = await extendWithSettlement(link, settlementEvidenceHash);
              await verifyPaymentServiceLink(link);

              // SUN-1222C-PCC-WIRE-RESULT-IMPLEMENTATION: use the real
              // workflow's own `cachedResult.body` (the governed PCC wire
              // result -- see DurableCachedResult's doc comment) as the
              // single source of truth, rather than re-deriving a second,
              // now-provably-stale shape from raw executor output. Falls
              // back to the old reconstruction only if the real STEP 5
              // (`persist-result`) somehow never ran before this STEP 6
              // (`persist-receipt`) -- should not happen given the real
              // workflow's own step ordering, kept only as a defensive
              // non-crash fallback.
              const responseBody: Readonly<Record<string, unknown>> = capturedCachedResult
                ? capturedCachedResult.body
                : {
                    service_id: metadata.service,
                    result_class: capturedOutcome.result.result_class,
                    output: capturedOutcome.result.output,
                    receipt_id: receiptId,
                    link_id: link.link_id,
                    link_hash: link.link_hash,
                  };
              const settleResponse: SettleResponse | NeverminedPaymentResponse =
                rail === 'nevermined'
                  ? {
                      success: true,
                      transaction:
                        capturedSettlement.transactionReference ?? 'fixture:settlement:unknown',
                      network: options.network,
                      ...(capturedSettlement.payer ? { payer: capturedSettlement.payer } : {}),
                      creditsRedeemed: metadata.amount_atomic,
                    }
                  : {
                      success: true,
                      transaction:
                        capturedSettlement.transactionReference ?? 'synthetic-tx:unknown',
                      network: options.network,
                      ...(capturedSettlement.payer ? { payer: capturedSettlement.payer } : {}),
                      amount: metadata.amount_atomic,
                      extra: { link_id: link.link_id, payment_identifier: paymentIdentifier },
                    };
              await results.create(
                jobId,
                paymentIdentifier,
                { status: 200, body: responseBody, settleResponse },
                new Date().toISOString()
              );
              return { status: 'written' as const, receiptId };
            },
          },
          finalization: {
            async recordProviderFailure() {},
            async recordSettlementFinalizationUnresolved() {},
            async persistLinkEvidence() {},
            async finalizeSettled(paymentIdentifier) {
              const stage = await paymentAttempts.getLifecycleStage(paymentIdentifier);
              if (stage === 'settled_external') {
                await paymentAttempts.transitionLifecycleStage(
                  paymentIdentifier,
                  'settled_external',
                  'link_verified'
                );
              }
              if (
                (await paymentAttempts.getLifecycleStage(paymentIdentifier)) === 'link_verified'
              ) {
                await paymentAttempts.transitionLifecycleStage(
                  paymentIdentifier,
                  'link_verified',
                  'settled'
                );
              }
            },
          },
        },
      };

      const fakeStep: PaidContinuationWorkflowStep = {
        async do(_name, _config, callback) {
          return callback();
        },
      };

      const instance = new InProcessWorkflowInstance(id, () =>
        runPaidContinuationWorkflow({ payload: params }, fakeStep, deps)
      );
      instances.set(id, instance);
      return instance;
    },
    async get(id: string) {
      const found = instances.get(id);
      if (!found) throw new Error(`no such Workflow instance ${id}`);
      return found;
    },
  };
}
