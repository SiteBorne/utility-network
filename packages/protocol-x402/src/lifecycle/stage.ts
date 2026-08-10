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
  | 'settled'
  | 'settlement_failed';

/** The legal transition graph — every edge a `transitionLifecycleStage`
 * call may take. Mirrors the same `Record<State, State[]>` shape already
 * used by the accepted `apps/edge-api/src/control-plane/state-machine`'s
 * `AllowedTransitions`, so the pattern is familiar, not reinvented. */
export const PAYMENT_LIFECYCLE_TRANSITIONS: Record<PaymentLifecycleStage, PaymentLifecycleStage[]> =
  {
    acquired: ['verified', 'verification_failed'],
    verified: ['settled', 'settlement_failed'],
    verification_failed: [],
    settled: [],
    settlement_failed: [],
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
