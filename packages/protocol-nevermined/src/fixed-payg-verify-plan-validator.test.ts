import { describe, expect, it } from 'vitest';
import * as checkpointFixtures from './checkpoint-fixture';
import { NEVERMINED_DECLARATIONS } from './declarations';
import type {
  NeverminedAgentReadback,
  NeverminedPlanReadback,
} from './document-dynamic-plan-validator';
import {
  reconcileNeverminedFixedPaygRegistration,
  resolveNeverminedFixedPaygPlanRequirements,
  validateNeverminedFixedPaygPlan,
} from './fixed-payg-plan-validator';

const SERVICE_ID = 'verify_agent_output.v1' as const;
const AGENT_ID = 'agent-verify';
const PLAN_ID = 'plan-verify';
const SELLER = '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1';
const PLATFORM = '0x2020949c1B565421AC21b76e70340266c4CA9A90';
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

function validAgent(): NeverminedAgentReadback {
  return {
    id: AGENT_ID,
    metadata: {
      main: { name: 'Agent Output Verification' },
      agent: {
        endpoints: [{ POST: 'https://utility.siteborne.net/v1/nevermined/verify/agent-output' }],
      },
    },
    registry: { plans: [PLAN_ID] },
  };
}

function validPlan(): NeverminedPlanReadback {
  return {
    id: PLAN_ID,
    metadata: {
      main: { name: 'Agent Output Verification — PAYG plan' },
      plan: {
        accessLimit: 'credits',
        isTrialPlan: false,
        recurringSubscription: false,
      },
    },
    registry: {
      price: {
        amounts: ['18810', '190'],
        receivers: [SELLER, PLATFORM],
        tokenAddress: USDC,
        isCrypto: true,
      },
      credits: {
        amount: '1',
        minAmount: '1',
        maxAmount: '1',
        isRedemptionAmountFixed: false,
        redemptionType: 4,
        onchainMirror: false,
        durationSecs: '0',
      },
    },
  };
}

function expectInvalid(agent: NeverminedAgentReadback, plan: NeverminedPlanReadback): void {
  expect(validateNeverminedFixedPaygPlan(SERVICE_ID, agent, plan)).toMatchObject({
    valid: false,
  });
}

