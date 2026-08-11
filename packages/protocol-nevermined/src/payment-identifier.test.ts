import { describe, expect, it } from 'vitest';
import {
  PAYMENT_IDENTIFIER_HEADER,
  parseNeverminedPaymentIdentifier,
  serializeNeverminedPaymentIdentifier,
} from './index';

describe('Nevermined Payment-Identifier transport adapter', () => {
  const valid = 'pay_' + '1'.repeat(28);

  it('carries the accepted SITEBORNE identity in one explicit header', () => {
    expect(PAYMENT_IDENTIFIER_HEADER).toBe('Payment-Identifier');
    expect(serializeNeverminedPaymentIdentifier(valid)).toEqual({
      name: PAYMENT_IDENTIFIER_HEADER,
      value: valid,
    });
    expect(parseNeverminedPaymentIdentifier(valid)).toEqual({ status: 'present', id: valid });
  });

  it.each([undefined, '', 'idempotency-key', 'pay_short'])('fails closed for %j', (value) => {
    expect(parseNeverminedPaymentIdentifier(value)).not.toMatchObject({ status: 'present' });
  });

  it('does not derive identity from a reusable access token', () => {
    const token = 'opaque-reusable-token';
    expect(parseNeverminedPaymentIdentifier(undefined, token)).toEqual({ status: 'missing' });
  });
});
