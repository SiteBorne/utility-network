import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as api from './index';
import {
  AUTHORITY_MODULES,
  EDGE_CONSTITUTION,
  EDGE_TYPES,
  EvidenceGraph,
  InMemoryEvidenceGraphReader,
  assertConstitutionAuthorityNeutral,
  buildProvenanceRecords,
  evaluateProvenanceChain,
  importsControlPlane,
  importsEvidenceGraph,
  makeEdge,
  makeNode,
  projectProvenance,
  sealRecord,
  verifyRecordId,
  weakestBinding,
  type CaptureInput,
  type ProvenanceRecord,
} from './index';

const REPO = resolve(__dirname, '../../..');
const fixture = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/production-2026-09-28.json'), 'utf8')
) as { records: ProvenanceRecord[] };

const HOST = 'siteborne-paid-continuation-runtime';
const EDGE = 'siteborne-utility-edge';
const HOST_VERSION = '639db8bc-6458-4bbc-a2ea-93abfb7c12f4';
const EDGE_VERSION = '5705e934-3598-4541-a776-b9dc4908e121';
const OPTS = { now: '2026-09-28T16:30:00Z', maxObservationAgeMs: 3_600_000 };

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const V1 = '11111111-1111-4111-8111-111111111111';
const V2 = '22222222-2222-4222-8222-222222222222';
const D1 = '33333333-3333-4333-8333-333333333333';
const D2 = '44444444-4444-4444-8444-444444444444';

function input(overrides: Partial<CaptureInput> = {}): CaptureInput {
  return {
    environment: 'production',
    deployment_unit: 'unit-a',
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
      config_path: 'wrangler.toml',
      main_module: 'index.js',
      modules: [
        { name: 'index.js', sha256: A },
        { name: 'index.js.map', sha256: B },
      ],
    },
    platform_version: {
      id: V1,
      number: 1,
      created_on: '2026-09-28T15:00:00Z',
      main_module: 'index.js',
      modules: [{ name: 'index.js', sha256: A }],
      annotations: { message: 'exact source ' + 'c'.repeat(40) },
      evidence_source: 'GET versions',
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
    ...overrides,
  };
}

const EXPECT = { environment: 'production' as const, deployment_unit: 'unit-a' };
const T_OPTS = { now: '2026-09-28T16:10:00Z', maxObservationAgeMs: 3_600_000 };

async function reseal<R extends ProvenanceRecord>(r: R, patch: Partial<R>): Promise<R> {
  const { record_id: _drop, ...rest } = { ...r, ...patch };
  void _drop;
  return sealRecord<R>(rest as never);
}

describe('deterministic evidence identity', () => {
  it('same content yields the same record ids; different content does not', async () => {
    const a = await buildProvenanceRecords(input());
    const b = await buildProvenanceRecords(input());
    expect(a.map((r) => r.record_id)).toEqual(b.map((r) => r.record_id));
    const c = await buildProvenanceRecords(input({ captured_at: '2026-09-28T16:00:01Z' }));
    expect(c[0].record_id).not.toEqual(a[0].record_id);
    for (const r of a) expect(r.record_id).toMatch(/^ev:[a-f0-9]{64}$/);
  });

  it('records are frozen and tampering breaks record_id verification', async () => {
    const [source] = await buildProvenanceRecords(input());
    expect(Object.isFrozen(source)).toBe(true);
    expect(await verifyRecordId(source)).toBe(true);
    expect(
      await verifyRecordId({ ...source, source_commit: 'd'.repeat(40) } as ProvenanceRecord)
    ).toBe(false);
  });

  it('parent ids link each record to its predecessor', async () => {
    const r = await buildProvenanceRecords(input());
    for (let i = 1; i < r.length; i++) expect(r[i].parent_ids).toEqual([r[i - 1].record_id]);
  });

  it('module-set digest ignores source maps so local and platform sets compare', async () => {
    const [, build, artifact, version] = await buildProvenanceRecords(input());
    if (build.record_type !== 'BuildRecord' || version.record_type !== 'PlatformVersionRecord')
      throw new Error();
    expect(build.module_set_digest).toBe(version.platform_module_set_digest);
    expect(artifact.record_type).toBe('ArtifactRecord');
  });

  it('sealRecord fails closed on malformed input', async () => {
    const [source] = await buildProvenanceRecords(input());
    await expect(reseal(source, { source_commit: 'not-a-sha' } as never)).rejects.toThrow(
      /source_commit/
    );
  });
});

