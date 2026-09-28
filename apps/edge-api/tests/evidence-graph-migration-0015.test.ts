/**
 * R3-A4-55 — migration 0015 (Evidence Graph storage) against real Miniflare
 * D1 with every migration applied: additive, append-only, content-addressed,
 * idempotent, conflict-rejecting and transactional.
 */
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import {
  EDGE_INSERT_SQL,
  NODE_INSERT_SQL,
  appendEvidence,
  buildProvenanceRecords,
  edgeRow,
  loadEvidenceGraph,
  makeEdge,
  makeNode,
  nodeRow,
  projectProvenance,
  renderEvidenceInsertSql,
  EvidenceGraph,
  type CaptureInput,
  type EvidenceD1,
} from '../../../packages/evidence-graph/src/index';
import { canonicalize } from '../../../packages/evidence-graph/src/canonical';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../migrations', import.meta.url));

function statementsOf(file: string): string[] {
  return readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
    .split(/;(?!\s*END\b)/)
    .map((raw) =>
      raw
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('--'))
        .join(' ')
        .trim()
    )
    .filter(Boolean);
}

async function applyMigrations(db: D1Database, through: string): Promise<void> {
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql') && name <= through)
    .sort()) {
    for (const statement of statementsOf(file)) await db.exec(statement);
  }
}

async function schemaOf(db: D1Database): Promise<Record<string, string>> {
  const rows = await db
    .prepare(
      "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'evidence_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%' ORDER BY type, name"
    )
    .all<{ type: string; name: string; sql: string }>();
  return Object.fromEntries(rows.results.map((r) => [`${r.type}:${r.name}`, r.sql]));
}

const V1 = '11111111-1111-4111-8111-111111111111';
const D1ID = '33333333-3333-4333-8333-333333333333';
const A = 'a'.repeat(64);

function capture(): CaptureInput {
  return {
    environment: 'local',
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
      id: D1ID,
      created_on: '2026-09-28T15:10:00Z',
      strategy: 'percentage',
      traffic: [{ version_id: V1, percentage: 100 }],
      annotations: {},
      evidence_source: 'GET deployments',
    },
    observation: {
      kind: 'PLATFORM_ACTIVE_DEPLOYMENT',
      observed_at: '2026-09-28T16:00:00Z',
      deployment_id: D1ID,
      version_id: V1,
      traffic_percentage: 100,
      evidence_source: 'GET deployments',
    },
  };
}

async function sampleGraph(): Promise<EvidenceGraph> {
  const g = new EvidenceGraph();
  await projectProvenance(g, await buildProvenanceRecords(capture()));
  return g;
}

