/**
 * SUN-1222C-R4-D12 — scheduled unresolved-settlement alert sweep.
 *
 * Pure unit tests against `runSettlementAlertSweep` with a fully-faked
 * `UnresolvedSettlementSource` and `SettlementAlertTransport` — no real D1,
 * no real network call, no real Cloudflare Worker (`REAL_WEBHOOK_CALLS=0`,
 * `TEST_DOUBLE_WEBHOOK_CALLS=<n>`, D12 §27/§33). Covers D12 §20's S1–S6/S8
 * scenarios (S7 — "no secret configured" — is a worker-entrypoint-level
 * concern, covered separately in
 * `settlement-alert-worker-entrypoint.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import {
  runSettlementAlertSweep,
  type SettlementAlertPayload,
  type UnresolvedSettlementRecord,
} from '../src/control-plane/alerting/settlement-alert-sweep';

function record(
  overrides: Partial<UnresolvedSettlementRecord> = {}
): UnresolvedSettlementRecord {
  return {
    paymentIdentifier: 'pay_test_0001',
    jobId: 'job_test_0001',
    settlementPendingAt: '2026-01-01T00:00:00.000Z',
    settlementTransactionReference: null,
    settlementOutcomeKind: 'ambiguous',
    cdpFacilitatorSettleAttemptCount: 5,
    ...overrides,
  };
}

describe('SUN-1222C-R4-D12 runSettlementAlertSweep', () => {
  // S1 — unresolved record is delivered.
  it('delivers exactly one webhook request per unresolved record', async () => {
    const rec = record();
    const delivered: SettlementAlertPayload[] = [];
    const result = await runSettlementAlertSweep({
      source: { listUnresolvedSettlements: async () => [rec] },
      transport: async (payload) => {
        delivered.push(payload);
        return { delivered: true };
      },
    });
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({
      event: 'siteborne.settlement.manual_intervention_required',
      payment_identifier: 'pay_test_0001',
      job_id: 'job_test_0001',
      recovery_stage: 'ambiguous',
      reconciliation_attempts: 5,
      transaction_reference_present: false,
    });
    expect(result).toMatchObject({
      consideredCount: 1,
      deliveredCount: 1,
      failedCount: 0,
      failedPaymentIdentifiers: [],
    });
  });

  // S2 — resolved record excluded. `listUnresolvedSettlements` itself is
  // the exclusion boundary (D12 §4 — resolved rows leave
  // `lifecycle_stage = 'settlement_pending'` and are never returned); this
  // proves the sweep sends nothing when the source reports nothing.
  it('sends no notification when no unresolved records exist', async () => {
    let transportCalls = 0;
    const result = await runSettlementAlertSweep({
      source: { listUnresolvedSettlements: async () => [] },
      transport: async () => {
        transportCalls += 1;
        return { delivered: true };
      },
    });
    expect(transportCalls).toBe(0);
    expect(result).toEqual({
      consideredCount: 0,
      deliveredCount: 0,
      failedCount: 0,
      failedPaymentIdentifiers: [],
    });
  });

  // S3 — webhook fails: economic state is never touched by this module (it
  // holds no write handle at all), and the record simply comes back on the
  // next sweep because the sweep itself performs no mutation of any kind.
  it('reports a failed delivery without throwing when the transport rejects', async () => {
    const rec = record({ paymentIdentifier: 'pay_test_fail' });
    const result = await runSettlementAlertSweep({
      source: { listUnresolvedSettlements: async () => [rec] },
      transport: async () => {
        throw new Error('simulated 500 from operator webhook relay');
      },
    });
    expect(result).toEqual({
      consideredCount: 1,
      deliveredCount: 0,
      failedCount: 1,
      failedPaymentIdentifiers: ['pay_test_fail'],
    });
  });

  it('reports a failed delivery when the transport resolves delivered:false (e.g. non-2xx)', async () => {
    const rec = record({ paymentIdentifier: 'pay_test_non2xx' });
    const result = await runSettlementAlertSweep({
      source: { listUnresolvedSettlements: async () => [rec] },
      transport: async () => ({ delivered: false }),
    });
    expect(result.deliveredCount).toBe(0);
    expect(result.failedPaymentIdentifiers).toEqual(['pay_test_non2xx']);
  });

  // S4 — repeated sweep: same still-unresolved record delivered again on a
  // second independent sweep invocation (D12 §13 BOUNDED_REPEAT — no
  // suppression state exists, each sweep is independent).
  it('re-delivers an unresolved record on a subsequent independent sweep', async () => {
    const rec = record({ paymentIdentifier: 'pay_test_repeat' });
    const delivered: SettlementAlertPayload[] = [];
    const source = { listUnresolvedSettlements: async () => [rec] };
    const transport = async (payload: SettlementAlertPayload) => {
      delivered.push(payload);
      return { delivered: true };
    };
    await runSettlementAlertSweep({ source, transport, nowUnixMs: 1_000 });
    await runSettlementAlertSweep({ source, transport, nowUnixMs: 2_000 });
    expect(delivered).toHaveLength(2);
    expect(delivered.every((p) => p.payment_identifier === 'pay_test_repeat')).toBe(true);
    // last_observed_at reflects each sweep's own clock, proving these are
    // two genuinely independent deliveries, not a cached/memoized result.
    expect(delivered[0].last_observed_at).not.toBe(delivered[1].last_observed_at);
  });

  // S5 — multiple records: bounded, correctly-correlated per-notification
  // processing, and isolation (S8) — one throwing transport call does not
  // prevent delivery to the remaining records.
  it('processes multiple records with correct per-record correlation and isolates failures', async () => {
    const records = [
      record({ paymentIdentifier: 'pay_a', jobId: 'job_a' }),
      record({ paymentIdentifier: 'pay_b', jobId: 'job_b' }),
      record({ paymentIdentifier: 'pay_c', jobId: 'job_c' }),
    ];
    const delivered: SettlementAlertPayload[] = [];
    const result = await runSettlementAlertSweep({
      source: { listUnresolvedSettlements: async () => records },
      transport: async (payload) => {
        if (payload.payment_identifier === 'pay_b') {
          throw new Error('simulated destination outage for pay_b only');
        }
        delivered.push(payload);
        return { delivered: true };
      },
    });
    expect(delivered.map((p) => p.payment_identifier)).toEqual(['pay_a', 'pay_c']);
    expect(result).toEqual({
      consideredCount: 3,
      deliveredCount: 2,
      failedCount: 1,
      failedPaymentIdentifiers: ['pay_b'],
    });
  });

  // S6 — payload sanitization: no secret/raw-signature/wallet material, and
  // the transaction reference itself is never transmitted (only a boolean).
  it('never includes a raw transaction reference or any secret-shaped field in the payload', async () => {
    const rec = record({
      settlementTransactionReference: '0xabc123deadbeef',
    });
    const delivered: SettlementAlertPayload[] = [];
    await runSettlementAlertSweep({
      source: { listUnresolvedSettlements: async () => [rec] },
      transport: async (payload) => {
        delivered.push(payload);
        return { delivered: true };
      },
    });
    const serialized = JSON.stringify(delivered[0]);
    expect(serialized).not.toContain('0xabc123deadbeef');
    expect(serialized).not.toMatch(/private[_-]?key/i);
    expect(serialized).not.toMatch(/signature/i);
    expect(delivered[0].transaction_reference_present).toBe(true);
    expect(Object.keys(delivered[0]).sort()).toEqual(
      [
        'event',
        'first_observed_at',
        'job_id',
        'last_observed_at',
        'payment_identifier',
        'reconciliation_attempts',
        'recovery_stage',
        'transaction_reference_present',
      ].sort()
    );
  });

  it('forwards the minimum-age and limit bounds to the source query (D12 §4/§14/§15)', async () => {
    let capturedOptions: unknown;
    await runSettlementAlertSweep({
      source: {
        listUnresolvedSettlements: async (options) => {
          capturedOptions = options;
          return [];
        },
      },
      transport: async () => ({ delivered: true }),
      nowUnixMs: 5_000,
      minimumAgeMs: 42,
      maxRecordsPerSweep: 7,
    });
    expect(capturedOptions).toEqual({ olderThanMs: 42, nowUnixMs: 5_000, limit: 7 });
  });

  it('defaults minimumAgeMs to 3 minutes and maxRecordsPerSweep to 100 when unset', async () => {
    let capturedOptions: unknown;
    await runSettlementAlertSweep({
      source: {
        listUnresolvedSettlements: async (options) => {
          capturedOptions = options;
          return [];
        },
      },
      transport: async () => ({ delivered: true }),
      nowUnixMs: 9_000,
    });
    expect(capturedOptions).toMatchObject({ olderThanMs: 180_000, limit: 100 });
  });

  it('maps recovery_stage to "unknown" when settlementOutcomeKind is null', async () => {
    const rec = record({ settlementOutcomeKind: null });
    const delivered: SettlementAlertPayload[] = [];
    await runSettlementAlertSweep({
      source: { listUnresolvedSettlements: async () => [rec] },
      transport: async (payload) => {
        delivered.push(payload);
        return { delivered: true };
      },
    });
    expect(delivered[0].recovery_stage).toBe('unknown');
  });
});
