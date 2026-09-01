/**
 * SUN-1221E6R-H2BF1 — real production dependency construction for
 * `PaidContinuationWorkflow.run()`.
 *
 * This is the piece H2AWI-2's own doc comment explicitly deferred
 * ("`PaidContinuationWorkflow` ... wired to `wrangler.toml` only in
 * H2AWI-4 ... unreferenced by any production route or config this
 * checkpoint") and H2AWI-3/H2AWI-4/H2AWI-4R/H2AWI-4P never actually
 * closed — `run()` was left as a hard-coded throwing stub straight
 * through real Cloudflare provisioning and the H2B real-payment attempt,
 * which errored with zero Workflow steps executed
 * (`docs/reports/SUN-1221E6R-H2B-real-durable-workflow-payment-
 * qualification.md`).
 *
 * Deliberately a separate module from `paid-continuation-workflow.ts`
 * (plan's own "no giant orchestration file" principle, §4) and kept thin:
 * every real dependency it builds is a REUSED, already-audited
 * production primitive — the exact two composition functions the real
 * HTTP routes already call (`buildWebContextV2CdpProductionRouteConfig`,
 * `buildVerifyAgentOutputV2CdpProductionRouteConfig`), the real D1
 * repository classes (`D1JobsRepository`, `D1StateEventsRepository`,
 * `X402ServiceResultRepository`, `D1PaymentAttemptRepository`), and the
 * real chain-receipt checker (`buildProductionCdpChainReceiptChecker`).
 * Nothing here reimplements executor logic, PCC generation, D1 access,
 * or CDP/facilitator wiring — it only adapts already-real pieces to the
 * narrow port shapes `PaidContinuationWorkflowDependencies` declares.
 */
import { buildWebContextV2CdpProductionRouteConfig } from '../production/web-context-v2-cdp-composition';
import { buildVerifyAgentOutputV2CdpProductionRouteConfig } from '../production/verify-agent-output-v2-cdp-composition';
import { importContinuationEnvelopeKey } from '../continuation/envelope';
import { buildProductionCdpChainReceiptChecker } from '../evidence/chain-receipt-checker';
import { D1JobsRepository, D1StateEventsRepository } from '../repositories/d1/jobs';
import { D1PaymentAttemptRepository } from '../repositories/d1/payment-attempts';
import { X402ServiceResultRepository } from '../repositories/d1/x402-quotes';
import { receiptPersistenceIdempotencyKey } from '../continuation/idempotency-keys';
import type {
  PaidContinuationWorkflowDependencies,
  PaidContinuationWorkflowHostEnv,
  JobRecord,
  JobStatePersistence,
  ResultReceiptPersistence,
  PccValidator,
} from './paid-continuation-workflow';
import type { ExecutorOutcome } from '../routes/x402-service';

export interface ProductionDependenciesUnavailable {
  readonly unavailable: true;
  readonly reason: string;
}

/**
 * The two real production services this Workflow ever serves. Any other
 * `metadata.service` value is a genuine configuration error (a route
 * this Workflow was never wired for) — fails closed, never a silent
 * default to one service's dependencies for another's payload.
 */
const SUPPORTED_SERVICES = new Set(['web_context_verified.v2', 'verify_agent_output.v2']);

/**
 * The one real PCC gate this codebase has ever had: `@siteborne/
 * service-runtime`'s dispatcher already treats `result.result_class ===
 * 'success'` as the sole real/synthetic-free success signal (`packages/
 * service-runtime/src/dispatcher.ts:68`) — reused verbatim, never
 * reinvented. The signed PCC artifact itself (`verify-and-sign.ts`) is
 * already produced INSIDE the executor (both production executors are
 * built with the same `signer`/`registry` `buildProductionSigner`
 * returns) — by the time `ExecutorOutcome` reaches this Workflow,
 * `result.receipt` IS the final signed PCC; this validator's only job is
 * the same closing structural gate the pre-Workflow request-local path
 * always applied before ever reaching a settle call.
 */
export const validateExecutorPcc: PccValidator = (outcome: ExecutorOutcome) => {
  if (outcome.result.result_class !== 'success') {
    return {
      valid: false,
      reason: outcome.result.failure?.code ?? outcome.result.result_class,
    };
  }
  if (!outcome.result.receipt) {
    return { valid: false, reason: 'missing_receipt' };
  }
  return { valid: true, pcc: outcome.result.receipt };
};

/** Real `JobStatePersistence` — thin adapter over the two real D1
 * repositories the pre-Workflow request-local path already used for
 * job-state transitions. Never reimplements the CAS/transition rules
 * themselves (`createStateEvent`/`isTerminal`/`getAllowedTransitions`,
 * all called by the pure orchestration function this only feeds). */
class D1JobStatePersistence implements JobStatePersistence {
  constructor(
    private readonly jobs: D1JobsRepository,
    private readonly stateEvents: D1StateEventsRepository
  ) {}

