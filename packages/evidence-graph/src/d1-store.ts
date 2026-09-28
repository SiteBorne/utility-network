/**
 * Evidence Graph persistence over migration 0015 (R3-A4-55 Phase 2/7 H).
 *
 * Append-only. Every write is INSERT ... ON CONFLICT(id) DO NOTHING, so an
 * identical re-insert is a no-op and a different body under an existing id
 * is rejected by the 0015 conflict trigger. A write set goes in one D1 batch,
 * which D1 runs as one transaction: all rows land or none do.
 *
 * The reader re-derives every id from the stored body and rejects rows whose
 * id does not match, so a tampered row can never be read back as evidence.
 *
 * Structural D1 interface only: this module imports no Cloudflare runtime,
 * control-plane or payment code (firewall F5).
 */
import { canonicalize, hashCanonical } from './canonical';
import { EvidenceGraph, type EvidenceEdge, type EvidenceNode } from './graph';
import { AuthorityFirewallError, findForbiddenPayloadKeys } from './firewall';

export interface EvidenceD1Statement {
  bind(...values: unknown[]): EvidenceD1Statement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}
export interface EvidenceD1 {
  prepare(sql: string): EvidenceD1Statement;
  batch(statements: EvidenceD1Statement[]): Promise<unknown[]>;
}

export const NODE_INSERT_SQL =
  'INSERT INTO evidence_nodes (node_id, node_type, environment, subject_key, recorded_at, binding, authority, body_jcs) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(node_id) DO NOTHING';
export const EDGE_INSERT_SQL =
  'INSERT INTO evidence_edges (edge_id, edge_type, from_id, to_id, recorded_at, binding, body_jcs) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(edge_id) DO NOTHING';

async function idOf(body: unknown): Promise<string> {
  return `ev:${(await hashCanonical(body)).slice('sha256:'.length)}`;
}

export interface NodeRow {
  readonly node_id: string;
  readonly node_type: string;
  readonly environment: string;
  readonly subject_key: string;
  readonly recorded_at: string;
  readonly binding: string;
  readonly authority: 'NONE';
  readonly body_jcs: string;
}
export interface EdgeRow {
  readonly edge_id: string;
  readonly edge_type: string;
  readonly from_id: string;
  readonly to_id: string;
  readonly recorded_at: string;
  readonly binding: string;
  readonly body_jcs: string;
}

export async function nodeRow(node: EvidenceNode): Promise<NodeRow> {
  const { node_id, ...body } = node;
  if (body.authority !== 'NONE') {
    throw new AuthorityFirewallError(`node ${node_id} carries authority=${String(body.authority)}`);
  }
  const forbidden = findForbiddenPayloadKeys(body.attributes);
  if (forbidden.length > 0) {
    throw new AuthorityFirewallError(`node ${node_id} carries grant/secret-shaped fields`);
  }
  if ((await idOf(body)) !== node_id) throw new Error(`node ${node_id} id does not match content`);
  return {
    node_id,
    node_type: body.node_type,
    environment: body.environment,
    subject_key: body.subject_key,
    recorded_at: body.recorded_at,
    binding: body.proof.binding,
    authority: 'NONE',
    body_jcs: canonicalize(body),
  };
}

export async function edgeRow(edge: EvidenceEdge): Promise<EdgeRow> {
  const { edge_id, ...body } = edge;
  if ((await idOf(body)) !== edge_id) throw new Error(`edge ${edge_id} id does not match content`);
  return {
    edge_id,
    edge_type: body.edge_type,
    from_id: body.from_id,
    to_id: body.to_id,
    recorded_at: body.recorded_at,
    binding: body.proof.binding,
    body_jcs: canonicalize(body),
  };
}

