/**
 * Canonical provenance records (R3-A4 Phase 3). Six record types link
 * source -> build -> artifact -> platform version -> deployment -> runtime.
 *
 * Identity is content-addressed: `record_id = "ev:" + sha256(JCS(record
 * without record_id))`, so the same evidence always gets the same id and
 * two records claiming one id with different content are a conflict, never
 * an overwrite.
 *
 * Operator-entered text (Cloudflare `workers/message`, `workers/tag`,
 * release notes) is carried in `operator_annotations` for audit only. The
 * chain verifier never reads it when classifying a link.
 */
import { GIT_SHA_RE, SHA256_HEX_RE, hashCanonical } from './canonical';
import { BINDING_LEVELS, PROOF_METHODS, type ProofLevel } from './proof';
import { TOOLCHAIN_PROVENANCE, type ToolchainProvenance } from './toolchain';

export const PROVENANCE_RECORD_SCHEMA_VERSION = 1 as const;

export const PROVENANCE_RECORD_TYPES = [
  'SourceRecord',
  'BuildRecord',
  'ArtifactRecord',
  'PlatformVersionRecord',
  'DeploymentRecord',
  'RuntimeObservationRecord',
] as const;
export type ProvenanceRecordType = (typeof PROVENANCE_RECORD_TYPES)[number];

export type Environment = 'production' | 'staging' | 'local';

export interface RecordBase<T extends ProvenanceRecordType> {
  readonly record_type: T;
  readonly record_id: string;
  readonly schema_version: typeof PROVENANCE_RECORD_SCHEMA_VERSION;
  readonly environment: Environment;
  /** Deployment unit, e.g. Cloudflare Worker script name. */
  readonly deployment_unit: string;
  /** When this evidence was captured (not when the thing happened). */
  readonly captured_at: string;
  /** Principal that captured the evidence (tool/operator identity). */
  readonly actor: string;
  /** Where the evidence came from (API path, command, file). */
  readonly evidence_source: string;
  readonly proof: ProofLevel;
  readonly parent_ids: readonly string[];
}

export interface OperatorAnnotations {
  readonly message?: string;
  readonly tag?: string;
}

export interface ModuleDigest {
  readonly name: string;
  /** lowercase hex, no prefix */
  readonly sha256: string;
  readonly size?: number;
}

export interface SourceRecord extends RecordBase<'SourceRecord'> {
  readonly source_repository: string;
  readonly source_commit: string;
  readonly source_ref: string | null;
  /** Commit is an ancestor of a protected remote branch (not a loose object). */
  readonly reachable_from_protected_ref: boolean | null;
}

export interface Toolchain {
  readonly node: string;
  readonly wrangler: string;
  readonly package_manager: string;
  /** sha256 hex of the lockfile at source_commit */
  readonly lockfile_sha256: string | null;
}

export interface BuildRecord extends RecordBase<'BuildRecord'> {
  readonly source_commit: string;
  readonly source_dirty: boolean;
  readonly toolchain: Toolchain;
  /** Exact command, e.g. `wrangler deploy --dry-run --outdir <d> --config <c>` */
  readonly build_command: string;
  readonly config_path: string;
  readonly main_module: string;
  readonly artifact_sha256: string;
  readonly module_set_digest: string;
  /**
   * R3-A4-55: whether `toolchain` is what produced the release or a later
   * rebuild. Absent on records captured before this field existed.
   */
  readonly toolchain_provenance?: ToolchainProvenance;
}

export interface ArtifactRecord extends RecordBase<'ArtifactRecord'> {
  readonly main_module: string;
  readonly artifact_sha256: string;
  readonly module_set_digest: string;
  readonly modules: readonly ModuleDigest[];
}

export interface PlatformVersionRecord extends RecordBase<'PlatformVersionRecord'> {
  readonly platform: 'cloudflare-workers';
  readonly platform_version_id: string;
  readonly platform_version_number: number | null;
  readonly platform_created_on: string;
  readonly main_module: string;
  /** Digests of module bytes as RETURNED BY THE PLATFORM for this version. */
  readonly platform_modules: readonly ModuleDigest[];
  readonly platform_module_set_digest: string;
  readonly operator_annotations: OperatorAnnotations;
}

