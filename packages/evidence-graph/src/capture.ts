/**
 * Deterministic provenance-record builder (R3-A4 Phase 7). Turns captured
 * facts -- a local reproducible build plus read-only Cloudflare API reads --
 * into one sealed, parent-linked record chain. Proof levels are assigned
 * here, from how each fact was obtained, never from operator text.
 */
import type { ProofLevel } from './proof';
import {
  computeModuleSetDigest,
  sealRecord,
  type ArtifactRecord,
  type BuildRecord,
  type DeploymentRecord,
  type Environment,
  type ModuleDigest,
  type OperatorAnnotations,
  type PlatformVersionRecord,
  type ProvenanceRecord,
  type RuntimeObservationKind,
  type RuntimeObservationRecord,
  type SourceRecord,
  type Toolchain,
} from './records';

export interface CaptureInput {
  readonly environment: Environment;
  readonly deployment_unit: string;
  readonly captured_at: string;
  readonly actor: string;
  readonly source: {
    readonly repository: string;
    readonly commit: string;
    readonly ref: string | null;
    readonly reachable_from_protected_ref: boolean | null;
  };
  readonly build: {
    readonly dirty: boolean;
    readonly toolchain: Toolchain;
    readonly command: string;
    readonly config_path: string;
    readonly main_module: string;
    /** Local output modules (maps/README are ignored by the digest). */
    readonly modules: readonly ModuleDigest[];
  };
  readonly platform_version: {
    readonly id: string;
    readonly number: number | null;
    readonly created_on: string;
    readonly main_module: string;
    /** sha256 of module bytes as returned by GET .../versions/{id}?include=modules */
    readonly modules: readonly ModuleDigest[];
    readonly annotations: OperatorAnnotations;
    readonly evidence_source: string;
  };
  readonly deployment: {
    readonly id: string;
    readonly created_on: string;
    readonly strategy: string;
    readonly traffic: readonly { version_id: string; percentage: number }[];
    readonly annotations: OperatorAnnotations;
    readonly evidence_source: string;
  };
  readonly observation: {
    readonly kind: RuntimeObservationKind;
    readonly observed_at: string;
    readonly deployment_id: string | null;
    readonly version_id: string;
    readonly traffic_percentage: number | null;
    readonly evidence_source: string;
  };
}

const LOCAL_HASH: ProofLevel = { binding: 'CRYPTOGRAPHICALLY_BOUND', methods: ['REPRODUCED'] };
const PLATFORM_READ: ProofLevel = { binding: 'PLATFORM_ATTESTED', methods: ['PLATFORM_API_READ'] };

function observationProof(kind: RuntimeObservationKind): ProofLevel {
  switch (kind) {
    case 'PLATFORM_ACTIVE_DEPLOYMENT':
      return PLATFORM_READ;
    case 'RUNTIME_SELF_REPORT':
      return { binding: 'PLATFORM_ATTESTED', methods: ['OBSERVED_RUNTIME'] };
    case 'CONTROLLED_PROBE':
      return { binding: 'PLATFORM_ATTESTED', methods: ['CONTROLLED_TEST', 'OBSERVED_RUNTIME'] };
  }
}

export async function buildProvenanceRecords(i: CaptureInput): Promise<ProvenanceRecord[]> {
  const base = {
    schema_version: 1 as const,
    environment: i.environment,
    deployment_unit: i.deployment_unit,
    captured_at: i.captured_at,
    actor: i.actor,
  };

  const source = await sealRecord<SourceRecord>({
    ...base,
    record_type: 'SourceRecord',
    evidence_source: `git:${i.source.repository}`,
    proof: LOCAL_HASH,
    parent_ids: [],
    source_repository: i.source.repository,
    source_commit: i.source.commit,
    source_ref: i.source.ref,
    reachable_from_protected_ref: i.source.reachable_from_protected_ref,
  });

  const mainLocal = i.build.modules.find((m) => m.name === i.build.main_module);
  if (!mainLocal) throw new Error(`build output lacks main module ${i.build.main_module}`);
  const localSet = await computeModuleSetDigest(i.build.modules);

  const build = await sealRecord<BuildRecord>({
    ...base,
    record_type: 'BuildRecord',
    evidence_source: `local-build:${i.build.command}`,
    proof: i.build.dirty ? { binding: 'UNVERIFIED', methods: ['ASSERTED'] } : LOCAL_HASH,
    parent_ids: [source.record_id],
    source_commit: i.source.commit,
    source_dirty: i.build.dirty,
    toolchain: i.build.toolchain,
    build_command: i.build.command,
    config_path: i.build.config_path,
    main_module: i.build.main_module,
    artifact_sha256: mainLocal.sha256,
    module_set_digest: localSet,
  });

  const artifact = await sealRecord<ArtifactRecord>({
    ...base,
    record_type: 'ArtifactRecord',
    evidence_source: 'sha256(local build output)',
    proof: LOCAL_HASH,
    parent_ids: [build.record_id],
    main_module: i.build.main_module,
    artifact_sha256: mainLocal.sha256,
    module_set_digest: localSet,
    modules: i.build.modules,
  });

  const version = await sealRecord<PlatformVersionRecord>({
    ...base,
    record_type: 'PlatformVersionRecord',
    evidence_source: i.platform_version.evidence_source,
    proof: PLATFORM_READ,
    parent_ids: [artifact.record_id],
    platform: 'cloudflare-workers',
    platform_version_id: i.platform_version.id,
    platform_version_number: i.platform_version.number,
    platform_created_on: i.platform_version.created_on,
    main_module: i.platform_version.main_module,
    platform_modules: i.platform_version.modules,
    platform_module_set_digest: await computeModuleSetDigest(i.platform_version.modules),
    operator_annotations: i.platform_version.annotations,
  });

  const deployment = await sealRecord<DeploymentRecord>({
    ...base,
    record_type: 'DeploymentRecord',
    evidence_source: i.deployment.evidence_source,
    proof: PLATFORM_READ,
    parent_ids: [version.record_id],
    platform: 'cloudflare-workers',
    platform_deployment_id: i.deployment.id,
    platform_created_on: i.deployment.created_on,
    strategy: i.deployment.strategy,
    traffic: i.deployment.traffic,
    operator_annotations: i.deployment.annotations,
  });

  const observation = await sealRecord<RuntimeObservationRecord>({
    ...base,
    record_type: 'RuntimeObservationRecord',
    evidence_source: i.observation.evidence_source,
    proof: observationProof(i.observation.kind),
    parent_ids: [deployment.record_id],
    observation_kind: i.observation.kind,
    observed_at: i.observation.observed_at,
    observed_deployment_id: i.observation.deployment_id,
    observed_version_id: i.observation.version_id,
    observed_traffic_percentage: i.observation.traffic_percentage,
  });

  return [source, build, artifact, version, deployment, observation];
}
