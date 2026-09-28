/**
 * Append-only Evidence Graph store and canonical query contract
 * (R3-A4 Phase 4/10).
 *
 * Nodes and edges are content-addressed and frozen. Nothing is ever
 * updated or deleted: newer evidence SUPERSEDES older evidence and both are
 * kept. Two nodes describing the same subject with different content and no
 * SUPERSEDES edge between them are reported as a conflict, never resolved
 * silently.
 *
 * Every query returns advisory evidence. No method returns, mints, or
 * checks a permit; callers that make authority decisions must consult the
 * canonical control-plane authority (see firewall.ts).
 */
import { hashCanonical } from './canonical';
import { edgeAllowed, type EdgeType, type NodeType } from './constitution';
import { AuthorityFirewallError, findForbiddenPayloadKeys } from './firewall';
import type { ProofLevel } from './proof';
import type { Environment, ProvenanceRecord } from './records';

export interface EvidenceNode {
  readonly node_id: string;
  readonly node_type: NodeType;
  readonly environment: Environment;
  /** Stable identity of the thing described (commit sha, version id, payment_identifier, provider id, ...). */
  readonly subject_key: string;
  readonly recorded_at: string;
  readonly proof: ProofLevel;
  readonly authority: 'NONE';
  readonly attributes: Readonly<Record<string, unknown>>;
}

export interface EvidenceEdge {
  readonly edge_id: string;
  readonly edge_type: EdgeType;
  readonly from_id: string;
  readonly to_id: string;
  readonly recorded_at: string;
  readonly proof: ProofLevel;
}

async function contentId(value: object): Promise<string> {
  return `ev:${(await hashCanonical(value)).slice('sha256:'.length)}`;
}

function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const child of Object.values(v as Record<string, unknown>)) deepFreeze(child);
  }
  return v;
}

export async function makeNode(
  n: Omit<EvidenceNode, 'node_id' | 'authority'>
): Promise<EvidenceNode> {
  const body = { ...n, authority: 'NONE' as const };
  return deepFreeze({ ...body, node_id: await contentId(body) });
}

export async function makeEdge(e: Omit<EvidenceEdge, 'edge_id'>): Promise<EvidenceEdge> {
  return deepFreeze({ ...e, edge_id: await contentId(e) });
}

export interface ConflictReport {
  readonly node_type: NodeType;
  readonly subject_key: string;
  readonly node_ids: readonly string[];
}

export class EvidenceGraph {
  private readonly nodes = new Map<string, EvidenceNode>();
  private readonly edges = new Map<string, EvidenceEdge>();

  appendNode(node: EvidenceNode): void {
    if ((node as { authority: unknown }).authority !== 'NONE') {
      throw new AuthorityFirewallError(
        `node ${node.node_id} carries authority=${String(node.authority)}`
      );
    }
    const forbidden = findForbiddenPayloadKeys(node.attributes);
    if (forbidden.length > 0) {
      throw new AuthorityFirewallError(
        `node ${node.node_id} carries grant/secret-shaped fields: ${forbidden.join(', ')}`
      );
    }
    if (!Object.isFrozen(node)) throw new Error('nodes must be created with makeNode()');
    if (this.nodes.has(node.node_id)) return; // idempotent: same id => same content
    this.nodes.set(node.node_id, node);
  }

  appendEdge(edge: EvidenceEdge): void {
    const from = this.nodes.get(edge.from_id);
    const to = this.nodes.get(edge.to_id);
    if (!from || !to) throw new Error(`edge ${edge.edge_type} references unknown node`);
    if (!edgeAllowed(edge.edge_type, from.node_type, to.node_type)) {
      throw new Error(
        `edge ${edge.edge_type} not allowed from ${from.node_type} to ${to.node_type}`
      );
    }
    if (!Object.isFrozen(edge)) throw new Error('edges must be created with makeEdge()');
    if (this.edges.has(edge.edge_id)) return;
    this.edges.set(edge.edge_id, edge);
  }

