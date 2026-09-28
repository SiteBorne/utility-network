/**
 * Runtime self-report -> RuntimeObservationRecord (R3-A4-55 Phase 5/6).
 *
 * A running Worker reports its own Cloudflare version metadata
 * (`CF_VERSION_METADATA` binding: id, tag, timestamp) on a read-only surface.
 * That report is what the running code says, as distinct from what the
 * platform API says is deployed (PLATFORM_ACTIVE_DEPLOYMENT).
 *
 * Nothing here accepts an expected version. The observed id comes only from
 * the report, so a runtime can never be made to echo the value a caller
 * hoped for. Agreement with the deployment is decided later by
 * evaluateProvenanceChain, which returns CONFLICT on disagreement.
 *
 * The tag is operator-chosen text and is kept as an audit annotation only.
 */
import { sealRecord, type Environment, type RuntimeObservationRecord } from './records';

/** Structured log event name the host Worker emits (Workers Logs). */
export const RUNTIME_VERSION_EVENT = 'siteborne.runtime_version' as const;

export interface RuntimeVersionReport {
  readonly deployment_unit: string;
  readonly platform_version_id: string;
  readonly platform_version_tag: string | null;
  readonly platform_version_timestamp: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REPORT_KEYS = [
  'deployment_unit',
  'platform_version_id',
  'platform_version_tag',
  'platform_version_timestamp',
] as const;

/** Strict parse of the `runtime` object a Worker reports. Throws, never guesses. */
export function parseRuntimeVersionReport(value: unknown): RuntimeVersionReport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('runtime report must be an object');
  }
  const v = value as Record<string, unknown>;
  const extra = Object.keys(v).filter(
    (k) => k !== 'event' && !(REPORT_KEYS as readonly string[]).includes(k)
  );
  if (extra.length > 0) throw new Error(`runtime report has unexpected keys: ${extra.join(', ')}`);
  if (typeof v.deployment_unit !== 'string' || v.deployment_unit.length === 0) {
    throw new Error('runtime report deployment_unit missing');
  }
  if (typeof v.platform_version_id !== 'string' || !UUID_RE.test(v.platform_version_id)) {
    throw new Error('runtime report platform_version_id is not a version uuid');
  }
  const optional = (k: 'platform_version_tag' | 'platform_version_timestamp') => {
    const x = v[k];
    if (x === null || x === undefined) return null;
    if (typeof x !== 'string') throw new Error(`runtime report ${k} must be a string or null`);
    return x;
  };
  return {
    deployment_unit: v.deployment_unit,
    platform_version_id: v.platform_version_id,
    platform_version_tag: optional('platform_version_tag'),
    platform_version_timestamp: optional('platform_version_timestamp'),
  };
}

export interface RuntimeSelfReportInput {
  readonly environment: Environment;
  /** The unit the observer queried; compared to the reported unit by the chain. */
  readonly deployment_unit: string;
  readonly captured_at: string;
  readonly observed_at: string;
  readonly actor: string;
  /** e.g. `GET https://utility.siteborne.net/health#runtime`. */
  readonly observation_surface: string;
  readonly evidence_source: string;
  readonly parent_ids: readonly string[];
  readonly report: RuntimeVersionReport;
}

export async function sealRuntimeSelfReport(
  i: RuntimeSelfReportInput
): Promise<RuntimeObservationRecord> {
  const report = parseRuntimeVersionReport(i.report);
  return sealRecord<RuntimeObservationRecord>({
    record_type: 'RuntimeObservationRecord',
    schema_version: 1,
    environment: i.environment,
    deployment_unit: i.deployment_unit,
    captured_at: i.captured_at,
    actor: i.actor,
    evidence_source: i.evidence_source,
    // The platform injects the metadata; the running code reports it.
    proof: { binding: 'PLATFORM_ATTESTED', methods: ['OBSERVED_RUNTIME'] },
    parent_ids: i.parent_ids,
    observation_kind: 'RUNTIME_SELF_REPORT',
    observed_at: i.observed_at,
    observed_deployment_id: null,
    observed_version_id: report.platform_version_id,
    observed_traffic_percentage: null,
    observation_surface: i.observation_surface,
    reported_deployment_unit: report.deployment_unit,
    observed_version_timestamp: report.platform_version_timestamp,
    operator_annotations:
      report.platform_version_tag === null ? {} : { tag: report.platform_version_tag },
  });
}
