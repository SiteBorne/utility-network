/**
 * SUN-1222C2-Q1 — local-only, non-Worker, exactly-once
 * company_evidence_graph.v2 first-paid-E2E client.
 *
 * Structural sibling of `first-paid-e2e-local.test.ts` (SUN-1220J/O) and
 * `web-context-first-paid-e2e-local.test.ts` (SUN-1221E2): same
 * orchestration logic, same call-budget/state-machine/sanitization
 * guarantees, same containment (lives under `apps/edge-api/tests/`, never
 * imported by `apps/edge-api/src/`, never reachable from the production
 * Worker bundle). Only the frozen economic/routing constants differ, per
 * SUN-1222C2-Q1's own authorization message and this checkpoint's own
 * pre-payment gates:
 *
 *   - candidate `a064477f-7b74-46c5-a5b6-799df114b252` (SUN-1222C-Q1R2-
 *     CANDIDATE-REFRESH's candidate — replaces the prior, policy-blocked
 *     `efc5a287` candidate with one carrying SUN-1222C2-Q1-R1
 *     (SecureHttpClient status semantics), -R2 (D1 SEC aggregate rate
 *     coordinator), and -R3 (registered `sec-edgar` TermsReview) —
 *     `/services/company_evidence_graph.v2` and a real, independently
 *     decoded 402 both confirm 31200 atomic on this exact version, via
 *     Ray-ID-to-`scriptVersion.id` attribution against an unfiltered
 *     `wrangler tail`)
 *   - amount 31200 atomic (`$0.0312`), matching
 *     `governance/RISK_LIMITS.yaml`'s `company_evidence_graph_v2` exactly
 *   - buyer `0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99` (the same
 *     CDP-managed, pre-funded controlled qualification buyer used for
 *     every prior real SITEBORNE paid qualification), fresh dual-RPC
 *     balance 79727 atomic confirmed sufficient by this checkpoint's own
 *     pre-payment gates
 *   - seller/payTo `0x7f44a2dd237938F18632d4CcA40f4c690295E6E1`
 *     (`wrangler.toml`'s committed `SELLER_WALLET_ADDRESS`, unchanged
 *     across every service)
 *
 * `WORKER_ORIGIN` uses the custom domain (`utility.siteborne.net`), not
 * `workers.dev` — this checkpoint's own pre-payment gates (§4/§12)
 * independently confirmed, via Ray-ID/`scriptVersion.id` attribution, that
 * the custom domain reaches this exact candidate with correct
 * version-override behavior for this exact path, including a real,
 * decoded 402 with the expected economics.
 *
 * Unlike `verify_agent_output.v2`'s original composition (SUN-1220J's own
 * CRITICAL FINDING),`company_evidence_graph.v2`/CDP's composition
 * (`company-evidence-graph-v2-cdp-composition.ts`) sets
 * `paymentRequirementExtra: { name: asset.name, version: asset.version }`
 * from its first commit — independently confirmed live in this
 * checkpoint's own pre-payment 402 (`extra: {name: "USD Coin", version:
 * "2", quote_id: ...}`) — so no historical missing-`extra` workaround
 * applies here; `validateChallengeAgainstExpectations` below still checks
 * it, as defense in depth, exactly like every sibling client.
 *
 * Not invoked by any normal `pnpm test` run — the live `describe` block is
 * `skipIf`-gated on `RUN_LOCAL_COMPANY_EVIDENCE_FIRST_PAID_E2E`, unset by
 * default.
 */
import { describe, expect, it, vi } from 'vitest';
import { CdpClient } from '@coinbase/cdp-sdk';
import { fromCdpEvmAccount } from '@coinbase/cdp-sdk/x402';
import { ExactEvmScheme } from '@x402/evm';
import {
  decodePaymentRequiredHeaderSafe,
  decodePaymentResponseHeaderSafe,
  encodePaymentSignatureHeaderSafe,
  buildBuyerPaymentIdentifierExtensions,
  generateSiteborneePaymentId,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
} from '@siteborne/protocol-x402';
import { hasAllRequiredCredentials } from '../../../../scripts/company-evidence-first-paid-e2e';

// ---------------------------------------------------------------------------
// Frozen, non-negotiable economic and routing constants — SUN-1222C2-Q1's
// own authorization message + this checkpoint's own fresh, independently
// decoded 402. Not CLI-overridable.
// ---------------------------------------------------------------------------

const WORKER_SCRIPT_NAME = 'siteborne-utility-edge';
const WORKER_ORIGIN = 'https://utility.siteborne.net';
const TARGET_PATH = '/v2/company/evidence-graph';
const TARGET_URL = `${WORKER_ORIGIN}${TARGET_PATH}`;
const VERSION_OVERRIDE_HEADER = 'Cloudflare-Workers-Version-Overrides';

// SUN-1222C-R6: the candidate under qualification used to be a hardcoded
// module constant here. SUN-1222C-R4-DEPLOYMENT-RETRY superseded it
// (a064477f -> ade29047) without this file ever being updated, and the
// harness had no way to notice -- it would have silently kept targeting a
// stale, possibly-decommissioned immutable version indefinitely. There is
// deliberately no fallback default: whoever runs this must supply the
// exact candidate read fresh from live deployment state (`wrangler
// deployments list --name siteborne-utility-edge`), every run.
const CANDIDATE_VERSION_ENV_VAR = 'COMPANY_EVIDENCE_CANDIDATE_VERSION_ID';
const CLOUDFLARE_VERSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Known current production version (SUN-1221G promotion) -- a safety rail,
// not an operating default: this harness must refuse outright if ever
// pointed at production instead of a 0%-traffic candidate, rather than
// silently sending a real payment through 100% live traffic.
const KNOWN_PRODUCTION_VERSION_ID = 'db7054c9-76ee-4830-aabe-8a4542261b6a';

/**
 * SUN-1222C-R6: resolve the candidate version ID explicitly from the
 * environment at the moment of the run -- never a hardcoded literal. Throws
 * (fails closed, before any network call) if unset or shaped wrong.
 */
