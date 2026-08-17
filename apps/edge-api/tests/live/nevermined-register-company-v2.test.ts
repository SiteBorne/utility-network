/**
 * SUN-1000 checkpoint 1O-B (v2) — registration-only operator entry point for
 * `company_evidence_graph.v2`.
 *
 * The harness is guarded independently from every payment/live probe. A
 * dedicated `NEVERMINED_RECONCILE_COMPANY_V2=1` mode performs GET-only discovery
 * and can never reach registration. The separate
 * `NEVERMINED_REGISTER_COMPANY_V2=1` mode uses the builder credential only,
 * performs the same bounded reconciliation before any mutation, allows at most
 * one `registerAgentAndPlan` call after proven absence, and requires
 * authoritative GET read-back validation afterward.
 * It never creates a delegation/token/Payment-Identifier/job and never calls
 * verifyPermissions, the service runtime, or settlePermissions.
 */

import { describe, expect, it } from 'vitest';
import { Payments } from '@nevermined-io/payments';
import {
  NEVERMINED_DECLARATIONS,
  NEVERMINED_FIXED_PAYG_PERSISTENCE_MODEL,
  reconcileNeverminedFixedPaygRegistration,
  reconcileNeverminedRegistration,
  resolveNeverminedFixedPaygPlanRequirements,
  type NeverminedAgentReadback,
  type NeverminedPlanReadback,
  type NeverminedRegistryClient,
} from '@siteborne/protocol-nevermined';

const SERVICE_ID = 'company_evidence_graph.v2' as const;
const RECONCILE_ONLY = process.env.NEVERMINED_RECONCILE_COMPANY_V2 === '1';
const REGISTER = process.env.NEVERMINED_REGISTER_COMPANY_V2 === '1';

