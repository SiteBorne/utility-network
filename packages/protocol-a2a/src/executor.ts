import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import { AgentEvent, type AgentExecutor } from '@a2a-js/sdk/server';
import { Role, TaskState, type Message, type Task } from '@a2a-js/sdk';
import { BUNDLED_SERVICE_INPUT_SCHEMAS, type SiteborneServiceId } from '@siteborne/protocol-x402';
import {
  A2A_PROTOCOL_VERSION,
  SITEBORNE_SERVICE_IDS,
  SITEBORNE_X402_EXTENSION_URI,
} from './constants';
import type {
  A2aServiceExecutionBoundary,
  A2aServiceExecutionOutcome,
  SiteborneA2aInvocation,
} from './types';

const SERVICE_ID_SET = new Set<string>(SITEBORNE_SERVICE_IDS);
const INVOCATION_KEYS = new Set(['skillId', 'serviceVersion', 'input', 'payment']);
const HOSTILE_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const ajv = new Ajv2020({ allErrors: false, strict: false, validateFormats: false });
// SUN-1000 checkpoint 1M: v1 and v2 share the identical (byte-for-byte)
// frozen input schema, but `bundleLocalRefs` (frozen-inputs.ts) returns a
// fresh object per call, so the two bundled objects are equal in content
// but not identical by reference — compiling both under the same Ajv
// instance throws (duplicate `$id`). Reuse the already-compiled validator
// whenever the schema's own `$id` was already registered, keyed by
// schema identity via Ajv's own registry rather than object identity.
const inputValidators = Object.fromEntries(
  SITEBORNE_SERVICE_IDS.map((serviceId) => {
    const schema = BUNDLED_SERVICE_INPUT_SCHEMAS[serviceId] as { $id?: string };
    const existing = schema.$id ? ajv.getSchema(schema.$id) : undefined;
    const validator = existing ?? ajv.compile(schema as object);
    return [serviceId, validator];
  })
) as Record<SiteborneServiceId, ValidateFunction>;

const defaultBoundary: A2aServiceExecutionBoundary = {
  async execute(serviceId) {
    return {
      outcome: 'failed',
      code: 'payment_required',
      message: `${serviceId} requires the accepted SITEBORNE x402 paid-service boundary`,
    };
  },
};

function containsHostileObjectKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsHostileObjectKey);
  if (value === null || typeof value !== 'object') return false;
  return Object.entries(value).some(
    ([key, nested]) => HOSTILE_OBJECT_KEYS.has(key) || containsHostileObjectKey(nested)
  );
}

type ParseResult =
  | { ok: true; invocation: SiteborneA2aInvocation }
  | { ok: false; code: 'invalid_input' | 'unknown_skill'; message: string };

function parseInvocation(message: Message): ParseResult {
  if (message.parts.length !== 1 || message.parts[0]?.content?.$case !== 'data') {
    return {
      ok: false,
      code: 'invalid_input',
      message: 'SendMessage requires exactly one structured application/json DataPart',
    };
  }
  const value: unknown = message.parts[0].content.value;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, code: 'invalid_input', message: 'structured invocation must be an object' };
  }
  if (containsHostileObjectKey(value)) {
    return { ok: false, code: 'invalid_input', message: 'input contains a forbidden object key' };
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !INVOCATION_KEYS.has(key))) {
    return {
      ok: false,
      code: 'invalid_input',
      message: 'structured invocation has unknown fields',
    };
  }
  if (typeof record.skillId !== 'string' || !SERVICE_ID_SET.has(record.skillId)) {
    return { ok: false, code: 'unknown_skill', message: 'requested skill is not advertised' };
  }
  if (record.serviceVersion !== undefined && record.serviceVersion !== 'v1') {
    return { ok: false, code: 'invalid_input', message: 'unsupported service version' };
  }
  const serviceId = record.skillId as SiteborneServiceId;
  if (!inputValidators[serviceId](record.input)) {
    return {
      ok: false,
      code: 'invalid_input',
      message: 'input does not match the frozen service schema',
    };
  }
  return {
    ok: true,
    invocation: {
      skillId: serviceId,
      serviceVersion: 'v1',
      input: record.input,
      ...(Object.hasOwn(record, 'payment') ? { payment: record.payment } : {}),
    },
  };
}

