import { AgentCard, Role, TaskState } from '@a2a-js/sdk';
import {
  ClientFactory,
  DefaultAgentCardResolver,
  JsonRpcTransportFactory,
} from '@a2a-js/sdk/client';
import { frozenInputExample } from '@siteborne/protocol-x402';
import { verifyAgentCardAgainstTrustedJwks } from '@siteborne/protocol-a2a';
import { describe, expect, it } from 'vitest';
import { app } from '../src/index';

const TEST_ORIGIN = 'http://test.local';

async function edgeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init);
  const headers = new Headers(request.headers);
  headers.set('Host', 'test.local');
  return app.fetch(new Request(request, { headers }));
}

/** SUN-1222C-DEPLOYMENT-DEPENDENCY-AND-MTLS-TRUTHFULNESS-REMEDIATION --
 * fetches the live agent card through the REAL Worker route (`app.request`
 * with an injected `env`, the same pattern `multi-service-discovery.test.ts`'s
 * `getCardServices` uses), so this proves the actual `env` ->
 * `resolveMtlsProductionActive` -> `routes/a2a.ts` -> `card.ts` wiring
 * end-to-end -- not just `card.ts`'s own unit-level default parameter
 * (covered separately in `packages/protocol-a2a/src/card.test.ts`). */
async function fetchCardWithEnv(
  extraEnv: Record<string, string> = {}
): Promise<{ securitySchemes?: Record<string, unknown> }> {
  const response = await app.request(
    '/.well-known/agent-card.json',
    { headers: { Host: 'test.local' } },
    extraEnv as never
  );
  return response.json();
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

  // SUN-1222C-DEPLOYMENT-DEPENDENCY-AND-MTLS-TRUTHFULNESS-REMEDIATION:
  // proves the real Worker route's env -> card wiring, not just card.ts's
  // own default parameter (see packages/protocol-a2a/src/card.test.ts's
  // dedicated 'mTLS declaration truthfulness gate' describe block).
  describe('mTLS declaration truthfulness (SUN-1222C-DEPLOYMENT-DEPENDENCY-AND-MTLS-TRUTHFULNESS-REMEDIATION)', () => {
    it('MTLS_PRODUCTION_ACTIVE absent (today\'s real production configuration): the live card declares no security scheme', async () => {
      const card = await fetchCardWithEnv();
      expect(card.securitySchemes ?? {}).toEqual({});
    });

    it('MTLS_PRODUCTION_ACTIVE=false (explicit): identical to absent -- no hidden second way to enable it', async () => {
      const card = await fetchCardWithEnv({ MTLS_PRODUCTION_ACTIVE: 'false' });
      expect(card.securitySchemes ?? {}).toEqual({});
    });

    it('MTLS_PRODUCTION_ACTIVE=true: the live card declares securitySchemes.mtls', async () => {
      const card = await fetchCardWithEnv({ MTLS_PRODUCTION_ACTIVE: 'true' });
      expect(Object.keys(card.securitySchemes ?? {})).toEqual(['mtls']);
    });

    it('mutation guard: a near-miss value ("1", "True", "yes") never activates the declaration -- only the exact literal "true" does', async () => {
      for (const nearMiss of ['1', 'True', 'yes', 'TRUE', ' true']) {
        const card = await fetchCardWithEnv({ MTLS_PRODUCTION_ACTIVE: nearMiss });
        expect(card.securitySchemes ?? {}, `value ${JSON.stringify(nearMiss)}`).toEqual({});
      }
    });
  });
});