  async getJob(jobId: string): Promise<JobRecord | null> {
    const result = await this.jobs.getById(jobId);
    if (!result.ok || !result.value) return null;
    return {
      id: result.value.id,
      current_state: result.value.current_state,
      attempt_number: result.value.attempt_count,
    };
  }

  async appendStateEvent(
    event: Parameters<JobStatePersistence['appendStateEvent']>[0]
  ): Promise<void> {
    const result = await this.stateEvents.create(event);
    if (!result.ok) {
      throw new Error(`D1JobStatePersistence.appendStateEvent failed: ${result.error.code}`);
    }
  }

  async setCurrentState(
    jobId: string,
    state: Parameters<JobStatePersistence['setCurrentState']>[1]
  ): Promise<void> {
    const result = await this.jobs.updateState(jobId, state);
    if (!result.ok) {
      throw new Error(`D1JobStatePersistence.setCurrentState failed: ${result.error.code}`);
    }
  }
}

/** Real `ResultReceiptPersistence` — reuses the existing
 * `x402_service_results` table/repository (no new D1 schema, per
 * H2BF1's own constraint) via a read-before-write idempotency check,
 * since `X402ServiceResultRepository` itself has no CAS/UPSERT
 * primitive. `receiptId` is deterministic
 * (`receiptPersistenceIdempotencyKey`, an H2AWI-1 frozen helper reused
 * verbatim — never a random id, which would break idempotent re-entry). */
export class D1ResultReceiptPersistence implements ResultReceiptPersistence {
  constructor(private readonly results: X402ServiceResultRepository) {}

  async persistResult(
    input: Parameters<ResultReceiptPersistence['persistResult']>[0]
  ): Promise<{ status: 'written' | 'already_written' }> {
    const existing = await this.results.getByJobId(input.jobId);
    if (existing !== null) return { status: 'already_written' };
    await this.results.create(
      input.jobId,
      input.paymentIdentifier,
      input.cachedResult,
      new Date().toISOString()
    );
    return { status: 'written' };
  }

  async persistReceipt(
    input: Parameters<ResultReceiptPersistence['persistReceipt']>[0]
  ): Promise<{ status: 'written' | 'already_written'; receiptId: string }> {
    const receiptId = receiptPersistenceIdempotencyKey(input.paymentIdentifier);
    const existing = await this.results.getByJobId<
      Record<string, unknown> & {
        receipt_persisted?: boolean;
        durableEvidence?: Record<string, unknown>;
      }
    >(input.jobId);
    if (existing && existing.receipt_persisted === true) {
      return { status: 'already_written', receiptId };
    }
    // SUN-1221E6R-H2B2-R4: durably persist the actual signed PCC/receipt
    // document (`input.pcc`) alongside the completion marker, in the
    // same existing `result_json` column `finalize()` already writes to
    // -- no schema change. Before this fix only `{kind, receipt_persisted,
    // receipt_id}` was written and the real signed artifact was lost the
    // moment the Workflow instance's step-history output was truncated
    // by Cloudflare's API (proven in H2B2-R3A). `input.pcc` is optional
    // only so callers that never had a PCC to persist (defensive/legacy
    // paths) keep compiling; the real production call site always
    // supplies it once `pccResult.valid` is true, which is the only way
    // this step is ever reached.
    const finalRecord = existing
      ? {
          ...existing,
          receipt_persisted: true,
          receipt_id: receiptId,
          pcc: input.pcc ?? null,
          durableEvidence: {
            ...(existing.durableEvidence ?? {}),
            pcc: input.pcc ?? null,
          },
        }
      : {
          kind: 'workflow_receipt',
          receipt_persisted: true,
          receipt_id: receiptId,
          pcc: input.pcc ?? null,
        };
    await this.results.finalize(input.jobId, finalRecord, new Date().toISOString());
    return { status: 'written', receiptId };
  }
}

/**
 * Builds the real `PaidContinuationWorkflowDependencies` for exactly one
 * of the two real production services, from `this.env` alone — the only
 * thing a real `WorkflowEntrypoint.run()` ever has access to. Fails
 * closed (never throws, never falls back) for: an unsupported/unknown
 * `service`, a missing `PAYMENT_CONTINUATION_ENCRYPTION_KEY`, a missing
 * `DB` binding, or the underlying composition function reporting
 * `unavailable` (the exact same MODAL_WEBCTX_ / CDP / receipt-signing
 * gates the real HTTP routes already enforce — reused, never
 * re-implemented).
 *
 * SUN-1221E6R-H2BF4 — `env` is deliberately typed as the minimal
 * `PaidContinuationWorkflowHostEnv` (`Pick<Env, ...>`, defined in
 * `paid-continuation-workflow.ts`), not the full public-API `Env`. Every
 * field this function body dereferences below is a member of that Pick;
 * TypeScript itself is the proof no other `Env` field is (or can silently
 * become) a dependency of this function without a corresponding widening
 * of that Pick.
 */
