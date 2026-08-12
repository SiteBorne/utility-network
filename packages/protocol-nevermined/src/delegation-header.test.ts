import { describe, expect, it } from 'vitest';
import { PAYMENT_DELEGATION_ID_HEADER, parseNeverminedDelegationId } from './delegation-header';

describe('parseNeverminedDelegationId', () => {
  it('header name is the frozen PAYMENT-DELEGATION-ID constant', () => {
    expect(PAYMENT_DELEGATION_ID_HEADER).toBe('PAYMENT-DELEGATION-ID');
  });

  it('missing when the header is absent or empty', () => {
    expect(parseNeverminedDelegationId(undefined)).toEqual({ status: 'missing' });
    expect(parseNeverminedDelegationId('')).toEqual({ status: 'missing' });
  });

  it('present for a real sandbox-shaped UUID delegation id', () => {
    expect(parseNeverminedDelegationId('aafdab51-57a2-44d2-8765-579b8a5f9c19')).toEqual({
      status: 'present',
      id: 'aafdab51-57a2-44d2-8765-579b8a5f9c19',
    });
  });

  it('rejects control characters, whitespace, and header-injection shapes as malformed', () => {
    expect(parseNeverminedDelegationId('abc\r\ninjected: header')).toEqual({
      status: 'malformed',
    });
    expect(parseNeverminedDelegationId('abc def')).toEqual({ status: 'malformed' });
  });

  it('rejects an oversized value as malformed', () => {
    expect(parseNeverminedDelegationId('a'.repeat(129))).toEqual({ status: 'malformed' });
  });

  it('accepts the 128-char boundary', () => {
    const id = 'a'.repeat(128);
    expect(parseNeverminedDelegationId(id)).toEqual({ status: 'present', id });
  });
});