  node(id: string): EvidenceNode | undefined {
    return this.nodes.get(id);
  }

  nodesOf(type: NodeType, subject_key?: string): EvidenceNode[] {
    return [...this.nodes.values()].filter(
      (n) => n.node_type === type && (subject_key === undefined || n.subject_key === subject_key)
    );
  }

  out(id: string, type: EdgeType): EvidenceNode[] {
    return [...this.edges.values()]
      .filter((e) => e.from_id === id && e.edge_type === type)
      .map((e) => this.nodes.get(e.to_id)!);
  }

  in(id: string, type: EdgeType): EvidenceNode[] {
    return [...this.edges.values()]
      .filter((e) => e.to_id === id && e.edge_type === type)
      .map((e) => this.nodes.get(e.from_id)!);
  }

  /** Same type+subject, different content, and neither supersedes the other. */
  conflicts(): ConflictReport[] {
    const groups = new Map<string, EvidenceNode[]>();
    for (const n of this.nodes.values()) {
      const k = `${n.node_type}\u0000${n.subject_key}`;
      groups.set(k, [...(groups.get(k) ?? []), n]);
    }
    const reports: ConflictReport[] = [];
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const superseded = new Set(
        group.flatMap((n) => this.out(n.node_id, 'SUPERSEDES').map((o) => o.node_id))
      );
      const live = group.filter((n) => !superseded.has(n.node_id));
      if (live.length > 1) {
        reports.push({
          node_type: group[0].node_type,
          subject_key: group[0].subject_key,
          node_ids: live.map((n) => n.node_id),
        });
      }
    }
    return reports;
  }
}

// ---------------------------------------------------------------------------
// Provenance records -> graph projection.
// ---------------------------------------------------------------------------

const RECORD_NODE: Record<ProvenanceRecord['record_type'], NodeType> = {
  SourceRecord: 'Source',
  BuildRecord: 'Build',
  ArtifactRecord: 'Artifact',
  PlatformVersionRecord: 'Version',
  DeploymentRecord: 'Deployment',
  RuntimeObservationRecord: 'RuntimeObservation',
};

function subjectOf(r: ProvenanceRecord): string {
  switch (r.record_type) {
    case 'SourceRecord':
      return r.source_commit;
    case 'BuildRecord':
      return `${r.source_commit}:${r.config_path}:${r.module_set_digest}`;
    case 'ArtifactRecord':
      return r.module_set_digest;
    case 'PlatformVersionRecord':
      return r.platform_version_id;
    case 'DeploymentRecord':
      return r.platform_deployment_id;
    case 'RuntimeObservationRecord':
      return `${r.deployment_unit}@${r.observed_at}`;
  }
}

/**
 * Projects provenance records into graph nodes, linking them by identifier
 * or digest equality only (never by operator annotations).
 */
