import { describe, expect, it } from 'vitest';
import { buildSiteborneDiscoveryDeclaration } from '@siteborne/protocol-x402';
import { NEVERMINED_DECLARATIONS } from './declarations';
import {
  computeCreditAcquisitionValueAtomic,
  DOCUMENT_DYNAMIC_PLAN_REQUIREMENTS,
  DOCUMENT_USAGE_TIER_VALUES_ATOMIC,
  reconcileNeverminedDocumentDynamicRegistration,
  validateNeverminedDocumentDynamicPlan,
  type NeverminedAgentReadback,
  type NeverminedPlanReadback,
} from './document-dynamic-plan-validator';

const PLAN_ID = 'plan-document-dynamic';

function validAgent(): NeverminedAgentReadback {
  return {
    id: 'agent-document',
    metadata: {
      main: { name: DOCUMENT_DYNAMIC_PLAN_REQUIREMENTS.agent_name },
      agent: { endpoints: [{ POST: DOCUMENT_DYNAMIC_PLAN_REQUIREMENTS.endpoint }] },
    },
    registry: { plans: [PLAN_ID] },
  };
}

/**
 * Mirrors the authoritative checkpoint-2D GET shape. Nevermined persists
 * the requested 190000-atomic seller price as a 99/1 seller/platform split,
 * exactly as it did for the real 9000-atomic capability probe.
 */
function validPlan(): NeverminedPlanReadback {
  return {
    id: PLAN_ID,
    metadata: {
      main: { name: DOCUMENT_DYNAMIC_PLAN_REQUIREMENTS.plan_name },
      plan: {
        accessLimit: 'credits',
        isTrialPlan: false,
        recurringSubscription: false,
      },
    },
    registry: {
      price: {
        amounts: ['188100', '1900'],
        receivers: [
          DOCUMENT_DYNAMIC_PLAN_REQUIREMENTS.receiver,
          DOCUMENT_DYNAMIC_PLAN_REQUIREMENTS.platform_fee_receiver,
        ],
        tokenAddress: DOCUMENT_DYNAMIC_PLAN_REQUIREMENTS.token_address,
        isCrypto: true,
      },
      credits: {
        amount: '190000',
        minAmount: '12000',
        maxAmount: '190000',
        isRedemptionAmountFixed: false,
        redemptionType: 4,
        onchainMirror: false,
        durationSecs: '0',
      },
    },
  };
}

function invalidReason(
  agent: NeverminedAgentReadback,
  plan: NeverminedPlanReadback
): string | undefined {
  const result = validateNeverminedDocumentDynamicPlan(agent, plan);
  return result.valid ? undefined : result.reason;
}

