import { describe, expect, it, vi } from 'vitest';
import {
  reconcileNeverminedRegistration,
  type NeverminedRegistryAgentSummary,
  type NeverminedRegistryClient,
  type NeverminedRegistryPlanSummary,
} from './registry-reconciliation';

const EXPECTATION = {
  agentName: 'Verified Web Context',
  planName: 'Verified Web Context — PAYG plan',
};
const AGENT_ID = 'agent-1';
const PLAN_ID = 'plan-1';
const AGENT: NeverminedRegistryAgentSummary = { id: AGENT_ID, name: EXPECTATION.agentName };
const PLAN: NeverminedRegistryPlanSummary = { id: PLAN_ID, name: EXPECTATION.planName };

function notFound(): never {
  throw new Error('not_found');
}

/** A fake client built from per-attempt response sequences — `attempt`
 * increments once per `getAgent`/`getAgents` call so scenarios can model
 * "not found on attempt 0, found on attempt 1" precisely. */
function fakeClient(overrides: Partial<NeverminedRegistryClient>): NeverminedRegistryClient {
  return {
    getAgent: overrides.getAgent ?? (() => notFound()),
    getAgents: overrides.getAgents ?? (() => Promise.resolve({ agents: [] })),
    getAgentPlans: overrides.getAgentPlans ?? (() => Promise.resolve({ planIds: [] })),
    getPlan: overrides.getPlan ?? (() => notFound()),
    getPlans: overrides.getPlans ?? (() => Promise.resolve({ plans: [] })),
  };
}

const NO_SLEEP = { sleep: async () => {}, backoffScheduleMs: [0, 0, 0] };

describe('reconcileNeverminedRegistration', () => {
  it('A: immediate getAgent/getPlan fail, later attempt succeeds by known IDs -> existing, never registers', async () => {
    let calls = 0;
    const client = fakeClient({
      getAgent: async (id) => {
        calls += 1;
        if (calls < 2) notFound();
        return { id, name: EXPECTATION.agentName };
      },
      getPlan: async (id) => ({ id, name: EXPECTATION.planName }),
      getAgentPlans: async () => ({ planIds: [PLAN_ID] }),
    });
    const result = await reconcileNeverminedRegistration(
      client,
      { ...EXPECTATION, knownAgentId: AGENT_ID, knownPlanId: PLAN_ID },
      NO_SLEEP
    );
    expect(result).toEqual({
      state: 'existing',
      agentId: AGENT_ID,
      planId: PLAN_ID,
      registeredThisCall: false,
    });
  });

  it('B: getAgent missing but getAgents listing already contains the object -> reconciles without registration', async () => {
    const client = fakeClient({
      getAgent: () => notFound(),
      getPlan: () => notFound(),
      getAgents: async () => ({ agents: [AGENT] }),
      getPlans: async () => ({ plans: [PLAN] }),
      getAgentPlans: async () => ({ planIds: [PLAN_ID] }),
    });
    const result = await reconcileNeverminedRegistration(client, EXPECTATION, NO_SLEEP);
    expect(result).toEqual({
      state: 'existing',
      agentId: AGENT_ID,
      planId: PLAN_ID,
      registeredThisCall: false,
    });
  });

  it('C: agent exists + plan exists + linkage exists -> reuse', async () => {
    const client = fakeClient({
      getAgent: async (id) => ({ id, name: EXPECTATION.agentName }),
      getPlan: async (id) => ({ id, name: EXPECTATION.planName }),
      getAgentPlans: async () => ({ planIds: [PLAN_ID] }),
    });
    const result = await reconcileNeverminedRegistration(
      client,
      { ...EXPECTATION, knownAgentId: AGENT_ID, knownPlanId: PLAN_ID },
      NO_SLEEP
    );
    expect(result.state).toBe('existing');
  });

  it('D: agent exists, plan absent -> fail closed (partial)', async () => {
    const client = fakeClient({
      getAgents: async () => ({ agents: [AGENT] }),
      getPlans: async () => ({ plans: [] }),
    });
    const result = await reconcileNeverminedRegistration(client, EXPECTATION, NO_SLEEP);
    expect(result).toEqual({ state: 'partial', detail: 'agent_without_plan' });
  });

  it('E: plan exists, agent absent -> fail closed (partial)', async () => {
    const client = fakeClient({
      getAgents: async () => ({ agents: [] }),
      getPlans: async () => ({ plans: [PLAN] }),
    });
    const result = await reconcileNeverminedRegistration(client, EXPECTATION, NO_SLEEP);
    expect(result).toEqual({ state: 'partial', detail: 'plan_without_agent' });
  });

  it('F: multiple exact-name candidates -> fail closed (conflicting)', async () => {
    const client = fakeClient({
      getAgents: async () => ({
        agents: [AGENT, { id: 'agent-2', name: EXPECTATION.agentName }],
      }),
      getPlans: async () => ({ plans: [PLAN] }),
    });
    const result = await reconcileNeverminedRegistration(client, EXPECTATION, NO_SLEEP);
    expect(result.state).toBe('conflicting');
    if (result.state === 'conflicting') {
      expect(result.agentIds).toEqual([AGENT_ID, 'agent-2']);
    }
  });

  it('G: known IDs resolve, but to differently-named objects -> fail closed (conflicting)', async () => {
    const client = fakeClient({
      getAgent: async (id) => ({ id, name: 'Some Other Agent' }),
      getPlan: async (id) => ({ id, name: 'Some Other Plan' }),
    });
    const result = await reconcileNeverminedRegistration(
      client,
      { ...EXPECTATION, knownAgentId: AGENT_ID, knownPlanId: PLAN_ID },
      NO_SLEEP
    );
    expect(result.state).toBe('conflicting');
  });

  it('H: timeout after the full backoff schedule -> fail closed, no registration performed by this module', async () => {
    const client = fakeClient({
      // agent/plan individually resolvable but never linked — perpetual
      // "still synchronizing" state, so the schedule must exhaust.
      getAgents: async () => ({ agents: [AGENT] }),
      getPlans: async () => ({ plans: [PLAN] }),
      getAgentPlans: async () => ({ planIds: [] }),
    });
    const result = await reconcileNeverminedRegistration(client, EXPECTATION, NO_SLEEP);
    expect(result).toEqual({ state: 'timeout', agentId: AGENT_ID, planId: PLAN_ID });
  });

  it('I: absent only after the full schedule proves it, never from one empty listing', async () => {
    const getAgents = vi.fn(async () => ({ agents: [] }));
    const getPlans = vi.fn(async () => ({ plans: [] }));
    const client = fakeClient({ getAgents, getPlans });
    const result = await reconcileNeverminedRegistration(client, EXPECTATION, NO_SLEEP);
    expect(result).toEqual({ state: 'absent' });
    // Exactly one listing call per scheduled attempt — proves the
    // function polled across the whole bounded schedule rather than
    // deciding 'absent' after the first empty read.
    expect(getAgents).toHaveBeenCalledTimes(NO_SLEEP.backoffScheduleMs.length);
    expect(getPlans).toHaveBeenCalledTimes(NO_SLEEP.backoffScheduleMs.length);
  });
});
