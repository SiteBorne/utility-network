/**
 * SUN-0900B checkpoint 1B recovery hardening — credential-independent,
 * pure classifier for reconciling an external Nevermined settlement's
 * true state after a process crash or an ambiguous local response,
 * using read-only evidence only. Mirrors `registry-reconciliation.ts`/
 * `delegation-reconciliation.ts`'s design exactly: the injected client
 * has no mutating method at all, so the type itself — not just
 * convention — keeps this module from ever settling anything.
 *
 * Evidence source: `GET /delegation/{delegationId}/transactions` — the
 * strongest available evidence tier (an explicit per-transaction
 * `status`), proven against two real sandbox settlements in SUN-0900B
 * checkpoint 1B. Delegation-level `Exhausted`/`amountSpentCents` alone is
 * deliberately NOT the sole authority here when this stronger evidence
 * is available.
 */

export interface NeverminedSettlementTransaction {
  id: string;
  providerTransactionId: string | null;
  amountCents: string;
  currency: string;
  status: string;
  failureReason: string | null;
  createdAt: string;
}

export interface NeverminedSettlementReconciliationClient {
  listDelegationTransactions(
    delegationId: string
  ): Promise<{ transactions: NeverminedSettlementTransaction[] }>;
}

/** Status values (case-insensitive) counted as positive settlement
 * evidence. Kept narrow and explicit rather than "anything that isn't a
 * known failure string", so an unrecognized future status value fails
 * closed as AMBIGUOUS instead of being silently accepted. */
const SUCCEEDED_STATUSES = new Set(['succeeded']);
const FAILED_STATUSES = new Set(['failed', 'declined', 'rejected']);

export type NeverminedSettlementReconciliation =
  | { state: 'SETTLED'; transaction: NeverminedSettlementTransaction }
  | { state: 'NOT_SETTLED' }
  | { state: 'AMBIGUOUS'; reason: string };

/**
 * Bounded to a single read-only call. Never retries internally (the
 * caller decides retry/backoff policy) and never mutates. Fails closed
 * as `AMBIGUOUS` whenever the evidence doesn't cleanly resolve one way
 * or the other — in particular, more than one recorded transaction for
 * what should be a single-use delegation is always `AMBIGUOUS`
 * (duplicate/external-inconsistency), never silently treated as
 * "settled, ignore the extras".
 */
export async function reconcileNeverminedSettlement(
  client: NeverminedSettlementReconciliationClient,
  delegationId: string
): Promise<NeverminedSettlementReconciliation> {
  let listing: { transactions: NeverminedSettlementTransaction[] };
  try {
    listing = await client.listDelegationTransactions(delegationId);
  } catch (e) {
    return {
      state: 'AMBIGUOUS',
      reason: `reconciliation_read_failed:${e instanceof Error ? e.name : 'unknown'}`,
    };
  }

  const transactions = listing.transactions;
  if (transactions.length === 0) return { state: 'NOT_SETTLED' };

  if (transactions.length > 1) {
    // Directive scenario J: more than one transaction for a single
    // expected authorization is a hard fail-closed condition, even if
    // every one of them individually looks like a success.
    return {
      state: 'AMBIGUOUS',
      reason: `duplicate_transaction_count:${transactions.length}`,
    };
  }

  const [tx] = transactions;
  const status = tx!.status.toLowerCase();
  if (SUCCEEDED_STATUSES.has(status)) {
    return { state: 'SETTLED', transaction: tx! };
  }
  if (FAILED_STATUSES.has(status)) {
    return { state: 'NOT_SETTLED' };
  }
  // An unrecognized status string (e.g. "pending", "processing", or a
  // future value this classifier doesn't yet know) is never guessed
  // either way.
  return { state: 'AMBIGUOUS', reason: `unrecognized_status:${tx!.status}` };
}
