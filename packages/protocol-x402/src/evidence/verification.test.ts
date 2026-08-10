import { describe, expect, it } from 'vitest';
import { validateVerificationEvidence, canAdvanceToVerified } from './verification';
import {
  syntheticVerificationEvidenceSuccess,
  syntheticVerificationEvidenceRejected,
} from './fixtures';
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

describe('validateVerificationEvidence', () => {
  it('a genuine synthetic success is structurally_valid', async () => {
    const ctx = baseContext();
    const evidence = await syntheticVerificationEvidenceSuccess(ctx);
    expect(validateVerificationEvidence(evidence, ctx)).toBe('structurally_valid');
  });

  it('a genuine synthetic rejection (with a reason) is also structurally_valid', async () => {
    const ctx = baseContext();
    const evidence = await syntheticVerificationEvidenceRejected(ctx);
    expect(validateVerificationEvidence(evidence, ctx)).toBe('structurally_valid');
  });

  it('a rejection with no reason is malformed_evidence', async () => {
    const ctx = baseContext();
    const evidence = await syntheticVerificationEvidenceRejected(
      ctx,
      undefined as unknown as string
    );
    const tampered = { ...evidence, reason: undefined };
    expect(validateVerificationEvidence(tampered, ctx)).toBe('malformed_evidence');
  });

  it('rejects an unsupported protocol version', async () => {
    const ctx = baseContext();
    const evidence = await syntheticVerificationEvidenceSuccess(ctx, { x402_version: 1 });
    expect(validateVerificationEvidence(evidence, ctx)).toBe('unsupported_version');
  });

  it('rejects a wrong quote_id', async () => {
    const ctx = baseContext();
    const evidence = await syntheticVerificationEvidenceSuccess(ctx, {
      quote_id: 'qte_' + '9'.repeat(24),
    });
    expect(validateVerificationEvidence(evidence, ctx)).toBe('quote_mismatch');
  });

  it('rejects a wrong requirement_id', async () => {
    const ctx = baseContext();
    const evidence = await syntheticVerificationEvidenceSuccess(ctx, {
      requirement_id: 'req_' + '9'.repeat(24),
    });
    expect(validateVerificationEvidence(evidence, ctx)).toBe('requirement_mismatch');
  });

  it('rejects a wrong payment_identifier', async () => {
    const ctx = baseContext();
    const evidence = await syntheticVerificationEvidenceSuccess(ctx, {
      payment_identifier: 'pay_' + '9'.repeat(28),
    });
    expect(validateVerificationEvidence(evidence, ctx)).toBe('payment_identifier_mismatch');
  });

  it('rejects a wrong scheme', async () => {
    const ctx = baseContext();
    const evidence = await syntheticVerificationEvidenceSuccess(ctx, { scheme: 'upto' });
    expect(validateVerificationEvidence(evidence, ctx)).toBe('scheme_mismatch');
  });

  it('rejects a wrong network', async () => {
    const ctx = baseContext();
    const evidence = await syntheticVerificationEvidenceSuccess(ctx, { network: 'eip155:1' });
    expect(validateVerificationEvidence(evidence, ctx)).toBe('network_mismatch');
  });

  it('rejects an unsupported network entirely', async () => {
    const ctx = baseContext();
    const evidence = await syntheticVerificationEvidenceSuccess(ctx, {
      network: 'cosmos:cosmoshub-4',
    });
    expect(validateVerificationEvidence(evidence, ctx)).toBe('network_mismatch');
  });

  it('rejects malformed evidence missing required fields', async () => {
    const ctx = baseContext();
    const evidence = await syntheticVerificationEvidenceSuccess(ctx, {
      raw_evidence_hash: '',
    });
    expect(validateVerificationEvidence(evidence, ctx)).toBe('malformed_evidence');
  });
});

describe('canAdvanceToVerified', () => {
  it('allows advancement for structurally valid, successful, fixture-trust-classed evidence in fixture mode', async () => {
    const ctx = baseContext();
    const evidence = await syntheticVerificationEvidenceSuccess(ctx);
    expect(canAdvanceToVerified(evidence, ctx, 'fixture')).toEqual({ allowed: true });
  });

  it('never advances merely because verified: true was set on structurally-invalid evidence', async () => {
    const ctx = baseContext();
    const evidence = await syntheticVerificationEvidenceSuccess(ctx, {
      quote_id: 'qte_' + '9'.repeat(24),
    });
    const outcome = canAdvanceToVerified(evidence, ctx, 'fixture');
    expect(outcome.allowed).toBe(false);
  });

  it('does not advance for a structurally valid rejection', async () => {
    const ctx = baseContext();
    const evidence = await syntheticVerificationEvidenceRejected(ctx);
    const outcome = canAdvanceToVerified(evidence, ctx, 'fixture');
    expect(outcome).toMatchObject({ allowed: false, reason: 'verification_not_successful' });
  });

  it('rejects synthetic_fixture evidence when the mode is production', async () => {
    const ctx = baseContext();
    const evidence = await syntheticVerificationEvidenceSuccess(ctx);
    const outcome = canAdvanceToVerified(evidence, ctx, 'production');
    expect(outcome).toMatchObject({ allowed: false, reason: 'trust_class_not_allowed' });
  });

  it('rejects locally_derived_structure_only evidence when the mode is production', async () => {
    const ctx = baseContext();
    const evidence = await syntheticVerificationEvidenceSuccess(ctx, {
      trust_class: 'locally_derived_structure_only',
    });
    const outcome = canAdvanceToVerified(evidence, ctx, 'production');
    expect(outcome).toMatchObject({ allowed: false, reason: 'trust_class_not_allowed' });
  });

  it('SUN-0700A can never produce an accepted external_verified outcome even if asserted', async () => {
    const ctx = baseContext();
    const evidence = await syntheticVerificationEvidenceSuccess(ctx, {
      trust_class: 'external_verified',
    });
    // fixture mode does not allow external_verified either — SUN-0700A
    // never accepts it under any mode it can reach.
    const outcome = canAdvanceToVerified(evidence, ctx, 'fixture');
    expect(outcome).toMatchObject({ allowed: false, reason: 'trust_class_not_allowed' });
  });
});
