/**
 * The payment-attempt lifecycle stage graph (directive §5-7, §25). This
 * is deliberately a SUMMARY stage on top of `payment_attempts`
 * (checkpoint 2), not a competing job-state machine — the existing,
 * already-accepted `JobState` machine
 * (`apps/edge-api/src/control-plane/state-machine`, SUN-0200) remains the
 * sole authority over job execution state (`PAYMENT_CHALLENGED` /
 * `PAYMENT_VERIFIED` / `SETTLING` / `DELIVERED` / ...). See
 * docs/decisions/0046 for the full mapping and the reasoning for not
 * inventing a second, parallel state machine.
 *
 * This stage exists so a *payment attempt's own* progress (independent
 * of which job, if any, it is eventually linked to) can be tracked and
 * guarded atomically in D1 — see
 * `apps/edge-api/src/control-plane/repositories/d1/payment-attempts.ts`'s
 * `transitionLifecycleStage`.
 */
export type PaymentLifecycleStage =
  | 'acquired'
  | 'verified'
  | 'verification_failed'
  | 'executed'
  | 'settlement_pending'
  | 'settled_external'
  | 'link_verified'
  | 'settled'
  | 'settlement_failed';

/** The legal transition graph — every edge a `transitionLifecycleStage`
 * call may take. Mirrors the same `Record<State, State[]>` shape already
 * used by the accepted `apps/edge-api/src/control-plane/state-machine`'s
 * `AllowedTransitions`, so the pattern is familiar, not reinvented.
 *
 * `executed` / `settlement_pending` / `settled_external` / `link_verified`
 * are additive (SUN-0900B checkpoint 1B recovery hardening) — a durable
 * checkpoint before and after an external settlement call, so a process
 * crash mid-settlement can be reconciled against external evidence on
 * restart instead of blindly re-settling. `verified -> settled` and
 * `verified -> settlement_failed` remain legal directly, unchanged, for
 * every caller that doesn't opt into the durable-recovery path (the
 * existing accepted CDP/fixture-mode flow keeps working exactly as
 * before). `link_verified -> settled` reuses the existing terminal
 * `settled` value and the existing `markConsumed`/`consumed_at`
 * mechanism unchanged — there is no separate `consumed` stage. */
export const PAYMENT_LIFECYCLE_TRANSITIONS: Record<PaymentLifecycleStage, PaymentLifecycleStage[]> =
  {
    acquired: ['verified', 'verification_failed'],
    verified: ['settled', 'settlement_failed', 'executed'],
    verification_failed: [],
    executed: ['settlement_pending'],
    settlement_pending: ['settled_external', 'settlement_failed'],
    settled_external: ['link_verified'],
    link_verified: ['settled'],
    settled: [],
    // `settlement_failed -> settled_external` (SUN-0900B checkpoint 1B,
    // third real-live-run incident) is a narrow, additive exception to
    // `settlement_failed` otherwise being terminal — it exists only
    // because a real defect (fixed the same commit this edge was added)
    // put a genuinely, externally settled real payment into
    // `settlement_failed` before the fix existed. This is NOT a general
    // "retry a failed payment" capability: nothing in this module lets a
    // caller take this edge merely because it exists. The one caller that
    // ever takes it (`x402-service.ts`'s `attemptNeverminedRecovery`)
    // gates it behind independently-verified, read-only, positive
    // `SETTLED` external evidence for that exact Payment-Identifier's own
    // delegation before ever presenting this transition — see that
    // function's own documentation for the full evidentiary requirement.
    settlement_failed: ['settled_external'],
  };

export function isLegalLifecycleTransition(
  from: PaymentLifecycleStage,
  to: PaymentLifecycleStage
): boolean {
  return PAYMENT_LIFECYCLE_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isTerminalLifecycleStage(stage: PaymentLifecycleStage): boolean {
  return PAYMENT_LIFECYCLE_TRANSITIONS[stage].length === 0;
}