describe('provenance-chain completeness', () => {
  it('a complete chain is COMPLETE_PLATFORM_ATTESTED (weakest link), never cryptographic end-to-end', async () => {
    const r = await evaluateProvenanceChain(await buildProvenanceRecords(input()), EXPECT, T_OPTS);
    expect(r.findings).toEqual([]);
    expect(r.status).toBe('COMPLETE_PLATFORM_ATTESTED');
    expect(r.links.SOURCE_TO_ARTIFACT.binding).toBe('CRYPTOGRAPHICALLY_BOUND');
    expect(r.links.ARTIFACT_TO_VERSION.binding).toBe('PLATFORM_ATTESTED');
    expect(r.links.VERSION_TO_DEPLOYMENT.binding).toBe('PLATFORM_ATTESTED');
    expect(r.links.DEPLOYMENT_TO_RUNTIME.binding).toBe('PLATFORM_ATTESTED');
  });

  it('broken/missing source link -> PARTIAL + BROKEN_SOURCE_LINK', async () => {
    const recs = (await buildProvenanceRecords(input())).filter(
      (r) => r.record_type !== 'SourceRecord'
    );
    const r = await evaluateProvenanceChain(recs, EXPECT, T_OPTS);
    expect(r.status).toBe('PARTIAL');
    expect(r.findings.map((f) => f.code)).toContain('BROKEN_SOURCE_LINK');
    expect(r.links.SOURCE_TO_ARTIFACT.binding).toBe('UNKNOWN');
  });

  it('source commit other than expected -> SOURCE_COMMIT_MISMATCH', async () => {
    const r = await evaluateProvenanceChain(
      await buildProvenanceRecords(input()),
      { ...EXPECT, source_commit: 'e'.repeat(40) },
      T_OPTS
    );
    expect(r.status).toBe('PARTIAL');
    expect(r.findings.map((f) => f.code)).toContain('SOURCE_COMMIT_MISMATCH');
  });

  it('mismatched artifact digest -> ARTIFACT_DIGEST_MISMATCH', async () => {
    const recs = await buildProvenanceRecords(
      input({
        platform_version: {
          ...input().platform_version,
          modules: [{ name: 'index.js', sha256: B }],
        },
      })
    );
    const r = await evaluateProvenanceChain(recs, EXPECT, T_OPTS);
    expect(r.status).toBe('PARTIAL');
    expect(r.findings.map((f) => f.code)).toContain('ARTIFACT_DIGEST_MISMATCH');
    expect(r.links.ARTIFACT_TO_VERSION.binding).toBe('UNKNOWN');
  });

  it('operator annotation naming the right commit cannot substitute for a digest match', async () => {
    const base = input();
    const recs = await buildProvenanceRecords(
      input({
        platform_version: {
          ...base.platform_version,
          modules: [{ name: 'index.js', sha256: B }],
          annotations: { message: `exact source ${base.source.commit}`, tag: 'release' },
        },
      })
    );
    const r = await evaluateProvenanceChain(
      recs,
      { ...EXPECT, source_commit: base.source.commit },
      T_OPTS
    );
    expect(r.status).toBe('PARTIAL');
    expect(r.resolved.source_commit).toBeNull();
  });

  it('wrong platform version -> PLATFORM_VERSION_MISMATCH', async () => {
    const r = await evaluateProvenanceChain(
      await buildProvenanceRecords(input()),
      { ...EXPECT, platform_version_id: V2 },
      T_OPTS
    );
    expect(r.status).toBe('PARTIAL');
    expect(r.findings.map((f) => f.code)).toContain('PLATFORM_VERSION_MISMATCH');
  });

  it('missing platform version record -> MISSING_PLATFORM_VERSION', async () => {
    const recs = (await buildProvenanceRecords(input())).filter(
      (r) => r.record_type !== 'PlatformVersionRecord'
    );
    const r = await evaluateProvenanceChain(recs, EXPECT, T_OPTS);
    expect(r.findings.map((f) => f.code)).toContain('MISSING_PLATFORM_VERSION');
    expect(r.status).toBe('PARTIAL');
  });

  it('wrong deployment id -> DEPLOYMENT_MISMATCH', async () => {
    const r = await evaluateProvenanceChain(
      await buildProvenanceRecords(input()),
      { ...EXPECT, platform_deployment_id: D2 },
      T_OPTS
    );
    // Nothing downstream can be anchored to the runtime: fail closed to UNKNOWN.
    expect(r.status).toBe('UNKNOWN');
    expect(r.findings.map((f) => f.code)).toContain('DEPLOYMENT_MISMATCH');
  });

  it('deployment that does not route to the observed version -> DEPLOYMENT_MISMATCH', async () => {
    const recs = await buildProvenanceRecords(
      input({
        deployment: { ...input().deployment, traffic: [{ version_id: V2, percentage: 100 }] },
      })
    );
    const r = await evaluateProvenanceChain(recs, EXPECT, T_OPTS);
    expect(r.findings.map((f) => f.code)).toContain('DEPLOYMENT_MISMATCH');
    expect(r.status).toBe('UNKNOWN');
  });

  it('stale runtime observation -> STALE_RUNTIME_OBSERVATION, all links fail closed', async () => {
    const r = await evaluateProvenanceChain(await buildProvenanceRecords(input()), EXPECT, {
      now: '2026-09-28T18:00:01Z',
      maxObservationAgeMs: 3_600_000,
    });
    expect(r.findings.map((f) => f.code)).toContain('STALE_RUNTIME_OBSERVATION');
    expect(r.status).toBe('UNKNOWN');
  });

  it('missing runtime observation -> UNKNOWN', async () => {
    const recs = (await buildProvenanceRecords(input())).filter(
      (r) => r.record_type !== 'RuntimeObservationRecord'
    );
    const r = await evaluateProvenanceChain(recs, EXPECT, T_OPTS);
    expect(r.status).toBe('UNKNOWN');
    expect(r.findings.map((f) => f.code)).toContain('MISSING_RUNTIME_OBSERVATION');
  });

  it('conflicting fresh runtime observations -> CONFLICTING_EVIDENCE', async () => {
    const recs = await buildProvenanceRecords(input());
    const obs = recs.find((r) => r.record_type === 'RuntimeObservationRecord')!;
    const other = await reseal(obs, {
      observed_version_id: V2,
      observed_at: '2026-09-28T16:05:00Z',
    } as never);
    const r = await evaluateProvenanceChain([...recs, other], EXPECT, T_OPTS);
    expect(r.findings.map((f) => f.code)).toContain('CONFLICTING_EVIDENCE');
    expect(r.status).not.toMatch(/^COMPLETE/);
  });

  it('one commit built to two digests -> CONFLICTING_EVIDENCE (non-reproducible)', async () => {
    const recs = await buildProvenanceRecords(input());
    const build = recs.find((r) => r.record_type === 'BuildRecord')!;
    const rebuilt = await reseal(build, { artifact_sha256: B, module_set_digest: B } as never);
    const r = await evaluateProvenanceChain([...recs, rebuilt], EXPECT, T_OPTS);
    expect(r.findings.map((f) => f.code)).toContain('CONFLICTING_EVIDENCE');
    expect(r.status).toBe('PARTIAL');
  });

  it('dirty-tree build cannot bind source to artifact', async () => {
    const recs = await buildProvenanceRecords(input({ build: { ...input().build, dirty: true } }));
    const r = await evaluateProvenanceChain(recs, EXPECT, T_OPTS);
    expect(r.findings.map((f) => f.code)).toContain('DIRTY_SOURCE_BUILD');
    expect(r.status).toBe('PARTIAL');
  });

  it('tampered record is discarded with RECORD_ID_MISMATCH', async () => {
    const recs = await buildProvenanceRecords(input());
    const tampered = recs.map((r) =>
      r.record_type === 'DeploymentRecord' ? ({ ...r, strategy: 'forged' } as ProvenanceRecord) : r
    );
    const r = await evaluateProvenanceChain(tampered, EXPECT, T_OPTS);
    expect(r.findings.map((f) => f.code)).toContain('RECORD_ID_MISMATCH');
    expect(r.status).not.toMatch(/^COMPLETE/);
  });

  it('source not on any pushed ref is flagged', async () => {
    const recs = await buildProvenanceRecords(
      input({ source: { ...input().source, reachable_from_protected_ref: false } })
    );
    const r = await evaluateProvenanceChain(recs, EXPECT, T_OPTS);
    expect(r.findings.map((f) => f.code)).toContain('SOURCE_NOT_REACHABLE');
    expect(r.status).toBe('PARTIAL');
  });
});

