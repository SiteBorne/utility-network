import { describe, expect, it } from 'vitest';
import { validateSettlementEvidenceStructureAndBinding, canAdvanceToSettled } from './settlement';
import { syntheticSettlementEvidenceSuccess, syntheticSettlementEvidenceFailed } from './fixtures';
import type { PaymentEvidenceContext } from './types';

function baseContext(overrides: Partial<PaymentEvidenceContext> = {}): PaymentEvidenceContext {
  return {
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
    nowIso: '2026-08-09T00:00:00.000Z',
    expiresAt: '2026-08-09T00:05:00.000Z',
    ...overrides,
  };
}

const VERIFICATION_HASH = 'sha256:' + '7'.repeat(64);

describe('validateSettlementEvidenceStructureAndBinding — exact', () => {
  it('is structurally_valid when actual_amount equals the exact requirement amount', async () => {
    const ctx = baseContext();
    const evidence = await syntheticSettlementEvidenceSuccess(ctx, VERIFICATION_HASH, ctx.amount);
    expect(validateSettlementEvidenceStructureAndBinding(evidence, ctx)).toBe('structurally_valid');
  });

  it('rejects an underpayment', async () => {
    const ctx = baseContext();
    const evidence = await syntheticSettlementEvidenceSuccess(ctx, VERIFICATION_HASH, '1');
    expect(validateSettlementEvidenceStructureAndBinding(evidence, ctx)).toBe('amount_mismatch');
  });

  it('rejects an overpayment', async () => {
    const ctx = baseContext();
    const evidence = await syntheticSettlementEvidenceSuccess(ctx, VERIFICATION_HASH, '999999');
    expect(validateSettlementEvidenceStructureAndBinding(evidence, ctx)).toBe('amount_mismatch');
  });
});

describe('validateSettlementEvidenceStructureAndBinding — upto', () => {
  function uptoContext(overrides: Partial<PaymentEvidenceContext> = {}) {
    return baseContext({ scheme: 'upto', amount: '190000', ...overrides });
  }

  it('actual < maximum is structurally_valid', async () => {
    const ctx = uptoContext();
    const evidence = await syntheticSettlementEvidenceSuccess(ctx, VERIFICATION_HASH, '100000');
    expect(validateSettlementEvidenceStructureAndBinding(evidence, ctx)).toBe('structurally_valid');
  });

  it('actual == maximum is structurally_valid', async () => {
    const ctx = uptoContext();
    const evidence = await syntheticSettlementEvidenceSuccess(ctx, VERIFICATION_HASH, ctx.amount);
    expect(validateSettlementEvidenceStructureAndBinding(evidence, ctx)).toBe('structurally_valid');
  });

  it('actual > maximum is amount_exceeds_maximum', async () => {
    const ctx = uptoContext();
    const evidence = await syntheticSettlementEvidenceSuccess(ctx, VERIFICATION_HASH, '999999999');
    expect(validateSettlementEvidenceStructureAndBinding(evidence, ctx)).toBe(
      'amount_exceeds_maximum'
    );
  });

  it('a declared authorized_maximum above the quoted maximum is rejected', async () => {
    const ctx = uptoContext();
    const evidence = await syntheticSettlementEvidenceSuccess(ctx, VERIFICATION_HASH, '100000', {
      authorized_maximum: '999999999',
    });
    expect(validateSettlementEvidenceStructureAndBinding(evidence, ctx)).toBe('amount_mismatch');
  });
});

