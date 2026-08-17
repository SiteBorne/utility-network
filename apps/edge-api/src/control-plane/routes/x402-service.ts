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
import { buildPaymentRequired as buildNeverminedSdkPaymentRequired } from '@nevermined-io/payments';
import {
  NEVERMINED_DECLARATIONS,
  NEVERMINED_PAYMENT_PROVIDER,
  PAYMENT_DELEGATION_ID_HEADER,
  PAYMENT_IDENTIFIER_HEADER,
  bindNeverminedPaymentRequired,
  encodeNeverminedPaymentRequiredHeaderSafe,
  encodeNeverminedPaymentResponseHeaderSafe,
  parseNeverminedDelegationId,
  parseNeverminedPaymentIdentifier,
  readNeverminedSettlementObservation,
  reconcileNeverminedSettlementForRecovery,
  validateNeverminedAccessToken,
  validateNeverminedPaymentRequired,
  type NeverminedDelegationLookupClient,
  type NeverminedPaymentRequired,
  type NeverminedPaymentResponse,
} from '@siteborne/protocol-nevermined';
import type {
  Network,
  PaymentAttemptBinding,
  PaymentEvidenceContext,
  PaymentEvidenceMode,
  PaymentEvidenceProvider,
  PaymentPayload,
  PaymentServiceLink,
  PaymentSettlementContext,
  PaymentVerificationContext,
  PricingKey,
  Quote,
  SettleResponse,
  SiteborneServiceId,
  UsageResult,
} from '@siteborne/protocol-x402';
import {
  CDP_PAYMENT_PROVIDER,
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
  verifyPaymentServiceLink,
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
    verification?: unknown;
    failure?: { code: string; message: string };
  };
  /** Required when the route's scheme is `upto`: the atomic-unit actual
   * amount to charge, computed by the caller from the service's real
   * output metrics (e.g. document page count via
   * `src/pricing/document-usage.ts`) — this module never guesses or
   * derives it itself. */
  actualAmountAtomic?: string;
  /** Required for `upto`: the deterministic measured metrics used by
   * @siteborne/pricing to derive `actualAmountAtomic`. */
  resourceMetrics?: Record<string, unknown>;
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
  /** Official scheme/asset metadata carried in PaymentRequirements.extra
   * (for example an EVM token's EIP-712 domain name/version). The route
   * remains protocol-generic; its CDP/EVM integration supplies values
   * from the official x402 implementation rather than duplicating them. */
  paymentRequirementExtra?: Record<string, unknown>;
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
  /** Defaults to CDP for the accepted open routes. Nevermined is selected
   * explicitly by its dedicated route family and never by fallback. */
  rail?: 'cdp' | 'nevermined';
  nevermined?: { agentId: string; planId: string };
  /** Optional, Nevermined-only (SUN-0900B checkpoint 1B route-recovery
   * wiring): enables restart recovery for a payment stuck in
   * `SETTLEMENT_PENDING`. When omitted, a `duplicate_same` retry against a
   * payment that never reached `DELIVERED` still falls through to the
   * pre-existing `202 processing` response — never a regression, just no
   * automatic recovery. */
  neverminedReconciliationClient?: NeverminedDelegationLookupClient;
}

export const PAYTO_NOT_CONFIGURED = 'siteborne-fixture:payto-not-configured';

interface CachedResult {
  status: number;
  body: unknown;
  settleResponse: SettleResponse | NeverminedPaymentResponse;
  durableEvidence?: {
    usage_result?: UsageResult;
    pcc?: unknown;
    receipt?: unknown;
    settlement_evidence: unknown;
    payment_service_link: PaymentServiceLink;
  };
}

/** Durably persisted (`X402ServiceResultRepository.createPending`)
 * BEFORE a real Nevermined settle call is ever made — everything a crash
 * recovery needs to reconstruct the exact same response a normal
 * synchronous success would have produced, without re-executing the
 * service or re-deriving hashes non-deterministically. `kind` is a
 * discriminant so `attemptNeverminedRecovery` never misinterprets a
 * pre-recovery-era or CDP-shaped cached row as a recoverable draft. */
interface PendingNeverminedSettlementDraft {
  kind: 'nevermined_settlement_pending_draft';
  quote_id: string;
  requirement_id: string;
  request_input_hash: string;
  output: unknown;
  output_hash: string;
  receipt_id: string;
  receipt_hash: string;
  receipt: unknown;
  pcc?: unknown;
  verification_evidence: { payer?: string };
  verification_evidence_hash: string;
  actual_amount: string;
  usage_result_hash?: string;
  usage_result?: UsageResult;
  scheme: 'exact' | 'upto';
  authorized_maximum: string;
}

