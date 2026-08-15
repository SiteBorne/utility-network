/**
 * SUN-0900B checkpoint 2D — genuine dynamic-credits sandbox
 * falsification probe.
 *
 * `controlled_sandbox_capability_probe`: NOT `document_evidence_json.v1`
 * registration, NOT a SITEBORNE service sale, NOT revenue. Registers a
 * new, clearly-labeled, sacrificial capability-probe agent/plan — never
 * bound to the real document service — using a genuine multi-credit
 * `getDynamicCreditsConfig(9000n, 1000n, 9000n)` (NOT the already-
 * disproven PAYG 1/1/1 shape), then verifies at the plan ceiling and
 * settles for strictly less, to determine the real backend economics:
 * direct monetary settlement, a prepaid credit pool, or something else.
 *
 * Gated by its own env var — deliberately NOT `RUN_LIVE_NEVERMINED`:
 *
 *   describe.skipIf(process.env.NEVERMINED_PROBE_DYNAMIC_CREDITS !== '1')
 *
 * Requires: NVM_API_KEY (builder — registration, facilitator verify/
 * settle, read-only reconciliation), NVM_SUBSCRIBER_API_KEY (subscriber
 * — delegation, token, balance reads).
 *
 * Maximum intended monetary exposure: 9000 atomic Base Sepolia USDC
 * (~$0.009) — the plan's registered price, one order of magnitude
 * below the eventual real document ceiling.
 *
 * RESULT (this checkpoint's single authorized run; probe agent
 * 70472096713434833149894229528096629615124196288479262107104377773917
 * 156625684, plan 8172901524734398563298517501642499879215477046649241
 * 4367405822651423790551242, tx 0xe0a6932e33eb6e4dc0eaeca5e7c51dc0899a
 * 2212c45781f4d877b8f3399d36ca): `pricePerCredit` read back as exactly
 * `0.000001` (1 atomic USDC per credit, matching the prediction
 * exactly). The settle response reported `creditsRedeemed: '1000'`,
 * `remainingBalance: '8000'` — exactly `9000 - 1000`. The real on-chain
 * transfer was **9000** atomic USDC (an automatic plan-purchase/top-up,
 * split 8910/90 exactly as every prior settlement), not 1000.
 * Classification: `PREPAID_DYNAMIC_CREDITS_SUPPORTED` (matrix item B) —
 * the textbook prepaid-pool signature. Do not rerun this probe; see
 * docs/reports/SUN-0900B-checkpoint-2d-dynamic-credits-live-probe.md.
 *
 * `controlled_sandbox_self_test`: independent_customer=false, revenue=false,
 * open_market_purchase=false, production_ready=false, production_enabled=false.
 */
import { describe, expect, it } from 'vitest';
import { Payments, PaymentsError, buildPaymentRequired } from '@nevermined-io/payments';
import {
  reconcileNeverminedDelegation,
  reconcileNeverminedRegistration,
  type NeverminedRegistryClient,
} from '@siteborne/protocol-nevermined';

const SELLER_ADDRESS = '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1' as const;
const BASE_SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const;
const NETWORK = 'eip155:84532';
const PROBE_AGENT_NAME = 'SITEBORNE Dynamic Credits Capability Probe';
const PROBE_PLAN_NAME = 'SITEBORNE Dynamic Credits Capability Probe — plan';
const PROBE_ENDPOINT = '/v1/nevermined/_probe/dynamic-credits-capability';

