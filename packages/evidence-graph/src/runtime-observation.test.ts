/**
 * R3-A4-55: runtime self-report observations, staged release capture and
 * forward-looking toolchain provenance.
 */
import { describe, expect, it } from 'vitest';
import {
  buildCommandIdentity,
  buildProvenanceRecords,
  evaluateProvenanceChain,
  packageManagerIdentity,
  parseRuntimeVersionReport,
  recordArtifactStage,
  recordBuildStage,
  recordSourceStage,
  recordVersionStage,
  sealRecord,
  sealRuntimeSelfReport,
  verifyUploadStage,
  type BuildRecord,
  type CaptureInput,
  type ProvenanceRecord,
} from './index';

const A = 'a'.repeat(64);
const V1 = '11111111-1111-4111-8111-111111111111';
const V2 = '22222222-2222-4222-8222-222222222222';
const D1 = '33333333-3333-4333-8333-333333333333';
const UNIT = 'unit-a';
const T_OPTS = { now: '2026-09-28T16:30:00Z', maxObservationAgeMs: 3_600_000 };
const EXPECT = { environment: 'production' as const, deployment_unit: UNIT };

function input(): CaptureInput {
  return {
    environment: 'production',
    deployment_unit: UNIT,
    captured_at: '2026-09-28T16:00:00Z',
    actor: 'test',
    source: {
      repository: 'repo',
      commit: 'c'.repeat(40),
      ref: 'main',
      reachable_from_protected_ref: true,
    },
    build: {
      dirty: false,
      toolchain: { node: 'v0', wrangler: '0', package_manager: 'pnpm@0', lockfile_sha256: null },
      command: 'wrangler deploy --dry-run',
      toolchain_provenance: 'ORIGINAL_RELEASE_TOOLCHAIN',
      config_path: 'wrangler.toml',
      main_module: 'index.js',
      modules: [{ name: 'index.js', sha256: A }],
    },
    platform_version: {
      id: V1,
      number: 1,
      created_on: '2026-09-28T15:00:00Z',
      main_module: 'index.js',
      modules: [{ name: 'index.js', sha256: A }],
      annotations: {},
      evidence_source: 'GET version',
    },
    deployment: {
      id: D1,
      created_on: '2026-09-28T15:10:00Z',
      strategy: 'percentage',
      traffic: [{ version_id: V1, percentage: 100 }],
      annotations: {},
      evidence_source: 'GET deployments',
    },
    observation: {
      kind: 'PLATFORM_ACTIVE_DEPLOYMENT',
      observed_at: '2026-09-28T16:00:00Z',
      deployment_id: D1,
      version_id: V1,
      traffic_percentage: 100,
      evidence_source: 'GET deployments',
    },
  };
}

async function selfReport(parent: ProvenanceRecord, report: Record<string, unknown>, unit = UNIT) {
  return sealRuntimeSelfReport({
    environment: 'production',
    deployment_unit: unit,
    captured_at: '2026-09-28T16:01:00Z',
    observed_at: '2026-09-28T16:01:00Z',
    actor: 'test',
    observation_surface: 'GET /health#runtime',
    evidence_source: 'GET https://example.test/health',
    parent_ids: [parent.record_id],
    report: parseRuntimeVersionReport(report),
  });
}

describe('runtime self-report (Phase 5/6)', () => {
  it('parses a CF_VERSION_METADATA report strictly', () => {
    const r = parseRuntimeVersionReport({
      deployment_unit: UNIT,
      platform_version_id: V1,
      platform_version_tag: 'release-x',
      platform_version_timestamp: '2026-09-28T15:00:00Z',
    });
    expect(r.platform_version_id).toBe(V1);
    expect(() => parseRuntimeVersionReport({ deployment_unit: UNIT })).toThrow();
    expect(() =>
      parseRuntimeVersionReport({ deployment_unit: UNIT, platform_version_id: 'not-a-uuid' })
    ).toThrow();
    expect(() =>
      parseRuntimeVersionReport({
        deployment_unit: UNIT,
        platform_version_id: V1,
        expected_version_id: V1,
      })
    ).toThrow(/unexpected keys/);
  });

  it('self-report input has no expected-version parameter to echo', async () => {
    const recs = await buildProvenanceRecords(input());
    const dep = recs.find((r) => r.record_type === 'DeploymentRecord')!;
    const obs = await selfReport(dep, { deployment_unit: UNIT, platform_version_id: V2 });
    // The observed id is exactly what the runtime said, never a caller value.
    expect(obs.observed_version_id).toBe(V2);
    expect(obs.observation_kind).toBe('RUNTIME_SELF_REPORT');
    expect(obs.proof.methods).toEqual(['OBSERVED_RUNTIME']);
  });

  it('platform deployment A + runtime self-report A -> COMPLETE with OBSERVED_RUNTIME', async () => {
    const recs = (await buildProvenanceRecords(input())).filter(
      (r) => r.record_type !== 'RuntimeObservationRecord'
    );
    const dep = recs.find((r) => r.record_type === 'DeploymentRecord')!;
    const obs = await selfReport(dep, {
      deployment_unit: UNIT,
      platform_version_id: V1,
      platform_version_tag: 'release-x',
      platform_version_timestamp: '2026-09-28T15:00:00Z',
    });
    const r = await evaluateProvenanceChain(
      [...recs, obs],
      { ...EXPECT, platform_version_id: V1 },
      T_OPTS
    );
    expect(r.status).toBe('COMPLETE_PLATFORM_ATTESTED');
    expect(r.links.DEPLOYMENT_TO_RUNTIME.methods).toEqual(['OBSERVED_RUNTIME']);
  });

  it('expected deployment version A, runtime reports B -> CONFLICT (never repaired)', async () => {
    const recs = await buildProvenanceRecords(input());
    const dep = recs.find((r) => r.record_type === 'DeploymentRecord')!;
    const withoutPlatformObs = recs.filter((r) => r.record_type !== 'RuntimeObservationRecord');
    const obs = await selfReport(dep, { deployment_unit: UNIT, platform_version_id: V2 });

    const alone = await evaluateProvenanceChain([...withoutPlatformObs, obs], EXPECT, T_OPTS);
    expect(alone.status).toBe('CONFLICT');
    expect(alone.findings.map((f) => f.code)).toContain('RUNTIME_SELF_REPORT_CONFLICT');

    const both = await evaluateProvenanceChain([...recs, obs], EXPECT, T_OPTS);
    expect(both.status).toBe('CONFLICT');
    expect(both.findings.map((f) => f.code)).toContain('CONFLICTING_EVIDENCE');

    const expected = await evaluateProvenanceChain(
      [...withoutPlatformObs, obs],
      { ...EXPECT, platform_version_id: V1 },
      T_OPTS
    );
    expect(expected.status).toBe('CONFLICT');
    expect(expected.resolved.platform_version_id).toBeNull();
  });

  it('runtime naming a different deployment unit -> CONFLICT', async () => {
    const recs = (await buildProvenanceRecords(input())).filter(
      (r) => r.record_type !== 'RuntimeObservationRecord'
    );
    const dep = recs.find((r) => r.record_type === 'DeploymentRecord')!;
    const obs = await selfReport(dep, { deployment_unit: 'other-unit', platform_version_id: V1 });
    const r = await evaluateProvenanceChain([...recs, obs], EXPECT, T_OPTS);
    expect(r.status).toBe('CONFLICT');
  });

  it('self-report record must name its surface and carry no deployment id', async () => {
    const recs = await buildProvenanceRecords(input());
    const obs = recs.find((r) => r.record_type === 'RuntimeObservationRecord')!;
    const { record_id: _id, ...unsigned } = obs;
    void _id;
    await expect(
      sealRecord({ ...unsigned, observation_kind: 'RUNTIME_SELF_REPORT' } as never)
    ).rejects.toThrow(/observation_surface/);
  });
});

