import { describe, expect, it } from 'vitest';
import {
  computeEffectiveViewDigest,
  computeModelDigest,
  computeRuntimeOverlayDigest,
  computeServiceDigest,
} from './digests';
import { project } from './effective-view';
import { emptyOverlay } from './runtime-overlay';
import { makeFixtureModel, makeFixtureService } from './test-fixtures';

describe('computeModelDigest', () => {
  it('is unchanged by a different compiledAt (volatile field excluded)', async () => {
    const modelA = makeFixtureModel();
    const modelB = {
      ...modelA,
      modelIdentity: { ...modelA.modelIdentity, compiledAt: '2099-01-01T00:00:00.000Z' },
    };
    expect(await computeModelDigest(modelA)).toBe(await computeModelDigest(modelB));
  });

  it('is unchanged by service array reorder (canonically set-like)', async () => {
    const a = makeFixtureService({ id: { family: 'company_evidence_graph', generation: 'v1' } });
    const b = makeFixtureService({ id: { family: 'web_context_verified', generation: 'v1' } });
    const modelForward = makeFixtureModel([a, b]);
    const modelReversed = makeFixtureModel([b, a]);
    expect(await computeModelDigest(modelForward)).toBe(await computeModelDigest(modelReversed));
  });

  it('changes when a semantic field changes (title)', async () => {
    const modelA = makeFixtureModel();
    const svc = makeFixtureService({ title: 'Renamed Service' });
    const modelB = makeFixtureModel([svc]);
    expect(await computeModelDigest(modelA)).not.toBe(await computeModelDigest(modelB));
  });

  it('changes when the economic ceiling changes', async () => {
    const modelA = makeFixtureModel();
    const svc = makeFixtureService({
      economics: {
        ...makeFixtureService().economics,
        governedMaxPrice: { amount: '0.05' as never, currency: 'USD' },
      },
    });
    const modelB = makeFixtureModel([svc]);
    expect(await computeModelDigest(modelA)).not.toBe(await computeModelDigest(modelB));
  });

  // METADATA-VCM-IMPL-02: releaseBasePriceDeclared was not explicitly
  // addressed by METADATA-VCM-04's digest-inclusion decision (only
  // "excluded from economic validation" and "not projected as a live
  // price" were specified). This package's one, pre-existing digest
  // policy -- hash the whole service object minus the named volatile
  // timestamp fields, with no other field-level allowlist/denylist -- is
  // unchanged by this checkpoint and already governs the sibling
  // releaseMaximumPriceDeclared field identically. releaseBasePriceDeclared
  // therefore participates in the model/service digest by the same,
  // pre-existing rule; this test proves it mechanically rather than
  // asserting it by assumption.
  it('changes when releaseBasePriceDeclared changes (EVIDENCE/HISTORICAL field still participates via the pre-existing whole-object digest policy)', async () => {
    const modelA = makeFixtureModel();
    const svc = makeFixtureService({
      economics: {
        ...makeFixtureService().economics,
        releaseBasePriceDeclared: { amount: '0.999' as never, currency: 'USD' },
      },
    });
    const modelB = makeFixtureModel([svc]);
    expect(await computeModelDigest(modelA)).not.toBe(await computeModelDigest(modelB));
  });

  it('changes when a release protocol declaration changes', async () => {
    const serviceA = makeFixtureService();
    const serviceB = makeFixtureService({
      releaseProtocolExposureDeclared: {
        ...serviceA.releaseProtocolExposureDeclared,
        mcp: 'enabled',
      },
    });

    expect(await computeModelDigest(makeFixtureModel([serviceA]))).not.toBe(
      await computeModelDigest(makeFixtureModel([serviceB]))
    );
    expect(await computeServiceDigest(serviceA)).not.toBe(await computeServiceDigest(serviceB));
  });

  it('changes model and service digests when current static exposure changes', async () => {
    const serviceA = makeFixtureService();
    const serviceB = makeFixtureService({
      currentStaticExposures: [
        {
          surface: 'mcp',
          registrationId: 'siteborne_build_company_evidence_graph',
          operationId: 'evaluate',
          exposureShape: 'standalone_tool',
          provenance: {
            sourcePackage: '@siteborne/protocol-mcp',
            sourceModule: 'src/constants.ts#MCP_SERVICE_TOOLS',
            sourceRegistrationId: 'siteborne_build_company_evidence_graph',
            runtimeSourceCommit: 'a'.repeat(40) as never,
            derivationMethod: 'typed_export',
          },
        },
      ],
    });

    expect(await computeModelDigest(makeFixtureModel([serviceA]))).not.toBe(
      await computeModelDigest(makeFixtureModel([serviceB]))
    );
    expect(await computeServiceDigest(serviceA)).not.toBe(await computeServiceDigest(serviceB));
  });

  it('changes the model digest when a current static utility exposure changes', async () => {
    const modelA = makeFixtureModel();
    const modelB = {
      ...modelA,
      currentStaticUtilityExposures: [
        {
          surface: 'mcp' as const,
          registrationId: 'siteborne_get_quote',
          operationId: 'get_quote',
          exposureShape: 'standalone_tool' as const,
          utilityKind: 'quote_request' as const,
          provenance: {
            sourcePackage: '@siteborne/protocol-mcp',
            sourceModule: 'src/constants.ts#MCP_TOOL_NAMES',
            sourceRegistrationId: 'siteborne_get_quote',
            runtimeSourceCommit: 'a'.repeat(40) as never,
            derivationMethod: 'typed_export' as const,
          },
        },
      ],
    };

    expect(await computeModelDigest(modelA)).not.toBe(await computeModelDigest(modelB));
  });
});