describe('migration 0015 — Evidence Graph storage', () => {
  let mf: Miniflare;
  let before: Miniflare;
  let db: D1Database;
  let dbBefore: D1Database;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'a4-0015-'));
    const opts = {
      modules: true,
      script: 'export default { fetch() { return new Response(null) } }',
    };
    mf = new Miniflare({ ...opts, d1Databases: { DB: 'a4-0015' } });
    before = new Miniflare({ ...opts, d1Databases: { DB: 'a4-0014' } });
    db = (await mf.getD1Database('DB')) as unknown as D1Database;
    dbBefore = (await before.getD1Database('DB')) as unknown as D1Database;
    await applyMigrations(db, '0015_evidence_graph.sql');
    await applyMigrations(dbBefore, '0014_provider_dispatch_claim.sql');
  });

  afterAll(async () => {
    await mf?.dispose();
    await before?.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  const store = () => db as unknown as EvidenceD1;
  const count = async (table: string) =>
    (await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;

  it('is additive: every pre-existing table, index and trigger is byte-identical to 0014', async () => {
    expect(await schemaOf(db)).toEqual(await schemaOf(dbBefore));
    const added = await db
      .prepare("SELECT type, name FROM sqlite_master WHERE name LIKE 'evidence_%' ORDER BY name")
      .all<{ type: string; name: string }>();
    expect(added.results.map((r) => r.name)).toEqual([
      'evidence_edges',
      'evidence_edges_conflict',
      'evidence_edges_endpoints',
      'evidence_edges_from',
      'evidence_edges_no_delete',
      'evidence_edges_no_update',
      'evidence_edges_to',
      'evidence_nodes',
      'evidence_nodes_conflict',
      'evidence_nodes_no_delete',
      'evidence_nodes_no_update',
      'evidence_nodes_subject',
    ]);
  });

  it('has exactly the designed columns: none can carry authority, permits, grants or status', async () => {
    const cols = async (t: string) =>
      (await db.prepare(`PRAGMA table_info(${t})`).all<{ name: string }>()).results.map(
        (c) => c.name
      );
    expect(await cols('evidence_nodes')).toEqual([
      'node_id',
      'node_type',
      'environment',
      'subject_key',
      'recorded_at',
      'binding',
      'authority',
      'body_jcs',
      'inserted_at',
    ]);
    expect(await cols('evidence_edges')).toEqual([
      'edge_id',
      'edge_type',
      'from_id',
      'to_id',
      'recorded_at',
      'binding',
      'body_jcs',
      'inserted_at',
    ]);
    // The one authority-shaped column is pinned by CHECK to the constant NONE.
    const ddl = (await db
      .prepare("SELECT sql FROM sqlite_master WHERE name = 'evidence_nodes'")
      .first<{ sql: string }>())!.sql;
    expect(ddl).toContain("authority TEXT NOT NULL CHECK (authority = 'NONE')");
  });

  it('INSERT node + edge, then reads back a verified graph', async () => {
    const g = await sampleGraph();
    await appendEvidence(store(), g.allNodes(), g.allEdges());
    expect(await count('evidence_nodes')).toBe(6);
    expect(await count('evidence_edges')).toBe(5);
    const { graph, rejected } = await loadEvidenceGraph(store(), 'local');
    expect(rejected).toEqual([]);
    expect(
      graph
        .allNodes()
        .map((n) => n.node_id)
        .sort()
    ).toEqual(
      g
        .allNodes()
        .map((n) => n.node_id)
        .sort()
    );
    expect(graph.allEdges().length).toBe(5);
  });

  it('duplicate identical insertion is an idempotent no-op', async () => {
    const g = await sampleGraph();
    await appendEvidence(store(), g.allNodes(), g.allEdges());
    await appendEvidence(store(), g.allNodes(), g.allEdges());
    expect(await count('evidence_nodes')).toBe(6);
    expect(await count('evidence_edges')).toBe(5);
  });

  it('UPDATE is rejected on both tables', async () => {
    await expect(db.prepare("UPDATE evidence_nodes SET subject_key = 'x'").run()).rejects.toThrow(
      /append-only/
    );
    await expect(db.prepare("UPDATE evidence_edges SET edge_type = 'x'").run()).rejects.toThrow(
      /append-only/
    );
  });

  it('DELETE is rejected on both tables', async () => {
    await expect(db.prepare('DELETE FROM evidence_edges').run()).rejects.toThrow(/append-only/);
    await expect(db.prepare('DELETE FROM evidence_nodes').run()).rejects.toThrow(/append-only/);
    expect(await count('evidence_nodes')).toBe(6);
  });

  it('edge with a broken reference is rejected', async () => {
    const g = await sampleGraph();
    const from = g.allNodes()[0];
    const edge = await makeEdge({
      edge_type: 'BUILT_FROM',
      from_id: from.node_id,
      to_id: `ev:${'f'.repeat(64)}`,
      recorded_at: '2026-09-28T16:00:00Z',
      proof: from.proof,
    });
    const r = await edgeRow(edge);
    await expect(
      db
        .prepare(EDGE_INSERT_SQL)
        .bind(r.edge_id, r.edge_type, r.from_id, r.to_id, r.recorded_at, r.binding, r.body_jcs)
        .run()
    ).rejects.toThrow(/missing node|FOREIGN KEY/);
  });

  it('conflicting content under an existing id fails closed', async () => {
    const node = (await sampleGraph()).allNodes()[0];
    const r = await nodeRow(node);
    const forged = canonicalize({ ...JSON.parse(r.body_jcs), attributes: { forged: true } });
    await expect(
      db
        .prepare(NODE_INSERT_SQL)
        .bind(
          r.node_id,
          r.node_type,
          r.environment,
          r.subject_key,
          r.recorded_at,
          r.binding,
          'NONE',
          forged
        )
        .run()
    ).rejects.toThrow(/evidence conflict/);
  });

  it('projected columns must agree with the stored body; authority must be NONE', async () => {
    const node = await makeNode({
      node_type: 'Source',
      environment: 'local',
      subject_key: 'projection-check',
      recorded_at: '2026-09-28T16:00:00Z',
      proof: { binding: 'INFERRED', methods: [] },
      attributes: {},
    });
    const r = await nodeRow(node);
    const bind = (over: Partial<typeof r>) => {
      const x = { ...r, ...over };
      return db
        .prepare(NODE_INSERT_SQL)
        .bind(
          x.node_id,
          x.node_type,
          x.environment,
          x.subject_key,
          x.recorded_at,
          x.binding,
          x.authority,
          x.body_jcs
        )
        .run();
    };
    await expect(bind({ subject_key: 'lie' })).rejects.toThrow(/CHECK/);
    await expect(bind({ binding: 'CRYPTOGRAPHICALLY_BOUND' })).rejects.toThrow(/CHECK/);
    await expect(bind({ authority: 'GRANTED' as 'NONE' })).rejects.toThrow(/CHECK/);
    await expect(
      bind({ body_jcs: canonicalize({ ...JSON.parse(r.body_jcs), authority: 'EXECUTION' }) })
    ).rejects.toThrow(/CHECK/);
    await bind({});
  });

  it('a failing statement rolls back the whole write set', async () => {
    const node = await makeNode({
      node_type: 'Source',
      environment: 'local',
      subject_key: 'rollback-check',
      recorded_at: '2026-09-28T16:00:00Z',
      proof: { binding: 'INFERRED', methods: [] },
      attributes: {},
    });
    const dangling = await makeEdge({
      edge_type: 'BUILT_FROM',
      from_id: node.node_id,
      to_id: `ev:${'e'.repeat(64)}`,
      recorded_at: '2026-09-28T16:00:00Z',
      proof: node.proof,
    });
    const nodesBefore = await count('evidence_nodes');
    await expect(appendEvidence(store(), [node], [dangling])).rejects.toThrow();
    expect(await count('evidence_nodes')).toBe(nodesBefore);
    expect(
      await db.prepare('SELECT 1 FROM evidence_nodes WHERE node_id = ?').bind(node.node_id).first()
    ).toBeNull();
  });

  it('a tampered row is never read back as evidence', async () => {
    // Bypass the writer: raw row whose id does not hash from its body.
    const node = await makeNode({
      node_type: 'Source',
      environment: 'staging',
      subject_key: 'tamper',
      recorded_at: '2026-09-28T16:00:00Z',
      proof: { binding: 'INFERRED', methods: [] },
      attributes: {},
    });
    const r = await nodeRow(node);
    const fakeId = `ev:${'d'.repeat(64)}`;
    await db
      .prepare(NODE_INSERT_SQL)
      .bind(
        fakeId,
        r.node_type,
        r.environment,
        r.subject_key,
        r.recorded_at,
        r.binding,
        'NONE',
        r.body_jcs
      )
      .run();
    const { graph, rejected } = await loadEvidenceGraph(store(), 'staging');
    expect(rejected).toEqual([fakeId]);
    expect(graph.allNodes()).toEqual([]);
  });

  it('rendered SQL for `wrangler d1 execute --file` applies and is idempotent', async () => {
    const other = new Miniflare({
      modules: true,
      script: 'export default { fetch() { return new Response(null) } }',
      d1Databases: { DB: 'a4-0015-render' },
    });
    try {
      const odb = (await other.getD1Database('DB')) as unknown as D1Database;
      await applyMigrations(odb, '0015_evidence_graph.sql');
      const g = await sampleGraph();
      const sql = await renderEvidenceInsertSql(g.allNodes(), g.allEdges());
      for (let pass = 0; pass < 2; pass++) {
        for (const line of sql.trim().split('\n')) await odb.prepare(line.replace(/;$/, '')).run();
      }
      const n = await odb
        .prepare('SELECT COUNT(*) AS n FROM evidence_nodes')
        .first<{ n: number }>();
      expect(n!.n).toBe(6);
      const { rejected, graph } = await loadEvidenceGraph(odb as unknown as EvidenceD1, 'local');
      expect(rejected).toEqual([]);
      expect(graph.allEdges().length).toBe(5);
    } finally {
      await other.dispose();
    }
  });
});
