import { describe, expect, it } from 'vitest';
import {
  isLegalLifecycleTransition,
  isTerminalLifecycleStage,
  PAYMENT_LIFECYCLE_TRANSITIONS,
} from './stage';
import type { PaymentLifecycleStage } from './stage';

describe('PAYMENT_LIFECYCLE_TRANSITIONS legal graph (directive §7)', () => {
  it.each([
    ['acquired', 'verified'],
    ['acquired', 'verification_failed'],
    ['verified', 'settled'],
    ['verified', 'settlement_failed'],
  ] as const)('%s -> %s is legal', (from, to) => {
    expect(isLegalLifecycleTransition(from, to)).toBe(true);
  });

  it.each([
    ['acquired', 'settled'],
    ['acquired', 'settlement_failed'],
    ['verification_failed', 'verified'],
    ['verification_failed', 'settled'],
    ['settled', 'acquired'],
    ['settled', 'verified'],
    ['settlement_failed', 'settled'],
    ['verified', 'acquired'],
  ] as const)('%s -> %s is illegal', (from, to) => {
    expect(isLegalLifecycleTransition(from, to)).toBe(false);
  });

  it('no stage transitions to itself', () => {
    const stages = Object.keys(PAYMENT_LIFECYCLE_TRANSITIONS) as PaymentLifecycleStage[];
    for (const stage of stages) {
      expect(isLegalLifecycleTransition(stage, stage)).toBe(false);
    }
  });

  it('terminal stages have no outgoing legal transitions', () => {
    for (const stage of ['verification_failed', 'settled', 'settlement_failed'] as const) {
      expect(isTerminalLifecycleStage(stage)).toBe(true);
      expect(PAYMENT_LIFECYCLE_TRANSITIONS[stage]).toEqual([]);
    }
  });

  it('acquired and verified are not terminal', () => {
    expect(isTerminalLifecycleStage('acquired')).toBe(false);
    expect(isTerminalLifecycleStage('verified')).toBe(false);
  });
});
