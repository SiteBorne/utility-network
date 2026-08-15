/**
 * SUN-0900B checkpoint 2B — narrow, registration-only operator entry
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
 * NOT YET SAFE TO RUN (SUN-0900B checkpoint 2B, corrected from an
 * earlier overclaim this same checkpoint): two real Base Sepolia
 * transactions (0x847a6da0a6a63f1f12838bbe9269b8fd9798997b0680b0146b71
 * 47fcb715f417, 0x8fec56c49ee6e85a30105d308fd7b1788c9866f8d3780395c8e0
 * f5e549cfd0f2) prove the atomic amount SITEBORNE passes as
 * `settlePermissions({maxAmount})` is transferred on-chain exactly,
 * atomic-for-atomic, WHEN maxAmount equals the plan's registered price
 * (both observed transactions had actual === price, 9000 === 9000).
 * That is not the same claim as "actual < price settles exactly
 * actual" — Nevermined's own SDK exposes price and credits as
 * independent, builder-chosen numeric arguments with no enforced 1:1
 * relationship (`getDynamicCreditsConfig(creditsGranted, min, max)`'s
 * own doc example pairs an unrelated price and credit amount), and
 * whether a below-price settle is even accepted for the PAYG helper
 * pair this file uses (`getPayAsYouGoPriceConfig`/
 * `getPayAsYouGoCreditsConfig`) has never been tested live. Pending
 * that proof, `packages/protocol-nevermined/src/declarations.ts` keeps
 * `registration_allowed: false` for the document plan, and this file's
 * own first assertion (`registration_allowed` must be `true`) will
 * correctly refuse to proceed until that changes. Do not flip it back
 * without a positive live or read-back proof — see
 * docs/reports/SUN-0900B-checkpoint-2b-unit-economics-report.md.
 *
 * `controlled_sandbox_self_test`: independent_customer=false, revenue=false,
 * open_market_purchase=false, production_ready=false, production_enabled=false.
 */
import { describe, it, expect } from 'vitest';
import { Payments } from '@nevermined-io/payments';
import {
  NEVERMINED_DECLARATIONS,
  reconcileNeverminedRegistration,
  type NeverminedRegistryClient,
} from '@siteborne/protocol-nevermined';

const SERVICE_ID = 'document_evidence_json.v1';
const SELLER_ADDRESS = '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1' as const;
const BASE_SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const;

describe.skipIf(process.env.NEVERMINED_REGISTER_DOCUMENT !== '1')(
  'SUN-0900B checkpoint 2B — document_evidence_json.v1 registration (registration-only, no payment)',
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
      const planName = `${declaration.agent.title} — PAYG plan`;

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

      const reconciliation = await reconcileNeverminedRegistration(registryClient, {
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
        agentId = reconciliation.agentId;
        planId = reconciliation.planId;
        // eslint-disable-next-line no-console
        console.log('Document agent/plan already exists — reusing, NOT registering a second time.');
      } else if (reconciliation.state === 'absent') {
        const priceConfig = await builder.plans.getPayAsYouGoPriceConfig(
          BigInt(declaration.plan.gross_buyer_amount_atomic),
          SELLER_ADDRESS,
          BASE_SEPOLIA_USDC
        );
        const creditsConfig = builder.plans.getPayAsYouGoCreditsConfig();
        const registered = await builder.agents.registerAgentAndPlan(
          { name: declaration.agent.title, description: declaration.agent.description },
          { endpoints: [{ POST: `https://utility.siteborne.net${declaration.agent.endpoint}` }] },
          { name: planName, accessLimit: 'credits' },
          priceConfig,
          creditsConfig,
          'credits'
        );
        agentId = registered.agentId;
        planId = registered.planId;
        // eslint-disable-next-line no-console
        console.log('Document agent/plan registered (sanitized): registration_performed=true');
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
      const readAgent = (await builder.agents.getAgent(agentId)) as {
        metadata?: { main?: { name?: string } };
        endpoints?: unknown;
      };
      const readPlan = (await builder.plans.getPlan(planId)) as {
        metadata?: { main?: { name?: string } };
        price?: { amounts?: bigint[] | string[]; receivers?: string[]; tokenAddress?: string };
        credits?: { isRedemptionAmountFixed?: boolean };
        isTrialPlan?: boolean;
      };
      const agentPlansResult = await builder.agents.getAgentPlans(agentId);
      const linkedPlanIds: string[] = Array.isArray(agentPlansResult)
        ? (agentPlansResult as { id?: string; planId?: string }[])
            .map((p) => p.id ?? p.planId)
            .filter((x): x is string => Boolean(x))
        : ((agentPlansResult?.plans ?? []) as { id?: string; planId?: string }[])
            .map((p) => p.id ?? p.planId)
            .filter((x): x is string => Boolean(x));

      // eslint-disable-next-line no-console
      console.log('Read-back (sanitized):', {
        agent_id: agentId,
        agent_name: readAgent?.metadata?.main?.name,
        plan_id: planId,
        plan_name: readPlan?.metadata?.main?.name,
        plan_amounts: readPlan?.price?.amounts?.map((a) => String(a)),
        plan_receivers: readPlan?.price?.receivers,
        plan_token: readPlan?.price?.tokenAddress,
        plan_is_redemption_fixed: readPlan?.credits?.isRedemptionAmountFixed,
        plan_is_trial: readPlan?.isTrialPlan,
        agent_plan_linkage_includes_plan: linkedPlanIds.includes(planId),
      });

      expect(readAgent?.metadata?.main?.name).toBe(agentName);
      expect(readPlan?.metadata?.main?.name).toBe(planName);
      expect(linkedPlanIds).toContain(planId);
      const totalAmounts = (readPlan?.price?.amounts ?? []).reduce(
        (sum: bigint, a: string | bigint) => sum + BigInt(a),
        0n
      );
      expect(totalAmounts).toBe(BigInt(declaration.plan.gross_buyer_amount_atomic));
      expect(readPlan?.price?.receivers?.[0]).toBe(SELLER_ADDRESS);
      expect(readPlan?.price?.tokenAddress?.toLowerCase()).toBe(BASE_SEPOLIA_USDC.toLowerCase());
      expect(readPlan?.credits?.isRedemptionAmountFixed).toBe(false);
      expect(readPlan?.isTrialPlan).not.toBe(true);

      // eslint-disable-next-line no-console
      console.log(
        'REGISTRATION READ-BACK COMPLETE. delegation_creations=0 tokens=0 verify=0 execute=0 settle=0'
      );
    }, 120_000);
  }
);