/** Append nodes then edges in one transaction. Throws on any conflict. */
export async function appendEvidence(
  db: EvidenceD1,
  nodes: readonly EvidenceNode[],
  edges: readonly EvidenceEdge[]
): Promise<void> {
  const statements: EvidenceD1Statement[] = [];
  for (const n of nodes) {
    const r = await nodeRow(n);
    statements.push(
      db
        .prepare(NODE_INSERT_SQL)
        .bind(
          r.node_id,
          r.node_type,
          r.environment,
          r.subject_key,
          r.recorded_at,
          r.binding,
          r.authority,
          r.body_jcs
        )
    );
  }
  for (const e of edges) {
    const r = await edgeRow(e);
    statements.push(
      db
        .prepare(EDGE_INSERT_SQL)
        .bind(r.edge_id, r.edge_type, r.from_id, r.to_id, r.recorded_at, r.binding, r.body_jcs)
    );
  }
  if (statements.length > 0) await db.batch(statements);
}

/**
 * The same write set as a SQL file for `wrangler d1 execute --file`, used by
 * the release capture PERSIST stage. Values are SQL string literals with
 * single quotes doubled. The statements are wrapped by D1 as one batch.
 */
export async function renderEvidenceInsertSql(
  nodes: readonly EvidenceNode[],
  edges: readonly EvidenceEdge[]
): Promise<string> {
  const q = (v: string) => `'${v.replaceAll("'", "''")}'`;
  const lines: string[] = [];
  for (const n of nodes) {
    const r = await nodeRow(n);
    lines.push(
      NODE_INSERT_SQL.replace(
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        `VALUES (${[r.node_id, r.node_type, r.environment, r.subject_key, r.recorded_at, r.binding, r.authority, r.body_jcs].map(q).join(', ')})`
      ) + ';'
    );
  }
  for (const e of edges) {
    const r = await edgeRow(e);
    lines.push(
      EDGE_INSERT_SQL.replace(
        'VALUES (?, ?, ?, ?, ?, ?, ?)',
        `VALUES (${[r.edge_id, r.edge_type, r.from_id, r.to_id, r.recorded_at, r.binding, r.body_jcs].map(q).join(', ')})`
      ) + ';'
    );
  }
  return `${lines.join('\n')}\n`;
}

export interface LoadResult {
  readonly graph: EvidenceGraph;
  /** Rows whose id does not hash from their stored body. Never loaded. */
  readonly rejected: readonly string[];
}

/** Read an environment's graph back, verifying every id. */
export async function loadEvidenceGraph(db: EvidenceD1, environment: string): Promise<LoadResult> {
  const graph = new EvidenceGraph();
  const rejected: string[] = [];
  const nodes = await db
    .prepare('SELECT node_id, body_jcs FROM evidence_nodes WHERE environment = ? ORDER BY node_id')
    .bind(environment)
    .all<{ node_id: string; body_jcs: string }>();
  for (const row of nodes.results) {
    const body = JSON.parse(row.body_jcs) as Omit<EvidenceNode, 'node_id'>;
    if ((await idOf(body)) !== row.node_id) {
      rejected.push(row.node_id);
      continue;
    }
    graph.appendNode(deepFreeze({ ...body, node_id: row.node_id }) as EvidenceNode);
  }
  const edges = await db
    .prepare(
      'SELECT e.edge_id, e.body_jcs FROM evidence_edges e JOIN evidence_nodes n ON n.node_id = e.from_id WHERE n.environment = ? ORDER BY e.edge_id'
    )
    .bind(environment)
    .all<{ edge_id: string; body_jcs: string }>();
  for (const row of edges.results) {
    const body = JSON.parse(row.body_jcs) as Omit<EvidenceEdge, 'edge_id'>;
    if ((await idOf(body)) !== row.edge_id) {
      rejected.push(row.edge_id);
      continue;
    }
    graph.appendEdge(deepFreeze({ ...body, edge_id: row.edge_id }) as EvidenceEdge);
  }
  return { graph, rejected };
}

function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const child of Object.values(v as Record<string, unknown>)) deepFreeze(child);
  }
  return v;
}
