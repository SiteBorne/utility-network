import { describe, expect, it } from 'vitest';
import {
  FixturePaymentEvidenceProvider,
  ProductionEvidenceProviderNotConfiguredError,
  resolvePaymentEvidenceProvider,
} from './provider';
import type { PaymentEvidenceContext } from './types';

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

describe('FixturePaymentEvidenceProvider', () => {
  it('verify() always produces synthetic_fixture trust class', async () => {
    const provider = new FixturePaymentEvidenceProvider();
    const evidence = await provider.verify(CTX);
    expect(evidence.trust_class).toBe('synthetic_fixture');
    expect(evidence.verified).toBe(true);
  });

  it('settle() always produces synthetic_fixture trust class, bound to the verification evidence hash', async () => {
    const provider = new FixturePaymentEvidenceProvider();
    const verification = await provider.verify(CTX);
    const settlement = await provider.settle(CTX, verification, CTX.amount);
    expect(settlement.trust_class).toBe('synthetic_fixture');
    expect(settlement.success).toBe(true);
    expect(settlement.actual_amount).toBe(CTX.amount);
  });
});

describe('resolvePaymentEvidenceProvider', () => {
  it('fixture mode returns the fixture provider', () => {
    const provider = resolvePaymentEvidenceProvider('fixture');
    expect(provider).toBeInstanceOf(FixturePaymentEvidenceProvider);
  });

  it('production mode always throws — no production provider exists', () => {
    expect(() => resolvePaymentEvidenceProvider('production')).toThrow(
      ProductionEvidenceProviderNotConfiguredError
    );
  });

  it('production mode throws even if a caller supplies a fixture provider explicitly', () => {
    expect(() =>
      resolvePaymentEvidenceProvider('production', new FixturePaymentEvidenceProvider())
    ).toThrow(ProductionEvidenceProviderNotConfiguredError);
  });
});
