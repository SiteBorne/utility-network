/**
 * SUN-0900B checkpoint 2L — builder-only, GET-only final registration audit.
 *
 * This operator entry point has no registration or payment method in its
 * dependency surface. It exhaustively paginates the builder's published
 * agents/plans, reads the four frozen IDs, applies the accepted authoritative
 * validators, and fails closed on a missing, conflicting, or duplicate
 * canonical registration.
 */

import { Payments } from '@nevermined-io/payments';
import {
  DOCUMENT_DYNAMIC_PLAN_REQUIREMENTS,
  SUN_0900B_CHECKPOINT_1_REGISTRATION,
  SUN_0900B_COMPANY_REGISTRATION,
  SUN_0900B_VERIFY_REGISTRATION,
  reconcileNeverminedDocumentDynamicRegistration,
  reconcileNeverminedFixedPaygRegistration,
  resolveNeverminedFixedPaygPlanRequirements,
  validateNeverminedDocumentDynamicPlan,
  validateNeverminedFixedPaygPlan,
  validateNeverminedRegistrationCompleteness,
  type NeverminedAgentReadback,
  type NeverminedPlanReadback,
  type NeverminedRegistrationAuditEntry,
} from '@siteborne/protocol-nevermined';
import { describe, expect, it } from 'vitest';

const AUDIT = process.env.NEVERMINED_AUDIT_REGISTRATIONS === '1';
const PAGE_SIZE = 100;

const DOCUMENT_REGISTRATION = {
  service_id: 'document_evidence_json.v1',
  agent_id: '109760621961288696094411057321700210583752765344624386042713081041578011828571',
  plan_id: '64977106381472769302826211192910538031161833107493020584806963732279386695975',
} as const;

const FROZEN_REGISTRATIONS = [
  SUN_0900B_COMPANY_REGISTRATION,
  SUN_0900B_CHECKPOINT_1_REGISTRATION,
  DOCUMENT_REGISTRATION,
  SUN_0900B_VERIFY_REGISTRATION,
] as const;

const FORBIDDEN_GUARDS = [
  'RUN_LIVE_NEVERMINED',
  'RUN_LIVE_X402',
  'NEVERMINED_REGISTER_DOCUMENT',
  'NEVERMINED_REGISTER_COMPANY',
  'NEVERMINED_REGISTER_VERIFY',
  'NEVERMINED_PROBE_PAYG_DIFFERENTIAL',
  'NEVERMINED_PROBE_DYNAMIC_CREDITS',
  'NEVERMINED_DOCUMENT_PARTIAL_BALANCE',
  'NEVERMINED_RECOVER_DOCUMENT_PAYMENT_ID',
] as const;

interface PublishedPage<T> {
  total: number;
  page: number;
  offset: number;
  values: T[];
}

async function collectPublished<T extends { id?: string }>(
  fetchPage: (page: number) => Promise<PublishedPage<T>>
): Promise<T[]> {
  const values: T[] = [];
  let expectedTotal: number | undefined;
  for (let page = 1; page <= 100; page += 1) {
    const result = await fetchPage(page);
    if (!Number.isSafeInteger(result.total) || result.total < 0) {
      throw new Error('published-resource listing returned a malformed total');
    }
    if (expectedTotal === undefined) expectedTotal = result.total;
    if (result.total !== expectedTotal || result.page !== page || result.offset !== PAGE_SIZE) {
      throw new Error('published-resource pagination changed during the read-only audit');
    }
    values.push(...result.values);
    if (values.length >= expectedTotal) break;
    if (result.values.length === 0) {
      throw new Error('published-resource pagination ended before the reported total');
    }
  }
  if (expectedTotal === undefined || values.length !== expectedTotal) {
    throw new Error('published-resource pagination did not reconcile to the reported total');
  }
  const ids = values.map((value) => value.id);
  if (ids.some((id) => typeof id !== 'string' || id.length === 0)) {
    throw new Error('published-resource listing contained a missing ID');
  }
  if (new Set(ids).size !== ids.length) {
    throw new Error('published-resource listing contained a duplicate ID');
  }
  return values;
}

