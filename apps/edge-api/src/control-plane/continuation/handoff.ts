/**
 * SUN-1221E6R-H2AWI-3 — payment-verified handoff into the durable
 * paid-continuation Workflow.
 *
 * Local source + tests only. No Workflow resource, no deployment. See
 * docs/superpowers/plans/2026-08-31-siteborne-durable-paid-continuation-workflow.md
 * (H2AWI-3, Task 3.1) and
 * docs/reports/SUN-1221E6R-H2AW-durable-paid-continuation-workflow-design.md
 * (§4-5) for the frozen handoff point and instance-ID derivation this file
 * implements.
 *
 * `createOrJoinPaidContinuation` is the ONLY place `x402-service.ts` ever
 * touches the Cloudflare Workflows binding. It:
 *   1. Derives the deterministic instance ID from `payment_identifier`
 *      (reuses `deriveWorkflowInstanceId` from H2AWI-1 -- never
 *      reimplemented).
 *   2. Seals the continuation envelope (reuses `sealContinuationEnvelope`
 *      from H2AWI-1 -- never reimplemented; the raw signed payment
 *      material this function accepts as `payload` is never touched,
 *      logged, or inspected here -- it is handed straight through to the
 *      envelope's AEAD boundary).
 *   3. Calls `workflow.create({id, params})`. If an instance with that
 *      deterministic ID already exists (the SAME payment retried), the
 *      real Cloudflare Workflows binding throws -- confirmed against
 *      live docs this checkpoint
 *      (developers.cloudflare.com/workflows/build/workers-api/#create:
 *      "Throws an error if the provided ID is already used by an
 *      existing instance"). No `ExistingInstanceInstantiationError` class
 *      is exported anywhere in the installed `@cloudflare/workers-types`
 *      package (grepped this checkpoint) or documented on that page, so
 *      this module never pattern-matches an error class/message that
 *      isn't actually part of the verified API surface. Instead, on ANY
 *      `create()` failure it attempts `workflow.get(id)` -- the only
 *      scenario in which `get()` can succeed immediately after a failed
 *      `create()` for the SAME deterministic ID is exactly the duplicate-
 *      ID case, so this is an error-shape-agnostic, verified-API-only way
 *      to implement the required idempotent join behavior.
 *
 * Never creates a second Workflow instance for the same payment, never
 * calls `.settle()` (that lives exclusively inside the Workflow, H2AWI-2),
 * never persists the raw signed payload anywhere outside the sealed
 * envelope.
 */
import type { ContinuationEnvelopeMetadata, WorkflowContinuationInput } from './types';
import { deriveWorkflowInstanceId } from './instance-id';
import { sealContinuationEnvelope } from './envelope';

/** The narrow slice of a real Cloudflare `WorkflowInstance` this module
 * (and `waiter.ts`) ever calls -- `Pick<>`'d in spirit from the real
 * `@cloudflare/workers-types` `WorkflowInstance` class (verified against
 * that package's `latest/index.d.ts` and live Cloudflare docs this
 * checkpoint), never forked or reinvented. A real `WorkflowInstance`
 * satisfies this structurally with no adapter needed. */
export interface WorkflowInstanceLike {
  readonly id: string;
  status(): Promise<{
    readonly status:
      | 'queued'
      | 'running'
      | 'paused'
      | 'errored'
      | 'terminated'
      | 'complete'
      | 'waiting'
      | 'waitingForPause'
      | 'unknown';
    readonly error?: { readonly name: string; readonly message: string };
    readonly output?: unknown;
  }>;
}

/** The narrow slice of a real Cloudflare `Workflow<PARAMS>` binding this
 * module ever calls -- `create`/`get`, matching the real binding's
 * documented signatures exactly (`create(options?): Promise<WorkflowInstance>`,
 * `get(id): Promise<WorkflowInstance>`). Never `createBatch`, `pause`,
 * `resume`, `terminate`, or `restart` -- this checkpoint never calls any
 * of those. */
export interface WorkflowBindingLike {
  create(options: {
    readonly id: string;
    readonly params: WorkflowContinuationInput;
  }): Promise<WorkflowInstanceLike>;
  get(id: string): Promise<WorkflowInstanceLike>;
}

