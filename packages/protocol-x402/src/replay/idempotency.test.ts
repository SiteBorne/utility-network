import { describe, expect, it } from 'vitest';
import { InMemoryPaymentAttemptRepository } from './repository';
import { acquirePaymentAttempt } from './idempotency';
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

const NOW = '2026-08-09T00:00:00.000Z';
const TTL_MS = 5 * 60 * 1000;

describe('acquirePaymentAttempt — classification', () => {
  it('first_seen for a brand-new payment identifier', async () => {
    const repo = new InMemoryPaymentAttemptRepository();
    const outcome = await acquirePaymentAttempt(repo, {
      binding: baseBinding(),
      nowIso: NOW,
      ttlMs: TTL_MS,
    });
    expect(outcome.status).toBe('first_seen');
  });

  it('duplicate_same for a legitimate retry (identical binding)', async () => {
    const repo = new InMemoryPaymentAttemptRepository();
    await acquirePaymentAttempt(repo, { binding: baseBinding(), nowIso: NOW, ttlMs: TTL_MS });
    const outcome = await acquirePaymentAttempt(repo, {
      binding: baseBinding(),
      nowIso: '2026-08-09T00:00:10.000Z',
      ttlMs: TTL_MS,
    });
    expect(outcome.status).toBe('duplicate_same');
  });

  it('duplicate_conflict when any immutable field changes', async () => {
    const repo = new InMemoryPaymentAttemptRepository();
    await acquirePaymentAttempt(repo, { binding: baseBinding(), nowIso: NOW, ttlMs: TTL_MS });
    const outcome = await acquirePaymentAttempt(repo, {
      binding: baseBinding({ amount: '1' }),
      nowIso: '2026-08-09T00:00:10.000Z',
      ttlMs: TTL_MS,
    });
    expect(outcome.status).toBe('duplicate_conflict');
  });

  it('already_consumed once the record has been marked consumed', async () => {
    const repo = new InMemoryPaymentAttemptRepository();
    const first = await acquirePaymentAttempt(repo, {
      binding: baseBinding(),
      nowIso: NOW,
      ttlMs: TTL_MS,
    });
    expect(first.status).toBe('first_seen');
    await repo.markConsumed(baseBinding().payment_identifier);
    const outcome = await acquirePaymentAttempt(repo, {
      binding: baseBinding(),
      nowIso: '2026-08-09T00:00:10.000Z',
      ttlMs: TTL_MS,
    });
    expect(outcome.status).toBe('already_consumed');
  });

  it('expired once the TTL has passed, even with an identical binding retry', async () => {
    const repo = new InMemoryPaymentAttemptRepository();
    await acquirePaymentAttempt(repo, { binding: baseBinding(), nowIso: NOW, ttlMs: TTL_MS });
    const outcome = await acquirePaymentAttempt(repo, {
      binding: baseBinding(),
      nowIso: '2026-08-09T00:06:00.000Z', // past the 5-minute TTL
      ttlMs: TTL_MS,
    });
    expect(outcome.status).toBe('expired');
  });

  it('an expired identifier is never resurrected into duplicate_same by a later matching retry', async () => {
    const repo = new InMemoryPaymentAttemptRepository();
    await acquirePaymentAttempt(repo, { binding: baseBinding(), nowIso: NOW, ttlMs: TTL_MS });
    const expiredOutcome = await acquirePaymentAttempt(repo, {
      binding: baseBinding(),
      nowIso: '2026-08-09T00:10:00.000Z',
      ttlMs: TTL_MS,
    });
    expect(expiredOutcome.status).toBe('expired');
    expect(expiredOutcome.status).not.toBe('duplicate_same');
    expect(expiredOutcome.status).not.toBe('first_seen');
  });
});

