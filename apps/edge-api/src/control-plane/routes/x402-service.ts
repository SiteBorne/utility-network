/**
 * The one reusable local x402 HTTP paid-service route boundary (SUN-0700A
 * checkpoint 5, directive §4). See docs/decisions/0051-
 * http-vertical-slice-architecture.md for the architecture and the
 * `@x402/hono` decision.
 *
 * `createX402ServiceRoute` owns: input validation against the frozen
 * contract schema, quote/requirement construction and persistence
 * (`X402QuoteRepository`), the 402 challenge, PAYMENT-SIGNATURE decoding,
 * Payment-Identifier acquisition against real D1
 * (`D1PaymentAttemptRepository`), the verification/settlement evidence
 * gates (checkpoint 3), driving the existing `JobState` lifecycle
 * (SUN-0200, never a second state machine), `PaymentServiceLink`
 * construction (checkpoint 3), retry reconstruction
 * (`X402ServiceResultRepository`), and the PAYMENT-RESPONSE. Per-service
 * variation is isolated entirely in the caller-supplied `ServiceExecutor`
 * callback — this module never imports a specific service or adapter.
 *
 * No facilitator, wallet, chain RPC, or live Bazaar/DID call exists
 * anywhere in this module — see apps/edge-api/tests/x402-service-route.
 * no-network coverage in that test file's own suite.
 */
import type { Context, Hono } from 'hono';
import Ajv2020 from 'ajv/dist/2020';
import type {
  Network,
  PaymentAttemptBinding,
  PaymentEvidenceContext,
  PaymentEvidenceMode,
  PaymentEvidenceProvider,
  PaymentPayload,
  PricingKey,
  Quote,
  SettleResponse,
  SiteborneServiceId,
} from '@siteborne/protocol-x402';
import {
  FixturePaymentEvidenceProvider,
  ProductionEvidenceProviderNotConfiguredError,
  SUPPORTED_X402_VERSION,
  acquirePaymentAttempt,
  bindingsAreIdentical,
  buildExactPaymentRequirement,
  buildPaymentRequired,
  buildPaymentServiceLink,
  buildQuote,
  buildUptoPaymentRequirement,
  buildUsageResult,
  canAdvanceToSettled,
  canAdvanceToVerified,
  declareSiteborneePaymentIdentifierSupport,
  decodePaymentSignatureHeaderSafe,
  encodePaymentRequiredHeaderSafe,
  encodePaymentResponseHeaderSafe,
  extendWithSettlement,
  hashPaymentObject,
  parsePaymentIdentifier,
  resolvePaymentEvidenceProvider,
  resolvePricingSourceVersion,
  resolveServiceMaxPriceUsd,
  usdToAtomicUnits,
  validatePaymentPayloadStructure,
  UsageExceedsAuthorizationError,
} from '@siteborne/protocol-x402';
import type { D1Database } from '@cloudflare/workers-types';
import { D1PaymentAttemptRepository } from '../repositories/d1/payment-attempts';
import { D1JobsRepository, D1StateEventsRepository } from '../repositories/d1/jobs';
import { D1AuditRepository } from '../repositories/d1/quota-audit-security';
import { X402QuoteRepository, X402ServiceResultRepository } from '../repositories/d1/x402-quotes';
import { createAuditEvent } from '../audit/events';
import { createStateEvent } from '../state-machine';
import type { JobState, TransitionReason } from '../types';
import type { Job } from '../types';

export interface ExecutorOutcome {
  /** The exact closed result @siteborne/service-runtime's
   * `executeLocalService` returned — never bypassed, never re-shaped. */
  result: {
    result_class: string;
    output?: unknown;
    output_hash?: string;
    receipt_id?: string;
    receipt?: unknown;
    failure?: { code: string; message: string };
  };
  /** Required when the route's scheme is `upto`: the atomic-unit actual
   * amount to charge, computed by the caller from the service's real
   * output metrics (e.g. document page count via
   * `src/pricing/document-usage.ts`) — this module never guesses or
   * derives it itself. */
  actualAmountAtomic?: string;
}

export type ServiceExecutor = (
  input: unknown,
  ctx: { job_id: string; request_id: string }
) => Promise<ExecutorOutcome>;