describe('staged release capture (Phase 7)', () => {
  const c = input();

  it('each stage seals a new record parented on the previous one', async () => {
    const source = await recordSourceStage(c, c.source);
    const build = await recordBuildStage(c, source, c.build);
    const artifact = await recordArtifactStage(c, build, c.build.modules);
    expect(build.parent_ids).toEqual([source.record_id]);
    expect(artifact.parent_ids).toEqual([build.record_id]);
    expect(Object.isFrozen(source) && Object.isFrozen(build) && Object.isFrozen(artifact)).toBe(
      true
    );
    const version = await recordVersionStage(c, artifact, c.platform_version);
    expect(version.parent_ids).toEqual([artifact.record_id]);
    expect(verifyUploadStage(artifact, version).verified).toBe(true);
  });

  it('ARTIFACT stage refuses bytes that differ from the build record', async () => {
    const source = await recordSourceStage(c, c.source);
    const build = await recordBuildStage(c, source, c.build);
    await expect(
      recordArtifactStage(c, build, [{ name: 'index.js', sha256: 'b'.repeat(64) }])
    ).rejects.toThrow(/differ/);
  });

  it('VERIFY stage fails when the platform returns different bytes', async () => {
    const source = await recordSourceStage(c, c.source);
    const build = await recordBuildStage(c, source, c.build);
    const artifact = await recordArtifactStage(c, build, c.build.modules);
    const version = await recordVersionStage(c, artifact, {
      ...c.platform_version,
      modules: [{ name: 'index.js', sha256: 'b'.repeat(64) }],
    });
    expect(verifyUploadStage(artifact, version).verified).toBe(false);
  });
});

describe('toolchain provenance (Phase 8)', () => {
  it('future builds record ORIGINAL_RELEASE_TOOLCHAIN; historical rebuilds stay unlabelled or REBUILD', async () => {
    const recs = await buildProvenanceRecords(input());
    const build = recs.find((r) => r.record_type === 'BuildRecord') as BuildRecord;
    expect(build.toolchain_provenance).toBe('ORIGINAL_RELEASE_TOOLCHAIN');
    const legacy = input();
    const { toolchain_provenance: _t, ...legacyBuild } = legacy.build;
    void _t;
    const old = (await buildProvenanceRecords({ ...legacy, build: legacyBuild })).find(
      (r) => r.record_type === 'BuildRecord'
    ) as BuildRecord;
    expect('toolchain_provenance' in old).toBe(false);
    await expect(
      sealRecord({ ...build, record_id: undefined, toolchain_provenance: 'GUESSED' } as never)
    ).rejects.toThrow(/toolchain_provenance/);
  });

  it('package manager identity must match the declared packageManager', () => {
    expect(packageManagerIdentity('{"packageManager":"pnpm@9.1.0"}', '9.1.0')).toBe('pnpm@9.1.0');
    expect(() => packageManagerIdentity('{"packageManager":"pnpm@9.1.0"}', '8.0.0')).toThrow();
  });

  it('build command identity masks only the output directory', () => {
    expect(
      buildCommandIdentity(['wrangler', 'deploy', '--dry-run', '--outdir', '/tmp/x'], '/tmp/x')
    ).toBe('wrangler deploy --dry-run --outdir <outdir>');
  });
});
