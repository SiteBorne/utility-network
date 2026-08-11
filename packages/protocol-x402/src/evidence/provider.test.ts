import { describe, expect, it } from 'vitest';
import {
  FixturePaymentEvidenceProvider,
  ProductionEvidenceProviderNotConfiguredError,
  resolvePaymentEvidenceProvider,
} from './provider';
import type {
  PaymentEvidenceProvider,
  PaymentSettlementContext,
  PaymentVerificationContext,
} from './provider';
import { canAdvanceToSettled } from './settlement';
import { canAdvanceToVerified } from './verification';
import type {
  ExternalSettlementEvidence,
  ExternalVerificationEvidence,
  PaymentEvidenceContext,
} from './types';
import type { PaymentPayload, PaymentRequirements } from '../types';

const PAYMENT_REQUIREMENTS: PaymentRequirements = {
  scheme: 'exact',
  network: 'eip155:8453',
  asset: '0xUSDC',
  amount: '39000',
  payTo: '0xPayee',
  maxTimeoutSeconds: 60,
  extra: { quote_id: 'qte_' + '1'.repeat(24) },
};

const PAYMENT_PAYLOAD: PaymentPayload = {
  x402Version: 2,
  accepted: PAYMENT_REQUIREMENTS,
  payload: { signature: '0xdeadbeef' },
};

const CTX: PaymentEvidenceContext = {
  service_id: 'company_evidence_graph.v1',
  service_version: 'v1',
  scheme: 'exact',
  network: 'eip155:8453',
  asset: '0xUSDC',
  payee: '0xPayee',
  quote_id: 'qte_' + '1'.repeat(24),
  requirement_id: 'req_' + '1'.repeat(24),
  payment_identifier: 'pay_' + '1'.repeat(28),
  amount: '39000',
  nowIso: '2026-08-10T00:00:00.000Z',
  expiresAt: '2026-08-10T00:05:00.000Z',
};

const VERIFY_CTX: PaymentVerificationContext = {
  ...CTX,
  paymentPayload: PAYMENT_PAYLOAD,
  paymentRequirements: PAYMENT_REQUIREMENTS,
};

const SETTLE_CTX: PaymentSettlementContext = {
  ...CTX,
  paymentPayload: PAYMENT_PAYLOAD,
  paymentRequirements: PAYMENT_REQUIREMENTS,
};

describe('FixturePaymentEvidenceProvider', () => {
  it('declares providerKind "fixture"', () => {
    expect(new FixturePaymentEvidenceProvider().providerKind).toBe('fixture');
  });

  it('verify() always produces synthetic_fixture trust class, ignoring the real payload/requirements it is handed', async () => {
    const provider = new FixturePaymentEvidenceProvider();
    const evidence = await provider.verify(VERIFY_CTX);
    expect(evidence.trust_class).toBe('synthetic_fixture');
    expect(evidence.verified).toBe(true);
  });

  it('settle() always produces synthetic_fixture trust class, bound to the verification evidence hash', async () => {
    const provider = new FixturePaymentEvidenceProvider();
    const verification = await provider.verify(VERIFY_CTX);
    const settlement = await provider.settle(SETTLE_CTX, verification, CTX.amount);
    expect(settlement.trust_class).toBe('synthetic_fixture');
    expect(settlement.success).toBe(true);
    expect(settlement.actual_amount).toBe(CTX.amount);
  });
});

/**
 * A minimal, deliberately non-network `providerKind: 'external'` test
 * double (directive §13). It never calls CDP or any facilitator — it just
 * captures exactly what it was handed, so tests can prove the real
 * payload/requirements objects reach the provider boundary unaltered, and
 * so `resolvePaymentEvidenceProvider` production-mode selection can be
 * exercised without a real facilitator existing anywhere in this package.
 */
class RecordingExternalProvider implements PaymentEvidenceProvider {
  readonly providerKind = 'external' as const;
  verifyCalls: PaymentVerificationContext[] = [];
  settleCalls: {
    context: PaymentSettlementContext;
    verificationEvidence: ExternalVerificationEvidence;
    actualAmount: string;
  }[] = [];
  nextVerification: ExternalVerificationEvidence | undefined;
  nextSettlement: ExternalSettlementEvidence | undefined;

  async verify(context: PaymentVerificationContext): Promise<ExternalVerificationEvidence> {
    this.verifyCalls.push(context);
    if (!this.nextVerification) throw new Error('RecordingExternalProvider: no verification set');
    return this.nextVerification;
  }

