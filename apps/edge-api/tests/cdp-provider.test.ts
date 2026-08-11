import { describe, expect, it } from 'vitest';
import type { HTTPFacilitatorClient } from '@x402/core/server';
import type {
  ExternalVerificationEvidence,
  PaymentSettlementContext,
  PaymentVerificationContext,
} from '@siteborne/protocol-x402';
import { hashPaymentObject } from '@siteborne/protocol-x402';
import {
  CdpPaymentEvidenceProvider,
  checkCdpSupportsNetwork,
} from '../src/control-plane/evidence/cdp-provider';

const REQUIREMENTS = {
  scheme: 'exact' as const,
  network: 'eip155:84532' as const,
  asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  amount: '9000',
  payTo: '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1',
  maxTimeoutSeconds: 60,
  extra: { quote_id: 'qte_' + '1'.repeat(24) },
};

const FACILITATOR_ADDRESS = '0x1234567890123456789012345678901234567890';

const UPTO_REQUIREMENTS = {
  ...REQUIREMENTS,
  scheme: 'upto' as const,
  amount: '250000',
  extra: { ...REQUIREMENTS.extra, facilitatorAddress: FACILITATOR_ADDRESS },
};

const PAYMENT_PAYLOAD = {
  x402Version: 2,
  accepted: REQUIREMENTS,
  payload: { signature: 'signed-authorization-must-never-enter-evidence' },
};

const BASE_CONTEXT = {
  service_id: 'web_context_verified.v1' as const,
  service_version: 'v1' as const,
  scheme: 'exact' as const,
  network: 'eip155:84532' as const,
  asset: REQUIREMENTS.asset,
  payee: REQUIREMENTS.payTo,
  quote_id: 'qte_' + '1'.repeat(24),
  requirement_id: 'req_' + '2'.repeat(24),
  payment_identifier: 'pay_' + '3'.repeat(28),
  amount: REQUIREMENTS.amount,
  nowIso: '2026-08-10T22:00:00.000Z',
  expiresAt: '2026-08-10T22:05:00.000Z',
};

const VERIFY_CONTEXT: PaymentVerificationContext = {
  ...BASE_CONTEXT,
  authorizationContext: { rail: 'cdp' },
  paymentPayload: PAYMENT_PAYLOAD,
  paymentRequirements: REQUIREMENTS,
};

const SETTLE_CONTEXT: PaymentSettlementContext = {
  ...BASE_CONTEXT,
  authorizationContext: { rail: 'cdp' },
  paymentPayload: PAYMENT_PAYLOAD,
  paymentRequirements: REQUIREMENTS,
};

const UPTO_SETTLE_CONTEXT: PaymentSettlementContext = {
  ...BASE_CONTEXT,
  scheme: 'upto',
  amount: UPTO_REQUIREMENTS.amount,
  authorizationContext: { rail: 'cdp' },
  paymentPayload: {
    ...PAYMENT_PAYLOAD,
    accepted: UPTO_REQUIREMENTS,
  },
  paymentRequirements: UPTO_REQUIREMENTS,
  usageResult: {
    usage_result_id: 'use_' + '5'.repeat(24),
    quote_id: BASE_CONTEXT.quote_id,
    requirement_id: BASE_CONTEXT.requirement_id,
    payment_identifier: BASE_CONTEXT.payment_identifier,
    service_id: 'document_evidence_json.v1',
    service_version: 'v1',
    request_input_hash: 'sha256:' + '6'.repeat(64),
    service_output_hash: 'sha256:' + '7'.repeat(64),
    verification_receipt_id: 'rcpt_' + '8'.repeat(24),
    verification_receipt_hash: 'sha256:' + 'b'.repeat(64),
    resource_metrics_hash: 'sha256:' + '9'.repeat(64),
    actual_amount: '12000',
    authorized_maximum: UPTO_REQUIREMENTS.amount,
    usage_result_hash: 'sha256:' + 'a'.repeat(64),
  },
};

function facilitator(
  overrides: Partial<Pick<HTTPFacilitatorClient, 'verify' | 'settle' | 'getSupported'>> = {}
): HTTPFacilitatorClient {
  return {
    async verify() {
      return { isValid: true, payer: '0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99' };
    },
    async settle() {
      return {
        success: true,
        transaction: '0x' + 'a'.repeat(64),
        network: BASE_CONTEXT.network,
        payer: '0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99',
        amount: BASE_CONTEXT.amount,
      };
    },
    async getSupported() {
      return {
        kinds: [
          { x402Version: 2, scheme: 'exact', network: BASE_CONTEXT.network },
          {
            x402Version: 2,
            scheme: 'upto',
            network: BASE_CONTEXT.network,
            extra: { facilitatorAddress: FACILITATOR_ADDRESS },
          },
        ],
        extensions: [],
        signers: {},
      };
    },
    ...overrides,
  } as unknown as HTTPFacilitatorClient;
}