function responseMessage(
  messageId: string,
  contextId: string,
  taskId: string,
  data: unknown
): Message {
  return {
    messageId,
    contextId,
    taskId,
    role: Role.ROLE_AGENT,
    parts: [
      {
        content: { $case: 'data', value: data },
        metadata: undefined,
        filename: '',
        mediaType: 'application/json',
      },
    ],
    metadata: undefined,
    extensions: [SITEBORNE_X402_EXTENSION_URI],
    referenceTaskIds: [],
  };
}

function stateForFailure(code: string): TaskState {
  if (code === 'payment_required') return TaskState.TASK_STATE_INPUT_REQUIRED;
  if (code === 'external_dependency_unavailable' || code === 'repository_error') {
    return TaskState.TASK_STATE_FAILED;
  }
  return TaskState.TASK_STATE_REJECTED;
}

function failureTask(
  requestMessage: Message,
  taskId: string,
  contextId: string,
  code: string,
  message: string
): Task {
  const agentMessage = responseMessage(crypto.randomUUID(), contextId, taskId, {
    outcome: 'action_required',
    code,
    message,
    paymentRequired: code === 'payment_required',
    productionEnabled: false,
  });
  return {
    id: taskId,
    contextId,
    status: {
      state: stateForFailure(code),
      message: agentMessage,
      timestamp: new Date().toISOString(),
    },
    artifacts: [],
    history: [requestMessage, agentMessage],
    metadata: {
      siteborne: {
        code,
        freeExecutionEnabled: false,
        productionEnabled: false,
      },
    },
  };
}

function fulfilledTask(
  requestMessage: Message,
  taskId: string,
  contextId: string,
  invocation: SiteborneA2aInvocation,
  outcome: Extract<A2aServiceExecutionOutcome, { outcome: 'fulfilled' }>
): Task {
  const agentMessage = responseMessage(crypto.randomUUID(), contextId, taskId, {
    outcome: 'fulfilled',
    skillId: invocation.skillId,
  });
  return {
    id: taskId,
    contextId,
    status: {
      state: TaskState.TASK_STATE_COMPLETED,
      message: agentMessage,
      timestamp: new Date().toISOString(),
    },
    artifacts: [
      {
        artifactId: crypto.randomUUID(),
        name: `${invocation.skillId} result`,
        description: 'SITEBORNE fixture-boundary result; production execution remains disabled.',
        parts: [
          {
            content: { $case: 'data', value: outcome.result },
            metadata: undefined,
            filename: '',
            mediaType: 'application/json',
          },
        ],
        metadata: { siteborneSkillId: invocation.skillId },
        extensions: [],
      },
    ],
    history: [requestMessage, agentMessage],
    metadata: {
      siteborne: {
        code: 'fulfilled',
        fixtureBoundary: true,
        productionEnabled: false,
      },
    },
  };
}

export function createSiteborneA2aExecutor(
  boundary: A2aServiceExecutionBoundary = defaultBoundary
): AgentExecutor {
  return {
    async execute(requestContext, eventBus) {
      const parsed = parseInvocation(requestContext.userMessage);
      let task: Task;
      if (!parsed.ok) {
        task = failureTask(
          requestContext.userMessage,
          requestContext.taskId,
          requestContext.contextId,
          parsed.code,
          parsed.message
        );
      } else {
        let outcome: A2aServiceExecutionOutcome;
        try {
          outcome = await boundary.execute(parsed.invocation.skillId, parsed.invocation.input, {
            messageId: requestContext.userMessage.messageId,
            taskId: requestContext.taskId,
            contextId: requestContext.contextId,
            protocolVersion: A2A_PROTOCOL_VERSION,
          });
        } catch {
          outcome = {
            outcome: 'failed',
            code: 'repository_error',
            message: 'service execution boundary failed',
          };
        }
        task =
          outcome.outcome === 'fulfilled'
            ? fulfilledTask(
                requestContext.userMessage,
                requestContext.taskId,
                requestContext.contextId,
                parsed.invocation,
                outcome
              )
            : failureTask(
                requestContext.userMessage,
                requestContext.taskId,
                requestContext.contextId,
                outcome.code,
                outcome.message
              );
      }
      eventBus.publish(AgentEvent.task(task));
      eventBus.finished();
    },
    async cancelTask() {
      throw new Error('task cancellation is not supported');
    },
  };
}