export async function projectProvenance(
  graph: EvidenceGraph,
  records: readonly ProvenanceRecord[]
): Promise<void> {
  const byRecord = new Map<string, EvidenceNode>();
  for (const r of records) {
    const { record_type: _t, record_id, proof, environment, captured_at, ...attributes } = r;
    void _t;
    const node = await makeNode({
      node_type: RECORD_NODE[r.record_type],
      environment,
      subject_key: subjectOf(r),
      recorded_at: captured_at,
      proof,
      attributes: { record_id, ...attributes },
    });
    graph.appendNode(node);
    byRecord.set(record_id, node);
  }
  const link = async (type: EdgeType, from: ProvenanceRecord, to: ProvenanceRecord) => {
    graph.appendEdge(
      await makeEdge({
        edge_type: type,
        from_id: byRecord.get(from.record_id)!.node_id,
        to_id: byRecord.get(to.record_id)!.node_id,
        recorded_at: from.captured_at > to.captured_at ? from.captured_at : to.captured_at,
        proof: from.proof,
      })
    );
  };
  const same = (a: ProvenanceRecord, b: ProvenanceRecord) =>
    a.environment === b.environment && a.deployment_unit === b.deployment_unit;
  for (const a of records) {
    for (const b of records) {
      if (!same(a, b)) continue;
      if (
        a.record_type === 'BuildRecord' &&
        b.record_type === 'SourceRecord' &&
        a.source_commit === b.source_commit
      ) {
        await link('BUILT_FROM', a, b);
      }
      if (
        a.record_type === 'BuildRecord' &&
        b.record_type === 'ArtifactRecord' &&
        a.module_set_digest === b.module_set_digest
      ) {
        await link('PRODUCED', a, b);
      }
      if (
        a.record_type === 'ArtifactRecord' &&
        b.record_type === 'PlatformVersionRecord' &&
        a.module_set_digest === b.platform_module_set_digest
      ) {
        await link('UPLOADED_AS', a, b);
      }
      if (
        a.record_type === 'PlatformVersionRecord' &&
        b.record_type === 'DeploymentRecord' &&
        b.traffic.some((t) => t.version_id === a.platform_version_id && t.percentage > 0)
      ) {
        await link('DEPLOYED_AS', a, b);
      }
      if (
        a.record_type === 'RuntimeObservationRecord' &&
        b.record_type === 'DeploymentRecord' &&
        a.observed_deployment_id === b.platform_deployment_id
      ) {
        await link('OBSERVED_RUNNING', a, b);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Canonical query contract. Advisory results only.
// ---------------------------------------------------------------------------

export interface RunningProvenance {
  readonly observation: EvidenceNode;
  readonly deployment: EvidenceNode;
  readonly version: EvidenceNode | null;
  readonly artifact: EvidenceNode | null;
  readonly build: EvidenceNode | null;
  readonly source: EvidenceNode | null;
}

export interface ProviderEvidence {
  readonly attempts: readonly EvidenceNode[];
  readonly failures: readonly EvidenceNode[];
  readonly pccs: readonly EvidenceNode[];
  readonly assurances: readonly EvidenceNode[];
}

export interface EvidenceGraphReader {
  /** What source produced the currently running version? */
  runningProvenance(deploymentUnit: string, environment: Environment): RunningProvenance | null;
  /** What artifact hash was deployed (currently running)? */
  deployedArtifactSha256(deploymentUnit: string, environment: Environment): string | null;
  /** Which deployment(s) executed contract X? */
  deploymentsExecutingContract(contractKey: string): EvidenceNode[];
  /** Which provider attempt produced PCC Y? */
  providerAttemptForPcc(pccKey: string): EvidenceNode[];
  /** Which result authorization record(s) accompany execution Z's result? */
  resultAuthorizationsFor(executionKey: string): EvidenceNode[];
  /** Which settlement followed execution E? */
  settlementsFollowing(executionKey: string): EvidenceNode[];
  /** Which failures affect provider P under contract class C? */
  failuresFor(providerKey: string, contractClass: string): EvidenceNode[];
  /** What evidence supports provider qualification for contract class C? */
  qualificationEvidence(providerKey: string, contractClass: string): ProviderEvidence;
}

export class InMemoryEvidenceGraphReader implements EvidenceGraphReader {
  constructor(private readonly g: EvidenceGraph) {}

  runningProvenance(unit: string, env: Environment): RunningProvenance | null {
    const observations = this.g
      .nodesOf('RuntimeObservation')
      .filter((n) => n.environment === env && n.attributes.deployment_unit === unit)
      .sort((a, b) =>
        String(b.attributes.observed_at).localeCompare(String(a.attributes.observed_at))
      );
    const observation = observations[0];
    if (!observation) return null;
    const deployment = this.g.out(observation.node_id, 'OBSERVED_RUNNING')[0];
    if (!deployment) return null;
    const runningVersionId = observation.attributes.observed_version_id;
    const version =
      this.g
        .in(deployment.node_id, 'DEPLOYED_AS')
        .find((v) => v.subject_key === runningVersionId) ?? null;
    const artifact = version ? (this.g.in(version.node_id, 'UPLOADED_AS')[0] ?? null) : null;
    const build = artifact
      ? (this.g.in(artifact.node_id, 'PRODUCED').find((b) => b.attributes.source_dirty === false) ??
        null)
      : null;
    const source = build ? (this.g.out(build.node_id, 'BUILT_FROM')[0] ?? null) : null;
    return { observation, deployment, version, artifact, build, source };
  }

  deployedArtifactSha256(unit: string, env: Environment): string | null {
    const a = this.runningProvenance(unit, env)?.artifact;
    return a ? String(a.attributes.artifact_sha256) : null;
  }

  private executionsSatisfying(contractKey: string): EvidenceNode[] {
    return this.g
      .nodesOf('Contract', contractKey)
      .flatMap((c) => this.g.in(c.node_id, 'SATISFIES_CONTRACT'))
      .filter((n) => n.node_type === 'Execution');
  }

  deploymentsExecutingContract(contractKey: string): EvidenceNode[] {
    return uniq(
      this.executionsSatisfying(contractKey).flatMap((e) => this.g.out(e.node_id, 'EXECUTED_UNDER'))
    );
  }

  providerAttemptForPcc(pccKey: string): EvidenceNode[] {
    return uniq(
      this.g
        .nodesOf('PCC', pccKey)
        .flatMap((p) => this.g.out(p.node_id, 'DERIVED_FROM'))
        .filter((n) => n.node_type === 'ProviderAttempt')
    );
  }

  resultAuthorizationsFor(executionKey: string): EvidenceNode[] {
    return uniq(
      this.g
        .nodesOf('Execution', executionKey)
        .flatMap((e) => this.g.out(e.node_id, 'RESULT_AUTHORIZED_BY'))
    );
  }

  settlementsFollowing(executionKey: string): EvidenceNode[] {
    return uniq(
      this.g.nodesOf('Execution', executionKey).flatMap((e) => this.g.out(e.node_id, 'SETTLED_BY'))
    );
  }

  private attemptsFor(providerKey: string, contractClass: string): EvidenceNode[] {
    return this.g
      .nodesOf('Provider', providerKey)
      .flatMap((p) => this.g.in(p.node_id, 'PROVIDED_BY'))
      .filter((a) =>
        this.g
          .out(a.node_id, 'ATTEMPT_OF')
          .some((e) =>
            this.g
              .out(e.node_id, 'SATISFIES_CONTRACT')
              .some((c) => c.attributes.contract_class === contractClass)
          )
      );
  }

  failuresFor(providerKey: string, contractClass: string): EvidenceNode[] {
    return uniq(
      this.attemptsFor(providerKey, contractClass).flatMap((a) =>
        this.g.out(a.node_id, 'FAILED_WITH')
      )
    );
  }

  qualificationEvidence(providerKey: string, contractClass: string): ProviderEvidence {
    const attempts = uniq(this.attemptsFor(providerKey, contractClass));
    const evidenced = attempts.flatMap((a) => this.g.out(a.node_id, 'EVIDENCED_BY'));
    const derivedPccs = this.g
      .nodesOf('PCC')
      .filter((p) => this.g.out(p.node_id, 'DERIVED_FROM').some((a) => attempts.includes(a)));
    return {
      attempts,
      failures: uniq(attempts.flatMap((a) => this.g.out(a.node_id, 'FAILED_WITH'))),
      pccs: uniq([...evidenced.filter((n) => n.node_type === 'PCC'), ...derivedPccs]),
      assurances: uniq(evidenced.filter((n) => n.node_type === 'Assurance')),
    };
  }
}

function uniq(nodes: EvidenceNode[]): EvidenceNode[] {
  return [...new Map(nodes.map((n) => [n.node_id, n])).values()];
}