describe('validateSettlementEvidenceStructureAndBinding — binding mismatches', () => {
  it('rejects a wrong quote_id', async () => {
    const ctx = baseContext();
    const evidence = await syntheticSettlementEvidenceSuccess(ctx, VERIFICATION_HASH, ctx.amount, {
      quote_id: 'qte_' + '9'.repeat(24),
    });
    expect(validateSettlementEvidenceStructureAndBinding(evidence, ctx)).toBe('quote_mismatch');
  });

  it('rejects a wrong requirement_id', async () => {
    const ctx = baseContext();
    const evidence = await syntheticSettlementEvidenceSuccess(ctx, VERIFICATION_HASH, ctx.amount, {
      requirement_id: 'req_' + '9'.repeat(24),
    });
    expect(validateSettlementEvidenceStructureAndBinding(evidence, ctx)).toBe(
      'requirement_mismatch'
    );
  });

  it('rejects a wrong payment_identifier', async () => {
    const ctx = baseContext();
    const evidence = await syntheticSettlementEvidenceSuccess(ctx, VERIFICATION_HASH, ctx.amount, {
      payment_identifier: 'pay_' + '9'.repeat(28),
    });
    expect(validateSettlementEvidenceStructureAndBinding(evidence, ctx)).toBe(
      'payment_identifier_mismatch'
    );
  });

  it('rejects a wrong asset', async () => {
    const ctx = baseContext();
    const evidence = await syntheticSettlementEvidenceSuccess(ctx, VERIFICATION_HASH, ctx.amount, {
      asset: '0xWrong',
    });
    expect(validateSettlementEvidenceStructureAndBinding(evidence, ctx)).toBe('asset_mismatch');
  });

  it('rejects a wrong payee', async () => {
    const ctx = baseContext();
    const evidence = await syntheticSettlementEvidenceSuccess(ctx, VERIFICATION_HASH, ctx.amount, {
      payee: '0xWrongPayee',
    });
    expect(validateSettlementEvidenceStructureAndBinding(evidence, ctx)).toBe('payee_mismatch');
  });

  it('rejects a wrong network', async () => {
    const ctx = baseContext();
    const evidence = await syntheticSettlementEvidenceSuccess(ctx, VERIFICATION_HASH, ctx.amount, {
      network: 'eip155:1',
    });
    expect(validateSettlementEvidenceStructureAndBinding(evidence, ctx)).toBe('network_mismatch');
  });

  it('rejects a wrong scheme', async () => {
    const ctx = baseContext();
    const evidence = await syntheticSettlementEvidenceSuccess(ctx, VERIFICATION_HASH, ctx.amount, {
      scheme: 'upto',
    });
    expect(validateSettlementEvidenceStructureAndBinding(evidence, ctx)).toBe('scheme_mismatch');
  });

  it('rejects an unsupported protocol version', async () => {
    const ctx = baseContext();
    const evidence = await syntheticSettlementEvidenceSuccess(ctx, VERIFICATION_HASH, ctx.amount, {
      x402_version: 1,
    });
    expect(validateSettlementEvidenceStructureAndBinding(evidence, ctx)).toBe(
      'unsupported_version'
    );
  });

  it('a genuine failure with a reason is structurally_valid (a well-formed failure)', async () => {
    const ctx = baseContext();
    const evidence = await syntheticSettlementEvidenceFailed(ctx, VERIFICATION_HASH);
    expect(validateSettlementEvidenceStructureAndBinding(evidence, ctx)).toBe('structurally_valid');
  });

  it('a failure with no reason is malformed_evidence', async () => {
    const ctx = baseContext();
    const evidence = await syntheticSettlementEvidenceFailed(
      ctx,
      VERIFICATION_HASH,
      undefined as unknown as string
    );
    const tampered = { ...evidence, reason: undefined };
    expect(validateSettlementEvidenceStructureAndBinding(tampered, ctx)).toBe('malformed_evidence');
  });
});

describe('canAdvanceToSettled', () => {
  it('allows advancement for a valid, successful, fixture-trust-classed settlement in fixture mode, bound to an accepted verification', async () => {
    const ctx = baseContext();
    const evidence = await syntheticSettlementEvidenceSuccess(ctx, VERIFICATION_HASH, ctx.amount);
    expect(canAdvanceToSettled(evidence, ctx, 'fixture', VERIFICATION_HASH)).toEqual({
      allowed: true,
    });
  });

  it('does not advance for a well-formed settlement failure', async () => {
    const ctx = baseContext();
    const evidence = await syntheticSettlementEvidenceFailed(ctx, VERIFICATION_HASH);
    const outcome = canAdvanceToSettled(evidence, ctx, 'fixture', VERIFICATION_HASH);
    expect(outcome).toMatchObject({ allowed: false, reason: 'settlement_not_successful' });
  });

  it('rejects synthetic evidence in production mode', async () => {
    const ctx = baseContext();
    const evidence = await syntheticSettlementEvidenceSuccess(ctx, VERIFICATION_HASH, ctx.amount);
    const outcome = canAdvanceToSettled(evidence, ctx, 'production', VERIFICATION_HASH);
    expect(outcome).toMatchObject({ allowed: false, reason: 'trust_class_not_allowed' });
  });

  it('never advances merely because success: true was set on structurally-invalid evidence', async () => {
    const ctx = baseContext();
    const evidence = await syntheticSettlementEvidenceSuccess(ctx, VERIFICATION_HASH, '1'); // wrong amount
    const outcome = canAdvanceToSettled(evidence, ctx, 'fixture', VERIFICATION_HASH);
    expect(outcome.allowed).toBe(false);
  });

  it('never advances settlement without a matching accepted verification (settlement before verification)', async () => {
    const ctx = baseContext();
    const evidence = await syntheticSettlementEvidenceSuccess(ctx, VERIFICATION_HASH, ctx.amount);
    const outcome = canAdvanceToSettled(evidence, ctx, 'fixture', undefined);
    expect(outcome).toMatchObject({ allowed: false, reason: 'verification_not_accepted' });
  });

  it('never advances settlement bound to a DIFFERENT verification than the one actually accepted', async () => {
    const ctx = baseContext();
    const evidence = await syntheticSettlementEvidenceSuccess(ctx, VERIFICATION_HASH, ctx.amount);
    const outcome = canAdvanceToSettled(evidence, ctx, 'fixture', 'sha256:' + '0'.repeat(64));
    expect(outcome).toMatchObject({ allowed: false, reason: 'verification_not_accepted' });
  });
});
