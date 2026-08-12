import { describe, expect, it } from 'vitest';
import {
  validateNeverminedPaymentRequired,
  validateNeverminedSettlementResult,
  validateNeverminedVerificationResult,
} from './index';

const expectedRequirement = {
  resource: '/v1/nevermined/company/evidence-graph',
  network: 'eip155:84532',
  agentId: 'agent_company_v1',
  planId: 'plan_company_payg_v1',
};

const paymentRequired = {
  x402Version: 2,
  resource: { url: expectedRequirement.resource, mimeType: 'application/json' },
  accepts: [
    {
      scheme: 'nvm:erc4337',
      network: expectedRequirement.network,
      planId: expectedRequirement.planId,
      extra: { version: '1', agentId: expectedRequirement.agentId, httpVerb: 'POST' },
    },
  ],
  extensions: {},
};

describe('Nevermined protocol boundary validation', () => {
  it('accepts exactly one requirement bound to route, network, agent, and plan', () => {
    expect(validateNeverminedPaymentRequired(paymentRequired, expectedRequirement)).toEqual({
      valid: true,
      paymentRequired,
    });
  });

  it.each([
    ['wrong_version', { x402Version: 1 }],
    ['wrong_resource', { resource: { url: '/v1/other' } }],
    ['ambiguous_accepts', { accepts: [...paymentRequired.accepts, ...paymentRequired.accepts] }],
    ['wrong_scheme', { accepts: [{ ...paymentRequired.accepts[0], scheme: 'exact' }] }],
    ['wrong_network', { accepts: [{ ...paymentRequired.accepts[0], network: 'eip155:1' }] }],
    ['wrong_plan', { accepts: [{ ...paymentRequired.accepts[0], planId: 'another-plan' }] }],
    [
      'wrong_agent',
      {
        accepts: [
          {
            ...paymentRequired.accepts[0],
            extra: { ...paymentRequired.accepts[0].extra, agentId: 'another-agent' },
          },
        ],
      },
    ],
    [
      'wrong_http_verb',
      {
        accepts: [
          {
            ...paymentRequired.accepts[0],
            extra: { ...paymentRequired.accepts[0].extra, httpVerb: 'GET' },
          },
        ],
      },
    ],
  ])('fails closed for %s', (_name, patch) => {
    expect(
      validateNeverminedPaymentRequired({ ...paymentRequired, ...patch }, expectedRequirement)
    ).toMatchObject({ valid: false });
  });

  it('accepts only a successful settlement bound to expected payer, network, and actual amount', () => {
    expect(
      validateNeverminedSettlementResult(
        {
          success: true,
          payer: '0x' + '1'.repeat(40),
          transaction: '0x' + 'a'.repeat(64),
          network: 'eip155:84532',
          creditsRedeemed: '12000',
          remainingBalance: '178000',
        },
        {
          payer: '0x' + '1'.repeat(40),
          network: 'eip155:84532',
          actualAmount: '12000',
        }
      )
    ).toMatchObject({ valid: true });
  });

  it.each([
    ['provider rejection', { success: false, errorReason: 'rejected' }],
    ['payer mismatch', { payer: '0x' + '2'.repeat(40) }],
    ['network mismatch', { network: 'eip155:1' }],
    ['actual amount mismatch', { creditsRedeemed: '190000' }],
    ['missing transaction', { transaction: '' }],
  ])('rejects %s', (_name, patch) => {
    expect(
      validateNeverminedSettlementResult(
        {
          success: true,
          payer: '0x' + '1'.repeat(40),
          transaction: '0x' + 'a'.repeat(64),
          network: 'eip155:84532',
          creditsRedeemed: '12000',
          ...patch,
        },
        {
          payer: '0x' + '1'.repeat(40),
          network: 'eip155:84532',
          actualAmount: '12000',
        }
      )
    ).toMatchObject({ valid: false });
  });

  it('accepts a successful settlement when payer/network/creditsRedeemed are all absent — observed on the real sandbox facilitator, SUN-0900B checkpoint 1B (independently confirmed settled via delegation transactionCount/amountSpentCents/status read-back before this fix)', () => {
    expect(
      validateNeverminedSettlementResult(
        {
          success: true,
          payer: undefined,
          transaction: '0x' + 'a'.repeat(64),
          network: undefined,
          creditsRedeemed: undefined,
        },
        {
          payer: '0x' + '1'.repeat(40),
          network: 'eip155:84532',
          actualAmount: '9000',
        }
      )
    ).toMatchObject({ valid: true });
  });

  it.each([
    ['present-but-wrong payer', { payer: '0x' + '2'.repeat(40) }],
    ['present-but-wrong network', { network: 'eip155:1' }],
    ['present-but-wrong creditsRedeemed', { creditsRedeemed: '190000' }],
  ])(
    'still rejects %s even when the other optional fields are absent — absence is not the same as disagreement',
    (_name, patch) => {
      expect(
        validateNeverminedSettlementResult(
          {
            success: true,
            payer: undefined,
            transaction: '0x' + 'a'.repeat(64),
            network: undefined,
            creditsRedeemed: undefined,
            ...patch,
          },
          {
            payer: '0x' + '1'.repeat(40),
            network: 'eip155:84532',
            actualAmount: '9000',
          }
        )
      ).toMatchObject({ valid: false });
    }
  );

  describe('settlement success normalizer (SUN-0900B checkpoint 1B)', () => {
    const EXPECTED = {
      payer: '0x' + '1'.repeat(40),
      network: 'eip155:84532',
      actualAmount: '9000',
    };

    it('A: canonical documented REST success shape (explicit success:true, all fields present) accepts', () => {
      expect(
        validateNeverminedSettlementResult(
          {
            success: true,
            payer: EXPECTED.payer,
            network: EXPECTED.network,
            transaction: '0x' + 'a'.repeat(64),
            creditsRedeemed: EXPECTED.actualAmount,
          },
          EXPECTED
        )
      ).toMatchObject({ valid: true });
    });

    it('B: installed-SDK-observed successful shape (success absent, real transaction present) accepts', () => {
      expect(
        validateNeverminedSettlementResult(
          { success: undefined, transaction: '0x' + 'b'.repeat(64) },
          EXPECTED
        )
      ).toMatchObject({ valid: true });
    });

    it('C: explicit success:false rejects as provider_rejected, even with a real transaction present', () => {
      expect(
        validateNeverminedSettlementResult(
          { success: false, transaction: '0x' + 'c'.repeat(64), errorReason: 'insufficient_funds' },
          EXPECTED
        )
      ).toEqual({ valid: false, reason: 'provider_rejected' });
    });

    it('D: no positive success evidence at all (success absent, transaction absent) is ambiguous, not accepted', () => {
      expect(
        validateNeverminedSettlementResult({ success: undefined, transaction: '' }, EXPECTED)
      ).toEqual({ valid: false, reason: 'ambiguous_settlement' });
    });

    it('E: success absent, transaction present but malformed (oversized) is ambiguous, not accepted', () => {
      expect(
        validateNeverminedSettlementResult(
          { success: undefined, transaction: 'x'.repeat(300) },
          EXPECTED
        )
      ).toEqual({ valid: false, reason: 'ambiguous_settlement' });
    });

    it('M: a real transaction present alongside explicit success:false is still rejected — explicit failure is authoritative', () => {
      expect(
        validateNeverminedSettlementResult(
          { success: false, transaction: '0x' + 'd'.repeat(64) },
          EXPECTED
        )
      ).toEqual({ valid: false, reason: 'provider_rejected' });
    });

    it('N: success present but neither true nor false (unknown/drifted shape) is ambiguous — never guessed', () => {
      expect(
        validateNeverminedSettlementResult(
          // @ts-expect-error — deliberately an off-contract value to prove
          // the normalizer never coerces an unrecognized shape into success.
          { success: 'ok', transaction: '0x' + 'e'.repeat(64) },
          EXPECTED
        )
      ).toEqual({ valid: false, reason: 'ambiguous_settlement' });
    });
  });

  it('accepts verification only when payer, network, and stable request identity are bounded', () => {
    expect(
      validateNeverminedVerificationResult(
        {
          isValid: true,
          payer: '0x' + '1'.repeat(40),
          network: 'eip155:84532',
          agentRequestId: 'agent-request-1',
        },
        { network: 'eip155:84532' }
      )
    ).toEqual({ valid: true });
  });

  it('accepts verification when the (optional, per the official SDK type) network field is absent entirely — observed on the real sandbox facilitator, SUN-0900B checkpoint 1B', () => {
    expect(
      validateNeverminedVerificationResult(
        {
          isValid: true,
          payer: '0x' + '1'.repeat(40),
          network: undefined,
          agentRequestId: 'agent-request-1',
        },
        { network: 'eip155:84532' }
      )
    ).toEqual({ valid: true });
  });

  it('still rejects a network value that is present but wrong — absence is not the same as disagreement', () => {
    expect(
      validateNeverminedVerificationResult(
        {
          isValid: true,
          payer: '0x' + '1'.repeat(40),
          network: 'eip155:1',
          agentRequestId: 'agent-request-1',
        },
        { network: 'eip155:84532' }
      )
    ).toEqual({ valid: false, reason: 'network_mismatch' });
  });

  it.each([
    ['provider rejection', { isValid: false, invalidReason: 'free form secret detail' }],
    ['payer missing', { payer: undefined }],
    ['payer malformed', { payer: 'not-an-address' }],
    ['network mismatch', { network: 'eip155:1' }],
    ['request missing', { agentRequestId: undefined }],
    ['request oversized', { agentRequestId: 'x'.repeat(257) }],
  ])('rejects unsafe verification result: %s', (_name, patch) => {
    expect(
      validateNeverminedVerificationResult(
        {
          isValid: true,
          payer: '0x' + '1'.repeat(40),
          network: 'eip155:84532',
          agentRequestId: 'agent-request-1',
          ...patch,
        },
        { network: 'eip155:84532' }
      )
    ).toMatchObject({ valid: false });
  });
});
