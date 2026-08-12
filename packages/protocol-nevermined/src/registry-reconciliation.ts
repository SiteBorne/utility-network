/**
 * SUN-0900B checkpoint 1A — credential-independent, pure reconciliation
 * logic for resuming a live harness against a Nevermined agent/plan that
 * may already exist, without ever registering a second time for a
 * checkpoint that already exists.
 *
 * This module makes no network call and never calls a registration
 * mutation itself — `NeverminedRegistryClient` below deliberately has no
 * `registerAgentAndPlan`-shaped method at all, so the *type* itself
 * enforces that registration decisions stay the caller's responsibility,
 * exercised only after this function reports `state: 'absent'` (positive
 * absence proven across the full backoff schedule, never inferred from
 * one failed read). The live harness in apps/edge-api supplies the real
 * `@nevermined-io/payments`-backed client; tests supply a fake one.
 */

export interface NeverminedRegistryAgentSummary {
  id: string;
  name: string | undefined;
}

export interface NeverminedRegistryPlanSummary {
  id: string;
  name: string | undefined;
}

export interface NeverminedRegistryClient {
  /** Resolves to the agent, or throws/rejects on not-found — either is
   * treated identically (not found) by this module. */
  getAgent(agentId: string): Promise<NeverminedRegistryAgentSummary>;
  getAgents(): Promise<{ agents: NeverminedRegistryAgentSummary[] }>;
  /** IDs of the plans currently linked to `agentId`. */
  getAgentPlans(agentId: string): Promise<{ planIds: string[] }>;
  getPlan(planId: string): Promise<NeverminedRegistryPlanSummary>;
  getPlans(): Promise<{ plans: NeverminedRegistryPlanSummary[] }>;
}

export interface NeverminedRegistrationExpectation {
  agentName: string;
  planName: string;
  /** Known-good IDs from a prior checkpoint run, when available — the
   * cheapest reconciliation path, tried first every attempt. */
  knownAgentId?: string;
  knownPlanId?: string;
}

export interface ReconcileNeverminedRegistrationOptions {
  /** Backoff schedule in ms — the function makes exactly
   * `schedule.length` reconciliation attempts, sleeping `schedule[i]`
   * before attempt `i` (so `schedule[0]` is typically `0`). */
  backoffScheduleMs?: readonly number[];
  /** Injected so tests never need a real timer. */
  sleep?: (ms: number) => Promise<void>;
}

export type NeverminedRegistrationReconciliation =
  | { state: 'existing'; agentId: string; planId: string; registeredThisCall: false }
  | { state: 'absent' }
  | { state: 'partial'; detail: 'agent_without_plan' | 'plan_without_agent' }
  | { state: 'conflicting'; agentIds: string[]; planIds: string[] }
  | { state: 'timeout'; agentId: string | undefined; planId: string | undefined };

export const DEFAULT_NEVERMINED_RECONCILIATION_BACKOFF_MS = [
  0, 2_000, 5_000, 10_000, 20_000, 30_000,
] as const;

async function defaultSleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function tryGet<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch {
    return undefined;
  }
}

/**
 * Bounded (at most `backoffScheduleMs.length` passes), read-only. Never
 * mutates. See module doc for the duplicate-prevention invariant this
 * exists to preserve.
 */
export async function reconcileNeverminedRegistration(
  client: NeverminedRegistryClient,
  expectation: NeverminedRegistrationExpectation,
  options: ReconcileNeverminedRegistrationOptions = {}
): Promise<NeverminedRegistrationReconciliation> {
  const schedule = options.backoffScheduleMs ?? DEFAULT_NEVERMINED_RECONCILIATION_BACKOFF_MS;
  const sleep = options.sleep ?? defaultSleep;

  let lastAgentId: string | undefined = expectation.knownAgentId;
  let lastPlanId: string | undefined = expectation.knownPlanId;

  for (let attempt = 0; attempt < schedule.length; attempt++) {
    await sleep(schedule[attempt]!);

    // 1. Cheapest path: direct read of previously-known IDs, with an
    // exact-metadata check so a stale/foreign ID can never be silently
    // treated as this checkpoint's object.
    if (expectation.knownAgentId && expectation.knownPlanId) {
      const agent = await tryGet(() => client.getAgent(expectation.knownAgentId!));
      const plan = await tryGet(() => client.getPlan(expectation.knownPlanId!));
      if (agent && plan) {
        if (agent.name !== expectation.agentName || plan.name !== expectation.planName) {
          return { state: 'conflicting', agentIds: [agent.id], planIds: [plan.id] };
        }
        const linked = await tryGet(() => client.getAgentPlans(expectation.knownAgentId!));
        if (linked?.planIds.includes(expectation.knownPlanId!)) {
          return {
            state: 'existing',
            agentId: agent.id,
            planId: plan.id,
            registeredThisCall: false,
          };
        }
        // Both individually readable but not yet linked — still
        // synchronizing; fall through to try the listing path below,
        // then retry on the next scheduled attempt.
      }
    }

    // 2. Listing-based reconciliation by exact metadata match — never
    // fuzzy — used whenever known IDs are absent, or didn't (yet)
    // resolve cleanly above.
    const agentsResult = await tryGet(() => client.getAgents());
    const plansResult = await tryGet(() => client.getPlans());
    const matchingAgents = (agentsResult?.agents ?? []).filter(
      (a) => a.name === expectation.agentName
    );
    const matchingPlans = (plansResult?.plans ?? []).filter((p) => p.name === expectation.planName);

    if (matchingAgents.length > 1 || matchingPlans.length > 1) {
      return {
        state: 'conflicting',
        agentIds: matchingAgents.map((a) => a.id),
        planIds: matchingPlans.map((p) => p.id),
      };
    }
    if (matchingAgents.length === 1 && matchingPlans.length === 0) {
      return { state: 'partial', detail: 'agent_without_plan' };
    }
    if (matchingAgents.length === 0 && matchingPlans.length === 1) {
      return { state: 'partial', detail: 'plan_without_agent' };
    }
    if (matchingAgents.length === 1 && matchingPlans.length === 1) {
      const agentId = matchingAgents[0]!.id;
      const planId = matchingPlans[0]!.id;
      const linked = await tryGet(() => client.getAgentPlans(agentId));
      if (linked?.planIds.includes(planId)) {
        return { state: 'existing', agentId, planId, registeredThisCall: false };
      }
      lastAgentId = agentId;
      lastPlanId = planId;
      continue; // linkage still synchronizing — retry
    }

    // matchingAgents.length === 0 && matchingPlans.length === 0: only a
    // positive absence across the *entire* schedule counts as 'absent' —
    // a single empty listing on an early attempt keeps polling instead.
    if (attempt === schedule.length - 1) {
      return { state: 'absent' };
    }
  }

  return { state: 'timeout', agentId: lastAgentId, planId: lastPlanId };
}
