/**
 * Execution-frontier validation for TASKS.yaml (governance-model fix,
 * SUN-0700A blocked-frontier closure). Extracted from
 * scripts/validate-tasks.ts so the logic is independently unit-testable
 * (scripts/lib/task-frontier.test.ts) rather than only exercisable by
 * running the whole CLI script against the real TASKS.yaml.
 *
 * Two legitimate mutation-frontier states, and only two:
 *
 *   A. EXECUTABLE FRONTIER — exactly one task is `active`/`in_progress`,
 *      its dependencies are all resolved, and it is not itself blocked.
 *   B. BLOCKED FRONTIER — zero tasks are active, and every dependency-
 *      ready unfinished task (one whose dependencies are all resolved
 *      but which hasn't itself reached a resolved state) is explicitly
 *      `blocked_external` with a genuine, non-empty blocker reason. A
 *      dependency-ready task left `pending` (or any other non-blocked
 *      state) while zero tasks are active is never legitimate — that is
 *      unclaimed executable work, not a blocked frontier.
 *
 * This module deliberately does NOT relax "exactly one active" to "zero
 * or one active" unconditionally — the blocked-frontier allowance is
 * conditional on every dependency-ready task actually being blocked, so
 * a validator bug or an operator forgetting to activate real work still
 * fails closed.
 */

export interface FrontierTask {
  id: string;
  state: string;
  dependencies: string[];
  blocker: string | null;
}

/** States that count as "this task's own work is finished" for the
 * purpose of a *downstream* task's dependency-readiness check —
 * deliberately broader than just `accepted`: a `superseded`/`cancelled`/
 * `rejected` predecessor has also stopped being something downstream
 * work is waiting on, it simply won't itself ever reach `accepted`. */
export const RESOLVED_STATES = new Set([
  'accepted',
  'completed',
  'superseded',
  'cancelled',
  'rejected',
]);

const ACTIVE_STATES = new Set(['active', 'in_progress']);

/** True when every dependency of `task` is itself in a resolved state.
 * Uses the real task graph (each dependency looked up by id), never just
 * "the next numeric task" — a task with an unresolved *or missing*
 * dependency is never dependency-ready. */
export function isDependencyReady(
  task: FrontierTask,
  tasksById: ReadonlyMap<string, FrontierTask>
): boolean {
  return task.dependencies.every((depId) => {
    const dep = tasksById.get(depId);
    return dep !== undefined && RESOLVED_STATES.has(dep.state);
  });
}

/** Dependency-ready tasks whose own work is not yet resolved — the set
 * every blocked-frontier check is about: each one must be explicitly
 * blocked, or the frontier isn't legitimately blocked. */
export function dependencyReadyUnfinishedTasks(tasks: FrontierTask[]): FrontierTask[] {
  const tasksById = new Map(tasks.map((t) => [t.id, t]));
  return tasks.filter((t) => !RESOLVED_STATES.has(t.state) && isDependencyReady(t, tasksById));
}

export interface FrontierValidationResult {
  valid: boolean;
  /** Human-readable failure messages, empty when `valid`. */
  failures: string[];
  /** 'executable' | 'blocked_external' | 'invalid' — informational, not
   * itself a validity signal (an 'invalid' frontier is never valid). */
  frontierStatus: 'executable' | 'blocked_external' | 'invalid';
}

function hasGenuineBlocker(task: FrontierTask): boolean {
  return typeof task.blocker === 'string' && task.blocker.trim().length > 0;
}

/**
 * The one function `scripts/validate-tasks.ts` calls. Fails closed on
 * every axis directive-listed: 2+ active tasks; 0 active while an
 * executable (dependency-ready, non-blocked) task exists; a task marked
 * `active`/`in_progress` that also carries a non-null blocker (self-
 * contradictory); a dependency-ready task left `pending`/unblocked while
 * the frontier claims to be blocked; a `blocked_external` task with no
 * real blocker reason.
 */
export function validateExecutionFrontier(tasks: FrontierTask[]): FrontierValidationResult {
  const failures: string[] = [];
  const activeTasks = tasks.filter((t) => ACTIVE_STATES.has(t.state));

  // A task cannot simultaneously be "active" and carry a genuine blocker
  // — that is a self-contradictory record, not a legitimate active task,
  // regardless of how many other tasks are active.
  for (const t of activeTasks) {
    if (hasGenuineBlocker(t)) {
      failures.push(
        `Task ${t.id} is marked ${t.state} but also carries a blocker ("${t.blocker}") — a blocked task cannot be active`
      );
    }
  }

  if (activeTasks.length > 1) {
    failures.push(
      `At most one active mutation task is allowed (found ${activeTasks.length}: ${activeTasks.map((t) => t.id).join(', ')})`
    );
    return { valid: false, failures, frontierStatus: 'invalid' };
  }

  if (activeTasks.length === 1) {
    const [active] = activeTasks;
    const tasksById = new Map(tasks.map((t) => [t.id, t]));
    if (!isDependencyReady(active, tasksById)) {
      failures.push(
        `Active task ${active.id} has an unresolved dependency — it is not actually executable yet`
      );
    }
    return { valid: failures.length === 0, failures, frontierStatus: 'executable' };
  }

  // activeTasks.length === 0: the frontier is either legitimately
  // exhausted (no dependency-ready work remains at all) or legitimately
  // blocked (every dependency-ready task is explicitly blocked_external
  // with a real reason) — anything else is unclaimed executable work.
  const ready = dependencyReadyUnfinishedTasks(tasks);

  if (ready.length === 0) {
    // Terminal frontier: every task is resolved, or every unresolved
    // task still has an unresolved dependency. Nothing is being
    // silently left un-executed.
    return { valid: true, failures, frontierStatus: 'blocked_external' };
  }

  const unblocked = ready.filter((t) => t.state !== 'blocked_external');
  for (const t of unblocked) {
    failures.push(
      `Task ${t.id} is dependency-ready and unresolved but not active and not blocked_external (state: "${t.state}") — this is unclaimed executable work, not a legitimate blocked frontier`
    );
  }

  const blockedWithoutReason = ready.filter(
    (t) => t.state === 'blocked_external' && !hasGenuineBlocker(t)
  );
  for (const t of blockedWithoutReason) {
    failures.push(
      `Task ${t.id} is blocked_external but has no genuine (non-empty) blocker reason recorded`
    );
  }

  return {
    valid: failures.length === 0,
    failures,
    frontierStatus: failures.length === 0 ? 'blocked_external' : 'invalid',
  };
}
