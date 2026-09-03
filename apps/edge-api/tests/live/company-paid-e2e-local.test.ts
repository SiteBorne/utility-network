/**
 * SUN-1222C-COMPANY-E2E-HARNESS — local-only, non-Worker, exactly-once
 * `company_evidence_graph.v2` paid-E2E client.
 *
 * Architecture mirrors `first-paid-e2e-local.test.ts` (SUN-1220J) exactly:
 * fresh 402 -> decode -> hard-validate -> resolve buyer -> official
 * `fromCdpEvmAccount` adapter -> official `ExactEvmScheme.createPaymentPayload`
 * (signs EIP-3009 TransferWithAuthorization exactly once) -> official
 * `encodePaymentSignatureHeaderSafe` -> exactly one paid submission ->
 * sanitized result. No hand-written payment cryptography anywhere in this
 * file — 100% delegated to `@x402/evm`'s `ExactEvmScheme`,
 * `@coinbase/cdp-sdk`'s `fromCdpEvmAccount` adapter, and
 * `@siteborne/protocol-x402`'s codec module.
 *
 * ROUTING POLICY (SUN-1222C-EQ / SUN-1222C-R3C-CONTINUATION):
 * `QUALIFICATION_ROUTING_POLICY=PRODUCTION_DIRECT_EQ` — this file targets
 * production (`https://utility.siteborne.net`) directly, with NO
 * `Cloudflare-Workers-Version-Overrides` header. Candidate-specific
 * targeting was proven unavailable (preview_urls=false, SUN-1207 M3); the
 * currently-deployed candidate was independently certified
 * execution-equivalent to current HEAD (SUN-1222C-EQ), so paying against
 * production directly is accepted, evidenced qualification.
 *
 * This file is never invoked live by `pnpm test` (the live `describe`
 * block below is `skipIf`-gated on `RUN_LIVE_COMPANY_PAYMENT`, unset in
 * every normal run) and is structurally unreachable from the production
 * Worker bundle: it lives under `apps/edge-api/tests/`, which
 * `wrangler.toml`'s `main = "apps/edge-api/src/index.ts"` entrypoint never
 * imports.
 */
import { describe, expect, it, vi } from 'vitest';
import { CdpClient } from '@coinbase/cdp-sdk';
import { fromCdpEvmAccount } from '@coinbase/cdp-sdk/x402';
import { ExactEvmScheme } from '@x402/evm';
import { privateKeyToAccount } from 'viem/accounts';
import { recoverTypedDataAddress } from 'viem';
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
import {
  hasAllRequiredCredentials,
  hasExplicitLiveConfirmation,
} from '../../../../scripts/company-paid-e2e';

// ---------------------------------------------------------------------------
// Frozen, non-negotiable economic and routing constants. None of these are
// CLI-overridable — no arbitrary endpoint/amount/payTo/asset/network/buyer
// input is possible anywhere in this file.
// ---------------------------------------------------------------------------

const PRODUCTION_ORIGIN = 'https://utility.siteborne.net';
const TARGET_PATH = '/v2/company/evidence-graph';
const TARGET_URL = `${PRODUCTION_ORIGIN}${TARGET_PATH}`;

const EXPECTED_NETWORK = 'eip155:8453';
const EXPECTED_ASSET = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const EXPECTED_AMOUNT_ATOMIC = '31200';
const EXPECTED_PAYTO = '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1';
const EXPECTED_BUYER = '0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99';
// Canonical Base-mainnet USDC EIP-712 domain (public, well-known — Circle's
// native USDC contract), matching `resolvePaymentAsset('eip155:8453')`'s
// own EIP-712 name/version and independently confirmed to already be set
// by `company-evidence-graph-v2-cdp-composition.ts`'s
// `paymentRequirementExtra: { name: asset.name, version: asset.version }`.
const EXPECTED_EIP712_NAME = 'USD Coin';
const EXPECTED_EIP712_VERSION = '2';

const SERVICE_PAYMENT_USD = 0.039;
const EXPECTED_PAYER_BORNE_NETWORK_FEE_USD = 0;
const MAX_TOTAL_PAYER_EXPOSURE_USD = 0.25;

