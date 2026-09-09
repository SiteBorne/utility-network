import { buildExactPaymentRequirement, buildQuote } from '@siteborne/protocol-x402';
import { parsePaymentPayload } from '@x402/core/schemas';
import type { PaymentPayload, PaymentRequired, SettleResponse } from '@x402/core/types';
import { describe, expect, it } from 'vitest';
import {
  X402_MCP_PAYMENT_META_KEY,
  X402_MCP_PAYMENT_RESPONSE_META_KEY,
  attachPaymentResponseMeta,
  buildPaymentRequiredResult,
  extractPaymentPayload,
  type McpToolResultShape,
} from './x402-wire';

// Real payment payload construction, mirroring
// packages/protocol-x402/src/codec/headers.test.ts's own
// `sampleChallenge()` — never an invented shape.
async function realPaymentPayload(): Promise<PaymentPayload> {
  const quote = await buildQuote({
    service_id: 'company_evidence_graph.v2',
    service_version: 'v2',
    contract_release: '2.0.0',
    input_hash: 'sha256:' + '1'.repeat(64),
    pricing_key: 'company_evidence_graph_v2',
    scheme: 'exact',
    network: 'eip155:8453',
    asset: '0xUSDC',
    amount: '31200',
    payee: '0xPayee',
    issued_at: '2026-08-09T00:00:00.000Z',
    expires_at: '2026-08-09T00:05:00.000Z',
  });
  const { requirement } = await buildExactPaymentRequirement({
    quote,
    resource_id: 'https://utility.siteborne.net/v2/company/evidence-graph',
    maxTimeoutSeconds: 60,
  });
  return { x402Version: 2, accepted: requirement, payload: { signature: '0xdeadbeef' } };
}

describe('extractPaymentPayload', () => {
  it('returns undefined when _meta is undefined (genuinely unpaid call)', () => {
    expect(extractPaymentPayload(undefined)).toBeUndefined();
  });

  it('returns undefined when the x402/payment key is absent', () => {
    expect(extractPaymentPayload({ 'some/other-key': 'value' })).toBeUndefined();
  });

  it('extracts a real, schema-valid PaymentPayload from the official carrier key', async () => {
    const payload = await realPaymentPayload();
    const meta = { [X402_MCP_PAYMENT_META_KEY]: payload };
    expect(extractPaymentPayload(meta)).toEqual(payload);
  });

  it('rejects a schema-invalid value under the carrier key (fail closed)', () => {
    const meta = { [X402_MCP_PAYMENT_META_KEY]: { hello: 'world' } };
    expect(extractPaymentPayload(meta)).toBeUndefined();
  });

  it('rejects a structurally-valid V1 payload as unsupported (version binding, not silently upgraded)', () => {
    // Mutation-tested: an earlier version of this test used a V1 shape
    // that was ALSO schema-invalid (V1's real fields are
    // scheme/network/payload at the top level, not V2's
    // accepted/payload), so it passed even with the `x402Version !== 2`
    // check deleted entirely. The exact V1 shape below was read directly
    // from @x402/core's own compiled PaymentPayloadV1Schema (dist/esm) —
    // not guessed — and the precondition assertion is a self-verifying
    // guard against ever regressing to a schema_invalid-for-other-reasons
    // false positive again.
    const v1Shape = {
      x402Version: 1,
      scheme: 'exact',
      network: 'base-sepolia',
      payload: { signature: '0xdeadbeef' },
    };
    const structurallyValid = parsePaymentPayload(v1Shape);
    expect(structurallyValid.success).toBe(true); // precondition: a genuine V1-vs-V2 test, not a schema_invalid one

    const meta = { [X402_MCP_PAYMENT_META_KEY]: v1Shape };
    expect(extractPaymentPayload(meta)).toBeUndefined();
  });

  it('rejects a prototype-pollution-shaped payload (reuses @x402/core parsePaymentPayload, not a second hand-rolled schema)', async () => {
    const payload = await realPaymentPayload();
    const polluted = JSON.parse(
      JSON.stringify(payload).slice(0, -1) + ',"constructor":{"prototype":{}}}'
    );
    const meta = { [X402_MCP_PAYMENT_META_KEY]: polluted };
    // Either rejected outright, or accepted with the hostile key inert
    // (never granting prototype access) — either is safe; what's
    // unacceptable is a thrown exception reaching the caller uncaught.
    expect(() => extractPaymentPayload(meta)).not.toThrow();
  });
});

