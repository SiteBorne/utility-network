import { describe, expect, it } from 'vitest';
import { SUN_0900B_COMPANY_REGISTRATION } from './checkpoint-fixture';
import { NEVERMINED_DECLARATIONS } from './declarations';
import {
  reconcileNeverminedFixedPaygRegistration,
  validateNeverminedFixedPaygPlan,
} from './fixed-payg-plan-validator';
import type {
  NeverminedAgentReadback,
  NeverminedPlanReadback,
} from './document-dynamic-plan-validator';
import type { NeverminedRegistrationReconciliation } from './registry-reconciliation';

const SERVICE_ID = 'company_evidence_graph.v1' as const;
const AGENT_ID = 'agent-company';
const PLAN_ID = 'plan-company';
const SELLER = '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1';
const PLATFORM = '0x2020949c1B565421AC21b76e70340266c4CA9A90';
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

function validAgent(): NeverminedAgentReadback {
  return {
    id: AGENT_ID,
    metadata: {
      main: { name: 'Company Evidence Graph' },
      agent: {
        endpoints: [{ POST: 'https://utility.siteborne.net/v1/nevermined/company/evidence-graph' }],
      },
    },
    registry: { plans: [PLAN_ID] },
  };
}

function validPlan(): NeverminedPlanReadback {
  return {
    id: PLAN_ID,
    metadata: {
      main: { name: 'Company Evidence Graph — PAYG plan' },
      plan: {
        accessLimit: 'credits',
        isTrialPlan: false,
        recurringSubscription: false,
      },
    },
    registry: {
      price: {
        amounts: ['38610', '390'],
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

describe('validateNeverminedFixedPaygPlan', () => {
  it('freezes the accepted company registration IDs and public economics', () => {
    expect(SUN_0900B_COMPANY_REGISTRATION).toEqual({
      service_id: 'company_evidence_graph.v1',
      environment: 'sandbox',
      network: 'eip155:84532',
      scheme: 'nvm:erc4337',
      agent_id: '63058244394774357835944659628164807563769006924765007721830897155339294179447',
      plan_id: '61176543225966665382887590264143689398477975837289843272089835781341158489584',
      agent_name: 'Company Evidence Graph',
      plan_name: 'Company Evidence Graph — PAYG plan',
      gross_buyer_amount_atomic: '39000',
      seller_receiver: SELLER,
      asset_token_address: USDC,
      is_trial_plan: false,
      billing_model: 'pay-as-you-go',
    });
  });

  it('accepts the exact company agent and authoritative fixed PAYG read-back', () => {
    expect(validateNeverminedFixedPaygPlan(SERVICE_ID, validAgent(), validPlan())).toEqual({
      valid: true,
    });
  });

  it('rejects wrong agent identity, plan identity, endpoint, and linkage', () => {
    const wrongAgent = validAgent();
    wrongAgent.metadata!.main!.name = 'Other Agent';
    expectInvalid(wrongAgent, validPlan());

    const wrongPlanName = validPlan();
    wrongPlanName.metadata!.main!.name = 'Other Plan';
    expectInvalid(validAgent(), wrongPlanName);

    const wrongEndpoint = validAgent();
    wrongEndpoint.metadata!.agent!.endpoints = [{ POST: 'https://example.com/wrong' }];
    expectInvalid(wrongEndpoint, validPlan());

    const missingLink = validAgent();
    missingLink.registry = { plans: [] };
    expectInvalid(missingLink, validPlan());
  });

  it.each([[['38609', '390']], [['38611', '390']], [['0', '0']], [['12000', '0']]] as const)(
    'rejects wrong or free price amounts %j',
    (amounts) => {
      const plan = validPlan();
      plan.registry!.price!.amounts = amounts;
      expectInvalid(validAgent(), plan);
    }
  );

  it('rejects wrong token, seller, platform receiver, and receiver/amount cardinality', () => {
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

    const missingReceiver = validPlan();
    missingReceiver.registry!.price!.receivers = [SELLER];
    expectInvalid(validAgent(), missingReceiver);

    const extraReceiver = validPlan();
    extraReceiver.registry!.price!.amounts = ['38000', '500', '500'];
    extraReceiver.registry!.price!.receivers = [SELLER, PLATFORM, PLATFORM];
    expectInvalid(validAgent(), extraReceiver);
  });

  it('rejects trial, recurring, time-access, and non-crypto plans', () => {
    const trial = validPlan();
    trial.metadata!.plan!.isTrialPlan = true;
    expectInvalid(validAgent(), trial);

    const recurring = validPlan();
    recurring.metadata!.plan!.recurringSubscription = true;
    expectInvalid(validAgent(), recurring);

    const timeAccess = validPlan();
    timeAccess.metadata!.plan!.accessLimit = 'time';
    expectInvalid(validAgent(), timeAccess);

    const nonCrypto = validPlan();
    nonCrypto.registry!.price!.isCrypto = false;
    expectInvalid(validAgent(), nonCrypto);
  });

  it('rejects document dynamic-credit and fixed-credit configurations', () => {
    const documentDynamic = validPlan();
    Object.assign(documentDynamic.registry!.credits!, {
      amount: '190000',
      minAmount: '12000',
      maxAmount: '190000',
      isRedemptionAmountFixed: false,
    });
    expectInvalid(validAgent(), documentDynamic);

    const fixedCredits = validPlan();
    fixedCredits.registry!.credits!.isRedemptionAmountFixed = true;
    expectInvalid(validAgent(), fixedCredits);
  });

  it('rejects malformed, fractional, unsafe, negative, and unknown read-back shapes', () => {
    for (const malformed of [1.5, Number.NaN, Number.POSITIVE_INFINITY, 9_007_199_254_740_992]) {
      const plan = validPlan();
      plan.registry!.price!.amounts = [malformed, '390'];
      expectInvalid(validAgent(), plan);
    }

    for (const malformed of ['01', '-1', '1.0', ' 1']) {
      const plan = validPlan();
      plan.registry!.credits!.amount = malformed;
      expectInvalid(validAgent(), plan);
    }

    expectInvalid({} as NeverminedAgentReadback, {} as NeverminedPlanReadback);
  });

  it('keeps the other three declarations and document dynamic model unchanged', () => {
    expect(NEVERMINED_DECLARATIONS['web_context_verified.v1'].plan).toMatchObject({
      gross_buyer_amount_atomic: '9000',
      siteborne_payment_semantics: 'exact',
      dynamic_actual_settlement_required: false,
    });
    expect(NEVERMINED_DECLARATIONS['verify_agent_output.v1'].plan).toMatchObject({
      gross_buyer_amount_atomic: '19000',
      siteborne_payment_semantics: 'exact',
      dynamic_actual_settlement_required: false,
    });
    expect(NEVERMINED_DECLARATIONS['document_evidence_json.v1'].plan).toMatchObject({
      gross_buyer_amount_atomic: '190000',
      siteborne_payment_semantics: 'upto',
      actual_tiers_atomic: { native: '12000', ocr: '19000', table: '29000' },
      sandbox_capability_verified: true,
      dynamic_live_allowed: true,
    });
  });
});

describe('reconcileNeverminedFixedPaygRegistration', () => {
  it('returns EXACT_EXISTING only when identity, linkage, and economics all validate', () => {
    expect(
      reconcileNeverminedFixedPaygRegistration(
        SERVICE_ID,
        { state: 'existing', agentId: AGENT_ID, planId: PLAN_ID, registeredThisCall: false },
        validAgent(),
        validPlan()
      )
    ).toEqual({ state: 'EXACT_EXISTING', agentId: AGENT_ID, planId: PLAN_ID });
  });

  it('returns CONFLICT for a matching identity with wrong economics', () => {
    const wrong = validPlan();
    wrong.registry!.price!.amounts = ['38609', '390'];
    expect(
      reconcileNeverminedFixedPaygRegistration(
        SERVICE_ID,
        { state: 'existing', agentId: AGENT_ID, planId: PLAN_ID, registeredThisCall: false },
        validAgent(),
        wrong
      )
    ).toMatchObject({ state: 'CONFLICT' });
  });

  it('maps proven absence to NO_MATCH and every ambiguous registry state to CONFLICT', () => {
    expect(reconcileNeverminedFixedPaygRegistration(SERVICE_ID, { state: 'absent' })).toEqual({
      state: 'NO_MATCH',
    });
    const ambiguousStates: NeverminedRegistrationReconciliation[] = [
      { state: 'partial', detail: 'agent_without_plan' },
      { state: 'conflicting', agentIds: ['a'], planIds: ['p'] },
      { state: 'timeout', agentId: undefined, planId: undefined },
    ];
    for (const state of ambiguousStates) {
      expect(reconcileNeverminedFixedPaygRegistration(SERVICE_ID, state)).toMatchObject({
        state: 'CONFLICT',
      });
    }
  });

  it('rejects the document service at this fixed-plan boundary', () => {
    expect(() =>
      reconcileNeverminedFixedPaygRegistration('document_evidence_json.v1', { state: 'absent' })
    ).toThrow(/fixed PAYG/);
  });
});
