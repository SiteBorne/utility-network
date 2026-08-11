import { describe, expect, it } from 'vitest';
import {
  toNeverminedSettlePermissionsParams,
  toNeverminedVerifyPermissionsParams,
} from '../src/control-plane/evidence/nevermined-sdk-parameters';

const paymentRequired = {
  x402Version: 2 as const,
  resource: { url: '/v1/nevermined/document/evidence-json' },
  accepts: [
    {
      scheme: 'nvm:erc4337' as const,
      network: 'eip155:84532',
      planId: 'plan-document',
      extra: { agentId: 'agent-document', httpVerb: 'POST' },
    },
  ],
  extensions: {},
};

describe('Nevermined official SDK parameter boundary', () => {
  it('maps the authorization ceiling only into verification', () => {
    expect(
      toNeverminedVerifyPermissionsParams({
        paymentRequired,
        accessToken: '<opaque-test-authorization>',
        authorizedMaximum: '190000',
      })
    ).toMatchObject({ paymentRequired, maxAmount: 190000n });
  });

  it('maps measured actual usage, not the authorization ceiling, into settlement', () => {
    expect(
      toNeverminedSettlePermissionsParams({
        paymentRequired,
        accessToken: '<opaque-test-authorization>',
        authorizedMaximum: '190000',
        actualAmount: '12000',
        agentRequestId: 'request-1',
      })
    ).toMatchObject({ paymentRequired, maxAmount: 12000n, agentRequestId: 'request-1' });
  });

  it('fails closed before the SDK boundary for malformed amounts', () => {
    expect(() =>
      toNeverminedSettlePermissionsParams({
        paymentRequired,
        accessToken: '<opaque-test-authorization>',
        authorizedMaximum: '190000',
        actualAmount: '12.000',
      })
    ).toThrow('invalid Nevermined atomic amount');
  });
});
