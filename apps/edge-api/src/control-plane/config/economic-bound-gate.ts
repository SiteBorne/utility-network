/**
 * R3-58A: pre-dispatch cost-bound gate (pure, not wired into any runtime).
 *
 * This is a DENY-ONLY precondition: it can add a reason to refuse provider
 * dispatch, but a pass grants nothing — every other authority check still
 * applies. Only an AUTHORITATIVE provider-cost bound can satisfy it; Jev
 * output, internal estimates and max_job_cost_usd never do.
 */
export type BoundSource = 'PROVIDER_QUOTE' | 'PROVIDER_CONTRACT_MAX' | 'JEV_ADVISORY' | 'INTERNAL_ESTIMATE';
export type BoundDecision =
  | { readonly proceed_to_other_checks: true }
  | { readonly proceed_to_other_checks: false; readonly reason: string };

export interface CostBound {
  readonly amount_atomic: string | null;
  readonly currency: string | null;
  readonly source: BoundSource | null;
  readonly expires_at?: string | null;
}
export interface LaunchCap {
  readonly amount_atomic: string;
  readonly currency: string;
}

const AUTHORITATIVE: readonly BoundSource[] = ['PROVIDER_QUOTE', 'PROVIDER_CONTRACT_MAX'];
const ATOMIC = /^(0|[1-9][0-9]*)$/;
const deny = (reason: string): BoundDecision => ({ proceed_to_other_checks: false, reason });

export function evaluateCostBound(
  bound: CostBound | null | undefined,
  cap: LaunchCap | null | undefined,
  now: Date
): BoundDecision {
  if (!cap || !ATOMIC.test(cap.amount_atomic) || !cap.currency) return deny('launch_cap_missing');
  if (!bound || bound.amount_atomic === null || bound.currency === null || bound.source === null) {
    return deny('bound_missing');
  }
  if (!AUTHORITATIVE.includes(bound.source)) return deny('bound_not_authoritative');
  if (!ATOMIC.test(bound.amount_atomic)) return deny('bound_malformed');
  if (bound.currency !== cap.currency) return deny('currency_mismatch');
  if (bound.expires_at != null) {
    const t = Date.parse(bound.expires_at);
    if (Number.isNaN(t) || t <= now.getTime()) return deny('bound_expired');
  }
  if (BigInt(bound.amount_atomic) > BigInt(cap.amount_atomic)) return deny('bound_exceeds_launch_cap');
  return { proceed_to_other_checks: true };
}
