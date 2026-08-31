/**
 * SUN-1221E6R-H2AWI-3 Task 3.3 — synchronous HTTP waiter over Workflow
 * status. All against a fake `WorkflowInstanceLike` double -- no live
 * Workflow resource.
 */
import { describe, expect, it, vi } from 'vitest';
import { waitForWorkflowResult } from '../src/control-plane/continuation/waiter';

function immediateSleep(calls: number[]) {
  return async (ms: number) => {
    calls.push(ms);
  };
}

describe('waitForWorkflowResult (SUN-1221E6R-H2AWI-3 Task 3.3)', () => {
  it('client stays connected, Workflow completes quickly -> returns the terminal output on the first poll', async () => {
    const status = vi.fn().mockResolvedValue({ status: 'complete', output: { status: 'settled' } });
    const outcome = await waitForWorkflowResult({ status }, { sleep: immediateSleep([]) });
    expect(outcome).toEqual({ kind: 'complete', output: { status: 'settled' } });
    expect(status).toHaveBeenCalledTimes(1);
  });

  it('client stays connected, Workflow takes a long time -> keeps polling with no premature timeout, eventually returns the terminal result', async () => {
    let calls = 0;
    const status = vi.fn().mockImplementation(async () => {
      calls += 1;
      // Simulate a genuinely slow Workflow: 500 polls of "still running"
      // before completion. No SITEBORNE-imposed max wait exists in this
      // module, so the waiter must not give up early regardless of how
      // many polls that takes.
      if (calls < 500) return { status: 'running' };
      return { status: 'complete', output: { status: 'settled', job_id: 'job_1' } };
    });
    const sleepCalls: number[] = [];
    const outcome = await waitForWorkflowResult(
      { status },
      { sleep: immediateSleep(sleepCalls), pollIntervalMs: 10 }
    );
    expect(outcome).toEqual({ kind: 'complete', output: { status: 'settled', job_id: 'job_1' } });
    expect(calls).toBe(500);
    expect(sleepCalls.every((ms) => ms === 10)).toBe(true);
  });

  it('client disconnects mid-wait (AbortSignal fires) -> the waiter stops promptly and reports disconnected, never calling any cancel/terminate-shaped method', async () => {
    const controller = new AbortController();
    let calls = 0;
    const status = vi.fn().mockImplementation(async () => {
      calls += 1;
      if (calls === 3) controller.abort();
      return { status: 'running' };
    });
    const outcome = await waitForWorkflowResult(
      { status },
      { signal: controller.signal, sleep: immediateSleep([]), pollIntervalMs: 5 }
    );
    expect(outcome).toEqual({ kind: 'disconnected' });
    // The poll loop must not spin indefinitely after abort -- a handful
    // of polls (the 3 before abort, plus at most one more before the
    // post-poll abort check fires) is expected; hundreds would indicate
    // the signal is not actually being honored.
    expect(calls).toBeLessThan(10);
  });

  it('an already-aborted signal short-circuits before ever calling status()', async () => {
    const controller = new AbortController();
    controller.abort();
    const status = vi.fn().mockResolvedValue({ status: 'running' });
    const outcome = await waitForWorkflowResult(
      { status },
      { signal: controller.signal, sleep: immediateSleep([]) }
    );
    expect(outcome).toEqual({ kind: 'disconnected' });
    expect(status).not.toHaveBeenCalled();
  });

  it('maps an errored InstanceStatus to a structured errored outcome', async () => {
    const status = vi
      .fn()
      .mockResolvedValue({ status: 'errored', error: { name: 'Error', message: 'boom' } });
    const outcome = await waitForWorkflowResult({ status }, { sleep: immediateSleep([]) });
    expect(outcome).toEqual({ kind: 'errored', error: { name: 'Error', message: 'boom' } });
  });

  it('maps a terminated InstanceStatus to a terminated outcome', async () => {
    const status = vi.fn().mockResolvedValue({ status: 'terminated' });
    const outcome = await waitForWorkflowResult({ status }, { sleep: immediateSleep([]) });
    expect(outcome).toEqual({ kind: 'terminated' });
  });

  it('never sleeps once a terminal status or disconnect is observed (no trailing/needless delay)', async () => {
    const sleepCalls: number[] = [];
    const status = vi.fn().mockResolvedValue({ status: 'complete', output: {} });
    await waitForWorkflowResult({ status }, { sleep: immediateSleep(sleepCalls) });
    expect(sleepCalls).toHaveLength(0);
  });
});
