import { describe, expect, it } from 'vitest';
import { buildPaymentServiceLink, extendWithSettlement } from './payment-service-link';
import type { PaymentServiceLinkInput } from './payment-service-link';
import { CDP_PAYMENT_PROVIDER, NEVERMINED_PAYMENT_PROVIDER } from '../replay/binding';

function baseInput(overrides: Partial<PaymentServiceLinkInput> = {}): PaymentServiceLinkInput {
  return {
    payment_identifier: 'pay_' + '1'.repeat(28),
    quote_id: 'qte_' + '1'.repeat(24),
    requirement_id: 'req_' + '1'.repeat(24),
    service_id: 'company_evidence_graph.v1',
    service_version: 'v1',
    request_input_hash: 'sha256:' + '1'.repeat(64),
    job_id: 'job_' + '1'.repeat(24),
    service_output_hash: 'sha256:' + '2'.repeat(64),
    verification_receipt_id: 'rcpt_' + '1'.repeat(24),
    verification_receipt_hash: 'sha256:' + '3'.repeat(64),
    ...overrides,
  };
}

describe('buildPaymentServiceLink', () => {
  it('preserves the accepted legacy v1 link hash byte-for-byte', async () => {
    const legacy = await buildPaymentServiceLink(baseInput());
    const explicitV1 = await buildPaymentServiceLink(baseInput({ link_version: 1 }));
    expect(legacy.link_hash).toBe(
      'sha256:f5a66c7bcaeb536613a540b79633de7d6affc3a1119c50307932d2188c5b72f1'
    );
    expect(explicitV1.link_hash).toBe(legacy.link_hash);
    expect(explicitV1.link_id).toBe(legacy.link_id);
  });

  it('produces a `lnk_` prefixed deterministic ID', async () => {
    const link = await buildPaymentServiceLink(baseInput());
    expect(link.link_id).toMatch(/^lnk_[a-f0-9]{24}$/);
  });

  it('is deterministic for identical input', async () => {
    const a = await buildPaymentServiceLink(baseInput());
    const b = await buildPaymentServiceLink(baseInput());
    expect(a.link_hash).toBe(b.link_hash);
  });

  it('can be built before any settlement evidence exists (no circular dependency)', async () => {
    const link = await buildPaymentServiceLink(baseInput());
    expect(link.settlement_evidence_hash).toBeUndefined();
    expect(link.link_hash).toBeDefined();
  });

  it.each([
    ['payment_identifier', 'pay_' + '9'.repeat(28)],
    ['quote_id', 'qte_' + '9'.repeat(24)],
    ['requirement_id', 'req_' + '9'.repeat(24)],
    ['service_id', 'web_context_verified.v1'],
    ['request_input_hash', 'sha256:' + '9'.repeat(64)],
    ['job_id', 'job_' + '9'.repeat(24)],
    ['service_output_hash', 'sha256:' + '9'.repeat(64)],
    ['verification_receipt_id', 'rcpt_' + '9'.repeat(24)],
    ['verification_receipt_hash', 'sha256:' + '9'.repeat(64)],
  ] as const)('mutating %s changes the link_hash', async (field, value) => {
    const original = await buildPaymentServiceLink(baseInput());
    const mutated = await buildPaymentServiceLink(
      baseInput({ [field]: value } as Partial<PaymentServiceLinkInput>)
    );
    expect(mutated.link_hash).not.toBe(original.link_hash);
  });

  it.each([
    ['nevermined_agent_id', 'agent_changed'],
    ['nevermined_plan_id', 'plan_changed'],
  ] as const)('binds v2 %s into the link hash', async (field, value) => {
    const input: PaymentServiceLinkInput = {
      ...baseInput(),
      link_version: 2,
      payment_rail: 'nevermined',
      payment_provider: NEVERMINED_PAYMENT_PROVIDER,
      nevermined_agent_id: 'agent_company_v1',
      nevermined_plan_id: 'plan_company_payg_v1',
    };
    const original = await buildPaymentServiceLink(input);
    const mutated = await buildPaymentServiceLink({ ...input, [field]: value });
    expect(mutated.link_hash).not.toBe(original.link_hash);
  });

  it('binds the selected rail/provider pair into the v2 link hash', async () => {
    const nevermined = await buildPaymentServiceLink({
      ...baseInput(),
      link_version: 2,
      payment_rail: 'nevermined',
      payment_provider: NEVERMINED_PAYMENT_PROVIDER,
      nevermined_agent_id: 'agent_company_v1',
      nevermined_plan_id: 'plan_company_payg_v1',
    });
    const cdp = await buildPaymentServiceLink({
      ...baseInput(),
      link_version: 2,
      payment_rail: 'cdp',
      payment_provider: CDP_PAYMENT_PROVIDER,
    });
    expect(nevermined.link_hash).not.toBe(cdp.link_hash);
  });

  it('supports a rail-aware CDP v2 link without Nevermined identifiers', async () => {
    const link = await buildPaymentServiceLink({
      ...baseInput(),
      link_version: 2,
      payment_rail: 'cdp',
      payment_provider: CDP_PAYMENT_PROVIDER,
    });
    expect(link.link_version).toBe(2);
    expect(link.payment_rail).toBe('cdp');
  });
});

describe('extendWithSettlement', () => {
  it('produces a new link with a different ID/hash once settlement evidence is added', async () => {
    const original = await buildPaymentServiceLink(baseInput());
    const extended = await extendWithSettlement(original, 'sha256:' + '8'.repeat(64));
    expect(extended.link_id).not.toBe(original.link_id);
    expect(extended.link_hash).not.toBe(original.link_hash);
    expect(extended.settlement_evidence_hash).toBe('sha256:' + '8'.repeat(64));
  });

  it('preserves the immutable service-receipt fields from the original link', async () => {
    const original = await buildPaymentServiceLink(baseInput());
    const extended = await extendWithSettlement(original, 'sha256:' + '8'.repeat(64));
    expect(extended.verification_receipt_id).toBe(original.verification_receipt_id);
    expect(extended.verification_receipt_hash).toBe(original.verification_receipt_hash);
    expect(extended.service_output_hash).toBe(original.service_output_hash);
  });

  it('does not mutate the original link object', async () => {
    const original = await buildPaymentServiceLink(baseInput());
    const originalHash = original.link_hash;
    await extendWithSettlement(original, 'sha256:' + '8'.repeat(64));
    expect(original.link_hash).toBe(originalHash);
    expect(original.settlement_evidence_hash).toBeUndefined();
  });

  it('preserves every v2 rail field when settlement evidence is appended', async () => {
    const original = await buildPaymentServiceLink({
      ...baseInput(),
      link_version: 2,
      payment_rail: 'nevermined',
      payment_provider: NEVERMINED_PAYMENT_PROVIDER,
      nevermined_agent_id: 'agent_company_v1',
      nevermined_plan_id: 'plan_company_payg_v1',
    });
    const extended = await extendWithSettlement(original, 'sha256:' + '8'.repeat(64));
    expect(extended).toMatchObject({
      link_version: 2,
      payment_rail: 'nevermined',
      payment_provider: NEVERMINED_PAYMENT_PROVIDER,
      nevermined_agent_id: 'agent_company_v1',
      nevermined_plan_id: 'plan_company_payg_v1',
    });
  });
});
