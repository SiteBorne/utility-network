import { describe, expect, it } from 'vitest';
import {
  reconcileNeverminedSettlement,
  type NeverminedSettlementReconciliationClient,
  type NeverminedSettlementTransaction,
} from './settlement-recovery';

const DELEGATION_ID = 'del-1';

function tx(
  overrides: Partial<NeverminedSettlementTransaction> = {}
): NeverminedSettlementTransaction {
  return {
    id: 'tx-1',
    providerTransactionId: '0x' + 'a'.repeat(64),
    amountCents: '1',
    currency: 'USDC',
    status: 'succeeded',
    failureReason: null,
    createdAt: '2026-08-12T08:17:11.444Z',
    ...overrides,
  };
}

function client(
  transactions: NeverminedSettlementTransaction[],
  fail = false
): NeverminedSettlementReconciliationClient {
  return {
    listDelegationTransactions: async () => {
      if (fail) throw new Error('transient');
      return { transactions };
    },
  };
}

describe('reconcileNeverminedSettlement', () => {
  it('SETTLED: exactly one transaction with status "succeeded"', async () => {
    const result = await reconcileNeverminedSettlement(client([tx()]), DELEGATION_ID);
    expect(result.state).toBe('SETTLED');
    if (result.state === 'SETTLED') {
      expect(result.transaction.status).toBe('succeeded');
    }
  });

  it('NOT_SETTLED: zero transactions recorded', async () => {
    const result = await reconcileNeverminedSettlement(client([]), DELEGATION_ID);
    expect(result).toEqual({ state: 'NOT_SETTLED' });
  });

  it('NOT_SETTLED: exactly one transaction with an explicit failed status', async () => {
    const result = await reconcileNeverminedSettlement(
      client([tx({ status: 'failed', failureReason: 'insufficient_funds' })]),
      DELEGATION_ID
    );
    expect(result).toEqual({ state: 'NOT_SETTLED' });
  });

  it('AMBIGUOUS: more than one transaction — duplicate/external inconsistency, never silently treated as settled (directive scenario J)', async () => {
    const result = await reconcileNeverminedSettlement(
      client([tx({ id: 'tx-1' }), tx({ id: 'tx-2' })]),
      DELEGATION_ID
    );
    expect(result.state).toBe('AMBIGUOUS');
    if (result.state === 'AMBIGUOUS') {
      expect(result.reason).toContain('duplicate_transaction_count:2');
    }
  });

  it('AMBIGUOUS: unrecognized status string is never guessed either way', async () => {
    const result = await reconcileNeverminedSettlement(
      client([tx({ status: 'pending' })]),
      DELEGATION_ID
    );
    expect(result.state).toBe('AMBIGUOUS');
    if (result.state === 'AMBIGUOUS') {
      expect(result.reason).toContain('unrecognized_status:pending');
    }
  });

  it('AMBIGUOUS: the read-only call itself fails (network/transport loss) — never treated as NOT_SETTLED', async () => {
    const result = await reconcileNeverminedSettlement(client([], true), DELEGATION_ID);
    expect(result.state).toBe('AMBIGUOUS');
  });

  it('status comparison is case-insensitive', async () => {
    const result = await reconcileNeverminedSettlement(
      client([tx({ status: 'Succeeded' })]),
      DELEGATION_ID
    );
    expect(result.state).toBe('SETTLED');
  });
});
