import { describe, expect, it } from 'vitest';
import { AgentCard } from '@a2a-js/sdk';
import {
  A2A_PROTOCOL_VERSION,
  SITEBORNE_A2A_INTERFACE_URL,
  SITEBORNE_SERVICE_IDS,
  SITEBORNE_X402_EXTENSION_URI,
  buildUnsignedSiteborneAgentCard,
} from './index';

describe('SITEBORNE A2A v1 Agent Card contract', () => {
  it('builds the immutable four-skill production-disabled JSON-RPC card without legacy fields', () => {
    const card = buildUnsignedSiteborneAgentCard();
    const wire = AgentCard.toJSON(card) as Record<string, unknown>;

    expect(card.name).toBe('SITEBORNE Utility Network');
    expect(card.supportedInterfaces).toEqual([
      {
        url: SITEBORNE_A2A_INTERFACE_URL,
        protocolBinding: 'JSONRPC',
        protocolVersion: A2A_PROTOCOL_VERSION,
        tenant: '',
      },
    ]);
    expect(card.skills.map((skill) => skill.id)).toEqual(SITEBORNE_SERVICE_IDS);
    expect(card.skills.every((skill) => skill.inputModes.includes('application/json'))).toBe(true);
    expect(card.skills.every((skill) => skill.outputModes.includes('application/json'))).toBe(true);
    expect(card.securitySchemes).toEqual({});
    expect(card.securityRequirements).toEqual([]);
    expect(card.capabilities?.streaming).toBe(false);
    expect(card.capabilities?.pushNotifications).toBe(false);
    expect(card.capabilities?.extendedAgentCard).toBe(false);
    expect(card.capabilities?.extensions).toHaveLength(1);
    expect(card.capabilities?.extensions[0]).toMatchObject({
      uri: SITEBORNE_X402_EXTENSION_URI,
      required: false,
      params: {
        x402Version: 2,
        paymentRequiredForUsefulExecution: true,
        productionEnabled: false,
      },
    });
    expect(card.signatures).toEqual([]);
    expect(wire).not.toHaveProperty('protocolVersion');
    expect(wire).not.toHaveProperty('url');
    expect(JSON.stringify(wire)).not.toContain('kind');
  });
});
