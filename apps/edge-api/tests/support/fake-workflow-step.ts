/**
 * SUN-1221E6R-H2AWI-2 — a fake `WorkflowStep` double used by every
 * paid-continuation-workflow test. Mirrors Cloudflare Workflows' own
 * documented step-memoization contract closely enough to prove this
 * checkpoint's orchestration/crash-safety claims without a live Workflow
 * resource (per the frozen plan's own instruction, Task 2.8):
 *
 *   - `step.do(name, config, callback)` records every call (name + config)
 *     for inspection — this is how retry-policy mutation tests and
 *     idempotency-key-usage tests observe what the orchestration function
 *     actually declared.
 *   - If `name` is already present in this instance's `priorResults` map
 *     (constructor-seeded, simulating a Workflow *resuming* after a crash
 *     with some steps already durably completed), the callback is NEVER
 *     invoked — the memoized value is returned directly. This is the
 *     exact "crash matrix" mechanism Task 2.8 requires.
 *   - Otherwise the callback is invoked exactly once. If it throws, the
 *     step is NOT memoized (nothing is added to `completed`) — mirroring
 *     the real platform's "only a successfully completed step is
 *     memoized" guarantee. This fake does not itself simulate the
 *     platform's automatic in-step retry loop (`config.retries.limit`) —
 *     that is the platform's own job, already covered by
 *     `WORKFLOW_STEP_RETRY_CONFIGURABLE` (design §2); this fake exists to
 *     prove the orchestration function declares the correct policy and
 *     reacts correctly to a callback's single outcome, not to re-implement
 *     the platform's retry engine.
 *
 * `completed` (exposed) lets a test seed a *second* `FakeWorkflowStep`
 * instance with exactly the steps a "first workflow run" would have
 * already durably finished, to simulate a restart from that boundary.
 */
export interface RecordedStepCall {
  readonly name: string;
  readonly config: {
    readonly retries?: { readonly limit: number; readonly delay?: unknown; readonly backoff?: string };
    readonly timeout?: unknown;
  };
}

export class FakeWorkflowStep {
  readonly calls: RecordedStepCall[] = [];
  readonly completed: Map<string, unknown>;

  constructor(priorResults: ReadonlyMap<string, unknown> = new Map()) {
    this.completed = new Map(priorResults);
  }

  async do<T>(
    name: string,
    config: RecordedStepCall['config'],
    callback: () => Promise<T>
  ): Promise<T> {
    this.calls.push({ name, config });
    if (this.completed.has(name)) {
      return this.completed.get(name) as T;
    }
    const result = await callback();
    this.completed.set(name, result);
    return result;
  }
}
