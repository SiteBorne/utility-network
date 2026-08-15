/**
 * SUN-0900B checkpoint 2F — narrow, registration-only operator entry
 * point for `document_evidence_json.v1`.
 *
 * This file does exactly one thing: reconcile-then-register (never
 * blindly register) the document agent/plan, and read the result back.
 * It never creates a delegation, never mints an x402 token, never calls
 * `verifyPermissions`/`settlePermissions`, never executes the service.
 * Those remain for a future, separately-authorized live dynamic-proof
 * turn.
 *
 * Gated by its own env var — deliberately NOT `RUN_LIVE_NEVERMINED` (that
 * flag gates the live payment-flow test suite; registration is a
 * narrower, distinct, one-time operation):
 *
 *   describe.skipIf(process.env.NEVERMINED_REGISTER_DOCUMENT !== '1')
 *
 * Requires: NVM_API_KEY (builder credential only — NVM_SUBSCRIBER_API_KEY
 * is never read here, registration is never subscriber-side).
 *
 * Checkpoint 2E accepted the real, reusable prepaid dynamic-credit
 * model. This harness therefore registers exactly the accepted shape:
 * 190000 atomic Base Sepolia USDC buys 190000 credits; a request may
 * redeem 12000..190000 credits. It does not use the disproven PAYG
 * 1/1/1 helper shape. Before reuse and after any one-time registration,
 * authoritative agent/plan GETs must pass
 * `validateNeverminedDocumentDynamicPlan`; a name match with wrong
 * economics is a conflict, never an exact registration.
 *
 * `controlled_sandbox_self_test`: independent_customer=false, revenue=false,
 * open_market_purchase=false, production_ready=false, production_enabled=false.
 */
import { describe, it, expect } from 'vitest';
import { Payments } from '@nevermined-io/payments';
import {
  NEVERMINED_DECLARATIONS,
  DOCUMENT_DYNAMIC_PLAN_REQUIREMENTS,
  reconcileNeverminedDocumentDynamicRegistration,
  reconcileNeverminedRegistration,
  type NeverminedAgentReadback,
  type NeverminedPlanReadback,
  type NeverminedRegistryClient,
} from '@siteborne/protocol-nevermined';

const SERVICE_ID = 'document_evidence_json.v1';
const SELLER_ADDRESS = '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1' as const;
const BASE_SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const;