describe('verify_agent_output.v1 fixed PAYG validation', () => {
  it('freezes the accepted verify registration IDs and public economics', () => {
    expect(checkpointFixtures).toHaveProperty('SUN_0900B_VERIFY_REGISTRATION', {
      service_id: 'verify_agent_output.v1',
      environment: 'sandbox',
      network: 'eip155:84532',
      scheme: 'nvm:erc4337',
      agent_id: '75096875289866166059253207097165867959384005104090226106621988801798698661167',
      plan_id: '106105151389083481380363516765690985250481102170794631056207896452064676707220',
      agent_name: 'Agent Output Verification',
      plan_name: 'Agent Output Verification — PAYG plan',
      gross_buyer_amount_atomic: '19000',
      seller_receiver: SELLER,
      asset_token_address: USDC,
      is_trial_plan: false,
      billing_model: 'pay-as-you-go',
    });
  });

  it('derives the canonical verify identity and exact 19000-atomic economics', () => {
    expect(resolveNeverminedFixedPaygPlanRequirements(SERVICE_ID)).toEqual({
      service_id: 'verify_agent_output.v1',
      agent_name: 'Agent Output Verification',
      plan_name: 'Agent Output Verification — PAYG plan',
      endpoint: 'https://utility.siteborne.net/v1/nevermined/verify/agent-output',
      gross_price_atomic: 19000n,
      seller_net_atomic: 18810n,
      platform_fee_atomic: 190n,
    });
  });

  it('accepts the exact authoritative verify PAYG read-back', () => {
    expect(validateNeverminedFixedPaygPlan(SERVICE_ID, validAgent(), validPlan())).toEqual({
      valid: true,
    });
  });

  it('rejects wrong agent, plan, endpoint, and linkage identity', () => {
    const wrongAgent = validAgent();
    wrongAgent.metadata!.main!.name = 'Other Agent';
    expectInvalid(wrongAgent, validPlan());

    const wrongPlan = validPlan();
    wrongPlan.metadata!.main!.name = 'Other Plan';
    expectInvalid(validAgent(), wrongPlan);

    const wrongEndpoint = validAgent();
    wrongEndpoint.metadata!.agent!.endpoints = [{ POST: 'https://example.com/wrong' }];
    expectInvalid(wrongEndpoint, validPlan());

    const missingLink = validAgent();
    missingLink.registry = { plans: [] };
    expectInvalid(missingLink, validPlan());
  });

  it.each([[['18809', '190']], [['18811', '190']], [['0', '0']], [['19000', '0']]] as const)(
    'rejects wrong or free verify price amounts %j',
    (amounts) => {
      const plan = validPlan();
      plan.registry!.price!.amounts = amounts;
      expectInvalid(validAgent(), plan);
    }
  );

  it('rejects wrong token, seller, platform receiver, and price cardinality', () => {
    const wrongToken = validPlan();
    wrongToken.registry!.price!.tokenAddress = '0x0000000000000000000000000000000000000001';
    expectInvalid(validAgent(), wrongToken);

    const wrongSeller = validPlan();
    wrongSeller.registry!.price!.receivers = [
      '0x0000000000000000000000000000000000000002',
      PLATFORM,
    ];
    expectInvalid(validAgent(), wrongSeller);

    const wrongPlatform = validPlan();
    wrongPlatform.registry!.price!.receivers = [
      SELLER,
      '0x0000000000000000000000000000000000000003',
    ];
    expectInvalid(validAgent(), wrongPlatform);

    const malformedCardinality = validPlan();
    malformedCardinality.registry!.price!.amounts = ['19000'];
    malformedCardinality.registry!.price!.receivers = [SELLER];
    expectInvalid(validAgent(), malformedCardinality);
  });

  it('rejects trial, recurring, wrong-access, and non-crypto plans', () => {
    const trial = validPlan();
    trial.metadata!.plan!.isTrialPlan = true;
    expectInvalid(validAgent(), trial);

    const recurring = validPlan();
    recurring.metadata!.plan!.recurringSubscription = true;
    expectInvalid(validAgent(), recurring);

    const wrongAccess = validPlan();
    wrongAccess.metadata!.plan!.accessLimit = 'time';
    expectInvalid(validAgent(), wrongAccess);

    const nonCrypto = validPlan();
    nonCrypto.registry!.price!.isCrypto = false;
    expectInvalid(validAgent(), nonCrypto);
  });

  it('rejects document dynamic credits and fixed-credit substitutions', () => {
    const documentDynamic = validPlan();
    Object.assign(documentDynamic.registry!.credits!, {
      amount: '190000',
      minAmount: '12000',
      maxAmount: '190000',
    });
    expectInvalid(validAgent(), documentDynamic);

    const fixedCredits = validPlan();
    fixedCredits.registry!.credits!.isRedemptionAmountFixed = true;
    expectInvalid(validAgent(), fixedCredits);
  });

  it('rejects malformed and unknown read-back shapes', () => {
    const fractional = validPlan();
    fractional.registry!.price!.amounts = [18810.5, '190'];
    expectInvalid(validAgent(), fractional);

    const unsafe = validPlan();
    unsafe.registry!.credits!.amount = 9_007_199_254_740_992;
    expectInvalid(validAgent(), unsafe);

    expectInvalid({} as NeverminedAgentReadback, {} as NeverminedPlanReadback);
  });

  it('returns EXACT_EXISTING only for exact verify identity and economics', () => {
    const reconciliation = {
      state: 'existing' as const,
      agentId: AGENT_ID,
      planId: PLAN_ID,
      registeredThisCall: false as const,
    };
    expect(
      reconcileNeverminedFixedPaygRegistration(
        SERVICE_ID,
        reconciliation,
        validAgent(),
        validPlan()
      )
    ).toEqual({ state: 'EXACT_EXISTING', agentId: AGENT_ID, planId: PLAN_ID });

    const wrongEconomics = validPlan();
    wrongEconomics.registry!.price!.amounts = ['18809', '190'];
    expect(
      reconcileNeverminedFixedPaygRegistration(
        SERVICE_ID,
        reconciliation,
        validAgent(),
        wrongEconomics
      )
    ).toMatchObject({ state: 'CONFLICT' });
  });

  it('preserves company, web, and document declaration semantics', () => {
    expect(NEVERMINED_DECLARATIONS['company_evidence_graph.v1'].plan).toMatchObject({
      gross_buyer_amount_atomic: '39000',
      siteborne_payment_semantics: 'exact',
    });
    expect(NEVERMINED_DECLARATIONS['web_context_verified.v1'].plan).toMatchObject({
      gross_buyer_amount_atomic: '9000',
      siteborne_payment_semantics: 'exact',
    });
    expect(NEVERMINED_DECLARATIONS['document_evidence_json.v1'].plan).toMatchObject({
      gross_buyer_amount_atomic: '190000',
      siteborne_payment_semantics: 'upto',
      sandbox_capability_verified: true,
      dynamic_live_allowed: true,
    });
  });
});