describe.skipIf(!RECONCILE_ONLY && !REGISTER)(
  'SUN-1000 checkpoint 1O-B — v2 company evidence registration only',
  () => {
    it('reconciles first, registers at most once after proven absence, and validates GET read-back', async () => {
      const apiKey = process.env.NVM_API_KEY;
      if (!apiKey) throw new Error('NVM_API_KEY must be set (builder credential)');
      if (process.env.NVM_ENVIRONMENT !== 'sandbox') {
        throw new Error('NVM_ENVIRONMENT must be sandbox');
      }
      if (process.env.RUN_LIVE_NEVERMINED || process.env.RUN_LIVE_X402) {
        throw new Error('payment live flags must remain absent during registration');
      }
      if (RECONCILE_ONLY === REGISTER) {
        throw new Error('select exactly one company reconciliation/registration mode');
      }

      const builder = Payments.getInstance({ nvmApiKey: apiKey });
      const declaration = NEVERMINED_DECLARATIONS[SERVICE_ID];
      const requirements = resolveNeverminedFixedPaygPlanRequirements(SERVICE_ID);
      const model = NEVERMINED_FIXED_PAYG_PERSISTENCE_MODEL;

      expect(declaration.plan.registration_allowed).toBe(true);
      expect(declaration.plan.gross_buyer_amount_atomic).toBe('39000');
      expect(declaration.plan.siteborne_payment_semantics).toBe('exact');
      expect(declaration.plan.dynamic_actual_settlement_required).toBe(false);

      let matchingAgentCount = 0;
      let matchingPlanCount = 0;
      let agentListingPasses = 0;
      let planListingPasses = 0;

      const registryClient: NeverminedRegistryClient = {
        getAgent: async (id) => {
          const agent = (await builder.agents.getAgent(id)) as NeverminedAgentReadback;
          return { id, name: agent.metadata?.main?.name };
        },
        getAgents: async () => {
          agentListingPasses += 1;
          const page = await builder.agents.getAgents(1, 100, 'createdAt', 'desc');
          const agents = (page.agents as NeverminedAgentReadback[]).map((agent) => ({
            id: agent.id ?? '',
            name: agent.metadata?.main?.name,
          }));
          matchingAgentCount = agents.filter(
            (agent) => agent.name === requirements.agent_name
          ).length;
          return { agents };
        },
        getAgentPlans: async (id) => {
          const result = await builder.agents.getAgentPlans(id);
          const list: { id?: string; planId?: string }[] = Array.isArray(result)
            ? result
            : (result?.plans ?? []);
          return {
            planIds: list.map((plan) => plan.id ?? plan.planId).filter(Boolean) as string[],
          };
        },
        getPlan: async (id) => {
          const plan = (await builder.plans.getPlan(id)) as NeverminedPlanReadback;
          return { id, name: plan.metadata?.main?.name };
        },
        getPlans: async () => {
          planListingPasses += 1;
          const page = await builder.plans.getPlans(1, 100, 'createdAt', 'desc');
          const plans = (page.plans as NeverminedPlanReadback[]).map((plan) => ({
            id: plan.id ?? '',
            name: plan.metadata?.main?.name,
          }));
          matchingPlanCount = plans.filter((plan) => plan.name === requirements.plan_name).length;
          return { plans };
        },
      };

      let reconciliation = await reconcileNeverminedRegistration(registryClient, {
        agentName: requirements.agent_name,
        planName: requirements.plan_name,
      });

      // Public, bounded checkpoint evidence only.
      // eslint-disable-next-line no-console
      console.log('Company registration initial reconciliation (sanitized):', {
        state: reconciliation.state,
        matching_agent_count: matchingAgentCount,
        matching_plan_count: matchingPlanCount,
        agent_listing_passes: agentListingPasses,
        plan_listing_passes: planListingPasses,
      });

      let agentId: string;
      let planId: string;
      let registrationMutations = 0;

      if (reconciliation.state === 'existing') {
        const agent = (await builder.agents.getAgent(
          reconciliation.agentId
        )) as NeverminedAgentReadback;
        const plan = (await builder.plans.getPlan(reconciliation.planId)) as NeverminedPlanReadback;
        const exact = reconcileNeverminedFixedPaygRegistration(
          SERVICE_ID,
          reconciliation,
          agent,
          plan
        );
        if (exact.state !== 'EXACT_EXISTING') {
          throw new Error(
            `company registration identity matched but authoritative read-back conflicted (${exact.state === 'CONFLICT' ? exact.reason : exact.state})`
          );
        }
        agentId = exact.agentId;
        planId = exact.planId;
      } else if (reconciliation.state === 'absent') {
        expect(reconcileNeverminedFixedPaygRegistration(SERVICE_ID, reconciliation)).toEqual({
          state: 'NO_MATCH',
        });
        if (RECONCILE_ONLY) {
          // eslint-disable-next-line no-console
          console.log('Company registration is authoritatively NO_MATCH; read-only mode stopping.');
          return;
        }

        const priceConfig = await builder.plans.getPayAsYouGoPriceConfig(
          requirements.gross_price_atomic,
          model.seller_receiver,
          model.token_address
        );
        const creditsConfig = builder.plans.getPayAsYouGoCreditsConfig();
        registrationMutations += 1;
        const registered = await builder.agents.registerAgentAndPlan(
          { name: requirements.agent_name, description: declaration.agent.description },
          { endpoints: [{ POST: requirements.endpoint }] },
          { name: requirements.plan_name, accessLimit: 'credits' },
          priceConfig,
          creditsConfig,
          'credits'
        );
        // eslint-disable-next-line no-console
        console.log('Company registration submitted (sanitized):', {
          registration_mutations: registrationMutations,
          agent_id_present: Boolean(registered.agentId),
          plan_id_present: Boolean(registered.planId),
        });

        reconciliation = await reconcileNeverminedRegistration(registryClient, {
          agentName: requirements.agent_name,
          planName: requirements.plan_name,
          knownAgentId: registered.agentId,
          knownPlanId: registered.planId,
        });
        if (reconciliation.state !== 'existing') {
          throw new Error(
            `company post-registration reconciliation was ${reconciliation.state}; outcome is ambiguous and must not be retried`
          );
        }
        agentId = reconciliation.agentId;
        planId = reconciliation.planId;
      } else {
        throw new Error(
          `company registration reconciliation was ${reconciliation.state}; refusing mutation`
        );
      }

      expect(registrationMutations).toBeLessThanOrEqual(1);

      const readAgent = (await builder.agents.getAgent(agentId)) as NeverminedAgentReadback;
      const readPlan = (await builder.plans.getPlan(planId)) as NeverminedPlanReadback;
      const final = reconcileNeverminedFixedPaygRegistration(
        SERVICE_ID,
        { state: 'existing', agentId, planId, registeredThisCall: false },
        readAgent,
        readPlan
      );
      expect(final).toEqual({ state: 'EXACT_EXISTING', agentId, planId });

      // eslint-disable-next-line no-console
      console.log('Company registration read-back (sanitized):', {
        registration_mutations: registrationMutations,
        agent_id: agentId,
        agent_name: readAgent.metadata?.main?.name,
        endpoint: readAgent.metadata?.agent?.endpoints,
        linked_plan_ids: readAgent.registry?.plans,
        plan_id: planId,
        plan_name: readPlan.metadata?.main?.name,
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
        validator: 'valid',
        final_reconciliation: final.state,
        delegation_creations: 0,
        token_creations: 0,
        verify_calls: 0,
        service_executions: 0,
        settle_calls: 0,
        payment_identifiers: 0,
        jobs: 0,
        payment_transactions: 0,
      });
    }, 120_000);
  }
);
