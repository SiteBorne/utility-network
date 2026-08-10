/**
 * Governance-model fix validation (SUN-0700A blocked-frontier closure) —
 * directive §7's 9 scenarios, using the real task-graph logic
 * (`isDependencyReady`/`validateExecutionFrontier`), never a mock.
 */
import { describe, expect, it } from 'vitest';
import type { FrontierTask } from './task-frontier';
import { dependencyReadyUnfinishedTasks, validateExecutionFrontier } from './task-frontier';

function task(overrides: Partial<FrontierTask> & { id: string }): FrontierTask {
  return {
    state: 'pending',
    dependencies: [],
    blocker: null,
    ...overrides,
  };
}

describe('validateExecutionFrontier', () => {
  it('1. exactly one legitimate active task (dependency satisfied) -> pass', () => {
    const tasks = [
      task({ id: 'A', state: 'accepted' }),
      task({ id: 'B', state: 'active', dependencies: ['A'] }),
    ];
    const result = validateExecutionFrontier(tasks);
    expect(result.valid).toBe(true);
    expect(result.frontierStatus).toBe('executable');
  });

  it('2. two active tasks -> fail', () => {
    const tasks = [
      task({ id: 'A', state: 'accepted' }),
      task({ id: 'B', state: 'active', dependencies: ['A'] }),
      task({ id: 'C', state: 'in_progress', dependencies: ['A'] }),
    ];
    const result = validateExecutionFrontier(tasks);
    expect(result.valid).toBe(false);
    expect(result.failures.some((f) => f.includes('At most one active'))).toBe(true);
  });

  it('3. zero active + a dependency-ready executable (pending) task exists -> fail', () => {
    const tasks = [task({ id: 'A', state: 'accepted' }), task({ id: 'B', dependencies: ['A'] })];
    const result = validateExecutionFrontier(tasks);
    expect(result.valid).toBe(false);
    expect(result.failures.some((f) => f.includes('unclaimed executable work'))).toBe(true);
  });

  it('4. zero active + every dependency-ready task blocked_external with a real reason -> pass', () => {
    const tasks = [
      task({ id: 'A', state: 'accepted' }),
      task({
        id: 'B',
        state: 'blocked_external',
        dependencies: ['A'],
        blocker: 'Requires CDP credentials',
      }),
    ];
    const result = validateExecutionFrontier(tasks);
    expect(result.valid).toBe(true);
    expect(result.frontierStatus).toBe('blocked_external');
  });

  it('5. zero active + one blocked and one executable dependency-ready task -> fail', () => {
    const tasks = [
      task({ id: 'A', state: 'accepted' }),
      task({
        id: 'B',
        state: 'blocked_external',
        dependencies: ['A'],
        blocker: 'Requires CDP credentials',
      }),
      task({ id: 'C', state: 'pending', dependencies: ['A'] }),
    ];
    const result = validateExecutionFrontier(tasks);
    expect(result.valid).toBe(false);
    expect(result.failures.some((f) => f.includes('C') && f.includes('unclaimed'))).toBe(true);
  });

  it('6. a blocked task marked active (self-contradictory record) -> fail', () => {
    const tasks = [
      task({ id: 'A', state: 'accepted' }),
      task({
        id: 'B',
        state: 'active',
        dependencies: ['A'],
        blocker: 'Requires CDP credentials',
      }),
    ];
    const result = validateExecutionFrontier(tasks);
    expect(result.valid).toBe(false);
    expect(result.failures.some((f) => f.includes('cannot be active'))).toBe(true);
  });

  it('7. dependency-not-ready downstream tasks do not force activation (blocked frontier still legitimate)', () => {
    const tasks = [
      task({ id: 'A', state: 'accepted' }),
      task({
        id: 'B',
        state: 'blocked_external',
        dependencies: ['A'],
        blocker: 'Requires CDP credentials',
      }),
      // C depends on B, which is NOT resolved -> C is not dependency-ready,
      // so its own `pending` state must never force this frontier invalid.
      task({ id: 'C', state: 'pending', dependencies: ['B'] }),
    ];
    const ready = dependencyReadyUnfinishedTasks(tasks);
    expect(ready.map((t) => t.id)).toEqual(['B']);
    const result = validateExecutionFrontier(tasks);
    expect(result.valid).toBe(true);
    expect(result.frontierStatus).toBe('blocked_external');
  });

  it('8. all work accepted/terminal (nothing dependency-ready and unresolved) -> pass', () => {
    const tasks = [
      task({ id: 'A', state: 'accepted' }),
      task({ id: 'B', state: 'accepted', dependencies: ['A'] }),
      task({ id: 'C', state: 'superseded', dependencies: ['B'] }),
    ];
    const result = validateExecutionFrontier(tasks);
    expect(result.valid).toBe(true);
    expect(result.frontierStatus).toBe('blocked_external');
  });

  it('9. blocked_external task with a missing/empty blocker reason -> fail', () => {
    const tasksNull = [
      task({ id: 'A', state: 'accepted' }),
      task({ id: 'B', state: 'blocked_external', dependencies: ['A'], blocker: null }),
    ];
    expect(validateExecutionFrontier(tasksNull).valid).toBe(false);

    const tasksEmpty = [
      task({ id: 'A', state: 'accepted' }),
      task({ id: 'B', state: 'blocked_external', dependencies: ['A'], blocker: '   ' }),
    ];
    const resultEmpty = validateExecutionFrontier(tasksEmpty);
    expect(resultEmpty.valid).toBe(false);
    expect(resultEmpty.failures.some((f) => f.includes('no genuine'))).toBe(true);
  });

  it('extra: the real SITEBORNE task graph shape (SUN-0700A accepted, SUN-0700B blocked_external, downstream pending-but-not-ready) validates as a legitimate blocked frontier', () => {
    const tasks = [
      task({ id: 'SUN-0600', state: 'accepted' }),
      task({ id: 'SUN-0700A', state: 'accepted', dependencies: ['SUN-0600'] }),
      task({
        id: 'SUN-0700B',
        state: 'blocked_external',
        dependencies: ['SUN-0700A'],
        blocker: 'Requires CDP credentials and a wallet (blocked_external)',
      }),
      task({ id: 'SUN-0800', state: 'pending', dependencies: ['SUN-0700B'] }),
      task({ id: 'SUN-0900', state: 'pending', dependencies: ['SUN-0800'] }),
    ];
    const result = validateExecutionFrontier(tasks);
    expect(result.valid).toBe(true);
    expect(result.frontierStatus).toBe('blocked_external');
  });

  it('a task depending on a nonexistent id is never dependency-ready (fails closed, not silently ready)', () => {
    const tasks = [task({ id: 'A', state: 'pending', dependencies: ['does-not-exist'] })];
    const ready = dependencyReadyUnfinishedTasks(tasks);
    expect(ready).toHaveLength(0);
    // Zero active, zero dependency-ready -> terminal/legitimate, since
    // nothing is actually executable (A's dependency is missing, not
    // resolved).
    expect(validateExecutionFrontier(tasks).valid).toBe(true);
  });
});
