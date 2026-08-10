import { describe, expect, it } from 'vitest';
import { bindingsAreIdentical, computeBindingDigest } from './binding';
import type { PaymentAttemptBinding } from './binding';

function baseBinding(overrides: Partial<PaymentAttemptBinding> = {}): PaymentAttemptBinding {
  return {
    payment_identifier: 'pay_' + '1'.repeat(28),
    quote_id: 'qte_' + '1'.repeat(24),
    requirement_id: 'req_' + '1'.repeat(24),
    service_id: 'company_evidence_graph.v1',
    service_version: 'v1',
    contract_release: '1.0.0',
    request_input_hash: 'sha256:' + '1'.repeat(64),
    resource_id: 'https://api.siteborne.dev/v1/company_evidence_graph',
    scheme: 'exact',
    network: 'eip155:8453',
    asset: '0xUSDC',
    amount: '39000',
    payee: '0xPayee',
    ...overrides,
  };
}

describe('computeBindingDigest', () => {
  it('is deterministic for identical bindings', async () => {
    const a = await computeBindingDigest(baseBinding());
    const b = await computeBindingDigest(baseBinding());
    expect(a).toBe(b);
  });

  it('is insertion/key-order independent', async () => {
    const b = baseBinding();
    const reordered: PaymentAttemptBinding = {
      payee: b.payee,
      amount: b.amount,
      asset: b.asset,
      network: b.network,
      scheme: b.scheme,
      resource_id: b.resource_id,
      request_input_hash: b.request_input_hash,
      contract_release: b.contract_release,
      service_version: b.service_version,
      service_id: b.service_id,
      requirement_id: b.requirement_id,
      quote_id: b.quote_id,
      payment_identifier: b.payment_identifier,
    };
    const a = await computeBindingDigest(b);
    const b2 = await computeBindingDigest(reordered);
    expect(a).toBe(b2);
  });

  it.each([
    ['payment_identifier', 'pay_' + '2'.repeat(28)],
    ['quote_id', 'qte_' + '2'.repeat(24)],
    ['requirement_id', 'req_' + '2'.repeat(24)],
    ['service_id', 'web_context_verified.v1'],
    ['contract_release', '2.0.0'],
    ['request_input_hash', 'sha256:' + '2'.repeat(64)],
    ['resource_id', 'https://api.siteborne.dev/v1/other'],
    ['scheme', 'upto'],
    ['network', 'eip155:1'],
    ['asset', '0xOther'],
    ['amount', '1'],
    ['payee', '0xOtherPayee'],
    ['job_id', 'job_abc'],
    ['idempotency_key', 'idem_abc'],
  ] as const)('mutating bound field %s changes the digest', async (field, value) => {
    const original = await computeBindingDigest(baseBinding());
    const mutated = await computeBindingDigest(
      baseBinding({ [field]: value } as Partial<PaymentAttemptBinding>)
    );
    expect(mutated).not.toBe(original);
  });
});

describe('bindingsAreIdentical', () => {
  it('is true for identical bindings', () => {
    expect(bindingsAreIdentical(baseBinding(), baseBinding())).toBe(true);
  });

  it('is false when any bound field differs', () => {
    expect(bindingsAreIdentical(baseBinding(), baseBinding({ amount: '1' }))).toBe(false);
  });

  it('is true when both omit optional fields identically', () => {
    const a = baseBinding();
    const b = baseBinding();
    expect(bindingsAreIdentical(a, b)).toBe(true);
  });

  it('is false when one supplies an optional field the other omits', () => {
    const a = baseBinding();
    const b = baseBinding({ job_id: 'job_abc' });
    expect(bindingsAreIdentical(a, b)).toBe(false);
  });
});