export interface TrafficAllocation {
  readonly version_id: string;
  readonly percentage: number;
}

export interface DeploymentRecord extends RecordBase<'DeploymentRecord'> {
  readonly platform: 'cloudflare-workers';
  readonly platform_deployment_id: string;
  readonly platform_created_on: string;
  readonly strategy: string;
  readonly traffic: readonly TrafficAllocation[];
  readonly operator_annotations: OperatorAnnotations;
}

export type RuntimeObservationKind =
  /** Platform API reports this deployment as the latest/active one. */
  | 'PLATFORM_ACTIVE_DEPLOYMENT'
  /** The running code reported its own version id (e.g. version-metadata binding). */
  | 'RUNTIME_SELF_REPORT'
  /** A controlled probe produced a marker only this version's code can emit. */
  | 'CONTROLLED_PROBE';

export interface RuntimeObservationRecord extends RecordBase<'RuntimeObservationRecord'> {
  readonly observation_kind: RuntimeObservationKind;
  readonly observed_at: string;
  readonly observed_deployment_id: string | null;
  readonly observed_version_id: string;
  readonly observed_traffic_percentage: number | null;
  /**
   * RUNTIME_SELF_REPORT only (R3-A4-55). Where the running code reported
   * itself (e.g. `GET /health#runtime`, a Workers Logs event name). Absent on
   * platform-read observations, so their record ids are unchanged.
   */
  readonly observation_surface?: string;
  /** RUNTIME_SELF_REPORT only: deployment unit the running code named. */
  readonly reported_deployment_unit?: string;
  /** RUNTIME_SELF_REPORT only: CF_VERSION_METADATA.timestamp as reported. */
  readonly observed_version_timestamp?: string | null;
  /**
   * RUNTIME_SELF_REPORT only: CF_VERSION_METADATA.tag. Operator-chosen text,
   * audit only, never read when classifying a link.
   */
  readonly operator_annotations?: OperatorAnnotations;
}

export type ProvenanceRecord =
  | SourceRecord
  | BuildRecord
  | ArtifactRecord
  | PlatformVersionRecord
  | DeploymentRecord
  | RuntimeObservationRecord;

export type UnsignedRecord<R extends ProvenanceRecord> = Omit<R, 'record_id'>;

export async function computeRecordId(record: UnsignedRecord<ProvenanceRecord>): Promise<string> {
  const { record_id: _ignored, ...rest } = record as ProvenanceRecord;
  void _ignored;
  const digest = await hashCanonical(rest);
  return `ev:${digest.slice('sha256:'.length)}`;
}

/** Stamp a deterministic record_id onto an unsigned record. Validates first. */
export async function sealRecord<R extends ProvenanceRecord>(
  record: UnsignedRecord<R>
): Promise<R> {
  const errors = validateRecord({
    ...record,
    record_id: 'ev:pending',
  } as unknown as ProvenanceRecord);
  if (errors.length > 0) {
    throw new Error(`invalid ${record.record_type}: ${errors.join('; ')}`);
  }
  const record_id = await computeRecordId(record);
  return Object.freeze({ ...record, record_id }) as R;
}

export async function verifyRecordId(record: ProvenanceRecord): Promise<boolean> {
  return (await computeRecordId(record)) === record.record_id;
}

/**
 * Module-set digest: sha256 over the JCS of executable modules sorted by
 * name. Source maps and README files are excluded because the platform does
 * not return them for a version, so including them would make local and
 * platform digests incomparable.
 */
export function isExecutableModuleName(name: string): boolean {
  return !name.endsWith('.map') && name !== 'README.md';
}

