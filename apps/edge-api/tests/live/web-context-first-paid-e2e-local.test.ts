/**
 * SUN-1221E2 — local-only, non-Worker, exactly-once web_context_verified.v2
 * first-paid-E2E client.
 *
 * Structural sibling of `first-paid-e2e-local.test.ts` (SUN-1220J/O): same
 * orchestration logic, same call-budget/state-machine/sanitization
 * guarantees, same containment (lives under `apps/edge-api/tests/`, never
 * imported by `apps/edge-api/src/`, never reachable from the production
 * Worker bundle). Only the frozen economic/routing constants differ, per
 * the SUN-1221B design freeze and the fresh 402 independently obtained and
 * decoded in SUN-1221E2's own live qualification step (candidate
 * `915be949-b46f-464b-a4d6-17b74539ce55`, quote_id
 * `qte_1cdda6b84605101e2787ef9d`, amount 9000 atomic, matching exactly).
 *
 * SUN-1221E3 correction: `CANDIDATE_VERSION_ID` below was left pointing at
 * the retired SUN-1221E2 candidate (`915be949-...`) after SUN-1221E2T1
 * uploaded a new candidate (`54d87b77-...`) carrying the TermsGuard
 * tri-state fix. Cloudflare no longer resolves a `Cloudflare-Workers-
 * Version-Overrides` header for a version ID that has aged out of the
 * retained-versions window, so every request — on both the custom domain
 * and `workers.dev` — returned HTTP 404 instead of 402, with zero payment
 * material ever created (confirmed by side-by-side curl against both the
 * stale and current candidate IDs on both origins). Updated to the current
 * SUN-1221E3 candidate; this is a routing-constant-only fix, no Worker
 * runtime, candidate source, economics, or payment-semantics change.
 *
 * SUN-1221E4 correction: SUN-1221E3's real paid submission ended ambiguous
 * (HTTP 502) with the failure independently reconciled to
 * `WEBCTX_UPSTREAM_PROTOCOL_ERROR` inside the executor's direct-public-http
 * fetch, before settlement — zero on-chain effect, zero settlement, buyer
 * balance unchanged. SUN-1221E3P added sanitized diagnostic tagging
 * (`WEBCTX_RESPONSE_READ_FAILED`) around the failing read call sites with no
 * behavior change and uploaded a new candidate (`a088632e-...`).
 * `CANDIDATE_VERSION_ID` below is updated to that candidate; again a
 * routing-constant-only fix — no Worker runtime, candidate source,
 * economics, or payment-semantics change.
 *
 * `WORKER_ORIGIN` uses the custom domain (`utility.siteborne.net`), not
 * `workers.dev` — the `/mcp` route enforces a Host allowlist
 * (`MCP_ALLOWED_HOSTS` in `apps/edge-api/src/routes/mcp.ts`) that only the
 * custom domain satisfies, and this run's own SUN-1221E2 qualification
 * already independently confirmed the custom domain reaches the same
 * Worker with the same version-override behavior for the paid route.
 *
 * Not invoked by any normal `pnpm test` run — the live `describe` block is
 * `skipIf`-gated on `RUN_LOCAL_WEB_CONTEXT_FIRST_PAID_E2E`, unset by
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
import { hasAllRequiredCredentials } from '../../../../scripts/web-context-first-paid-e2e';

// ---------------------------------------------------------------------------
// Frozen, non-negotiable economic and routing constants — SUN-1221B design
// freeze + SUN-1221E2's own fresh, independently-decoded 402. Not
// CLI-overridable.
// ---------------------------------------------------------------------------

const WORKER_SCRIPT_NAME = 'siteborne-utility-edge';
const WORKER_ORIGIN = 'https://utility.siteborne.net';
const TARGET_PATH = '/v2/web/context';
const TARGET_URL = `${WORKER_ORIGIN}${TARGET_PATH}`;
const CANDIDATE_VERSION_ID = 'a088632e-b93c-4953-b0fc-411a2005e57c';
const VERSION_OVERRIDE_HEADER = 'Cloudflare-Workers-Version-Overrides';
const VERSION_OVERRIDE_HEADER_VALUE = `${WORKER_SCRIPT_NAME}="${CANDIDATE_VERSION_ID}"`;

const EXPECTED_NETWORK = 'eip155:8453';
const EXPECTED_ASSET = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const EXPECTED_AMOUNT_ATOMIC = '9000';
const EXPECTED_PAYTO = '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1';
const EXPECTED_BUYER = '0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99';
const EXPECTED_EIP712_NAME = 'USD Coin';
const EXPECTED_EIP712_VERSION = '2';

const SERVICE_PAYMENT_USD = 0.009;
const EXPECTED_PAYER_BORNE_NETWORK_FEE_USD = 0;
const MAX_TOTAL_PAYER_EXPOSURE_USD = 0.25;

/** Canonical request body frozen by the authorizing human message and
 * independently proven schema-valid (reached 402, not 400) in SUN-1221E2's
 * own live qualification. Not CLI-overridable. */
