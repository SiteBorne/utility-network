import fc from 'fast-check';
import { canonicalizeAgentCard, Role, SendMessageRequest, TaskState } from '@a2a-js/sdk';
import {
  ClientFactory,
  DefaultAgentCardResolver,
  JsonRpcTransportFactory,
} from '@a2a-js/sdk/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BAZAAR_PAYMENT_POLICY, frozenInputExample } from '@siteborne/protocol-x402';
import {
  A2A_PROTOCOL_VERSION,
  SITEBORNE_A2A_ORIGIN,
  SITEBORNE_SERVICE_IDS,
  buildUnsignedSiteborneAgentCard,
  createLocalA2aSigningIdentity,
  createSiteborneA2aHonoApp,
} from './index';

afterEach(() => vi.restoreAllMocks());

function requestFor(messageId: string, skillId: string) {
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
  };
}

function reverseObjectOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseObjectOrder);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .reverse()
      .map(([key, child]) => [key, reverseObjectOrder(child)])
  );
}

describe('A2A bounded properties', () => {
  it('generates one deterministic unsigned semantic card regardless of call count', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 25 }), (count) => {
        const expected = canonicalizeAgentCard(buildUnsignedSiteborneAgentCard());
        return Array.from({ length: count }).every(
          () => canonicalizeAgentCard(buildUnsignedSiteborneAgentCard()) === expected
        );
      }),
      { numRuns: 25 }
    );
  });

  it('canonicalization and verification ignore object insertion order', async () => {
    const identity = await createLocalA2aSigningIdentity();
    const signed = await identity.sign(buildUnsignedSiteborneAgentCard());
    await fc.assert(
      fc.asyncProperty(fc.boolean(), async (reverse) => {
        const candidate = (
          reverse ? reverseObjectOrder(signed) : structuredClone(signed)
        ) as typeof signed;
        await identity.verify(candidate);
      }),
      { numRuns: 10 }
    );
  });

  it('every non-empty semantic content mutation invalidates the signature', async () => {
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const identity = await createLocalA2aSigningIdentity();
    const signed = await identity.sign(buildUnsignedSiteborneAgentCard());
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1, maxLength: 32 }), async (suffix) => {
        const mutated = structuredClone(signed);
        mutated.description += suffix;
        await expect(identity.verify(mutated)).rejects.toThrow('No valid signatures');
      }),
      { numRuns: 20 }
    );
  });

  it('keeps skill identity, x402 mode mapping, and production state invariant', () => {
    fc.assert(
      fc.property(fc.integer(), () => {
        const card = buildUnsignedSiteborneAgentCard();
        const params = card.capabilities?.extensions[0]?.params as {
          productionEnabled: boolean;
          services: Array<{ serviceId: string; scheme: string; productionEnabled: boolean }>;
        };
        const ids = card.skills.map((skill) => skill.id);
        return (
          new Set(ids).size === SITEBORNE_SERVICE_IDS.length &&
          ids.join('|') === SITEBORNE_SERVICE_IDS.join('|') &&
          params.productionEnabled === false &&
          params.services.every(
            (service) =>
              service.productionEnabled === false &&
              service.scheme ===
                BAZAAR_PAYMENT_POLICY[service.serviceId as keyof typeof BAZAAR_PAYMENT_POLICY]
                  .scheme
          )
        );
      }),
      { numRuns: 25 }
    );
  });

  it('never dispatches an unsupported skill produced by bounded arbitrary input', async () => {
    const execute = vi.fn();
    const app = await createSiteborneA2aHonoApp({ serviceBoundary: { execute } });
    await fc.assert(
      fc.asyncProperty(
        fc
          .string({ minLength: 1, maxLength: 40 })
          .filter((value) => !SITEBORNE_SERVICE_IDS.includes(value as never)),
        async (skillId) => {
          const rpc = {
            jsonrpc: '2.0',
            id: `unsupported-${skillId}`,
            method: 'SendMessage',
            params: SendMessageRequest.toJSON(requestFor(`unsupported-${skillId}`, skillId)),
          };
          const response = await app.request(`${SITEBORNE_A2A_ORIGIN}/a2a`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'A2A-Version': A2A_PROTOCOL_VERSION,
            },
            body: JSON.stringify(rpc),
          });
          const task = (await response.json()) as {
            result: { task: { status: { state: string } } };
          };
          expect(task.result.task.status.state).toBe('TASK_STATE_REJECTED');
        }
      ),
      { numRuns: 20 }
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('keeps two arbitrary client identities from cross-observing fixture output', async () => {
    const app = await createSiteborneA2aHonoApp({
      serviceBoundary: {
        async execute(_serviceId, _input, context) {
          return { outcome: 'fulfilled', result: { owner: context.messageId } };
        },
      },
    });
    const fetchImpl: typeof fetch = async (input, init) => app.fetch(new Request(input, init));
    const factory = new ClientFactory({
      transports: [new JsonRpcTransportFactory({ fetchImpl })],
      cardResolver: new DefaultAgentCardResolver({ fetchImpl }),
    });
    const [clientA, clientB] = await Promise.all([
      factory.createFromUrl(SITEBORNE_A2A_ORIGIN),
      factory.createFromUrl(SITEBORNE_A2A_ORIGIN),
    ]);
    await fc.assert(
      fc.asyncProperty(
        fc.tuple(fc.uuid(), fc.uuid()).filter(([a, b]) => a !== b),
        async ([idA, idB]) => {
          const [resultA, resultB] = await Promise.all([
            clientA.sendMessage(requestFor(idA, SITEBORNE_SERVICE_IDS[0])),
            clientB.sendMessage(requestFor(idB, SITEBORNE_SERVICE_IDS[0])),
          ]);
          if (!('id' in resultA) || !('id' in resultB)) return false;
          const valueA = resultA.artifacts[0]?.parts[0]?.content;
          const valueB = resultB.artifacts[0]?.parts[0]?.content;
          return (
            resultA.status?.state === TaskState.TASK_STATE_COMPLETED &&
            resultB.status?.state === TaskState.TASK_STATE_COMPLETED &&
            valueA?.$case === 'data' &&
            valueB?.$case === 'data' &&
            valueA.value.owner === idA &&
            valueB.value.owner === idB
          );
        }
      ),
      { numRuns: 10 }
    );
  });
});
