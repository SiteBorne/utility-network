import { describe, it, expect } from 'vitest';
import {
  JobState,
  AllowedTransitions,
  TerminalStates,
  isValidTransition,
  isTerminalState,
  canTransitionFrom,
  createStateEvent,
  TransitionReason,
  ActorClass,
} from '../src/control-plane/state-machine';

describe('State Machine', () => {
  describe('Allowed Transitions', () => {
    it('allows RECEIVED -> VALIDATED', () => {
      expect(isValidTransition('RECEIVED', 'VALIDATED')).toBe(true);
    });

    it('allows RECEIVED -> REJECTED', () => {
      expect(isValidTransition('RECEIVED', 'REJECTED')).toBe(true);
    });

    it('allows VALIDATED -> QUOTED', () => {
      expect(isValidTransition('VALIDATED', 'QUOTED')).toBe(true);
    });

    it('allows VALIDATED -> REJECTED', () => {
      expect(isValidTransition('VALIDATED', 'REJECTED')).toBe(true);
    });

    it('allows VALIDATED -> REQUOTE_REQUIRED', () => {
      expect(isValidTransition('VALIDATED', 'REQUOTE_REQUIRED')).toBe(true);
    });

    it('allows QUOTED -> PAYMENT_CHALLENGED', () => {
      expect(isValidTransition('QUOTED', 'PAYMENT_CHALLENGED')).toBe(true);
    });

    it('allows QUOTED -> LOCKED', () => {
      expect(isValidTransition('QUOTED', 'LOCKED')).toBe(true);
    });

    it('allows PAYMENT_CHALLENGED -> PAYMENT_VERIFIED', () => {
      expect(isValidTransition('PAYMENT_CHALLENGED', 'PAYMENT_VERIFIED')).toBe(true);
    });

    it('allows PAYMENT_VERIFIED -> LOCKED', () => {
      expect(isValidTransition('PAYMENT_VERIFIED', 'LOCKED')).toBe(true);
    });

    it('allows LOCKED -> ROUTED', () => {
      expect(isValidTransition('LOCKED', 'ROUTED')).toBe(true);
    });

    it('allows ROUTED -> EXECUTING', () => {
      expect(isValidTransition('ROUTED', 'EXECUTING')).toBe(true);
    });

    it('allows EXECUTING -> VERIFYING', () => {
      expect(isValidTransition('EXECUTING', 'VERIFYING')).toBe(true);
    });

    it('allows VERIFYING -> SETTLING', () => {
      expect(isValidTransition('VERIFYING', 'SETTLING')).toBe(true);
    });

    it('allows SETTLING -> DELIVERED', () => {
      expect(isValidTransition('SETTLING', 'DELIVERED')).toBe(true);
    });

    it('allows RETRYABLE -> ROUTED', () => {
      expect(isValidTransition('RETRYABLE', 'ROUTED')).toBe(true);
    });

    it('allows REQUOTE_REQUIRED -> QUOTED', () => {
      expect(isValidTransition('REQUOTE_REQUIRED', 'QUOTED')).toBe(true);
    });
  });

  describe('Forbidden Transitions', () => {
    it('forbids RECEIVED -> EXECUTING', () => {
      expect(isValidTransition('RECEIVED', 'EXECUTING')).toBe(false);
    });

    it('forbids VALIDATED -> DELIVERED', () => {
      expect(isValidTransition('VALIDATED', 'DELIVERED')).toBe(false);
    });

    it('forbids QUOTED -> EXECUTING', () => {
      expect(isValidTransition('QUOTED', 'EXECUTING')).toBe(false);
    });

    it('forbids DELIVERED -> any state', () => {
      expect(isValidTransition('DELIVERED', 'RECEIVED')).toBe(false);
      expect(isValidTransition('DELIVERED', 'VALIDATED')).toBe(false);
      expect(isValidTransition('DELIVERED', 'EXECUTING')).toBe(false);
    });

    it('forbids TOMBSTONED -> any state', () => {
      expect(isValidTransition('TOMBSTONED', 'RECEIVED')).toBe(false);
      expect(isValidTransition('TOMBSTONED', 'VALIDATED')).toBe(false);
    });

    it('forbids REJECTED -> EXECUTING', () => {
      expect(isValidTransition('REJECTED', 'EXECUTING')).toBe(false);
    });

    it('forbids REJECTED -> VALIDATED', () => {
      expect(isValidTransition('REJECTED', 'VALIDATED')).toBe(false);
    });
  });

  describe('Terminal States', () => {
    it('identifies DELIVERED as terminal', () => {
      expect(isTerminalState('DELIVERED')).toBe(true);
    });

    it('identifies TOMBSTONED as terminal', () => {
      expect(isTerminalState('TOMBSTONED')).toBe(true);
    });

    it('does not identify RECEIVED as terminal', () => {
      expect(isTerminalState('RECEIVED')).toBe(false);
    });

    it('does not identify EXECUTING as terminal', () => {
      expect(isTerminalState('EXECUTING')).toBe(false);
    });

    it('TerminalStates includes DELIVERED and TOMBSTONED', () => {
      expect(TerminalStates).toContain('DELIVERED');
      expect(TerminalStates).toContain('TOMBSTONED');
      expect(TerminalStates.length).toBe(2);
    });
  });

  describe('canTransitionFrom', () => {
    it('returns false for terminal states', () => {
      expect(canTransitionFrom('DELIVERED')).toBe(false);
      expect(canTransitionFrom('TOMBSTONED')).toBe(false);
    });

    it('returns true for non-terminal states', () => {
      expect(canTransitionFrom('RECEIVED')).toBe(true);
      expect(canTransitionFrom('VALIDATED')).toBe(true);
      expect(canTransitionFrom('EXECUTING')).toBe(true);
    });
  });

  describe('createStateEvent', () => {
    it('creates valid state event for allowed transition', () => {
      const event = createStateEvent(
        '550e8400-e29b-41d4-a716-446655440000',
        1,
        'RECEIVED',
        'VALIDATED',
        'VALIDATION_PASSED',
        'SYSTEM'
      );

      expect(event.job_id).toBe('550e8400-e29b-41d4-a716-446655440000');
      expect(event.attempt_number).toBe(1);
      expect(event.from_state).toBe('RECEIVED');
      expect(event.to_state).toBe('VALIDATED');
      expect(event.reason).toBe('VALIDATION_PASSED');
      expect(event.actor).toBe('SYSTEM');
      expect(event.timestamp).toBeDefined();
      expect(event.attempt_hash).toBeDefined();
    });

    it('throws TerminalStateError for terminal from state', () => {
      expect(() =>
        createStateEvent(
          '550e8400-e29b-41d4-a716-446655440000',
          1,
          'DELIVERED',
          'RECEIVED',
          'VALIDATION_PASSED',
          'SYSTEM'
        )
      ).toThrow('Cannot transition from terminal state: DELIVERED');
    });

    it('throws InvalidTransitionError for forbidden transition', () => {
      expect(() =>
        createStateEvent(
          '550e8400-e29b-41d4-a716-446655440000',
          1,
          'RECEIVED',
          'DELIVERED',
          'VALIDATION_PASSED',
          'SYSTEM'
        )
      ).toThrow('Invalid state transition: RECEIVED -> DELIVERED');
    });

    it('includes evidence_ref when provided', () => {
      const event = createStateEvent(
        '550e8400-e29b-41d4-a716-446655440000',
        1,
        'RECEIVED',
        'VALIDATED',
        'VALIDATION_PASSED',
        'SYSTEM',
        'evidence-456'
      );

      expect(event.evidence_ref).toBe('evidence-456');
    });

    it('includes previous_state_hash when provided', () => {
      const event = createStateEvent(
        '550e8400-e29b-41d4-a716-446655440000',
        1,
        'RECEIVED',
        'VALIDATED',
        'VALIDATION_PASSED',
        'SYSTEM',
        undefined,
        'hash-789'
      );

      expect(event.previous_state_hash).toBe('hash-789');
    });
  });

  describe('Transition Rules', () => {
    it('defines all expected states', () => {
      const allStates = Object.keys(AllowedTransitions) as JobState[];
      expect(allStates).toContain('RECEIVED');
      expect(allStates).toContain('VALIDATED');
      expect(allStates).toContain('QUOTED');
      expect(allStates).toContain('PAYMENT_CHALLENGED');
      expect(allStates).toContain('PAYMENT_VERIFIED');
      expect(allStates).toContain('LOCKED');
      expect(allStates).toContain('ROUTED');
      expect(allStates).toContain('EXECUTING');
      expect(allStates).toContain('VERIFYING');
      expect(allStates).toContain('SETTLING');
      expect(allStates).toContain('DELIVERED');
      expect(allStates).toContain('REJECTED');
      expect(allStates).toContain('REQUOTE_REQUIRED');
      expect(allStates).toContain('RETRYABLE');
      expect(allStates).toContain('REFUND_REQUIRED');
      expect(allStates).toContain('QUARANTINED');
      expect(allStates).toContain('TOMBSTONED');
    });

    it('has no outgoing transitions from terminal states', () => {
      expect(AllowedTransitions.DELIVERED).toEqual([]);
      expect(AllowedTransitions.TOMBSTONED).toEqual([]);
    });

    it('has retry transitions from RETRYABLE', () => {
      expect(AllowedTransitions.RETRYABLE).toContain('ROUTED');
      expect(AllowedTransitions.RETRYABLE).toContain('REJECTED');
      expect(AllowedTransitions.RETRYABLE).toContain('QUARANTINED');
    });

    it('has quarantine transitions to terminal states', () => {
      expect(AllowedTransitions.QUARANTINED).toContain('REJECTED');
      expect(AllowedTransitions.QUARANTINED).toContain('TOMBSTONED');
    });
  });
});
