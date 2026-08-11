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
