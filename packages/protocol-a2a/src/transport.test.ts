import { AgentCard, Role, SendMessageRequest, TaskState } from '@a2a-js/sdk';
import {
  ClientFactory,
  DefaultAgentCardResolver,
  JsonRpcTransportFactory,
} from '@a2a-js/sdk/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { frozenInputExample } from '@siteborne/protocol-x402';
import {
  A2A_PROTOCOL_VERSION,
  SITEBORNE_A2A_ORIGIN,
  SITEBORNE_SERVICE_IDS,
  createSiteborneA2aHonoApp,
  type A2aServiceExecutionBoundary,
} from './index';

afterEach(() => vi.unstubAllGlobals());

function dataMessage(
  messageId: string,
  skillId: (typeof SITEBORNE_SERVICE_IDS)[number] = SITEBORNE_SERVICE_IDS[0]
) {
  return {
    tenant: '',
    message: {
      messageId,
      contextId: '',
      taskId: '',
      role: Role.ROLE_USER,
      parts: [
        {
          content: {
            $case: 'data' as const,
            value: {
              skillId,
              serviceVersion: 'v1',
              input: frozenInputExample(skillId),
            },
          },
          metadata: undefined,
          filename: '',
          mediaType: 'application/json',
        },
      ],
      metadata: undefined,
      extensions: [],
      referenceTaskIds: [],
    },
    configuration: {
      acceptedOutputModes: ['application/json'],
      taskPushNotificationConfig: undefined,
      returnImmediately: false,
    },
    metadata: undefined,
  };
}

async function createLocalClient(boundary?: A2aServiceExecutionBoundary) {
  const app = await createSiteborneA2aHonoApp({ serviceBoundary: boundary });
  const fetchImpl: typeof fetch = async (input, init) => app.fetch(new Request(input, init));
  const factory = new ClientFactory({
    transports: [new JsonRpcTransportFactory({ fetchImpl })],
    cardResolver: new DefaultAgentCardResolver({ fetchImpl }),
  });
  return { app, fetchImpl, client: await factory.createFromUrl(SITEBORNE_A2A_ORIGIN) };
}

function rpcRequest(messageId: string, skillId = SITEBORNE_SERVICE_IDS[0]) {
  return {
    jsonrpc: '2.0',
    id: `rpc-${messageId}`,
    method: 'SendMessage',
    params: SendMessageRequest.toJSON(dataMessage(messageId, skillId)),
  };
}

interface MutableRpcRequest {
  params: { message: { parts: Array<Record<string, unknown>> } };
}

function mutableRpcRequest(messageId: string): ReturnType<typeof rpcRequest> & MutableRpcRequest {
  return rpcRequest(messageId) as ReturnType<typeof rpcRequest> & MutableRpcRequest;
}

function invocationData(request: MutableRpcRequest): Record<string, unknown> {
  const data = request.params.message.parts[0]?.data;
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('test request does not contain structured data');
  }
  return data as Record<string, unknown>;
}

async function postRaw(app: Awaited<ReturnType<typeof createSiteborneA2aHonoApp>>, body: string) {
  return app.request(`${SITEBORNE_A2A_ORIGIN}/a2a`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'A2A-Version': A2A_PROTOCOL_VERSION },
    body,
  });
}

function taskFromRpcResponse(value: unknown) {
  return (value as { result: { task: Record<string, unknown> } }).result.task;
}

