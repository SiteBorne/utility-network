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
import type { ValidateFunction } from 'ajv';
import { inputValidatorsById } from '../../generated/input-validators.generated.js';
import { buildNeverminedPaymentRequiredLocal } from '../evidence/nevermined-http-client';
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
// SUN-1221E6R-H2AWI-3 — durable paid-continuation handoff/wait. This
// route never calls `evidenceProvider.settle()` directly (see the
// module doc comment above and the dedicated source-scan regression
// test in x402-service-route.test.ts) — every post-PAYMENT_VERIFIED
// executor/PCC/settlement/persistence step lives exclusively inside
// `PaidContinuationWorkflow` (H2AWI-2), reached only through these two
// H2AWI-1/H2AWI-2-reusing modules.
import {
  createOrJoinPaidContinuation,
  joinExistingPaidContinuation,
  type WorkflowBindingLike,
} from '../continuation/handoff';
import { waitForWorkflowResult, type WorkflowWaitOutcome } from '../continuation/waiter';
import type {
  ContinuationEnvelopeMetadata,
  WorkflowContinuationResult,
} from '../continuation/types';
import type { DecryptedContinuationPayload } from '../workflows/paid-continuation-workflow';

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
    // `details` widened (SUN-1221E2D) to carry the sanitized diagnostic
    // fields `WebContextVerifiedService` (and any other real executor)
    // may now attach on a non-success result -- internal-only, never
    // read into the public `jsonError` response below.
    failure?: { code: string; message: string; details?: unknown };
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
  /** SUN-1200 checkpoint F, test-only escape hatch: a caller-supplied,
   * already-compiled validator for `inputSchema`, used instead of the
   * generated `inputValidatorsById` lookup. Every real production caller
   * (`paid-services.ts`) always passes one of
   * `BUNDLED_SERVICE_INPUT_SCHEMAS`'s four frozen, precompiled schemas
   * and never sets this field — it exists only so tests that construct
   * `createX402ServiceRoute` directly with an ad-hoc, non-frozen
   * `inputSchema` (verifying unrelated behavior, e.g. payment-requirement
   * metadata pass-through) can supply their own validator (compiled
   * locally under Vitest/Node, where runtime `Ajv.compile()` is safe)
   * rather than needing a precompiled entry for a schema no real service
   * ever uses. Deliberately explicit, never a silent fallback: an
   * `inputSchema` with no precompiled entry AND no `inputValidator`
   * still fails closed at construction time. */
  inputValidator?: ValidateFunction;
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
  /** SUN-1200 checkpoint C, CDP-rail recovery convergence: an optional,
   * dependency-injected READ-ONLY on-chain transaction-receipt checker.
   * No real chain RPC call is wired anywhere in this repository today
   * (deliberately, matching this project's established pattern of
   * leaving a genuinely unimplemented external integration point
   * unwired rather than faked) -- when omitted, `attemptCdpRecovery`
   * treats any candidate transaction reference as `STILL_UNKNOWN` and
   * falls through to the bounded identical-settle-retry step. Supplying
   * one is a future checkpoint's job. Must never mutate state; must
   * never be the same client/credential surface as the settlement
   * facilitator. */
  cdpChainReceiptChecker?: (
    transactionReference: string,
    network: Network
  ) => Promise<'SETTLED' | 'FAILED' | 'STILL_UNKNOWN'>;
  /** SUN-1200 checkpoint F, VALIDATION RUNTIME CLOSURE (§6): an optional,
   * pre-economic body check run AFTER `inputSchema` validation but
   * BEFORE any 402 challenge is constructed. A buyer must not discover
   * only after paying that SITEBORNE cannot support what they submitted
   * -- `verify_agent_output.v1`/`.v2` use this to reject an unsupported
   * or oversized buyer-supplied `required_schema`
   * (`checkSchemaProfile1`) with a deterministic non-payment error
   * before any quote is minted. Returning `{ ok: true }` continues the
   * normal flow; `{ ok: false, ... }` short-circuits with a 400 and
   * never mints a quote or emits a 402. */
  preEconomicBodyValidator?: (
    body: unknown
  ) => { ok: true } | { ok: false; code: string; message: string };
  /** SUN-1221E6R-H2AWI-3: the Cloudflare Workflows binding for the
   * durable paid-continuation Workflow (real production wiring — reading
   * `env.PAID_CONTINUATION_WORKFLOW` and importing the real envelope key
   * — is H2AWI-4 scope; every caller in THIS checkpoint, including every
   * real production route composition file, leaves this unset). Absent
   * (the default everywhere today): the route fails closed the instant a
   * payment is verified, per this codebase's established
   * missing-required-config convention — it NEVER falls back to a local
   * `evidenceProvider.settle()` call, which no longer exists anywhere in
   * this file. */
  workflow?: WorkflowBindingLike;
  /** Paired with `workflow` above — an already-imported AES-256-GCM key
   * (`sealContinuationEnvelope`'s own boundary: it never reads a secret
   * binding itself). */
  continuationEnvelopeKey?: CryptoKey;
  /** Defaults to `'v1'` when `continuationEnvelopeKey` is supplied. */
  continuationEnvelopeKeyId?: string;
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

