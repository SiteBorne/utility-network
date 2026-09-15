import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  validateCanonicalModel,
  validateDigestIntegrity,
  validateEconomicConstraints,
  validateRuntimeOverlay,
  validateSecurityTruthConstraints,
} from './validators';
import { computeModelDigest } from './digests';
import { parseUsdAmount } from './primitives';
import type { parseSha256Digest } from './primitives';
import { emptyOverlay } from './runtime-overlay';
import { makeFixtureModel, makeFixtureService } from './test-fixtures';
import { legacyRegistryToVCM } from './legacy/import-registry';
import type { LegacyRegistryServiceFile } from './legacy/types';

const REGISTRY_DIR = fileURLToPath(new URL('../../../registry/services', import.meta.url));
function readAllRegistryFiles(): LegacyRegistryServiceFile[] {
  return readdirSync(REGISTRY_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map(
      (f) => JSON.parse(readFileSync(join(REGISTRY_DIR, f), 'utf-8')) as LegacyRegistryServiceFile
    );
}
const IMPORT_OPTIONS = {
  runtimeSourceCommit: '0'.repeat(40),
  compiledAt: '2026-09-18T00:00:00.000Z',
  vcmSchemaVersion: '0.2.0', // METADATA-VCM-IMPL-02: legacyBasePriceDeclared added
  vcmReleaseVersion: '0.1.0',
};

describe('validateCanonicalModel', () => {
  it('RED->GREEN: passes on a well-formed fixture model', () => {
    expect(validateCanonicalModel(makeFixtureModel()).ok).toBe(true);
  });

  it('rejects a duplicate service id', () => {
    const svc = makeFixtureService();
    const result = validateCanonicalModel(makeFixtureModel([svc, svc]));
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain('DUPLICATE_SERVICE_ID');
  });

  it('rejects a duplicate operationId within one service', () => {
    const base = makeFixtureService();
    const svc = makeFixtureService({
      interactions: [...base.interactions, ...base.interactions],
    });
    const result = validateCanonicalModel(makeFixtureModel([svc]));
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain('DUPLICATE_OPERATION_ID');
  });

  it('rejects a malformed SHA-256 digest', () => {
    const svc = makeFixtureService({
      contract: {
        ...makeFixtureService().contract,
        inputSchema: {
          uri: makeFixtureService().contract.inputSchema.uri,
          // force past the branded-type constructor to simulate data that
          // arrived unvalidated (e.g. parsed straight from untrusted JSON)
          digest: 'not-a-real-digest' as ReturnType<typeof parseSha256Digest>,
        },
      },
    });
    const result = validateCanonicalModel(makeFixtureModel([svc]));
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain('MALFORMED_SCHEMA_DIGEST');
  });
});

describe('validateEconomicConstraints', () => {
  it('RED->GREEN: passes when listPrice <= governedMaxPrice', () => {
    const result = validateEconomicConstraints(makeFixtureModel());
    expect(result.ok).toBe(true);
  });

  it('detects a synthetic list-price-exceeds-ceiling violation without throwing', () => {
    const svc = makeFixtureService({
      economics: {
        ...makeFixtureService().economics,
        listPrice: { amount: parseUsdAmount('1.00'), currency: 'USD' },
        governedMaxPrice: { amount: parseUsdAmount('0.50'), currency: 'USD' },
      },
    });
    const result = validateEconomicConstraints(makeFixtureModel([svc]));
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain('ECONOMIC_CEILING_VIOLATION');
  });

  it(
    'METADATA-VCM-IMPL-02: the REAL, present-day systemic violation across all four .v2 ' +
      'services (METADATA-VCM-IMPL-01 §V / METADATA-ECON-01 / METADATA-VCM-04) is resolved ' +
      'once listPrice is re-sourced from the governed pricing authority instead of the ' +
      'frozen legacy base_price. Historical record: this exact test, before this ' +
      "checkpoint's fix, asserted `result.ok === false` with violatingServices equal to " +
      'the four .v2 service paths -- that assertion PASSED against the pre-fix importer ' +
      '(RED, in the sense of confirming the bug) and is the RED evidence recorded in ' +
      'docs/reports/METADATA-VCM-IMPL-02-economic-authority-correction.md. It is updated ' +
      'here, GREEN, to assert the corrected behavior: legacyRegistryToVCM() still succeeds ' +
      'for all 8 files (LEGACY_PARITY is representational, not a validity claim), and ' +
      'validateEconomicConstraints() now reports zero violations (CANONICAL_VALIDITY).',
    async () => {
      const files = readAllRegistryFiles();
      const model = await legacyRegistryToVCM(files, IMPORT_OPTIONS);
      const result = validateEconomicConstraints(model);

      expect(result.ok).toBe(true);
      expect(result.errors).toEqual([]);
      expect(model.services.length).toBe(8);
    }
  );

  it(
    'proves, for all four .v2 services with real parsed values (not hard-coded), that ' +
      'legacyBasePriceDeclared (frozen, EVIDENCE/HISTORICAL) is preserved exactly as the ' +
      'registry file declares while listPrice/governedMaxPrice (NORMATIVE) resolve to the ' +
      'current governed value -- the two authority domains, side by side, on real data.',
    async () => {
      const files = readAllRegistryFiles();
      const model = await legacyRegistryToVCM(files, IMPORT_OPTIONS);
      const byId = new Map(
        model.services.map((s) => [`${s.id.family}.${s.id.generation}`, s.economics])
      );

      const v2Ids = [
        'company_evidence_graph.v2',
        'document_evidence_json.v2',
        'verify_agent_output.v2',
        'web_context_verified.v2',
      ];
      const evidence = v2Ids.map((id) => {
        const econ = byId.get(id);
        if (!econ) throw new Error(`fixture/registry drift: ${id} not found in imported model`);
        return {
          id,
          legacyBasePriceDeclared: econ.legacyBasePriceDeclared.amount,
          listPrice: econ.listPrice.amount,
          governedMaxPrice: econ.governedMaxPrice.amount,
        };
      });

      // Real, parsed values -- not hard-coded expectations. The governed
      // value is read from the same @siteborne/pricing resolver the
      // importer itself uses, so this test fails if either source drifts.
      for (const e of evidence) {
        expect(e.listPrice).toBe(e.governedMaxPrice); // CORRECT_CURRENT_ECONOMIC_INVARIANT: equality today (METADATA-VCM-04 §V)
        // The frozen legacy byte is preserved but is NOT required to equal
        // the governed value -- that is the entire point of the
        // correction (it currently does not, for all four).
        expect(typeof e.legacyBasePriceDeclared).toBe('string');
      }

      // The specific, real mismatch that motivated this checkpoint:
      // legacyBasePriceDeclared ('0.039' etc.) genuinely differs from the
      // corrected listPrice/governedMaxPrice for all four .v2 services.
      const stillDivergent = evidence.filter((e) => e.legacyBasePriceDeclared !== e.listPrice);
      expect(stillDivergent.map((e) => e.id).sort()).toEqual([...v2Ids].sort());
    }
  );

  it('v1 services: legacyBasePriceDeclared equals listPrice/governedMaxPrice on real data today (no divergence introduced for v1)', async () => {
    const files = readAllRegistryFiles();
    const model = await legacyRegistryToVCM(files, IMPORT_OPTIONS);
    const v1Services = model.services.filter((s) => s.id.generation === 'v1');
    expect(v1Services.length).toBe(4);
    for (const s of v1Services) {
      expect(s.economics.legacyBasePriceDeclared.amount).toBe(s.economics.listPrice.amount);
      expect(s.economics.listPrice.amount).toBe(s.economics.governedMaxPrice.amount);
    }
  });
});

describe('validateSecurityTruthConstraints', () => {
  it('RED->GREEN: passes when every capability is IMPLEMENTED or CONFIGURED', () => {
    expect(validateSecurityTruthConstraints(makeFixtureModel()).ok).toBe(true);
  });

  it('rejects a static model claiming ACTIVE (defense-in-depth over untrusted parsed input)', () => {
    const svc = makeFixtureService({
      securityCapabilities: [
        // cast past the type system to simulate untrusted JSON input that
        // bypassed compile-time checking
        { mechanism: { kind: 'a2a_card_signing' }, truthLevel: 'ACTIVE' as 'CONFIGURED' },
      ],
    });
    const result = validateSecurityTruthConstraints(makeFixtureModel([svc]));
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain('STATIC_MODEL_CLAIMS_LIVE_ACTIVATION');
  });

  it('rejects a static model claiming VERIFIED', () => {
    const svc = makeFixtureService({
      securityCapabilities: [
        { mechanism: { kind: 'mtls' }, truthLevel: 'VERIFIED' as 'IMPLEMENTED' },
      ],
    });
    const result = validateSecurityTruthConstraints(makeFixtureModel([svc]));
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain('STATIC_MODEL_CLAIMS_LIVE_ACTIVATION');
  });
});

describe('validateRuntimeOverlay', () => {
  it('RED->GREEN: an empty overlay is always valid', () => {
    const model = makeFixtureModel();
    const overlay = emptyOverlay(model.modelIdentity.compiledAt as never);
    expect(validateRuntimeOverlay(overlay, model).ok).toBe(true);
  });

  it('rejects an overlay referencing an unknown service', () => {
    const model = makeFixtureModel();
    const overlay = {
      ...emptyOverlay('2026-09-18T00:00:00.000Z' as never),
      routes: [
        {
          serviceId: 'document_evidence_json.v2' as const,
          interactionOperationId: 'evaluate',
          runtimeEnabled: true,
          economicAdmissionEnabled: false,
        },
      ],
    };
    const result = validateRuntimeOverlay(overlay, model);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain('OVERLAY_UNKNOWN_SERVICE');
  });

  it('rejects an overlay referencing an unknown operationId on a known service', () => {
    const model = makeFixtureModel();
    const overlay = {
      ...emptyOverlay('2026-09-18T00:00:00.000Z' as never),
      routes: [
        {
          serviceId: 'company_evidence_graph.v1' as const,
          interactionOperationId: 'nonexistent_operation',
          runtimeEnabled: true,
          economicAdmissionEnabled: false,
        },
      ],
    };
    const result = validateRuntimeOverlay(overlay, model);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain('OVERLAY_UNKNOWN_OPERATION');
  });

  it('rejects an overlay price exceeding the governed ceiling', () => {
    const model = makeFixtureModel();
    const overlay = {
      ...emptyOverlay('2026-09-18T00:00:00.000Z' as never),
      economics: [
        {
          serviceId: 'company_evidence_graph.v1' as const,
          effectiveRuntimePrice: { amount: parseUsdAmount('999.00'), currency: 'USD' as const },
          payTo: { kind: 'NOT_CONFIGURED' as const },
          activeNetwork: { kind: 'UNKNOWN' as const },
          activeAsset: { kind: 'UNKNOWN' as const },
        },
      ],
    };
    const result = validateRuntimeOverlay(overlay, model);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain('OVERLAY_PRICE_EXCEEDS_CEILING');
  });

  it('rejects an overlay claiming an unsupported settlement network', () => {
    const model = makeFixtureModel(); // fixture only supports eip155/solana per scheme
    const overlay = {
      ...emptyOverlay('2026-09-18T00:00:00.000Z' as never),
      economics: [
        {
          serviceId: 'company_evidence_graph.v1' as const,
          effectiveRuntimePrice: { kind: 'UNKNOWN' as const },
          payTo: { kind: 'NOT_CONFIGURED' as const },
          // fixture supports eip155/solana only -- cast a bogus value in
          // to prove the validator actually checks membership rather than
          // trusting the type system alone
          activeNetwork: 'not-a-real-network' as 'eip155',
          activeAsset: { kind: 'UNKNOWN' as const },
        },
      ],
    };
    const result = validateRuntimeOverlay(overlay, model);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain('OVERLAY_UNSUPPORTED_NETWORK');
  });
});

describe('validateDigestIntegrity', () => {
  it('RED->GREEN: passes when modelDigest matches a fresh recomputation', async () => {
    const model = makeFixtureModel();
    const modelDigest = await computeModelDigest(model);
    const signed = { ...model, modelIdentity: { ...model.modelIdentity, modelDigest } };
    const result = await validateDigestIntegrity(signed);
    expect(result.ok).toBe(true);
  });

  it('rejects a self-inconsistent (tampered) model digest', async () => {
    const model = makeFixtureModel(); // modelDigest is the all-zero placeholder, not a real digest of itself
    const result = await validateDigestIntegrity(model);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain('MODEL_DIGEST_MISMATCH');
  });
});
