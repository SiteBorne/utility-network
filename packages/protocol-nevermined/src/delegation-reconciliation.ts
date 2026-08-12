/**
 * SUN-0900B checkpoint 1B — credential-independent, pure reconciliation
 * logic for resuming a live harness against an ERC-4337 delegation that
 * may already exist, so a crash/failure between "delegation created" and
 * "delegation read-back confirmed" can never turn into a second (or
 * fifth) delegation on retry. Mirrors registry-reconciliation.ts's
 * design exactly: the injected read client has no create-shaped method
 * at all, so the type itself — not just convention — keeps this module
 * from ever mutating anything.
 */

export interface NeverminedDelegationSummary {
  delegationId: string;
  provider: string;
  status: string;
  currency: string;
  /** Cents, as returned by the SDK's own list/read API (a string there,
   * unlike the number the create call takes). */
  spendingLimitCents: string;
  remainingBudgetCents: string;
  /** Present when the SDK exposes it — used only to distinguish a
   * naturally-exhausted delegation (already did its job) from one that
   * looks wrong for some other reason (see `isBenignlyExhausted`). */
  amountSpentCents?: string;
  expiresAt: string;
}

export interface NeverminedDelegationListClient {
  listDelegations(): Promise<{ delegations: NeverminedDelegationSummary[] }>;
}

export interface NeverminedDelegationPolicy {
  provider: 'erc4337';
  /** Case-insensitive. */
  currency: string;
  /** Case-insensitive status values counted as usable (e.g. `['active']`). */
  activeStatuses: readonly string[];
  minRemainingBudgetCents: number;
  /** `expiresAt` must be strictly after this ISO instant. */
  notExpiredAsOfIso: string;
}

export interface ReconcileNeverminedDelegationOptions {
  backoffScheduleMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
}

export type NeverminedDelegationReconciliation =
  | { state: 'exact_existing'; delegationId: string }
  | { state: 'no_match' }
  | { state: 'conflicting_existing'; delegationIds: string[] }
  | { state: 'multiple_exact'; delegationIds: string[] }
  | { state: 'timeout' };

export const DEFAULT_NEVERMINED_DELEGATION_BACKOFF_MS = [0, 2_000, 5_000] as const;

async function defaultSleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isExact(d: NeverminedDelegationSummary, policy: NeverminedDelegationPolicy): boolean {
  if (d.provider !== policy.provider) return false;
  if (d.currency.toLowerCase() !== policy.currency.toLowerCase()) return false;
  if (!policy.activeStatuses.some((s) => s.toLowerCase() === d.status.toLowerCase())) return false;
  if (Number(d.remainingBudgetCents) < policy.minRemainingBudgetCents) return false;
  if (!(new Date(d.expiresAt).getTime() > new Date(policy.notExpiredAsOfIso).getTime())) {
    return false;
  }
  return true;
}

/**
 * A delegation that genuinely did its job and ran out of budget is a
 * benign, expected end-of-life state — not a conflict requiring human
 * review. Distinguished from every other "doesn't qualify" reason by
 * requiring BOTH a real recorded spend (`amountSpentCents > 0`, so an
 * unspent delegation with a suspiciously low limit is never excused this
 * way) AND an otherwise-correct provider/currency (so a wrong-currency
 * delegation, spent or not, still surfaces as a real conflict). Ignored
 * entirely for classification purposes — as if it didn't exist — rather
 * than counted as a false 'exact' match or a blocking 'conflicting' one.
 */
function isBenignlyExhausted(
  d: NeverminedDelegationSummary,
  policy: NeverminedDelegationPolicy
): boolean {
  return (
    d.provider === policy.provider &&
    d.currency.toLowerCase() === policy.currency.toLowerCase() &&
    Number(d.amountSpentCents ?? '0') > 0 &&
    Number(d.remainingBudgetCents) < policy.minRemainingBudgetCents
  );
}

/**
 * Bounded, read-only. Classifies existing delegations against `policy`
 * without ever calling a creation endpoint. `state: 'no_match'` is the
 * only classification under which a caller may create a delegation —
 * every other state (`conflicting_existing`, `multiple_exact`,
 * `timeout`) is a stop condition for the caller to handle explicitly.
 */
export async function reconcileNeverminedDelegation(
  client: NeverminedDelegationListClient,
  policy: NeverminedDelegationPolicy,
  options: ReconcileNeverminedDelegationOptions = {}
): Promise<NeverminedDelegationReconciliation> {
  const schedule = options.backoffScheduleMs ?? DEFAULT_NEVERMINED_DELEGATION_BACKOFF_MS;
  const sleep = options.sleep ?? defaultSleep;

  for (let attempt = 0; attempt < schedule.length; attempt++) {
    await sleep(schedule[attempt]!);
    let listing: { delegations: NeverminedDelegationSummary[] };
    try {
      listing = await client.listDelegations();
    } catch {
      continue; // transient listing failure — retry within budget
    }

    const candidates = listing.delegations.filter(
      (d) => d.provider === policy.provider && !isBenignlyExhausted(d, policy)
    );
    if (candidates.length === 0) {
      if (attempt === schedule.length - 1) return { state: 'no_match' };
      continue; // keep polling before declaring positive absence
    }

    const exact = candidates.filter((d) => isExact(d, policy));
    if (exact.length === 1) {
      return { state: 'exact_existing', delegationId: exact[0]!.delegationId };
    }
    if (exact.length > 1) {
      return { state: 'multiple_exact', delegationIds: exact.map((d) => d.delegationId) };
    }
    // erc4337 candidates exist but none qualify — conflicting, not absent.
    return { state: 'conflicting_existing', delegationIds: candidates.map((d) => d.delegationId) };
  }

  return { state: 'timeout' };
}
