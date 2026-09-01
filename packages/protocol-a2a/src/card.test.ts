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

  // SUN-1222B: guards against the top-level/per-service productionEnabled
  // divergence found live in production during SUN-1222A -- the top-level
  // x402 extension flag must always equal "at least one service below it
  // is production-enabled", never an independently hand-set value.
  it('derives the top-level x402 productionEnabled from the per-service map, never independently', () => {
    const noneActive = buildUnsignedSiteborneAgentCard();
    const params = noneActive.capabilities?.extensions[0]?.params as {
      productionEnabled: boolean;
      services: Array<{ serviceId: string; productionEnabled: boolean }>;
    };
    expect(params.productionEnabled).toBe(false);
    expect(params.services.every((service) => service.productionEnabled === false)).toBe(true);

    const oneActive = buildUnsignedSiteborneAgentCard({
      'verify_agent_output.v2': true,
    });
    const activeParams = oneActive.capabilities?.extensions[0]?.params as {
      productionEnabled: boolean;
      services: Array<{ serviceId: string; productionEnabled: boolean }>;
    };
    expect(activeParams.productionEnabled).toBe(true);
    const flaggedService = activeParams.services.find(
      (service) => service.serviceId === 'verify_agent_output.v2'
    );
    expect(flaggedService?.productionEnabled).toBe(true);
    // Every other service stays false, and the top-level flag stays a pure
    // aggregate -- it does not flip every service to "active" alongside it.
    expect(
      activeParams.services.filter((service) => service.serviceId !== 'verify_agent_output.v2')
    ).toSatisfy((rest: Array<{ productionEnabled: boolean }>) =>
      rest.every((service) => service.productionEnabled === false)
    );

    const allInactiveAgain = buildUnsignedSiteborneAgentCard({
      'verify_agent_output.v2': false,
    });
    const inactiveParams = allInactiveAgain.capabilities?.extensions[0]?.params as {
      productionEnabled: boolean;
    };
    expect(inactiveParams.productionEnabled).toBe(false);
  });
});
