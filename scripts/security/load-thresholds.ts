/**
 * SUN-1000 checkpoint 1N-B2 — fixed, committed v2 load/capacity release
 * ceilings.
 *
 * Loaded directly from `security/load/CAPACITY_BASELINE.json`, a
 * human-reviewed, checked-in evidence artifact -- never recomputed from any
 * candidate run's own measurement. This closes the 1N-B defect
 * (`SELF_NORMALIZING_REGRESSION_THRESHOLD`): the original
 * `max(warmupP95 * 10, 2000ms)` formula derived its own pass/fail ceiling
 * from the same run being evaluated, so a uniformly slower run silently
 * raised its own allowed threshold along with it. A normal
 * `pnpm security:load` run only *reads* this file; changing it is a
 * separate, deliberate, human-reviewed action (see the baseline's own
 * `update_policy` field), never automatic.
 */
import baseline from '../../security/load/CAPACITY_BASELINE.json';

export interface CapacityBaseline {
  baseline_id: string;
  baseline_version: number;
  environment_classification: string;
  frozen_thresholds: {
    margin: number;
    floor_ms: number;
    p95_ceiling_ms: Record<string, number>;
  };
}

export const CAPACITY_BASELINE: CapacityBaseline = baseline as CapacityBaseline;

/** Fixed per-profile p95 ceilings (ms), frozen in `CAPACITY_BASELINE.json`.
 * Every key here must exist in the baseline file or a candidate run using
 * an unrecognized key fails loudly (`undefined < x` is always false in
 * Vitest's `toBeLessThan`, which surfaces as a clear assertion failure
 * rather than a silently-skipped check). */
export const FIXED_P95_CEILING_MS: Record<string, number> =
  CAPACITY_BASELINE.frozen_thresholds.p95_ceiling_ms;