export async function computeModuleSetDigest(modules: readonly ModuleDigest[]): Promise<string> {
  const set = modules
    .filter((m) => isExecutableModuleName(m.name))
    .map((m) => ({ name: m.name, sha256: m.sha256 }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const digest = await hashCanonical(set);
  return digest.slice('sha256:'.length);
}

// ---------------------------------------------------------------------------
// Fail-closed structural validation.
// ---------------------------------------------------------------------------

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function validateRecord(r: ProvenanceRecord): string[] {
  const e: string[] = [];
  if (!(PROVENANCE_RECORD_TYPES as readonly string[]).includes(r.record_type))
    e.push('record_type');
  if (r.schema_version !== PROVENANCE_RECORD_SCHEMA_VERSION) e.push('schema_version');
  if (!['production', 'staging', 'local'].includes(r.environment)) e.push('environment');
  if (!r.deployment_unit) e.push('deployment_unit');
  if (!ISO_RE.test(r.captured_at)) e.push('captured_at');
  if (!r.actor) e.push('actor');
  if (!r.evidence_source) e.push('evidence_source');
  if (!r.proof || !(BINDING_LEVELS as readonly string[]).includes(r.proof.binding))
    e.push('proof.binding');
  if (!r.proof || !r.proof.methods.every((m) => (PROOF_METHODS as readonly string[]).includes(m))) {
    e.push('proof.methods');
  }
  if (!Array.isArray(r.parent_ids) || !r.parent_ids.every((p) => p.startsWith('ev:')))
    e.push('parent_ids');
  const hex = (v: string, f: string) => {
    if (!SHA256_HEX_RE.test(v)) e.push(f);
  };
  switch (r.record_type) {
    case 'SourceRecord':
      if (!GIT_SHA_RE.test(r.source_commit)) e.push('source_commit');
      if (!r.source_repository) e.push('source_repository');
      break;
    case 'BuildRecord':
      if (!GIT_SHA_RE.test(r.source_commit)) e.push('source_commit');
      hex(r.artifact_sha256, 'artifact_sha256');
      hex(r.module_set_digest, 'module_set_digest');
      if (!r.toolchain?.node || !r.toolchain?.wrangler) e.push('toolchain');
      if (!r.build_command) e.push('build_command');
      if (
        r.toolchain_provenance !== undefined &&
        !(TOOLCHAIN_PROVENANCE as readonly string[]).includes(r.toolchain_provenance)
      )
        e.push('toolchain_provenance');
      break;
    case 'ArtifactRecord':
      hex(r.artifact_sha256, 'artifact_sha256');
      hex(r.module_set_digest, 'module_set_digest');
      if (!r.modules.some((m) => m.name === r.main_module)) e.push('main_module');
      r.modules.forEach((m, i) => hex(m.sha256, `modules[${i}].sha256`));
      break;
    case 'PlatformVersionRecord':
      if (!UUID_RE.test(r.platform_version_id)) e.push('platform_version_id');
      hex(r.platform_module_set_digest, 'platform_module_set_digest');
      r.platform_modules.forEach((m, i) => hex(m.sha256, `platform_modules[${i}].sha256`));
      if (!r.platform_modules.some((m) => m.name === r.main_module)) e.push('main_module');
      break;
    case 'DeploymentRecord': {
      if (!UUID_RE.test(r.platform_deployment_id)) e.push('platform_deployment_id');
      const total = r.traffic.reduce((s, t) => s + t.percentage, 0);
      if (r.traffic.length === 0 || Math.abs(total - 100) > 1e-9) e.push('traffic');
      if (!r.traffic.every((t) => UUID_RE.test(t.version_id))) e.push('traffic.version_id');
      break;
    }
    case 'RuntimeObservationRecord':
      if (!ISO_RE.test(r.observed_at)) e.push('observed_at');
      if (!UUID_RE.test(r.observed_version_id)) e.push('observed_version_id');
      if (r.observation_kind === 'RUNTIME_SELF_REPORT') {
        if (!r.observation_surface) e.push('observation_surface');
        if (!r.reported_deployment_unit) e.push('reported_deployment_unit');
        if (r.observed_deployment_id !== null) e.push('observed_deployment_id');
      }
      break;
  }
  return e;
}
