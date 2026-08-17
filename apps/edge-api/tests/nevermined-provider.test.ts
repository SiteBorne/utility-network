import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ExternalVerificationEvidence,
  PaymentSettlementContext,
  PaymentVerificationContext,
} from '@siteborne/protocol-x402';
import {
  readNeverminedSettlementObservation,
  type NeverminedFacilitatorClient,
} from '@siteborne/protocol-nevermined';

// SUN-1000 checkpoint 1P: `nevermined-provider.ts`'s authenticated path now
// talks to `NeverminedHttpFacilitatorClient` (real `fetch`, no
// `@nevermined-io/payments` dependency) instead of the SDK's
// `Payments.getInstance().facilitator` -- mock `fetch` itself rather than
// the (now entirely unused) SDK module.
const fetchMock = vi.fn();

import { NeverminedPaymentEvidenceProvider } from '../src/control-plane/evidence/nevermined-provider';

const BUYER = '0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99';
const PAYMENT_REQUIRED = {
  x402Version: 2 as const,
  resource: { url: 'https://fixture.test/v1/nevermined/document/evidence-json' },
  accepts: [
    {
      scheme: 'nvm:erc4337' as const,
      network: 'eip155:84532',
      planId: 'siteborne:document_evidence_json.v1:payg',
      extra: {
        version: '1',
        agentId: 'siteborne:document_evidence_json.v1:agent',
        httpVerb: 'POST',
      },
    },
  ],
  extensions: {
    'net.siteborne.payment': {
      version: 1,
      payment_rail: 'nevermined',
      payment_provider: 'nevermined-payments@1.10.0',
      service_id: 'document_evidence_json.v1',
      route: 'https://fixture.test/v1/nevermined/document/evidence-json',
      quote_id: 'qte_' + '1'.repeat(24),
      requirement_id: 'req_' + '2'.repeat(24),
      amount: '190000',
      semantics: 'upto',
      expires_at: '2026-08-11T02:05:00.000Z',
      payment_identifier_required: true,
      production_enabled: false,
    },
  },
};

const BASE_CONTEXT = {
  service_id: 'document_evidence_json.v1' as const,
  service_version: 'v1' as const,
  scheme: 'upto' as const,
  network: 'eip155:84532' as const,
  asset: 'nevermined:credits',
  payee: 'siteborne:publisher',
  quote_id: 'qte_' + '1'.repeat(24),
  requirement_id: 'req_' + '2'.repeat(24),
  payment_identifier: 'pay_' + '3'.repeat(28),
  amount: '190000',
  nowIso: '2026-08-11T02:00:00.000Z',
  expiresAt: '2026-08-11T02:05:00.000Z',
  authorizationContext: {
    rail: 'nevermined' as const,
    accessToken: 'opaque-token-must-never-enter-evidence',
    paymentRequired: PAYMENT_REQUIRED,
    agentId: 'siteborne:document_evidence_json.v1:agent',
    planId: 'siteborne:document_evidence_json.v1:payg',
  },
};

const VERIFY_CONTEXT: PaymentVerificationContext = BASE_CONTEXT;
const SETTLE_CONTEXT: PaymentSettlementContext = {
  ...BASE_CONTEXT,
  usageResult: {
    usage_result_id: 'usg_' + '4'.repeat(24),
    quote_id: BASE_CONTEXT.quote_id,
    requirement_id: BASE_CONTEXT.requirement_id,
    payment_identifier: BASE_CONTEXT.payment_identifier,
    service_id: BASE_CONTEXT.service_id,
    service_version: 'v1',
    request_input_hash: 'sha256:' + '5'.repeat(64),
    service_output_hash: 'sha256:' + '6'.repeat(64),
    verification_receipt_id: 'rcpt_' + '7'.repeat(24),
    verification_receipt_hash: 'sha256:' + '8'.repeat(64),
    resource_metrics_hash: 'sha256:' + '9'.repeat(64),
    actual_amount: '12000',
    authorized_maximum: BASE_CONTEXT.amount,
    usage_result_hash: 'sha256:' + 'a'.repeat(64),
  },
};

function fixtureClient(
  overrides: Partial<NeverminedFacilitatorClient> = {}
): NeverminedFacilitatorClient {
  return {
    async verifyPermissions() {
      return {
        isValid: true,
        payer: BUYER,
        network: BASE_CONTEXT.network,
        agentRequestId: 'agent-request-1',
      };
    },
    async settlePermissions() {
      return {
        success: true,
        payer: BUYER,
        transaction: 'fixture:settlement:1',
        network: BASE_CONTEXT.network,
        creditsRedeemed: '12000',
        remainingBalance: '988000',
      };
    },
    ...overrides,
  };
}

