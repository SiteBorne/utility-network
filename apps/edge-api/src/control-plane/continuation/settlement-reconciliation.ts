/**
 * SUN-1221E6R-H2AWI-2e — settlement ambiguity reconciliation (read-only).
 *
 * Consumes exactly two existing, real production abstractions, both
 * dependency-injected (never constructed here, never a real network call
 * in this module or its tests):
 *   - `D1PaymentAttemptRepository.getSettlementRecoveryRecord` (the
 *     existing durable pre-settle-draft correlation record,
 *     `apps/edge-api/src/control-plane/repositories/d1/payment-attempts.ts`)
 *   - the `cdpChainReceiptChecker` function shape
 *     (`apps/edge-api/src/control-plane/evidence/chain-receipt-checker.ts`'s
 *     `buildCdpChainReceiptChecker` return type) — a real, already-audited,
 *     read-only on-chain lookup, reused by reference/type here, never
 *     reimplemented.
 *
 * `reconcileAmbiguousSettlement` NEVER calls `evidenceProvider.settle()` —
 * there is no settlement dependency in this module's signature at all
 * (see `settlement-reconciliation.test.ts`'s own structural proof). It
 * only reads. Per design §13 / plan Task 2.5, retries here ARE bounded
 * (5, matching design §13's "5 retries x exponential backoff on a
 * read-only step") but distinct from step 4's own zero-retry settle call:
 * retrying a *read* is always safe; retrying a *settle* is not.
 */
import type { Network } from '@siteborne/protocol-x402';
import type { SettlementReconciliationResult } from './types';
import type { ChainReceiptResult } from '../evidence/chain-receipt-checker';

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_DELAY_MS = 0;

/** The narrow slice of `D1PaymentAttemptRepository` this module needs —
 * structurally satisfied by the real repository without importing its
 * concrete class (keeps this module D1-binding-free and independently
 * testable, per plan Task 2.5). */
export interface ReconciliationRepository {
  getSettlementRecoveryRecord(paymentIdentifier: string): Promise<{
    readonly lifecycleStage: string;
    readonly settlementTransactionReference: string | null;
  } | null>;
}

export interface ReconciliationDependencies {
  readonly repository: ReconciliationRepository;
  readonly checker: (
    transactionReference: string,
    network: Network
  ) => Promise<ChainReceiptResult>;
  readonly network: Network;
  readonly clock: () => number;
  /** Bounded retry count — defaults to 5 (design §13). Never unbounded;
   * a dedicated test asserts the exact default is honored, not just "some
   * bound exists". */
  readonly maxAttempts?: number;
  /** Test-only knob: real callers never need this (a genuine backoff is a
   * platform/step-retry concern, not this pure function's), but forcing
   * it to 0 keeps the bounded-retry test fast and deterministic without
   * fake timers. */
  readonly delayMs?: number;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function reconcileAmbiguousSettlement(
  paymentIdentifier: string,
  deps: ReconciliationDependencies
): Promise<SettlementReconciliationResult> {
  const checkedAt = () => deps.clock();
  const record = await deps.repository.getSettlementRecoveryRecord(paymentIdentifier);

  if (!record) {
    return { outcome: 'not_found', checked_at_unix: checkedAt() };
  }
  if (!record.settlementTransactionReference) {
    // A pre-settle draft exists but no candidate transaction reference was
    // ever recorded (e.g. the settle() call died before any response, not
    // even a rejected-but-referenced one) — genuinely unknown, never
    // guessed at.
    return { outcome: 'inconclusive', checked_at_unix: checkedAt() };
  }

  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const delayMs = deps.delayMs ?? DEFAULT_DELAY_MS;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const outcome = await deps.checker(record.settlementTransactionReference, deps.network);
    if (outcome === 'SETTLED') {
      return {
        outcome: 'confirmed',
        settlement_transaction_reference: record.settlementTransactionReference,
        checked_at_unix: checkedAt(),
      };
    }
    if (outcome === 'FAILED') {
      return { outcome: 'not_found', checked_at_unix: checkedAt() };
    }
    // STILL_UNKNOWN: bounded retry, never unbounded.
    if (attempt < maxAttempts) {
      await sleep(delayMs);
    }
  }

  return { outcome: 'inconclusive', checked_at_unix: checkedAt() };
}