export function resolveCandidateVersionId(env: Record<string, string | undefined>): string {
  const raw = env[CANDIDATE_VERSION_ENV_VAR];
  if (!raw || raw.trim().length === 0) {
    throw new Error(
      `${CANDIDATE_VERSION_ENV_VAR} must be set to the exact candidate version under ` +
        'qualification, read fresh from `wrangler deployments list --name ' +
        'siteborne-utility-edge` -- never assume a previous run\'s candidate is still current.'
    );
  }
  const value = raw.trim();
  if (!CLOUDFLARE_VERSION_ID_PATTERN.test(value)) {
    throw new Error(
      `${CANDIDATE_VERSION_ENV_VAR} "${value}" does not look like a Cloudflare version ID ` +
        '(expected UUID shape).'
    );
  }
  return value;
}

function buildVersionOverrideHeaderValue(candidateVersionId: string): string {
  return `${WORKER_SCRIPT_NAME}="${candidateVersionId}"`;
}

const EXPECTED_NETWORK = 'eip155:8453';
const EXPECTED_ASSET = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const EXPECTED_AMOUNT_ATOMIC = '31200';
const EXPECTED_PAYTO = '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1';
const EXPECTED_BUYER = '0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99';
const EXPECTED_EIP712_NAME = 'USD Coin';
const EXPECTED_EIP712_VERSION = '2';

const SERVICE_PAYMENT_USD = 0.0312;
const EXPECTED_PAYER_BORNE_NETWORK_FEE_USD = 0;
const MAX_TOTAL_PAYER_EXPOSURE_USD = 0.25;

/** Canonical request body frozen by SUN-1222C2-Q1's own §9 (canonical
 * request body derivation): a stable, well-known, fully public SEC filer
 * (Apple Inc., CIK 0000320193) so the real `SecSubmissionsAdapter` path is
 * genuinely exercised, restricted to two low-fan-out field groups
 * (`identity`, `sec_submissions` — no `website_evidence`/`buyer_urls`
 * arbitrary-URL egress, no `recent_filings`/`xbrl_facts`/
 * `regulatory_mentions`/`public_repository_signals`) so the request is
 * bounded rather than cost/fan-out-maximizing. Independently validated
 * schema-valid against the real precompiled
 * `apps/edge-api/src/generated/input-validators.generated.js` validator
 * for `company-evidence-input.schema.json` before this file was written.
 * Not CLI-overridable. */
const CANONICAL_REQUEST_BODY = Object.freeze({
  company_name: 'Apple Inc.',
  identifiers: Object.freeze({ cik: '0000320193' }),
  requested_field_groups: Object.freeze(['identity', 'sec_submissions']),
});

const RUN_LOCAL_COMPANY_EVIDENCE_FIRST_PAID_E2E_ENV_VAR =
  'RUN_LOCAL_COMPANY_EVIDENCE_FIRST_PAID_E2E';

// ---------------------------------------------------------------------------
export type FirstPaidE2EStage =
  // SUN-1222C-R6: added ahead of 'PRE_CHALLENGE'. SUN-1222C-R5 proved a
  // fully-deployed, price-coherent, reachable candidate can still have
  // every paid route return 404 because its activation/cutover vars were
  // silently dropped on upload -- this stage is a non-economic gate the
  // harness must clear before it will attempt any part of the payment
  // flow, including the "just a 402" unpaid probe.
  | 'ACTIVATION_CHECK'
  | 'PRE_CHALLENGE'
  | 'CHALLENGE_RECEIVED'
  | 'CHALLENGE_VALIDATED'
  | 'PAYMENT_MATERIAL_CREATED'
  | 'PAID_REQUEST_SUBMITTED'
  | 'RESULT_OBSERVED';

const STAGES_AFTER_ACTIVATION_CHECK: ReadonlySet<FirstPaidE2EStage> = new Set([
  'PRE_CHALLENGE',
  'CHALLENGE_RECEIVED',
  'CHALLENGE_VALIDATED',
  'PAYMENT_MATERIAL_CREATED',
  'PAID_REQUEST_SUBMITTED',
  'RESULT_OBSERVED',
]);

// SUN-1222C-R4: 'application_error' is a NEW, distinct value from
// 'ambiguous' -- see `classifySubmissionOutcome`'s own doc comment. It is
// NOT a synonym for 'rejected' (which stays reserved for the payment-layer
// 402 case): a 5xx-with-a-parseable-SITEBORNE-body is an authoritative
// service-execution failure, a different economic/operational signal than
// a settlement-layer rejection.
export type SubmissionResult = 'success' | 'rejected' | 'ambiguous' | 'application_error';

export interface FirstPaidE2ESanitizedResult {
  ok: boolean;
  stage: FirstPaidE2EStage;
  failure_reason?: string;
  challenge_received: boolean;
  challenge_validated: boolean;
  payment_material_created: boolean;
  paid_request_submitted: boolean;
  submission_result?: SubmissionResult;
  http_status?: number;
  service_execution_observed?: boolean;
  settlement_observed?: boolean;
  transaction_hash?: string;
  receipt_id?: string;
  // SUN-1222C-R4: surfaced for ANY authoritative HTTP response whose body
  // parses as SITEBORNE's `{error, message, details?}` shape -- not gated
  // on `submission_result === 'success'` (SUN-1222C-R4-D1's proven gap: a
  // real application-generated 502 body was being parsed and then silently
  // discarded, never reaching this printed result at all).
  application_error_code?: string;
  application_error_detail?: string;
}

export interface CallBudgetCounters {
  activationProbeRequests: number;
  unpaid402Requests: number;
  cdpGetAccountCalls: number;
  paymentSignTypedDataCalls: number;
  paymentPayloadsCreated: number;
  paymentSignatureHeadersCreated: number;
  paidRequestSubmissions: number;
}

function freshCounters(): CallBudgetCounters {
  return {
    activationProbeRequests: 0,
    unpaid402Requests: 0,
    cdpGetAccountCalls: 0,
    paymentSignTypedDataCalls: 0,
    paymentPayloadsCreated: 0,
    paymentSignatureHeadersCreated: 0,
    paidRequestSubmissions: 0,
  };
}

export interface LocalFirstPaidE2EAccount {
  address: string;
  signTypedData(options: Record<string, unknown>): Promise<`0x${string}`>;
}

export interface LocalFirstPaidE2ECdpClient {
  evm: { getAccount(args: { address: string }): Promise<LocalFirstPaidE2EAccount> };
}

export interface LocalFirstPaidE2ECredentials {
  apiKeyId: string;
  apiKeySecret: string;
  walletSecret: string;
}