describe.skipIf(process.env.NEVERMINED_REGISTER_DOCUMENT !== '1')(
  'SUN-0900B checkpoint 2F — document_evidence_json.v1 registration (registration-only, no payment)',
  () => {
    it('reconciles first; registers exactly once only if genuinely absent; reads back and verifies', async () => {
      const apiKey = process.env.NVM_API_KEY;
      if (!apiKey) throw new Error('NVM_API_KEY must be set (builder credential)');

      const builder = Payments.getInstance({ nvmApiKey: apiKey });
      const declaration = NEVERMINED_DECLARATIONS[SERVICE_ID];
      expect(declaration.plan.registration_allowed).toBe(true);
      expect(declaration.plan.gross_buyer_amount_atomic).toBe('190000');
      expect(declaration.plan.siteborne_payment_semantics).toBe('upto');

      const agentName = declaration.agent.title;
      const planName = DOCUMENT_DYNAMIC_PLAN_REQUIREMENTS.plan_name;

      // ---------------------------------------------------------------
      // Reconcile FIRST. Never register from a single failed read —
      // reconcileNeverminedRegistration makes a bounded, read-only
      // backoff-scheduled series of attempts before ever reporting
      // 'absent'.
      // ---------------------------------------------------------------
      const registryClient: NeverminedRegistryClient = {
        getAgent: async (id) => {
          const agent = (await builder.agents.getAgent(id)) as {
            metadata?: { main?: { name?: string } };
          };
          return { id, name: agent?.metadata?.main?.name };
        },
        getAgents: async () => {
          const page = await builder.agents.getAgents(1, 100, 'createdAt', 'desc');
          return {
            agents: (page.agents as { id: string; metadata?: { main?: { name?: string } } }[]).map(
              (a) => ({ id: a.id, name: a.metadata?.main?.name })
            ),
          };
        },
        getAgentPlans: async (id) => {
          const result = await builder.agents.getAgentPlans(id);
          const list: { id?: string; planId?: string }[] = Array.isArray(result)
            ? result
            : (result?.plans ?? []);
          return {
            planIds: list.map((p) => p.id ?? p.planId).filter((x): x is string => Boolean(x)),
          };
        },
        getPlan: async (id) => {
          const plan = (await builder.plans.getPlan(id)) as {
            metadata?: { main?: { name?: string } };
          };
          return { id, name: plan?.metadata?.main?.name };
        },
        getPlans: async () => {
          const page = await builder.plans.getPlans(1, 100, 'createdAt', 'desc');
          return {
            plans: (page.plans as { id: string; metadata?: { main?: { name?: string } } }[]).map(
              (p) => ({ id: p.id, name: p.metadata?.main?.name })
            ),
          };
        },
      };

      let reconciliation = await reconcileNeverminedRegistration(registryClient, {
        agentName,
        planName,
      });
      // eslint-disable-next-line no-console
      console.log('Document registration reconciliation (sanitized):', {
        state: reconciliation.state,
      });

      let agentId: string;
      let planId: string;

      if (reconciliation.state === 'existing') {
        const readAgent = (await builder.agents.getAgent(
          reconciliation.agentId
        )) as NeverminedAgentReadback;
        const readPlan = (await builder.plans.getPlan(
          reconciliation.planId
        )) as NeverminedPlanReadback;
        const exactExisting = reconcileNeverminedDocumentDynamicRegistration(
          reconciliation,
          readAgent,
          readPlan
        );
        if (exactExisting.state !== 'EXACT_EXISTING') {
          const detail =
            exactExisting.state === 'CONFLICT' ? exactExisting.reason : exactExisting.state;
          throw new Error(
            `document registration: identity matched but authoritative read-back conflicted (${detail})`
          );
        }
        agentId = exactExisting.agentId;
        planId = exactExisting.planId;
        // eslint-disable-next-line no-console
        console.log('Document agent/plan is EXACT_EXISTING — reusing, NOT registering again.');
      } else if (reconciliation.state === 'absent') {
        const noMatch = reconcileNeverminedDocumentDynamicRegistration(reconciliation);
        expect(noMatch).toEqual({ state: 'NO_MATCH' });
        const priceConfig = builder.plans.getERC20PriceConfig(
          DOCUMENT_DYNAMIC_PLAN_REQUIREMENTS.gross_price_atomic,
          BASE_SEPOLIA_USDC,
          SELLER_ADDRESS
        );
        const creditsConfig = builder.plans.getDynamicCreditsConfig(
          DOCUMENT_DYNAMIC_PLAN_REQUIREMENTS.credits_granted,
          DOCUMENT_DYNAMIC_PLAN_REQUIREMENTS.min_redemption,
          DOCUMENT_DYNAMIC_PLAN_REQUIREMENTS.max_redemption
        );
        const registered = await builder.agents.registerAgentAndPlan(
          { name: declaration.agent.title, description: declaration.agent.description },
          { endpoints: [{ POST: `https://utility.siteborne.net${declaration.agent.endpoint}` }] },
          { name: planName, accessLimit: 'credits' },
          priceConfig,
          creditsConfig,
          'credits'
        );
        // eslint-disable-next-line no-console
        console.log('Document agent/plan registered (sanitized): registration_performed=true');

        // Registration is eventually consistent. Reconcile the exact
        // returned IDs over the same bounded schedule, then validate the
        // authoritative full read-back before declaring success.
        reconciliation = await reconcileNeverminedRegistration(registryClient, {
          agentName,
          planName,
          knownAgentId: registered.agentId,
          knownPlanId: registered.planId,
        });
        if (reconciliation.state !== 'existing') {
          throw new Error(
            `document registration: post-registration reconciliation was ${reconciliation.state}; refusing ambiguous state`
          );
        }
        const readAgent = (await builder.agents.getAgent(
          reconciliation.agentId
        )) as NeverminedAgentReadback;
        const readPlan = (await builder.plans.getPlan(
          reconciliation.planId
        )) as NeverminedPlanReadback;
        const exactRegistered = reconcileNeverminedDocumentDynamicRegistration(
          reconciliation,
          readAgent,
          readPlan
        );
        if (exactRegistered.state !== 'EXACT_EXISTING') {
          const detail =
            exactRegistered.state === 'CONFLICT' ? exactRegistered.reason : exactRegistered.state;
          throw new Error(
            `document registration: persisted authoritative read-back conflicted (${detail})`
          );
        }
        agentId = exactRegistered.agentId;
        planId = exactRegistered.planId;
      } else {
        throw new Error(
          `document registration: reconciliation did not resolve to 'existing' or 'absent' (got "${reconciliation.state}") — refusing to guess. Never register when reconciliation reports partial/conflicting/timeout state.`
        );
      }

      expect(agentId).toBeTruthy();
      expect(planId).toBeTruthy();

      // ---------------------------------------------------------------
      // Read back, independently, and verify it matches what was
      // predicted — never merely trust the registration call's own
      // return value.
      // ---------------------------------------------------------------
      const readAgent = (await builder.agents.getAgent(agentId)) as NeverminedAgentReadback;
      const readPlan = (await builder.plans.getPlan(planId)) as NeverminedPlanReadback;
      const finalValidation = reconcileNeverminedDocumentDynamicRegistration(
        { state: 'existing', agentId, planId, registeredThisCall: false },
        readAgent,
        readPlan
      );
      expect(finalValidation).toEqual({ state: 'EXACT_EXISTING', agentId, planId });

      // eslint-disable-next-line no-console
      console.log('Read-back (sanitized):', {
        agent_id: agentId,
        agent_name: readAgent?.metadata?.main?.name,
        plan_id: planId,
        plan_name: readPlan?.metadata?.main?.name,
        plan_amounts: readPlan.registry?.price?.amounts?.map((a) => String(a)),
        plan_receivers: readPlan.registry?.price?.receivers,
        plan_token: readPlan.registry?.price?.tokenAddress,
        credits_amount: String(readPlan.registry?.credits?.amount),
        credits_min: String(readPlan.registry?.credits?.minAmount),
        credits_max: String(readPlan.registry?.credits?.maxAmount),
        plan_is_redemption_fixed: readPlan.registry?.credits?.isRedemptionAmountFixed,
        plan_is_trial: readPlan.metadata?.plan?.isTrialPlan,
        agent_plan_linkage_includes_plan: readAgent.registry?.plans?.includes(planId),
      });

      expect(readAgent?.metadata?.main?.name).toBe(agentName);
      expect(readPlan?.metadata?.main?.name).toBe(planName);
      expect(readAgent.registry?.plans).toEqual([planId]);

      // eslint-disable-next-line no-console
      console.log(
        'REGISTRATION READ-BACK COMPLETE. delegation_creations=0 tokens=0 verify=0 execute=0 settle=0'
      );
    }, 120_000);
  }
);
