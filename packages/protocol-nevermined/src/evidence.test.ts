import { describe, expect, it } from 'vitest';
import { sanitizeNeverminedSettlement, sanitizeNeverminedVerification } from './index';

const binding = {
  paymentIdentifier: 'pay_' + '1'.repeat(28),
  agentId: 'agent_company_v1',
  planId: 'plan_company_payg_v1',
  observedAt: '2026-08-11T00:00:00.000Z',
};

describe('sanitized Nevermined evidence domains', () => {
  it('retains bounded public verification fields and excludes raw provider data', async () => {
    const evidence = await sanitizeNeverminedVerification(binding, {
      isValid: true,
      payer: '0x' + '1'.repeat(40),
      network: 'eip155:84532',
      agentRequestId: 'request-1',
      agentRequest: { secret: 'must-not-survive' },
      urlMatching: '/private/provider/pattern',
    });
    expect(evidence).toMatchObject({
      provider: 'nevermined-payments@1.10.0',
      rail: 'nevermined',
      result: 'verified',
    });
    expect(JSON.stringify(evidence)).not.toContain('must-not-survive');
    expect(JSON.stringify(evidence)).not.toContain('/private/provider/pattern');
  });

  it('bounds rejection reasons and never includes free-form stack text', async () => {
    const evidence = await sanitizeNeverminedVerification(binding, {
      isValid: false,
      invalidReason: 'not-enough-credits',
    });
    expect(evidence.reason_code).toBe('not-enough-credits');
    const unsafe = await sanitizeNeverminedVerification(binding, {
      isValid: false,
      invalidReason: 'stack trace with spaces and token=secret',
    });
    expect(unsafe.reason_code).toBe('provider_rejected');
  });

  it('retains only public settlement fields and hashes no authorization token', async () => {
    const evidence = await sanitizeNeverminedSettlement(binding, {
      success: true,
      payer: '0x' + '1'.repeat(40),
      transaction: '0x' + 'a'.repeat(64),
      network: 'eip155:84532',
      creditsRedeemed: '12000',
      remainingBalance: '88000',
      orderTx: 'private-order-detail',
    });
    expect(evidence).toMatchObject({ result: 'settled', amount_redeemed: '12000' });
    expect(JSON.stringify(evidence)).not.toContain('private-order-detail');
  });
});