export interface FirstPaidE2EDeps {
  fetchImpl: typeof fetch;
  cdpClient: LocalFirstPaidE2ECdpClient;
  fromCdpEvmAccountImpl: (account: LocalFirstPaidE2EAccount) => unknown;
  createExactEvmPaymentPayload: (
    signer: unknown,
    x402Version: number,
    paymentRequirements: PaymentRequirements
  ) => Promise<{
    x402Version: number;
    payload: Record<string, unknown>;
    extensions?: Record<string, unknown>;
  }>;
  decodePaymentRequiredHeaderSafeImpl: typeof decodePaymentRequiredHeaderSafe;
  encodePaymentSignatureHeaderSafeImpl: typeof encodePaymentSignatureHeaderSafe;
  decodePaymentResponseHeaderSafeImpl: typeof decodePaymentResponseHeaderSafe;
  generatePaymentIdentifierImpl: () => string;
}

function fail(
  counters: CallBudgetCounters,
  stage: FirstPaidE2EStage,
  reason: string,
  partial: Partial<FirstPaidE2ESanitizedResult> = {}
): { result: FirstPaidE2ESanitizedResult; counters: CallBudgetCounters } {
  return {
    counters,
    result: {
      ok: false,
      stage,
      failure_reason: reason,
      challenge_received: STAGES_AFTER_ACTIVATION_CHECK.has(stage) && stage !== 'PRE_CHALLENGE',
      challenge_validated:
        stage === 'CHALLENGE_VALIDATED' ||
        stage === 'PAYMENT_MATERIAL_CREATED' ||
        stage === 'PAID_REQUEST_SUBMITTED' ||
        stage === 'RESULT_OBSERVED',
      payment_material_created:
        stage === 'PAYMENT_MATERIAL_CREATED' ||
        stage === 'PAID_REQUEST_SUBMITTED' ||
        stage === 'RESULT_OBSERVED',
      paid_request_submitted: stage === 'PAID_REQUEST_SUBMITTED' || stage === 'RESULT_OBSERVED',
      ...partial,
    },
  };
}

export function validateChallengeAgainstExpectations(
  requirement: PaymentRequirements
): { ok: true } | { ok: false; reason: string } {
  if (requirement.network !== EXPECTED_NETWORK) {
    return {
      ok: false,
      reason: `network mismatch: expected ${EXPECTED_NETWORK}, got ${requirement.network}`,
    };
  }
  if (requirement.asset.toLowerCase() !== EXPECTED_ASSET.toLowerCase()) {
    return {
      ok: false,
      reason: `asset mismatch: expected ${EXPECTED_ASSET}, got ${requirement.asset}`,
    };
  }
  if (requirement.amount !== EXPECTED_AMOUNT_ATOMIC) {
    return {
      ok: false,
      reason: `amount mismatch: expected exactly ${EXPECTED_AMOUNT_ATOMIC} atomic, got ${requirement.amount}`,
    };
  }
  if (requirement.payTo.toLowerCase() !== EXPECTED_PAYTO.toLowerCase()) {
    return {
      ok: false,
      reason: `payTo mismatch: expected ${EXPECTED_PAYTO}, got ${requirement.payTo}`,
    };
  }
  const extra = requirement.extra as Record<string, unknown> | undefined;
  const name = extra?.name;
  const version = extra?.version;
  if (name !== EXPECTED_EIP712_NAME || version !== EXPECTED_EIP712_VERSION) {
    return {
      ok: false,
      reason:
        `EIP-712 domain mismatch in requirement.extra: expected name="${EXPECTED_EIP712_NAME}" ` +
        `version="${EXPECTED_EIP712_VERSION}", got name=${JSON.stringify(name)} version=${JSON.stringify(version)}`,
    };
  }
  return { ok: true };
}

export function checkExposureWithinCap(): { ok: true } | { ok: false; reason: string } {
  const totalExposure = SERVICE_PAYMENT_USD + EXPECTED_PAYER_BORNE_NETWORK_FEE_USD;
  if (totalExposure > MAX_TOTAL_PAYER_EXPOSURE_USD) {
    return {
      ok: false,
      reason: `expected exposure ${totalExposure} USD exceeds MAX_TOTAL_PAYER_EXPOSURE_USD ${MAX_TOTAL_PAYER_EXPOSURE_USD}`,
    };
  }
  return { ok: true };
}

export interface ActivationCheckResult {
  ok: boolean;
  reason?: string;
}

const QUALIFICATION_SERVICE_ID = 'company_evidence_graph.v2';

/**
 * SUN-1222C-R6: non-economic pre-payment activation gate. SUN-1222C-R5
 * proved a fully-deployed, price-coherent, publicly-reachable candidate can
 * still have every paid route return 404 because a bare `wrangler versions
 * upload` silently drops the 10 activation/cutover vars (`PAID_ROUTES_ENABLED`
 * and 9 siblings) that `wrangler.toml`'s own [vars] comment says are
 * deliberately absent from the frozen candidate and must be supplied by a
 * separate, explicit deployment step. One GET to the candidate's own
 * `/catalog` (no body, no payment header, no economic effect whatsoever)
 * must show the target service both `production_enabled` and
 * `production_ready` before this harness will attempt a single dollar of
 * real payment flow.
 */
export async function verifyCandidateActivation(
  fetchImpl: typeof fetch,
  candidateVersionId: string,
  serviceId: string = QUALIFICATION_SERVICE_ID
): Promise<ActivationCheckResult> {
  let res: Response;
  try {
    res = await fetchImpl(`${WORKER_ORIGIN}/catalog`, {
      method: 'GET',
      headers: {
        [VERSION_OVERRIDE_HEADER]: buildVersionOverrideHeaderValue(candidateVersionId),
      },
    });
  } catch (err) {
    return { ok: false, reason: `network error fetching /catalog: ${String(err)}` };
  }
  if (res.status !== 200) {
    return { ok: false, reason: `expected HTTP 200 from /catalog, got ${res.status}` };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    return { ok: false, reason: `/catalog response was not valid JSON: ${String(err)}` };
  }
  const services = (body as { services?: Array<Record<string, unknown>> })?.services;
  const entry = Array.isArray(services)
    ? services.find((s) => s.service_id === serviceId)
    : undefined;
  if (!entry) {
    return { ok: false, reason: `/catalog has no entry for service_id "${serviceId}"` };
  }
  if (entry.production_enabled !== true) {
    return {
      ok: false,
      reason:
        `${serviceId} production_enabled is not true (got ${JSON.stringify(entry.production_enabled)}) ` +
        '-- candidate is likely missing its activation/cutover vars (see SUN-1222C-R5)',
    };
  }
  if (entry.production_ready !== true) {
    return {
      ok: false,
      reason:
        `${serviceId} production_ready is not true (got ${JSON.stringify(entry.production_ready)}) ` +
        '-- candidate is likely missing its activation/cutover vars (see SUN-1222C-R5)',
    };
  }
  return { ok: true };
}

