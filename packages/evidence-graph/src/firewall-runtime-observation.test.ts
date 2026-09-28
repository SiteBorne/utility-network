/**
 * R3-A4-55 Phase 9: authority firewall after runtime-observation and release
 * capture integration (F6-F9), with mutation tests proving each check fires.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AUTHORITY_MODULES,
  EvidenceGraph,
  RUNTIME_OBSERVATION_MODULE,
  buildProvenanceRecords,
  checkReleaseCaptureBoundary,
  checkRuntimeObservationBoundary,
  findForbiddenPayloadKeys,
  importsEvidenceGraph,
  makeNode,
  nodeRow,
  projectProvenance,
  sealRuntimeSelfReport,
  type CaptureInput,
} from './index';

const REPO = resolve(__dirname, '../../..');
const RELEASE_DIR = join(REPO, 'scripts/release');
const releaseTools = readdirSync(RELEASE_DIR)
  .filter((f) => /\.(mts|ts)$/.test(f) && !f.endsWith('.test.ts'))
  .map((f) => [`scripts/release/${f}`, readFileSync(join(RELEASE_DIR, f), 'utf8')] as const);

// The candidate observation module, as shipped on both backport lines.
const OBSERVATION_MODULE_TEXT = `
export interface VersionMetadataBinding { readonly id: string; readonly tag: string; readonly timestamp: string }
export function runtimeVersionReport(metadata, unit) { return metadata ? { deployment_unit: unit, platform_version_id: metadata.id } : null; }
export function emitRuntimeVersionEvent(env, unit) { try { console.info(JSON.stringify((env as { CF_VERSION_METADATA?: VersionMetadataBinding }).CF_VERSION_METADATA)); } catch {} }
`;
const WORKFLOW = 'apps/edge-api/src/control-plane/workflows/paid-continuation-workflow.ts';
const CANDIDATE_WORKFLOW_TEXT = `
import { buildProductionPaidContinuationWorkflowDependencies } from './production-dependencies';
import { emitRuntimeVersionEvent } from '../../runtime-observation';
export class PaidContinuationWorkflow { async run(event, step) { emitRuntimeVersionEvent(this.env, 'siteborne-paid-continuation-runtime'); } }
`;

function candidateTree(overrides: Record<string, string> = {}): Map<string, string> {
  return new Map(
    Object.entries({
      [RUNTIME_OBSERVATION_MODULE]: OBSERVATION_MODULE_TEXT,
      'apps/edge-api/src/control-plane/config/env.ts':
        "import type { VersionMetadataBinding } from '../../runtime-observation';\nexport interface Env { CF_VERSION_METADATA?: VersionMetadataBinding }",
      'apps/edge-api/src/routes/health.ts':
        "import { runtimeVersionReport } from '../runtime-observation';\nconst r = runtimeVersionReport(c.env?.CF_VERSION_METADATA, 'siteborne-utility-edge');",
      [WORKFLOW]: CANDIDATE_WORKFLOW_TEXT,
      ...overrides,
    })
  );
}

describe('F6-F8 runtime observation boundary', () => {
  it('the qualified candidate shape passes', () => {
    expect(checkRuntimeObservationBoundary(candidateTree())).toEqual([]);
  });

  it('MUTATION: an authority module reading CF_VERSION_METADATA is caught (F6)', () => {
    for (const m of AUTHORITY_MODULES) {
      const v = checkRuntimeObservationBoundary(
        candidateTree({
          [m]: 'if (env.CF_VERSION_METADATA.id === expected) await dispatchProvider();',
        })
      );
      expect(v.map((x) => x.rule)).toContain('F6');
    }
  });

  it('MUTATION: an authority module using the returning report API is caught (F7)', () => {
    const v = checkRuntimeObservationBoundary(
      candidateTree({
        [WORKFLOW]:
          "import { runtimeVersionReport } from '../../runtime-observation';\nif (runtimeVersionReport(m, u)?.platform_version_id) settle();",
      })
    );
    expect(v.map((x) => x.rule)).toContain('F7');
  });

  it('MUTATION: the observation module importing anything is caught (F8)', () => {
    const v = checkRuntimeObservationBoundary(
      candidateTree({
        [RUNTIME_OBSERVATION_MODULE]:
          "import { D1PaymentAttemptRepository } from './control-plane/repositories/d1/payment-attempts';\n" +
          OBSERVATION_MODULE_TEXT,
      })
    );
    expect(v.map((x) => x.rule)).toContain('F8');
  });

  it('MUTATION: an authority module importing the evidence graph is still caught (F4)', () => {
    expect(
      importsEvidenceGraph("import { loadEvidenceGraph } from '@siteborne/evidence-graph';")
    ).toBe(true);
  });
});

describe('F9 release capture boundary', () => {
  it('every release tool in this tree passes', () => {
    expect(releaseTools.length).toBeGreaterThanOrEqual(3);
    for (const [file, text] of releaseTools)
      expect(checkReleaseCaptureBoundary(file, text)).toEqual([]);
  });

  it('the staged tool builds only with --dry-run', () => {
    const text = releaseTools.find(([f]) => f.endsWith('release-provenance.mts'))![1];
    const deployArrays = [...text.matchAll(/\[[^\]]*'deploy'[^\]]*\]/g)].map((m) => m[0]);
    expect(deployArrays.length).toBe(1);
    expect(deployArrays[0].replace(/\s+/g, ' ')).toContain("'deploy', '--dry-run'");
  });

  const base = releaseTools.find(([f]) => f.endsWith('release-provenance.mts'))![1];
  it.each([
    ["fetch(u, { method: 'POST' })", 'mutating HTTP'],
    ["fetch(u, { method: 'DELETE' })", 'mutating HTTP'],
    ["execFileSync('pnpm', ['exec', 'wrangler', 'versions', 'upload'])", 'versions upload'],
    ["execFileSync('pnpm', ['exec', 'wrangler', 'deploy', '--config', c])", 'real deploy'],
    ["execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'DB', '--remote'])", 'd1 execute'],
    ["execFileSync('pnpm', ['exec', 'wrangler', 'secret', 'put', 'X'])", 'secret put'],
    [
      "import { mint } from '../../apps/edge-api/src/control-plane/security/result-authorization';",
      'control-plane import',
    ],
    ["import { settle } from '@siteborne/protocol-x402';", 'payment import'],
  ])('MUTATION: %s is caught (%s)', (inject) => {
    const v = checkReleaseCaptureBoundary(
      'scripts/release/release-provenance.mts',
      `${inject}\n${base}`
    );
    expect(v.map((x) => x.rule)).toContain('F9');
  });
});

describe('evidence produced by runtime observation carries no authority', () => {
  const input = (): CaptureInput => ({
    environment: 'production',
    deployment_unit: 'u',
    captured_at: '2026-09-28T16:00:00Z',
    actor: 't',
    source: {
      repository: 'r',
      commit: 'c'.repeat(40),
      ref: null,
      reachable_from_protected_ref: true,
    },
    build: {
      dirty: false,
      toolchain: { node: 'v0', wrangler: '0', package_manager: 'pnpm@0', lockfile_sha256: null },
      command: 'x',
      config_path: 'c',
      main_module: 'index.js',
      modules: [{ name: 'index.js', sha256: 'a'.repeat(64) }],
    },
    platform_version: {
      id: '11111111-1111-4111-8111-111111111111',
      number: 1,
      created_on: '2026-09-28T15:00:00Z',
      main_module: 'index.js',
      modules: [{ name: 'index.js', sha256: 'a'.repeat(64) }],
      annotations: {},
      evidence_source: 'x',
    },
    deployment: {
      id: '33333333-3333-4333-8333-333333333333',
      created_on: '2026-09-28T15:10:00Z',
      strategy: 'percentage',
      traffic: [{ version_id: '11111111-1111-4111-8111-111111111111', percentage: 100 }],
      annotations: {},
      evidence_source: 'x',
    },
    observation: {
      kind: 'PLATFORM_ACTIVE_DEPLOYMENT',
      observed_at: '2026-09-28T16:00:00Z',
      deployment_id: '33333333-3333-4333-8333-333333333333',
      version_id: '11111111-1111-4111-8111-111111111111',
      traffic_percentage: 100,
      evidence_source: 'x',
    },
  });

  it('a RuntimeObservationRecord projects to an authority-NONE node with no grant-shaped fields', async () => {
    const recs = await buildProvenanceRecords(input());
    const dep = recs.find((r) => r.record_type === 'DeploymentRecord')!;
    const obs = await sealRuntimeSelfReport({
      environment: 'production',
      deployment_unit: 'u',
      captured_at: '2026-09-28T16:01:00Z',
      observed_at: '2026-09-28T16:01:00Z',
      actor: 't',
      observation_surface: 'GET /health#runtime',
      evidence_source: 'GET /health',
      parent_ids: [dep.record_id],
      report: {
        deployment_unit: 'u',
        platform_version_id: '11111111-1111-4111-8111-111111111111',
        platform_version_tag: 'release-3-a4-provenance-edge-01',
        platform_version_timestamp: null,
      },
    });
    const g = new EvidenceGraph();
    await projectProvenance(g, [...recs, obs]);
    for (const n of g.allNodes()) {
      expect(n.authority).toBe('NONE');
      expect(findForbiddenPayloadKeys(n.attributes)).toEqual([]);
    }
  });

  it('MUTATION: persistence refuses a node claiming authority or carrying a grant field', async () => {
    const good = await makeNode({
      node_type: 'RuntimeObservation',
      environment: 'production',
      subject_key: 'u@t',
      recorded_at: '2026-09-28T16:00:00Z',
      proof: { binding: 'PLATFORM_ATTESTED', methods: ['OBSERVED_RUNTIME'] },
      attributes: {},
    });
    await expect(nodeRow({ ...good, authority: 'SETTLEMENT' } as never)).rejects.toThrow(
      /authority/
    );
    await expect(
      nodeRow({ ...good, attributes: { result_release_permit: 'x' } } as never)
    ).rejects.toThrow(/grant\/secret/);
  });
});