export class NeverminedEvidenceProviderNotConfiguredError extends Error {
  constructor() {
    super('Nevermined route requires an explicitly selected Nevermined evidence provider');
    this.name = 'NeverminedEvidenceProviderNotConfiguredError';
  }
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
  const rail = config.rail ?? 'cdp';
  if (rail === 'nevermined' && (!config.nevermined || !config.evidenceProvider)) {
    throw new NeverminedEvidenceProviderNotConfiguredError();
  }
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

    // SUN-1000 checkpoint 1M: a real, previously-undiscovered 500 defect
    // Schemathesis's fuzzing phase found (not a v2-specific issue — this
    // shared route boundary is used by both v1 and v2, and the bug was
    // latent for v1 too, simply never exercised by fuzzing before now).
    // JSON Schema validation above accepts any in-range `number`/
    // `integer`, but JCS canonicalization (hashPaymentObject ->
    // canonicalize) enforces the stricter safe-integer bound the PCC
    // signing spec requires and throws on an out-of-range value —
    // previously an uncaught exception escaping as an unhandled 500.
    // Caught here the same way malformed JSON is, immediately above:
    // a real, honest 400, not a crash.
    let inputHash: string;
    try {
      inputHash = await hashPaymentObject(body as Record<string, unknown>);
    } catch (err) {
      return jsonError(
        c,
        400,
        'invalid_request',
        'input failed canonical-hash validation (a numeric value is outside the safe canonicalization range)',
        { error: String(err) }
      );
    }
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
        service_version: config.serviceId.endsWith('.v2') ? 'v2' : 'v1',
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

      let requirementId: string;
      if (rail === 'nevermined') {
        const declaration = NEVERMINED_DECLARATIONS[config.serviceId];
        const official = buildNeverminedSdkPaymentRequired(config.nevermined!.planId, {
          endpoint: resourceUrl,
          agentId: config.nevermined!.agentId,
          httpVerb: 'POST',
          network: config.network,
          description: declaration.agent.description,
          mimeType: 'application/json',
        }) as NeverminedPaymentRequired;
        const built = await bindNeverminedPaymentRequired(official, {
          serviceId: config.serviceId,
          route: resourceUrl,
          quoteId: quote.quote_id,
          amount,
          semantics: config.scheme,
          expiresAt,
          paymentIdentifierRequired,
        });
        requirementId = built.requirementId;
        await quotes.create(quote, built.paymentRequired, built.requirementId, resourceUrl);
        c.header(
          'PAYMENT-REQUIRED',
          encodeNeverminedPaymentRequiredHeaderSafe(built.paymentRequired)
        );
      } else {
        const built =
          config.scheme === 'exact'
            ? await buildExactPaymentRequirement({
                quote,
                resource_id: resourceUrl,
                maxTimeoutSeconds,
                extra: config.paymentRequirementExtra,
              })
            : await buildUptoPaymentRequirement({
                quote,
                resource_id: resourceUrl,
                maxTimeoutSeconds,
                extra: config.paymentRequirementExtra,
              });
        requirementId = built.requirement_id;
        await quotes.create(quote, built.requirement, built.requirement_id, resourceUrl);
        const challenge = buildPaymentRequired({
          resource: { url: resourceUrl },
          accepts: [built.requirement],
          extensions: declareSiteborneePaymentIdentifierSupport(paymentIdentifierRequired),
        });
        c.header('PAYMENT-REQUIRED', encodePaymentRequiredHeaderSafe(challenge));
      }
      await audit('payment_required_created', { quote_id: quote.quote_id, resource: resourceUrl });