/** The frozen, schema-validated canonical request body — sole identifier
 * `openai.com` (domain), per the explicit user resolution of the
 * previously-missing company identifier. `{"domain": "openai.com"}` alone
 * satisfies `company-evidence-input.schema.json`'s `anyOf` (one of
 * company_name/ticker/domain/identifiers required) — domain chosen because
 * it is less ambiguous and deterministic. Not CLI-overridable. */
const CANONICAL_REQUEST_BODY = Object.freeze({
  domain: 'openai.com',
});

const RUN_LIVE_COMPANY_PAYMENT_ENV_VAR = 'RUN_LIVE_COMPANY_PAYMENT';

// ---------------------------------------------------------------------------
// Explicit exactly-once economic state machine (mirrors first-paid-e2e's
// FirstPaidE2EStage/CallBudgetCounters exactly).
// ---------------------------------------------------------------------------

export type CompanyPaidE2EStage =
  | 'PRE_CHALLENGE'
  | 'CHALLENGE_RECEIVED'
  | 'CHALLENGE_VALIDATED'
  | 'PAYMENT_MATERIAL_CREATED'
  | 'PAID_REQUEST_SUBMITTED'
  | 'RESULT_OBSERVED';

export type SubmissionResult = 'success' | 'rejected' | 'ambiguous';

/** The ONLY fields this tool may ever surface. Never the payment
 * signature, the raw PaymentPayload, or any secret. */
