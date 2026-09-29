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
import type { ToolchainProvenance } from './toolchain';

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
    readonly remote_reachable?: boolean;
    readonly approved_release_ref?: boolean | null;
  };
  readonly build: {
    readonly dirty: boolean;
    readonly toolchain: Toolchain;
    readonly command: string;
    /** R3-A4-55: omit only for records captured before the field existed. */
    readonly toolchain_provenance?: ToolchainProvenance;
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

type Base = Pick<
  SourceRecord,
  'schema_version' | 'environment' | 'deployment_unit' | 'captured_at' | 'actor'
>;

export interface StageContext {
  readonly environment: Environment;
  readonly deployment_unit: string;
  readonly captured_at: string;
  readonly actor: string;
}

function baseOf(c: StageContext): Base {
  return {
    schema_version: 1 as const,
    environment: c.environment,
    deployment_unit: c.deployment_unit,
    captured_at: c.captured_at,
    actor: c.actor,
  };
}

/*
 * Release capture stages (R3-A4-55 Phase 7). Each stage seals one new record
 * whose parent is the previous stage's record. A later stage never edits an
 * earlier record: facts discovered later become new records.
 */

/** STAGE A -- SOURCE. */
export async function recordSourceStage(
  c: StageContext,
  s: CaptureInput['source']
): Promise<SourceRecord> {
  return sealRecord<SourceRecord>({
    ...baseOf(c),
    record_type: 'SourceRecord',
    evidence_source: `git:${s.repository}`,
    proof: LOCAL_HASH,
    parent_ids: [],
    source_repository: s.repository,
    source_commit: s.commit,
    source_ref: s.ref,
    reachable_from_protected_ref: s.reachable_from_protected_ref,
    ...(s.remote_reachable === undefined ? {} : { remote_reachable: s.remote_reachable }),
    ...(s.approved_release_ref === undefined
      ? {}
      : { approved_release_ref: s.approved_release_ref }),
  });
}

/** STAGE B -- BUILD. */
export async function recordBuildStage(
  c: StageContext,
  source: SourceRecord,
  b: CaptureInput['build']
): Promise<BuildRecord> {
  const mainLocal = b.modules.find((m) => m.name === b.main_module);
  if (!mainLocal) throw new Error(`build output lacks main module ${b.main_module}`);
  return sealRecord<BuildRecord>({
    ...baseOf(c),
    record_type: 'BuildRecord',
    evidence_source: `local-build:${b.command}`,
    proof: b.dirty ? { binding: 'UNVERIFIED', methods: ['ASSERTED'] } : LOCAL_HASH,
    parent_ids: [source.record_id],
    source_commit: source.source_commit,
    source_dirty: b.dirty,
    toolchain: b.toolchain,
    build_command: b.command,
    config_path: b.config_path,
    main_module: b.main_module,
    artifact_sha256: mainLocal.sha256,
    module_set_digest: await computeModuleSetDigest(b.modules),
    ...(b.toolchain_provenance ? { toolchain_provenance: b.toolchain_provenance } : {}),
  });
}

/** STAGE C -- ARTIFACT: digests of the exact bytes that will be uploaded. */
export async function recordArtifactStage(
  c: StageContext,
  build: BuildRecord,
  modules: readonly ModuleDigest[]
): Promise<ArtifactRecord> {
  const setDigest = await computeModuleSetDigest(modules);
  const main = modules.find((m) => m.name === build.main_module);
  if (setDigest !== build.module_set_digest || main?.sha256 !== build.artifact_sha256) {
    throw new Error('artifact bytes differ from the build record');
  }
  return sealRecord<ArtifactRecord>({
    ...baseOf(c),
    record_type: 'ArtifactRecord',
    evidence_source: 'sha256(local build output)',
    proof: LOCAL_HASH,
    parent_ids: [build.record_id],
    main_module: build.main_module,
    artifact_sha256: build.artifact_sha256,
    module_set_digest: setDigest,
    modules,
  });
}

/** STAGE D -- UPLOAD: platform version as read back after `versions upload`. */
export async function recordVersionStage(
  c: StageContext,
  artifact: ArtifactRecord,
  v: CaptureInput['platform_version']
): Promise<PlatformVersionRecord> {
  return sealRecord<PlatformVersionRecord>({
    ...baseOf(c),
    record_type: 'PlatformVersionRecord',
    evidence_source: v.evidence_source,
    proof: PLATFORM_READ,
    parent_ids: [artifact.record_id],
    platform: 'cloudflare-workers',
    platform_version_id: v.id,
    platform_version_number: v.number,
    platform_created_on: v.created_on,
    main_module: v.main_module,
    platform_modules: v.modules,
    platform_module_set_digest: await computeModuleSetDigest(v.modules),
    operator_annotations: v.annotations,
  });
}

export interface UploadVerification {
  readonly verified: boolean;
  readonly detail: string;
}

/**
 * STAGE E -- VERIFY: the platform-returned executable bytes equal the
 * artifact. Produces no record; a failed verification stops the release.
 */
export function verifyUploadStage(
  artifact: ArtifactRecord,
  version: PlatformVersionRecord
): UploadVerification {
  const main = version.platform_modules.find((m) => m.name === version.main_module);
  if (version.main_module !== artifact.main_module) {
    return {
      verified: false,
      detail: `main module ${version.main_module} != ${artifact.main_module}`,
    };
  }
  if (main?.sha256 !== artifact.artifact_sha256) {
    return { verified: false, detail: 'platform main module bytes differ from artifact' };
  }
  if (version.platform_module_set_digest !== artifact.module_set_digest) {
    return { verified: false, detail: 'platform module set differs from artifact' };
  }
  return { verified: true, detail: 'platform module bytes equal artifact' };
}

/** STAGE F -- DEPLOYMENT: deployment id and allocation after `versions deploy`. */
export async function recordDeploymentStage(
  c: StageContext,
  version: PlatformVersionRecord,
  d: CaptureInput['deployment']
): Promise<DeploymentRecord> {
  return sealRecord<DeploymentRecord>({
    ...baseOf(c),
    record_type: 'DeploymentRecord',
    evidence_source: d.evidence_source,
    proof: PLATFORM_READ,
    parent_ids: [version.record_id],
    platform: 'cloudflare-workers',
    platform_deployment_id: d.id,
    platform_created_on: d.created_on,
    strategy: d.strategy,
    traffic: d.traffic,
    operator_annotations: d.annotations,
  });
}

/**
 * STAGE G -- RUNTIME (platform view). The running code's own report is
 * sealed separately by sealRuntimeSelfReport (runtime-report.ts).
 */
export async function recordPlatformObservationStage(
  c: StageContext,
  deployment: DeploymentRecord,
  o: CaptureInput['observation']
): Promise<RuntimeObservationRecord> {
  return sealRecord<RuntimeObservationRecord>({
    ...baseOf(c),
    record_type: 'RuntimeObservationRecord',
    evidence_source: o.evidence_source,
    proof: observationProof(o.kind),
    parent_ids: [deployment.record_id],
    observation_kind: o.kind,
    observed_at: o.observed_at,
    observed_deployment_id: o.deployment_id,
    observed_version_id: o.version_id,
    observed_traffic_percentage: o.traffic_percentage,
  });
}

/** All stages at once, for re-deriving an already-deployed release. */
export async function buildProvenanceRecords(i: CaptureInput): Promise<ProvenanceRecord[]> {
  const c: StageContext = i;
  const source = await recordSourceStage(c, i.source);
  const build = await recordBuildStage(c, source, i.build);
  const artifact = await recordArtifactStage(c, build, i.build.modules);
  const version = await recordVersionStage(c, artifact, i.platform_version);
  const deployment = await recordDeploymentStage(c, version, i.deployment);
  const observation = await recordPlatformObservationStage(c, deployment, i.observation);
  return [source, build, artifact, version, deployment, observation];
}