// SUN-1221E6R-H2AWI-3: the CDP-rail equivalent of
// `PendingNeverminedSettlementDraft` (SUN-1200 checkpoint C's
// `CdpSettlementPendingDraft`) is REMOVED -- it existed exclusively to
// support this route's own direct CDP settle call and its recovery
// retry (`attemptCdpRecovery`, both removed). The Workflow's own
// pre-settle durable draft (H2AWI-2's `runSettlementStep`, via
// `PaymentAttemptSettlementRepository.recordSettlementPending`) is a
// different, narrower, already-frozen mechanism -- not this interface.

export class NeverminedEvidenceProviderNotConfiguredError extends Error {
  constructor() {
    super('Nevermined route requires an explicitly selected Nevermined evidence provider');
    this.name = 'NeverminedEvidenceProviderNotConfiguredError';
  }
}

/**
 * SUN-1221E6R-H2A — a client that disconnects (or a test harness that
 * aborts, e.g. Vitest's default `it()` timeout) *after* a payment has been
 * verified must never be able to strand the job in `EXECUTING` with no
 * terminal transition and no settlement decision. Cloudflare Workers may
 * cancel an in-flight request's continuation once nothing is left awaiting
 * the client connection; `ExecutionContext.waitUntil()` is the platform's
 * documented mechanism to keep a promise alive past that point. Accessed
 * defensively because Hono's `c.executionCtx` getter throws when no
 * `ExecutionContext` was bound (true of every existing `app.request(path,
 * init)` call in this route's own test suite, and of any runtime lighter
 * than the real Workers/Miniflare one) — this route must keep working
 * unprotected in that case, not crash.
 */
function safeGetExecutionCtx(
  c: Context
): { waitUntil(promise: Promise<unknown>): void } | undefined {
  try {
    return c.executionCtx;
  } catch {
    return undefined;
  }
}

function jsonError(c: Context, status: number, code: string, message: string, details?: unknown) {
  return c.json(
    { error: code, message, ...(details !== undefined ? { details } : {}) },
    status as never
  );
}