export interface X402ServiceRouteConfig {
  serviceId: SiteborneServiceId;
  scheme: 'exact' | 'upto';
  pricingKey: PricingKey;
  network: Network;
  asset: string;
  /** The real planned route path, from the accepted OpenAPI source —
   * never invented (directive §5). */
  path: string;
  inputSchema: Record<string, unknown>;
  executor: ServiceExecutor;
  contractRelease: string;
  inputSchemaHash: string;
  outputSchemaHash: string;
  pccDependency: string;
  db: D1Database;
  clock: () => string;
  /** SUN-0700A has no production wallet — defaults to a non-address-shaped
   * sentinel (directive §9); never a hardcoded value that looks like a
   * real production payee. */
  payTo?: string;
  paymentIdentifierRequired?: boolean;
  maxTimeoutSeconds?: number;
  quoteTtlSeconds?: number;
  paymentAttemptTtlMs?: number;
  /** Must never be `'production'` — `resolvePaymentEvidenceProvider`
   * throws immediately at construction time if it is, so a misconfigured
   * production attempt fails before the route can even be mounted
   * (directive §17, §32). */
  evidenceMode: PaymentEvidenceMode;
  evidenceProvider?: PaymentEvidenceProvider;
}

export const PAYTO_NOT_CONFIGURED = 'siteborne-fixture:payto-not-configured';

interface CachedResult {
  status: number;
  body: unknown;
  settleResponse: SettleResponse;
}

function jsonError(c: Context, status: number, code: string, message: string, details?: unknown) {
  return c.json(
    { error: code, message, ...(details !== undefined ? { details } : {}) },
    status as never
  );
}

/**
 * Builds and mounts one paid-service route on `app`. Throws immediately
 * (never mounts) if `config.evidenceMode === 'production'` — there is no
 * production evidence provider anywhere in SUN-0700A.
 */
