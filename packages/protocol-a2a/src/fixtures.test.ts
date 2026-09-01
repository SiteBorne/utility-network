import { readFile } from 'node:fs/promises';
import { AgentCard, canonicalizeAgentCard } from '@a2a-js/sdk';
import { describe, expect, it } from 'vitest';
import { BAZAAR_PAYMENT_POLICY, REGISTRY_SERVICES } from '@siteborne/protocol-x402';
import {
  A2A_PROTOCOL_VERSION,
  SITEBORNE_A2A_INTERFACE_URL,
  SITEBORNE_SERVICE_IDS,
  SITEBORNE_X402_EXTENSION_URI,
  buildUnsignedSiteborneAgentCard,
  createLocalA2aSigningIdentity,
} from './index';

interface AgentCardFixture {
  name: string;
  agent_version: string;
  protocol_binding: string;
  protocol_version: string;
  interface_url: string;
  skills: string[];
  x402_extension_uri: string;
  payment_modes: Record<string, string>;
  production_enabled: boolean;
}

describe('A2A Agent Card machine baseline', () => {
  it('matches the registry, executable x402 mapping, local JWS, and v1 wire fixture', async () => {
    const fixture = JSON.parse(
      await readFile(new URL('../fixtures/a2a-agent-card-baseline.json', import.meta.url), 'utf8')
    ) as AgentCardFixture;
    const first = buildUnsignedSiteborneAgentCard();
    const second = buildUnsignedSiteborneAgentCard();
    const extension = first.capabilities?.extensions[0];
    const params = extension?.params as {
      productionEnabled: boolean;
      services: Array<{ serviceId: string; scheme: string; productionEnabled: boolean }>;
    };

    expect(first.name).toBe(fixture.name);
    expect(first.version).toBe(fixture.agent_version);
    expect(first.supportedInterfaces).toEqual([
      {
        url: SITEBORNE_A2A_INTERFACE_URL,
        protocolBinding: fixture.protocol_binding,
        protocolVersion: A2A_PROTOCOL_VERSION,
        tenant: '',
      },
    ]);
    expect(fixture.protocol_version).toBe(A2A_PROTOCOL_VERSION);
    expect(first.skills.map((skill) => skill.id)).toEqual(fixture.skills);
    for (const serviceId of SITEBORNE_SERVICE_IDS) {
      const skill = first.skills.find((candidate) => candidate.id === serviceId);
      const service = REGISTRY_SERVICES[serviceId];
      // SUN-1222B: name/description are no longer a bare copy of the
      // registry title/description -- they're distinguished per service-
      // contract major (see card.ts's `buildSkill` doc comment) -- so this
      // asserts containment/derivation rather than exact equality, while
      // still proving the skill is traceable to its registry entry.
      expect(skill?.name).toContain(service.title);
      expect(skill?.name.toUpperCase()).toContain(service.service_version.toUpperCase());
      expect(skill?.description).toContain(service.description);
      expect(skill?.description).toContain(service.service_id);
      expect(params.services.find((candidate) => candidate.serviceId === serviceId)).toMatchObject({
        scheme: fixture.payment_modes[serviceId],
        productionEnabled: false,
      });
      expect(fixture.payment_modes[serviceId]).toBe(BAZAAR_PAYMENT_POLICY[serviceId].scheme);
    }
    expect(extension).toMatchObject({ uri: SITEBORNE_X402_EXTENSION_URI, required: false });
    expect(fixture.x402_extension_uri).toBe(SITEBORNE_X402_EXTENSION_URI);
    expect(params.productionEnabled).toBe(false);
    expect(fixture.production_enabled).toBe(false);
    expect(canonicalizeAgentCard(first)).toBe(canonicalizeAgentCard(second));

    const identity = await createLocalA2aSigningIdentity();
    const signed = await identity.sign(first);
    await expect(identity.verify(signed)).resolves.toBeUndefined();
    expect(identity.jwks.keys.some((key) => 'd' in key)).toBe(false);
    const wire = AgentCard.toJSON(signed) as Record<string, unknown>;
    expect(wire).not.toHaveProperty('protocolVersion');
    expect(wire).not.toHaveProperty('url');
    expect(JSON.stringify(wire)).not.toContain('"kind"');
  });
});