export async function runFirstPaidE2E(
  deps: FirstPaidE2EDeps,
  candidateVersionId: string
): Promise<{ result: FirstPaidE2ESanitizedResult; counters: CallBudgetCounters }> {
  const counters = freshCounters();
  let stage: FirstPaidE2EStage = 'ACTIVATION_CHECK';

  if (candidateVersionId.trim().toLowerCase() === KNOWN_PRODUCTION_VERSION_ID.toLowerCase()) {
    return fail(
      counters,
      'ACTIVATION_CHECK',
      'refusing to target known production version ID directly -- this harness qualifies ' +
        '0%-traffic candidates only, never production'
    );
  }

  counters.activationProbeRequests += 1;
  const activation = await verifyCandidateActivation(deps.fetchImpl, candidateVersionId);
  if (!activation.ok) {
    return fail(
      counters,
      'ACTIVATION_CHECK',
      activation.reason ?? 'candidate activation check failed'
    );
  }
  stage = 'PRE_CHALLENGE';

  const versionOverrideHeaderValue = buildVersionOverrideHeaderValue(candidateVersionId);

  counters.unpaid402Requests += 1;
  let challengeRes: Response;
  try {
    challengeRes = await deps.fetchImpl(TARGET_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [VERSION_OVERRIDE_HEADER]: versionOverrideHeaderValue,
      },
      body: JSON.stringify(CANONICAL_REQUEST_BODY),
    });
  } catch (err) {
    return fail(counters, 'PRE_CHALLENGE', `network error obtaining 402: ${String(err)}`);
  }
  if (challengeRes.status !== 402) {
    return fail(counters, 'PRE_CHALLENGE', `expected HTTP 402, got ${challengeRes.status}`, {
      http_status: challengeRes.status,
    });
  }

  const headerValue = challengeRes.headers.get('PAYMENT-REQUIRED') ?? '';
  const decoded = deps.decodePaymentRequiredHeaderSafeImpl(headerValue);
  if (!decoded.ok) {
    return fail(counters, 'PRE_CHALLENGE', `malformed PAYMENT-REQUIRED: ${decoded.reason}`);
  }
  const challenge: PaymentRequired = decoded.value;
  stage = 'CHALLENGE_RECEIVED';

  if (!Array.isArray(challenge.accepts) || challenge.accepts.length === 0) {
    return fail(counters, stage, 'PAYMENT-REQUIRED has no accepts[] entries');
  }
  const requirement = challenge.accepts[0];

  const validation = validateChallengeAgainstExpectations(requirement);
  if (!validation.ok) {
    return fail(counters, stage, validation.reason);
  }

  const exposureCheck = checkExposureWithinCap();
  if (!exposureCheck.ok) {
    return fail(counters, stage, exposureCheck.reason);
  }
  stage = 'CHALLENGE_VALIDATED';

  counters.cdpGetAccountCalls += 1;
  let account: LocalFirstPaidE2EAccount;
  try {
    account = await deps.cdpClient.evm.getAccount({ address: EXPECTED_BUYER });
  } catch (err) {
    return fail(counters, stage, `cdp.evm.getAccount failed: ${String(err)}`);
  }
  if (account.address.toLowerCase() !== EXPECTED_BUYER.toLowerCase()) {
    return fail(counters, stage, 'resolved account address does not match the controlled buyer');
  }

  const signer = deps.fromCdpEvmAccountImpl(account);

  counters.paymentPayloadsCreated += 1;
  let payloadResult: {
    x402Version: number;
    payload: Record<string, unknown>;
    extensions?: Record<string, unknown>;
  };
  try {
    payloadResult = await deps.createExactEvmPaymentPayload(
      signer,
      challenge.x402Version,
      requirement
    );
  } catch (err) {
    return fail(counters, stage, `createPaymentPayload failed: ${String(err)}`);
  }
  counters.paymentSignTypedDataCalls += 1;
  stage = 'PAYMENT_MATERIAL_CREATED';

  const identifierExtensions = deps.generatePaymentIdentifierImpl
    ? buildBuyerPaymentIdentifierExtensions(
        { ...(challenge.extensions ?? {}), ...(payloadResult.extensions ?? {}) },
        deps.generatePaymentIdentifierImpl()
      )
    : { ...(challenge.extensions ?? {}), ...(payloadResult.extensions ?? {}) };

  const fullPayload: PaymentPayload = {
    x402Version: payloadResult.x402Version,
    resource: challenge.resource,
    accepted: requirement,
    payload: payloadResult.payload,
    extensions: identifierExtensions,
  };

  counters.paymentSignatureHeadersCreated += 1;
  const signatureHeader = deps.encodePaymentSignatureHeaderSafeImpl(fullPayload);

  counters.paidRequestSubmissions += 1;
  let paidRes: Response;
  try {
    paidRes = await deps.fetchImpl(TARGET_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'PAYMENT-SIGNATURE': signatureHeader,
        [VERSION_OVERRIDE_HEADER]: versionOverrideHeaderValue,
      },
      body: JSON.stringify(CANONICAL_REQUEST_BODY),
    });
  } catch (err) {
    return fail(
      counters,
      'PAID_REQUEST_SUBMITTED',
      `network error after submission: ${String(err)}`,
      {
        submission_result: 'ambiguous',
      }
    );
  }
  stage = 'PAID_REQUEST_SUBMITTED';

  let serviceExecutionObserved: boolean | undefined;
  let settlementObserved: boolean | undefined;
  let transactionHash: string | undefined;
  let receiptId: string | undefined;
  let responseBody: Record<string, unknown> | undefined;

  try {
    responseBody = (await paidRes.clone().json()) as Record<string, unknown>;
  } catch {
    responseBody = undefined;
  }

  // SUN-1222C-R4: a body that parses as JSON AND matches SITEBORNE's own
  // `{error, message, details?}` shape (`jsonError` in `x402-service.ts`)
  // is an AUTHORITATIVE application response, not transport ambiguity --
  // regardless of HTTP status. A response that fails to parse, or parses
  // but has neither field, stays conservatively 'ambiguous' for any 5xx
  // (§12: protect true ambiguity).
  const hasApplicationErrorShape =
    responseBody !== undefined &&
    (typeof responseBody.error === 'string' || typeof responseBody.message === 'string');
  const submissionResult = classifySubmissionOutcome(paidRes.status, hasApplicationErrorShape);

  const applicationErrorCode =
    hasApplicationErrorShape && typeof responseBody?.error === 'string'
      ? responseBody.error
      : undefined;
  let applicationErrorDetail =
    hasApplicationErrorShape && typeof responseBody?.details === 'string'
      ? responseBody.details
      : hasApplicationErrorShape && typeof responseBody?.message === 'string'
        ? responseBody.message
        : undefined;
  // Harness-side belt-and-suspenders bound, mirroring the Workflow-side
  // `ERROR_DETAIL_MAX_LENGTH` bound -- this harness must never print an
  // unbounded upstream body even if some future response shape changes.
  const APPLICATION_ERROR_DETAIL_MAX_LENGTH = 500;
  if (
    applicationErrorDetail !== undefined &&
    applicationErrorDetail.length > APPLICATION_ERROR_DETAIL_MAX_LENGTH
  ) {
    applicationErrorDetail = `${applicationErrorDetail.slice(0, APPLICATION_ERROR_DETAIL_MAX_LENGTH)}…(truncated)`;
  }

  if (submissionResult === 'success') {
    serviceExecutionObserved = responseBody?.result_class !== undefined;
    receiptId = typeof responseBody?.receipt_id === 'string' ? responseBody.receipt_id : undefined;
    const settleHeader = paidRes.headers.get('PAYMENT-RESPONSE');
    if (settleHeader) {
      const decodedSettle = deps.decodePaymentResponseHeaderSafeImpl(settleHeader);
      if (decodedSettle.ok) {
        settlementObserved = decodedSettle.value.success === true;
        transactionHash =
          typeof decodedSettle.value.transaction === 'string'
            ? decodedSettle.value.transaction
            : undefined;
      }
    }
  }

  stage = 'RESULT_OBSERVED';

  return {
    counters,
    result: {
      ok: submissionResult === 'success',
      stage,
      challenge_received: true,
      challenge_validated: true,
      payment_material_created: true,
      paid_request_submitted: true,
      submission_result: submissionResult,
      http_status: paidRes.status,
      ...(serviceExecutionObserved !== undefined
        ? { service_execution_observed: serviceExecutionObserved }
        : {}),
      ...(settlementObserved !== undefined ? { settlement_observed: settlementObserved } : {}),
      ...(transactionHash ? { transaction_hash: transactionHash } : {}),
      ...(receiptId ? { receipt_id: receiptId } : {}),
      ...(applicationErrorCode !== undefined
        ? { application_error_code: applicationErrorCode }
        : {}),
      ...(applicationErrorDetail !== undefined
        ? { application_error_detail: applicationErrorDetail }
        : {}),
    },
  };
}