describe.skipIf(process.env.NEVERMINED_PROBE_DYNAMIC_CREDITS !== '1')(
  'SUN-0900B checkpoint 2D — genuine dynamic-credits capability probe (verify=9000, settle=1000, plan price=9000, credits=9000)',
  () => {
    it('reconciles/registers a sacrificial probe plan, reads back economics, verifies+settles once, reconciles external state', async () => {
      const apiKey = process.env.NVM_API_KEY;
      const subscriberApiKey = process.env.NVM_SUBSCRIBER_API_KEY;
      if (!apiKey) throw new Error('NVM_API_KEY must be set (builder credential)');
      if (!subscriberApiKey) throw new Error('NVM_SUBSCRIBER_API_KEY must be set');

      const builder = Payments.getInstance({ nvmApiKey: apiKey });
      const subscriber = Payments.getInstance({ nvmApiKey: subscriberApiKey });

      // ---------------------------------------------------------------
      // STEP 4/5: sanitized preview of the exact configuration, using
      // the installed SDK's own helpers — never hand-constructed.
      // ---------------------------------------------------------------
      const priceConfig = builder.plans.getERC20PriceConfig(
        9000n,
        BASE_SEPOLIA_USDC,
        SELLER_ADDRESS
      );
      const creditsConfig = builder.plans.getDynamicCreditsConfig(9000n, 1000n, 9000n);
      // eslint-disable-next-line no-console
      console.log('Probe priceConfig (sanitized):', {
        amounts: priceConfig.amounts.map(String),
        receivers: priceConfig.receivers,
        tokenAddress: priceConfig.tokenAddress,
      });
      // eslint-disable-next-line no-console
      console.log('Probe creditsConfig (sanitized):', {
        isRedemptionAmountFixed: creditsConfig.isRedemptionAmountFixed,
        amount: String(creditsConfig.amount),
        minAmount: String(creditsConfig.minAmount),
        maxAmount: String(creditsConfig.maxAmount),
        durationSecs: String(creditsConfig.durationSecs),
      });
      expect(creditsConfig).toMatchObject({
        isRedemptionAmountFixed: false,
        amount: 9000n,
        minAmount: 1000n,
        maxAmount: 9000n,
      });

      // ---------------------------------------------------------------
      // STEP 7: reconcile-first. Never register blindly.
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
        agentName: PROBE_AGENT_NAME,
        planName: PROBE_PLAN_NAME,
      });
      // eslint-disable-next-line no-console
      console.log('Probe registration reconciliation (sanitized):', {
        state: reconciliation.state,
      });

      let agentId: string;
      let planId: string;
      if (reconciliation.state === 'existing') {
        agentId = reconciliation.agentId;
        planId = reconciliation.planId;
      } else if (reconciliation.state === 'absent') {
        const registered = await builder.agents.registerAgentAndPlan(
          {
            name: PROBE_AGENT_NAME,
            description:
              'Sandbox capability probe — never bound to a real SITEBORNE service. Not for production use.',
          },
          { endpoints: [{ POST: `https://utility.siteborne.net${PROBE_ENDPOINT}` }] },
          { name: PROBE_PLAN_NAME, accessLimit: 'credits' },
          priceConfig,
          creditsConfig,
          'credits'
        );
        agentId = registered.agentId;
        planId = registered.planId;
        // eslint-disable-next-line no-console
        console.log('Probe agent/plan registered (sanitized): registration_performed=true');
      } else {
        throw new Error(
          `probe: registration reconciliation did not resolve to 'existing' or 'absent' (got "${reconciliation.state}") — refusing to guess.`
        );
      }
      expect(agentId).toBeTruthy();
      expect(planId).toBeTruthy();

      // ---------------------------------------------------------------
      // STEP 8: read-back — require exact match, never trust the
      // registration call's own return value alone.
      // ---------------------------------------------------------------
      const readPlan = (await builder.plans.getPlan(planId)) as {
        metadata?: { main?: { name?: string }; plan?: { isTrialPlan?: boolean } };
        registry?: {
          price?: { amounts?: (string | bigint)[]; receivers?: string[]; tokenAddress?: string };
          credits?: {
            isRedemptionAmountFixed?: boolean;
            amount?: string | bigint;
            minAmount?: string | bigint;
            maxAmount?: string | bigint;
          };
        };
      };
      const registryPrice = readPlan.registry?.price;
      const registryCredits = readPlan.registry?.credits;
      const totalPrice = (registryPrice?.amounts ?? []).reduce(
        (sum: bigint, a: string | bigint) => sum + BigInt(a),
        0n
      );
      // eslint-disable-next-line no-console
      console.log('Probe plan read-back (sanitized):', {
        plan_name: readPlan.metadata?.main?.name,
        total_price_atomic: String(totalPrice),
        receiver: registryPrice?.receivers?.[0],
        token: registryPrice?.tokenAddress,
        credits_amount:
          registryCredits?.amount !== undefined ? String(registryCredits.amount) : undefined,
        credits_min:
          registryCredits?.minAmount !== undefined ? String(registryCredits.minAmount) : undefined,
        credits_max:
          registryCredits?.maxAmount !== undefined ? String(registryCredits.maxAmount) : undefined,
        is_redemption_fixed: registryCredits?.isRedemptionAmountFixed,
        is_trial: readPlan.metadata?.plan?.isTrialPlan,
      });
      expect(totalPrice).toBe(9000n);
      expect(registryPrice?.receivers?.[0]).toBe(SELLER_ADDRESS);
      expect(registryPrice?.tokenAddress?.toLowerCase()).toBe(BASE_SEPOLIA_USDC.toLowerCase());
      expect(registryCredits?.isRedemptionAmountFixed).toBe(false);
      expect(String(registryCredits?.amount)).toBe('9000');
      expect(String(registryCredits?.minAmount)).toBe('1000');
      expect(String(registryCredits?.maxAmount)).toBe('9000');
      expect(readPlan.metadata?.plan?.isTrialPlan).not.toBe(true);

      // ---------------------------------------------------------------
      // STEP 9: starting balance / pricePerCredit — read-only,
      // BEFORE any order/verify/settle. This alone tests the
      // pricePerCredit = price / creditsGranted hypothesis.
      // ---------------------------------------------------------------
      const subscriberAddress = subscriber.getAccountAddress() as `0x${string}` | undefined;
      expect(subscriberAddress).toBeTruthy();
      const startingBalance = await builder.plans.getPlanBalance(planId, subscriberAddress);
      // eslint-disable-next-line no-console
      console.log('Subscriber starting balance (sanitized):', {
        balance: String(startingBalance.balance),
        pricePerCredit: startingBalance.pricePerCredit,
        isSubscriber: startingBalance.isSubscriber,
      });
      // Predicted (not asserted — logged only, so an unexpected value
      // doesn't abort the run after a real registration already
      // happened): pricePerCredit = 0.009 (plan USD price) / 9000
      // (credits granted) = 0.000001 = exactly 1 atomic USDC (6
      // decimals) per credit, IF that hypothesis holds.
      // eslint-disable-next-line no-console
      console.log('Hypothesis check (not asserted):', {
        predicted_price_per_credit: 0.000001,
        actual_price_per_credit: startingBalance.pricePerCredit,
        matches_prediction: Math.abs(startingBalance.pricePerCredit - 0.000001) < 1e-9,
      });

      // ---------------------------------------------------------------
      // Delegation: reconcile read-only FIRST (subscriber key).
      // ---------------------------------------------------------------
      const nowIso = new Date().toISOString();
      const delegationPolicy = {
        provider: 'erc4337' as const,
        currency: 'usdc',
        activeStatuses: ['active'],
        minRemainingBudgetCents: 1,
        notExpiredAsOfIso: nowIso,
      };
      const delegationListClient = {
        listDelegations: async () => {
          const result = await subscriber.delegation.listDelegations({ accessible: true });
          return {
            delegations: result.delegations.map((d) => ({
              delegationId: d.delegationId,
              provider: d.provider,
              status: d.status,
              currency: d.currency,
              spendingLimitCents: d.spendingLimitCents,
              remainingBudgetCents: d.remainingBudgetCents,
              amountSpentCents: d.amountSpentCents,
              expiresAt: d.expiresAt,
            })),
          };
        },
      };
      const delegationReconciliation = await reconcileNeverminedDelegation(
        delegationListClient,
        delegationPolicy
      );
      // eslint-disable-next-line no-console
      console.log('Probe delegation reconciliation (sanitized):', {
        state: delegationReconciliation.state,
      });

      let delegationId: string;
      if (delegationReconciliation.state === 'exact_existing') {
        delegationId = delegationReconciliation.delegationId;
      } else if (delegationReconciliation.state === 'no_match') {
        let created: Awaited<ReturnType<typeof subscriber.delegation.createDelegation>>;
        try {
          created = await subscriber.delegation.createDelegation({
            provider: 'erc4337',
            spendingLimitCents: 1, // rounds up from $0.009 — same ceiling proven sufficient for the identical-scale web plan
            durationSecs: 3_600,
            currency: 'usdc',
            planId,
          });
        } catch (e) {
          if (e instanceof PaymentsError) {
            // eslint-disable-next-line no-console
            console.error('Probe createDelegation failure (sanitized):', {
              code: e.code,
              message: e.message,
            });
          }
          throw e;
        }
        delegationId = created.delegationId;
      } else {
        throw new Error(
          `probe: delegation reconciliation did not resolve to 'exact_existing' or 'no_match' (got "${delegationReconciliation.state}") — refusing to create another.`
        );
      }
      expect(delegationId).toBeTruthy();

      const delegationReadBack = await reconcileNeverminedDelegation(
        delegationListClient,
        { ...delegationPolicy, notExpiredAsOfIso: new Date().toISOString() },
        { backoffScheduleMs: [0, 2_000, 5_000, 10_000] }
      );
      if (
        delegationReadBack.state !== 'exact_existing' ||
        delegationReadBack.delegationId !== delegationId
      ) {
        throw new Error(
          `probe: delegation ${delegationId} did not read back as exact_existing (got "${delegationReadBack.state}") — preserving created state.`
        );
      }

      // ---------------------------------------------------------------
      // Ephemeral token, verify(9000), settle(1000) — exactly once.
      // ---------------------------------------------------------------
      const tokenResult = await subscriber.x402.getX402AccessToken(planId, agentId, {
        delegationConfig: { delegationId },
      });
      const accessToken = tokenResult.accessToken;
      expect(accessToken).toBeTruthy();

      const paymentRequired = buildPaymentRequired(planId, {
        endpoint: PROBE_ENDPOINT,
        agentId,
        httpVerb: 'POST',
        network: NETWORK,
      });

      const verification = await builder.facilitator.verifyPermissions({
        paymentRequired,
        x402AccessToken: accessToken,
        maxAmount: 9000n,
      });
      // eslint-disable-next-line no-console
      console.log('Probe verify result (sanitized):', {
        isValid: verification.isValid,
        invalidReason: verification.invalidReason,
      });
      expect(verification.isValid).toBe(true);

      const settlement = await builder.facilitator.settlePermissions({
        paymentRequired,
        x402AccessToken: accessToken,
        maxAmount: 1000n,
      });
      // eslint-disable-next-line no-console
      console.log('Probe settle response (sanitized):', {
        success: settlement.success,
        errorReason: settlement.errorReason,
        transaction: settlement.transaction,
        creditsRedeemed: settlement.creditsRedeemed,
        remainingBalance: settlement.remainingBalance,
      });

      // ---------------------------------------------------------------
      // Post-settle balance — read-only. The key evidence
      // distinguishing A (direct settlement, balance concept doesn't
      // apply / stays at 0) from B (prepaid pool: balance goes to
      // 9000 - 1000 = 8000 IF an automatic top-up occurred).
      // ---------------------------------------------------------------
      const finalBalance = await builder.plans.getPlanBalance(planId, subscriberAddress);
      // eslint-disable-next-line no-console
      console.log('Subscriber final balance (sanitized):', {
        balance: String(finalBalance.balance),
        pricePerCredit: finalBalance.pricePerCredit,
        isSubscriber: finalBalance.isSubscriber,
      });

      // ---------------------------------------------------------------
      // Read-only external reconciliation (seller key).
      // ---------------------------------------------------------------
      async function sellerGet(path: string): Promise<unknown> {
        const url = new URL(path, 'https://api.sandbox.nevermined.app/');
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'Nevermined-Version': '1.1',
          },
        });
        if (!res.ok) throw new Error(`probe_reconciliation_http_${res.status}`);
        return res.json();
      }
      const delegationRead = (await sellerGet(
        `/api/v1/delegation/${encodeURIComponent(delegationId)}`
      )) as Record<string, unknown>;
      const transactionsRead = (await sellerGet(
        `/api/v1/delegation/${encodeURIComponent(delegationId)}/transactions`
      )) as { transactions?: Array<Record<string, unknown>> };
      const transactions = transactionsRead.transactions ?? [];
      const succeeded = transactions.filter((t) => t.status === 'succeeded');

      // eslint-disable-next-line no-console
      console.log('Probe external reconciliation (sanitized):', {
        delegation_status: delegationRead.status,
        transaction_count: transactions.length,
        succeeded_count: succeeded.length,
        transactions: succeeded.map((t) => ({
          providerTransactionId: t.providerTransactionId,
          amountCents: t.amountCents,
          status: t.status,
          createdAt: t.createdAt,
        })),
      });

      if (succeeded.length === 0) {
        // eslint-disable-next-line no-console
        console.log('PROBE CLASSIFICATION: NOT_SETTLED — no succeeded transaction found.');
      } else if (succeeded.length > 1) {
        // eslint-disable-next-line no-console
        console.log(
          'PROBE CLASSIFICATION: EXTERNAL_INCONSISTENCY — more than one succeeded transaction.'
        );
      } else {
        // eslint-disable-next-line no-console
        console.log(
          'PROBE CLASSIFICATION: exactly one succeeded transaction. Public reference (sanitized):',
          {
            providerTransactionId: succeeded[0]!.providerTransactionId,
          }
        );
      }
      expect(succeeded.length).toBeLessThanOrEqual(1);

      // eslint-disable-next-line no-console
      console.log(
        'PROBE COMPLETE. registration_mutations<=1 delegation_creations<=1 tokens=1 verify=1 settle=1',
        { agentId, planId, delegationId }
      );
    }, 150_000);
  }
);
