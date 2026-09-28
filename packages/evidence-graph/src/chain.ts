/**
 * Provenance chain verifier (R3-A4 Phase 7/8).
 *
 *   SourceRecord --BUILT_FROM-- BuildRecord --PRODUCED--> ArtifactRecord
 *     --UPLOADED_AS--> PlatformVersionRecord --DEPLOYED_AS--> DeploymentRecord
 *     --OBSERVED_RUNNING--> RuntimeObservationRecord
 *
 * Every link is matched on identifiers or digests only. Operator annotations
 * (`workers/message`, `workers/tag`) are never consulted, so a release
 * message naming a commit cannot stand in for a missing digest.
 *
 * Fails closed: a missing, stale, conflicting, or mismatched link yields
 * PARTIAL/UNKNOWN, never a COMPLETE status.
 */
import { weakestBinding, type BindingLevel, type ProofMethod } from './proof';
import {
  verifyRecordId,
  type ArtifactRecord,
  type BuildRecord,
  type DeploymentRecord,
  type Environment,
  type PlatformVersionRecord,
  type ProvenanceRecord,
  type RuntimeObservationRecord,
  type SourceRecord,
} from './records';

export const CHAIN_LINKS = [
  'SOURCE_TO_ARTIFACT',
  'ARTIFACT_TO_VERSION',
  'VERSION_TO_DEPLOYMENT',
  'DEPLOYMENT_TO_RUNTIME',
] as const;
export type ChainLink = (typeof CHAIN_LINKS)[number];

export type ChainStatus =
  | 'COMPLETE_CRYPTOGRAPHIC'
  | 'COMPLETE_PLATFORM_ATTESTED'
  | 'PARTIAL'
  | 'UNKNOWN'
  /**
   * Evidence disagrees with itself or with the expectation (R3-A4-55): e.g.
   * the platform says version A is deployed while the running code reports
   * B. Never repaired silently; outranks every other status.
   */
  | 'CONFLICT';

export type FindingCode =
  | 'RECORD_ID_MISMATCH'
  | 'BROKEN_SOURCE_LINK'
  | 'SOURCE_COMMIT_MISMATCH'
  | 'SOURCE_NOT_REACHABLE'
  | 'DIRTY_SOURCE_BUILD'
  | 'MISSING_BUILD'
  | 'MISSING_ARTIFACT'
  | 'ARTIFACT_DIGEST_MISMATCH'
  | 'MISSING_PLATFORM_VERSION'
  | 'PLATFORM_VERSION_MISMATCH'
  | 'MISSING_DEPLOYMENT'
  | 'DEPLOYMENT_MISMATCH'
  | 'MISSING_RUNTIME_OBSERVATION'
  | 'STALE_RUNTIME_OBSERVATION'
  | 'CONFLICTING_EVIDENCE'
  /** Running code reported a version no recorded deployment routes traffic to. */
  | 'RUNTIME_SELF_REPORT_CONFLICT';

/** Findings that make the whole chain CONFLICT rather than PARTIAL. */
export const CONFLICT_FINDINGS: readonly FindingCode[] = [
  'CONFLICTING_EVIDENCE',
  'PLATFORM_VERSION_MISMATCH',
  'RUNTIME_SELF_REPORT_CONFLICT',
];

export interface Finding {
  readonly code: FindingCode;
  readonly detail: string;
  readonly record_ids: readonly string[];
}

export interface LinkResult {
  readonly binding: BindingLevel;
  readonly methods: readonly ProofMethod[];
  readonly record_ids: readonly string[];
}

export interface ChainExpectation {
  readonly environment: Environment;
  readonly deployment_unit: string;
  readonly source_commit?: string;
  readonly platform_version_id?: string;
  readonly platform_deployment_id?: string;
}

export interface ChainOptions {
  /** Evaluation instant (ISO). Injected so results are deterministic. */
  readonly now: string;
  /** A runtime observation older than this is stale. */
  readonly maxObservationAgeMs: number;
}