describe('acquirePaymentAttempt — exact replay regression (checkpoint 1 exact requirements through this layer)', () => {
  it('first attempt is acquired', async () => {
    const repo = new InMemoryPaymentAttemptRepository();
    const outcome = await acquirePaymentAttempt(repo, {
      binding: baseBinding({ scheme: 'exact' }),
      nowIso: NOW,
      ttlMs: TTL_MS,
    });
    expect(outcome.status).toBe('first_seen');
  });

  it('exact retry with the identical binding is duplicate_same', async () => {
    const repo = new InMemoryPaymentAttemptRepository();
    await acquirePaymentAttempt(repo, {
      binding: baseBinding({ scheme: 'exact' }),
      nowIso: NOW,
      ttlMs: TTL_MS,
    });
    const outcome = await acquirePaymentAttempt(repo, {
      binding: baseBinding({ scheme: 'exact' }),
      nowIso: '2026-08-09T00:00:05.000Z',
      ttlMs: TTL_MS,
    });
    expect(outcome.status).toBe('duplicate_same');
  });

  it.each([
    ['amount', '99'],
    ['service_id', 'web_context_verified.v1'],
    ['request_input_hash', 'sha256:' + '9'.repeat(64)],
    ['resource_id', 'https://api.siteborne.dev/v1/other'],
  ] as const)('changed %s -> duplicate_conflict', async (field, value) => {
    const repo = new InMemoryPaymentAttemptRepository();
    await acquirePaymentAttempt(repo, {
      binding: baseBinding({ scheme: 'exact' }),
      nowIso: NOW,
      ttlMs: TTL_MS,
    });
    const outcome = await acquirePaymentAttempt(repo, {
      binding: baseBinding({ scheme: 'exact', [field]: value } as Partial<PaymentAttemptBinding>),
      nowIso: '2026-08-09T00:00:05.000Z',
      ttlMs: TTL_MS,
    });
    expect(outcome.status).toBe('duplicate_conflict');
  });

  it('an expired exact requirement is rejected, not resurrected', async () => {
    const repo = new InMemoryPaymentAttemptRepository();
    await acquirePaymentAttempt(repo, {
      binding: baseBinding({ scheme: 'exact' }),
      nowIso: NOW,
      ttlMs: TTL_MS,
    });
    const outcome = await acquirePaymentAttempt(repo, {
      binding: baseBinding({ scheme: 'exact' }),
      nowIso: '2026-08-09T01:00:00.000Z',
      ttlMs: TTL_MS,
    });
    expect(outcome.status).toBe('expired');
  });
});

describe('acquirePaymentAttempt — upto replay matrix', () => {
  function uptoBinding(overrides: Partial<PaymentAttemptBinding> = {}): PaymentAttemptBinding {
    return baseBinding({ scheme: 'upto', amount: '190000', ...overrides });
  }

  it('same authorization + same payment ID -> duplicate_same', async () => {
    const repo = new InMemoryPaymentAttemptRepository();
    await acquirePaymentAttempt(repo, { binding: uptoBinding(), nowIso: NOW, ttlMs: TTL_MS });
    const outcome = await acquirePaymentAttempt(repo, {
      binding: uptoBinding(),
      nowIso: '2026-08-09T00:00:05.000Z',
      ttlMs: TTL_MS,
    });
    expect(outcome.status).toBe('duplicate_same');
  });

  it('same payment ID + changed maximum -> duplicate_conflict', async () => {
    const repo = new InMemoryPaymentAttemptRepository();
    await acquirePaymentAttempt(repo, {
      binding: uptoBinding({ amount: '190000' }),
      nowIso: NOW,
      ttlMs: TTL_MS,
    });
    const outcome = await acquirePaymentAttempt(repo, {
      binding: uptoBinding({ amount: '99999' }),
      nowIso: '2026-08-09T00:00:05.000Z',
      ttlMs: TTL_MS,
    });
    expect(outcome.status).toBe('duplicate_conflict');
  });

  // directive §25: actual usage is known only after execution, so it is
  // deliberately NOT part of the pre-execution authorization binding
  // (PaymentAttemptBinding.amount is always the authorized maximum for
  // upto, never an actual charge) — see requirements/upto.ts's module doc
  // and docs/decisions/0044 for the authorization-vs-usage split. There is
  // therefore no "changed actual usage" scenario at this binding layer by
  // construction: usage is a separate, later binding entirely.
});