// SUN-1221E6R-H2AWI-3: `isExplicitCdpSettlementFailure`/
// `CDP_STRUCTURAL_ONLY_SETTLE_REASONS` (SUN-1200 checkpoint C) are
// REMOVED, not merely disabled -- they classified the CDP rail's own
// direct settle-gate rejection into explicit-vs-ambiguous for
// `attemptCdpRecovery`'s benefit. Both the direct settle call and
// `attemptCdpRecovery` are gone (see the comment where
// `attemptCdpRecovery` used to be defined); the equivalent
// explicit-vs-ambiguous classification for settlement now lives entirely
// inside `PaidContinuationWorkflow`'s own settlement step (H2AWI-2,
// `paid-continuation-workflow.ts`'s `runSettlementStep`/
// `resolveViaReconciliation`).

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

  // SUN-1200 checkpoint F: was `new Ajv2020({...}).compile(config.inputSchema)`
  // -- AJV's `.compile()` uses `new Function(...)` internally to generate
  // an optimized validator, which real Cloudflare Workers reject when
  // triggered during request handling
  // (`EvalError: Code generation from strings disallowed for this
  // context`, confirmed live during this checkpoint's own cutover
  // attempt -- `createX402ServiceRoute` runs lazily on the first request
  // to reach a given paid route, via `buildPaidServicesApp`'s
  // cache-on-first-request pattern in `index.ts`, which counts as
  // request-time, not true Worker startup). `config.inputSchema` is
  // always exactly one of `BUNDLED_SERVICE_INPUT_SCHEMAS`'s four unique,
  // frozen, build-time-known schemas (never per-request data), so it is
  // precompiled ahead of time instead — see
  // `apps/edge-api/scripts/generate-input-validators.mts` and the
  // checkpoint F incident report. Fails closed at construction time
  // (same as every other construction-time check in this function) if a
  // caller ever supplies a schema this repository has no precompiled
  // validator for.
  const inputSchemaId = (config.inputSchema as { $id?: string }).$id;
  const validateInput =
    config.inputValidator ??
    (inputSchemaId
      ? (inputValidatorsById as Record<string, ValidateFunction | undefined>)[inputSchemaId]
      : undefined);
  if (!validateInput) {
    throw new Error(
      `no precompiled input validator for schema $id "${String(inputSchemaId)}" -- ` +
        'run `pnpm generate:input-validators` if this is a genuinely new frozen input schema, ' +
        'or pass config.inputValidator explicitly for a test-only ad-hoc schema'
    );
  }

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

    // SUN-1200 checkpoint F (§6): pre-economic body validation, run
    // before any quote/402 is constructed. Kept deliberately separate
    // from `inputSchema` validation above -- this is a per-service,
    // semantic check (today, only `verify_agent_output`'s
    // `checkSchemaProfile1`) that the frozen input JSON Schema alone
    // cannot express.
    if (config.preEconomicBodyValidator) {
      const preEconomic = config.preEconomicBodyValidator(body);
      if (!preEconomic.ok) {
        return jsonError(c, 400, preEconomic.code, preEconomic.message);
      }
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
        const official = buildNeverminedPaymentRequiredLocal(config.nevermined!.planId, {
          endpoint: resourceUrl,
          agentId: config.nevermined!.agentId,
          httpVerb: 'POST',
          network: config.network,
          description: declaration.agent.description,
          mimeType: 'application/json',
        });
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
        ((cached as { kind?: unknown }).kind === 'nevermined_settlement_pending_draft' ||
          (cached as { kind?: unknown }).kind === 'cdp_settlement_pending_draft')
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

    // SUN-1221E6R-H2AWI-3: the CDP-rail settlement-recovery function that
    // used to live here (`attemptCdpRecovery`, SUN-1200 checkpoint C) is
    // REMOVED, not merely disabled. It existed exclusively to recover an
    // AMBIGUOUS settlement left by this route's own direct
    // `evidenceProvider.settle()` call -- a call this file no longer
    // makes anywhere (proof: the dedicated source-scan regression test in
    // x402-service-route.test.ts). Settlement, and therefore its
    // ambiguity-recovery reconciliation, is now owned exclusively by
    // `PaidContinuationWorkflow` (H2AWI-2's `resolveViaReconciliation`) --
    // see `driveDurableContinuation` below, reached via the
    // `duplicate_same` branch a few lines down, which joins the SAME
    // durable Workflow instance instead of re-deriving recovery state
    // from a `results`-table draft row this pipeline no longer writes.

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
      // SUN-1221E6R-H2AWI-3 (mission §16/§19, design §5/§19): a retry
      // carrying the SAME payment_identifier must join the SAME durable
      // Workflow instance the original request already handed off to --
      // never re-derive recovery state from a local draft row, never
      // create a second instance. `driveDurableContinuation('join_only')`
      // is `get()`-only (see `joinExistingPaidContinuation`'s own doc
      // comment) -- it returns null, falling through to the pre-existing
      // recovery/`202` machinery below, unchanged, whenever no durable
      // instance exists yet (the original request has not reached the
      // handoff point) or this route was never configured with a
      // Workflow binding at all.
      const durableJoin = await driveDurableContinuation('join_only');
      if (durableJoin) return durableJoin;
      const recovered = await attemptNeverminedRecovery();
      if (recovered) return recovered;
      const reconstructed = await reconstructFromJob();
      if (reconstructed) return reconstructed;
      // Same legitimate retry, but the original request has not finished
      // processing yet (directive §13) — never a second execution. This
      // is the SAME pre-existing `202 processing` response the contract
      // already had before this checkpoint (SUN-0900B) -- not a new
      // status code introduced by H2AWI-3, and only ever reached when no
      // durable Workflow instance is even findable yet.
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

    // SUN-1221E6R-H2A — everything from here on is real economic
    // execution: the resource has been locked against a *verified*
    // payment, and every path below either settles it or explicitly
    // fails/refunds it. This is exactly the span that must survive a
    // client disconnect, so it is its own promise, registered with
    // `waitUntil` (protecting it) *before* being awaited (so the normal
    // synchronous response is still the same, single settlement of that
    // one promise — never a second, forked execution).
    /**
     * SUN-1221E6R-H2AWI-3 — translates a durable Workflow's terminal
     * `WorkflowContinuationResult` (H2AWI-1's frozen type) into the
     * EXISTING, unchanged canonical synchronous HTTP response shape. No
     * new status code, no new response field, no polling/Location-header
     * semantics is introduced anywhere in this function — every branch
     * reuses an error code/status this route's public contract already
     * had before this checkpoint.
     *
     * `'settled'` is the one case that needs richer data than
     * `WorkflowContinuationResult` itself carries (the full `output`/
     * `link_id`/`link_hash`/receipt/PAYMENT-RESPONSE body) — exactly the
     * same rich shape `reconstructFromJob` already reads back from
     * `x402_service_results` for the pre-existing `duplicate_same`/
     * `already_consumed` retry paths above. Once the Workflow's own
     * persist-result/persist-receipt steps are wired to write that same
     * durable row (H2AWI-4), this is the SAME code path a connected
     * client's first-ever request and a reconnecting client's retry both
     * resolve through — one response-construction implementation, never
     * two competing ones.
     */
    async function respondFromWorkflowResult(
      result: WorkflowContinuationResult
    ): Promise<Response> {
      switch (result.status) {
        case 'settled': {
          const reconstructed = await reconstructFromJob({ requireDelivered: false });
          if (reconstructed) return reconstructed;
          return jsonError(
            c,
            500,
            'repository_failure',
            'durable settlement result missing after a settled Workflow'
          );
        }
        case 'executor_timeout':
          // Matches the pre-H2AWI-3 contract's THROWN-executor branch
          // (500 service_execution_failed).
          return jsonError(
            c,
            500,
            'service_execution_failed',
            result.error_code ?? 'executor_timeout'
          );
        case 'executor_rejected':
          // Matches the pre-H2AWI-3 contract's resolved-but-unsuccessful
          // executor branch (502 service_execution_failed).
          return jsonError(
            c,
            502,
            'service_execution_failed',
            result.error_code ?? 'executor_rejected'
          );
        case 'pcc_failed':
          return jsonError(c, 500, 'service_execution_failed', result.error_code ?? 'pcc_failed');
        case 'authorization_expired':
          // New terminal case introduced by durability (a long-running
          // Workflow can, in principle, outlive the quoted authorization
          // window) — reuses the existing `settlement_rejected` error
          // family rather than inventing a new code, matching the
          // pre-H2AWI-3 contract's own "every settle-gate failure returns
          // 402 settlement_rejected" convention (see the two cases below).
          return jsonError(c, 402, 'settlement_rejected', 'authorization_expired');
        case 'settlement_rejected':
        case 'settlement_ambiguous':
          // The pre-H2AWI-3 contract already funneled BOTH an explicit
          // settlement rejection and an ambiguous one into the exact same
          // `402 settlement_rejected` response shape (see the removed
          // in-request settle-gate code this replaces) — preserved
          // byte-for-byte here.
          return jsonError(c, 402, 'settlement_rejected', result.error_code ?? result.status);
        case 'persistence_failed_after_settlement':
          // Money is safe (settlement already confirmed); only
          // bookkeeping failed — matches the pre-H2AWI-3 contract's own
          // post-settlement repository-failure branches (500
          // repository_failure).
          return jsonError(
            c,
            500,
            'repository_failure',
            result.error_code ?? 'persistence_failed_after_settlement'
          );
        case 'workflow_internal_error':
        default:
          return jsonError(
            c,
            500,
            'service_execution_failed',
            result.error_code ?? 'workflow_internal_error'
          );
      }
    }

    /**
     * Converts the waiter's outcome (SUN-1221E6R-H2AWI-3 Task 3.3) into a
     * Response. `disconnected` is reached only once the client itself has
     * already gone away — no connected client ever observes that branch;
     * the Workflow this request handed off to is entirely unaffected and
     * keeps running (see `waiter.ts`'s own doc comment) — this function
     * still must return SOME `Response` because the Workers fetch-handler
     * contract requires one.
     */
    async function translateWaitOutcome(outcome: WorkflowWaitOutcome): Promise<Response> {
      if (outcome.kind === 'disconnected') {
        return jsonError(
          c,
          500,
          'repository_failure',
          'client disconnected before the durable payment continuation completed'
        );
      }
      if (outcome.kind === 'errored') {
        return jsonError(
          c,
          500,
          'service_execution_failed',
          outcome.error.message || outcome.error.name
        );
      }
      if (outcome.kind === 'terminated') {
        return jsonError(c, 500, 'service_execution_failed', 'workflow_terminated');
      }
      const result = outcome.output as WorkflowContinuationResult | undefined;
      if (!result || typeof result.status !== 'string') {
        return jsonError(
          c,
          500,
          'service_execution_failed',
          'durable Workflow returned a malformed terminal result'
        );
      }
      return respondFromWorkflowResult(result);
    }

    /**
     * SUN-1221E6R-H2AWI-3 — the ONE place this route ever touches the
     * durable Workflow. `mode: 'create_or_join'` is reached from a
     * first-seen request immediately after PAYMENT_VERIFIED (design §4's
     * frozen handoff point); `mode: 'join_only'` is reached from a
     * `duplicate_same` retry (mission §16/§19) and is deliberately
     * `get()`-only (`joinExistingPaidContinuation`) — it NEVER creates an
     * instance from a retry's own (potentially re-derived) data, and
     * returns `null` (never a Response) whenever there is nothing yet to
     * join, so the caller's pre-existing recovery/`202` fallback remains
     * the safety net for that case, unchanged.
     *
     * Fails closed (never a local settle fallback -- none exists anywhere
     * in this file) when `config.workflow`/`config.continuationEnvelopeKey`
     * are not configured, matching this codebase's established
     * missing-required-config convention.
     */
    async function driveDurableContinuation(mode: 'create_or_join'): Promise<Response>;
    async function driveDurableContinuation(mode: 'join_only'): Promise<Response | null>;
    async function driveDurableContinuation(
      mode: 'create_or_join' | 'join_only'
    ): Promise<Response | null> {
      if (mode === 'join_only') {
        if (!config.workflow) return null;
        const joined = await joinExistingPaidContinuation(config.workflow, paymentIdentifier);
        if (!joined) return null;
        const waitOutcome = await waitForWorkflowResult(joined.instance, {
          signal: c.req.raw.signal,
        });
        return await translateWaitOutcome(waitOutcome);
      }

      if (!config.workflow || !config.continuationEnvelopeKey) {
        return jsonError(
          c,
          500,
          'repository_failure',
          'durable payment continuation is not configured for this route'
        );
      }

      const jobRowResult = await jobsRepo.getByIdempotencyKey(paymentIdentifier);
      const continuationJobId =
        jobRowResult.ok && jobRowResult.value ? jobRowResult.value.id : jobId;

      const metadata: ContinuationEnvelopeMetadata = {
        job_id: continuationJobId,
        payment_identifier: paymentIdentifier,
        service: config.serviceId,
        network: config.network,
        asset: config.asset,
        pay_to: evidenceContext.payee,
        amount_atomic: evidenceContext.amount,
        // `exact`-scheme only reaches this point (see the `upto` gate in
        // `runProtectedExecutionPipeline`) -- the quote's own expiry is
        // this route's existing authoritative "how long is this payment
        // window valid" value (already checked earlier in this handler),
        // reused here rather than inventing a second expiry concept.
        valid_before_unix: Math.floor(new Date(stored.quote.expires_at).getTime() / 1000),
      };

      // Same object-identity discipline the removed in-request settle
      // call used to have: the exact `payload`/`payload.accepted` this
      // request already structurally validated, never a re-decoded copy.
      const settlementContext: PaymentSettlementContext =
        rail === 'nevermined'
          ? {
              ...evidenceContext,
              authorizationContext: {
                rail: 'nevermined',
                accessToken: sigHeader!,
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

      const continuationPayload: DecryptedContinuationPayload = {
        executorInput: body,
        requestInputHash: inputHash,
        settlementContext,
        verificationEvidence,
        actualAmount: stored.quote.amount,
      };

      const handoffResult = await createOrJoinPaidContinuation(
        {
          workflow: config.workflow,
          envelopeKey: config.continuationEnvelopeKey,
          envelopeKeyId: config.continuationEnvelopeKeyId ?? 'v1',
        },
        {
          paymentIdentifier,
          payload: continuationPayload,
          metadata,
          requestId,
        }
      );

      if (handoffResult.outcome === 'create_failed') {
        // Design §21: verify() already succeeded, but no executor
        // invocation and no settlement occur under any circumstance —
        // there is no synchronous fallback left in this file to regress
        // to.
        await transition(continuationJobId, 'LOCKED', 'REJECTED', 'QUARANTINE_POLICY');
        return jsonError(
          c,
          500,
          'repository_failure',
          'failed to create durable payment continuation'
        );
      }

      const waitOutcome = await waitForWorkflowResult(handoffResult.instance, {
        signal: c.req.raw.signal,
      });
      return await translateWaitOutcome(waitOutcome);
    }

    async function runProtectedExecutionPipeline(): Promise<Response> {
      await transition(jobId, 'PAYMENT_VERIFIED', 'LOCKED', 'RESOURCE_LOCKED');
      await audit('service_execution_started', { job_id: jobId });

      if (config.scheme === 'upto') {
        // SUN-1221E6R-H2AWI-3: the durable continuation Workflow (H2AWI-2,
        // frozen) computes its settlement context entirely from the
        // envelope sealed at handoff time — before the executor (which now
        // runs INSIDE the Workflow) ever produces a post-execution
        // actualAmountAtomic/resourceMetrics measurement. `upto` scheme's
        // authorization-exceeded protection depends on exactly that
        // post-execution measurement, which the frozen H2AWI-1/H2AWI-2
        // interfaces have no room for. No route in production today uses
        // `scheme: 'upto'` (both real paid routes are `exact` — verified
        // this checkpoint), so this fails closed rather than silently
        // dropping the overage protection a real `upto` route would need;
        // extending the Workflow to support it is explicitly out of this
        // checkpoint's scope (see the evidence report).
        await transition(jobId, 'LOCKED', 'REJECTED', 'QUARANTINE_POLICY');
        return jsonError(
          c,
          500,
          'service_execution_failed',
          'upto-scheme services are not supported by the durable payment continuation pipeline (SUN-1221E6R-H2AWI-3)'
        );
      }

      return await driveDurableContinuation('create_or_join');
    } // end runProtectedExecutionPipeline

    // Exactly one promise represents this request's post-verification
    // execution+settlement. It is registered with `waitUntil` (when an
    // `ExecutionContext` is actually bound — see `safeGetExecutionCtx`)
    // and then awaited directly for the normal response: never a second
    // promise, never a second call into `config.executor` or
    // `evidenceProvider.settle`, never a forked/duplicated side effect.
    // The `.catch(() => {})` given to `waitUntil` exists only so the
    // runtime's extra reference to this promise never produces an
    // "unhandled rejection" — the real error, if any, still propagates
    // normally through the `await` below and becomes this request's
    // response exactly as it always has.
    const pipelinePromise = runProtectedExecutionPipeline();
    const executionCtx = safeGetExecutionCtx(c);
    if (executionCtx) {
      executionCtx.waitUntil(pipelinePromise.catch(() => {}));
    }
    return await pipelinePromise;
  });
}

export { ProductionEvidenceProviderNotConfiguredError, FixturePaymentEvidenceProvider };
