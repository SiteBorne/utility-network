import { describe, expect, it } from 'vitest';
import {
  CDP_PAYMENT_PROVIDER,
  NEVERMINED_PAYMENT_PROVIDER,
  bindingsAreIdentical,
  computeBindingDigest,
  validatePaymentAttemptBinding,
} from './binding';
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
  it('preserves the accepted legacy v1 digest byte-for-byte', async () => {
    expect(await computeBindingDigest(baseBinding())).toBe(
      'sha256:fae6c47100b04a2485b192607a05bea1824b788978034ab4b7f903da5ecdbba5'
    );
    expect(await computeBindingDigest(baseBinding({ binding_version: 1 }))).toBe(
      'sha256:fae6c47100b04a2485b192607a05bea1824b788978034ab4b7f903da5ecdbba5'
    );
  });

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

describe('rail-aware v2 binding', () => {
  const railAware = (overrides: Record<string, unknown> = {}): PaymentAttemptBinding => ({
    ...baseBinding(),
    binding_version: 2,
    payment_rail: 'cdp',
    payment_provider: CDP_PAYMENT_PROVIDER,
    ...overrides,
  });

  it('requires rail and provider for every new binding', () => {
    expect(validatePaymentAttemptBinding(railAware())).toEqual({ valid: true, version: 2 });
    expect(
      validatePaymentAttemptBinding({
        ...baseBinding(),
        binding_version: 2,
      } as PaymentAttemptBinding)
    ).toMatchObject({ valid: false });
  });

  it('binds rail and provider into the v2 digest and replay comparison', async () => {
    const cdp = railAware();
    const nevermined = railAware({
      payment_rail: 'nevermined',
      payment_provider: NEVERMINED_PAYMENT_PROVIDER,
      nevermined_agent_id: 'agent_company_v1',
      nevermined_plan_id: 'plan_company_payg_v1',
      nevermined_delegation_id: 'del_' + '1'.repeat(24),
    });
    expect(await computeBindingDigest(cdp)).not.toBe(await computeBindingDigest(nevermined));
    expect(bindingsAreIdentical(cdp, nevermined)).toBe(false);
  });

  it.each([
    ['payment_provider', CDP_PAYMENT_PROVIDER],
    ['nevermined_agent_id', 'agent_changed'],
    ['nevermined_plan_id', 'plan_changed'],
    ['nevermined_delegation_id', 'del_changed'],
  ] as const)('treats changed %s as a replay conflict', (field, value) => {
    const original = railAware({
      payment_rail: 'nevermined',
      payment_provider: NEVERMINED_PAYMENT_PROVIDER,
      nevermined_agent_id: 'agent_company_v1',
      nevermined_plan_id: 'plan_company_payg_v1',
      nevermined_delegation_id: 'del_' + '1'.repeat(24),
    });
    expect(bindingsAreIdentical(original, railAware({ ...original, [field]: value }))).toBe(false);
  });

  it('rejects Nevermined identifiers on a CDP binding', () => {
    expect(
      validatePaymentAttemptBinding(
        railAware({
          nevermined_agent_id: 'agent_company_v1',
          nevermined_plan_id: 'plan',
          nevermined_delegation_id: 'del_' + '1'.repeat(24),
        })
      )
    ).toMatchObject({ valid: false });
  });

  it('requires a delegation id for every new Nevermined binding (SUN-0900B checkpoint 1B route-recovery wiring)', () => {
    expect(
      validatePaymentAttemptBinding(
        railAware({
          payment_rail: 'nevermined',
          payment_provider: NEVERMINED_PAYMENT_PROVIDER,
          nevermined_agent_id: 'agent_company_v1',
          nevermined_plan_id: 'plan_company_payg_v1',
        })
      )
    ).toEqual({ valid: false, reason: 'nevermined_binding_requires_delegation_id' });
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
