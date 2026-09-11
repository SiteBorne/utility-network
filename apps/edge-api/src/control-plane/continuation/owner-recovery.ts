import type { WorkflowBindingLike, WorkflowInstanceLike } from './handoff';
import type {
  D1WorkflowOwnerIntentRepository,
  WorkflowOwnerIntent,
} from '../repositories/d1/workflow-owner-intents';

const DEFAULT_MAX_ATTEMPTS = 12;

function errorCode(error: unknown): string {
  const value = error instanceof Error ? error.name || error.message : 'workflow_create_failed';
  return value.slice(0, 96);
}

function nextAttemptAt(now: string, attempts: number): string {
  const delaySeconds = Math.min(300, 2 ** Math.min(attempts, 8));
  return new Date(Date.parse(now) + delaySeconds * 1000).toISOString();
}

export type DispatchOwnerIntentResult =
  | {
      readonly outcome: 'already_owned' | 'created' | 'joined_after_ambiguous_create';
      readonly instance: WorkflowInstanceLike;
    }
  | { readonly outcome: 'retry_scheduled' };

async function dispatch(
  repo: D1WorkflowOwnerIntentRepository,
  workflow: WorkflowBindingLike,
  intent: WorkflowOwnerIntent,
  now: () => string,
  maxAttempts: number
): Promise<DispatchOwnerIntentResult> {
  if (intent.status === 'workflow_created' || intent.status === 'completed') {
    const instance = await workflow.get(intent.workflowInstanceId);
    return { outcome: 'already_owned', instance };
  }

  // Resolve an earlier ambiguous create before issuing any new create.
  try {
    const instance = await workflow.get(intent.workflowInstanceId);
    await repo.markWorkflowCreated(intent.id, now());
    return { outcome: 'already_owned', instance };
  } catch {
    // Absence is the only state in which create is attempted.
  }

  try {
    const instance = await workflow.create({
      id: intent.workflowInstanceId,
      params: intent.workflowInput,
    });
    await repo.markWorkflowCreated(intent.id, now());
    return { outcome: 'created', instance };
  } catch (createError) {
    try {
      const instance = await workflow.get(intent.workflowInstanceId);
      await repo.markWorkflowCreated(intent.id, now());
      return { outcome: 'joined_after_ambiguous_create', instance };
    } catch {
      const timestamp = now();
      await repo.markAttemptFailed(
        intent.id,
        timestamp,
        errorCode(createError),
        nextAttemptAt(timestamp, intent.dispatchAttemptCount + 1),
        maxAttempts
      );
      return { outcome: 'retry_scheduled' };
    }
  }
}

export async function dispatchWorkflowOwnerIntent(
  repo: D1WorkflowOwnerIntentRepository,
  workflow: WorkflowBindingLike,
  paymentIdentifier: string,
  now: () => string = () => new Date().toISOString(),
  maxAttempts = DEFAULT_MAX_ATTEMPTS
): Promise<DispatchOwnerIntentResult> {
  const intent = await repo.getByPaymentIdentifier(paymentIdentifier);
  if (!intent) throw new Error('durable Workflow owner intent is missing');
  return dispatch(repo, workflow, intent, now, maxAttempts);
}

export async function recoverPendingWorkflowOwnerIntents(
  repo: D1WorkflowOwnerIntentRepository,
  workflow: WorkflowBindingLike,
  options: {
    readonly now?: () => string;
    readonly limit?: number;
    readonly maxAttempts?: number;
  } = {}
): Promise<readonly DispatchOwnerIntentResult[]> {
  const now = options.now ?? (() => new Date().toISOString());
  const intents = await repo.listRecoverable(now(), options.limit ?? 25);
  return Promise.all(
    intents.map((intent) =>
      dispatch(repo, workflow, intent, now, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)
    )
  );
}