export function createX402ServiceRoute(app: Hono, config: X402ServiceRouteConfig): void {
  // Fails closed at construction time, not per-request — a misconfigured
  // production evidence mode must never even reach the point of
  // accepting a request.
  const evidenceProvider = resolvePaymentEvidenceProvider(
    config.evidenceMode,
    config.evidenceProvider
  );

  const ajv = new Ajv2020({ strict: false });
  const validateInput = ajv.compile(config.inputSchema);

  const maxTimeoutSeconds = config.maxTimeoutSeconds ?? 60;
  const quoteTtlSeconds = config.quoteTtlSeconds ?? 300;
  const paymentAttemptTtlMs = config.paymentAttemptTtlMs ?? 5 * 60 * 1000;
  const paymentIdentifierRequired = config.paymentIdentifierRequired ?? true;

  app.post(config.path, async (c) => {
    const db = config.db;
    const nowIso = config.clock();

    const paymentAttempts = new D1PaymentAttemptRepository(db);
    const quotes = new X402QuoteRepository(db);
    const results = new X402ServiceResultRepository(db);
    const jobsRepo = new D1JobsRepository(db);
    const stateEventsRepo = new D1StateEventsRepository(db);
    const auditRepo = new D1AuditRepository(db);

    async function audit(type: string, details: Record<string, unknown>) {
      await auditRepo.create(
        createAuditEvent(type, { serviceId: config.serviceId, actor: 'SYSTEM', details })
      );
    }

    async function transition(
      jobId: string,
      from: JobState,
      to: JobState,
      reason: TransitionReason
    ): Promise<void> {
      const event = createStateEvent(jobId, 1, from, to, reason, 'SYSTEM');
      await stateEventsRepo.create(event);
      await jobsRepo.updateState(jobId, to);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return jsonError(c, 400, 'invalid_request', 'request body is not valid JSON');
    }

    if (!validateInput(body)) {
      return jsonError(
        c,
        400,
        'invalid_request',
        'input failed frozen-contract schema validation',
        {
          errors: validateInput.errors,
        }
      );
    }

    const inputHash = await hashPaymentObject(body as Record<string, unknown>);
    const resourceUrl = `${new URL(c.req.url).origin}${config.path}`;

    const sigHeader = c.req.header('PAYMENT-SIGNATURE');

    // ---------------------------------------------------------------
    // No PAYMENT-SIGNATURE: mint a quote/requirement, persist it, and
    // return the 402 challenge (directive §7-9).
    // ---------------------------------------------------------------
    if (!sigHeader) {
      const priceUsd = resolveServiceMaxPriceUsd(config.pricingKey);
      const amount = usdToAtomicUnits(priceUsd, 6);
      const pricingSourceVersion = resolvePricingSourceVersion();
      const expiresAt = new Date(new Date(nowIso).getTime() + quoteTtlSeconds * 1000).toISOString();

      const quote: Quote = await buildQuote({
        x402_version: SUPPORTED_X402_VERSION,
        service_id: config.serviceId,
        service_version: 'v1',
        contract_release: config.contractRelease,
        input_hash: inputHash,
        pricing_key: config.pricingKey,
        pricing_source_version: pricingSourceVersion,
        scheme: config.scheme,
        network: config.network,
        asset: config.asset,
        amount,
        payee: config.payTo ?? PAYTO_NOT_CONFIGURED,
        issued_at: nowIso,
        expires_at: expiresAt,
      });

      const built =
        config.scheme === 'exact'
          ? await buildExactPaymentRequirement({
              quote,
              resource_id: resourceUrl,
              maxTimeoutSeconds,
            })
          : await buildUptoPaymentRequirement({
              quote,
              resource_id: resourceUrl,
              maxTimeoutSeconds,
            });

      await quotes.create(quote, built.requirement, built.requirement_id, resourceUrl);

      const challenge = buildPaymentRequired({
        resource: { url: resourceUrl },
        accepts: [built.requirement],
        extensions: declareSiteborneePaymentIdentifierSupport(paymentIdentifierRequired),
      });
      c.header('PAYMENT-REQUIRED', encodePaymentRequiredHeaderSafe(challenge));
      await audit('payment_required_created', { quote_id: quote.quote_id, resource: resourceUrl });

      return c.json(
        {
          error: 'payment_required',
          x402_version: SUPPORTED_X402_VERSION,
          quote_id: quote.quote_id,
        },
        402
      );
    }

    // ---------------------------------------------------------------
    // PAYMENT-SIGNATURE present: decode, validate, acquire replay slot.
    // ---------------------------------------------------------------
    const decoded = decodePaymentSignatureHeaderSafe(sigHeader);
    if (!decoded.ok) {
      await audit('payment_payload_received', { valid: false, reason: decoded.reason });
      return jsonError(c, 400, 'malformed_payment_signature', decoded.reason, decoded.detail);
    }
    const payload: PaymentPayload = decoded.value;
    await audit('payment_payload_received', { valid: true });

    const quoteId = (payload.accepted?.extra as Record<string, unknown> | undefined)?.[
      'quote_id'
    ] as string | undefined;
    if (!quoteId) {
      return jsonError(c, 400, 'malformed_payment_signature', 'accepted.extra.quote_id is missing');
    }
    const stored = await quotes.getById(quoteId);
    if (!stored) {
      return jsonError(
        c,
        402,
        'expired_quote',
        'no such quote (unknown, or never issued by this route)'
      );
    }
    if (new Date(nowIso).getTime() >= new Date(stored.quote.expires_at).getTime()) {
      return jsonError(c, 402, 'expired_quote', 'quote has expired');
    }

    const structResult = validatePaymentPayloadStructure(payload, {
      quote: stored.quote,
      resource_id: resourceUrl,
      now_iso: nowIso,
    });
    if (structResult.status !== 'valid_structure') {
      return jsonError(c, 400, 'invalid_payment_structure', structResult.status);
    }

    const idResult = parsePaymentIdentifier(payload, paymentIdentifierRequired);
    if (idResult.status !== 'present') {
      return jsonError(c, 400, 'malformed_payment_signature', idResult.status);
    }
    const paymentIdentifier = idResult.id;

    const binding: PaymentAttemptBinding = {
      payment_identifier: paymentIdentifier,
      quote_id: stored.quote.quote_id,
      requirement_id: stored.requirement_id,
      service_id: config.serviceId,
      service_version: 'v1',
      contract_release: config.contractRelease,
      request_input_hash: inputHash,
      resource_id: resourceUrl,
      scheme: config.scheme,
      network: config.network,
      asset: config.asset,
      amount: stored.quote.amount,
      payee: stored.quote.payee,
    };

    const acquireOutcome = await acquirePaymentAttempt(paymentAttempts, {
      binding,
      nowIso,
      ttlMs: paymentAttemptTtlMs,
    });

    async function reconstructFromJob(): Promise<Response | null> {
      const jobResult = await jobsRepo.getByIdempotencyKey(paymentIdentifier);
      if (!jobResult.ok || !jobResult.value) return null;
      const job = jobResult.value;
      if (job.current_state !== 'DELIVERED') return null;
      const cached = await results.getByJobId<CachedResult>(job.id);
      if (!cached) return null;
      c.header('PAYMENT-RESPONSE', encodePaymentResponseHeaderSafe(cached.settleResponse));
      return c.json(cached.body, cached.status as never);
    }

    if (acquireOutcome.status === 'repository_error') {
      return jsonError(c, 500, 'repository_failure', acquireOutcome.reason);
    }
    if (acquireOutcome.status === 'expired') {
      return jsonError(c, 402, 'expired_quote', 'payment identifier has expired');
    }
    if (acquireOutcome.status === 'duplicate_conflict') {
      await audit('payment_replay_rejected', {
        payment_identifier: paymentIdentifier,
        reason: 'duplicate_conflict',
      });
      return jsonError(
        c,
        409,
        'replay_conflict',
        'payment identifier already bound to a different immutable request binding'
      );
    }
    if (acquireOutcome.status === 'already_consumed') {
      // A consumed identifier reused with a DIFFERENT immutable binding
      // is a conflict, never a legitimate retry — `acquirePaymentAttempt`
      // itself checks `consumed` before comparing bindings (checkpoint 2
      // semantics: an already-fulfilled identifier is `already_consumed`
      // regardless of what a later candidate binding claims), so this
      // route must do its own binding-match check before ever returning
      // the original result (directive §12: "No conflicting request may
      // obtain the original service result").
      if (!bindingsAreIdentical(acquireOutcome.existing.binding, binding)) {
        await audit('payment_replay_rejected', {
          payment_identifier: paymentIdentifier,
          reason: 'consumed_binding_conflict',
        });
        return jsonError(
          c,
          409,
          'replay_conflict',
          'payment identifier already consumed by a different immutable request binding'
        );
      }
      const reconstructed = await reconstructFromJob();
      if (reconstructed) return reconstructed;
      await audit('payment_replay_rejected', {
        payment_identifier: paymentIdentifier,
        reason: 'already_consumed_result_missing',
      });
      return jsonError(
        c,
        409,
        'already_consumed',
        'payment identifier already consumed and no result could be reconstructed'
      );
    }
    if (acquireOutcome.status === 'duplicate_same') {
      const reconstructed = await reconstructFromJob();
      if (reconstructed) return reconstructed;
      // Same legitimate retry, but the original request has not finished
      // processing yet (directive §13) — never a second execution.
      return c.json({ status: 'processing', payment_identifier: paymentIdentifier }, 202);
    }

    // ---------------------------------------------------------------
    // first_seen: create exactly one logical job and drive it through
    // the existing JobState lifecycle (SUN-0200) — never a second state
    // machine.
    // ---------------------------------------------------------------
    const jobId = crypto.randomUUID();
    const requestId = crypto.randomUUID();
    const job: Job = {
      id: jobId,
      request_id: requestId,
      service_id: config.serviceId,
      service_version: 'v1',
      input_hash: inputHash,
      input_schema_hash: config.inputSchemaHash,
      output_schema_hash: config.outputSchemaHash,
      idempotency_key: paymentIdentifier,
      contract_release: config.contractRelease,
      pcc_dependency: config.pccDependency,
      current_state: 'RECEIVED',
      created_at: nowIso,
      updated_at: nowIso,
      expires_at: stored.quote.expires_at,
      attempt_count: 1,
      production_enabled: false,
    };
    const createResult = await jobsRepo.create(job);
    if (!createResult.ok) {
      return jsonError(c, 500, 'repository_failure', createResult.error.message);
    }
    await audit('job_created', { job_id: jobId, payment_identifier: paymentIdentifier });

    // These first three transitions record, retroactively, facts already
    // established before this job existed (the input was already schema
    // validated; the quote was already minted and the 402 already sent
    // in an earlier request) — Cloudflare Workers are stateless
    // per-request, so no job could exist until the buyer's retry arrived.
    await transition(jobId, 'RECEIVED', 'VALIDATED', 'VALIDATION_PASSED');
    await transition(jobId, 'VALIDATED', 'QUOTED', 'QUOTE_GENERATED');
    await transition(jobId, 'QUOTED', 'PAYMENT_CHALLENGED', 'PAYMENT_REQUIRED');

    const evidenceContext: PaymentEvidenceContext = {
      service_id: config.serviceId,
      service_version: 'v1',
      scheme: config.scheme,
      network: config.network,
      asset: config.asset,
      payee: stored.quote.payee,
      quote_id: stored.quote.quote_id,
      requirement_id: stored.requirement_id,
      payment_identifier: paymentIdentifier,
      amount: stored.quote.amount,
      nowIso,
      expiresAt: stored.quote.expires_at,
    };

    const verificationEvidence = await evidenceProvider.verify(evidenceContext);
    await audit('payment_verification_requested', { payment_identifier: paymentIdentifier });
    const verifyGate = canAdvanceToVerified(
      verificationEvidence,
      evidenceContext,
      config.evidenceMode
    );
    if (!verifyGate.allowed) {
      await transition(jobId, 'PAYMENT_CHALLENGED', 'PAYMENT_FAILED', 'PAYMENT_FAILED');
      await transition(jobId, 'PAYMENT_FAILED', 'REJECTED', 'RETRY_EXHAUSTED');
      await paymentAttempts.transitionLifecycleStage(
        paymentIdentifier,
        'acquired',
        'verification_failed'
      );
      await audit('payment_verification_failed', {
        payment_identifier: paymentIdentifier,
        reason: verifyGate.reason,
      });
      return jsonError(c, 402, 'payment_verification_rejected', verifyGate.reason);
    }
    await transition(jobId, 'PAYMENT_CHALLENGED', 'PAYMENT_VERIFIED', 'PAYMENT_VERIFIED');
    await paymentAttempts.transitionLifecycleStage(paymentIdentifier, 'acquired', 'verified');
    await audit('payment_verified', { payment_identifier: paymentIdentifier });

    await transition(jobId, 'PAYMENT_VERIFIED', 'LOCKED', 'RESOURCE_LOCKED');
    await transition(jobId, 'LOCKED', 'ROUTED', 'ROUTED_TO_WORKER');
    await transition(jobId, 'ROUTED', 'EXECUTING', 'EXECUTION_STARTED');
    await audit('service_execution_started', { job_id: jobId });

    let outcome: ExecutorOutcome;
    try {
      outcome = await config.executor(body, { job_id: jobId, request_id: requestId });
    } catch (e) {
      await transition(jobId, 'EXECUTING', 'QUARANTINED', 'EXECUTION_FAILED');
      await transition(jobId, 'QUARANTINED', 'REJECTED', 'QUARANTINE_POLICY');
      return jsonError(
        c,
        500,
        'service_execution_failed',
        e instanceof Error ? e.message : String(e)
      );
    }

    if (
      outcome.result.result_class !== 'success' ||
      !outcome.result.receipt ||
      !outcome.result.output_hash ||
      !outcome.result.receipt_id
    ) {
      await transition(jobId, 'EXECUTING', 'QUARANTINED', 'EXECUTION_FAILED');
      await transition(jobId, 'QUARANTINED', 'REJECTED', 'QUARANTINE_POLICY');
      return jsonError(
        c,
        502,
        'service_execution_failed',
        outcome.result.failure?.message ?? `result_class=${outcome.result.result_class}`
      );
    }
    await transition(jobId, 'EXECUTING', 'VERIFYING', 'EXECUTION_COMPLETED');
    await audit('service_execution_completed', {
      job_id: jobId,
      result_class: outcome.result.result_class,
    });

    let actualAmount = stored.quote.amount;
    let usageResultHash: string | undefined;
    if (config.scheme === 'upto') {
      if (!outcome.actualAmountAtomic) {
        await transition(jobId, 'VERIFYING', 'REJECTED', 'VERIFICATION_FAILED');
        return jsonError(
          c,
          500,
          'service_execution_failed',
          'upto executor did not report actualAmountAtomic'
        );
      }
      actualAmount = outcome.actualAmountAtomic;
      try {
        const usageResult = await buildUsageResult({
          quote_id: stored.quote.quote_id,
          requirement_id: stored.requirement_id,
          payment_identifier: paymentIdentifier,
          service_id: config.serviceId,
          service_version: 'v1',
          request_input_hash: inputHash,
          service_output_hash: outcome.result.output_hash,
          verification_receipt_id: outcome.result.receipt_id,
          resource_metrics_hash: await hashPaymentObject({ actual_amount: actualAmount }),
          actual_amount: actualAmount,
          authorized_maximum: stored.quote.amount,
        });
        usageResultHash = usageResult.usage_result_hash;
      } catch (e) {
        if (e instanceof UsageExceedsAuthorizationError) {
          await transition(jobId, 'VERIFYING', 'REJECTED', 'VERIFICATION_FAILED');
          await audit('payment_verification_failed', {
            payment_identifier: paymentIdentifier,
            reason: 'authorization_exceeded',
          });
          return jsonError(c, 402, 'authorization_exceeded', e.message);
        }
        throw e;
      }
    }

    await transition(jobId, 'VERIFYING', 'SETTLING', 'VERIFICATION_PASSED');
    await audit('payment_settlement_requested', { payment_identifier: paymentIdentifier });

    const verificationEvidenceHash = await hashPaymentObject(verificationEvidence);
    const settlementEvidence = await evidenceProvider.settle(
      evidenceContext,
      verificationEvidence,
      actualAmount
    );
    const settleGate = canAdvanceToSettled(
      settlementEvidence,
      evidenceContext,
      config.evidenceMode,
      verificationEvidenceHash
    );
    if (!settleGate.allowed) {
      await transition(jobId, 'SETTLING', 'REFUND_REQUIRED', 'REFUND_INITIATED');
      await paymentAttempts.transitionLifecycleStage(
        paymentIdentifier,
        'verified',
        'settlement_failed'
      );
      await audit('settlement_failed', {
        payment_identifier: paymentIdentifier,
        reason: settleGate.reason,
      });
      return jsonError(c, 402, 'settlement_rejected', settleGate.reason);
    }
    await transition(jobId, 'SETTLING', 'DELIVERED', 'SETTLEMENT_COMPLETE');
    await paymentAttempts.transitionLifecycleStage(paymentIdentifier, 'verified', 'settled');
    await paymentAttempts.markConsumed(paymentIdentifier);
    await audit('payment_settled', { payment_identifier: paymentIdentifier });

    const receiptHash = await hashPaymentObject(outcome.result.receipt as Record<string, unknown>);
    let link = await buildPaymentServiceLink({
      payment_identifier: paymentIdentifier,
      quote_id: stored.quote.quote_id,
      requirement_id: stored.requirement_id,
      service_id: config.serviceId,
      service_version: 'v1',
      request_input_hash: inputHash,
      job_id: jobId,
      service_output_hash: outcome.result.output_hash,
      verification_receipt_id: outcome.result.receipt_id,
      verification_receipt_hash: receiptHash,
      verification_evidence_hash: verificationEvidenceHash,
      ...(usageResultHash ? { usage_result_hash: usageResultHash } : {}),
    });
    const settlementEvidenceHash = await hashPaymentObject(settlementEvidence);
    link = await extendWithSettlement(link, settlementEvidenceHash);

    const responseBody = {
      service_id: config.serviceId,
      result_class: outcome.result.result_class,
      output: outcome.result.output,
      receipt_id: outcome.result.receipt_id,
      link_id: link.link_id,
      link_hash: link.link_hash,
      ...(config.scheme === 'upto'
        ? { authorized_maximum: stored.quote.amount, actual_amount: actualAmount }
        : {}),
    };

    const settleResponse: SettleResponse = {
      success: true,
      transaction: settlementEvidence.transaction_reference ?? 'synthetic-tx:unknown',
      network: config.network,
      payer: 'synthetic:buyer',
      amount: actualAmount,
      extra: { link_id: link.link_id, payment_identifier: paymentIdentifier },
    };

    await results.create(
      jobId,
      paymentIdentifier,
      { status: 200, body: responseBody, settleResponse },
      nowIso
    );
    await audit('payment_consumed', { payment_identifier: paymentIdentifier, job_id: jobId });

    c.header('PAYMENT-RESPONSE', encodePaymentResponseHeaderSafe(settleResponse));
    return c.json(responseBody, 200);
  });
}

export { ProductionEvidenceProviderNotConfiguredError, FixturePaymentEvidenceProvider };
