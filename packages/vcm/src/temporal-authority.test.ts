import { describe, expect, it } from 'vitest';
import { project } from './effective-view';
import { emptyOverlay } from './runtime-overlay';
import { makeFixtureModel, makeFixtureService } from './test-fixtures';
import { validateRuntimeOverlay } from './validators';

const NOW = '2026-09-18T00:00:00.000Z' as never;
const STATIC_MCP_EXPOSURE = {
  surface: 'mcp' as const,
  registrationId: 'siteborne_build_company_evidence_graph',
  operationId: 'evaluate',
  exposureShape: 'standalone_tool' as const,
  provenance: {
    sourcePackage: '@siteborne/protocol-mcp',
    sourceModule: 'src/constants.ts#MCP_SERVICE_TOOLS -> src/server.ts#registerTool',
    sourceRegistrationId: 'siteborne_build_company_evidence_graph',
    runtimeSourceCommit: 'a'.repeat(40) as never,
    derivationMethod: 'typed_export' as const,
  },
};

describe('temporal authority separation', () => {
  it('keeps a registered interaction statically exposed while its runtime gate is false', async () => {
    const service = makeFixtureService({ currentStaticExposures: [STATIC_MCP_EXPOSURE] });
    const model = makeFixtureModel([service]);
    const overlay = {
      ...emptyOverlay(NOW),
      protocolActivations: [
        {
          surface: 'mcp' as const,
          registrationId: STATIC_MCP_EXPOSURE.registrationId,
          runtimeEnabled: false,
          economicAdmissionEnabled: false,
        },
      ],
    };

    const view = await project(model, overlay, { generatedAt: NOW });
    const exposure = view.services[0].interactions[0].currentStaticExposures[0];

    expect(exposure.registrationId).toBe(STATIC_MCP_EXPOSURE.registrationId);
    expect(exposure.runtimeEnabled).toBe(false);
    expect(exposure.economicAdmissionEnabled).toBe(false);
  });

  it('does not infer external publication from mounted code', async () => {
    const service = makeFixtureService({ currentStaticExposures: [STATIC_MCP_EXPOSURE] });
    const model = makeFixtureModel([service]);
    const view = await project(model, emptyOverlay(NOW), { generatedAt: NOW });

    expect(view.services[0].interactions[0].currentStaticExposures[0].externalPublication).toEqual({
      kind: 'UNMEASURED',
    });
  });

  it('rejects operational activation that invents an unregistered static exposure', () => {
    const model = makeFixtureModel();
    const overlay = {
      ...emptyOverlay(NOW),
      protocolActivations: [
        {
          surface: 'mcp' as const,
          registrationId: 'not_registered',
          runtimeEnabled: true,
          economicAdmissionEnabled: true,
        },
      ],
    };

    const result = validateRuntimeOverlay(overlay, model);

    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain(
      'OPERATIONAL_ACTIVATION_WITHOUT_STATIC_EXPOSURE'
    );
  });

  it('keeps current static exposure unchanged when operational activation changes', async () => {
    const service = makeFixtureService({ currentStaticExposures: [STATIC_MCP_EXPOSURE] });
    const model = makeFixtureModel([service]);
    const disabled = emptyOverlay(NOW);
    const enabled = {
      ...emptyOverlay(NOW),
      protocolActivations: [
        {
          surface: 'mcp' as const,
          registrationId: STATIC_MCP_EXPOSURE.registrationId,
          runtimeEnabled: true,
          economicAdmissionEnabled: true,
        },
      ],
    };

    const disabledView = await project(model, disabled, { generatedAt: NOW });
    const enabledView = await project(model, enabled, { generatedAt: NOW });

    expect(disabledView.services[0].interactions[0].currentStaticExposures[0].registrationId).toBe(
      enabledView.services[0].interactions[0].currentStaticExposures[0].registrationId
    );
    expect(disabledView.services[0].interactions[0].currentStaticExposures[0].runtimeEnabled).toBe(
      false
    );
    expect(enabledView.services[0].interactions[0].currentStaticExposures[0].runtimeEnabled).toBe(
      true
    );
  });
});