describe('validateNeverminedDocumentDynamicPlan', () => {
  it('A: accepts the exact authoritative document dynamic-credit read-back', () => {
    expect(validateNeverminedDocumentDynamicPlan(validAgent(), validPlan())).toEqual({
      valid: true,
    });
  });

  it('B/C: rejects PAYG 1/1/1 and fixed-credit configurations', () => {
    const payg = validPlan();
    Object.assign(payg.registry!.credits!, { amount: '1', minAmount: '1', maxAmount: '1' });
    expect(invalidReason(validAgent(), payg)).toBe('WRONG_CREDITS_GRANTED');

    const fixed = validPlan();
    fixed.registry!.credits!.isRedemptionAmountFixed = true;
    expect(invalidReason(validAgent(), fixed)).toBe('WRONG_REDEMPTION_FIXEDNESS');
  });

  it.each(['189999', '190001', '12000', '0'])('D: rejects wrong price %s', (amount) => {
    const plan = validPlan();
    const total = BigInt(amount);
    plan.registry!.price!.amounts = [
      String(total > 1900n ? total - 1900n : 0n),
      String(total > 1900n ? 1900n : total),
    ];
    expect(invalidReason(validAgent(), plan)).toBe(
      amount === '0' ? 'FREE_PLAN_REJECTED' : 'WRONG_PRICE'
    );
  });

  it.each(['1', '12000', '189999', '190001'])('E: rejects wrong grant %s', (amount) => {
    const plan = validPlan();
    plan.registry!.credits!.amount = amount;
    expect(invalidReason(validAgent(), plan)).toBe('WRONG_CREDITS_GRANTED');
  });

  it.each(['1', '11999', '12001'])('F: rejects wrong minimum %s', (amount) => {
    const plan = validPlan();
    plan.registry!.credits!.minAmount = amount;
    expect(invalidReason(validAgent(), plan)).toBe('WRONG_MINIMUM');
  });

  it.each(['189999', '190001'])('G: rejects wrong maximum %s', (amount) => {
    const plan = validPlan();
    plan.registry!.credits!.maxAmount = amount;
    expect(invalidReason(validAgent(), plan)).toBe('WRONG_MAXIMUM');
  });

  it('H: rejects min > max before classifying either bound independently', () => {
    const plan = validPlan();
    Object.assign(plan.registry!.credits!, { minAmount: '190001', maxAmount: '190000' });
    expect(invalidReason(validAgent(), plan)).toBe('MIN_EXCEEDS_MAX');
  });

  it('I: rejects the wrong token', () => {
    const plan = validPlan();
    plan.registry!.price!.tokenAddress = '0x0000000000000000000000000000000000000001';
    expect(invalidReason(validAgent(), plan)).toBe('WRONG_TOKEN');
  });

  it('J/K/L: rejects wrong, missing, and unexpected price receivers', () => {
    const wrong = validPlan();
    wrong.registry!.price!.receivers = [
      '0x0000000000000000000000000000000000000001',
      DOCUMENT_DYNAMIC_PLAN_REQUIREMENTS.platform_fee_receiver,
    ];
    expect(invalidReason(validAgent(), wrong)).toBe('WRONG_RECEIVER');

    const missing = validPlan();
    missing.registry!.price!.receivers = [];
    expect(invalidReason(validAgent(), missing)).toBe('PRICE_COMPONENT_CARDINALITY_MISMATCH');

    const multiple = validPlan();
    multiple.registry!.price!.amounts = ['188100', '1900', '0'];
    multiple.registry!.price!.receivers = [
      DOCUMENT_DYNAMIC_PLAN_REQUIREMENTS.receiver,
      DOCUMENT_DYNAMIC_PLAN_REQUIREMENTS.platform_fee_receiver,
      '0x0000000000000000000000000000000000000002',
    ];
    expect(invalidReason(validAgent(), multiple)).toBe('PRICE_COMPONENT_CARDINALITY_MISMATCH');
  });

  it('M: rejects wrong endpoint, agent identity, plan identity, and linkage', () => {
    const wrongEndpoint = validAgent();
    wrongEndpoint.metadata!.agent!.endpoints = [{ POST: 'https://example.invalid/wrong' }];
    expect(invalidReason(wrongEndpoint, validPlan())).toBe('WRONG_SERVICE_ENDPOINT');

    const wrongAgent = validAgent();
    wrongAgent.metadata!.main!.name = 'Another Service';
    expect(invalidReason(wrongAgent, validPlan())).toBe('UNEXPECTED_AGENT_IDENTITY');

    const wrongPlan = validPlan();
    wrongPlan.metadata!.main!.name = 'Another Plan';
    expect(invalidReason(validAgent(), wrongPlan)).toBe('UNEXPECTED_PLAN_IDENTITY');

    const unlinked = validAgent();
    unlinked.registry!.plans = ['other-plan'];
    expect(invalidReason(unlinked, validPlan())).toBe('AGENT_PLAN_LINKAGE_MISMATCH');
  });

  it('N/O: rejects trial, time-access, recurring, expirable, mirrored, and wrong redemption plans', () => {
    const trial = validPlan();
    trial.metadata!.plan!.isTrialPlan = true;
    expect(invalidReason(validAgent(), trial)).toBe('TRIAL_PLAN_REJECTED');

    const timeAccess = validPlan();
    timeAccess.metadata!.plan!.accessLimit = 'time';
    expect(invalidReason(validAgent(), timeAccess)).toBe('WRONG_ACCESS_MODEL');

    const recurring = validPlan();
    recurring.metadata!.plan!.recurringSubscription = true;
    expect(invalidReason(validAgent(), recurring)).toBe('RECURRING_PLAN_REJECTED');

    const expirable = validPlan();
    expirable.registry!.credits!.durationSecs = '1';
    expect(invalidReason(validAgent(), expirable)).toBe('TIME_BASED_PLAN_REJECTED');

    const mirrored = validPlan();
    mirrored.registry!.credits!.onchainMirror = true;
    expect(invalidReason(validAgent(), mirrored)).toBe('WRONG_ONCHAIN_MIRROR');

    const wrongRedemption = validPlan();
    wrongRedemption.registry!.credits!.redemptionType = 1;
    expect(invalidReason(validAgent(), wrongRedemption)).toBe('WRONG_REDEMPTION_TYPE');
  });

  it('P: proves exact 1:1 acquisition value and rejects non-integral/non-unit ratios', () => {
    expect(computeCreditAcquisitionValueAtomic(190000n, 190000n)).toEqual({
      ratio: 1n,
      exact: true,
    });
    expect(computeCreditAcquisitionValueAtomic(190000n, 12000n)).toEqual({
      ratio: 0n,
      exact: false,
    });
    expect(computeCreditAcquisitionValueAtomic(380000n, 190000n)).toEqual({
      ratio: 2n,
      exact: true,
    });
    expect(computeCreditAcquisitionValueAtomic(190000n, 0n)).toEqual({
      ratio: 0n,
      exact: false,
    });
    expect(DOCUMENT_USAGE_TIER_VALUES_ATOMIC).toEqual({
      native: 12000n,
      ocr: 19000n,
      table: 29000n,
      maximum: 190000n,
    });
  });

  it.each([
    ['fractional number', 188100.5],
    ['unsafe number', Number.MAX_SAFE_INTEGER + 1],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['fractional string', '188100.5'],
    ['scientific string', '1.881e5'],
    ['leading-zero string', '0188100'],
    ['signed string', '+188100'],
    ['whitespace string', ' 188100'],
  ])('Q: rejects malformed price amount (%s)', (_label, value) => {
    const plan = validPlan();
    plan.registry!.price!.amounts = [value as string | number, '1900'];
    expect(invalidReason(validAgent(), plan)).toBe('MALFORMED_PRICE_AMOUNTS');
  });

  it('Q: rejects malformed credit numbers instead of truncating or coercing', () => {
    for (const value of [190000.1, Number.NaN, Number.POSITIVE_INFINITY, '190000.0', '0190000']) {
      const plan = validPlan();
      plan.registry!.credits!.amount = value;
      expect(invalidReason(validAgent(), plan)).toBe('MALFORMED_CREDITS_CONFIG');
    }
  });

  it('R: rejects unknown/malformed load-bearing read-back shapes', () => {
    const cases: Array<[NeverminedAgentReadback, NeverminedPlanReadback, string]> = [
      [{}, validPlan(), 'MISSING_AGENT_ID'],
      [validAgent(), {}, 'MISSING_PLAN_ID'],
      [validAgent(), { ...validPlan(), metadata: undefined }, 'MISSING_PLAN_METADATA'],
      [validAgent(), { ...validPlan(), registry: undefined }, 'MISSING_PRICE_CONFIG'],
      [{ ...validAgent(), registry: undefined }, validPlan(), 'MISSING_AGENT_PLAN_LINKAGE'],
    ];
    for (const [agent, plan, reason] of cases) {
      expect(invalidReason(agent, plan)).toBe(reason);
    }
  });

  it('S/T: registration reconciliation distinguishes exact existing from identity-matched economic conflict', () => {
    const exact = reconcileNeverminedDocumentDynamicRegistration(
      {
        state: 'existing',
        agentId: validAgent().id!,
        planId: PLAN_ID,
        registeredThisCall: false,
      },
      validAgent(),
      validPlan()
    );
    expect(exact).toEqual({ state: 'EXACT_EXISTING', agentId: 'agent-document', planId: PLAN_ID });

    const wrongEconomics = validPlan();
    wrongEconomics.registry!.credits!.minAmount = '12001';
    expect(
      reconcileNeverminedDocumentDynamicRegistration(
        {
          state: 'existing',
          agentId: validAgent().id!,
          planId: PLAN_ID,
          registeredThisCall: false,
        },
        validAgent(),
        wrongEconomics
      )
    ).toEqual({ state: 'CONFLICT', reason: 'WRONG_MINIMUM' });
  });

  it('maps positive full-schedule absence to NO_MATCH and every ambiguous registry state to CONFLICT', () => {
    expect(reconcileNeverminedDocumentDynamicRegistration({ state: 'absent' })).toEqual({
      state: 'NO_MATCH',
    });
    expect(
      reconcileNeverminedDocumentDynamicRegistration({
        state: 'partial',
        detail: 'agent_without_plan',
      })
    ).toEqual({ state: 'CONFLICT', reason: 'REGISTRY_PARTIAL' });
    expect(
      reconcileNeverminedDocumentDynamicRegistration({
        state: 'timeout',
        agentId: 'agent-document',
        planId: PLAN_ID,
      })
    ).toEqual({ state: 'CONFLICT', reason: 'REGISTRY_TIMEOUT' });
  });

  it('U: fixed Nevermined service declarations match their governed version-specific prices', () => {
    // SUN-1000 checkpoint 1M / SUN-1222C-R3: excludes both
    // document_evidence_json majors (its dynamic plan is this suite's own
    // subject, tested separately below). All four v2 services now carry
    // dedicated, isolated experiment prices; v1 remains unchanged.
    expect(
      Object.fromEntries(
        Object.entries(NEVERMINED_DECLARATIONS)
          .filter(([id]) => !id.startsWith('document_evidence_json.'))
          .map(([id, declaration]) => [
            id,
            {
              semantics: declaration.plan.siteborne_payment_semantics,
              amount: declaration.plan.gross_buyer_amount_atomic,
              registration_allowed: declaration.plan.registration_allowed,
            },
          ])
      )
    ).toEqual({
      'company_evidence_graph.v1': {
        semantics: 'exact',
        amount: '39000',
        registration_allowed: true,
      },
      'web_context_verified.v1': {
        semantics: 'exact',
        amount: '9000',
        registration_allowed: true,
      },
      'verify_agent_output.v1': {
        semantics: 'exact',
        amount: '19000',
        registration_allowed: true,
      },
      'company_evidence_graph.v2': {
        semantics: 'exact',
        amount: '31200',
        registration_allowed: true,
      },
      'web_context_verified.v2': {
        semantics: 'exact',
        amount: '8000',
        registration_allowed: true,
      },
      'verify_agent_output.v2': {
        semantics: 'exact',
        amount: '17000',
        registration_allowed: true,
      },
    });
  });

  it('V: the CDP/x402 document rail remains upto at the 190000 ceiling', async () => {
    const discovery = await buildSiteborneDiscoveryDeclaration({
      serviceId: 'document_evidence_json.v1',
      nowIso: '2026-08-15T00:00:00.000Z',
      expiresInSeconds: 300,
      maxTimeoutSeconds: 120,
    });
    expect(discovery.accepts).toHaveLength(1);
    expect(discovery.accepts[0]).toMatchObject({ scheme: 'upto', amount: '190000' });
  });
});