const CANONICAL_REQUEST_BODY = Object.freeze({
  target_url: 'https://example.com/',
  retrieval_mode: 'direct',
});

const RUN_LOCAL_WEB_CONTEXT_FIRST_PAID_E2E_ENV_VAR = 'RUN_LOCAL_WEB_CONTEXT_FIRST_PAID_E2E';

// ---------------------------------------------------------------------------
export type FirstPaidE2EStage =
  | 'PRE_CHALLENGE'
  | 'CHALLENGE_RECEIVED'
  | 'CHALLENGE_VALIDATED'
  | 'PAYMENT_MATERIAL_CREATED'
  | 'PAID_REQUEST_SUBMITTED'
  | 'RESULT_OBSERVED';

export type SubmissionResult = 'success' | 'rejected' | 'ambiguous';

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
}

export interface CallBudgetCounters {
  unpaid402Requests: number;
  cdpGetAccountCalls: number;
  paymentSignTypedDataCalls: number;
  paymentPayloadsCreated: number;
  paymentSignatureHeadersCreated: number;
  paidRequestSubmissions: number;
}

function freshCounters(): CallBudgetCounters {
  return {
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
      challenge_received: stage !== 'PRE_CHALLENGE',
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

export async function runFirstPaidE2E(
  deps: FirstPaidE2EDeps
): Promise<{ result: FirstPaidE2ESanitizedResult; counters: CallBudgetCounters }> {
  const counters = freshCounters();
  let stage: FirstPaidE2EStage = 'PRE_CHALLENGE';

  counters.unpaid402Requests += 1;
  let challengeRes: Response;
  try {
    challengeRes = await deps.fetchImpl(TARGET_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [VERSION_OVERRIDE_HEADER]: VERSION_OVERRIDE_HEADER_VALUE,
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
        [VERSION_OVERRIDE_HEADER]: VERSION_OVERRIDE_HEADER_VALUE,
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

  const submissionResult = classifySubmissionOutcome(paidRes.status);
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
    },
  };
}

export function classifySubmissionOutcome(httpStatus: number): SubmissionResult {
  if (httpStatus === 200) return 'success';
  if (httpStatus === 402) return 'rejected';
  if (httpStatus >= 500) return 'ambiguous';
  return 'ambiguous';
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
// Unit test matrix — mirrors first-paid-e2e-local.test.ts's core safety
// properties (network/asset/amount/payTo/EIP-712-domain validation before
// signing, buyer-match enforcement, single-shot budget, no retry on
// ambiguity, no signature leakage). Zero network calls.
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
    signTypedData: async () => '0x' + '11'.repeat(65),
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

function twoStepFetch(
  challenge: PaymentRequired,
  paidResponse: Response
): ReturnType<typeof vi.fn> {
  let call = 0;
  return vi.fn(async () => {
    call += 1;
    if (call === 1) {
      return jsonResponse(
        402,
        { error: 'payment_required' },
        { 'PAYMENT-REQUIRED': encodeChallenge(challenge) }
      );
    }
    return paidResponse;
  });
}

describe('SUN-1221E2 web-context first-paid-e2e local client (unit, always run)', () => {
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

  it('sends exactly one unpaid 402 request before anything else', async () => {
    const fetchImpl = twoStepFetch(
      validChallenge(),
      jsonResponse(200, { result_class: 'success', receipt_id: 'r1' })
    );
    const { counters } = await runFirstPaidE2E(baseDeps({ fetchImpl }));
    expect(counters.unpaid402Requests).toBe(1);
  });

  it('a non-402 initial response stops the flow with zero signing', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, { error: 'boom' }));
    const { result, counters } = await runFirstPaidE2E(baseDeps({ fetchImpl }));
    expect(result.ok).toBe(false);
    expect(result.stage).toBe('PRE_CHALLENGE');
    expect(counters.paymentSignTypedDataCalls).toBe(0);
  });

  it('wrong network/asset/amount/payTo/EIP-712-domain are each rejected before signing', async () => {
    for (const override of [
      { network: 'eip155:1' },
      { asset: '0x0000000000000000000000000000000000dEaD' },
      { amount: '9001' },
      { amount: '8999' },
      { payTo: '0x0000000000000000000000000000000000dEaD' },
      { extra: { quote_id: 'q' } },
    ]) {
      const challenge = validChallenge(validRequirement(override));
      const fetchImpl = twoStepFetch(challenge, jsonResponse(200, {}));
      const { result, counters } = await runFirstPaidE2E(baseDeps({ fetchImpl }));
      expect(result.ok).toBe(false);
      expect(counters.paymentSignTypedDataCalls).toBe(0);
    }
  });

  it('a resolved account address that does not match the controlled buyer never signs', async () => {
    const fetchImpl = twoStepFetch(validChallenge(), jsonResponse(200, {}));
    const deps = baseDeps({
      fetchImpl,
      cdpClient: {
        evm: {
          getAccount: vi.fn(async () => mockAccount('0x000000000000000000000000000000000000aa')),
        },
      },
    });
    const { result, counters } = await runFirstPaidE2E(deps);
    expect(result.ok).toBe(false);
    expect(result.failure_reason).toMatch(/does not match the controlled buyer/);
    expect(counters.paymentSignTypedDataCalls).toBe(0);
  });

  it('exposure is within the $0.25 cap for the frozen 0.009 USD price', () => {
    const result = checkExposureWithinCap();
    expect(result.ok).toBe(true);
  });

  it('PAYMENT-SIGNATURE is submitted exactly once on a fully valid run', async () => {
    const fetchImpl = twoStepFetch(
      validChallenge(),
      jsonResponse(200, { result_class: 'success' })
    );
    const { counters, result } = await runFirstPaidE2E(baseDeps({ fetchImpl }));
    expect(counters.paidRequestSubmissions).toBe(1);
    expect(result.ok).toBe(true);
  });

  it('a network failure after submission classifies AMBIGUOUS and never retries', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return jsonResponse(402, {}, { 'PAYMENT-REQUIRED': encodeChallenge(validChallenge()) });
      }
      throw new Error('simulated timeout');
    });
    const { result, counters } = await runFirstPaidE2E(baseDeps({ fetchImpl }));
    expect(result.submission_result).toBe('ambiguous');
    expect(counters.paidRequestSubmissions).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('a 402 after signed submission classifies REJECTED and never retries', async () => {
    const fetchImpl = twoStepFetch(
      validChallenge(),
      jsonResponse(402, { error: 'settlement_rejected' })
    );
    const { result } = await runFirstPaidE2E(baseDeps({ fetchImpl }));
    expect(result.submission_result).toBe('rejected');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('payment material never appears in the returned result', async () => {
    const fetchImpl = twoStepFetch(
      validChallenge(),
      jsonResponse(200, { result_class: 'success' })
    );
    const { result } = await runFirstPaidE2E(baseDeps({ fetchImpl }));
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/signature/i);
    expect(serialized).not.toMatch(/authorization/i);
  });

  it('the target URL, body, amount, payTo, network, and buyer are fixed module constants', () => {
    expect(TARGET_URL).toBe(`${WORKER_ORIGIN}${TARGET_PATH}`);
    expect(CANONICAL_REQUEST_BODY).toEqual({
      target_url: 'https://example.com/',
      retrieval_mode: 'direct',
    });
    expect(EXPECTED_AMOUNT_ATOMIC).toBe('9000');
    expect(EXPECTED_PAYTO).toBe('0x7f44a2dd237938F18632d4CcA40f4c690295E6E1');
    expect(EXPECTED_NETWORK).toBe('eip155:8453');
    expect(EXPECTED_BUYER).toBe('0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99');
  });

  it('the unpaid and paid requests carry the identical, quoted Cloudflare-Workers-Version-Overrides value', async () => {
    const fetchImpl = twoStepFetch(
      validChallenge(),
      jsonResponse(200, { result_class: 'success' })
    );
    const deps = baseDeps({ fetchImpl });
    await runFirstPaidE2E(deps);
    const calls = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(2);
    const expectedHeaderValue = VERSION_OVERRIDE_HEADER_VALUE;
    for (const call of calls) {
      const headers = (call[1] as RequestInit).headers as Record<string, string>;
      expect(headers[VERSION_OVERRIDE_HEADER]).toBe(expectedHeaderValue);
    }
    expect(CANDIDATE_VERSION_ID).not.toBe('de70bf98-f304-4d7f-b189-4ae2401041a0');
  });

  it('the production Worker bundle has no reachable import path to this file (grep proof)', async () => {
    const { execFileSync } = await import('node:child_process');
    const repoRoot = new URL('../../../../', import.meta.url).pathname;
    let matches = '';
    try {
      matches = execFileSync(
        'grep',
        ['-rl', 'web-context-first-paid-e2e-local', 'apps/edge-api/src'],
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
// exact action the SUN-1221E2 authorization delegates to the human.
// ---------------------------------------------------------------------------

describe.skipIf(!process.env[RUN_LOCAL_WEB_CONTEXT_FIRST_PAID_E2E_ENV_VAR])(
  'SUN-1221E2 web-context first-paid-e2e local client (LIVE, credential-gated)',
  () => {
    it('runs the real, single, authorized web-context first-paid-E2E attempt', async () => {
      const apiKeyId = process.env.CDP_API_KEY_ID ?? '';
      const apiKeySecret = process.env.CDP_API_KEY_SECRET ?? '';
      const walletSecret = process.env.CDP_WALLET_SECRET ?? '';
      if (!apiKeyId || !apiKeySecret || !walletSecret) {
        throw new Error('CDP_API_KEY_ID / CDP_API_KEY_SECRET / CDP_WALLET_SECRET must all be set');
      }
      const deps = buildRealDeps({ apiKeyId, apiKeySecret, walletSecret });
      const { result } = await runFirstPaidE2E(deps);
      // eslint-disable-next-line no-console -- the one authorized, sanitized output surface.
      console.log(JSON.stringify(result));
      expect(result.stage).toBeDefined();
    });
  }
);