/**
 * SUN-1222C-R4: `hasApplicationErrorShape` distinguishes an authoritative
 * application response (a received HTTP response whose body parses as
 * SITEBORNE's own `{error, message, details?}` JSON shape) from genuine
 * transport-level ambiguity (no HTTP response at all — the caller's own
 * `catch` block for a thrown network error never reaches this function;
 * or a response that fails to parse as JSON, or parses but matches neither
 * field). A 5xx with a recognized application body is a known,
 * classifiable failure — it must not collapse into the same 'ambiguous'
 * bucket as a socket failure or truncated response.
 */
export function classifySubmissionOutcome(
  httpStatus: number,
  hasApplicationErrorShape = false
): SubmissionResult {
  if (httpStatus === 200) return 'success';
  if (httpStatus === 402) return 'rejected';
  if (httpStatus >= 500) return hasApplicationErrorShape ? 'application_error' : 'ambiguous';
  return hasApplicationErrorShape ? 'application_error' : 'ambiguous';
}

function buildRealDeps(credentials: LocalFirstPaidE2ECredentials): FirstPaidE2EDeps {
  const cdpClient = new CdpClient({
    apiKeyId: credentials.apiKeyId,
    apiKeySecret: credentials.apiKeySecret,
    walletSecret: credentials.walletSecret,
  });
  return {
    fetchImpl: fetch,
    cdpClient: cdpClient as unknown as LocalFirstPaidE2ECdpClient,
    fromCdpEvmAccountImpl: (account) =>
      fromCdpEvmAccount(account as unknown as Parameters<typeof fromCdpEvmAccount>[0]),
    createExactEvmPaymentPayload: (signer, x402Version, paymentRequirements) =>
      new ExactEvmScheme(signer as never).createPaymentPayload(x402Version, paymentRequirements),
    decodePaymentRequiredHeaderSafeImpl: decodePaymentRequiredHeaderSafe,
    encodePaymentSignatureHeaderSafeImpl: encodePaymentSignatureHeaderSafe,
    decodePaymentResponseHeaderSafeImpl: decodePaymentResponseHeaderSafe,
    generatePaymentIdentifierImpl: generateSiteborneePaymentId,
  };
}

// ---------------------------------------------------------------------------
// Unit test matrix — mirrors first-paid-e2e-local.test.ts's /
// web-context-first-paid-e2e-local.test.ts's core safety properties
// (network/asset/amount/payTo/EIP-712-domain validation before signing,
// buyer-match enforcement, single-shot budget, no retry on ambiguity, no
// signature leakage). Zero network calls.
// ---------------------------------------------------------------------------

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function validRequirement(overrides: Partial<PaymentRequirements> = {}): PaymentRequirements {
  return {
    scheme: 'exact',
    network: EXPECTED_NETWORK,
    asset: EXPECTED_ASSET,
    amount: EXPECTED_AMOUNT_ATOMIC,
    payTo: EXPECTED_PAYTO,
    maxTimeoutSeconds: 60,
    extra: {
      quote_id: 'quote_test_1',
      name: EXPECTED_EIP712_NAME,
      version: EXPECTED_EIP712_VERSION,
    },
    ...overrides,
  };
}

function validChallenge(requirement: PaymentRequirements = validRequirement()): PaymentRequired {
  return {
    x402Version: 2,
    resource: { url: TARGET_URL },
    accepts: [requirement],
    extensions: {},
  };
}

