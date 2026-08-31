import { describe, expect, it } from 'vitest';
import {
  executorInvocationIdempotencyKey,
  pccIdempotencyKey,
  receiptPersistenceIdempotencyKey,
  resultPersistenceIdempotencyKey,
  settlementIdempotencyKey,
  terminalEventIdempotencyKey,
  workflowInstanceIdempotencyKey,
} from '../src/control-plane/continuation/idempotency-keys';

describe('durable continuation idempotency keys (SUN-1221E6R-H2AWI-1d)', () => {
  it('maps the Workflow key to the frozen SHA-256-derived instance ID', async () => {
    await expect(workflowInstanceIdempotencyKey('pay_abc')).resolves.toBe(
      'siteborne-wf-0d20809df0229b75ab747c8e41d962a64b42ef348d5b5af4',
    );
  });

  it('formats the executor invocation key exactly', () => {
    expect(executorInvocationIdempotencyKey('pay_abc')).toBe('pay_abc:executor');
  });

  it('formats the PCC key exactly', () => {
    expect(pccIdempotencyKey('pay_abc')).toBe('pay_abc:pcc');
  });

  it('formats the settlement key exactly', () => {
    expect(settlementIdempotencyKey('pay_abc')).toBe('pay_abc:settlement');
  });

  it('formats the result-persistence key exactly', () => {
    expect(resultPersistenceIdempotencyKey('pay_abc')).toBe('pay_abc:result');
  });

  it('formats the receipt-persistence key exactly', () => {
    expect(receiptPersistenceIdempotencyKey('pay_abc')).toBe('pay_abc:receipt');
  });

  it('formats the terminal-event key exactly', () => {
    expect(terminalEventIdempotencyKey('pay_abc')).toBe('pay_abc:terminal');
  });

  it('domain-separates every step key for the same payment identifier', () => {
    const keys = [
      executorInvocationIdempotencyKey('pay_abc'),
      pccIdempotencyKey('pay_abc'),
      settlementIdempotencyKey('pay_abc'),
      resultPersistenceIdempotencyKey('pay_abc'),
      receiptPersistenceIdempotencyKey('pay_abc'),
      terminalEventIdempotencyKey('pay_abc'),
    ];

    expect(new Set(keys).size).toBe(6);
  });

  it('keeps different payment identifiers distinct in every synchronous domain', () => {
    expect(executorInvocationIdempotencyKey('pay_a')).not.toBe(
      executorInvocationIdempotencyKey('pay_b'),
    );
    expect(pccIdempotencyKey('pay_a')).not.toBe(pccIdempotencyKey('pay_b'));
    expect(settlementIdempotencyKey('pay_a')).not.toBe(
      settlementIdempotencyKey('pay_b'),
    );
    expect(resultPersistenceIdempotencyKey('pay_a')).not.toBe(
      resultPersistenceIdempotencyKey('pay_b'),
    );
    expect(receiptPersistenceIdempotencyKey('pay_a')).not.toBe(
      receiptPersistenceIdempotencyKey('pay_b'),
    );
    expect(terminalEventIdempotencyKey('pay_a')).not.toBe(
      terminalEventIdempotencyKey('pay_b'),
    );
  });

  it('fails closed for an empty payment identifier in every helper', async () => {
    await expect(workflowInstanceIdempotencyKey('')).rejects.toThrow(TypeError);
    expect(() => executorInvocationIdempotencyKey('')).toThrow(TypeError);
    expect(() => pccIdempotencyKey('')).toThrow(TypeError);
    expect(() => settlementIdempotencyKey('')).toThrow(TypeError);
    expect(() => resultPersistenceIdempotencyKey('')).toThrow(TypeError);
    expect(() => receiptPersistenceIdempotencyKey('')).toThrow(TypeError);
    expect(() => terminalEventIdempotencyKey('')).toThrow(TypeError);
  });
});
