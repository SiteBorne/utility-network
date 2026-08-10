import { describe, expect, it } from 'vitest';
import { buildQuote } from '../quote/quote';
import { buildExactPaymentRequirement } from '../requirements/exact';
import { buildPaymentRequired } from '../challenge/payment-required';
import {
  decodePaymentRequiredHeaderSafe,
  decodePaymentResponseHeaderSafe,
  decodePaymentSignatureHeaderSafe,
  encodePaymentRequiredHeaderSafe,
  encodePaymentResponseHeaderSafe,
  encodePaymentSignatureHeaderSafe,
  MAX_DECODED_HEADER_BYTES,
} from './headers';
import type { PaymentPayload, SettleResponse } from '@x402/core/types';

async function sampleChallenge() {
  const q = await buildQuote({
    service_id: 'company_evidence_graph.v1',
    service_version: 'v1',
    contract_release: '1.0.0',
    input_hash: 'sha256:' + '1'.repeat(64),
    pricing_key: 'company_evidence_graph',
    scheme: 'exact',
    network: 'eip155:8453',
    asset: '0xUSDC',
    amount: '39000',
    payee: '0xPayee',
    issued_at: '2026-08-09T00:00:00.000Z',
    expires_at: '2026-08-09T00:05:00.000Z',
  });
  const { requirement } = await buildExactPaymentRequirement({
    quote: q,
    resource_id: 'https://api.siteborne.dev/v1/company_evidence_graph',
    maxTimeoutSeconds: 60,
  });
  const challenge = buildPaymentRequired({
    resource: { url: 'https://api.siteborne.dev/v1/company_evidence_graph' },
    accepts: [requirement],
  });
  return { challenge, requirement };
}

describe('PAYMENT-REQUIRED codec', () => {
  it('round-trips a real challenge', async () => {
    const { challenge } = await sampleChallenge();
    const header = encodePaymentRequiredHeaderSafe(challenge);
    const decoded = decodePaymentRequiredHeaderSafe(header);
    expect(decoded).toEqual({ ok: true, value: challenge });
  });

  it('rejects malformed Base64', () => {
    const decoded = decodePaymentRequiredHeaderSafe('not!!valid==base64###');
    expect(decoded).toMatchObject({ ok: false, reason: 'malformed_base64' });
  });

  it('rejects an oversized decoded payload', () => {
    const huge = Buffer.from('a'.repeat(MAX_DECODED_HEADER_BYTES + 1)).toString('base64');
    const decoded = decodePaymentRequiredHeaderSafe(huge);
    expect(decoded).toMatchObject({ ok: false, reason: 'oversized_payload' });
  });

  it('rejects malformed JSON', () => {
    const header = Buffer.from('{not valid json', 'utf-8').toString('base64');
    const decoded = decodePaymentRequiredHeaderSafe(header);
    expect(decoded).toMatchObject({ ok: false, reason: 'malformed_json' });
  });

  it('rejects a prototype-pollution-shaped payload', () => {
    const header = Buffer.from('{"__proto__": {"polluted": true}}', 'utf-8').toString('base64');
    const decoded = decodePaymentRequiredHeaderSafe(header);
    expect(decoded).toMatchObject({ ok: false, reason: 'unsafe_object_shape' });
  });

  it('rejects a structurally-valid V1 PaymentRequired as unsupported_version', () => {
    const v1 = {
      x402Version: 1,
      accepts: [
        {
          scheme: 'exact',
          network: 'base-sepolia',
          maxAmountRequired: '39000',
          resource: 'https://api.siteborne.dev/v1/x',
          description: 'x',
          payTo: '0xPayee',
          maxTimeoutSeconds: 60,
          asset: '0xUSDC',
        },
      ],
    };
    const header = Buffer.from(JSON.stringify(v1), 'utf-8').toString('base64');
    const decoded = decodePaymentRequiredHeaderSafe(header);
    expect(decoded).toMatchObject({ ok: false, reason: 'unsupported_version' });
  });

  it('rejects a schema-invalid payload', () => {
    const header = Buffer.from(JSON.stringify({ hello: 'world' }), 'utf-8').toString('base64');
    const decoded = decodePaymentRequiredHeaderSafe(header);
    expect(decoded).toMatchObject({ ok: false, reason: 'schema_invalid' });
  });
});

describe('PAYMENT-SIGNATURE codec', () => {
  it('round-trips a real payment payload', async () => {
    const { requirement } = await sampleChallenge();
    const payload: PaymentPayload = {
      x402Version: 2,
      accepted: requirement,
      payload: { signature: '0xdeadbeef' },
    };
    const header = encodePaymentSignatureHeaderSafe(payload);
    const decoded = decodePaymentSignatureHeaderSafe(header);
    expect(decoded).toEqual({ ok: true, value: payload });
  });

  it('rejects malformed Base64', () => {
    expect(decodePaymentSignatureHeaderSafe('!!!')).toMatchObject({
      ok: false,
      reason: 'malformed_base64',
    });
  });

  it('rejects a prototype-pollution-shaped payload', () => {
    const header = Buffer.from(
      '{"x402Version":2,"accepted":{},"payload":{},"constructor":{"prototype":{}}}',
      'utf-8'
    ).toString('base64');
    expect(decodePaymentSignatureHeaderSafe(header)).toMatchObject({
      ok: false,
      reason: 'unsafe_object_shape',
    });
  });
});

describe('PAYMENT-RESPONSE codec', () => {
  it('round-trips a real (synthetic, labeled) settlement evidence object', () => {
    const settlement: SettleResponse = {
      success: true,
      transaction: 'synthetic-0x0000000000000000000000000000000000000000000000000000000000000000',
      network: 'eip155:8453',
      amount: '39000',
      payer: '0xBuyer',
    };
    const header = encodePaymentResponseHeaderSafe(settlement);
    const decoded = decodePaymentResponseHeaderSafe(header);
    expect(decoded).toEqual({ ok: true, value: settlement });
  });

  it('rejects a payload missing the required transaction field', () => {
    const header = Buffer.from(
      JSON.stringify({ success: true, network: 'eip155:8453' }),
      'utf-8'
    ).toString('base64');
    expect(decodePaymentResponseHeaderSafe(header)).toMatchObject({
      ok: false,
      reason: 'schema_invalid',
    });
  });

  it('rejects oversized payloads identically to the other two codecs', () => {
    const huge = Buffer.from('a'.repeat(MAX_DECODED_HEADER_BYTES + 1)).toString('base64');
    expect(decodePaymentResponseHeaderSafe(huge)).toMatchObject({
      ok: false,
      reason: 'oversized_payload',
    });
  });
});