function encodeChallenge(challenge: PaymentRequired): string {
  return Buffer.from(JSON.stringify(challenge), 'utf-8').toString('base64');
}

function mockAccount(address = EXPECTED_BUYER): LocalFirstPaidE2EAccount {
  return {
    address,
    signTypedData: async () => `0x${'11'.repeat(65)}`,
  };
}

function baseDeps(overrides: Partial<FirstPaidE2EDeps> = {}): FirstPaidE2EDeps {
  return {
    fetchImpl: vi.fn(),
    cdpClient: { evm: { getAccount: vi.fn(async () => mockAccount()) } },
    fromCdpEvmAccountImpl: vi.fn((account) => account),
    createExactEvmPaymentPayload: vi.fn(async () => ({
      x402Version: 2,
      payload: { authorization: {}, signature: '0x' + '11'.repeat(65) },
    })),
    decodePaymentRequiredHeaderSafeImpl: decodePaymentRequiredHeaderSafe,
    encodePaymentSignatureHeaderSafeImpl: vi.fn(() => 'sig-header-stub'),
    decodePaymentResponseHeaderSafeImpl: decodePaymentResponseHeaderSafe,
    generatePaymentIdentifierImpl: () => 'test-payment-id-000000000000000000000000000001',
    ...overrides,
  };
}

// SUN-1222C-R6: a stable, obviously-fake candidate for unit tests -- never
// a value this harness would treat as a real operating default (there is
// none; see `resolveCandidateVersionId`).
const TEST_CANDIDATE_VERSION_ID = 'aaaaaaaa-1111-2222-3333-444444444444';

function activationOkResponse(serviceId: string = QUALIFICATION_SERVICE_ID): Response {
  return jsonResponse(200, {
    services: [{ service_id: serviceId, production_enabled: true, production_ready: true }],
  });
}

/** Activation probe (GET /catalog) -> 402 -> paid response. */
function threeStepFetch(
  challenge: PaymentRequired,
  paidResponse: Response
): ReturnType<typeof vi.fn> {
  let call = 0;
  return vi.fn(async () => {
    call += 1;
    if (call === 1) return activationOkResponse();
    if (call === 2) {
      return jsonResponse(
        402,
        { error: 'payment_required' },
        { 'PAYMENT-REQUIRED': encodeChallenge(challenge) }
      );
    }
    return paidResponse;
  });
}