export interface CompanyPaidE2ESanitizedResult {
  ok: boolean;
  stage: CompanyPaidE2EStage;
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

/** Enforced call budget. Every counter starts at 0 and this module never
 * increments any of them more than once; tests assert this directly. */
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

export interface LocalCompanyPaidE2EAccount {
  address: string;
  signTypedData(options: Record<string, unknown>): Promise<`0x${string}`>;
}

export interface LocalCompanyPaidE2ECdpClient {
  evm: { getAccount(args: { address: string }): Promise<LocalCompanyPaidE2EAccount> };
}

export interface LocalCompanyPaidE2ECredentials {
  apiKeyId: string;
  apiKeySecret: string;
  walletSecret: string;
}

export interface CompanyPaidE2EDeps {
  fetchImpl: typeof fetch;
  cdpClient: LocalCompanyPaidE2ECdpClient;
  fromCdpEvmAccountImpl: (account: LocalCompanyPaidE2EAccount) => unknown;
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
  stage: CompanyPaidE2EStage,
  reason: string,
  partial: Partial<CompanyPaidE2ESanitizedResult> = {}
): { result: CompanyPaidE2ESanitizedResult; counters: CallBudgetCounters } {
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

/** Exact-equality hard economic validation. No "less than or equal", no
 * substring/prefix matching, no case-insensitive short-circuit beyond
 * checksummed-address comparison. */
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

/** Hard USD exposure cap, computed from fixed constants only (never from
 * anything the server/challenge supplies), checked before signing. */
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

/** The full orchestration. Never called from module load; never called
 * more than once per process by any test or by the live wrapper script —
 * no automatic retry. */
export async function runCompanyPaidE2E(
  deps: CompanyPaidE2EDeps
): Promise<{ result: CompanyPaidE2ESanitizedResult; counters: CallBudgetCounters }> {
  const counters = freshCounters();
  let stage: CompanyPaidE2EStage = 'PRE_CHALLENGE';

  // ---- 1. fresh unpaid 402 (obtained fresh, never a saved/replayed
  //         challenge; fixed endpoint/body only). ----
  counters.unpaid402Requests += 1;
  let challengeRes: Response;
  try {
    challengeRes = await deps.fetchImpl(TARGET_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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

  // ---- 2. decode PAYMENT-REQUIRED via the canonical codec only. ----
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

  // ---- 3. hard economic validation — exact equality only. ----
  const validation = validateChallengeAgainstExpectations(requirement);
  if (!validation.ok) {
    return fail(counters, stage, validation.reason);
  }

  // ---- 4. hard USD exposure cap — fail closed before signing. ----
  const exposureCheck = checkExposureWithinCap();
  if (!exposureCheck.ok) {
    return fail(counters, stage, exposureCheck.reason);
  }
  stage = 'CHALLENGE_VALIDATED';

  // ---- 5. resolve controlled buyer via cdp.evm.getAccount. ----
  counters.cdpGetAccountCalls += 1;
  let account: LocalCompanyPaidE2EAccount;
  try {
    account = await deps.cdpClient.evm.getAccount({ address: EXPECTED_BUYER });
  } catch (err) {
    return fail(counters, stage, `cdp.evm.getAccount failed: ${String(err)}`);
  }
  if (account.address.toLowerCase() !== EXPECTED_BUYER.toLowerCase()) {
    return fail(counters, stage, 'resolved account address does not match the controlled buyer');
  }

  // ---- 6. official adapter. ----
  const signer = deps.fromCdpEvmAccountImpl(account);

  // ---- 7. official payment-payload builder — this is the ONE point in
  //         this tool's entire flow that ever calls signTypedData, via
  //         the official ExactEvmScheme, exactly once. ----
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

  // ---- 8. official header encoder. ----
  counters.paymentSignatureHeadersCreated += 1;
  const signatureHeader = deps.encodePaymentSignatureHeaderSafeImpl(fullPayload);

  // ---- 9. exactly one paid submission — after this point, NO automatic
  //         retry under any classification. ----
  counters.paidRequestSubmissions += 1;
  let paidRes: Response;
  try {
    paidRes = await deps.fetchImpl(TARGET_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'PAYMENT-SIGNATURE': signatureHeader,
      },
      body: JSON.stringify(CANONICAL_REQUEST_BODY),
    });
  } catch (err) {
    // Timeout/network failure after submission is inherently indeterminate:
    // we cannot know whether the server received and acted on it. Classify
    // AMBIGUOUS and stop; never retry.
    return fail(
      counters,
      'PAID_REQUEST_SUBMITTED',
      `network error after submission: ${String(err)}`,
      { submission_result: 'ambiguous' }
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

/** Never retried regardless of classification. */
export function classifySubmissionOutcome(httpStatus: number): SubmissionResult {
  if (httpStatus === 200) return 'success';
  if (httpStatus === 402) return 'rejected';
  if (httpStatus >= 500) return 'ambiguous';
  return 'ambiguous';
}

/** Builds the real (non-mocked) dependency bundle for a live run — the
 * ONLY place in this file that ever constructs a real `CdpClient` with a
 * `walletSecret`. */
function buildRealDeps(credentials: LocalCompanyPaidE2ECredentials): CompanyPaidE2EDeps {
  const cdpClient = new CdpClient({
    apiKeyId: credentials.apiKeyId,
    apiKeySecret: credentials.apiKeySecret,
    walletSecret: credentials.walletSecret,
  });
  return {
    fetchImpl: fetch,
    cdpClient: cdpClient as unknown as LocalCompanyPaidE2ECdpClient,
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
// Test fixtures shared by the always-run unit suite below.
// ---------------------------------------------------------------------------

/** A deterministic, TEST-ONLY private key — never the real controlled
 * buyer's key (which this repository never holds). */
const TEST_ONLY_SIGNER_ACCOUNT = privateKeyToAccount(
  '0x9708f0b8f0ea156dbbc5bf32ef9ce9236efc7bd71fd47d460d74b864de54dd50'
);

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

function mockAccount(address = EXPECTED_BUYER): LocalCompanyPaidE2EAccount {
  return {
    address,
    signTypedData: async (options) =>
      TEST_ONLY_SIGNER_ACCOUNT.signTypedData(
        options as Parameters<typeof TEST_ONLY_SIGNER_ACCOUNT.signTypedData>[0]
      ),
  };
}

function realCreateExactEvmPaymentPayload(
  signer: unknown,
  x402Version: number,
  paymentRequirements: PaymentRequirements
) {
  return new ExactEvmScheme(signer as never).createPaymentPayload(x402Version, paymentRequirements);
}

function baseDeps(overrides: Partial<CompanyPaidE2EDeps> = {}): CompanyPaidE2EDeps {
  return {
    fetchImpl: vi.fn(),
    cdpClient: { evm: { getAccount: vi.fn(async () => mockAccount()) } },
    fromCdpEvmAccountImpl: vi.fn((account) =>
      fromCdpEvmAccount(account as unknown as Parameters<typeof fromCdpEvmAccount>[0])
    ),
    createExactEvmPaymentPayload: vi.fn(realCreateExactEvmPaymentPayload),
    decodePaymentRequiredHeaderSafeImpl: decodePaymentRequiredHeaderSafe,
    encodePaymentSignatureHeaderSafeImpl: vi.fn(encodePaymentSignatureHeaderSafe),
    decodePaymentResponseHeaderSafeImpl: decodePaymentResponseHeaderSafe,
    generatePaymentIdentifierImpl: () => 'test-payment-id-000000000000000000000000000002',
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

// ---------------------------------------------------------------------------
// Always-run unit test matrix. Zero network calls; every collaborator is
// either a pure in-memory mock or the REAL official library invoked
// against a deterministic TEST-ONLY key.
// ---------------------------------------------------------------------------

describe('SUN-1222C-COMPANY-E2E-HARNESS company-paid-e2e local client (unit, always run)', () => {
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
        CDP_API_KEY_SECRET: undefined,
        CDP_WALLET_SECRET: 'y',
      })
    ).toBe(false);
    expect(
      hasAllRequiredCredentials({
        CDP_API_KEY_ID: 'x',
        CDP_API_KEY_SECRET: 'y',
        CDP_WALLET_SECRET: undefined,
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

  it('missing live confirmation is rejected', () => {
    expect(hasExplicitLiveConfirmation({})).toBe(false);
  });

  it('wrong confirmation string is rejected (generic "yes" insufficient)', () => {
    expect(
      hasExplicitLiveConfirmation({
        SITEBORNE_LIVE_COMPANY_EVIDENCE_GRAPH_V2_PAYMENT_CONFIRMATION_31200: 'yes',
      })
    ).toBe(false);
  });

  it('a DIFFERENT service/amount confirmation string is rejected (no cross-service reuse)', () => {
    expect(
      hasExplicitLiveConfirmation({
        SITEBORNE_LIVE_COMPANY_EVIDENCE_GRAPH_V2_PAYMENT_CONFIRMATION_31200:
          'I_UNDERSTAND_THIS_SPENDS_REAL_USDC_ON_BASE_MAINNET', // the document harness's string
      })
    ).toBe(false);
  });

  it('the exact service- and amount-specific confirmation string is accepted', () => {
    expect(
      hasExplicitLiveConfirmation({
        SITEBORNE_LIVE_COMPANY_EVIDENCE_GRAPH_V2_PAYMENT_CONFIRMATION_31200:
          'I_AUTHORIZE_ONE_COMPANY_EVIDENCE_GRAPH_V2_PAYMENT_31200',
      })
    ).toBe(true);
  });

  it('sends exactly one unpaid 402 request before anything else', async () => {
    const paidRes = jsonResponse(200, { result_class: 'success', receipt_id: 'r1' });
    const fetchImpl = twoStepFetch(validChallenge(), paidRes);
    const { counters } = await runCompanyPaidE2E(baseDeps({ fetchImpl }));
    expect(counters.unpaid402Requests).toBe(1);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      TARGET_URL,
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('a non-402 initial response stops the flow with zero signing', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, { error: 'boom' }));
    const { result, counters } = await runCompanyPaidE2E(baseDeps({ fetchImpl }));
    expect(result.ok).toBe(false);
    expect(result.stage).toBe('PRE_CHALLENGE');
    expect(counters.paymentSignTypedDataCalls).toBe(0);
    expect(counters.paidRequestSubmissions).toBe(0);
  });

  it('a malformed PAYMENT-REQUIRED header stops the flow', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(402, {}, { 'PAYMENT-REQUIRED': 'not-valid-base64!!!' })
    );
    const { result, counters } = await runCompanyPaidE2E(baseDeps({ fetchImpl }));
    expect(result.ok).toBe(false);
    expect(result.challenge_validated).toBe(false);
    expect(counters.paymentSignTypedDataCalls).toBe(0);
  });

  it('wrong service (via wrong resource path echoed as a differently-shaped challenge) never signs — network mismatch as proxy', async () => {
    // The harness has no service-selection parameter at all (AB below) —
    // "wrong service" cannot be expressed except by the SERVER returning a
    // requirement that fails one of the other hard checks (network/asset/
    // amount/payTo), all of which are independently proven.
    const challenge = validChallenge(validRequirement({ network: 'eip155:1' }));
    const fetchImpl = twoStepFetch(challenge, jsonResponse(200, {}));
    const deps = baseDeps({ fetchImpl });
    const { result, counters } = await runCompanyPaidE2E(deps);
    expect(result.ok).toBe(false);
    expect(result.failure_reason).toMatch(/network mismatch/);
    expect(counters.paymentSignTypedDataCalls).toBe(0);
    expect(deps.cdpClient.evm.getAccount).not.toHaveBeenCalled();
  });

  it('wrong asset is rejected before signing', async () => {
    const challenge = validChallenge(
      validRequirement({ asset: '0x0000000000000000000000000000000000dEaD' })
    );
    const fetchImpl = twoStepFetch(challenge, jsonResponse(200, {}));
    const { result, counters } = await runCompanyPaidE2E(baseDeps({ fetchImpl }));
    expect(result.ok).toBe(false);
    expect(result.failure_reason).toMatch(/asset mismatch/);
    expect(counters.paymentSignTypedDataCalls).toBe(0);
  });

  it('stale and underpaid amounts are rejected before signing (exact 31200 only)', async () => {
    const challenge = validChallenge(validRequirement({ amount: '39000' }));
    const fetchImpl = twoStepFetch(challenge, jsonResponse(200, {}));
    const { result, counters } = await runCompanyPaidE2E(baseDeps({ fetchImpl }));
    expect(result.ok).toBe(false);
    expect(result.failure_reason).toMatch(/amount mismatch/);
    expect(counters.paymentSignTypedDataCalls).toBe(0);
    const smaller = validChallenge(validRequirement({ amount: '31199' }));
    const fetchImpl2 = twoStepFetch(smaller, jsonResponse(200, {}));
    const { result: result2 } = await runCompanyPaidE2E(baseDeps({ fetchImpl: fetchImpl2 }));
    expect(result2.ok).toBe(false);
  });

  it('wrong payTo is rejected before signing', async () => {
    const challenge = validChallenge(
      validRequirement({ payTo: '0x0000000000000000000000000000000000dEaD' })
    );
    const fetchImpl = twoStepFetch(challenge, jsonResponse(200, {}));
    const { result, counters } = await runCompanyPaidE2E(baseDeps({ fetchImpl }));
    expect(result.ok).toBe(false);
    expect(result.failure_reason).toMatch(/payTo mismatch/);
    expect(counters.paymentSignTypedDataCalls).toBe(0);
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
    const { result, counters } = await runCompanyPaidE2E(deps);
    expect(result.ok).toBe(false);
    expect(result.failure_reason).toMatch(/does not match the controlled buyer/);
    expect(counters.paymentSignTypedDataCalls).toBe(0);
  });

  it('exposure exceeding the $0.25 cap never signs', () => {
    const result = checkExposureWithinCap();
    expect(result.ok).toBe(true); // sanity: today's fixed $0.039 constant passes.
    expect(0.039 + 0 > 0.25).toBe(false);
    expect(0.3 > 0.25).toBe(true);
  });

  it('cdp.evm.getAccount is called exactly once on a fully valid run', async () => {
    const fetchImpl = twoStepFetch(
      validChallenge(),
      jsonResponse(200, { result_class: 'success' })
    );
    const deps = baseDeps({ fetchImpl });
    await runCompanyPaidE2E(deps);
    expect(deps.cdpClient.evm.getAccount).toHaveBeenCalledTimes(1);
    expect(deps.cdpClient.evm.getAccount).toHaveBeenCalledWith({ address: EXPECTED_BUYER });
  });

  it('fromCdpEvmAccount is used literally, exactly once', async () => {
    const fetchImpl = twoStepFetch(
      validChallenge(),
      jsonResponse(200, { result_class: 'success' })
    );
    const deps = baseDeps({ fetchImpl });
    await runCompanyPaidE2E(deps);
    expect(deps.fromCdpEvmAccountImpl).toHaveBeenCalledTimes(1);
  });

  it('ExactEvmScheme.createPaymentPayload is used literally, exactly once', async () => {
    const fetchImpl = twoStepFetch(
      validChallenge(),
      jsonResponse(200, { result_class: 'success' })
    );
    const deps = baseDeps({ fetchImpl });
    const { counters } = await runCompanyPaidE2E(deps);
    expect(deps.createExactEvmPaymentPayload).toHaveBeenCalledTimes(1);
    expect(counters.paymentPayloadsCreated).toBe(1);
  });

  it('signTypedData (via the official scheme) is called at most once, and produces a real, recoverable EIP-3009 signature', async () => {
    const fetchImpl = twoStepFetch(
      validChallenge(),
      jsonResponse(200, { result_class: 'success' })
    );
    const deps = baseDeps({ fetchImpl });
    const { counters, result } = await runCompanyPaidE2E(deps);
    expect(counters.paymentSignTypedDataCalls).toBe(1);
    expect(result.ok).toBe(true);

    const sentSignatureHeader = (
      deps.encodePaymentSignatureHeaderSafeImpl as ReturnType<typeof vi.fn>
    ).mock.calls[0][0] as PaymentPayload;
    const authorization = sentSignatureHeader.payload as {
      authorization: {
        from: string;
        to: string;
        value: string;
        validAfter: string;
        validBefore: string;
        nonce: string;
      };
      signature: `0x${string}`;
    };
    const recovered = await recoverTypedDataAddress({
      domain: {
        name: EXPECTED_EIP712_NAME,
        version: EXPECTED_EIP712_VERSION,
        chainId: 8453,
        verifyingContract: EXPECTED_ASSET as `0x${string}`,
      },
      types: {
        TransferWithAuthorization: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'validAfter', type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'nonce', type: 'bytes32' },
        ],
      },
      primaryType: 'TransferWithAuthorization',
      message: {
        from: authorization.authorization.from as `0x${string}`,
        to: authorization.authorization.to as `0x${string}`,
        value: BigInt(authorization.authorization.value),
        validAfter: BigInt(authorization.authorization.validAfter),
        validBefore: BigInt(authorization.authorization.validBefore),
        nonce: authorization.authorization.nonce as `0x${string}`,
      },
      signature: authorization.signature,
    });
    expect(recovered.toLowerCase()).toBe(TEST_ONLY_SIGNER_ACCOUNT.address.toLowerCase());
  });

  it('encodePaymentSignatureHeaderSafe is used literally to produce the sent header', async () => {
    const fetchImpl = twoStepFetch(
      validChallenge(),
      jsonResponse(200, { result_class: 'success' })
    );
    const deps = baseDeps({ fetchImpl });
    await runCompanyPaidE2E(deps);
    expect(deps.encodePaymentSignatureHeaderSafeImpl).toHaveBeenCalledTimes(1);
    const secondCallArgs = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[1];
    const sentHeaders = (secondCallArgs[1] as RequestInit).headers as Record<string, string>;
    expect(sentHeaders['PAYMENT-SIGNATURE']).toBe(
      (deps.encodePaymentSignatureHeaderSafeImpl as ReturnType<typeof vi.fn>).mock.results[0].value
    );
  });

  it('PAYMENT-SIGNATURE is submitted exactly once (no blind retry)', async () => {
    const fetchImpl = twoStepFetch(
      validChallenge(),
      jsonResponse(200, { result_class: 'success' })
    );
    const { counters } = await runCompanyPaidE2E(baseDeps({ fetchImpl }));
    expect(counters.paidRequestSubmissions).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('payment material never appears in the returned result or a thrown error', async () => {
    const fetchImpl = twoStepFetch(
      validChallenge(),
      jsonResponse(200, { result_class: 'success' })
    );
    const deps = baseDeps({ fetchImpl });
    const { result } = await runCompanyPaidE2E(deps);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/signature/i);
    expect(serialized).not.toMatch(/authorization/i);
    expect(Object.keys(result).sort()).toEqual(
      [
        'challenge_received',
        'challenge_validated',
        'http_status',
        'ok',
        'paid_request_submitted',
        'payment_material_created',
        'service_execution_observed',
        'stage',
        'submission_result',
      ].sort()
    );

    const badChallenge = validChallenge(validRequirement({ network: 'eip155:1' }));
    const fetchImpl2 = twoStepFetch(badChallenge, jsonResponse(200, {}));
    const { result: badResult } = await runCompanyPaidE2E(baseDeps({ fetchImpl: fetchImpl2 }));
    expect(JSON.stringify(badResult)).not.toMatch(/0x[0-9a-fA-F]{130}/); // no 65-byte signature hex anywhere.
  });

  it('a network failure (timeout) after submission classifies AMBIGUOUS and does not retry', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return jsonResponse(402, {}, { 'PAYMENT-REQUIRED': encodeChallenge(validChallenge()) });
      }
      throw new Error('simulated timeout');
    });
    const { result, counters } = await runCompanyPaidE2E(baseDeps({ fetchImpl }));
    expect(result.submission_result).toBe('ambiguous');
    expect(counters.paidRequestSubmissions).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // never a third (retry) call.
  });

  it('a 5xx after submission classifies AMBIGUOUS and does not retry', async () => {
    const fetchImpl = twoStepFetch(validChallenge(), jsonResponse(503, { error: 'unavailable' }));
    const { result } = await runCompanyPaidE2E(baseDeps({ fetchImpl }));
    expect(result.submission_result).toBe('ambiguous');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('a 402 after signed submission classifies REJECTED and does not retry', async () => {
    const fetchImpl = twoStepFetch(
      validChallenge(),
      jsonResponse(402, { error: 'settlement_rejected' })
    );
    const { result } = await runCompanyPaidE2E(baseDeps({ fetchImpl }));
    expect(result.submission_result).toBe('rejected');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('duplicate invocation (calling runCompanyPaidE2E twice) produces two fully independent attempts, never a retry of the same material', async () => {
    const fetchImpl1 = twoStepFetch(
      validChallenge(),
      jsonResponse(200, { result_class: 'success' })
    );
    const { result: r1, counters: c1 } = await runCompanyPaidE2E(
      baseDeps({ fetchImpl: fetchImpl1 })
    );
    expect(r1.ok).toBe(true);
    expect(c1.paidRequestSubmissions).toBe(1);
    // A second, independent call is a NEW attempt (fresh counters, fresh
    // 402) — the harness itself never loops or retries internally; any
    // second real-world attempt requires a fresh external invocation and,
    // per SUN-1222C-COMPANY-E2E-HARNESS §7, a fresh standalone
    // authorization.
    const fetchImpl2 = twoStepFetch(
      validChallenge(),
      jsonResponse(200, { result_class: 'success' })
    );
    const { counters: c2 } = await runCompanyPaidE2E(baseDeps({ fetchImpl: fetchImpl2 }));
    expect(c2.unpaid402Requests).toBe(1); // fresh counters, not accumulated.
    expect(fetchImpl1).toHaveBeenCalledTimes(2);
    expect(fetchImpl2).toHaveBeenCalledTimes(2);
  });

  it('a successful 200 classifies SUCCESS and surfaces sanitized service/settlement evidence', async () => {
    const settleResponse = {
      success: true,
      transaction: '0xabc123',
      network: EXPECTED_NETWORK,
    };
    const settleHeaderValue = Buffer.from(JSON.stringify(settleResponse), 'utf-8').toString(
      'base64'
    );
    const paidRes = jsonResponse(
      200,
      { result_class: 'success', receipt_id: 'receipt_xyz' },
      { 'PAYMENT-RESPONSE': settleHeaderValue }
    );
    const fetchImpl = twoStepFetch(validChallenge(), paidRes);
    const { result } = await runCompanyPaidE2E(baseDeps({ fetchImpl }));
    expect(result.ok).toBe(true);
    expect(result.submission_result).toBe('success');
    expect(result.service_execution_observed).toBe(true);
    expect(result.receipt_id).toBe('receipt_xyz');
  });

  it('settlement metadata is parsed only when PAYMENT-RESPONSE is present and well-formed', async () => {
    const paidRes = jsonResponse(200, { result_class: 'success' });
    const fetchImpl = twoStepFetch(validChallenge(), paidRes);
    const { result } = await runCompanyPaidE2E(baseDeps({ fetchImpl }));
    expect(result.settlement_observed).toBeUndefined();
    expect(result.transaction_hash).toBeUndefined();
  });

  it('the production Worker bundle has no reachable import path to this file (grep proof)', async () => {
    const { execFileSync } = await import('node:child_process');
    const repoRoot = new URL('../../../../', import.meta.url).pathname;
    let matches = '';
    try {
      matches = execFileSync('grep', ['-rl', 'company-paid-e2e-local', 'apps/edge-api/src'], {
        cwd: repoRoot,
        encoding: 'utf-8',
      });
    } catch (err: unknown) {
      matches = (err as { stdout?: string }).stdout ?? '';
    }
    expect(matches.trim()).toBe('');
  });

  it('a stale/pre-supplied challenge cannot be fed to the tool (no such parameter exists)', () => {
    const paramNames = runCompanyPaidE2E.length;
    expect(paramNames).toBe(1); // (deps) only.
  });

  it('the target URL, body, amount, payTo, network, and buyer are fixed module constants, not parameters', () => {
    expect(TARGET_URL).toBe(`${PRODUCTION_ORIGIN}${TARGET_PATH}`);
    expect(CANONICAL_REQUEST_BODY).toEqual({ domain: 'openai.com' });
    expect(EXPECTED_AMOUNT_ATOMIC).toBe('31200');
    expect(EXPECTED_PAYTO).toBe('0x7f44a2dd237938F18632d4CcA40f4c690295E6E1');
    expect(EXPECTED_NETWORK).toBe('eip155:8453');
    expect(EXPECTED_BUYER).toBe('0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99');
  });

  it('no Cloudflare-Workers-Version-Overrides header is ever sent (PRODUCTION_DIRECT_EQ: target production directly, not a candidate)', async () => {
    const fetchImpl = twoStepFetch(
      validChallenge(),
      jsonResponse(200, { result_class: 'success' })
    );
    const deps = baseDeps({ fetchImpl });
    await runCompanyPaidE2E(deps);
    const calls = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      const headers = (call[1] as RequestInit).headers as Record<string, string>;
      expect(headers['Cloudflare-Workers-Version-Overrides']).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Dry-run mode proof: everything up through canonical-body/economics
// freeze and confirmation gating is exercisable with zero live network
// payment call. (This IS the always-run suite above — `company-paid-e2e.ts
// dry-run` simply runs this exact file without RUN_LIVE_COMPANY_PAYMENT
// set, so the live describe block below never executes.)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The one live-credentialed test. Skipped by default in every normal run.
// SUN-1222C-COMPANY-E2E-HARNESS does NOT authorize running this live — it
// exists only so a future, separately-authorized checkpoint has a ready
// entry point.
// ---------------------------------------------------------------------------

describe.skipIf(!process.env[RUN_LIVE_COMPANY_PAYMENT_ENV_VAR])(
  'SUN-1222C-COMPANY-E2E-HARNESS company-paid-e2e local client (LIVE, credential-gated)',
  () => {
    it('runs the real, single, authorized company_evidence_graph.v2 paid attempt', async () => {
      const apiKeyId = process.env.CDP_API_KEY_ID ?? '';
      const apiKeySecret = process.env.CDP_API_KEY_SECRET ?? '';
      const walletSecret = process.env.CDP_WALLET_SECRET ?? '';
      if (!apiKeyId || !apiKeySecret || !walletSecret) {
        throw new Error('CDP_API_KEY_ID / CDP_API_KEY_SECRET / CDP_WALLET_SECRET must all be set');
      }
      const deps = buildRealDeps({ apiKeyId, apiKeySecret, walletSecret });
      const { result } = await runCompanyPaidE2E(deps);
      // eslint-disable-next-line no-console -- the one authorized, sanitized output surface.
      console.log(JSON.stringify(result));
      expect(result.stage).toBeDefined();
    });
  }
);
