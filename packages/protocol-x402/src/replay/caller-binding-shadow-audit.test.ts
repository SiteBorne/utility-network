import { describe, expect, it } from 'vitest';
import { isValidPaymentId } from '../identifier/payment-identifier';
import {
  CDP_PAYMENT_PROVIDER,
  NEVERMINED_PAYMENT_PROVIDER,
  bindingsAreIdentical,
  computeBindingDigest,
  type PaymentAttemptBinding,
} from './binding';
import { acquirePaymentAttempt } from './idempotency';
import { InMemoryPaymentAttemptRepository } from './repository';

const NOW = '2026-09-21T00:00:00.000Z';
const RETRY = '2026-09-21T00:00:01.000Z';
const TTL_MS = 5 * 60 * 1000;

function binding(overrides: Partial<PaymentAttemptBinding> = {}): PaymentAttemptBinding {
  return {
    binding_version: 2,
    payment_rail: 'cdp',
    payment_provider: CDP_PAYMENT_PROVIDER,
    payment_identifier: 'predictable_id_01',
    quote_id: 'qte_' + '1'.repeat(24),
    requirement_id: 'req_' + '1'.repeat(24),
    service_id: 'verify_agent_output.v2',
    service_version: 'v2',
    contract_release: '2.0.0',
    request_input_hash: 'sha256:' + '1'.repeat(64),
    resource_id: 'https://api.siteborne.dev/v2/verify/agent-output',
    scheme: 'exact',
    network: 'eip155:8453',
    asset: '0x0000000000000000000000000000000000000001',
    amount: '10000',
    payee: '0x0000000000000000000000000000000000000002',
    ...overrides,
  };
}

async function acquire(
  repository: InMemoryPaymentAttemptRepository,
  candidate: PaymentAttemptBinding,
  nowIso = NOW
) {
  return acquirePaymentAttempt(repository, { binding: candidate, nowIso, ttlMs: TTL_MS });
}

