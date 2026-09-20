/**
 * FIRST-PAID-VERIFY-SETTLEMENT-OBSERVABILITY-01 -- a failed facilitator
 * `/settle` must persist a precise, safe, normalized cause instead of only the
 * gate's generic `settlement_not_successful`, with the public 402 contract
 * untouched and no secret / payment material / raw provider text persisted.
 *
 * Real `CdpPaymentEvidenceProvider` + real `@x402/core` `HTTPFacilitatorClient`
 * (only `globalThis.fetch` is stubbed, so the SDK's genuine error shapes are
 * classified) driven through the real `runPaidContinuationWorkflow` with the
 * suite's in-memory fakes. No network, no credential, no signature, no D1.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { hashPaymentObject } from '@siteborne/protocol-x402';
import type { ExternalSettlementEvidence } from '@siteborne/protocol-x402';

import { CdpPaymentEvidenceProvider } from '../src/control-plane/evidence/cdp-provider';
import {
  classifyAnsweredSettleFailure,
  classifyFacilitatorSettleFailure,
  FacilitatorAuthStageError,
} from '../src/control-plane/evidence/cdp-facilitator-failure';
import {
  formatSettlementAuditDetail,
  normalizeSettlementDiagnostics,
  runPaidContinuationWorkflow,
} from '../src/control-plane/workflows/paid-continuation-workflow';
import { FakeWorkflowStep } from './support/fake-workflow-step';
import {
  buildDecryptedPayload,
  buildTestDependencies,
  buildTestMetadata,
  sealTestInput,
  TEST_JOB_ID,
  TEST_NETWORK,
  TEST_PAYMENT_IDENTIFIER,
} from './support/paid-continuation-workflow-fixtures';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FAKE_JWT = 'eyJhbGciOiJFZERTQSJ9.settle-test-payload.settle-test-signature';
const BODY_LEAK = 'settle-body-leak-marker with Bearer eyJhbGciOi.secret';
const MESSAGE_LEAK = 'settle-exception-message-leak-marker';
const SECRET_MARKERS = [FAKE_JWT, BODY_LEAK, MESSAGE_LEAK, '0xsignature', '0xnonce'];

type FetchStub = (url: string, init: RequestInit) => Promise<Response>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function facilitator(options: {
  timeoutMs?: number;
  createAuthHeaders?: () => Promise<Record<string, Record<string, string>>>;
}): HTTPFacilitatorClient {
  return new HTTPFacilitatorClient({
    url: 'https://facilitator.invalid/platform/v2/x402',
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    createAuthHeaders:
      options.createAuthHeaders ??
      (async () => ({
        verify: { Authorization: `Bearer ${FAKE_JWT}` },
        settle: { Authorization: `Bearer ${FAKE_JWT}` },
        supported: { Authorization: `Bearer ${FAKE_JWT}` },
      })),
  });
}

const realFetch = globalThis.fetch;
function stubFetch(stub: FetchStub): void {
  globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) =>
    stub(String((input as Request)?.url ?? input), init ?? {})
  ) as unknown as typeof fetch;
}
afterEach(() => {
  globalThis.fetch = realFetch;
});

const METADATA = buildTestMetadata();
const DECRYPTED = buildDecryptedPayload(METADATA);

async function settleWith(client: HTTPFacilitatorClient): Promise<ExternalSettlementEvidence> {
  const provider = new CdpPaymentEvidenceProvider(client);
  return provider.settle(DECRYPTED.settlementContext, DECRYPTED.verificationEvidence, '9000');
}

async function runWorkflowWith(
  client: HTTPFacilitatorClient,
  evidenceMode: 'fixture' | 'production' = 'fixture'
) {
  const provider = new CdpPaymentEvidenceProvider(client);
  const deps = await buildTestDependencies();
  const wired = {
    ...deps,
    evidenceMode,
    settlement: { repository: deps.settlementRepository, evidenceProvider: provider },
  };
  const input = await sealTestInput(METADATA, { key: deps.envelopeKey });
  const result = await runPaidContinuationWorkflow(
    { payload: input },
    new FakeWorkflowStep(),
    wired
  );
  return { result, deps };
}

describe('settle failure subclassification (provider level)', () => {
  it('A: JWT generation failure -> settle_jwt_generation_failed, no HTTP status, unverified', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const evidence = await settleWith(
      facilitator({
        createAuthHeaders: async () => {
          throw new TypeError('getRandomValues is not a function');
        },
      })
    );
    expect(evidence.success).toBe(false);
    expect(evidence.subreason).toBe('settle_jwt_generation_failed');
    expect(typeof evidence.jwt_subreason).toBe('string');
    expect(evidence.transport_status).toBeUndefined();
    expect(evidence.retryability).toBe('operator_action_required');
    expect(evidence.trust_class).toBe('external_unverified');
    expect(evidence.reason).toBe('facilitator_settlement_unavailable');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('B: facilitator HTTP 400 with an invalid-signature reason -> settle_payment_invalid', async () => {
    stubFetch(async () =>
      jsonResponse(400, {
        success: false,
        errorReason: 'invalid_exact_evm_payload_signature',
        transaction: '',
        network: TEST_NETWORK,
      })
    );
    const evidence = await settleWith(facilitator({}));
    expect(evidence.success).toBe(false);
    expect(evidence.subreason).toBe('settle_payment_invalid');
    expect(evidence.transport_status).toBe(400);
    expect(evidence.retryability).toBe('non_retryable');
    expect(evidence.trust_class).toBe('external_verified');
    expect(evidence.reason).toBe('invalid_exact_evm_payload_signature');
  });

  it.each([
    [401, 'settle_authentication_rejected', 'operator_action_required'],
    [403, 'settle_authorization_rejected', 'operator_action_required'],
    [429, 'settle_rate_limited', 'transient'],
    [500, 'settle_http_5xx', 'transient'],
    [503, 'settle_http_5xx', 'transient'],
    [404, 'settle_http_4xx', 'non_retryable'],
  ])('C/D/F/G: bare HTTP %i -> %s', async (status, subreason, retryability) => {
    stubFetch(async () => jsonResponse(status, BODY_LEAK));
    const evidence = await settleWith(facilitator({}));
    expect(evidence.success).toBe(false);
    expect(evidence.subreason).toBe(subreason);
    expect(evidence.transport_status).toBe(status);
    expect(evidence.retryability).toBe(retryability);
    expect(evidence.trust_class).toBe('external_unverified');
    expect(JSON.stringify(evidence)).not.toContain(BODY_LEAK);
  });

  it('E: HTTP 409 replay-style rejection -> settle_nonce_replay', async () => {
    stubFetch(async () =>
      jsonResponse(409, {
        success: false,
        errorReason: 'invalid_exact_evm_nonce_already_used',
        transaction: '',
        network: TEST_NETWORK,
      })
    );
    const evidence = await settleWith(facilitator({}));
    expect(evidence.subreason).toBe('settle_nonce_replay');
    expect(evidence.transport_status).toBe(409);
    expect(evidence.retryability).toBe('non_retryable');
  });

  it('H: network failure -> settle_network_unavailable', async () => {
    stubFetch(async () => {
      throw new TypeError(`fetch failed ${MESSAGE_LEAK}`);
    });
    const evidence = await settleWith(facilitator({}));
    expect(evidence.subreason).toBe('settle_network_unavailable');
    expect(evidence.transport_status).toBeUndefined();
    expect(evidence.retryability).toBe('unknown');
    expect(JSON.stringify(evidence)).not.toContain(MESSAGE_LEAK);
  });

  it('I: timeout -> settle_timeout (indeterminate, never "non_retryable")', async () => {
    stubFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          );
        })
    );
    const evidence = await settleWith(facilitator({ timeoutMs: 20 }));
    expect(evidence.subreason).toBe('settle_timeout');
    expect(evidence.retryability).toBe('unknown');
  });

  it('J: malformed 2xx settle body -> settle_response_invalid', async () => {
    stubFetch(async () => jsonResponse(200, { unexpected: BODY_LEAK }));
    const evidence = await settleWith(facilitator({}));
    expect(evidence.success).toBe(false);
    expect(evidence.subreason).toBe('settle_response_invalid');
    expect(JSON.stringify(evidence)).not.toContain(BODY_LEAK);
  });

  it('K: facilitator answers 2xx success:false with a reason -> facilitator-answered subreason', async () => {
    stubFetch(async () =>
      jsonResponse(200, {
        success: false,
        errorReason: 'insufficient_funds',
        transaction: '',
        network: TEST_NETWORK,
      })
    );
    const evidence = await settleWith(facilitator({}));
    expect(evidence.success).toBe(false);
    expect(evidence.reason).toBe('insufficient_funds');
    expect(evidence.subreason).toBe('settle_payment_invalid');
    expect(evidence.trust_class).toBe('external_verified');
  });

  it('L: successful settlement carries no failure diagnostics and no reason', async () => {
    stubFetch(async () =>
      jsonResponse(200, {
        success: true,
        transaction: '0xabc',
        network: TEST_NETWORK,
        payer: '0x000000000000000000000000000000000000bb',
      })
    );
    const evidence = await settleWith(facilitator({}));
    expect(evidence.success).toBe(true);
    expect(evidence.reason).toBeUndefined();
    expect(evidence.subreason).toBeUndefined();
    expect(evidence.transport_status).toBeUndefined();
    expect(evidence.retryability).toBeUndefined();
  });

  it('diagnostics never enter raw_evidence_hash (hash is unchanged from the pre-observability shape)', async () => {
    stubFetch(async () => jsonResponse(503, 'unavailable'));
    const evidence = await settleWith(facilitator({}));
    const expected = await hashPaymentObject({
      kind: 'cdp_settle_response',
      quote_id: DECRYPTED.settlementContext.quote_id,
      requirement_id: DECRYPTED.settlementContext.requirement_id,
      payment_identifier: DECRYPTED.settlementContext.payment_identifier,
      success: false,
      transaction: null,
      network: DECRYPTED.settlementContext.network,
      amount: null,
      payer: null,
      errorReason: 'facilitator_settlement_unavailable',
    });
    expect(evidence.raw_evidence_hash).toBe(expected);
  });

  it('pure classifier: never returns message, cause, headers or arbitrary text', () => {
    const hostile = Object.assign(new Error(`${MESSAGE_LEAK} ${FAKE_JWT}`), {
      name: 'SettleError',
      statusCode: 400,
      errorReason: `${MESSAGE_LEAK}`,
    });
    const classified = classifyFacilitatorSettleFailure(hostile);
    expect(JSON.stringify(classified)).not.toContain(MESSAGE_LEAK);
    expect(JSON.stringify(classified)).not.toContain('eyJ');
    const jwt = classifyFacilitatorSettleFailure(new FacilitatorAuthStageError(hostile));
    expect(JSON.stringify(jwt)).not.toContain(MESSAGE_LEAK);
    expect(classifyFacilitatorSettleFailure(undefined).subreason).toBe('settle_unknown_failure');
    expect(classifyFacilitatorSettleFailure('a string').subreason).toBe('settle_unknown_failure');
    expect(classifyAnsweredSettleFailure(undefined).subreason).toBe('settle_facilitator_rejected');
    expect(classifyAnsweredSettleFailure('settlement_network_mismatch').subreason).toBe(
      'settle_requirement_mismatch'
    );
  });
});

describe('workflow-boundary normalization', () => {
  it('drops anything that is not a short lowercase token or a plain HTTP status', () => {
    expect(
      normalizeSettlementDiagnostics({
        subreason: `settle_x ${MESSAGE_LEAK}`,
        jwt_subreason: FAKE_JWT,
        transport_status: 99999,
        retryability: 'Bearer secret',
      })
    ).toBeUndefined();
    expect(
      normalizeSettlementDiagnostics({
        subreason: 'settle_http_5xx',
        transport_status: 503,
        retryability: 'transient',
        jwt_subreason: 12,
      })
    ).toEqual({ subreason: 'settle_http_5xx', transport_status: 503, retryability: 'transient' });
  });

  it('formats one audit detail: gate reason first, then the same normalized fields', () => {
    expect(formatSettlementAuditDetail('settlement_not_successful', undefined)).toBe(
      'settlement_not_successful'
    );
    expect(
      formatSettlementAuditDetail('settlement_not_successful', {
        subreason: 'settle_jwt_generation_failed',
        jwt_subreason: 'cdp_jwt_unknown_failure',
        retryability: 'operator_action_required',
      })
    ).toBe(
      'settlement_not_successful;subreason=settle_jwt_generation_failed;jwt=cdp_jwt_unknown_failure;retry=operator_action_required'
    );
  });
});

describe('provider -> gate -> Workflow -> durable audit', () => {
  it('M: the safe reason survives the whole path and all three surfaces agree', async () => {
    stubFetch(async () => jsonResponse(503, BODY_LEAK));
    const client = facilitator({});
    const provider = await settleWith(client);
    const { result, deps } = await runWorkflowWith(client);

    expect(result.status).toBe('settlement_rejected');
    // Public contract: error_code is the gate enum, byte-identical to before.
    expect(result.error_code).toBe('settlement_not_successful');
    // Workflow result surface.
    expect(result.settlement_subreason).toBe(provider.subreason);
    expect(result.settlement_subreason).toBe('settle_http_5xx');
    expect(result.settlement_transport_status).toBe(503);
    expect(result.settlement_retryability).toBe('transient');
    // Durable audit surface (job state event evidence_ref).
    const refundEvent = deps.jobPersistence.events.find((e) => e.to_state === 'REFUND_REQUIRED');
    expect(refundEvent).toBeDefined();
    expect(refundEvent!.evidence_ref).toBe(
      'settlement_not_successful;subreason=settle_http_5xx;http=503;retry=transient'
    );
    // PROVIDER_REASON = WORKFLOW_SETTLE_REASON = DURABLE_AUDIT_REASON.
    const auditSubreason = /subreason=([a-z0-9_]+)/.exec(refundEvent!.evidence_ref ?? '')?.[1];
    expect(auditSubreason).toBe(provider.subreason);
    expect(auditSubreason).toBe(result.settlement_subreason);
  });

  it('M2: a JWT-stage settle failure is durably distinguishable from a facilitator rejection', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const { result, deps } = await runWorkflowWith(
      facilitator({
        createAuthHeaders: async () => {
          throw new TypeError('getRandomValues is not a function');
        },
      })
    );
    expect(result.error_code).toBe('settlement_not_successful');
    expect(result.settlement_subreason).toBe('settle_jwt_generation_failed');
    expect(result.settlement_jwt_subreason).toMatch(/^[a-z0-9_]+$/);
    expect(result.settlement_transport_status).toBeUndefined();
    const refundEvent = deps.jobPersistence.events.find((e) => e.to_state === 'REFUND_REQUIRED');
    expect(refundEvent!.evidence_ref).toContain('subreason=settle_jwt_generation_failed');
    expect(refundEvent!.evidence_ref).toContain('jwt=');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('N: no payment, JWT, secret, body or exception text survives the path', async () => {
    stubFetch(async () => jsonResponse(400, BODY_LEAK));
    const { result, deps } = await runWorkflowWith(facilitator({}));
    const persisted = JSON.stringify({
      result,
      events: deps.jobPersistence.events,
      results: [...deps.resultReceiptPersistence.results.values()],
    });
    for (const marker of SECRET_MARKERS) expect(persisted).not.toContain(marker);
    expect(persisted).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
  });

  it('O: public API semantics unchanged: 402 body still carries only the gate enum', () => {
    const route = readFileSync(
      path.join(__dirname, '../src/control-plane/routes/x402-service.ts'),
      'utf8'
    );
    expect(route).toContain(
      "return jsonError(c, 402, 'settlement_rejected', result.error_code ?? result.status);"
    );
    expect(route).not.toMatch(
      /settlement_subreason|settlement_jwt_subreason|settlement_retryability/
    );
  });

  it('P: REFUND_REQUIRED is reached with zero settlements, zero result rows and no receipt', async () => {
    stubFetch(async () => jsonResponse(503, 'down'));
    const { result, deps } = await runWorkflowWith(facilitator({}));
    expect(deps.jobPersistence.jobs.get(TEST_JOB_ID)?.current_state).toBe('REFUND_REQUIRED');
    // REFUND_REQUIRED != proof that funds were captured.
    expect(result.settlement_transaction_reference).toBeUndefined();
    expect(result.receipt_id).toBeUndefined();
    const row = deps.settlementRepository.rows.get(TEST_PAYMENT_IDENTIFIER);
    expect(row?.lifecycleStage).toBe('settlement_failed');
    expect(row?.settlementTransactionReference ?? null).toBeNull();
    expect(row?.cdpSuccessfulEconomicSettlementCount).toBe(0);
  });

  it('Q: result persistence happens only after settlement success', async () => {
    stubFetch(async () => jsonResponse(503, 'down'));
    const failed = await runWorkflowWith(facilitator({}));
    expect(failed.deps.resultReceiptPersistence.persistResultCallCount).toBe(0);
    expect(failed.deps.resultReceiptPersistence.results.size).toBe(0);

    stubFetch(async () =>
      jsonResponse(200, {
        success: true,
        transaction: '0xabc',
        network: TEST_NETWORK,
        payer: '0x000000000000000000000000000000000000bb',
      })
    );
    const ok = await runWorkflowWith(facilitator({}), 'production');
    expect(ok.result.status).toBe('settled');
    expect(ok.result.settlement_subreason).toBeUndefined();
    expect(ok.deps.resultReceiptPersistence.results.size).toBe(1);
  });
});
