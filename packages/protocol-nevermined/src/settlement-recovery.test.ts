import { describe, expect, it } from 'vitest';
import {
  reconcileNeverminedSettlement,
  reconcileNeverminedSettlementForRecovery,
  validateNeverminedDelegationConsistency,
  type NeverminedDelegationLookupClient,
  type NeverminedDelegationRecoveryRecord,
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

const EXPECTED = { planId: 'plan-1', provider: 'erc4337', currency: 'usdc', payer: '0xPayer' };

function delegation(
  overrides: Partial<NeverminedDelegationRecoveryRecord> = {}
): NeverminedDelegationRecoveryRecord {
  return {
    delegationId: DELEGATION_ID,
    provider: 'erc4337',
    status: 'Exhausted',
    currency: 'usdc',
    planId: 'plan-1',
    providerPaymentMethodId: '0xPayer',
    ...overrides,
  };
}

describe('validateNeverminedDelegationConsistency', () => {
  it('valid when every populated field matches', () => {
    expect(validateNeverminedDelegationConsistency(delegation(), EXPECTED)).toEqual({
      valid: true,
    });
  });

  it('valid when planId/providerPaymentMethodId are null — real sandbox erc4337 delegations observed with null planId', () => {
    expect(
      validateNeverminedDelegationConsistency(
        delegation({ planId: null, providerPaymentMethodId: null }),
        EXPECTED
      )
    ).toEqual({ valid: true });
  });

  it('rejects a provider mismatch', () => {
    expect(
      validateNeverminedDelegationConsistency(delegation({ provider: 'stripe' }), EXPECTED)
    ).toEqual({ valid: false, reason: 'delegation_provider_mismatch' });
  });

  it('rejects a currency mismatch (case-insensitive comparison, still a real mismatch)', () => {
    expect(
      validateNeverminedDelegationConsistency(delegation({ currency: 'eur' }), EXPECTED)
    ).toEqual({ valid: false, reason: 'delegation_currency_mismatch' });
    expect(
      validateNeverminedDelegationConsistency(delegation({ currency: 'USDC' }), EXPECTED)
    ).toEqual({ valid: true });
  });

  it('rejects a non-null plan mismatch', () => {
    expect(
      validateNeverminedDelegationConsistency(delegation({ planId: 'plan-other' }), EXPECTED)
    ).toEqual({ valid: false, reason: 'delegation_plan_mismatch' });
  });

  it('rejects a non-null payer mismatch (case-insensitive)', () => {
    expect(
      validateNeverminedDelegationConsistency(
        delegation({ providerPaymentMethodId: '0xSomeoneElse' }),
        EXPECTED
      )
    ).toEqual({ valid: false, reason: 'delegation_payer_mismatch' });
  });
});

function lookupClient(
  transactions: NeverminedSettlementTransaction[],
  delegationValue: NeverminedDelegationRecoveryRecord | null,
  failDelegationRead = false
): NeverminedDelegationLookupClient {
  return {
    listDelegationTransactions: async () => ({ transactions }),
    getDelegation: async () => {
      if (failDelegationRead) throw new Error('transient');
      return delegationValue;
    },
  };
}

describe('reconcileNeverminedSettlementForRecovery', () => {
  it('SETTLED only when the delegation is both consistent and has exactly one succeeded transaction', async () => {
    const result = await reconcileNeverminedSettlementForRecovery(
      lookupClient([tx()], delegation()),
      DELEGATION_ID,
      EXPECTED
    );
    expect(result.state).toBe('SETTLED');
  });

  it('AMBIGUOUS — a real succeeded transaction on an inconsistent delegation is never enough by itself', async () => {
    const result = await reconcileNeverminedSettlementForRecovery(
      lookupClient([tx()], delegation({ provider: 'stripe' })),
      DELEGATION_ID,
      EXPECTED
    );
    expect(result.state).toBe('AMBIGUOUS');
    if (result.state === 'AMBIGUOUS') {
      expect(result.reason).toContain('delegation_inconsistent');
    }
  });

  it('AMBIGUOUS when the seller credential cannot read the delegation at all (not found / not authorized)', async () => {
    const result = await reconcileNeverminedSettlementForRecovery(
      lookupClient([tx()], null),
      DELEGATION_ID,
      EXPECTED
    );
    expect(result).toEqual({ state: 'AMBIGUOUS', reason: 'delegation_not_found_or_unreadable' });
  });

  it('AMBIGUOUS when the delegation read itself fails', async () => {
    const result = await reconcileNeverminedSettlementForRecovery(
      lookupClient([tx()], delegation(), true),
      DELEGATION_ID,
      EXPECTED
    );
    expect(result.state).toBe('AMBIGUOUS');
  });
});