describe('computeServiceDigest', () => {
  it('two structurally identical services produce the same digest', async () => {
    const a = makeFixtureService();
    const b = makeFixtureService();
    expect(await computeServiceDigest(a)).toBe(await computeServiceDigest(b));
  });

  it('a schema digest change changes the service digest', async () => {
    const a = makeFixtureService();
    const b = makeFixtureService({
      contract: {
        ...a.contract,
        inputSchema: { ...a.contract.inputSchema, digest: `sha256:${'c'.repeat(64)}` as never },
      },
    });
    expect(await computeServiceDigest(a)).not.toBe(await computeServiceDigest(b));
  });
});

describe('computeRuntimeOverlayDigest', () => {
  it('is unchanged by a different observedAt (volatile field excluded)', async () => {
    const overlayA = emptyOverlay('2026-09-18T00:00:00.000Z' as never);
    const overlayB = emptyOverlay('2099-01-01T00:00:00.000Z' as never);
    expect(await computeRuntimeOverlayDigest(overlayA)).toBe(
      await computeRuntimeOverlayDigest(overlayB)
    );
  });

  it('changes when operational content changes', async () => {
    const overlayA = emptyOverlay('2026-09-18T00:00:00.000Z' as never);
    const overlayB = {
      ...overlayA,
      protocolActivations: [
        {
          surface: 'mcp' as const,
          registrationId: 'siteborne_build_company_evidence_graph',
          runtimeEnabled: true,
          economicAdmissionEnabled: false,
        },
      ],
    };
    expect(await computeRuntimeOverlayDigest(overlayA)).not.toBe(
      await computeRuntimeOverlayDigest(overlayB)
    );
  });

  it('operational activation changes do not change the static model digest', async () => {
    const model = makeFixtureModel();
    const before = await computeModelDigest(model);
    const overlay = {
      ...emptyOverlay('2026-09-18T00:00:00.000Z' as never),
      protocolActivations: [
        {
          surface: 'mcp' as const,
          registrationId: 'siteborne_build_company_evidence_graph',
          runtimeEnabled: true,
          economicAdmissionEnabled: true,
        },
      ],
    };

    await computeRuntimeOverlayDigest(overlay);
    expect(await computeModelDigest(model)).toBe(before);
  });
});

describe('computeEffectiveViewDigest', () => {
  it('matches the digest project() itself computed', async () => {
    const model = makeFixtureModel();
    const overlay = emptyOverlay('2026-09-18T00:00:00.000Z' as never);
    const view = await project(model, overlay, {
      generatedAt: '2026-09-18T00:00:00.000Z' as never,
    });
    expect(await computeEffectiveViewDigest(view)).toBe(view.digest);
  });
});
