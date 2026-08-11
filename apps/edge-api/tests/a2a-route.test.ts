import { AgentCard, Role, TaskState } from '@a2a-js/sdk';
import {
  ClientFactory,
  DefaultAgentCardResolver,
  JsonRpcTransportFactory,
} from '@a2a-js/sdk/client';
import { frozenInputExample } from '@siteborne/protocol-x402';
import { verifyAgentCardAgainstTrustedJwks } from '@siteborne/protocol-a2a';
import { describe, expect, it } from 'vitest';
import app from '../src/index';

const TEST_ORIGIN = 'http://test.local';

async function edgeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init);
  const headers = new Headers(request.headers);
  headers.set('Host', 'test.local');
  return app.fetch(new Request(request, { headers }));
}

describe('edge-api A2A routes', () => {
  it('serves the locally signed v1 Agent Card and public-only JWKS', async () => {
    const [cardResponse, jwksResponse] = await Promise.all([
      edgeFetch(`${TEST_ORIGIN}/.well-known/agent-card.json`),
      edgeFetch(`${TEST_ORIGIN}/.well-known/jwks.json`),
    ]);
    const card = AgentCard.fromJSON(await cardResponse.json());
    const jwks = (await jwksResponse.json()) as { keys: Array<Record<string, unknown>> };

    expect(cardResponse.status).toBe(200);
    expect(cardResponse.headers.get('content-type')).toContain('application/a2a+json');
    expect(card.signatures).toHaveLength(1);
    expect(jwksResponse.status).toBe(200);
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]).not.toHaveProperty('d');
    await expect(verifyAgentCardAgainstTrustedJwks(card, jwks)).resolves.toBeUndefined();
  });

  it('round-trips official discovery and SendMessage while preserving the no-free-use gate', async () => {
    const factory = new ClientFactory({
      transports: [new JsonRpcTransportFactory({ fetchImpl: edgeFetch })],
      cardResolver: new DefaultAgentCardResolver({ fetchImpl: edgeFetch }),
    });
    const client = await factory.createFromUrl(TEST_ORIGIN);
    const result = await client.sendMessage({
      tenant: '',
      message: {
        messageId: 'edge-a2a-message-1',
        contextId: '',
        taskId: '',
        role: Role.ROLE_USER,
        parts: [
          {
            content: {
              $case: 'data',
              value: {
                skillId: 'company_evidence_graph.v1',
                serviceVersion: 'v1',
                input: frozenInputExample('company_evidence_graph.v1'),
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
    });

    expect('id' in result).toBe(true);
    if (!('id' in result)) throw new Error('expected Task result');
    expect(result.status?.state).toBe(TaskState.TASK_STATE_INPUT_REQUIRED);
    expect(result.artifacts).toEqual([]);
    expect(result.metadata).toMatchObject({
      siteborne: { code: 'payment_required', productionEnabled: false },
    });
  });
});