describe('current production provenance (captured 2026-09-28, read-only)', () => {
  it.each([
    [
      EDGE,
      EDGE_VERSION,
      '23507e3d-0790-4142-becb-7a4e8b5fb5ca',
      '19477db8fefcac98102cc3417713e0bd54969b26',
      'a7159424ff57e0480688efa975e95c0028c34de0a596c8a3e9378637021ee81f',
    ],
    [
      HOST,
      HOST_VERSION,
      '9b08ccc2-886b-4087-ad7f-73b6abf6553c',
      'd939f3b276e631c490ed7a5df47b8065d54ece04',
      '6562d5f9203b20ba55db9905d624838a54154b046d08a783347f883e4101949d',
    ],
  ])('%s chain is COMPLETE_PLATFORM_ATTESTED', async (unit, version, deployment, commit, sha) => {
    for (const r of fixture.records) expect(await verifyRecordId(r)).toBe(true);
    const r = await evaluateProvenanceChain(
      fixture.records,
      {
        environment: 'production',
        deployment_unit: unit,
        platform_version_id: version,
        platform_deployment_id: deployment,
        source_commit: commit,
      },
      OPTS
    );
    expect(r.findings).toEqual([]);
    expect(r.status).toBe('COMPLETE_PLATFORM_ATTESTED');
    expect(r.resolved).toEqual({
      source_commit: commit,
      artifact_sha256: sha,
      platform_version_id: version,
      platform_deployment_id: deployment,
    });
  });
});