describe('SUN-1222C2-Q1 company-evidence first-paid-e2e local client (unit, always run)', () => {
  it('fails before any network call when CDP credentials are absent', () => {
    expect(
      hasAllRequiredCredentials({
        CDP_API_KEY_ID: undefined,
        CDP_API_KEY_SECRET: 'x',
        CDP_WALLET_SECRET: 'y',
      })
    ).toBe(false);
    expect(
      hasAllRequiredCredentials({
        CDP_API_KEY_ID: 'x',
        CDP_API_KEY_SECRET: 'y',
        CDP_WALLET_SECRET: 'z',
      })
    ).toBe(true);
  });

  // ---------------------------------------------------------------------
  // SUN-1222C-R6: candidate targeting must never be silently hardcoded.
  // ---------------------------------------------------------------------

  it('SUN-1222C-R6: throws when no candidate version is supplied, with no hardcoded fallback', () => {
    expect(() => resolveCandidateVersionId({})).toThrow(/COMPANY_EVIDENCE_CANDIDATE_VERSION_ID/);
    expect(() =>
      resolveCandidateVersionId({ COMPANY_EVIDENCE_CANDIDATE_VERSION_ID: '' })
    ).toThrow();
    expect(() =>
      resolveCandidateVersionId({ COMPANY_EVIDENCE_CANDIDATE_VERSION_ID: 'not-a-uuid' })
    ).toThrow(/does not look like a Cloudflare version ID/);
  });

  it('SUN-1222C-R6: resolves exactly the supplied candidate version, proving there is no fixed default', () => {
    const a = resolveCandidateVersionId({
      COMPANY_EVIDENCE_CANDIDATE_VERSION_ID: 'aaaaaaaa-1111-2222-3333-444444444444',
    });
    const b = resolveCandidateVersionId({
      COMPANY_EVIDENCE_CANDIDATE_VERSION_ID: 'bbbbbbbb-5555-6666-7777-888888888888',
    });
    expect(a).toBe('aaaaaaaa-1111-2222-3333-444444444444');
    expect(b).toBe('bbbbbbbb-5555-6666-7777-888888888888');
    expect(a).not.toBe(b);
  });

  it('SUN-1222C-R6: refuses to target the known production version ID directly', async () => {
    const fetchImpl = vi.fn();
    const { result, counters } = await runFirstPaidE2E(
      baseDeps({ fetchImpl }),
      KNOWN_PRODUCTION_VERSION_ID
    );
    expect(result.ok).toBe(false);
    expect(result.stage).toBe('ACTIVATION_CHECK');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(counters.unpaid402Requests).toBe(0);
  });

  // ---------------------------------------------------------------------
  // SUN-1222C-R6: pre-payment activation gate. Reproduces the exact
  // SUN-1222C-R5 regression (candidate exists, economics coherent, but the
  // 10 activation/cutover vars are absent -> production_enabled/
  // production_ready both false) and requires the harness to stop before
  // any part of the payment flow -- not merely before signing.
  // ---------------------------------------------------------------------

  it('SUN-1222C-R6: reproduces the SUN-1222C-R5 regression -- stops before 402/signing/payment when production_enabled is false', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        services: [
          { service_id: QUALIFICATION_SERVICE_ID, production_enabled: false, production_ready: false },
        ],
      })
    );
    const { result, counters } = await runFirstPaidE2E(
      baseDeps({ fetchImpl }),
      TEST_CANDIDATE_VERSION_ID
    );
    expect(result.ok).toBe(false);
    expect(result.stage).toBe('ACTIVATION_CHECK');
    expect(result.failure_reason).toMatch(/production_enabled is not true/);
    expect(result.challenge_received).toBe(false);
    expect(result.payment_material_created).toBe(false);
    expect(result.paid_request_submitted).toBe(false);
    expect(counters.unpaid402Requests).toBe(0);
    expect(counters.cdpGetAccountCalls).toBe(0);
    expect(counters.paymentSignTypedDataCalls).toBe(0);
    expect(counters.paidRequestSubmissions).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('SUN-1222C-R6: activation gate also fails closed when production_enabled is true but production_ready is false', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        services: [
          { service_id: QUALIFICATION_SERVICE_ID, production_enabled: true, production_ready: false },
        ],
      })
    );
    const { result } = await runFirstPaidE2E(baseDeps({ fetchImpl }), TEST_CANDIDATE_VERSION_ID);
    expect(result.stage).toBe('ACTIVATION_CHECK');
    expect(result.failure_reason).toMatch(/production_ready is not true/);
  });

  it('SUN-1222C-R6: activation gate fails closed when the service entry is missing from /catalog entirely', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { services: [] }));
    const { result } = await runFirstPaidE2E(baseDeps({ fetchImpl }), TEST_CANDIDATE_VERSION_ID);
    expect(result.stage).toBe('ACTIVATION_CHECK');
    expect(result.failure_reason).toMatch(/no entry for service_id/);
  });

  it('SUN-1222C-R6: activation gate clears and the flow proceeds when production_enabled and production_ready are both true', async () => {
    const fetchImpl = threeStepFetch(
      validChallenge(),
      jsonResponse(200, { result_class: 'success' })
    );
    const { result, counters } = await runFirstPaidE2E(
      baseDeps({ fetchImpl }),
      TEST_CANDIDATE_VERSION_ID
    );
    expect(result.ok).toBe(true);
    expect(counters.activationProbeRequests).toBe(1);
  });

  it('sends exactly one unpaid 402 request before anything else', async () => {
    const fetchImpl = threeStepFetch(
      validChallenge(),
      jsonResponse(200, { result_class: 'success', receipt_id: 'r1' })
    );
    const { counters } = await runFirstPaidE2E(baseDeps({ fetchImpl }), TEST_CANDIDATE_VERSION_ID);
    expect(counters.unpaid402Requests).toBe(1);
  });

  it('a non-402 response to the actual challenge request stops the flow with zero signing', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) return activationOkResponse();
      return jsonResponse(500, { error: 'boom' });
    });
    const { result, counters } = await runFirstPaidE2E(
      baseDeps({ fetchImpl }),
      TEST_CANDIDATE_VERSION_ID
    );
    expect(result.ok).toBe(false);
    expect(result.stage).toBe('PRE_CHALLENGE');
    expect(counters.paymentSignTypedDataCalls).toBe(0);
  });

  it('wrong network/asset/amount/payTo/EIP-712-domain are each rejected before signing', async () => {
    const overrides: Array<Partial<PaymentRequirements>> = [
      { network: 'eip155:1' },
      { asset: '0x0000000000000000000000000000000000dEaD' },
      { amount: '31201' },
      { amount: '31199' },
      { payTo: '0x0000000000000000000000000000000000dEaD' },
      { extra: { quote_id: 'q' } },
    ];
    for (const override of overrides) {
      const challenge = validChallenge(validRequirement(override));
      const fetchImpl = threeStepFetch(challenge, jsonResponse(200, {}));
      const { result, counters } = await runFirstPaidE2E(
        baseDeps({ fetchImpl }),
        TEST_CANDIDATE_VERSION_ID
      );
      expect(result.ok).toBe(false);
      expect(counters.paymentSignTypedDataCalls).toBe(0);
    }
  });

  it('a resolved account address that does not match the controlled buyer never signs', async () => {
    const fetchImpl = threeStepFetch(validChallenge(), jsonResponse(200, {}));
    const deps = baseDeps({
      fetchImpl,
      cdpClient: {
        evm: {
          getAccount: vi.fn(async () => mockAccount('0x000000000000000000000000000000000000aa')),
        },
      },
    });
    const { result, counters } = await runFirstPaidE2E(deps, TEST_CANDIDATE_VERSION_ID);
    expect(result.ok).toBe(false);
    expect(result.failure_reason).toMatch(/does not match the controlled buyer/);
    expect(counters.paymentSignTypedDataCalls).toBe(0);
  });

  it('exposure is within the $0.25 cap for the frozen 0.0312 USD price', () => {
    const result = checkExposureWithinCap();
    expect(result.ok).toBe(true);
  });

  it('PAYMENT-SIGNATURE is submitted exactly once on a fully valid run', async () => {
    const fetchImpl = threeStepFetch(
      validChallenge(),
      jsonResponse(200, { result_class: 'success' })
    );
    const { counters, result } = await runFirstPaidE2E(
      baseDeps({ fetchImpl }),
      TEST_CANDIDATE_VERSION_ID
    );
    expect(counters.paidRequestSubmissions).toBe(1);
    expect(result.ok).toBe(true);
  });

  it('a network failure after submission classifies AMBIGUOUS and never retries', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) return activationOkResponse();
      if (call === 2) {
        return jsonResponse(402, {}, { 'PAYMENT-REQUIRED': encodeChallenge(validChallenge()) });
      }
      throw new Error('simulated timeout');
    });
    const { result, counters } = await runFirstPaidE2E(
      baseDeps({ fetchImpl }),
      TEST_CANDIDATE_VERSION_ID
    );
    expect(result.submission_result).toBe('ambiguous');
    expect(counters.paidRequestSubmissions).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('a 402 after signed submission classifies REJECTED and never retries', async () => {
    const fetchImpl = threeStepFetch(
      validChallenge(),
      jsonResponse(402, { error: 'settlement_rejected' })
    );
    const { result } = await runFirstPaidE2E(baseDeps({ fetchImpl }), TEST_CANDIDATE_VERSION_ID);
    expect(result.submission_result).toBe('rejected');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  // SUN-1222C-R4-D1 proved: an application-generated 502 with a valid,
  // parseable SITEBORNE JSON body (exactly x402-service.ts's own
  // `jsonError` shape) was being bucketed as 'ambiguous' and its body
  // silently discarded -- indistinguishable from a genuine transport
  // failure. It is an authoritative application response, not ambiguity.
  it('SUN-1222C-R4: a 502 with a parseable SITEBORNE error body classifies as application_error and preserves the specific detail, not ambiguous', async () => {
    const fetchImpl = threeStepFetch(
      validChallenge(),
      jsonResponse(502, {
        error: 'service_execution_failed',
        message: 'partial',
        details: 'sec-edgar company_submissions returned permanent_failure for CIK 0000320193',
      })
    );
    const { result } = await runFirstPaidE2E(baseDeps({ fetchImpl }), TEST_CANDIDATE_VERSION_ID);
    expect(result.submission_result).toBe('application_error');
    expect(result.http_status).toBe(502);
    expect(result.application_error_code).toBe('service_execution_failed');
    expect(result.application_error_detail).toBe(
      'sec-edgar company_submissions returned permanent_failure for CIK 0000320193'
    );
  });

  // §4/§13 sanitization + no-message-fallback edge case: `details` absent,
  // only the generic `message` present -- still surfaced (better than
  // nothing), still NOT 'ambiguous'.
  it('SUN-1222C-R4: a 502 with only a generic `message` (no `details`) still classifies as application_error and surfaces the generic message', async () => {
    const fetchImpl = threeStepFetch(
      validChallenge(),
      jsonResponse(502, { error: 'service_execution_failed', message: 'partial' })
    );
    const { result } = await runFirstPaidE2E(baseDeps({ fetchImpl }), TEST_CANDIDATE_VERSION_ID);
    expect(result.submission_result).toBe('application_error');
    expect(result.application_error_code).toBe('service_execution_failed');
    expect(result.application_error_detail).toBe('partial');
  });

  // §12's own explicit requirement: true transport-level ambiguity (a
  // received-but-unparseable body) must remain conservatively classified,
  // never overcorrected into a false 'application_error'.
  it('SUN-1222C-R4: a 5xx with a non-JSON/unparseable body remains classified ambiguous (protects true ambiguity)', async () => {
    const fetchImpl = threeStepFetch(
      validChallenge(),
      new Response('<html>Bad Gateway</html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      })
    );
    const { result } = await runFirstPaidE2E(baseDeps({ fetchImpl }), TEST_CANDIDATE_VERSION_ID);
    expect(result.submission_result).toBe('ambiguous');
    expect(result.application_error_code).toBeUndefined();
    expect(result.application_error_detail).toBeUndefined();
  });

  it('payment material never appears in the returned result', async () => {
    const fetchImpl = threeStepFetch(
      validChallenge(),
      jsonResponse(200, { result_class: 'success' })
    );
    const { result } = await runFirstPaidE2E(baseDeps({ fetchImpl }), TEST_CANDIDATE_VERSION_ID);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/signature/i);
    expect(serialized).not.toMatch(/authorization/i);
  });

  it('the target URL, body, amount, payTo, network, and buyer are fixed module constants', () => {
    expect(TARGET_URL).toBe(`${WORKER_ORIGIN}${TARGET_PATH}`);
    expect(CANONICAL_REQUEST_BODY).toEqual({
      company_name: 'Apple Inc.',
      identifiers: { cik: '0000320193' },
      requested_field_groups: ['identity', 'sec_submissions'],
    });
    expect(EXPECTED_AMOUNT_ATOMIC).toBe('31200');
    expect(EXPECTED_PAYTO).toBe('0x7f44a2dd237938F18632d4CcA40f4c690295E6E1');
    expect(EXPECTED_NETWORK).toBe('eip155:8453');
    expect(EXPECTED_BUYER).toBe('0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99');
  });

  it('the activation probe, unpaid, and paid requests all carry the identical, quoted Cloudflare-Workers-Version-Overrides value for the supplied candidate', async () => {
    const fetchImpl = threeStepFetch(
      validChallenge(),
      jsonResponse(200, { result_class: 'success' })
    );
    const deps = baseDeps({ fetchImpl });
    await runFirstPaidE2E(deps, TEST_CANDIDATE_VERSION_ID);
    const calls = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(3);
    const expectedHeaderValue = `${WORKER_SCRIPT_NAME}="${TEST_CANDIDATE_VERSION_ID}"`;
    for (const call of calls) {
      const headers = (call[1] as RequestInit).headers as Record<string, string>;
      expect(headers[VERSION_OVERRIDE_HEADER]).toBe(expectedHeaderValue);
    }
  });

  it('the production Worker bundle has no reachable import path to this file (grep proof)', async () => {
    const { execFileSync } = await import('node:child_process');
    const repoRoot = new URL('../../../../', import.meta.url).pathname;
    let matches = '';
    try {
      matches = execFileSync(
        'grep',
        ['-rl', 'company-evidence-first-paid-e2e-local', 'apps/edge-api/src'],
        { cwd: repoRoot, encoding: 'utf-8' }
      );
    } catch (err: unknown) {
      matches = (err as { stdout?: string }).stdout ?? '';
    }
    expect(matches.trim()).toBe('');
  });
});