function acceptedVerification(): ExternalVerificationEvidence {
  return {
    x402_version: 2,
    scheme: BASE_CONTEXT.scheme,
    network: BASE_CONTEXT.network,
    quote_id: BASE_CONTEXT.quote_id,
    requirement_id: BASE_CONTEXT.requirement_id,
    payment_identifier: BASE_CONTEXT.payment_identifier,
    verified: true,
    payer: '0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99',
    verifier_identity: 'cdp:facilitator',
    evidence_timestamp: BASE_CONTEXT.nowIso,
    raw_evidence_hash: 'sha256:' + '4'.repeat(64),
    trust_class: 'external_verified',
  };
}

describe('CdpPaymentEvidenceProvider', () => {
  it('forwards the exact validated payload/requirements references and excludes authorization material from verification evidence hashing', async () => {
    let sawPayload = false;
    let sawRequirements = false;
    const client = facilitator({
      async verify(payload, requirements) {
        sawPayload = payload === VERIFY_CONTEXT.paymentPayload;
        sawRequirements = requirements === VERIFY_CONTEXT.paymentRequirements;
        return { isValid: true, payer: '0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99' };
      },
    });
    const provider = new CdpPaymentEvidenceProvider(client);

    const evidence = await provider.verify(VERIFY_CONTEXT);

    expect(sawPayload).toBe(true);
    expect(sawRequirements).toBe(true);
    expect(evidence).toMatchObject({
      verified: true,
      trust_class: 'external_verified',
      quote_id: BASE_CONTEXT.quote_id,
      requirement_id: BASE_CONTEXT.requirement_id,
      payment_identifier: BASE_CONTEXT.payment_identifier,
    });
    expect(evidence.raw_evidence_hash).toBe(
      await hashPaymentObject({
        kind: 'cdp_verify_response',
        quote_id: BASE_CONTEXT.quote_id,
        requirement_id: BASE_CONTEXT.requirement_id,
        payment_identifier: BASE_CONTEXT.payment_identifier,
        isValid: true,
        invalidReason: null,
        payer: '0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99',
      })
    );
  });

  it('does not expose a facilitator free-form invalidMessage as public rejection evidence', async () => {
    const provider = new CdpPaymentEvidenceProvider(
      facilitator({
        async verify() {
          return {
            isValid: false,
            invalidMessage: 'unsafe free-form diagnostic containing signed request details',
          };
        },
      })
    );

    const evidence = await provider.verify(VERIFY_CONTEXT);

    expect(evidence.verified).toBe(false);
    expect(evidence.reason).toBe('facilitator_rejected');
  });

  it('normalizes a thrown facilitator verification rejection into sanitized fail-closed evidence', async () => {
    const provider = new CdpPaymentEvidenceProvider(
      facilitator({
        async verify() {
          throw Object.assign(new Error('free-form text must never escape'), {
            invalidReason: 'invalid_exact_evm_payload_authorization_value',
            invalidMessage: 'signed authorization details must never escape',
            payer: '0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99',
            statusCode: 400,
          });
        },
      })
    );

    const evidence = await provider.verify(VERIFY_CONTEXT);

    expect(evidence).toMatchObject({
      verified: false,
      reason: 'invalid_exact_evm_payload_authorization_value',
      payer: '0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99',
      trust_class: 'external_verified',
    });
    expect(JSON.stringify(evidence)).not.toContain('signed authorization details');
    expect(JSON.stringify(evidence)).not.toContain('free-form text');
  });

  it('settles with the exact payload/requirements references and accepts matching external bindings', async () => {
    let sawPayload = false;
    let sawRequirements = false;
    const provider = new CdpPaymentEvidenceProvider(
      facilitator({
        async settle(payload, requirements) {
          sawPayload = payload === SETTLE_CONTEXT.paymentPayload;
          sawRequirements = requirements === SETTLE_CONTEXT.paymentRequirements;
          return {
            success: true,
            transaction: '0x' + 'a'.repeat(64),
            network: BASE_CONTEXT.network,
            payer: '0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99',
            amount: BASE_CONTEXT.amount,
          };
        },
      })
    );

    const evidence = await provider.settle(
      SETTLE_CONTEXT,
      acceptedVerification(),
      BASE_CONTEXT.amount
    );

    expect(sawPayload).toBe(true);
    expect(sawRequirements).toBe(true);
    expect(evidence).toMatchObject({
      success: true,
      network: BASE_CONTEXT.network,
      actual_amount: BASE_CONTEXT.amount,
      transaction_reference: '0x' + 'a'.repeat(64),
      trust_class: 'external_verified',
    });
  });

  it('settles upto for measured actual amount while preserving the signed authorized maximum', async () => {
    const actualAmount = UPTO_SETTLE_CONTEXT.usageResult!.actual_amount;
    let settlementRequirements: typeof UPTO_REQUIREMENTS | undefined;
    const provider = new CdpPaymentEvidenceProvider(
      facilitator({
        async settle(payload, requirements) {
          expect(payload).toBe(UPTO_SETTLE_CONTEXT.paymentPayload);
          settlementRequirements = requirements as typeof UPTO_REQUIREMENTS;
          return {
            success: true,
            transaction: '0x' + 'd'.repeat(64),
            network: BASE_CONTEXT.network,
            payer: '0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99',
            amount: actualAmount,
          };
        },
      })
    );

    const evidence = await provider.settle(
      UPTO_SETTLE_CONTEXT,
      { ...acceptedVerification(), scheme: 'upto' },
      actualAmount
    );

    expect(UPTO_SETTLE_CONTEXT.paymentRequirements.amount).toBe('250000');
    expect(UPTO_SETTLE_CONTEXT.paymentPayload.accepted.amount).toBe('250000');
    expect(settlementRequirements).toEqual({ ...UPTO_REQUIREMENTS, amount: actualAmount });
    expect(settlementRequirements).not.toBe(UPTO_SETTLE_CONTEXT.paymentRequirements);
    expect(evidence).toMatchObject({
      success: true,
      actual_amount: actualAmount,
      authorized_maximum: '250000',
      usage_result_hash: UPTO_SETTLE_CONTEXT.usageResult!.usage_result_hash,
    });
  });

  it('fails closed when the facilitator settlement network differs from the validated requirement', async () => {
    const provider = new CdpPaymentEvidenceProvider(
      facilitator({
        async settle() {
          return {
            success: true,
            transaction: '0x' + 'b'.repeat(64),
            network: 'eip155:8453',
            amount: BASE_CONTEXT.amount,
          };
        },
      })
    );

    const evidence = await provider.settle(
      SETTLE_CONTEXT,
      acceptedVerification(),
      BASE_CONTEXT.amount
    );

    expect(evidence.success).toBe(false);
    expect(evidence.reason).toBe('settlement_network_mismatch');
  });

  it('fails closed when the facilitator-reported settlement amount differs from the actual amount', async () => {
    const provider = new CdpPaymentEvidenceProvider(
      facilitator({
        async settle() {
          return {
            success: true,
            transaction: '0x' + 'c'.repeat(64),
            network: BASE_CONTEXT.network,
            amount: '1',
          };
        },
      })
    );

    const evidence = await provider.settle(
      SETTLE_CONTEXT,
      acceptedVerification(),
      BASE_CONTEXT.amount
    );

    expect(evidence.success).toBe(false);
    expect(evidence.reason).toBe('settlement_amount_mismatch');
  });

  it('normalizes a thrown facilitator settlement failure and never exposes its free-form message', async () => {
    const provider = new CdpPaymentEvidenceProvider(
      facilitator({
        async settle() {
          throw Object.assign(new Error('free-form settlement details must never escape'), {
            errorReason: 'insufficient_funds',
            errorMessage: 'raw facilitator diagnostic must never escape',
            payer: '0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99',
            statusCode: 400,
          });
        },
      })
    );

    const evidence = await provider.settle(
      SETTLE_CONTEXT,
      acceptedVerification(),
      BASE_CONTEXT.amount
    );

    expect(evidence).toMatchObject({
      success: false,
      reason: 'insufficient_funds',
      payer: '0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99',
      trust_class: 'external_verified',
    });
    expect(evidence.transaction_reference).toBeUndefined();
    expect(JSON.stringify(evidence)).not.toContain('raw facilitator diagnostic');
    expect(JSON.stringify(evidence)).not.toContain('free-form settlement details');
  });
});

