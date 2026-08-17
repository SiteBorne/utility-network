/**
 * SUN-1000 checkpoint 1O-B — narrow, registration-only operator entry
 * point for `document_evidence_json.v2`.
 *
 * Mirrors the accepted v1 harness (nevermined-register-document.test.ts,
 * SUN-0900B checkpoint 2F) exactly, targeting the v2 service and its
 * disambiguated display name (checkpoint 1O-B's own
 * deriveNeverminedAgentDisplayName correction -- v1/v2 agent names
 * previously collided, since both derived from the same plain registry
 * title). Same economics as v1 (SAME_ECONOMICS_NEW_SERVICE_MAJOR,
 * checkpoint 1L section 9): 190000 atomic Base Sepolia USDC buys 190000
 * credits; a request may redeem 12000..190000 credits.
 *
 * This file does exactly one thing: reconcile-then-register (never
 * blindly register) the document v2 agent/plan, and read the result
 * back. It never creates a delegation, never mints an x402 token, never
 * calls verifyPermissions/settlePermissions, never executes the service.
 *
 * `controlled_sandbox_self_test`: independent_customer=false, revenue=false,
 * open_market_purchase=false, production_ready=false, production_enabled=false.
 */
import { describe, it, expect } from 'vitest';
import { Payments } from '@nevermined-io/payments';
import {
  NEVERMINED_DECLARATIONS,
  DOCUMENT_DYNAMIC_PLAN_REQUIREMENTS_V2,
  reconcileNeverminedDocumentDynamicRegistration,
  reconcileNeverminedRegistration,
  type NeverminedAgentReadback,
  type NeverminedPlanReadback,
  type NeverminedRegistryClient,
} from '@siteborne/protocol-nevermined';

const SERVICE_ID = 'document_evidence_json.v2';
const SELLER_ADDRESS = '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1' as const;
const BASE_SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const;
const RECONCILE_ONLY = process.env.NEVERMINED_RECONCILE_DOCUMENT_V2 === '1';
const REGISTER = process.env.NEVERMINED_REGISTER_DOCUMENT_V2 === '1';

describe.skipIf(!RECONCILE_ONLY && !REGISTER)(
  'SUN-1000 checkpoint 1O-B — document_evidence_json.v2 registration (registration-only, no payment)',
  () => {
    it('reconciles first; registers exactly once only if genuinely absent; reads back and verifies', async () => {
      const apiKey = process.env.NVM_API_KEY;
      if (!apiKey) throw new Error('NVM_API_KEY must be set (builder credential)');
      if (process.env.NVM_ENVIRONMENT !== 'sandbox') {
        throw new Error('NVM_ENVIRONMENT must be sandbox');
      }
      if (RECONCILE_ONLY === REGISTER) {
        throw new Error('select exactly one document-v2 reconciliation/registration mode');
      }

      const builder = Payments.getInstance({ nvmApiKey: apiKey });
      const declaration = NEVERMINED_DECLARATIONS[SERVICE_ID];
      const req = DOCUMENT_DYNAMIC_PLAN_REQUIREMENTS_V2;
      expect(declaration.plan.registration_allowed).toBe(true);
      expect(declaration.plan.gross_buyer_amount_atomic).toBe('190000');
      expect(declaration.plan.siteborne_payment_semantics).toBe('upto');

      const agentName = declaration.agent.nevermined_display_name;
      const planName = req.plan_name;
      expect(agentName).toBe(req.agent_name);

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
      console.log('Document v2 registration reconciliation (sanitized):', {
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
          readPlan,
          req
        );
        if (exactExisting.state !== 'EXACT_EXISTING') {
          const detail =
            exactExisting.state === 'CONFLICT' ? exactExisting.reason : exactExisting.state;
          throw new Error(
            `document v2 registration: identity matched but authoritative read-back conflicted (${detail})`
          );
        }
        agentId = exactExisting.agentId;
        planId = exactExisting.planId;
        // eslint-disable-next-line no-console
        console.log('Document v2 agent/plan is EXACT_EXISTING — reusing, NOT registering again.');
      } else if (reconciliation.state === 'absent') {
        const noMatch = reconcileNeverminedDocumentDynamicRegistration(
          reconciliation,
          undefined,
          undefined,
          req
        );
        expect(noMatch).toEqual({ state: 'NO_MATCH' });
        if (RECONCILE_ONLY) {
          // eslint-disable-next-line no-console
          console.log(
            'Document v2 registration is authoritatively NO_MATCH; read-only mode stopping.'
          );
          return;
        }
        const priceConfig = builder.plans.getERC20PriceConfig(
          req.gross_price_atomic,
          BASE_SEPOLIA_USDC,
          SELLER_ADDRESS
        );
        const creditsConfig = builder.plans.getDynamicCreditsConfig(
          req.credits_granted,
          req.min_redemption,
          req.max_redemption
        );
        const registered = await builder.agents.registerAgentAndPlan(
          { name: agentName, description: declaration.agent.description },
          { endpoints: [{ POST: req.endpoint }] },
          { name: planName, accessLimit: 'credits' },
          priceConfig,
          creditsConfig,
          'credits'
        );
        // eslint-disable-next-line no-console
        console.log('Document v2 agent/plan registered (sanitized): registration_performed=true');

        reconciliation = await reconcileNeverminedRegistration(registryClient, {
          agentName,
          planName,
          knownAgentId: registered.agentId,
          knownPlanId: registered.planId,
        });
        if (reconciliation.state !== 'existing') {
          throw new Error(
            `document v2 registration: post-registration reconciliation was ${reconciliation.state}; refusing ambiguous state`
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
          readPlan,
          req
        );
        if (exactRegistered.state !== 'EXACT_EXISTING') {
          const detail =
            exactRegistered.state === 'CONFLICT' ? exactRegistered.reason : exactRegistered.state;
          throw new Error(
            `document v2 registration: persisted authoritative read-back conflicted (${detail})`
          );
        }
        agentId = exactRegistered.agentId;
        planId = exactRegistered.planId;
      } else {
        throw new Error(
          `document v2 registration: reconciliation did not resolve to 'existing' or 'absent' (got "${reconciliation.state}") — refusing to guess. Never register when reconciliation reports partial/conflicting/timeout state.`
        );
      }

      expect(agentId).toBeTruthy();
      expect(planId).toBeTruthy();

      const readAgent = (await builder.agents.getAgent(agentId)) as NeverminedAgentReadback;
      const readPlan = (await builder.plans.getPlan(planId)) as NeverminedPlanReadback;
      const finalValidation = reconcileNeverminedDocumentDynamicRegistration(
        { state: 'existing', agentId, planId, registeredThisCall: false },
        readAgent,
        readPlan,
        req
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