export async function buildProductionPaidContinuationWorkflowDependencies(
  env: PaidContinuationWorkflowHostEnv,
  service: string
): Promise<PaidContinuationWorkflowDependencies | ProductionDependenciesUnavailable> {
  if (!SUPPORTED_SERVICES.has(service)) {
    return { unavailable: true, reason: `unsupported service: ${service}` };
  }
  if (!env.DB) {
    return { unavailable: true, reason: 'no D1 database binding supplied' };
  }
  if (!env.PAYMENT_CONTINUATION_ENCRYPTION_KEY) {
    return { unavailable: true, reason: 'PAYMENT_CONTINUATION_ENCRYPTION_KEY is missing' };
  }

  const routeConfig =
    service === 'web_context_verified.v2'
      ? await buildWebContextV2CdpProductionRouteConfig(
          {
            PAID_RECEIPT_SIGNING_PRIVATE_KEY: env.PAID_RECEIPT_SIGNING_PRIVATE_KEY,
            PAID_RECEIPT_SIGNING_KEY_ID: env.PAID_RECEIPT_SIGNING_KEY_ID,
            SELLER_WALLET_ADDRESS: env.SELLER_WALLET_ADDRESS,
            CDP_API_KEY_ID: env.CDP_API_KEY_ID,
            CDP_API_KEY_SECRET: env.CDP_API_KEY_SECRET,
            PAYMENT_ENVIRONMENT: env.PAYMENT_ENVIRONMENT,
            PRODUCTION_ENABLED: env.PRODUCTION_ENABLED,
            HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP: env.HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP,
            PRODUCTION_CDP_CREDENTIALS_APPROVED: env.PRODUCTION_CDP_CREDENTIALS_APPROVED,
            MODAL_WEBCTX_ENDPOINT_URL: env.MODAL_WEBCTX_ENDPOINT_URL,
            MODAL_WEBCTX_PROXY_KEY: env.MODAL_WEBCTX_PROXY_KEY,
            MODAL_WEBCTX_PROXY_SECRET: env.MODAL_WEBCTX_PROXY_SECRET,
          },
          env.DB
        )
      : await buildVerifyAgentOutputV2CdpProductionRouteConfig(
          {
            PAID_RECEIPT_SIGNING_PRIVATE_KEY: env.PAID_RECEIPT_SIGNING_PRIVATE_KEY,
            PAID_RECEIPT_SIGNING_KEY_ID: env.PAID_RECEIPT_SIGNING_KEY_ID,
            SELLER_WALLET_ADDRESS: env.SELLER_WALLET_ADDRESS,
            CDP_API_KEY_ID: env.CDP_API_KEY_ID,
            CDP_API_KEY_SECRET: env.CDP_API_KEY_SECRET,
            PAYMENT_ENVIRONMENT: env.PAYMENT_ENVIRONMENT,
            PRODUCTION_ENABLED: env.PRODUCTION_ENABLED,
            HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP: env.HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP,
            PRODUCTION_CDP_CREDENTIALS_APPROVED: env.PRODUCTION_CDP_CREDENTIALS_APPROVED,
          },
          env.DB
        );

  if ('unavailable' in routeConfig) {
    return { unavailable: true, reason: routeConfig.reason };
  }
  if (!routeConfig.evidenceProvider) {
    return { unavailable: true, reason: 'no production evidenceProvider resolved' };
  }

  const envelopeKey = await importContinuationEnvelopeKey(env.PAYMENT_CONTINUATION_ENCRYPTION_KEY);
  const paymentAttempts = new D1PaymentAttemptRepository(env.DB);
  const jobPersistence = new D1JobStatePersistence(
    new D1JobsRepository(env.DB),
    new D1StateEventsRepository(env.DB)
  );
  const resultReceiptPersistence = new D1ResultReceiptPersistence(
    new X402ServiceResultRepository(env.DB)
  );
  const chainReceiptChecker = buildProductionCdpChainReceiptChecker({
    productionRpcUrl: env.BASE_RPC_URL,
    preproductionRpcUrl: env.BASE_SEPOLIA_RPC_URL,
  });

  return {
    envelopeKey,
    clock: () => Math.floor(Date.now() / 1000),
    evidenceMode: 'production',
    executor: routeConfig.executor,
    validatePcc: validateExecutorPcc,
    settlement: {
      repository: paymentAttempts,
      evidenceProvider: routeConfig.evidenceProvider,
    },
    reconciliation: {
      checker: chainReceiptChecker,
      network: routeConfig.network,
    },
    persistence: {
      job: jobPersistence,
      resultReceipt: resultReceiptPersistence,
    },
  };
}