describe('checkCdpSupportsNetwork', () => {
  it('accepts Base Sepolia only when both exact and upto are advertised', async () => {
    const result = await checkCdpSupportsNetwork(facilitator(), BASE_CONTEXT.network, [
      'exact',
      'upto',
    ]);

    expect(result.ok).toBe(true);
    expect(result.kinds).toEqual([
      { scheme: 'exact', network: BASE_CONTEXT.network },
      { scheme: 'upto', network: BASE_CONTEXT.network },
    ]);
    expect(result.uptoFacilitatorAddress).toBe(FACILITATOR_ADDRESS);
  });

  it('fails closed when upto is absent', async () => {
    const result = await checkCdpSupportsNetwork(
      facilitator({
        async getSupported() {
          return {
            kinds: [{ x402Version: 2, scheme: 'exact', network: BASE_CONTEXT.network }],
            extensions: [],
            signers: {},
          };
        },
      }),
      BASE_CONTEXT.network,
      ['exact', 'upto']
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toBe(
      'facilitator does not advertise scheme(s) [upto] for network "eip155:84532"'
    );
  });

  it('fails closed when upto omits its required facilitator address', async () => {
    const result = await checkCdpSupportsNetwork(
      facilitator({
        async getSupported() {
          return {
            kinds: [
              { x402Version: 2, scheme: 'exact', network: BASE_CONTEXT.network },
              { x402Version: 2, scheme: 'upto', network: BASE_CONTEXT.network },
            ],
            extensions: [],
            signers: {},
          };
        },
      }),
      BASE_CONTEXT.network,
      ['exact', 'upto']
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toBe(
      'facilitator upto capability is missing a valid facilitatorAddress for network "eip155:84532"'
    );
  });
});