      return c.json(
        {
          error: 'payment_required',
          x402_version: SUPPORTED_X402_VERSION,
          quote_id: quote.quote_id,
          requirement_id: requirementId,
        },
        402
      );
    }

    // ---------------------------------------------------------------
    // PAYMENT-SIGNATURE present: validate the selected rail's transport,
    // recover the exact persisted requirement, then acquire D1 before any
    // provider verification or useful service execution.
    // ---------------------------------------------------------------
    let payload: PaymentPayload | undefined;
    let neverminedRequired: NeverminedPaymentRequired | undefined;
    let paymentIdentifier: string;
    let neverminedDelegationId: string | undefined;
    let stored: NonNullable<Awaited<ReturnType<X402QuoteRepository['getById']>>>;

    if (rail === 'nevermined') {
      const token = validateNeverminedAccessToken(sigHeader);
      if (token.status !== 'valid') {
        await audit('payment_payload_received', { valid: false, reason: token.status });
        return jsonError(c, 400, 'malformed_payment_signature', token.status);
      }
      // The buyer must disclose the same delegation their access token is
      // bound to (SUN-0900B checkpoint 1B route-recovery wiring) — the
      // opaque token itself carries no correlation the seller can read
      // back, confirmed against the installed SDK's own types. Validated
      // before any provider call and bound into the immutable v2 binding
      // below, so a reused Payment-Identifier with a different delegation
      // is `duplicate_conflict`, never silently accepted. Not
      // authorization evidence: never sent to the facilitator, only used
      // to reconcile a crash-recovered payment via read-only calls.
      const delegationResult = parseNeverminedDelegationId(
        c.req.header(PAYMENT_DELEGATION_ID_HEADER)
      );
      if (delegationResult.status !== 'present') {
        return jsonError(c, 400, 'malformed_payment_delegation_id', delegationResult.status);
      }
      neverminedDelegationId = delegationResult.id;
      const idResult = parseNeverminedPaymentIdentifier(
        c.req.header(PAYMENT_IDENTIFIER_HEADER),
        sigHeader
      );
      if (idResult.status !== 'present') {
        return jsonError(c, 400, 'malformed_payment_identifier', idResult.status);
      }
      paymentIdentifier = idResult.id;
      const found = await quotes.getLatestForBinding(config.serviceId, resourceUrl, inputHash);
      if (!found) {
        return jsonError(c, 402, 'expired_quote', 'no server-issued quote matches this request');
      }
      stored = found;
      const validation = validateNeverminedPaymentRequired(stored.requirement, {
        resource: resourceUrl,
        network: config.network,
        agentId: config.nevermined!.agentId,
        planId: config.nevermined!.planId,
        serviceId: config.serviceId,
        quoteId: stored.quote.quote_id,
        requirementId: stored.requirement_id,
        amount: stored.quote.amount,
        semantics: config.scheme,
        expiresAt: stored.quote.expires_at,
      });
      if (!validation.valid) {
        return jsonError(c, 400, 'invalid_payment_structure', validation.reason);
      }
      neverminedRequired = validation.paymentRequired;
      await audit('payment_payload_received', { valid: true, rail });
    } else {
      const decoded = decodePaymentSignatureHeaderSafe(sigHeader);
      if (!decoded.ok) {
        await audit('payment_payload_received', { valid: false, reason: decoded.reason });
        return jsonError(c, 400, 'malformed_payment_signature', decoded.reason, decoded.detail);
      }
      payload = decoded.value;
      await audit('payment_payload_received', { valid: true, rail });

      const quoteId = (payload.accepted?.extra as Record<string, unknown> | undefined)?.[
        'quote_id'
      ] as string | undefined;
      if (!quoteId) {
        return jsonError(
          c,
          400,
          'malformed_payment_signature',
          'accepted.extra.quote_id is missing'
        );
      }
      const found = await quotes.getById(quoteId);
      if (!found) {
        return jsonError(
          c,
          402,
          'expired_quote',
          'no such quote (unknown, or never issued by this route)'
        );
      }
      stored = found;
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
      paymentIdentifier = idResult.id;
    }
    if (new Date(nowIso).getTime() >= new Date(stored.quote.expires_at).getTime()) {
      return jsonError(c, 402, 'expired_quote', 'quote has expired');
    }

    const binding: PaymentAttemptBinding = {
      binding_version: 2,
      payment_rail: rail,
      payment_provider: rail === 'nevermined' ? NEVERMINED_PAYMENT_PROVIDER : CDP_PAYMENT_PROVIDER,
      ...(rail === 'nevermined'
        ? {
            nevermined_agent_id: config.nevermined!.agentId,
            nevermined_plan_id: config.nevermined!.planId,
            nevermined_delegation_id: neverminedDelegationId!,
          }
        : {}),
      payment_identifier: paymentIdentifier,
      quote_id: stored.quote.quote_id,
      requirement_id: stored.requirement_id,
      service_id: config.serviceId,
      service_version: config.serviceId.endsWith('.v2') ? 'v2' : 'v1',
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

    /**
     * `requireDelivered` (SUN-0900B checkpoint 1B, replay-reconstruction
     * repair): the pre-existing, still-correct default for a
     * `duplicate_same` retry — the payment isn't independently known to be
     * consumed yet, so `job.current_state === 'DELIVERED'` is the only
     * signal that the original request actually finished (directive §13:
     * never reconstruct a still-processing request as if it had).
     *
     * `false` is used only from the `already_consumed` branch, where
     * `acquirePaymentAttempt`'s own `consumed` check (backed by
     * `payment_attempts.consumed_at IS NOT NULL`) has ALREADY
     * authoritatively established the payment is done — independently of
     * whatever state the `Job` record happens to be in. Requiring
     * `DELIVERED` on top of that was over-strict: a payment recovered via
     * `attemptNeverminedRecovery`'s `settlement_failed -> settled_external`
     * edge (this same checkpoint, `829354f`) is marked `consumed` but its
     * `Job` deliberately stays at `REFUND_REQUIRED` forever (the frozen
     * JobState machine has no `REFUND_REQUIRED -> DELIVERED` edge) — under
     * the old unconditional check, an already-paid, already-consumed,
     * already-linked payment could never be replayed, which is exactly
     * the `REPLAY_BLOCKED_BY_JOB_STATE_DEPENDENCY` defect this fixes.
     * `payment_attempts.consumed_at` (via `acquirePaymentAttempt`) — not
     * `Job.current_state` — is the payment-idempotency authority; the two
     * are related but not interchangeable (see the `x402_service_results`
     * `kind` discriminant check below for the other half of this fix).
     */
    async function reconstructFromJob(
      options: { requireDelivered: boolean } = { requireDelivered: true }
    ): Promise<Response | null> {
      const jobResult = await jobsRepo.getByIdempotencyKey(paymentIdentifier);
      if (!jobResult.ok || !jobResult.value) return null;
      const job = jobResult.value;
      if (options.requireDelivered && job.current_state !== 'DELIVERED') return null;
      const cached = await results.getByJobId<CachedResult>(job.id);
      if (!cached) return null;
      if (
        typeof cached === 'object' &&
        cached !== null &&
        'kind' in cached &&
        (cached as { kind?: unknown }).kind === 'nevermined_settlement_pending_draft'
      ) {
        // The durable pre-settle draft `createPending` writes, never
        // finalized (a crash landed exactly between `markConsumed` and
        // `results.finalize`, or `finalize` itself hasn't run yet) — this
        // is NOT the shape a caller of `reconstructFromJob` expects
        // (`CachedResult`'s `status`/`body`/`settleResponse`). Never
        // reconstruct from it; the caller's own fallback (409
        // `already_consumed_result_missing`, or 202 `processing`) is the
        // correct, honest response here.
        return null;
      }
      c.header(
        'PAYMENT-RESPONSE',
        rail === 'nevermined'
          ? encodeNeverminedPaymentResponseHeaderSafe(
              cached.settleResponse as NeverminedPaymentResponse
            )
          : encodePaymentResponseHeaderSafe(cached.settleResponse as SettleResponse)
      );
      return c.json(cached.body, cached.status as never);
    }

    /**
     * SUN-0900B checkpoint 1B route-recovery wiring: reached only for a
     * `duplicate_same` retry on the Nevermined rail with a configured
     * reconciliation client. Reconciles the durable `SETTLEMENT_PENDING`
     * correlation state externally, BEFORE ever falling through to a
     * new verify/execute/settle attempt — this route never re-verifies,
     * re-executes, or re-settles a payment it finds here (directive
     * requirement: "never auto-settle within the same reconciliation
     * function"). Returns `null` (never an HTTP response) for every
     * outcome except a positively-confirmed, context-matching `SETTLED`
     * recovery, so the caller's pre-existing `reconstructFromJob`/`202`
     * fallback is always safe to run next.
     */
    async function attemptNeverminedRecovery(): Promise<Response | null> {
      if (rail !== 'nevermined' || !config.neverminedReconciliationClient) return null;
      const recovery = await paymentAttempts.getSettlementRecoveryRecord(paymentIdentifier);
      if (!recovery) return null;
      // `settlement_failed` is included ONLY for the narrow, evidence-gated
      // historical-false-rejection recovery (SUN-0900B checkpoint 1B,
      // third real-live-run incident — see `stage.ts`'s
      // `settlement_failed -> settled_external` edge doc comment for the
      // full reasoning). This function itself is the sole caller that
      // ever presents that transition, and only after the exact same
      // `SETTLED` reconciliation proof required for the normal
      // `settlement_pending` recovery path below — no row reaches
      // `settled_external` here on weaker evidence merely because it
      // started at `settlement_failed` instead of `settlement_pending`.
      if (
        recovery.lifecycleStage !== 'settlement_pending' &&
        recovery.lifecycleStage !== 'settlement_failed'
      ) {
        return null;
      }
      if (!recovery.neverminedDelegationId) return null; // no correlation key — nothing to reconcile
      const jobResult = await jobsRepo.getByIdempotencyKey(paymentIdentifier);
      if (!jobResult.ok || !jobResult.value) return null;
      const job = jobResult.value;
      const draft = await results.getByJobId<PendingNeverminedSettlementDraft>(job.id);
      if (!draft || draft.kind !== 'nevermined_settlement_pending_draft') return null;

      const reconciliation = await reconcileNeverminedSettlementForRecovery(
        config.neverminedReconciliationClient,
        recovery.neverminedDelegationId,
        {
          planId: config.nevermined!.planId,
          provider: 'erc4337',
          currency: 'usdc',
          payer: draft.verification_evidence.payer,
        }
      );
      await audit('payment_recovery_reconciled', {
        payment_identifier: paymentIdentifier,
        state: reconciliation.state,
      });
      if (reconciliation.state !== 'SETTLED') {
        // NOT_SETTLED / AMBIGUOUS: never auto-retry here. NOT_SETTLED
        // leaves the payment retry-eligible for a separate, explicitly
        // invoked settlement path (not implemented in this increment —
        // see the report); AMBIGUOUS leaves it exactly where it is,
        // pending manual/operator reconciliation. Both fall through to
        // the existing 202 response, unchanged.
        return null;
      }
      const transactionReference = reconciliation.transaction.providerTransactionId ?? undefined;
      const recorded = await paymentAttempts.recordSettledExternal(
        paymentIdentifier,
        transactionReference,
        // Narrowed to exactly the stage this row was independently
        // observed at above — never a blanket allowance — so the CAS
        // itself can't silently "recover" a row that moved to some other
        // stage between the read and this write.
        [recovery.lifecycleStage]
      );
      if (recorded.status !== 'transitioned') {
        // A concurrent recovery already claimed this transition (or the
        // row moved out from under us) — fail closed to 202, never
        // fabricate a second success response from one settlement.
        return null;
      }

      let link = await buildPaymentServiceLink({
        link_version: 2,
        payment_rail: 'nevermined',
        payment_provider: NEVERMINED_PAYMENT_PROVIDER,
        nevermined_agent_id: config.nevermined!.agentId,
        nevermined_plan_id: config.nevermined!.planId,
        payment_identifier: paymentIdentifier,
        quote_id: draft.quote_id,
        requirement_id: draft.requirement_id,
        service_id: config.serviceId,
        service_version: config.serviceId.endsWith('.v2') ? 'v2' : 'v1',
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
        payment_identifier: paymentIdentifier,
        transaction: reconciliation.transaction.providerTransactionId,
      });
      link = await extendWithSettlement(link, recoveredSettlementEvidenceHash);

      await paymentAttempts.transitionLifecycleStage(
        paymentIdentifier,
        'settled_external',
        'link_verified'
      );
      await paymentAttempts.transitionLifecycleStage(paymentIdentifier, 'link_verified', 'settled');
      await paymentAttempts.markConsumed(paymentIdentifier);
      // Recovering from `settlement_pending`: the job is still at
      // `SETTLING` (its local rejection branch never ran), so it legally
      // advances to `DELIVERED` here, same as the normal synchronous
      // success path. Recovering from `settlement_failed`: the job
      // already moved to `REFUND_REQUIRED` when the false rejection
      // happened, and the frozen, already-accepted JobState machine (SUN-
      // 0200, `apps/edge-api/src/control-plane/state-machine`) has no
      // `REFUND_REQUIRED -> DELIVERED` edge — deliberately not added here
      // to keep this recovery narrowly scoped to the payment-attempt
      // layer. The job record correctly continues to reflect "a refund
      // was initiated" as a historical fact; `payment_attempts.
      // lifecycle_stage`/`consumed_at` and the `PaymentServiceLink` below
      // are the authoritative record of the payment's true final outcome
      // — the two questions ("does this job need refund follow-up" vs.
      // "was this payment ultimately settled") are intentionally allowed
      // to diverge for this one historical, evidence-recovered row.
      if (job.current_state === 'SETTLING') {
        await transition(job.id, 'SETTLING', 'DELIVERED', 'SETTLEMENT_COMPLETE');
      }

      const responseBody = {
        service_id: config.serviceId,
        result_class: 'success',
        output: draft.output,
        receipt_id: draft.receipt_id,
        link_id: link.link_id,
        link_hash: link.link_hash,
        ...(draft.scheme === 'upto'
          ? { authorized_maximum: draft.authorized_maximum, actual_amount: draft.actual_amount }
          : {}),
      };
      const settleResponse: NeverminedPaymentResponse = {
        success: true,
        transaction: transactionReference ?? 'recovered:unknown',
        network: config.network,
        creditsRedeemed: draft.actual_amount,
      };
      await results.finalize(job.id, { status: 200, body: responseBody, settleResponse }, nowIso);
      await audit('payment_recovered_settled_external', {
        payment_identifier: paymentIdentifier,
        job_id: job.id,
      });

      c.header('PAYMENT-RESPONSE', encodeNeverminedPaymentResponseHeaderSafe(settleResponse));
      return c.json(responseBody, 200);
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
      const reconstructed = await reconstructFromJob({ requireDelivered: false });
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
      const recovered = await attemptNeverminedRecovery();
      if (recovered) return recovered;
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
      service_version: config.serviceId.endsWith('.v2') ? 'v2' : 'v1',
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
      service_version: config.serviceId.endsWith('.v2') ? 'v2' : 'v1',
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

    // The provider boundary must receive the exact `payload`/
    // `payload.accepted` objects `validatePaymentPayloadStructure` above
    // already checked field-by-field against `stored.quote` — never a
    // re-decoded or re-derived copy (SUN-0700B checkpoint 1 preflight
    // closure, directive §7), so a real facilitator's VerifyRequest is
    // built from what was actually validated, not from a reconstruction
    // of it.
    const verificationContext: PaymentVerificationContext =
      rail === 'nevermined'
        ? {
            ...evidenceContext,
            authorizationContext: {
              rail: 'nevermined',
              accessToken: sigHeader,
              paymentRequired: neverminedRequired!,
              agentId: config.nevermined!.agentId,
              planId: config.nevermined!.planId,
              delegationId: neverminedDelegationId!,
            },
          }
        : {
            ...evidenceContext,
            authorizationContext: { rail: 'cdp' },
            paymentPayload: payload!,
            paymentRequirements: payload!.accepted,
          };
    const verificationEvidence = await evidenceProvider.verify(verificationContext);
    await audit('payment_verification_requested', { payment_identifier: paymentIdentifier });
    const verifyGate = canAdvanceToVerified(
      verificationEvidence,
      evidenceContext,
      config.evidenceMode
    );
    if (!verifyGate.allowed) {
      // `PAYMENT_FAILED` is a transition reason, not a canonical JobState.
      // The accepted state machine permits PAYMENT_CHALLENGED -> REJECTED
      // directly; using the reason as an intermediate state fails schema
      // validation and would turn a facilitator rejection into HTTP 500.
      await transition(jobId, 'PAYMENT_CHALLENGED', 'REJECTED', 'PAYMENT_FAILED');
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
    if (rail === 'nevermined') {
      await paymentAttempts.transitionLifecycleStage(paymentIdentifier, 'verified', 'executed');
    }

    const receiptHash = await hashPaymentObject(outcome.result.receipt as Record<string, unknown>);

    let actualAmount = stored.quote.amount;
    let usageResultHash: string | undefined;
    // Full object (not just its hash) hoisted out of the `upto` branch so
    // it can also reach the settlement provider boundary below — a real
    // facilitator settling an `upto` payment needs the post-execution
    // usage binding itself, not merely its hash (directive §5, §16).
    let usageResult: UsageResult | undefined;
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
      if (BigInt(actualAmount) > BigInt(stored.quote.amount)) {
        await transition(jobId, 'VERIFYING', 'REJECTED', 'VERIFICATION_FAILED');
        await audit('payment_verification_failed', {
          payment_identifier: paymentIdentifier,
          reason: 'authorization_exceeded',
        });
        return jsonError(
          c,
          402,
          'authorization_exceeded',
          `actual amount ${actualAmount} exceeds authorized maximum ${stored.quote.amount}`
        );
      }
      if (!outcome.resourceMetrics) {
        await transition(jobId, 'VERIFYING', 'REJECTED', 'VERIFICATION_FAILED');
        return jsonError(
          c,
          500,
          'service_execution_failed',
          'upto executor did not report deterministic resourceMetrics'
        );
      }
      try {
        const builtUsageResult = await buildUsageResult({
          quote_id: stored.quote.quote_id,
          requirement_id: stored.requirement_id,
          payment_identifier: paymentIdentifier,
          service_id: config.serviceId,
          service_version: config.serviceId.endsWith('.v2') ? 'v2' : 'v1',
          request_input_hash: inputHash,
          service_output_hash: outcome.result.output_hash,
          verification_receipt_id: outcome.result.receipt_id,
          verification_receipt_hash: receiptHash,
          resource_metrics_hash: await hashPaymentObject(outcome.resourceMetrics),
          pricing_source_version: resolvePricingSourceVersion(),
          actual_amount: actualAmount,
          authorized_maximum: stored.quote.amount,
        });
        usageResult = builtUsageResult;
        usageResultHash = builtUsageResult.usage_result_hash;
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
    // Same object-identity discipline as the verify() boundary above —
    // the exact `payload`/`payload.accepted` already validated, plus the
    // `upto` usage-result binding when one was computed (directive §5).
    const settlementContext: PaymentSettlementContext =
      rail === 'nevermined'
        ? {
            ...evidenceContext,
            authorizationContext: {
              rail: 'nevermined',
              accessToken: sigHeader,
              paymentRequired: neverminedRequired!,
              agentId: config.nevermined!.agentId,
              planId: config.nevermined!.planId,
              delegationId: neverminedDelegationId!,
            },
            ...(usageResult ? { usageResult } : {}),
          }
        : {
            ...evidenceContext,
            authorizationContext: { rail: 'cdp' },
            paymentPayload: payload!,
            paymentRequirements: payload!.accepted,
            ...(usageResult ? { usageResult } : {}),
          };

    if (rail === 'nevermined') {
      // Durable persistence of every execution artifact recovery would
      // need, written BEFORE the real settle call — a crash strictly
      // during `settlePermissions` (directive crash scenario I) must
      // never lose the ability to reconstruct the exact response a
      // normal synchronous success would have produced.
      const pendingDraft: PendingNeverminedSettlementDraft = {
        kind: 'nevermined_settlement_pending_draft',
        quote_id: stored.quote.quote_id,
        requirement_id: stored.requirement_id,
        request_input_hash: inputHash,
        output: outcome.result.output,
        output_hash: outcome.result.output_hash,
        receipt_id: outcome.result.receipt_id,
        receipt_hash: receiptHash,
        receipt: outcome.result.receipt,
        ...(outcome.result.verification !== undefined ? { pcc: outcome.result.verification } : {}),
        verification_evidence: { payer: verificationEvidence.payer },
        verification_evidence_hash: verificationEvidenceHash,
        actual_amount: actualAmount,
        ...(usageResultHash ? { usage_result_hash: usageResultHash } : {}),
        ...(usageResult ? { usage_result: usageResult } : {}),
        scheme: config.scheme,
        authorized_maximum: stored.quote.amount,
      };
      await results.createPending(jobId, paymentIdentifier, pendingDraft, nowIso);

      const pending = await paymentAttempts.recordSettlementPending(paymentIdentifier, {
        neverminedDelegationId,
        settlementPermissionHash: verificationEvidenceHash,
        serviceOutputHash: outcome.result.output_hash,
        serviceReceiptId: outcome.result.receipt_id,
      });
      if (pending.status !== 'transitioned') {
        // Durable persistence itself failed (or a concurrent request
        // already claimed this transition) — the real facilitator settle
        // call must never be reached without this write having
        // committed first (directive requirement, proven by a route
        // test asserting the settle call count stays 0).
        await audit('settlement_pending_persist_failed', {
          payment_identifier: paymentIdentifier,
          reason: pending.status,
        });
        return jsonError(
          c,
          500,
          'repository_failure',
          'failed to durably record settlement_pending before settlement'
        );
      }
    }

    const settlementEvidence = await evidenceProvider.settle(
      settlementContext,
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
      // Real-incident-derived rule (SUN-0900B checkpoint 1B, third live
      // settlement): once `evidenceProvider.settle(...)` has actually been
      // invoked, a LOCAL inability to positively validate its response is
      // never proof the settlement failed — the real sandbox transaction
      // it produced can (and, in the incident this rule was written for,
      // did) succeed externally regardless of what the local gate thought
      // of the response shape. Only a settlement Nevermined itself
      // *positively, explicitly* declared failed (`result.success ===
      // false`, surfaced here as `settlementEvidence.reason ===
      // 'provider_rejected'`) may ever go straight to the terminal
      // `settlement_failed` state. Every other rejection reached after the
      // real call — an ambiguous/ill-shaped response, a malformed or
      // absent transaction reference, a provider exception/transport
      // failure, a verification-hash/structural mismatch discovered only
      // at this late gate — is AMBIGUOUS: `lifecycle_stage` stays at
      // `settlement_pending` (already durably persisted above), never
      // auto-retried, recoverable only through
      // `attemptNeverminedRecovery`'s read-only external reconciliation.
      const isExplicitProviderFailure =
        settleGate.reason === 'settlement_not_successful' &&
        settlementEvidence.reason === 'provider_rejected';
      if (rail === 'nevermined' && !isExplicitProviderFailure) {
        await audit('settlement_ambiguous', {
          payment_identifier: paymentIdentifier,
          reason: settleGate.reason,
        });
        return jsonError(c, 402, 'settlement_rejected', settleGate.reason);
      }
      await paymentAttempts.transitionLifecycleStage(
        paymentIdentifier,
        rail === 'nevermined' ? 'settlement_pending' : 'verified',
        'settlement_failed'
      );
      await audit('settlement_failed', {
        payment_identifier: paymentIdentifier,
        reason: settleGate.reason,
      });
      return jsonError(c, 402, 'settlement_rejected', settleGate.reason);
    }
    // External settlement is only the first half of finalization. The
    // payment remains unconsumed until the rail-aware PaymentServiceLink is
    // constructed, independently self-verified, and durably stored.
    if (rail === 'nevermined') {
      const recorded = await paymentAttempts.recordSettledExternal(
        paymentIdentifier,
        settlementEvidence.transaction_reference
      );
      if (recorded.status !== 'transitioned') {
        return jsonError(
          c,
          500,
          'repository_failure',
          'failed to durably record settled_external before linkage'
        );
      }
    }

    let link = await buildPaymentServiceLink({
      link_version: 2,
      payment_rail: rail,
      payment_provider: rail === 'nevermined' ? NEVERMINED_PAYMENT_PROVIDER : CDP_PAYMENT_PROVIDER,
      ...(rail === 'nevermined'
        ? {
            nevermined_agent_id: config.nevermined!.agentId,
            nevermined_plan_id: config.nevermined!.planId,
          }
        : {}),
      payment_identifier: paymentIdentifier,
      quote_id: stored.quote.quote_id,
      requirement_id: stored.requirement_id,
      service_id: config.serviceId,
      service_version: config.serviceId.endsWith('.v2') ? 'v2' : 'v1',
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
    const linkVerification = await verifyPaymentServiceLink(link);
    if (!linkVerification.valid) {
      await audit('payment_link_verification_failed', {
        payment_identifier: paymentIdentifier,
        reason: linkVerification.reason,
      });
      return jsonError(c, 500, 'payment_link_invalid', linkVerification.reason);
    }

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

    const neverminedObservation =
      rail === 'nevermined' ? readNeverminedSettlementObservation(settlementEvidence) : null;
    const settleResponse: SettleResponse | NeverminedPaymentResponse =
      rail === 'nevermined'
        ? {
            success: true,
            transaction: settlementEvidence.transaction_reference ?? 'fixture:settlement:unknown',
            network: config.network,
            ...(settlementEvidence.payer ? { payer: settlementEvidence.payer } : {}),
            creditsRedeemed: neverminedObservation?.credits_redeemed ?? actualAmount,
            ...(neverminedObservation?.remaining_balance !== null &&
            neverminedObservation?.remaining_balance !== undefined
              ? { remainingBalance: neverminedObservation.remaining_balance }
              : {}),
          }
        : {
            success: true,
            transaction: settlementEvidence.transaction_reference ?? 'synthetic-tx:unknown',
            network: config.network,
            ...(settlementEvidence.payer ? { payer: settlementEvidence.payer } : {}),
            amount: actualAmount,
            extra: { link_id: link.link_id, payment_identifier: paymentIdentifier },
          };

    const durableEvidence: NonNullable<CachedResult['durableEvidence']> = {
      ...(usageResult ? { usage_result: usageResult } : {}),
      ...(outcome.result.verification !== undefined ? { pcc: outcome.result.verification } : {}),
      receipt: outcome.result.receipt,
      settlement_evidence: settlementEvidence,
      payment_service_link: link,
    };

    if (rail === 'nevermined') {
      // A pending draft row already exists for this job_id (written just
      // before the settle call above) — overwrite it with the final
      // result rather than a second INSERT.
      await results.finalize(
        jobId,
        { status: 200, body: responseBody, settleResponse, durableEvidence },
        nowIso
      );
    } else {
      await results.create(
        jobId,
        paymentIdentifier,
        { status: 200, body: responseBody, settleResponse, durableEvidence },
        nowIso
      );
    }

    if (rail === 'nevermined') {
      const linkRecorded = await paymentAttempts.transitionLifecycleStage(
        paymentIdentifier,
        'settled_external',
        'link_verified'
      );
      if (linkRecorded.status !== 'transitioned') {
        return jsonError(c, 500, 'repository_failure', 'failed to record link_verified');
      }
      await audit('payment_link_verified', { payment_identifier: paymentIdentifier });
      const settled = await paymentAttempts.transitionLifecycleStage(
        paymentIdentifier,
        'link_verified',
        'settled'
      );
      if (settled.status !== 'transitioned') {
        return jsonError(c, 500, 'repository_failure', 'failed to record settled lifecycle');
      }
    } else {
      const settled = await paymentAttempts.transitionLifecycleStage(
        paymentIdentifier,
        'verified',
        'settled'
      );
      if (settled.status !== 'transitioned') {
        return jsonError(c, 500, 'repository_failure', 'failed to record settled lifecycle');
      }
      await audit('payment_link_verified', { payment_identifier: paymentIdentifier });
    }
    await paymentAttempts.markConsumed(paymentIdentifier);
    await transition(jobId, 'SETTLING', 'DELIVERED', 'SETTLEMENT_COMPLETE');
    await audit('payment_settled', { payment_identifier: paymentIdentifier });
    await audit('payment_consumed', { payment_identifier: paymentIdentifier, job_id: jobId });

    c.header(
      'PAYMENT-RESPONSE',
      rail === 'nevermined'
        ? encodeNeverminedPaymentResponseHeaderSafe(settleResponse as NeverminedPaymentResponse)
        : encodePaymentResponseHeaderSafe(settleResponse as SettleResponse)
    );
    return c.json(responseBody, 200);
  });
}

export { ProductionEvidenceProviderNotConfiguredError, FixturePaymentEvidenceProvider };