export interface ChainResult {
  readonly status: ChainStatus;
  readonly links: Readonly<Record<ChainLink, LinkResult>>;
  readonly findings: readonly Finding[];
  readonly resolved: {
    readonly source_commit: string | null;
    readonly artifact_sha256: string | null;
    readonly platform_version_id: string | null;
    readonly platform_deployment_id: string | null;
  };
}

const UNKNOWN_LINK: LinkResult = Object.freeze({ binding: 'UNKNOWN', methods: [], record_ids: [] });

function link(binding: BindingLevel, records: readonly ProvenanceRecord[]): LinkResult {
  const methods = [...new Set(records.flatMap((r) => r.proof.methods))].sort();
  return { binding, methods, record_ids: records.map((r) => r.record_id) };
}

function of<T extends ProvenanceRecord['record_type']>(
  records: readonly ProvenanceRecord[],
  type: T
): Extract<ProvenanceRecord, { record_type: T }>[] {
  return records.filter((r) => r.record_type === type) as Extract<
    ProvenanceRecord,
    { record_type: T }
  >[];
}

export async function evaluateProvenanceChain(
  all: readonly ProvenanceRecord[],
  expect: ChainExpectation,
  opts: ChainOptions
): Promise<ChainResult> {
  const findings: Finding[] = [];
  const add = (code: FindingCode, detail: string, ids: readonly string[] = []) =>
    findings.push({ code, detail, record_ids: ids });

  // Integrity: a record whose id does not match its content is discarded.
  const records: ProvenanceRecord[] = [];
  for (const r of all) {
    if (r.environment !== expect.environment || r.deployment_unit !== expect.deployment_unit)
      continue;
    if (await verifyRecordId(r)) records.push(r);
    else
      add('RECORD_ID_MISMATCH', `${r.record_type} content does not hash to its record_id`, [
        r.record_id,
      ]);
  }

  const links: Record<ChainLink, LinkResult> = {
    SOURCE_TO_ARTIFACT: UNKNOWN_LINK,
    ARTIFACT_TO_VERSION: UNKNOWN_LINK,
    VERSION_TO_DEPLOYMENT: UNKNOWN_LINK,
    DEPLOYMENT_TO_RUNTIME: UNKNOWN_LINK,
  };
  const resolved = {
    source_commit: null as string | null,
    artifact_sha256: null as string | null,
    platform_version_id: null as string | null,
    platform_deployment_id: null as string | null,
  };

  // --- DEPLOYMENT_TO_RUNTIME ------------------------------------------------
  const now = Date.parse(opts.now);
  const observations = of(records, 'RuntimeObservationRecord');
  const fresh = observations.filter(
    (o) => now - Date.parse(o.observed_at) <= opts.maxObservationAgeMs
  );
  let observation: RuntimeObservationRecord | null = null;
  if (observations.length === 0) {
    add('MISSING_RUNTIME_OBSERVATION', 'no runtime observation for this deployment unit');
  } else if (fresh.length === 0) {
    add(
      'STALE_RUNTIME_OBSERVATION',
      `newest observation older than ${opts.maxObservationAgeMs}ms`,
      observations.map((o) => o.record_id)
    );
  } else {
    const versions = new Set(fresh.map((o) => o.observed_version_id));
    const deployments = new Set(
      fresh.map((o) => o.observed_deployment_id).filter((d) => d !== null)
    );
    if (versions.size > 1 || deployments.size > 1) {
      add(
        'CONFLICTING_EVIDENCE',
        'fresh runtime observations disagree on running version/deployment',
        fresh.map((o) => o.record_id)
      );
    } else {
      observation = fresh.reduce((a, b) =>
        Date.parse(b.observed_at) > Date.parse(a.observed_at) ? b : a
      );
    }
  }

  if (
    observation &&
    observation.observation_kind === 'RUNTIME_SELF_REPORT' &&
    observation.reported_deployment_unit !== observation.deployment_unit
  ) {
    add(
      'RUNTIME_SELF_REPORT_CONFLICT',
      `queried ${observation.deployment_unit}, running code reports ${String(observation.reported_deployment_unit)}`,
      [observation.record_id]
    );
    observation = null;
  }

  const runningVersion = observation?.observed_version_id ?? null;
  if (observation && expect.platform_version_id && runningVersion !== expect.platform_version_id) {
    add(
      'PLATFORM_VERSION_MISMATCH',
      `observed ${runningVersion}, expected ${expect.platform_version_id}`,
      [observation.record_id]
    );
  }

  // --- VERSION_TO_DEPLOYMENT ------------------------------------------------
  let deployment: DeploymentRecord | null = null;
  if (observation) {
    const deployments = of(records, 'DeploymentRecord');
    const candidates = observation.observed_deployment_id
      ? deployments.filter((d) => d.platform_deployment_id === observation!.observed_deployment_id)
      : deployments.filter((d) => d.traffic.some((t) => t.version_id === runningVersion));
    const distinct = new Set(candidates.map((d) => d.platform_deployment_id));
    if (
      candidates.length === 0 &&
      observation.observation_kind === 'RUNTIME_SELF_REPORT' &&
      deployments.length > 0
    ) {
      add(
        'RUNTIME_SELF_REPORT_CONFLICT',
        `running code reports ${runningVersion}; no recorded deployment routes traffic to it`,
        [observation.record_id, ...deployments.map((d) => d.record_id)]
      );
    } else if (candidates.length === 0) {
      add('MISSING_DEPLOYMENT', 'no deployment record matches the runtime observation', [
        observation.record_id,
      ]);
    } else if (distinct.size > 1) {
      add(
        'CONFLICTING_EVIDENCE',
        'multiple deployments claim the running version',
        candidates.map((d) => d.record_id)
      );
    } else {
      deployment = candidates[0];
      const allocation = deployment.traffic.find((t) => t.version_id === runningVersion);
      if (!allocation || allocation.percentage <= 0) {
        add('DEPLOYMENT_MISMATCH', 'deployment does not route traffic to the observed version', [
          deployment.record_id,
          observation.record_id,
        ]);
        deployment = null;
      } else if (
        expect.platform_deployment_id &&
        deployment.platform_deployment_id !== expect.platform_deployment_id
      ) {
        add(
          'DEPLOYMENT_MISMATCH',
          `deployment ${deployment.platform_deployment_id}, expected ${expect.platform_deployment_id}`,
          [deployment.record_id]
        );
        deployment = null;
      }
    }
    if (deployment) {
      resolved.platform_deployment_id = deployment.platform_deployment_id;
      links.DEPLOYMENT_TO_RUNTIME = link(observation.proof.binding, [observation]);
    }
  }

  // --- PLATFORM VERSION -----------------------------------------------------
  let version: PlatformVersionRecord | null = null;
  if (deployment && runningVersion) {
    const versions = of(records, 'PlatformVersionRecord').filter(
      (v) => v.platform_version_id === runningVersion
    );
    const digests = new Set(versions.map((v) => v.platform_module_set_digest));
    if (versions.length === 0) {
      add('MISSING_PLATFORM_VERSION', `no platform version record for ${runningVersion}`);
    } else if (digests.size > 1) {
      add(
        'CONFLICTING_EVIDENCE',
        'platform version records disagree on module bytes',
        versions.map((v) => v.record_id)
      );
    } else {
      version = versions[0];
      resolved.platform_version_id = version.platform_version_id;
      links.VERSION_TO_DEPLOYMENT = link(
        weakestBinding([version.proof.binding, deployment.proof.binding]),
        [version, deployment]
      );
    }
  }

  // --- ARTIFACT_TO_VERSION --------------------------------------------------
  let artifact: ArtifactRecord | null = null;
  if (version) {
    const artifacts = of(records, 'ArtifactRecord');
    const mainPlatform = version.platform_modules.find((m) => m.name === version!.main_module);
    const matching = artifacts.filter(
      (a) =>
        a.module_set_digest === version!.platform_module_set_digest &&
        a.main_module === version!.main_module &&
        a.artifact_sha256 === mainPlatform?.sha256
    );
    if (matching.length > 0) {
      artifact = matching[0];
      resolved.artifact_sha256 = artifact.artifact_sha256;
      links.ARTIFACT_TO_VERSION = link(
        weakestBinding([version.proof.binding, artifact.proof.binding]),
        [artifact, version]
      );
    } else if (artifacts.length > 0) {
      add(
        'ARTIFACT_DIGEST_MISMATCH',
        'no artifact digest equals the platform-returned module bytes',
        [...artifacts.map((a) => a.record_id), version.record_id]
      );
    } else {
      add('MISSING_ARTIFACT', 'no artifact record for this deployment unit', [version.record_id]);
    }
  }

  // --- SOURCE_TO_ARTIFACT ---------------------------------------------------
  if (artifact) {
    const builds = of(records, 'BuildRecord').filter(
      (b) =>
        b.artifact_sha256 === artifact!.artifact_sha256 &&
        b.module_set_digest === artifact!.module_set_digest
    );
    // A commit built twice with different bytes is non-reproducible evidence.
    const allBuilds = of(records, 'BuildRecord');
    for (const b of builds) {
      const sibling = allBuilds.find(
        (o) =>
          o.source_commit === b.source_commit &&
          o.config_path === b.config_path &&
          o.module_set_digest !== b.module_set_digest &&
          !o.source_dirty
      );
      if (sibling) {
        add('CONFLICTING_EVIDENCE', `commit ${b.source_commit} built to two different digests`, [
          b.record_id,
          sibling.record_id,
        ]);
      }
    }
    const clean = builds.filter((b) => !b.source_dirty);
    if (builds.length === 0) {
      add('MISSING_BUILD', 'no build record produced this artifact', [artifact.record_id]);
    } else if (clean.length === 0) {
      add(
        'DIRTY_SOURCE_BUILD',
        'artifact only produced from a dirty working tree',
        builds.map((b) => b.record_id)
      );
    } else {
      const commits = new Set(clean.map((b) => b.source_commit));
      if (commits.size > 1) {
        add(
          'CONFLICTING_EVIDENCE',
          'artifact attributed to multiple source commits',
          clean.map((b) => b.record_id)
        );
      } else {
        const build: BuildRecord = clean[0];
        const source: SourceRecord | undefined = of(records, 'SourceRecord').find(
          (s) => s.source_commit === build.source_commit
        );
        if (!source) {
          add('BROKEN_SOURCE_LINK', `no source record for commit ${build.source_commit}`, [
            build.record_id,
          ]);
        } else if (expect.source_commit && source.source_commit !== expect.source_commit) {
          add(
            'SOURCE_COMMIT_MISMATCH',
            `built from ${source.source_commit}, expected ${expect.source_commit}`,
            [source.record_id]
          );
        } else {
          if (source.reachable_from_protected_ref === false) {
            add('SOURCE_NOT_REACHABLE', `commit ${source.source_commit} not on a protected ref`, [
              source.record_id,
            ]);
          }
          resolved.source_commit = source.source_commit;
          links.SOURCE_TO_ARTIFACT = link(
            weakestBinding([source.proof.binding, build.proof.binding, artifact.proof.binding]),
            [source, build, artifact]
          );
        }
      }
    }
  }

  return { status: classify(links, findings), links, findings, resolved };
}

function classify(links: Record<ChainLink, LinkResult>, findings: readonly Finding[]): ChainStatus {
  const bindings = CHAIN_LINKS.map((l) => links[l].binding);
  if (findings.some((f) => CONFLICT_FINDINGS.includes(f.code))) return 'CONFLICT';
  if (bindings.every((b) => b === 'UNKNOWN')) return 'UNKNOWN';
  if (findings.length > 0 || bindings.includes('UNKNOWN')) return 'PARTIAL';
  const weakest = weakestBinding(bindings);
  if (weakest === 'CRYPTOGRAPHICALLY_BOUND') return 'COMPLETE_CRYPTOGRAPHIC';
  if (weakest === 'PLATFORM_ATTESTED') return 'COMPLETE_PLATFORM_ATTESTED';
  return 'PARTIAL';
}
