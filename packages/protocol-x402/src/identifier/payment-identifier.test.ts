import { describe, expect, it } from 'vitest';
import type { PaymentPayload, PaymentRequired } from '@x402/core/types';
import {
  declareSiteborneePaymentIdentifierSupport,
  buildBuyerPaymentIdentifierExtensions,
  generateSiteborneePaymentId,
  isValidPaymentId,
  parsePaymentIdentifier,
  PAYMENT_IDENTIFIER,
  readDeclaredPaymentIdentifierRequirement,
  sanitizePaymentIdentifierExtensionForValidation,
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

describe('sanitizePaymentIdentifierExtensionForValidation (SUN-1202 checkpoint H)', () => {
  it('H1: the real, official buyer helper output (echoing the server-declared schema) is accepted end-to-end', () => {
    // Exactly the real, official flow: server declares (upstream schema
    // unconditionally attached), buyer echoes the FULL declared
    // extensions object back via SITEBORNE's own official buyer helper
    // (buildBuyerPaymentIdentifierExtensions -- never a hand-rolled
    // approximation).
    const declared = declareSiteborneePaymentIdentifierSupport(true);
    const id = generateSiteborneePaymentId();
    const buyerExtensions = buildBuyerPaymentIdentifierExtensions(declared, id);
    // Confirms the reproduction is real: the buyer's echoed extension
    // genuinely still carries the upstream schema field (this is the
    // exact shape that broke under real workerd -- see the SUN-1202
    // closure report for the real-workerd reproduction/fix proof).
    expect((buyerExtensions[PAYMENT_IDENTIFIER] as { schema?: unknown }).schema).toBeDefined();

    const payload = samplePayload(buyerExtensions);
    const result = parsePaymentIdentifier(payload, true);
    expect(result).toEqual({ status: 'present', id });
  });

  it('drops only the schema field, never info', () => {
    const declared = declareSiteborneePaymentIdentifierSupport(true);
    const id = generateSiteborneePaymentId();
    const buyerExtensions = buildBuyerPaymentIdentifierExtensions(declared, id);
    const payload = samplePayload(buyerExtensions);
    const sanitized = sanitizePaymentIdentifierExtensionForValidation(payload);
    const extension = sanitized.extensions![PAYMENT_IDENTIFIER] as {
      info?: unknown;
      schema?: unknown;
    };
    expect(extension.schema).toBeUndefined();
    expect(extension.info).toEqual({ required: true, id });
  });

  it('is a no-op when no schema field is present (payload already sanitized, or a buyer that never echoed it)', () => {
    const id = generateSiteborneePaymentId();
    const payload = samplePayload({ [PAYMENT_IDENTIFIER]: { info: { required: false, id } } });
    const sanitized = sanitizePaymentIdentifierExtensionForValidation(payload);
    expect(sanitized).toEqual(payload);
  });

  it('is a no-op when the extension itself is absent', () => {
    const payload = samplePayload();
    expect(sanitizePaymentIdentifierExtensionForValidation(payload)).toEqual(payload);
  });

  it('H3: a malformed identifier (schema present, id invalid) is still rejected as malformed -- sanitization is not a validation bypass', () => {
    const declared = declareSiteborneePaymentIdentifierSupport(true);
    // Constructed directly (not via buildBuyerPaymentIdentifierExtensions,
    // which itself refuses to build an invalid id) -- simulates a
    // non-SITEBORNE-helper buyer that sends an invalid id while still
    // echoing the server-declared schema, exactly the shape that
    // exercises the historical bug.
    const extensions = {
      [PAYMENT_IDENTIFIER]: {
        ...(declared[PAYMENT_IDENTIFIER] as Record<string, unknown>),
        info: { required: true, id: 'short' },
      },
    };
    const payload = samplePayload(extensions);
    const result = parsePaymentIdentifier(payload, true);
    expect(result.status).toBe('malformed');
  });

  it('H4: a security-sensitive field (info.required, the server-declared requirement flag) tampered by the buyer is still governed correctly -- the server-declared requirement, not the buyer-echoed one, controls missing/required semantics', () => {
    // parsePaymentIdentifier's `serverRequired` parameter is always
    // supplied by the SERVER's own stored quote/requirement state, never
    // read back from the buyer's payload -- so a buyer that tampers with
    // the echoed info.required field (attempting to claim "not required"
    // to skip supplying one) has zero effect on this repository's own
    // deterministic missing_required_identifier failure. This proves
    // sanitization did not accidentally widen what "required" means.
    const declared = declareSiteborneePaymentIdentifierSupport(true);
    const tamperedExtensions = {
      [PAYMENT_IDENTIFIER]: {
        ...(declared[PAYMENT_IDENTIFIER] as Record<string, unknown>),
        info: { required: false }, // buyer tampers: no id, claims not required
      },
    };
    const payload = samplePayload(tamperedExtensions);
    // Server's own real requirement (true) still governs, regardless of
    // what the buyer's payload claims.
    const result = parsePaymentIdentifier(payload, true);
    expect(result.status).toBe('missing_required_identifier');
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
