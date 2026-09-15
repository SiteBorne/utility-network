import { describe, expect, it } from 'vitest';
import { project } from './effective-view';
import { emptyOverlay } from './runtime-overlay';
import { makeFixtureModel, makeFixtureService } from './test-fixtures';

const GENERATED_AT = '2026-09-18T00:00:00.000Z' as never;

describe('project() -- the narrowing law', () => {
  it('an empty overlay resolves every interaction to disabled, even when statically exposed', async () => {
    const svc = makeFixtureService({
      protocolExposure: makeFixtureService().protocolExposure.map((p) =>
        p.surface === 'mcp'
          ? { ...p, protocolExposed: true, exposureShape: 'standalone_endpoint' }
          : p
      ),
    });
    const model = makeFixtureModel([svc]);
    const overlay = emptyOverlay(GENERATED_AT);
    const view = await project(model, overlay, { generatedAt: GENERATED_AT });

    expect(view.services[0].interactions[0].protocolExposed).toBe(true);
    expect(view.services[0].interactions[0].runtimeEnabled).toBe(false);
    expect(view.services[0].interactions[0].economicAdmissionEnabled).toBe(false);
  });

  it('an overlay cannot widen a statically-unexposed interaction to enabled', async () => {
    const svc = makeFixtureService(); // every surface protocolExposed=false by default
    const model = makeFixtureModel([svc]);
    const overlay = {
      ...emptyOverlay(GENERATED_AT),
      routes: [
        {
          serviceId: 'company_evidence_graph.v1' as const,
          interactionOperationId: 'evaluate',
          runtimeEnabled: true, // attempt to widen
          economicAdmissionEnabled: true,
        },
      ],
    };
    const view = await project(model, overlay, { generatedAt: GENERATED_AT });
    expect(view.services[0].interactions[0].runtimeEnabled).toBe(false);
    expect(view.services[0].interactions[0].economicAdmissionEnabled).toBe(false);
  });

  it('economicAdmissionEnabled cannot be true while runtimeEnabled is false', async () => {
    const svc = makeFixtureService({
      protocolExposure: makeFixtureService().protocolExposure.map((p) =>
        p.surface === 'mcp'
          ? { ...p, protocolExposed: true, exposureShape: 'standalone_endpoint' }
          : p
      ),
    });
    const model = makeFixtureModel([svc]);
    const overlay = {
      ...emptyOverlay(GENERATED_AT),
      routes: [
        {
          serviceId: 'company_evidence_graph.v1' as const,
          interactionOperationId: 'evaluate',
          runtimeEnabled: false,
          economicAdmissionEnabled: true, // attempt to skip straight to admission
        },
      ],
    };
    const view = await project(model, overlay, { generatedAt: GENERATED_AT });
    expect(view.services[0].interactions[0].runtimeEnabled).toBe(false);
    expect(view.services[0].interactions[0].economicAdmissionEnabled).toBe(false);
  });

  it('a mechanism statically IMPLEMENTED-only cannot be reported ACTIVE regardless of overlay claim', async () => {
    const svc = makeFixtureService({
      securityCapabilities: [{ mechanism: { kind: 'mtls' }, truthLevel: 'IMPLEMENTED' }],
    });
    const model = makeFixtureModel([svc]);
    const overlay = {
      ...emptyOverlay(GENERATED_AT),
      security: [
        {
          mechanismKind: 'mtls' as const,
          measuredLevel: 'ACTIVE' as const,
          measuredAt: GENERATED_AT,
        },
      ],
    };
    const view = await project(model, overlay, { generatedAt: GENERATED_AT });
    expect(view.services[0].security[0].truthLevel).toBe('IMPLEMENTED');
  });

  it('a mechanism statically CONFIGURED with a real overlay measurement resolves to that measured level', async () => {
    const svc = makeFixtureService({
      securityCapabilities: [{ mechanism: { kind: 'a2a_card_signing' }, truthLevel: 'CONFIGURED' }],
    });
    const model = makeFixtureModel([svc]);
    const overlay = {
      ...emptyOverlay(GENERATED_AT),
      security: [
        {
          mechanismKind: 'a2a_card_signing' as const,
          measuredLevel: 'VERIFIED' as const,
          measuredAt: GENERATED_AT,
        },
      ],
    };
    const view = await project(model, overlay, { generatedAt: GENERATED_AT });
    expect(view.services[0].security[0].truthLevel).toBe('VERIFIED');
  });

  it('a mechanism statically CONFIGURED but never measured (UNMEASURED) reports the static ceiling, not a live level', async () => {
    const model = makeFixtureModel(); // a2a_card_signing is CONFIGURED, no overlay measurement supplied
    const overlay = emptyOverlay(GENERATED_AT);
    const view = await project(model, overlay, { generatedAt: GENERATED_AT });
    const a2a = view.services[0].security.find((s) => s.mechanismKind === 'a2a_card_signing');
    expect(a2a?.truthLevel).toBe('CONFIGURED');
  });

  it('is pure: the same inputs produce a byte-identical digest across repeated calls', async () => {
    const model = makeFixtureModel();
    const overlay = emptyOverlay(GENERATED_AT);
    const first = await project(model, overlay, { generatedAt: GENERATED_AT });
    const second = await project(model, overlay, {
      generatedAt: '2099-01-01T00:00:00.000Z' as never,
    });
    expect(first.digest).toBe(second.digest); // generatedAt excluded from the digest
  });

  it('does not mutate its inputs', async () => {
    const model = makeFixtureModel();
    const overlay = emptyOverlay(GENERATED_AT);
    const modelBefore = JSON.stringify(model);
    const overlayBefore = JSON.stringify(overlay);
    await project(model, overlay, { generatedAt: GENERATED_AT });
    expect(JSON.stringify(model)).toBe(modelBefore);
    expect(JSON.stringify(overlay)).toBe(overlayBefore);
  });
});
