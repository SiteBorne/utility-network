import { describe, expect, it } from 'vitest';
import type { PaymentPayload, PaymentRequired } from '@x402/core/types';
import {
  declareSiteborneePaymentIdentifierSupport,
  generateSiteborneePaymentId,
  isValidPaymentId,
  parsePaymentIdentifier,
  PAYMENT_IDENTIFIER,
  readDeclaredPaymentIdentifierRequirement,
} from './payment-identifier';

function samplePayload(extensions?: Record<string, unknown>): PaymentPayload {
  return {
    x402Version: 2,
    accepted: {
      scheme: 'exact',
      network: 'eip155:8453',
      amount: '39000',
      asset: '0xUSDC',
      payTo: '0xPayee',
      maxTimeoutSeconds: 60,
      extra: {},
    },
    payload: {},
    ...(extensions !== undefined ? { extensions } : {}),
  };
}

describe('declareSiteborneePaymentIdentifierSupport', () => {
  it('advertises the extension when enabled (not required)', () => {
    const declared = declareSiteborneePaymentIdentifierSupport(false);
    expect(declared[PAYMENT_IDENTIFIER]).toBeDefined();
    const info = (declared[PAYMENT_IDENTIFIER] as { info: { required: boolean } }).info;
    expect(info.required).toBe(false);
  });

  it('advertises required: true when enabled with required', () => {
    const declared = declareSiteborneePaymentIdentifierSupport(true);
    const info = (declared[PAYMENT_IDENTIFIER] as { info: { required: boolean } }).info;
    expect(info.required).toBe(true);
  });

  it('is deterministic given the same required flag', () => {
    const a = declareSiteborneePaymentIdentifierSupport(true);
    const b = declareSiteborneePaymentIdentifierSupport(true);
    expect(a).toEqual(b);
  });

  it('the declared schema carries no secret information', () => {
    const declared = declareSiteborneePaymentIdentifierSupport(true);
    expect(JSON.stringify(declared)).not.toMatch(/key|secret|password|private/i);
  });
});

describe('readDeclaredPaymentIdentifierRequirement', () => {
  it('reports absent when the challenge does not declare the extension', () => {
    const challenge: PaymentRequired = {
      x402Version: 2,
      resource: { url: 'https://x' },
      accepts: [],
    };
    expect(readDeclaredPaymentIdentifierRequirement(challenge)).toEqual({
      declared: false,
      required: false,
    });
  });

  it('reports declared+required from a real declaration', () => {
    const challenge: PaymentRequired = {
      x402Version: 2,
      resource: { url: 'https://x' },
      accepts: [],
      extensions: declareSiteborneePaymentIdentifierSupport(true),
    };
    expect(readDeclaredPaymentIdentifierRequirement(challenge)).toEqual({
      declared: true,
      required: true,
    });
  });
});

describe('parsePaymentIdentifier', () => {
  it('is absent when not required and not supplied', () => {
    const result = parsePaymentIdentifier(samplePayload(), false);
    expect(result).toEqual({ status: 'absent' });
  });

  it('is missing_required_identifier when required and not supplied', () => {
    const result = parsePaymentIdentifier(samplePayload(), true);
    expect(result).toEqual({ status: 'missing_required_identifier' });
  });

  it('extracts a valid, generated identifier from its official extension location', () => {
    const id = generateSiteborneePaymentId('pay_');
    const payload = samplePayload({ [PAYMENT_IDENTIFIER]: { info: { required: false, id } } });
    const result = parsePaymentIdentifier(payload, false);
    expect(result).toEqual({ status: 'present', id });
  });

  it('never searches an arbitrary nested field — a top-level id is ignored', () => {
    const id = generateSiteborneePaymentId('pay_');
    const payload = { ...samplePayload(), payment_identifier: id } as unknown as PaymentPayload;
    const result = parsePaymentIdentifier(payload, false);
    expect(result).toEqual({ status: 'absent' });
  });

  it('rejects a too-short identifier as malformed', () => {
    const payload = samplePayload({
      [PAYMENT_IDENTIFIER]: { info: { required: false, id: 'short' } },
    });
    const result = parsePaymentIdentifier(payload, false);
    expect(result.status).toBe('malformed');
  });

  it('rejects an oversized identifier as malformed', () => {
    const payload = samplePayload({
      [PAYMENT_IDENTIFIER]: { info: { required: false, id: 'x'.repeat(200) } },
    });
    const result = parsePaymentIdentifier(payload, false);
    expect(result.status).toBe('malformed');
  });

  it('rejects an identifier with invalid characters as malformed', () => {
    const payload = samplePayload({
      [PAYMENT_IDENTIFIER]: { info: { required: false, id: 'has spaces!@#$%^&*()12345' } },
    });
    const result = parsePaymentIdentifier(payload, false);
    expect(result.status).toBe('malformed');
  });
});

describe('isValidPaymentId / generateSiteborneePaymentId', () => {
  it('every generated ID is itself valid', () => {
    for (let i = 0; i < 20; i++) {
      expect(isValidPaymentId(generateSiteborneePaymentId())).toBe(true);
    }
  });

  it('generated IDs are unique across calls', () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateSiteborneePaymentId()));
    expect(ids.size).toBe(50);
  });
});