function acceptedVerification(): ExternalVerificationEvidence {
  return {
    x402_version: 2,
    scheme: 'upto',
    network: BASE_CONTEXT.network,
    quote_id: BASE_CONTEXT.quote_id,
    requirement_id: BASE_CONTEXT.requirement_id,
    payment_identifier: BASE_CONTEXT.payment_identifier,
    verified: true,
    payer: BUYER,
    verifier_identity: 'nevermined-payments@1.10.0',
    evidence_timestamp: BASE_CONTEXT.nowIso,
    raw_evidence_hash: 'sha256:' + 'b'.repeat(64),
    trust_class: 'synthetic_fixture',
  };
}

/** Builds a fetch-shaped Response for a given JSON body + status. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('NeverminedPaymentEvidenceProvider trust boundary', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(async (url: string | URL) => {
      const path = new URL(url).pathname;
      if (path === '/api/v1/x402/verify') {
        return jsonResponse({
          isValid: true,
          payer: BUYER,
          network: BASE_CONTEXT.network,
          agentRequestId: 'agent-request-1',
        });
      }
      if (path === '/api/v1/x402/settle') {
        return jsonResponse({
          success: true,
          payer: BUYER,
          transaction: '0x' + 'c'.repeat(64),
          network: BASE_CONTEXT.network,
          creditsRedeemed: '12000',
          remainingBalance: '988000',
        });
      }
      throw new Error(`unexpected fetch to ${path}`);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not perform a network call merely by importing the provider module', () => {
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps an injected fixture client synthetic even when the client accepts payment', async () => {
    const provider = NeverminedPaymentEvidenceProvider.fixture(fixtureClient());
    const evidence = await provider.verify(VERIFY_CONTEXT);
    expect(provider.providerKind).toBe('fixture');
    expect(evidence).toMatchObject({ verified: true, trust_class: 'synthetic_fixture' });
    expect(JSON.stringify(evidence)).not.toContain(BASE_CONTEXT.authorizationContext.accessToken);
  });

  it('refuses authenticated construction unless the explicit sandbox live guard passes', () => {
    expect(() =>
      NeverminedPaymentEvidenceProvider.authenticated({
        apiKey: 'secret-never-serialized',
        environment: 'sandbox',
        liveGuard: { runLiveNevermined: '0', apiKeyEnvironment: 'sandbox' },
      })
    ).toThrow('nevermined_live_guard_denied');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps the authenticated direct-HTTP client to external verified evidence, with the exact real wire shape', async () => {
    const provider = NeverminedPaymentEvidenceProvider.authenticated({
      apiKey: 'secret-never-serialized',
      environment: 'sandbox',
      liveGuard: { runLiveNevermined: '1', apiKeyEnvironment: 'sandbox' },
    });
    const evidence = await provider.verify(VERIFY_CONTEXT);

    expect(provider.providerKind).toBe('external');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(new URL(url).toString()).toBe('https://api.sandbox.nevermined.app/api/v1/x402/verify');
    expect(options.method).toBe('POST');
    expect(options.headers).toMatchObject({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: 'Bearer secret-never-serialized',
      'Nevermined-Version': '1.1',
    });
    expect(JSON.parse(options.body)).toEqual({
      paymentRequired: PAYMENT_REQUIRED,
      x402AccessToken: BASE_CONTEXT.authorizationContext.accessToken,
      maxAmount: '190000',
    });
    expect(evidence).toMatchObject({
      verified: true,
      payer: BUYER,
      trust_class: 'external_verified',
    });
    expect(JSON.stringify(evidence)).not.toContain(BASE_CONTEXT.authorizationContext.accessToken);
    expect(JSON.stringify(evidence)).not.toContain('secret-never-serialized');
  });

  it('settles the measured actual amount and forwards the verified agent request identity, with the exact real wire shape', async () => {
    const provider = NeverminedPaymentEvidenceProvider.authenticated({
      apiKey: 'secret-never-serialized',
      environment: 'sandbox',
      liveGuard: { runLiveNevermined: '1', apiKeyEnvironment: 'sandbox' },
    });
    const verification = await provider.verify(VERIFY_CONTEXT);
    const evidence = await provider.settle(SETTLE_CONTEXT, verification, '12000');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, options] = fetchMock.mock.calls[1]!;
    expect(new URL(url).toString()).toBe('https://api.sandbox.nevermined.app/api/v1/x402/settle');
    expect(JSON.parse(options.body)).toEqual({
      paymentRequired: PAYMENT_REQUIRED,
      x402AccessToken: BASE_CONTEXT.authorizationContext.accessToken,
      maxAmount: '12000',
      agentRequestId: 'agent-request-1',
    });
    expect(evidence).toMatchObject({
      success: true,
      actual_amount: '12000',
      authorized_maximum: '190000',
      usage_result_hash: SETTLE_CONTEXT.usageResult!.usage_result_hash,
      trust_class: 'external_verified',
    });
    expect(readNeverminedSettlementObservation(evidence)).toEqual({
      credits_redeemed: '12000',
      remaining_balance: '988000',
      transaction: '0x' + 'c'.repeat(64),
    });
    expect(JSON.stringify(evidence)).not.toContain(BASE_CONTEXT.authorizationContext.accessToken);
    expect(JSON.stringify(evidence)).not.toContain('secret-never-serialized');
  });

  it('fails closed before settlement when actual usage exceeds authorization', async () => {
    let settleCalls = 0;
    const provider = NeverminedPaymentEvidenceProvider.fixture(
      fixtureClient({
        async settlePermissions() {
          settleCalls += 1;
          throw new Error('must not be reached');
        },
      })
    );
    const evidence = await provider.settle(SETTLE_CONTEXT, acceptedVerification(), '190001');
    expect(evidence).toMatchObject({ success: false, reason: 'authorization_exceeded' });
    expect(settleCalls).toBe(0);
  });

  it('normalizes provider exceptions without exposing free-form messages or access tokens', async () => {
    const provider = NeverminedPaymentEvidenceProvider.fixture(
      fixtureClient({
        async verifyPermissions() {
          throw new Error(
            `unsafe provider diagnostic ${BASE_CONTEXT.authorizationContext.accessToken}`
          );
        },
      })
    );
    const evidence = await provider.verify(VERIFY_CONTEXT);
    expect(evidence).toMatchObject({
      verified: false,
      reason: 'provider_exception',
      trust_class: 'synthetic_fixture',
    });
    expect(JSON.stringify(evidence)).not.toContain('unsafe provider diagnostic');
    expect(JSON.stringify(evidence)).not.toContain(BASE_CONTEXT.authorizationContext.accessToken);
  });

  it('normalizes settlement exceptions independently and emits no authorization material', async () => {
    const provider = NeverminedPaymentEvidenceProvider.fixture(
      fixtureClient({
        async settlePermissions() {
          throw new Error(
            `unsafe settlement diagnostic ${BASE_CONTEXT.authorizationContext.accessToken}`
          );
        },
      })
    );
    await provider.verify(VERIFY_CONTEXT);
    const evidence = await provider.settle(SETTLE_CONTEXT, acceptedVerification(), '12000');
    expect(evidence).toMatchObject({
      success: false,
      reason: 'provider_exception',
      trust_class: 'synthetic_fixture',
    });
    expect(JSON.stringify(evidence)).not.toContain('unsafe settlement diagnostic');
    expect(JSON.stringify(evidence)).not.toContain(BASE_CONTEXT.authorizationContext.accessToken);
  });

  it.each([
    [{ payer: '0x0000000000000000000000000000000000000001' }, 'payer_mismatch'],
    [{ network: 'eip155:8453' }, 'network_mismatch'],
    [{ creditsRedeemed: '190000' }, 'amount_mismatch'],
    [{ transaction: '' }, 'missing_transaction'],
  ])('fails closed on mutated settlement bindings: %s', async (mutation, reason) => {
    const provider = NeverminedPaymentEvidenceProvider.fixture(
      fixtureClient({
        async settlePermissions() {
          return {
            success: true,
            payer: BUYER,
            transaction: 'fixture:settlement:binding-test',
            network: BASE_CONTEXT.network,
            creditsRedeemed: '12000',
            ...mutation,
          };
        },
      })
    );
    await provider.verify(VERIFY_CONTEXT);
    const evidence = await provider.settle(SETTLE_CONTEXT, acceptedVerification(), '12000');
    expect(evidence).toMatchObject({ success: false, reason });
  });

  it('rejects a transaction reference whose shape cannot come from the selected trust source', async () => {
    const provider = NeverminedPaymentEvidenceProvider.fixture(
      fixtureClient({
        async settlePermissions() {
          return {
            success: true,
            payer: BUYER,
            transaction: '0x' + 'd'.repeat(64),
            network: BASE_CONTEXT.network,
            creditsRedeemed: '12000',
          };
        },
      })
    );
    await provider.verify(VERIFY_CONTEXT);
    const evidence = await provider.settle(SETTLE_CONTEXT, acceptedVerification(), '12000');
    expect(evidence).toMatchObject({
      success: false,
      reason: 'transaction_reference_invalid',
      trust_class: 'synthetic_fixture',
    });
  });
});
