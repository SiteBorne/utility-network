/**
 * The payment-attempt repository interface — modeled directly on
 * `apps/edge-api/src/control-plane/repositories/d1/idempotency.ts`'s real,
 * already-accepted `D1IdempotencyRepository` (SUN-0200): an atomic
 * `acquire()` backed by a unique constraint on the idempotency key (never
 * a separate SELECT-then-INSERT), plus a lookup by key. This package does
 * not depend on `@cloudflare/workers-types` or wire a real D1 adapter —
 * that stays out of this credential-independent protocol core (see
 * docs/decisions/0043) — but the interface shape is deliberately close
 * enough that a real D1-backed implementation is a thin adapter over the
 * already-existing `idempotency_records` table (which already has a
 * `quote_id` column and a unique index on `idempotency_key`), not a
 * redesign, whenever a later checkpoint wires this into the control
 * plane.
 */
import type { PaymentAttemptBinding } from './binding';

export interface PaymentAttemptRecord {
  payment_identifier: string;
  binding_digest: string;
  binding: PaymentAttemptBinding;
  created_at: string;
  expires_at: string;
  consumed: boolean;
}

export type AcquireOutcome =
  | { status: 'acquired'; record: PaymentAttemptRecord }
  | { status: 'conflict'; existing: PaymentAttemptRecord };

/** Atomic acquire-or-detect-conflict, mirroring
 * `D1IdempotencyRepository.acquire()`'s real semantics: a unique-key
 * insert either succeeds (first_seen) or fails because a record already
 * exists (the caller compares bindings to classify duplicate_same vs
 * duplicate_conflict — see replay/idempotency.ts). */
export interface PaymentAttemptRepository {
  acquire(record: PaymentAttemptRecord): Promise<AcquireOutcome>;
  getByIdentifier(paymentIdentifier: string): Promise<PaymentAttemptRecord | null>;
  markConsumed(paymentIdentifier: string): Promise<void>;
}

/** A pure in-memory reference implementation for credential-independent,
 * no-D1 testing (this package has no Cloudflare Workers/D1 runtime
 * dependency). Uses a single-threaded critical section
 * (`#acquireLock`, a chained Promise) around the check-and-insert so
 * concurrent `acquire()` calls for the same identifier are genuinely
 * atomic under Node's single-threaded event loop with interleaved async
 * work — the same guarantee a real unique-constraint INSERT gives, proven
 * by the concurrency tests in replay/idempotency.test.ts. */
export class InMemoryPaymentAttemptRepository implements PaymentAttemptRepository {
  private readonly records = new Map<string, PaymentAttemptRecord>();
  private acquireLock: Promise<unknown> = Promise.resolve();

  async acquire(record: PaymentAttemptRecord): Promise<AcquireOutcome> {
    // Chain onto the existing lock so overlapping acquire() calls are
    // serialized — each call's check-and-insert runs to completion before
    // the next one's begins, regardless of how their promises interleave.
    const runExclusive = async (): Promise<AcquireOutcome> => {
      const existing = this.records.get(record.payment_identifier);
      if (existing) {
        return { status: 'conflict', existing };
      }
      this.records.set(record.payment_identifier, record);
      return { status: 'acquired', record };
    };
    const result = this.acquireLock.then(runExclusive, runExclusive);
    // Swallow any rejection for lock-chaining purposes only — the actual
    // result (including any thrown error) still propagates to this call's
    // own caller via `result`.
    this.acquireLock = result.catch(() => undefined);
    return result;
  }

  async getByIdentifier(paymentIdentifier: string): Promise<PaymentAttemptRecord | null> {
    return this.records.get(paymentIdentifier) ?? null;
  }

  async markConsumed(paymentIdentifier: string): Promise<void> {
    const existing = this.records.get(paymentIdentifier);
    if (existing) {
      this.records.set(paymentIdentifier, { ...existing, consumed: true });
    }
  }
}
