import { describe, expect, it } from 'vitest';
import { InMemoryPaymentAttemptRepository } from './repository';
import type { PaymentAttemptRecord } from './repository';

function record(overrides: Partial<PaymentAttemptRecord> = {}): PaymentAttemptRecord {
  return {
    payment_identifier: 'pay_' + '1'.repeat(28),
    binding_digest: 'sha256:' + '1'.repeat(64),
    binding: {
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
    },
    created_at: '2026-08-09T00:00:00.000Z',
    expires_at: '2026-08-09T00:05:00.000Z',
    consumed: false,
    ...overrides,
  };
}

describe('InMemoryPaymentAttemptRepository', () => {
  it('acquire() succeeds for a new identifier', async () => {
    const repo = new InMemoryPaymentAttemptRepository();
    const result = await repo.acquire(record());
    expect(result.status).toBe('acquired');
  });

  it('a second acquire() for the same identifier reports conflict with the existing record', async () => {
    const repo = new InMemoryPaymentAttemptRepository();
    await repo.acquire(record());
    const result = await repo.acquire(record({ binding_digest: 'sha256:' + '2'.repeat(64) }));
    expect(result.status).toBe('conflict');
    if (result.status === 'conflict') {
      expect(result.existing.binding_digest).toBe('sha256:' + '1'.repeat(64));
    }
  });

  it('getByIdentifier returns null for an unknown identifier', async () => {
    const repo = new InMemoryPaymentAttemptRepository();
    expect(await repo.getByIdentifier('unknown')).toBeNull();
  });

  it('markConsumed flips the consumed flag without altering other fields', async () => {
    const repo = new InMemoryPaymentAttemptRepository();
    await repo.acquire(record());
    await repo.markConsumed(record().payment_identifier);
    const stored = await repo.getByIdentifier(record().payment_identifier);
    expect(stored?.consumed).toBe(true);
    expect(stored?.binding_digest).toBe(record().binding_digest);
  });

  describe('concurrency (directive §19)', () => {
    it('20 concurrent acquisitions of the same new identifier + same binding: exactly 1 acquired, 19 conflict', async () => {
      const repo = new InMemoryPaymentAttemptRepository();
      const attempts = Array.from({ length: 20 }, () => record());
      const results = await Promise.all(attempts.map((r) => repo.acquire(r)));
      const acquired = results.filter((r) => r.status === 'acquired');
      const conflicts = results.filter((r) => r.status === 'conflict');
      expect(acquired).toHaveLength(1);
      expect(conflicts).toHaveLength(19);
    });

    it('concurrent acquisitions with the same identifier but different bindings: at most one legitimate owner, the rest conflict', async () => {
      const repo = new InMemoryPaymentAttemptRepository();
      const attempts = Array.from({ length: 10 }, (_, i) =>
        record({ binding_digest: `sha256:${String(i).padStart(64, '0')}` })
      );
      const results = await Promise.all(attempts.map((r) => repo.acquire(r)));
      const acquired = results.filter((r) => r.status === 'acquired');
      expect(acquired).toHaveLength(1);
      // Every conflicting result must report the SAME existing digest —
      // exactly one binding ever wins ownership of the identifier.
      const conflictDigests = new Set(
        results
          .filter((r): r is Extract<typeof r, { status: 'conflict' }> => r.status === 'conflict')
          .map((r) => r.existing.binding_digest)
      );
      expect(conflictDigests.size).toBe(1);
      expect(
        conflictDigests.has((acquired[0] as { record: PaymentAttemptRecord }).record.binding_digest)
      ).toBe(true);
    });
  });
});
