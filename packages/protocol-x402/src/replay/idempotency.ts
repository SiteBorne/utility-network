/**
 * Deterministic idempotency/replay classification (directive §15, §20-21)
 * on top of the atomic `PaymentAttemptRepository.acquire()` boundary. This
 * layer does NOT claim chain-level nonce or facilitator replay guarantees
 * — it only proves SITEBORNE's own authoritative local record is
 * consistent.
 *
 * Definitions (directive §15):
 * - first_seen: new payment identifier, no prior record.
 * - duplicate_same: same payment identifier + identical immutable binding
 *   (a legitimate retry — directive §21).
 * - duplicate_conflict: same payment identifier + ANY changed immutable
 *   binding field (never treated as a safe retry).
 * - already_consumed: the payment attempt already fulfilled its intended
 *   logical resource/job and cannot fulfill a second, distinct operation.
 * - expired: the existing record's validity window has passed.
 */
import { bindingsAreIdentical, computeBindingDigest } from './binding';
import type { PaymentAttemptBinding } from './binding';
import type { PaymentAttemptRepository, PaymentAttemptRecord } from './repository';

export type IdempotencyOutcome =
  | { status: 'first_seen'; record: PaymentAttemptRecord }
  | { status: 'duplicate_same'; record: PaymentAttemptRecord }
  | { status: 'duplicate_conflict'; existing: PaymentAttemptRecord }
  | { status: 'already_consumed'; existing: PaymentAttemptRecord }
  | { status: 'expired'; existing: PaymentAttemptRecord }
  /** A genuine repository/persistence failure — never interpreted as
   * `first_seen` or a safe duplicate (directive §16). Fails closed. */
  | { status: 'repository_error'; reason: string };

export interface AcquirePaymentAttemptInput {
  binding: PaymentAttemptBinding;
  /** ISO instant this attempt is issued at — becomes the new record's
   * `created_at` on first_seen. Injected, never `new Date()` inside this
   * module (directive §22: injected clock, no sleep). */
  nowIso: string;
  /** How long a newly-acquired record remains valid. */
  ttlMs: number;
}

/** The one function every caller uses to acquire or classify a payment
 * attempt — atomic via `repository.acquire()`, then classified by
 * comparing the existing record's binding digest to the new attempt's. */
export async function acquirePaymentAttempt(
  repository: Pick<PaymentAttemptRepository, 'acquire'>,
  input: AcquirePaymentAttemptInput
): Promise<IdempotencyOutcome> {
  const { binding, nowIso, ttlMs } = input;
  const binding_digest = await computeBindingDigest(binding);
  const expires_at = new Date(new Date(nowIso).getTime() + ttlMs).toISOString();

  const candidate: PaymentAttemptRecord = {
    payment_identifier: binding.payment_identifier,
    binding_digest,
    binding,
    created_at: nowIso,
    expires_at,
    consumed: false,
  };

  const result = await repository.acquire(candidate);
  if (result.status === 'acquired') {
    return { status: 'first_seen', record: result.record };
  }
  if (result.status === 'error') {
    return { status: 'repository_error', reason: result.reason };
  }

  const { existing } = result;

  // Expiry is checked before duplicate/consumed classification — an
  // expired identifier must not be resurrected by a later retry attempt
  // that happens to match its old binding (directive §22).
  if (new Date(nowIso).getTime() >= new Date(existing.expires_at).getTime()) {
    return { status: 'expired', existing };
  }

  if (existing.consumed) {
    return { status: 'already_consumed', existing };
  }

  if (bindingsAreIdentical(existing.binding, binding)) {
    return { status: 'duplicate_same', record: existing };
  }

  return { status: 'duplicate_conflict', existing };
}