describe('proof model', () => {
  it('binding is ordered; chain strength is the weakest link', () => {
    expect(weakestBinding(['CRYPTOGRAPHICALLY_BOUND', 'PLATFORM_ATTESTED'])).toBe(
      'PLATFORM_ATTESTED'
    );
    expect(weakestBinding(['PLATFORM_ATTESTED', 'OPERATOR_ATTESTED'])).toBe('OPERATOR_ATTESTED');
    expect(weakestBinding([])).toBe('UNKNOWN');
  });
});

describe('evidence graph store and query contract', () => {
  it('projects production records and answers running-provenance queries', async () => {
    const g = new EvidenceGraph();
    await projectProvenance(g, fixture.records);
    const reader = new InMemoryEvidenceGraphReader(g);
    const host = reader.runningProvenance(HOST, 'production')!;
    expect(host.source?.subject_key).toBe('d939f3b276e631c490ed7a5df47b8065d54ece04');
    expect(host.version?.subject_key).toBe(HOST_VERSION);
    expect(reader.deployedArtifactSha256(EDGE, 'production')).toBe(
      'a7159424ff57e0480688efa975e95c0028c34de0a596c8a3e9378637021ee81f'
    );
    expect(reader.runningProvenance('nope', 'production')).toBeNull();
    expect(g.conflicts()).toEqual([]);
  });

  it('answers execution/provider/settlement queries and rejects unconstitutional edges', async () => {
    const g = new EvidenceGraph();
    const p = { binding: 'OPERATOR_ATTESTED', methods: ['ASSERTED'] } as const;
    const n = async (
      node_type: api.NodeType,
      subject_key: string,
      attributes: Record<string, unknown> = {}
    ) => {
      const node = await makeNode({
        node_type,
        environment: 'production',
        subject_key,
        recorded_at: '2026-09-28T00:00:00Z',
        proof: p,
        attributes,
      });
      g.appendNode(node);
      return node;
    };
    const e = async (edge_type: api.EdgeType, from: api.EvidenceNode, to: api.EvidenceNode) =>
      g.appendEdge(
        await makeEdge({
          edge_type,
          from_id: from.node_id,
          to_id: to.node_id,
          recorded_at: '2026-09-28T00:00:00Z',
          proof: p,
        })
      );

    const contract = await n('Contract', 'verify_agent_output.v2', {
      contract_class: 'verification',
    });
    const deployment = await n('Deployment', D1);
    const exec = await n('Execution', 'pay_x');
    const provider = await n('Provider', 'provider-p');
    const attempt = await n('ProviderAttempt', 'pay_x#1');
    const pcc = await n('PCC', 'pcc-y');
    const failure = await n('Failure', 'timeout', { failure_class: 'timeout' });
    const ra = await n('ResultAuthorization', 'ra-z');
    const settlement = await n('Settlement', 'pay_x', { outcome: 'settled' });
    await e('SATISFIES_CONTRACT', exec, contract);
    await e('EXECUTED_UNDER', exec, deployment);
    await e('ATTEMPT_OF', attempt, exec);
    await e('PROVIDED_BY', attempt, provider);
    await e('DERIVED_FROM', pcc, attempt);
    await e('FAILED_WITH', attempt, failure);
    await e('RESULT_AUTHORIZED_BY', exec, ra);
    await e('SETTLED_BY', exec, settlement);

    const r = new InMemoryEvidenceGraphReader(g);
    expect(
      r.deploymentsExecutingContract('verify_agent_output.v2').map((x) => x.subject_key)
    ).toEqual([D1]);
    expect(r.providerAttemptForPcc('pcc-y').map((x) => x.subject_key)).toEqual(['pay_x#1']);
    expect(r.resultAuthorizationsFor('pay_x').map((x) => x.subject_key)).toEqual(['ra-z']);
    expect(r.settlementsFollowing('pay_x').map((x) => x.subject_key)).toEqual(['pay_x']);
    expect(r.failuresFor('provider-p', 'verification').map((x) => x.subject_key)).toEqual([
      'timeout',
    ]);
    expect(r.failuresFor('provider-p', 'other')).toEqual([]);
    const q = r.qualificationEvidence('provider-p', 'verification');
    expect(q.attempts).toHaveLength(1);
    expect(q.pccs.map((x) => x.subject_key)).toEqual(['pcc-y']);

    await expect(e('SETTLED_BY', attempt, settlement)).rejects.toThrow(/not allowed/);
    await expect(e('SUPERSEDES', exec, settlement)).rejects.toThrow(/not allowed/);
  });

  it('reports same-subject conflicts until one SUPERSEDES the other', async () => {
    const g = new EvidenceGraph();
    const p = { binding: 'PLATFORM_ATTESTED', methods: ['PLATFORM_API_READ'] } as const;
    const mk = (outcome: string) =>
      makeNode({
        node_type: 'Settlement',
        environment: 'production',
        subject_key: 'pay_q',
        recorded_at: '2026-09-28T00:00:00Z',
        proof: p,
        attributes: { outcome },
      });
    const a = await mk('settlement_pending');
    const b = await mk('settled');
    g.appendNode(a);
    g.appendNode(b);
    g.appendNode(b); // idempotent
    expect(g.conflicts()).toHaveLength(1);
    g.appendEdge(
      await makeEdge({
        edge_type: 'SUPERSEDES',
        from_id: b.node_id,
        to_id: a.node_id,
        recorded_at: '2026-09-28T00:00:01Z',
        proof: p,
      })
    );
    expect(g.conflicts()).toEqual([]);
    expect(g.node(a.node_id)).toBeDefined(); // superseded evidence is kept
  });
});

