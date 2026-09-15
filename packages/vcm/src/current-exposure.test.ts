import { SITEBORNE_SERVICE_IDS } from '@siteborne/protocol-a2a';
import { MCP_SERVICE_TOOLS, MCP_TOOL_NAMES } from '@siteborne/protocol-mcp';
import { describe, expect, it } from 'vitest';
import {
  deriveCurrentCodeExposure,
  deriveCurrentExposureFromRegistrations,
  type CurrentRegistrationFact,
} from './current-exposure';
import { toServiceIdValue } from './service-id';
import { makeFixtureModel, makeFixtureService } from './test-fixtures';

const SOURCE_COMMIT = 'a'.repeat(40);

function registration(overrides: Partial<CurrentRegistrationFact> = {}): CurrentRegistrationFact {
  return {
    surface: 'mcp',
    registrationId: 'siteborne_company_evidence_graph',
    exposureShape: 'standalone_tool',
    target: {
      kind: 'service_interaction',
      serviceId: 'company_evidence_graph.v1',
      operationId: 'evaluate',
    },
    authority: {
      sourcePackage: '@siteborne/protocol-mcp',
      sourceModule: 'src/constants.ts',
      derivationMethod: 'typed_export',
    },
    ...overrides,
  };
}

describe('deriveCurrentCodeExposure', () => {
  it('derives all eight A2A skills from the Agent Card registration authority', () => {
    const model = makeFixtureModel(
      SITEBORNE_SERVICE_IDS.map((serviceId) => {
        const [family, generation] = serviceId.split('.');
        return makeFixtureService({
          id: { family: family as never, generation: generation as never },
        });
      })
    );

    const derived = deriveCurrentCodeExposure(model.services, SOURCE_COMMIT);
    const a2a = derived.serviceExposures.filter(({ exposure }) => exposure.surface === 'a2a');

    expect(a2a).toHaveLength(8);
    expect(a2a.map(({ serviceId }) => serviceId)).toEqual([...SITEBORNE_SERVICE_IDS]);
    expect(a2a.every(({ exposure }) => exposure.exposureShape === 'skill')).toBe(true);
    expect(
      a2a.every(
        ({ exposure }) =>
          exposure.provenance.sourcePackage === '@siteborne/protocol-a2a' &&
          exposure.provenance.sourceRegistrationId === exposure.registrationId &&
          exposure.provenance.runtimeSourceCommit === SOURCE_COMMIT
      )
    ).toBe(true);
  });

  it('derives exactly the registered MCP service and utility interactions', () => {
    const model = makeFixtureModel(
      SITEBORNE_SERVICE_IDS.map((serviceId) => {
        const [family, generation] = serviceId.split('.');
        return makeFixtureService({
          id: { family: family as never, generation: generation as never },
        });
      })
    );

    const derived = deriveCurrentCodeExposure(model.services, SOURCE_COMMIT);
    const serviceMcp = derived.serviceExposures.filter(
      ({ exposure }) => exposure.surface === 'mcp'
    );
    const utilityMcp = derived.utilityExposures.filter((exposure) => exposure.surface === 'mcp');

    expect(serviceMcp).toHaveLength(Object.keys(MCP_SERVICE_TOOLS).length);
    expect(utilityMcp).toHaveLength(MCP_TOOL_NAMES.length - Object.keys(MCP_SERVICE_TOOLS).length);
    expect(serviceMcp.length + utilityMcp.length).toBe(6);
    expect(serviceMcp.map(({ serviceId }) => serviceId).sort()).toEqual(
      Object.values(MCP_SERVICE_TOOLS).sort()
    );
    expect(serviceMcp.some(({ serviceId }) => serviceId.endsWith('.v1'))).toBe(false);
    expect(utilityMcp.map((exposure) => exposure.registrationId).sort()).toEqual([
      'siteborne_get_quote',
      'siteborne_get_service_health',
    ]);
  });
});

describe('deriveCurrentExposureFromRegistrations fail-closed validation', () => {
  const services = makeFixtureModel().services;

  it('rejects an unknown service registration', () => {
    expect(() =>
      deriveCurrentExposureFromRegistrations(
        services,
        [
          registration({
            target: {
              kind: 'service_interaction',
              serviceId: 'unknown_service.v1' as never,
              operationId: 'evaluate',
            },
          }),
        ],
        SOURCE_COMMIT
      )
    ).toThrowError(expect.objectContaining({ code: 'UNKNOWN_SERVICE' }));
  });

  it('rejects a duplicate surface registration id', () => {
    expect(() =>
      deriveCurrentExposureFromRegistrations(
        services,
        [registration(), registration()],
        SOURCE_COMMIT
      )
    ).toThrowError(expect.objectContaining({ code: 'DUPLICATE_REGISTRATION' }));
  });

  it('rejects duplicate protocol and operation exposure under different registration ids', () => {
    expect(() =>
      deriveCurrentExposureFromRegistrations(
        services,
        [registration(), registration({ registrationId: 'second_name' })],
        SOURCE_COMMIT
      )
    ).toThrowError(expect.objectContaining({ code: 'DUPLICATE_PROTOCOL_OPERATION' }));
  });

  it('rejects an unsupported exposure shape from parsed input', () => {
    expect(() =>
      deriveCurrentExposureFromRegistrations(
        services,
        [registration({ exposureShape: 'ambient_magic' as never })],
        SOURCE_COMMIT
      )
    ).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_EXPOSURE_SHAPE' }));
  });

  it('rejects a registration for an operation absent from the canonical service', () => {
    expect(() =>
      deriveCurrentExposureFromRegistrations(
        services,
        [
          registration({
            target: {
              kind: 'service_interaction',
              serviceId: toServiceIdValue(services[0].id),
              operationId: 'missing_operation',
            },
          }),
        ],
        SOURCE_COMMIT
      )
    ).toThrowError(expect.objectContaining({ code: 'UNKNOWN_OPERATION' }));
  });
});
