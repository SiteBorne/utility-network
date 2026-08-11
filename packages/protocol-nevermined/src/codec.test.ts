import { describe, expect, it } from 'vitest';
import {
  decodeNeverminedPaymentRequiredHeaderSafe,
  decodeNeverminedPaymentResponseHeaderSafe,
  encodeNeverminedPaymentRequiredHeaderSafe,
  encodeNeverminedPaymentResponseHeaderSafe,
  validateNeverminedAccessToken,
} from './index';

const required = {
  x402Version: 2 as const,
  resource: { url: '/v1/nevermined/company/evidence-graph' },
  accepts: [
    {
      scheme: 'nvm:erc4337' as const,
      network: 'eip155:84532',
      planId: 'siteborne:company_evidence_graph.v1:payg',
      extra: {
        version: '1',
        agentId: 'siteborne:company_evidence_graph.v1:agent',
        httpVerb: 'POST',
      },
    },
  ],
  extensions: {},
};

describe('Nevermined HTTP codec boundary', () => {
  it('round-trips the official payment-required shape through a bounded safe codec', () => {
    const encoded = encodeNeverminedPaymentRequiredHeaderSafe(required);
    expect(decodeNeverminedPaymentRequiredHeaderSafe(encoded)).toEqual({
      ok: true,
      value: required,
    });
  });

  it.each([
    ['', 'malformed_base64'],
    ['not base64!', 'malformed_base64'],
    [Buffer.from('{bad json').toString('base64'), 'malformed_json'],
    [Buffer.from('{"__proto__":{"polluted":true}}').toString('base64'), 'unsafe_object_shape'],
    [Buffer.from(JSON.stringify({ x402Version: 1 })).toString('base64'), 'schema_invalid'],
  ])('fails closed for hostile requirement header input', (encoded, reason) => {
    expect(decodeNeverminedPaymentRequiredHeaderSafe(encoded)).toMatchObject({ ok: false, reason });
  });

  it('round-trips only bounded public settlement response fields', () => {
    const response = {
      success: true,
      payer: '0x' + '1'.repeat(40),
      transaction: '0x' + 'a'.repeat(64),
      network: 'eip155:84532',
      creditsRedeemed: '12000',
      remainingBalance: '178000',
      agentRequestId: 'agent-request-1',
    };
    expect(
      decodeNeverminedPaymentResponseHeaderSafe(encodeNeverminedPaymentResponseHeaderSafe(response))
    ).toEqual({ ok: true, value: response });
  });

  it.each([
    [undefined, 'missing'],
    ['', 'missing'],
    ['contains spaces', 'malformed'],
    ['x'.repeat(8193), 'oversized'],
    ['c2FuZGJveC10b2tlbg==', 'valid'],
  ])('validates an opaque access token without decoding it', (token, status) => {
    expect(validateNeverminedAccessToken(token)).toEqual({ status });
  });
});