describe('authority firewall', () => {
  it('F1: every edge is non-authoritative and grants no execution/result/settlement authority', () => {
    expect(() => assertConstitutionAuthorityNeutral()).not.toThrow();
    for (const t of EDGE_TYPES) {
      const r = EDGE_CONSTITUTION[t];
      expect([
        r.authoritative,
        r.can_grant_execution_authority,
        r.can_grant_result_authority,
        r.can_grant_settlement_authority,
      ]).toEqual([false, false, false, false]);
    }
    expect(Object.isFrozen(EDGE_CONSTITUTION)).toBe(true);
  });

  it.each([
    'authoritative',
    'can_grant_execution_authority',
    'can_grant_result_authority',
    'can_grant_settlement_authority',
  ])('F1 mutation: flipping %s on any edge is caught', (flag) => {
    for (const t of EDGE_TYPES) {
      const mutated = { ...EDGE_CONSTITUTION, [t]: { ...EDGE_CONSTITUTION[t], [flag]: true } };
      expect(() => assertConstitutionAuthorityNeutral(mutated as never)).toThrow(
        api.AuthorityFirewallError
      );
    }
  });

  it('F2: a node claiming authority is rejected', async () => {
    const g = new EvidenceGraph();
    const node = await makeNode({
      node_type: 'Execution',
      environment: 'production',
      subject_key: 'x',
      recorded_at: '2026-09-28T00:00:00Z',
      proof: { binding: 'INFERRED', methods: [] },
      attributes: {},
    });
    const forged = Object.freeze({
      ...node,
      authority: 'SETTLEMENT',
    }) as unknown as api.EvidenceNode;
    expect(() => g.appendNode(forged)).toThrow(api.AuthorityFirewallError);
  });

  it.each([
    'settlement_permit',
    'dispatch_grant',
    'api_key',
    'bearer',
    'private_key',
    'release_token',
    'password',
  ])('F3: grant/secret-shaped payload field %s is rejected', async (key) => {
    const g = new EvidenceGraph();
    const node = await makeNode({
      node_type: 'ProviderAttempt',
      environment: 'production',
      subject_key: 'a',
      recorded_at: '2026-09-28T00:00:00Z',
      proof: { binding: 'INFERRED', methods: [] },
      attributes: { nested: { [key]: 'x' } },
    });
    expect(() => g.appendNode(node)).toThrow(api.AuthorityFirewallError);
  });

  it('F3: ordinary evidence fields are accepted', async () => {
    const g = new EvidenceGraph();
    const node = await makeNode({
      node_type: 'Settlement',
      environment: 'production',
      subject_key: 's',
      recorded_at: '2026-09-28T00:00:00Z',
      proof: { binding: 'INFERRED', methods: [] },
      attributes: { outcome: 'settled', tx_hash: '0x1', payment_identifier: 'pay_1' },
    });
    expect(() => g.appendNode(node)).not.toThrow();
  });

  it('F4: no canonical authority module imports the evidence graph', () => {
    for (const rel of AUTHORITY_MODULES) {
      const p = join(REPO, rel);
      expect(existsSync(p), `${rel} must exist (update AUTHORITY_MODULES if moved)`).toBe(true);
      expect(importsEvidenceGraph(readFileSync(p, 'utf8')), rel).toBe(false);
    }
  });

  it.each([
    "import { EvidenceGraph } from '@siteborne/evidence-graph';",
    "import type { EvidenceNode } from '@siteborne/evidence-graph';",
    "export { makeNode } from '../../../../packages/evidence-graph/src/graph';",
    "const eg = await import('@siteborne/evidence-graph');",
  ])('F4 mutation: injecting `%s` into each authority module is caught', (line) => {
    for (const rel of AUTHORITY_MODULES) {
      const text = readFileSync(join(REPO, rel), 'utf8');
      expect(importsEvidenceGraph(`${line}\n${text}`), rel).toBe(true);
    }
  });

  it('F5: the evidence graph imports no control-plane, payment, or runtime code', () => {
    const files = [
      'proof',
      'records',
      'chain',
      'constitution',
      'firewall',
      'graph',
      'capture',
      'ravi-p',
      'canonical',
      'index',
    ];
    for (const f of files) {
      expect(importsControlPlane(readFileSync(join(__dirname, `${f}.ts`), 'utf8')), f).toBe(false);
    }
    expect(
      importsControlPlane(
        "import { settle } from '../../apps/edge-api/src/control-plane/continuation/handoff';"
      )
    ).toBe(true);
    expect(importsControlPlane("import { x } from '@siteborne/protocol-x402';")).toBe(true);
    expect(importsControlPlane("import { WorkflowEntrypoint } from 'cloudflare:workers';")).toBe(
      true
    );
  });

  it('public API exports nothing that dispatches, settles, releases, or grants', () => {
    const names = Object.keys(api);
    const offending = names.filter((n) =>
      /^(dispatch|settle|release|grant|authorize|mint|issue|approve|capture|pay)/i.test(n)
    );
    expect(offending).toEqual([]);
  });
});