// ---------------------------------------------------------------------------
// The one live-credentialed test. Skipped by default in every normal run.
// This file does NOT itself authorize running it live — running it is the
// exact action SUN-1222C2-Q1's authorization delegates to the human
// operator (§15: the coding agent must not sign or submit; the human runs
// this one-shot command in their own terminal).
// ---------------------------------------------------------------------------

describe.skipIf(!process.env[RUN_LOCAL_COMPANY_EVIDENCE_FIRST_PAID_E2E_ENV_VAR])(
  'SUN-1222C2-Q1 company-evidence first-paid-e2e local client (LIVE, credential-gated)',
  () => {
    it('runs the real, single, authorized company-evidence first-paid-E2E attempt', async () => {
      const apiKeyId = process.env.CDP_API_KEY_ID ?? '';
      const apiKeySecret = process.env.CDP_API_KEY_SECRET ?? '';
      const walletSecret = process.env.CDP_WALLET_SECRET ?? '';
      if (!apiKeyId || !apiKeySecret || !walletSecret) {
        throw new Error('CDP_API_KEY_ID / CDP_API_KEY_SECRET / CDP_WALLET_SECRET must all be set');
      }
      // SUN-1222C-R6: no hardcoded candidate -- must be supplied fresh, every
      // run, read from live deployment state at the moment of the attempt.
      const candidateVersionId = resolveCandidateVersionId(process.env);
      const deps = buildRealDeps({ apiKeyId, apiKeySecret, walletSecret });
      const { result } = await runFirstPaidE2E(deps, candidateVersionId);
      // eslint-disable-next-line no-console -- the one authorized, sanitized output surface.
      console.log(JSON.stringify(result));
      expect(result.stage).toBeDefined();
    }, 120_000);
    // ^ SUN-1221E6R-H2B precedent: Vitest's 5000ms default timeout killed a
    // prior sibling client mid-flight (job de147124) while the real
    // CDP-signing + HTTP round trip (executor, up to Modal's own hard
    // timeout, + PCC + settlement) legitimately took longer. Never rely on
    // the default here.
  }
);