describe.skipIf(!AUDIT)('SUN-0900B checkpoint 2L — final registration completeness audit', () => {
  it('reconciles one exact canonical agent/plan per service with no mutation surface', async () => {
    const apiKey = process.env.NVM_API_KEY;
    if (!apiKey) throw new Error('NVM_API_KEY must be set (builder credential)');
    if (process.env.NVM_ENVIRONMENT !== 'sandbox') {
      throw new Error('NVM_ENVIRONMENT must be sandbox');
    }
    if (process.env.NVM_SUBSCRIBER_API_KEY) {
      throw new Error('subscriber credential must be removed from the registration audit process');
    }
    for (const guard of FORBIDDEN_GUARDS) {
      if (process.env[guard]) throw new Error(`${guard} must remain absent during the audit`);
    }

    const builder = Payments.getInstance({ nvmApiKey: apiKey });
    const agents = await collectPublished<NeverminedAgentReadback>(async (page) => {
      const result = await builder.agents.getAgents(page, PAGE_SIZE, 'createdAt', 'desc');
      return {
        total: result.total,
        page: result.page,
        offset: result.offset,
        values: result.agents as NeverminedAgentReadback[],
      };
    });
    const plans = await collectPublished<NeverminedPlanReadback>(async (page) => {
      const result = await builder.plans.getPlans(page, PAGE_SIZE, 'createdAt', 'desc');
      return {
        total: result.total,
        page: result.page,
        offset: result.offset,
        values: result.plans as NeverminedPlanReadback[],
      };
    });

    const auditEntries: NeverminedRegistrationAuditEntry[] = [];
    const sanitizedReadbacks: Record<string, unknown>[] = [];

    for (const frozen of FROZEN_REGISTRATIONS) {
      const serviceId = frozen.service_id;
      const requirements =
        serviceId === 'document_evidence_json.v1'
          ? DOCUMENT_DYNAMIC_PLAN_REQUIREMENTS
          : resolveNeverminedFixedPaygPlanRequirements(serviceId);
      const matchingAgents = agents.filter(
        (agent) => agent.metadata?.main?.name === requirements.agent_name
      );
      const matchingPlans = plans.filter(
        (plan) => plan.metadata?.main?.name === requirements.plan_name
      );
      const readAgent = (await builder.agents.getAgent(frozen.agent_id)) as NeverminedAgentReadback;
      const readPlan = (await builder.plans.getPlan(frozen.plan_id)) as NeverminedPlanReadback;

      expect(matchingAgents.map((agent) => agent.id)).toEqual([frozen.agent_id]);
      expect(matchingPlans.map((plan) => plan.id)).toEqual([frozen.plan_id]);

      const baseReconciliation = {
        state: 'existing' as const,
        agentId: frozen.agent_id,
        planId: frozen.plan_id,
        registeredThisCall: false as const,
      };
      const validation =
        serviceId === 'document_evidence_json.v1'
          ? validateNeverminedDocumentDynamicPlan(readAgent, readPlan)
          : validateNeverminedFixedPaygPlan(serviceId, readAgent, readPlan);
      const reconciliation =
        serviceId === 'document_evidence_json.v1'
          ? reconcileNeverminedDocumentDynamicRegistration(baseReconciliation, readAgent, readPlan)
          : reconcileNeverminedFixedPaygRegistration(
              serviceId,
              baseReconciliation,
              readAgent,
              readPlan
            );

      expect(validation).toEqual({ valid: true });
      expect(reconciliation).toEqual({
        state: 'EXACT_EXISTING',
        agentId: frozen.agent_id,
        planId: frozen.plan_id,
      });

      auditEntries.push({
        service_id: serviceId,
        reconciliation: reconciliation.state,
        matching_agent_count: matchingAgents.length,
        matching_plan_count: matchingPlans.length,
      });
      sanitizedReadbacks.push({
        service_id: serviceId,
        agent_id: frozen.agent_id,
        plan_id: frozen.plan_id,
        agent_name: readAgent.metadata?.main?.name,
        plan_name: readPlan.metadata?.main?.name,
        endpoint: readAgent.metadata?.agent?.endpoints,
        linked_plan_ids: readAgent.registry?.plans,
        price_amounts: readPlan.registry?.price?.amounts?.map(String),
        price_receivers: readPlan.registry?.price?.receivers,
        token_address: readPlan.registry?.price?.tokenAddress,
        is_crypto: readPlan.registry?.price?.isCrypto,
        credits_amount: String(readPlan.registry?.credits?.amount),
        credits_min: String(readPlan.registry?.credits?.minAmount),
        credits_max: String(readPlan.registry?.credits?.maxAmount),
        is_redemption_fixed: readPlan.registry?.credits?.isRedemptionAmountFixed,
        redemption_type: readPlan.registry?.credits?.redemptionType,
        onchain_mirror: readPlan.registry?.credits?.onchainMirror,
        duration_secs: String(readPlan.registry?.credits?.durationSecs),
        access_limit: readPlan.metadata?.plan?.accessLimit,
        is_trial: readPlan.metadata?.plan?.isTrialPlan,
        recurring: readPlan.metadata?.plan?.recurringSubscription,
        validator: validation.valid ? 'valid' : validation.reason,
        reconciliation: reconciliation.state,
        matching_agent_count: matchingAgents.length,
        matching_plan_count: matchingPlans.length,
      });
    }

    expect(validateNeverminedRegistrationCompleteness(auditEntries)).toEqual({ valid: true });

    const capabilityProbeAgents = agents.filter((agent) =>
      agent.metadata?.main?.name?.includes('Capability Probe')
    );
    const capabilityProbePlans = plans.filter((plan) =>
      plan.metadata?.main?.name?.includes('Capability Probe')
    );

    // Public, bounded output only. No raw response or auth material is logged.
    // eslint-disable-next-line no-console
    console.log('SUN-0900B registration completeness audit (sanitized):', {
      environment: 'sandbox',
      published_agent_total: agents.length,
      published_plan_total: plans.length,
      canonical: sanitizedReadbacks,
      duplicate_canonical_registrations: 0,
      capability_probe_agent_ids: capabilityProbeAgents.map((agent) => agent.id),
      capability_probe_plan_ids: capabilityProbePlans.map((plan) => plan.id),
      completeness: 'PASS',
      registration_mutations: 0,
      delegation_creations: 0,
      token_creations: 0,
      verify_calls: 0,
      service_executions: 0,
      settle_calls: 0,
      payment_identifiers: 0,
      jobs: 0,
      payment_transactions: 0,
      usdc_movement_atomic: '0',
    });
  }, 120_000);
});
