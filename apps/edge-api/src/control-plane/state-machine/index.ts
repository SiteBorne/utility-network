import {
  JobStateSchema,
  AllowedTransitions,
  TerminalStates,
  RetryableStates,
  QuarantineStates,
  StateEventSchema,
  isValidTransition,
  isTerminalState,
  canTransitionFrom,
} from '../types';
import type { ActorClass, JobState, StateEvent, TransitionReason } from '../types';

export {
  JobStateSchema,
  AllowedTransitions,
  TerminalStates,
  RetryableStates,
  QuarantineStates,
  StateEventSchema,
  isValidTransition,
  isTerminalState,
  canTransitionFrom,
};

export type { JobState, TransitionReason, ActorClass, StateEvent };

export class InvalidTransitionError extends Error {
  constructor(
    public readonly fromState: JobState,
    public readonly toState: JobState,
    public readonly reason: TransitionReason,
    public readonly actor: ActorClass
  ) {
    super(`Invalid state transition: ${fromState} -> ${toState}`);
    this.name = 'InvalidTransitionError';
  }
}

export class TerminalStateError extends Error {
  constructor(public readonly state: JobState) {
    super(`Cannot transition from terminal state: ${state}`);
    this.name = 'TerminalStateError';
  }
}

export function createStateEvent(
  jobId: string,
  attemptNumber: number,
  fromState: JobState,
  toState: JobState,
  reason: TransitionReason,
  actor: ActorClass,
  evidenceRef?: string,
  previousStateHash?: string
): StateEvent {
  if (!canTransitionFrom(fromState)) {
    throw new TerminalStateError(fromState);
  }
  if (!isValidTransition(fromState, toState)) {
    throw new InvalidTransitionError(fromState, toState, reason, actor);
  }

  const timestamp = new Date().toISOString();
  const event: StateEvent = {
    id: crypto.randomUUID(),
    job_id: jobId,
    attempt_number: attemptNumber,
    from_state: fromState,
    to_state: toState,
    reason,
    actor,
    evidence_ref: evidenceRef,
    previous_state_hash: previousStateHash,
    timestamp,
    attempt_hash: computeAttemptHash(jobId, attemptNumber, fromState, toState, timestamp),
  };

  return StateEventSchema.parse(event);
}

function computeAttemptHash(
  jobId: string,
  attemptNumber: number,
  fromState: JobState,
  toState: JobState,
  timestamp: string
): string {
  const data = `${jobId}:${attemptNumber}:${fromState}:${toState}:${timestamp}`;
  return `sha256:${hash(data)}`;
}

function hash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(64, '0');
}

export function getAllowedTransitions(state: JobState): JobState[] {
  return AllowedTransitions[state] ?? [];
}

export function isTerminal(state: JobState): boolean {
  return isTerminalState(state);
}

export function isRetryable(state: JobState): boolean {
  return RetryableStates.includes(state);
}

export function isQuarantine(state: JobState): boolean {
  return QuarantineStates.includes(state);
}

export const TransitionRules = {
  allowed: AllowedTransitions,
  terminal: TerminalStates,
  retryable: RetryableStates,
  quarantine: QuarantineStates,
} as const;

export type TransitionRules = typeof TransitionRules;