describe('A2A v1 local Hono transport', () => {
  it('discovers and verifies the signed card through the canonical well-known route', async () => {
    const { app } = await createLocalClient();
    const response = await app.request(`${SITEBORNE_A2A_ORIGIN}/.well-known/agent-card.json`);
    const wire = await response.json();
    const card = AgentCard.fromJSON(wire);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/a2a+json');
    expect(card.supportedInterfaces[0]?.protocolVersion).toBe(A2A_PROTOCOL_VERSION);
    expect(card.signatures).toHaveLength(1);
  });

  it('uses official ClientFactory SendMessage and returns a completed task artifact in fixture mode', async () => {
    const execute = vi.fn(async (skillId, input) => ({
      outcome: 'fulfilled' as const,
      result: { skillId, acceptedInput: input },
    }));
    const { client } = await createLocalClient({ execute });

    const result = await client.sendMessage(dataMessage('fixture-message-1'));

    expect('id' in result).toBe(true);
    if (!('id' in result)) throw new Error('expected Task result');
    expect(result.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
    expect(result.artifacts[0]?.parts[0]?.content).toMatchObject({
      $case: 'data',
      value: expect.objectContaining({ skillId: SITEBORNE_SERVICE_IDS[0] }),
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(
      SITEBORNE_SERVICE_IDS[0],
      frozenInputExample(SITEBORNE_SERVICE_IDS[0]),
      expect.objectContaining({ messageId: 'fixture-message-1' })
    );
  });

  it('returns payment-required input state and performs zero useful work by default', async () => {
    const { client } = await createLocalClient();
    const result = await client.sendMessage(dataMessage('unpaid-message-1'));

    expect('id' in result).toBe(true);
    if (!('id' in result)) throw new Error('expected Task result');
    expect(result.status?.state).toBe(TaskState.TASK_STATE_INPUT_REQUIRED);
    expect(result.artifacts).toEqual([]);
    expect(result.metadata).toMatchObject({
      siteborne: {
        code: 'payment_required',
        freeExecutionEnabled: false,
        productionEnabled: false,
      },
    });
  });

  it.each(SITEBORNE_SERVICE_IDS)(
    'maps advertised skill %s through the one accepted dispatch boundary',
    async (skillId) => {
      const execute = vi.fn(async () => ({
        outcome: 'failed' as const,
        code: 'payment_required' as const,
        message: 'payment required',
      }));
      const { client } = await createLocalClient({ execute });
      const result = await client.sendMessage(dataMessage(`matrix-${skillId}`, skillId));

      expect('id' in result).toBe(true);
      if (!('id' in result)) throw new Error('expected Task result');
      expect(result.status?.state).toBe(TaskState.TASK_STATE_INPUT_REQUIRED);
      expect(result.artifacts).toEqual([]);
      expect(execute).toHaveBeenCalledWith(
        skillId,
        frozenInputExample(skillId),
        expect.objectContaining({ messageId: `matrix-${skillId}` })
      );
    }
  );

  it('isolates two official clients and their fixture artifacts', async () => {
    const boundary: A2aServiceExecutionBoundary = {
      async execute(skillId, _input, context) {
        return { outcome: 'fulfilled', result: { skillId, owner: context.messageId } };
      },
    };
    const app = await createSiteborneA2aHonoApp({ serviceBoundary: boundary });
    const fetchImpl: typeof fetch = async (input, init) => app.fetch(new Request(input, init));
    const factory = new ClientFactory({
      transports: [new JsonRpcTransportFactory({ fetchImpl })],
      cardResolver: new DefaultAgentCardResolver({ fetchImpl }),
    });
    const [clientA, clientB] = await Promise.all([
      factory.createFromUrl(SITEBORNE_A2A_ORIGIN),
      factory.createFromUrl(SITEBORNE_A2A_ORIGIN),
    ]);
    const [resultA, resultB] = await Promise.all([
      clientA.sendMessage(dataMessage('client-a', SITEBORNE_SERVICE_IDS[0])),
      clientB.sendMessage(dataMessage('client-b', SITEBORNE_SERVICE_IDS[1])),
    ]);
    if (!('id' in resultA) || !('id' in resultB)) throw new Error('expected Task results');

    expect(resultA.id).not.toBe(resultB.id);
    expect(resultA.contextId).not.toBe(resultB.contextId);
    expect(resultA.artifacts[0]?.parts[0]?.content).toMatchObject({
      $case: 'data',
      value: { skillId: SITEBORNE_SERVICE_IDS[0], owner: 'client-a' },
    });
    expect(resultB.artifacts[0]?.parts[0]?.content).toMatchObject({
      $case: 'data',
      value: { skillId: SITEBORNE_SERVICE_IDS[1], owner: 'client-b' },
    });
  });

  it('delegates duplicate paid-operation authority to the injected D1-style boundary', async () => {
    const completedByMessage = new Map<string, unknown>();
    let serviceExecutionCount = 0;
    const boundary: A2aServiceExecutionBoundary = {
      async execute(skillId, _input, context) {
        const cached = completedByMessage.get(context.messageId);
        if (cached) return { outcome: 'fulfilled', result: cached };
        serviceExecutionCount += 1;
        const result = { skillId, execution: serviceExecutionCount };
        completedByMessage.set(context.messageId, result);
        return { outcome: 'fulfilled', result };
      },
    };
    const { client } = await createLocalClient(boundary);

    const first = await client.sendMessage(dataMessage('duplicate-paid-identity'));
    const replay = await client.sendMessage(dataMessage('duplicate-paid-identity'));
    if (!('id' in first) || !('id' in replay)) throw new Error('expected Task results');

    expect(serviceExecutionCount).toBe(1);
    expect(first.artifacts[0]?.parts[0]?.content).toEqual(replay.artifacts[0]?.parts[0]?.content);
  });

  it('maps boundary failures without leaking thrown provider diagnostics', async () => {
    const { client } = await createLocalClient({
      async execute() {
        throw new Error('provider bearer secret diagnostic');
      },
    });
    const result = await client.sendMessage(dataMessage('throwing-boundary'));
    if (!('id' in result)) throw new Error('expected Task result');

    expect(result.status?.state).toBe(TaskState.TASK_STATE_FAILED);
    expect(JSON.stringify(result)).not.toContain('bearer secret diagnostic');
    expect(result.metadata).toMatchObject({ siteborne: { code: 'repository_error' } });
  });

  it.each([
    ['external_dependency_unavailable', TaskState.TASK_STATE_FAILED],
    ['service_verification_failed', TaskState.TASK_STATE_REJECTED],
    ['production_disabled', TaskState.TASK_STATE_REJECTED],
  ] as const)('maps %s into a fail-closed A2A task state', async (code, state) => {
    const { client } = await createLocalClient({
      async execute() {
        return { outcome: 'failed', code, message: 'bounded failure' };
      },
    });
    const result = await client.sendMessage(dataMessage(`failure-${code}`));
    if (!('id' in result)) throw new Error('expected Task result');
    expect(result.status?.state).toBe(state);
    expect(result.artifacts).toEqual([]);
  });

  it('rejects malformed JSON, unsupported versions, and legacy v0.3 methods', async () => {
    const app = await createSiteborneA2aHonoApp();
    const malformed = await postRaw(app, '{');
    const unsupported = await app.request(`${SITEBORNE_A2A_ORIGIN}/a2a`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'A2A-Version': '0.3' },
      body: JSON.stringify(rpcRequest('old-version')),
    });
    const legacy = await postRaw(
      app,
      JSON.stringify({ jsonrpc: '2.0', id: 'legacy', method: 'message/send', params: {} })
    );

    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: { code: -32700 } });
    expect(unsupported.status).toBe(400);
    expect(JSON.stringify(await unsupported.json())).toContain('not supported');
    expect(legacy.status).toBe(400);
    expect(JSON.stringify(await legacy.json())).toContain('v0.3');
  });

  it('rejects invalid Part oneofs, hostile keys, and oversized structured data before dispatch', async () => {
    const execute = vi.fn();
    const app = await createSiteborneA2aHonoApp({ serviceBoundary: { execute } });
    const zeroPart = mutableRpcRequest('zero-part');
    zeroPart.params.message.parts = [{ mediaType: 'application/json' }];
    const multiplePart = mutableRpcRequest('multiple-part');
    multiplePart.params.message.parts = [{ data: {}, text: 'also text' }];
    const hostile = JSON.stringify(rpcRequest('hostile')).replace(
      '"input":',
      '"input":{"__proto__":{"polluted":true}},"ignored":'
    );
    const oversized = mutableRpcRequest('oversized');
    invocationData(oversized).input = { value: 'x'.repeat(65_537) };
    const deeplyNested = JSON.stringify(rpcRequest('deeply-nested')).replace(
      '"input":',
      `"input":${'{"nested":'.repeat(70)}0${'}'.repeat(70)},"ignored":`
    );

    const responses = await Promise.all([
      postRaw(app, JSON.stringify(zeroPart)),
      postRaw(app, JSON.stringify(multiplePart)),
      postRaw(app, hostile),
      postRaw(app, JSON.stringify(oversized)),
      postRaw(app, deeplyNested),
    ]);

    expect(responses.map((response) => response.status)).toEqual([400, 400, 400, 400, 400]);
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects unknown skills, wrong schemas, and spoofed production flags, while fake payment cannot bypass', async () => {
    const app = await createSiteborneA2aHonoApp();
    const unknown = mutableRpcRequest('unknown');
    invocationData(unknown).skillId = 'unknown.v1';
    const wrongSchema = mutableRpcRequest('wrong-schema');
    invocationData(wrongSchema).input = {};
    const spoofed = mutableRpcRequest('spoofed');
    invocationData(spoofed).production_enabled = true;
    const fakePayment = mutableRpcRequest('fake-payment');
    invocationData(fakePayment).payment = {
      verified: true,
      production_enabled: true,
    };

    const [unknownBody, wrongBody, spoofedBody, fakeBody] = await Promise.all(
      [unknown, wrongSchema, spoofed, fakePayment].map(async (request) =>
        (await postRaw(app, JSON.stringify(request))).json()
      )
    );

    expect(taskFromRpcResponse(unknownBody)).toMatchObject({
      status: { state: 'TASK_STATE_REJECTED' },
      metadata: { siteborne: { code: 'unknown_skill' } },
    });
    expect(taskFromRpcResponse(wrongBody)).toMatchObject({
      status: { state: 'TASK_STATE_REJECTED' },
      metadata: { siteborne: { code: 'invalid_input' } },
    });
    expect(taskFromRpcResponse(spoofedBody)).toMatchObject({
      status: { state: 'TASK_STATE_REJECTED' },
      metadata: { siteborne: { code: 'invalid_input' } },
    });
    expect(taskFromRpcResponse(fakeBody)).toMatchObject({
      status: { state: 'TASK_STATE_INPUT_REQUIRED' },
      metadata: { siteborne: { code: 'payment_required' } },
    });
  });

  it('enforces host/origin protections and does not follow a wrong card interface', async () => {
    const app = await createSiteborneA2aHonoApp();
    const wrongHost = await app.request('https://attacker.example/.well-known/agent-card.json');
    const wrongOrigin = await app.request(`${SITEBORNE_A2A_ORIGIN}/.well-known/agent-card.json`, {
      headers: { origin: 'https://attacker.example' },
    });

    expect(wrongHost.status).toBe(403);
    expect(wrongOrigin.status).toBe(403);
  });

  it('completes signed discovery and SendMessage with global network access forbidden', async () => {
    const externalFetch = vi.fn(() => {
      throw new Error('external network access is forbidden');
    });
    vi.stubGlobal('fetch', externalFetch);
    const { client } = await createLocalClient();

    const result = await client.sendMessage(dataMessage('no-network-message'));

    if (!('id' in result)) throw new Error('expected Task result');
    expect(result.status?.state).toBe(TaskState.TASK_STATE_INPUT_REQUIRED);
    expect(externalFetch).not.toHaveBeenCalled();
  });
});