  async settle(
    context: PaymentSettlementContext,
    verificationEvidence: ExternalVerificationEvidence,
    actualAmount: string
  ): Promise<ExternalSettlementEvidence> {
    this.settleCalls.push({ context, verificationEvidence, actualAmount });
    if (!this.nextSettlement) throw new Error('RecordingExternalProvider: no settlement set');
    return this.nextSettlement;
  }
}

function externalVerification(
  overrides: Partial<ExternalVerificationEvidence> = {}
): ExternalVerificationEvidence {
  return {
    x402_version: 2,
    scheme: CTX.scheme,
    network: CTX.network,
    quote_id: CTX.quote_id,
    requirement_id: CTX.requirement_id,
    payment_identifier: CTX.payment_identifier,
    verified: true,
    verifier_identity: 'cdp:facilitator-test-double',
    evidence_timestamp: CTX.nowIso,
    raw_evidence_hash: 'sha256:' + '2'.repeat(64),
    trust_class: 'external_verified',
    ...overrides,
  };
}

function externalSettlement(
  verificationEvidenceHash: string,
  overrides: Partial<ExternalSettlementEvidence> = {}
): ExternalSettlementEvidence {
  return {
    x402_version: 2,
    scheme: CTX.scheme,
    network: CTX.network,
    asset: CTX.asset,
    payee: CTX.payee,
    actual_amount: CTX.amount,
    quote_id: CTX.quote_id,
    requirement_id: CTX.requirement_id,
    payment_identifier: CTX.payment_identifier,
    success: true,
    settled_at: CTX.nowIso,
    facilitator_identity: 'cdp:facilitator-test-double',
    raw_evidence_hash: 'sha256:' + '3'.repeat(64),
    verification_evidence_hash: verificationEvidenceHash,
    trust_class: 'external_verified',
    ...overrides,
  };
}

describe('resolvePaymentEvidenceProvider', () => {
  it('fixture mode returns the fixture provider by default', () => {
    const provider = resolvePaymentEvidenceProvider('fixture');
    expect(provider).toBeInstanceOf(FixturePaymentEvidenceProvider);
    expect(provider.providerKind).toBe('fixture');
  });

  it('production mode throws when no provider is supplied', () => {
    expect(() => resolvePaymentEvidenceProvider('production')).toThrow(
      ProductionEvidenceProviderNotConfiguredError
    );
  });

  it('production mode throws when a fixture provider is supplied explicitly (never satisfied by providerKind "fixture")', () => {
    expect(() =>
      resolvePaymentEvidenceProvider('production', new FixturePaymentEvidenceProvider())
    ).toThrow(ProductionEvidenceProviderNotConfiguredError);
  });

  it('production mode accepts a provider declaring providerKind "external"', () => {
    const external = new RecordingExternalProvider();
    const resolved = resolvePaymentEvidenceProvider('production', external);
    expect(resolved).toBe(external);
    expect(resolved.providerKind).toBe('external');
  });
});

describe('provider selection vs. evidence trust (directive §11) — selecting an external provider is not itself proof of payment', () => {
  it('external provider + synthetic_fixture evidence: still rejected by the production trust gate', async () => {
    const provider = new RecordingExternalProvider();
    provider.nextVerification = externalVerification({ trust_class: 'synthetic_fixture' });
    const evidence = await provider.verify(VERIFY_CTX);
    const outcome = canAdvanceToVerified(evidence, CTX, 'production');
    expect(outcome.allowed).toBe(false);
  });

  it('external provider + locally_derived_structure_only evidence: still rejected by the production trust gate', async () => {
    const provider = new RecordingExternalProvider();
    provider.nextVerification = externalVerification({
      trust_class: 'locally_derived_structure_only',
    });
    const evidence = await provider.verify(VERIFY_CTX);
    const outcome = canAdvanceToVerified(evidence, CTX, 'production');
    expect(outcome.allowed).toBe(false);
  });

  it('external provider + external_unverified evidence: still rejected by the production trust gate', async () => {
    const provider = new RecordingExternalProvider();
    provider.nextVerification = externalVerification({ trust_class: 'external_unverified' });
    const evidence = await provider.verify(VERIFY_CTX);
    const outcome = canAdvanceToVerified(evidence, CTX, 'production');
    expect(outcome.allowed).toBe(false);
  });

  it('external provider + valid external_verified evidence: passes the production trust gate', async () => {
    const provider = new RecordingExternalProvider();
    provider.nextVerification = externalVerification();
    const evidence = await provider.verify(VERIFY_CTX);
    const outcome = canAdvanceToVerified(evidence, CTX, 'production');
    expect(outcome.allowed).toBe(true);
  });

  it('external provider settlement: synthetic/unverified trust classes are still rejected by the production settlement gate', async () => {
    const provider = new RecordingExternalProvider();
    provider.nextVerification = externalVerification();
    const verification = await provider.verify(VERIFY_CTX);
    const verificationHash = 'sha256:' + '4'.repeat(64);
    provider.nextSettlement = externalSettlement(verificationHash, {
      trust_class: 'synthetic_fixture',
    });
    const settlement = await provider.settle(SETTLE_CTX, verification, CTX.amount);
    const outcome = canAdvanceToSettled(settlement, CTX, 'production', verificationHash);
    expect(outcome.allowed).toBe(false);
  });

  it('external provider settlement: valid external_verified evidence bound to the accepted verification hash passes', async () => {
    const provider = new RecordingExternalProvider();
    provider.nextVerification = externalVerification();
    const verification = await provider.verify(VERIFY_CTX);
    const verificationHash = 'sha256:' + '5'.repeat(64);
    provider.nextSettlement = externalSettlement(verificationHash);
    const settlement = await provider.settle(SETTLE_CTX, verification, CTX.amount);
    const outcome = canAdvanceToSettled(settlement, CTX, 'production', verificationHash);
    expect(outcome.allowed).toBe(true);
  });
});

