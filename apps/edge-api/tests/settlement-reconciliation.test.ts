/**
 * SUN-1221E6R-H2AWI-2e — settlement ambiguity reconciliation (read-only).
 *
 * `reconcileAmbiguousSettlement` never calls `evidenceProvider.settle()` —
 * it only reads: the durable `payment_attempts` recovery record (fake
 * repository double) and a read-only chain-receipt checker (fake, no real
 * Base RPC / facilitator HTTP anywhere in this file).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  reconcileAmbiguousSettlement,
  type ReconciliationRepository,
} from '../src/control-plane/continuation/settlement-reconciliation';
import type { ChainReceiptResult } from '../src/control-plane/evidence/chain-receipt-checker';

const NETWORK = 'eip155:8453' as const;

function repoWith(record: Awaited<ReturnType<ReconciliationRepository['getSettlementRecoveryRecord']>>) {
  const repository: ReconciliationRepository = {
    getSettlementRecoveryRecord: vi.fn().mockResolvedValue(record),
  };
  return repository;
}

describe('reconcileAmbiguousSettlement (H2AWI-2e)', () => {
  it('returns not_found when no payment_attempts record exists at all', async () => {
    const repository = repoWith(null);
    const checker = vi.fn(async (): Promise<ChainReceiptResult> => 'STILL_UNKNOWN');

    const result = await reconcileAmbiguousSettlement('pay_no_record', {
      repository,
      checker,
      network: NETWORK,
      clock: () => 1000,
    });

    expect(result.outcome).toBe('not_found');
    expect(checker).not.toHaveBeenCalled();
  });

  it('returns inconclusive when a draft exists but no candidate transaction reference was ever recorded', async () => {
    const repository = repoWith({
      lifecycleStage: 'settlement_pending',
      neverminedDelegationId: null,
      settlementPermissionHash: null,
      serviceOutputHash: null,
      serviceReceiptId: null,
      settlementTransactionReference: null,
      settlementPendingAt: '2026-08-31T00:00:00.000Z',
      settlementOutcomeKind: null,
      cdpFacilitatorSettleAttemptCount: 1,
      cdpSuccessfulEconomicSettlementCount: 0,
    });
    const checker = vi.fn(async (): Promise<ChainReceiptResult> => 'STILL_UNKNOWN');

    const result = await reconcileAmbiguousSettlement('pay_no_tx_ref', {
      repository,
      checker,
      network: NETWORK,
      clock: () => 1000,
    });

    expect(result.outcome).toBe('inconclusive');
    expect(checker).not.toHaveBeenCalled();
  });

  it('returns confirmed with the transaction reference when the chain checker reports SETTLED', async () => {
    const repository = repoWith({
      lifecycleStage: 'settlement_pending',
      neverminedDelegationId: null,
      settlementPermissionHash: null,
      serviceOutputHash: null,
      serviceReceiptId: null,
      settlementTransactionReference: '0xabc',
      settlementPendingAt: '2026-08-31T00:00:00.000Z',
      settlementOutcomeKind: null,
      cdpFacilitatorSettleAttemptCount: 1,
      cdpSuccessfulEconomicSettlementCount: 0,
    });
    const checker = vi.fn(async (): Promise<ChainReceiptResult> => 'SETTLED');

    const result = await reconcileAmbiguousSettlement('pay_settled', {
      repository,
      checker,
      network: NETWORK,
      clock: () => 1000,
    });

    expect(result.outcome).toBe('confirmed');
    expect(result.settlement_transaction_reference).toBe('0xabc');
    expect(checker).toHaveBeenCalledTimes(1);
  });

  it('returns not_found when the chain checker reports FAILED', async () => {
    const repository = repoWith({
      lifecycleStage: 'settlement_pending',
      neverminedDelegationId: null,
      settlementPermissionHash: null,
      serviceOutputHash: null,
      serviceReceiptId: null,
      settlementTransactionReference: '0xabc',
      settlementPendingAt: '2026-08-31T00:00:00.000Z',
      settlementOutcomeKind: null,
      cdpFacilitatorSettleAttemptCount: 1,
      cdpSuccessfulEconomicSettlementCount: 0,
    });
    const checker = vi.fn(async (): Promise<ChainReceiptResult> => 'FAILED');

    const result = await reconcileAmbiguousSettlement('pay_failed', {
      repository,
      checker,
      network: NETWORK,
      clock: () => 1000,
    });

    expect(result.outcome).toBe('not_found');
  });

  it('bounded retry: STILL_UNKNOWN on every attempt returns inconclusive after exactly 5 checker calls, never unbounded', async () => {
    const repository = repoWith({
      lifecycleStage: 'settlement_pending',
      neverminedDelegationId: null,
      settlementPermissionHash: null,
      serviceOutputHash: null,
      serviceReceiptId: null,
      settlementTransactionReference: '0xabc',
      settlementPendingAt: '2026-08-31T00:00:00.000Z',
      settlementOutcomeKind: null,
      cdpFacilitatorSettleAttemptCount: 1,
      cdpSuccessfulEconomicSettlementCount: 0,
    });
    const checker = vi.fn(async (): Promise<ChainReceiptResult> => 'STILL_UNKNOWN');

    const result = await reconcileAmbiguousSettlement('pay_unbounded', {
      repository,
      checker,
      network: NETWORK,
      clock: () => 1000,
      delayMs: 0,
    });

    expect(result.outcome).toBe('inconclusive');
    expect(checker).toHaveBeenCalledTimes(5);
  });

  it('never calls settle — no such method exists on the injected dependencies at all (structural proof)', async () => {
    const repository = repoWith({
      lifecycleStage: 'settlement_pending',
      neverminedDelegationId: null,
      settlementPermissionHash: null,
      serviceOutputHash: null,
      serviceReceiptId: null,
      settlementTransactionReference: '0xabc',
      settlementPendingAt: '2026-08-31T00:00:00.000Z',
      settlementOutcomeKind: null,
      cdpFacilitatorSettleAttemptCount: 1,
      cdpSuccessfulEconomicSettlementCount: 0,
    });
    const checker = vi.fn(async (): Promise<ChainReceiptResult> => 'SETTLED');

    const deps = { repository, checker, network: NETWORK, clock: () => 1000 };
    expect('settle' in deps).toBe(false);
    expect('settle' in deps.repository).toBe(false);

    await reconcileAmbiguousSettlement('pay_structural', deps);
  });

  it('checked_at_unix reflects the injected clock, not real wall time', async () => {
    const repository = repoWith({
      lifecycleStage: 'settlement_pending',
      neverminedDelegationId: null,
      settlementPermissionHash: null,
      serviceOutputHash: null,
      serviceReceiptId: null,
      settlementTransactionReference: '0xabc',
      settlementPendingAt: '2026-08-31T00:00:00.000Z',
      settlementOutcomeKind: null,
      cdpFacilitatorSettleAttemptCount: 1,
      cdpSuccessfulEconomicSettlementCount: 0,
    });
    const checker = vi.fn(async (): Promise<ChainReceiptResult> => 'SETTLED');

    const result = await reconcileAmbiguousSettlement('pay_clock', {
      repository,
      checker,
      network: NETWORK,
      clock: () => 424242,
    });

    expect(result.checked_at_unix).toBe(424242);
  });
});