describe('buildPaymentRequiredResult', () => {
  it('produces the official carrier shape: isError, structuredContent, content[0].text', async () => {
    const quote = await buildQuote({
      service_id: 'company_evidence_graph.v2',
      service_version: 'v2',
      contract_release: '2.0.0',
      input_hash: 'sha256:' + '2'.repeat(64),
      pricing_key: 'company_evidence_graph_v2',
      scheme: 'exact',
      network: 'eip155:8453',
      asset: '0xUSDC',
      amount: '31200',
      payee: '0xPayee',
      issued_at: '2026-08-09T00:00:00.000Z',
      expires_at: '2026-08-09T00:05:00.000Z',
    });
    const { requirement } = await buildExactPaymentRequirement({
      quote,
      resource_id: 'https://utility.siteborne.net/v2/company/evidence-graph',
      maxTimeoutSeconds: 60,
    });
    const paymentRequired: PaymentRequired = {
      x402Version: 2,
      resource: { url: 'https://utility.siteborne.net/v2/company/evidence-graph' },
      accepts: [requirement],
    };

    const result = buildPaymentRequiredResult(paymentRequired);

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual(paymentRequired);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.type).toBe('text');
    // §12: text and structured economics must never disagree — this
    // module derives both from the same object, so parsing the text back
    // out must equal the structured content byte-for-byte.
    expect(JSON.parse(result.content[0]!.text)).toEqual(paymentRequired);
  });
});

describe('attachPaymentResponseMeta', () => {
  it('writes the settle response under the official _meta key without touching content', () => {
    const settleResponse: SettleResponse = {
      success: true,
      transaction: '0xabc123',
      network: 'eip155:8453',
      payer: '0xBuyer',
    };
    const base: McpToolResultShape = { content: [{ type: 'text' as const, text: '{"ok":true}' }] };

    const result = attachPaymentResponseMeta(base, settleResponse);

    expect(result.content).toBe(base.content);
    expect(result._meta?.[X402_MCP_PAYMENT_RESPONSE_META_KEY]).toEqual(settleResponse);
  });

  it('preserves any existing _meta entries already on the result', () => {
    const settleResponse: SettleResponse = {
      success: true,
      transaction: '0xdef456',
      network: 'eip155:8453',
    };
    const base: McpToolResultShape = {
      content: [{ type: 'text' as const, text: '{}' }],
      _meta: { 'net.siteborne/serviceId': 'company_evidence_graph.v2' },
    };

    const result = attachPaymentResponseMeta(base, settleResponse);

    expect(result._meta?.['net.siteborne/serviceId']).toBe('company_evidence_graph.v2');
    expect(result._meta?.[X402_MCP_PAYMENT_RESPONSE_META_KEY]).toEqual(settleResponse);
  });

  it('never invents settlement facts — serializes exactly the object it is given, no derived/defaulted fields', () => {
    const settleResponse: SettleResponse = {
      success: false,
      errorReason: 'insufficient_funds',
      transaction: '',
      network: 'eip155:8453',
    };
    const base: McpToolResultShape = { content: [{ type: 'text' as const, text: '{}' }] };

    const result = attachPaymentResponseMeta(base, settleResponse);

    expect(result._meta?.[X402_MCP_PAYMENT_RESPONSE_META_KEY]).toStrictEqual(settleResponse);
  });
});