describe('fixture provider can never satisfy production, even end-to-end (directive §12)', () => {
  it('resolvePaymentEvidenceProvider itself refuses to hand back a fixture provider for production, so no fixture evidence can ever reach the production gate through this seam', () => {
    expect(() =>
      resolvePaymentEvidenceProvider('production', new FixturePaymentEvidenceProvider())
    ).toThrow(ProductionEvidenceProviderNotConfiguredError);
  });
});

describe('object-identity: the exact payload/requirements objects supplied reach the provider (directive §14)', () => {
  it('verify() receives the identical paymentPayload and paymentRequirements object references it was given', async () => {
    const provider = new RecordingExternalProvider();
    provider.nextVerification = externalVerification();
    await provider.verify(VERIFY_CTX);
    expect(provider.verifyCalls).toHaveLength(1);
    expect(provider.verifyCalls[0]!.paymentPayload).toBe(PAYMENT_PAYLOAD);
    expect(provider.verifyCalls[0]!.paymentRequirements).toBe(PAYMENT_REQUIREMENTS);
  });

  it('settle() receives the identical paymentPayload/paymentRequirements and the actual amount', async () => {
    const provider = new RecordingExternalProvider();
    provider.nextVerification = externalVerification();
    const verification = await provider.verify(VERIFY_CTX);
    provider.nextSettlement = externalSettlement('sha256:' + '6'.repeat(64));
    await provider.settle(SETTLE_CTX, verification, '12345');
    expect(provider.settleCalls).toHaveLength(1);
    expect(provider.settleCalls[0]!.context.paymentPayload).toBe(PAYMENT_PAYLOAD);
    expect(provider.settleCalls[0]!.context.paymentRequirements).toBe(PAYMENT_REQUIREMENTS);
    expect(provider.settleCalls[0]!.actualAmount).toBe('12345');
  });

  it('settle() receives the usageResult binding for upto settlements', async () => {
    const provider = new RecordingExternalProvider();
    provider.nextVerification = externalVerification();
    const verification = await provider.verify(VERIFY_CTX);
    provider.nextSettlement = externalSettlement('sha256:' + '7'.repeat(64));
    const usageResult = {
      usage_result_id: 'usg_' + '1'.repeat(24),
      usage_result_hash: 'sha256:' + '8'.repeat(64),
      quote_id: CTX.quote_id,
      requirement_id: CTX.requirement_id,
      payment_identifier: CTX.payment_identifier,
      service_id: CTX.service_id,
      service_version: 'v1' as const,
      request_input_hash: 'sha256:' + '9'.repeat(64),
      service_output_hash: 'sha256:' + 'a'.repeat(64),
      verification_receipt_id: 'rcpt_' + '1'.repeat(24),
      verification_receipt_hash: 'sha256:' + 'c'.repeat(64),
      resource_metrics_hash: 'sha256:' + 'b'.repeat(64),
      actual_amount: '10000',
      authorized_maximum: '20000',
    };
    await provider.settle({ ...SETTLE_CTX, usageResult }, verification, usageResult.actual_amount);
    expect(provider.settleCalls[0]!.context.usageResult).toBe(usageResult);
  });
});