describe('REPLAY-CALLER-BINDING-SHADOW-AUDIT-01 characterization matrix', () => {
  // The production binding type has no caller/payer/principal field. These
  // tests smuggle such fields through the real digest and classification
  // path to prove they are ignored, not merely absent from the type.
  const callerExtras = (caller: string) =>
    ({
      payer: `0xpayer-of-${caller}`,
      payer_wallet: `0xwallet-of-${caller}`,
      principal: `principal-${caller}`,
      caller,
      client_name: `client-${caller}`,
    }) as unknown as Partial<PaymentAttemptBinding>;

  it('same tuple / same simulated caller is classified as duplicate_same', async () => {
    const repository = new InMemoryPaymentAttemptRepository();
    await acquire(repository, binding(callerExtras('caller-a')));
    const outcome = await acquire(repository, binding(callerExtras('caller-a')), RETRY);
    expect(outcome.status).toBe('duplicate_same');
  });

  it('same tuple / different caller and payer fields is still duplicate_same, with an identical digest', async () => {
    const repository = new InMemoryPaymentAttemptRepository();
    const first = binding(callerExtras('caller-a'));
    const replaying = binding(callerExtras('caller-b'));
    expect(await computeBindingDigest(replaying)).toBe(await computeBindingDigest(first));
    expect(bindingsAreIdentical(first, replaying)).toBe(true);

    await acquire(repository, first);
    const outcome = await acquire(repository, replaying, RETRY);
    expect(outcome.status).toBe('duplicate_same');
  });

  it('the replay digest changes when any one of the 21 bound fields changes (pins REPLAY_BINDING_FIELDS)', async () => {
    // 15 fields common to every binding version, mutated on a valid CDP binding.
    const commonFields = [
      'payment_identifier',
      'quote_id',
      'requirement_id',
      'service_id',
      'service_version',
      'contract_release',
      'request_input_hash',
      'resource_id',
      'scheme',
      'network',
      'asset',
      'amount',
      'payee',
      'job_id',
      'idempotency_key',
    ] as const;
    const base = binding();
    const baseDigest = await computeBindingDigest(base);
    for (const field of commonFields) {
      const mutated = { ...base, [field]: `mutated-${field}` } as PaymentAttemptBinding;
      expect(await computeBindingDigest(mutated), `field ${field} must be digest-bound`).not.toBe(
        baseDigest
      );
    }

    // 6 v2-only fields: binding_version and the rail/provider/nevermined_* set.
    const nevermined = binding({
      payment_rail: 'nevermined',
      payment_provider: NEVERMINED_PAYMENT_PROVIDER,
      nevermined_agent_id: 'agent-1',
      nevermined_plan_id: 'plan-1',
      nevermined_delegation_id: 'delegation-1',
    });
    const neverminedDigest = await computeBindingDigest(nevermined);
    expect(neverminedDigest, 'payment_rail/payment_provider must be digest-bound').not.toBe(
      baseDigest
    );
    for (const field of [
      'nevermined_agent_id',
      'nevermined_plan_id',
      'nevermined_delegation_id',
    ] as const) {
      const mutated = { ...nevermined, [field]: `mutated-${field}` };
      expect(await computeBindingDigest(mutated), `field ${field} must be digest-bound`).not.toBe(
        neverminedDigest
      );
    }
    const legacyV1: PaymentAttemptBinding = { ...base, binding_version: 1 };
    delete legacyV1.payment_rail;
    delete legacyV1.payment_provider;
    expect(await computeBindingDigest(legacyV1), 'binding_version must be digest-bound').not.toBe(
      baseDigest
    );
  });

  it('same payment identifier / different request input hash is duplicate_conflict', async () => {
    const repository = new InMemoryPaymentAttemptRepository();
    await acquire(repository, binding());
    const outcome = await acquire(
      repository,
      binding({ request_input_hash: 'sha256:' + '2'.repeat(64) }),
      RETRY
    );
    expect(outcome.status).toBe('duplicate_conflict');
  });

  it('same payment identifier / different quote is duplicate_conflict', async () => {
    const repository = new InMemoryPaymentAttemptRepository();
    await acquire(repository, binding());
    const outcome = await acquire(
      repository,
      binding({ quote_id: 'qte_' + '2'.repeat(24) }),
      RETRY
    );
    expect(outcome.status).toBe('duplicate_conflict');
  });

  it('same payment identifier / different requirement is duplicate_conflict', async () => {
    const repository = new InMemoryPaymentAttemptRepository();
    await acquire(repository, binding());
    const outcome = await acquire(
      repository,
      binding({ requirement_id: 'req_' + '2'.repeat(24) }),
      RETRY
    );
    expect(outcome.status).toBe('duplicate_conflict');
  });

  it('different payment identifier / same input is a distinct first_seen operation', async () => {
    const repository = new InMemoryPaymentAttemptRepository();
    await acquire(repository, binding());
    const outcome = await acquire(
      repository,
      binding({ payment_identifier: 'predictable_id_02' }),
      RETRY
    );
    expect(outcome.status).toBe('first_seen');
  });

  it('predictable, client-chosen identifiers are accepted when they meet syntax and length rules', async () => {
    const repository = new InMemoryPaymentAttemptRepository();
    const predictable = 'aaaaaaaaaaaaaaaa';
    expect(isValidPaymentId(predictable)).toBe(true);
    const outcome = await acquire(repository, binding({ payment_identifier: predictable }));
    expect(outcome.status).toBe('first_seen');
  });

  it('a duplicate client-chosen identifier with the complete same tuple is accepted as replay', async () => {
    const repository = new InMemoryPaymentAttemptRepository();
    const clientChosen = 'client_chosen_001';
    await acquire(repository, binding({ payment_identifier: clientChosen }));
    const outcome = await acquire(repository, binding({ payment_identifier: clientChosen }), RETRY);
    expect(outcome.status).toBe('duplicate_same');
  });
});
