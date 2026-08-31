/**
 * SUN-1221E6R-H2AWI-3 — synchronous HTTP waiter over a durable Workflow
 * instance's terminal status.
 *
 * FROZEN PRODUCT DECISION FOR THIS CHECKPOINT: no SITEBORNE-imposed
 * server-side waiter timeout while the HTTP client remains connected. This
 * module therefore NEVER owns a maximum-wait clock -- the only two ways
 * `waitForWorkflowResult` ever returns are:
 *   (a) the Workflow instance reaches a terminal `InstanceStatus`
 *       ('complete' | 'errored' | 'terminated'), or
 *   (b) the caller's own request disconnects, detected via the standard
 *       Fetch `AbortSignal` Hono exposes on `c.req.raw.signal` (confirmed
 *       against `@cloudflare/workers-types`'s `Request.signal: AbortSignal`
 *       and Hono's `HonoRequest.raw: Request` this checkpoint).
 *
 * Mechanism: poll `instance.status()` (the real, documented Cloudflare
 * Workflows binding API -- verified live this checkpoint against
 * developers.cloudflare.com/workflows/build/workers-api/#status and
 * #instancestatus; no other waiting primitive is invented). A disconnect
 * only ever stops THIS request's own poll loop -- it never cancels,
 * terminates, or pauses the Workflow instance itself (this module never
 * calls `.terminate()`/`.pause()`), which is exactly the property that
 * lets the Workflow survive a client disconnect: the durable handoff
 * (`handoff.ts`) already happened before this loop starts, so the
 * Workflow's own continuation is fully decoupled from whether this
 * particular HTTP invocation keeps running.
 */
import type { WorkflowInstanceLike } from './handoff';

export interface WaitForWorkflowResultOptions {
  /** The request's own disconnect signal. Aborting this only stops the
   * poll loop -- never the Workflow. */
  readonly signal?: AbortSignal;
  /** Poll cadence. Default chosen to keep interim CPU/status-call volume
   * low without materially delaying a fast-completing Workflow's response
   * -- NOT a correctness bound (see module doc comment above). */
  readonly pollIntervalMs?: number;
  /** Injectable so tests never depend on real wall-clock delay. */
  readonly sleep?: (ms: number) => Promise<void>;
}

export type WorkflowWaitOutcome =
  | { readonly kind: 'complete'; readonly output: unknown }
  | { readonly kind: 'errored'; readonly error: { readonly name: string; readonly message: string } }
  | { readonly kind: 'terminated' }
  | { readonly kind: 'disconnected' };

const DEFAULT_POLL_INTERVAL_MS = 250;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Waits for `instance` to reach a terminal `InstanceStatus`, or for
 * `options.signal` to abort -- whichever happens first. Deliberately has
 * NO maximum-duration parameter: see module doc comment. Never mutates or
 * cancels the Workflow instance.
 */
export async function waitForWorkflowResult(
  instance: Pick<WorkflowInstanceLike, 'status'>,
  options: WaitForWorkflowResultOptions = {}
): Promise<WorkflowWaitOutcome> {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const sleep = options.sleep ?? defaultSleep;
  const signal = options.signal;

  for (;;) {
    if (signal?.aborted) return { kind: 'disconnected' };

    const current = await instance.status();

    if (current.status === 'complete') {
      return { kind: 'complete', output: current.output };
    }
    if (current.status === 'errored') {
      return {
        kind: 'errored',
        error: current.error ?? { name: 'workflow_errored', message: 'Workflow instance errored' },
      };
    }
    if (current.status === 'terminated') {
      return { kind: 'terminated' };
    }

    if (signal?.aborted) return { kind: 'disconnected' };
    await sleep(pollIntervalMs);
  }
}