export interface CreateOrJoinPaidContinuationDeps {
  readonly workflow: WorkflowBindingLike;
  /** Imported once by the caller (H2AWI-1's own boundary --
   * `sealContinuationEnvelope` never reads a secret binding itself). Real
   * production key provisioning/import wiring is H2AWI-4 scope (Task
   * 4.2/4.5); this checkpoint only defines the dependency shape. */
  readonly envelopeKey: CryptoKey;
  readonly envelopeKeyId: string;
}

export interface CreateOrJoinPaidContinuationInput {
  readonly paymentIdentifier: string;
  /** The full pre-encryption continuation payload (the decrypted shape
   * `workflows/paid-continuation-workflow.ts`'s `DecryptedContinuationPayload`
   * expects on the other side of the envelope -- this module treats it as
   * opaque `unknown`, per H2AWI-1's envelope boundary, and never inspects
   * or logs it). */
  readonly payload: unknown;
  readonly metadata: ContinuationEnvelopeMetadata;
  readonly requestId: string;
}

export type CreateOrJoinPaidContinuationResult =
  | {
      readonly outcome: 'created';
      readonly instance: WorkflowInstanceLike;
      readonly instanceId: string;
    }
  | {
      readonly outcome: 'joined';
      readonly instance: WorkflowInstanceLike;
      readonly instanceId: string;
    }
  | {
      readonly outcome: 'create_failed';
      readonly instanceId: string;
      readonly error: unknown;
    };

/**
 * Idempotent: calling this twice with the same `paymentIdentifier` always
 * resolves to the SAME Workflow instance (`created` the first time,
 * `joined` every time after) -- proof requirement for mission §16/design
 * §5/§19. Never creates a second instance, never calls `.settle()`
 * directly (that call lives exclusively inside the Workflow -- see
 * `workflows/paid-continuation-workflow.ts`).
 */
export async function createOrJoinPaidContinuation(
  deps: CreateOrJoinPaidContinuationDeps,
  input: CreateOrJoinPaidContinuationInput
): Promise<CreateOrJoinPaidContinuationResult> {
  const instanceId = await deriveWorkflowInstanceId(input.paymentIdentifier);

  const envelope = await sealContinuationEnvelope({
    payload: input.payload,
    metadata: input.metadata,
    keyMaterial: deps.envelopeKey,
    keyId: deps.envelopeKeyId,
  });

  const workflowInput: WorkflowContinuationInput = {
    envelope,
    metadata: input.metadata,
    request_id: input.requestId,
  };

  try {
    const instance = await deps.workflow.create({ id: instanceId, params: workflowInput });
    return { outcome: 'created', instance, instanceId };
  } catch (createError) {
    // NEVER a second create() attempt, and never a settle() fallback --
    // the only recovery path from here is joining whatever instance
    // already owns this deterministic ID.
    try {
      const instance = await deps.workflow.get(instanceId);
      return { outcome: 'joined', instance, instanceId };
    } catch {
      // get() also failed -- this was a genuine creation failure, not a
      // duplicate-ID race. No synchronous fallback exists (design §21):
      // no executor invocation, no settlement, ever, on this path.
      return { outcome: 'create_failed', instanceId, error: createError };
    }
  }
}

/**
 * A client retrying with the SAME `payment_identifier` (mission §16/design
 * §19: `RETRY_WHILE_WORKFLOW_RUNNING_BEHAVIOR`) must only ever JOIN an
 * already-durably-created instance -- never create a new one from
 * whatever (potentially incomplete or re-derived) data the retry request
 * happens to carry. This is deliberately `get()`-only, with no `create()`
 * fallback of any kind, so a retry can never accidentally seed a Workflow
 * instance from synthetic/placeholder settlement data. Returns `null`
 * when no instance exists yet for this payment (the original request
 * has not reached the durable handoff point) -- the caller's own
 * pre-existing recovery/`202` fallback remains the safety net for that
 * case, unchanged.
 */
export async function joinExistingPaidContinuation(
  workflow: WorkflowBindingLike,
  paymentIdentifier: string
): Promise<{ readonly instance: WorkflowInstanceLike; readonly instanceId: string } | null> {
  const instanceId = await deriveWorkflowInstanceId(paymentIdentifier);
  try {
    const instance = await workflow.get(instanceId);
    return { instance, instanceId };
  } catch {
    return null;
  }
}
