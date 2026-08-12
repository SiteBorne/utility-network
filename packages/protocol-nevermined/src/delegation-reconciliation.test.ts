import { describe, expect, it } from 'vitest';
import {
  reconcileNeverminedDelegation,
  type NeverminedDelegationListClient,
  type NeverminedDelegationPolicy,
  type NeverminedDelegationSummary,
} from './delegation-reconciliation';

const NOW = '2026-08-12T00:00:00.000Z';
const FUTURE = '2026-08-12T01:00:00.000Z';
const PAST = '2026-08-11T00:00:00.000Z';

const POLICY: NeverminedDelegationPolicy = {
  provider: 'erc4337',
  currency: 'usdc',
  activeStatuses: ['active'],
  minRemainingBudgetCents: 1,
  notExpiredAsOfIso: NOW,
};

const NO_SLEEP = { sleep: async () => {}, backoffScheduleMs: [0, 0] };

function exactDelegation(
  overrides: Partial<NeverminedDelegationSummary> = {}
): NeverminedDelegationSummary {
  return {
    delegationId: 'del-1',
    provider: 'erc4337',
    status: 'active',
    currency: 'usdc',
    spendingLimitCents: '1',
    remainingBudgetCents: '1',
    expiresAt: FUTURE,
    ...overrides,
  };
}

function client(delegations: NeverminedDelegationSummary[]): NeverminedDelegationListClient {
  return { listDelegations: async () => ({ delegations }) };
}

describe('reconcileNeverminedDelegation', () => {
  it('no delegations at all -> no_match', async () => {
    const result = await reconcileNeverminedDelegation(client([]), POLICY, NO_SLEEP);
    expect(result).toEqual({ state: 'no_match' });
  });

  it('exactly one matching delegation -> exact_existing, reused', async () => {
    const result = await reconcileNeverminedDelegation(
      client([exactDelegation()]),
      POLICY,
      NO_SLEEP
    );
    expect(result).toEqual({ state: 'exact_existing', delegationId: 'del-1' });
  });

  it('an erc4337 delegation exists but is expired -> conflicting_existing (never silently reused)', async () => {
    const result = await reconcileNeverminedDelegation(
      client([exactDelegation({ expiresAt: PAST })]),
      POLICY,
      NO_SLEEP
    );
    expect(result.state).toBe('conflicting_existing');
  });

  it('an erc4337 delegation exists with insufficient remaining budget -> conflicting_existing', async () => {
    const result = await reconcileNeverminedDelegation(
      client([exactDelegation({ remainingBudgetCents: '0' })]),
      POLICY,
      NO_SLEEP
    );
    expect(result.state).toBe('conflicting_existing');
  });

  it('an erc4337 delegation exists but wrong currency -> conflicting_existing', async () => {
    const result = await reconcileNeverminedDelegation(
      client([exactDelegation({ currency: 'usd' })]),
      POLICY,
      NO_SLEEP
    );
    expect(result.state).toBe('conflicting_existing');
  });

  it('a non-erc4337 delegation is ignored entirely -> no_match', async () => {
    const result = await reconcileNeverminedDelegation(
      client([exactDelegation({ provider: 'stripe' })]),
      POLICY,
      NO_SLEEP
    );
    expect(result).toEqual({ state: 'no_match' });
  });

  it('two exact matches -> multiple_exact, fail closed', async () => {
    const result = await reconcileNeverminedDelegation(
      client([
        exactDelegation({ delegationId: 'del-1' }),
        exactDelegation({ delegationId: 'del-2' }),
      ]),
      POLICY,
      NO_SLEEP
    );
    expect(result.state).toBe('multiple_exact');
    if (result.state === 'multiple_exact') {
      expect(result.delegationIds).toEqual(['del-1', 'del-2']);
    }
  });

  it('a naturally exhausted delegation (real spend, now insufficient budget) is ignored entirely -> no_match, never conflicting_existing (SUN-0900B checkpoint 1B)', async () => {
    const result = await reconcileNeverminedDelegation(
      client([
        exactDelegation({
          status: 'Exhausted',
          remainingBudgetCents: '0',
          amountSpentCents: '1',
        }),
      ]),
      POLICY,
      NO_SLEEP
    );
    expect(result).toEqual({ state: 'no_match' });
  });

  it('an unspent delegation with insufficient budget is NOT excused as exhausted -> conflicting_existing', async () => {
    const result = await reconcileNeverminedDelegation(
      client([exactDelegation({ remainingBudgetCents: '0', amountSpentCents: '0' })]),
      POLICY,
      NO_SLEEP
    );
    expect(result.state).toBe('conflicting_existing');
  });

  it('a spent-but-wrong-currency delegation is not excused by exhaustion -> conflicting_existing', async () => {
    const result = await reconcileNeverminedDelegation(
      client([
        exactDelegation({
          currency: 'usd',
          remainingBudgetCents: '0',
          amountSpentCents: '1',
        }),
      ]),
      POLICY,
      NO_SLEEP
    );
    expect(result.state).toBe('conflicting_existing');
  });

  it('listing always throws -> timeout, zero creation calls possible from this module', async () => {
    const failing: NeverminedDelegationListClient = {
      listDelegations: async () => {
        throw new Error('transient');
      },
    };
    const result = await reconcileNeverminedDelegation(failing, POLICY, NO_SLEEP);
    expect(result).toEqual({ state: 'timeout' });
  });
});
