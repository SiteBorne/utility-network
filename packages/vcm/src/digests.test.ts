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

  // METADATA-VCM-IMPL-02: legacyBasePriceDeclared was not explicitly
  // addressed by METADATA-VCM-04's digest-inclusion decision (only
  // "excluded from economic validation" and "not projected as a live
  // price" were specified). This package's one, pre-existing digest
  // policy -- hash the whole service object minus the named volatile
  // timestamp fields, with no other field-level allowlist/denylist -- is
  // unchanged by this checkpoint and already governs the sibling
  // legacyMaximumPriceDeclared field identically. legacyBasePriceDeclared
  // therefore participates in the model/service digest by the same,
  // pre-existing rule; this test proves it mechanically rather than
  // asserting it by assumption.
  it('changes when legacyBasePriceDeclared changes (EVIDENCE/HISTORICAL field still participates via the pre-existing whole-object digest policy)', async () => {
    const modelA = makeFixtureModel();
    const svc = makeFixtureService({
      economics: {
        ...makeFixtureService().economics,
        legacyBasePriceDeclared: { amount: '0.999' as never, currency: 'USD' },
      },
    });
    const modelB = makeFixtureModel([svc]);
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
      routes: [
        {
          serviceId: 'company_evidence_graph.v1' as const,
          interactionOperationId: 'evaluate',
          runtimeEnabled: true,
          economicAdmissionEnabled: false,
        },
      ],
    };
    expect(await computeRuntimeOverlayDigest(overlayA)).not.toBe(
      await computeRuntimeOverlayDigest(overlayB)
    );
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
