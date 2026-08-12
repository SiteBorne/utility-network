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

/**
 * Read-only `GET /delegation/{delegationId}` shape (confirmed live
 * against the sandbox with the seller's own facilitator credential —
 * see SUN-0900B checkpoint 1B route-recovery wiring's prerequisite
 * check). Not exposed by the installed SDK's `DelegationAPI` (which only
 * lists delegations "accessible to the requesting API key" — the buyer's
 * subscriber key, not the seller's), so a caller reaches it via a raw
 * authenticated GET, same as `listDelegationTransactions`.
 */
export interface NeverminedDelegationRecoveryRecord {
  delegationId: string;
  provider: string;
  status: string;
  currency: string;
  /** Observed `null` on real sandbox erc4337 delegations — not every
   * field this type carries is actually populated by the backend.
   * `validateNeverminedDelegationConsistency` only checks fields that are
   * non-null ("where fields are exposed, require consistency" —
   * directive requirement), never rejects on an absent field. */
  planId: string | null;
  providerPaymentMethodId: string | null;
}

export interface NeverminedDelegationLookupClient extends NeverminedSettlementReconciliationClient {
  /** Returns `null` for a delegation id the seller's credential cannot
   * see (not merely "doesn't exist" vs. "not authorized" — both are
   * indistinguishable from a 404, and both must be treated identically:
   * never enough evidence to call anything SETTLED). */
  getDelegation(delegationId: string): Promise<NeverminedDelegationRecoveryRecord | null>;
}

export interface NeverminedDelegationExpectation {
  planId: string;
  /** Expected delegation provider, e.g. `'erc4337'`. */
  provider: string;
  /** Expected settlement currency, e.g. `'usdc'` (case-insensitive). */
  currency: string;
  /** The payer wallet/account observed at verification time, when
   * available — cross-checked against the delegation's
   * `providerPaymentMethodId` (case-insensitive) when both are present. */
  payer?: string;
}

export type NeverminedDelegationConsistency = { valid: true } | { valid: false; reason: string };

/**
 * A real, successful settlement transaction belonging to *some*
 * buyer-supplied delegation is never enough by itself (directive
 * requirement): the delegation must also match the payment context the
 * seller persisted before ever entering `SETTLED_EXTERNAL`. Only checks
 * fields the backend actually populated — `planId`/`providerPaymentMethodId`
 * are frequently `null` on real sandbox data and a `null` value is never
 * treated as a mismatch, only a genuinely conflicting non-null value.
 */
export function validateNeverminedDelegationConsistency(
  delegation: NeverminedDelegationRecoveryRecord,
  expected: NeverminedDelegationExpectation
): NeverminedDelegationConsistency {
  if (delegation.provider !== expected.provider) {
    return { valid: false, reason: 'delegation_provider_mismatch' };
  }
  if (delegation.currency.toLowerCase() !== expected.currency.toLowerCase()) {
    return { valid: false, reason: 'delegation_currency_mismatch' };
  }
  if (delegation.planId !== null && delegation.planId !== expected.planId) {
    return { valid: false, reason: 'delegation_plan_mismatch' };
  }
  if (
    expected.payer &&
    delegation.providerPaymentMethodId &&
    delegation.providerPaymentMethodId.toLowerCase() !== expected.payer.toLowerCase()
  ) {
    return { valid: false, reason: 'delegation_payer_mismatch' };
  }
  return { valid: true };
}

/**
 * The full recovery-path reconciliation: independently validates the
 * buyer-supplied delegation against the persisted payment context
 * *before* ever consulting its transactions, then reuses
 * `reconcileNeverminedSettlement`'s classifier unchanged. A delegation
 * the seller's credential cannot read, or one that is read but doesn't
 * match, is always `AMBIGUOUS` — never `NOT_SETTLED` (which would permit
 * a later retry) and never `SETTLED` (which would mark the payment
 * complete) on the strength of a mismatched or unreadable delegation
 * alone.
 */
export async function reconcileNeverminedSettlementForRecovery(
  client: NeverminedDelegationLookupClient,
  delegationId: string,
  expected: NeverminedDelegationExpectation
): Promise<NeverminedSettlementReconciliation> {
  let delegation: NeverminedDelegationRecoveryRecord | null;
  try {
    delegation = await client.getDelegation(delegationId);
  } catch (e) {
    return {
      state: 'AMBIGUOUS',
      reason: `delegation_read_failed:${e instanceof Error ? e.name : 'unknown'}`,
    };
  }
  if (!delegation) {
    return { state: 'AMBIGUOUS', reason: 'delegation_not_found_or_unreadable' };
  }
  const consistency = validateNeverminedDelegationConsistency(delegation, expected);
  if (!consistency.valid) {
    return { state: 'AMBIGUOUS', reason: `delegation_inconsistent:${consistency.reason}` };
  }
  return reconcileNeverminedSettlement(client, delegationId);
}
