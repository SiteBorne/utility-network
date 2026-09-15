/**
 * Closed absence sentinels (Master Reference Part II, "Unknown/null/unsupported
 * states"). VCM never uses bare `null`/`undefined`/`""`/`false` to represent an
 * absence, because those collapse distinct truth states into one: "we know
 * this is false", "we have not measured this", "this does not apply here",
 * and "this was never configured" are different facts and must stay
 * distinguishable in both static and runtime-overlay data.
 */

export interface Unknown_ {
  readonly kind: 'UNKNOWN';
}
export const UNKNOWN: Unknown_ = Object.freeze({ kind: 'UNKNOWN' });

export interface Unmeasured {
  readonly kind: 'UNMEASURED';
}
export const UNMEASURED: Unmeasured = Object.freeze({ kind: 'UNMEASURED' });

export interface NotConfigured {
  readonly kind: 'NOT_CONFIGURED';
}
export const NOT_CONFIGURED: NotConfigured = Object.freeze({ kind: 'NOT_CONFIGURED' });

export interface NotApplicable {
  readonly kind: 'NOT_APPLICABLE';
}
export const NOT_APPLICABLE: NotApplicable = Object.freeze({ kind: 'NOT_APPLICABLE' });

export type Maybe<T> = T | Unknown_;
export type MeasuredOrUnmeasured<T> = T | Unmeasured;

export function isUnknown(value: unknown): value is Unknown_ {
  return (
    typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'UNKNOWN'
  );
}

export function isUnmeasured(value: unknown): value is Unmeasured {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'UNMEASURED'
  );
}

export function isNotConfigured(value: unknown): value is NotConfigured {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'NOT_CONFIGURED'
  );
}

export function isNotApplicable(value: unknown): value is NotApplicable {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'NOT_APPLICABLE'
  );
}
