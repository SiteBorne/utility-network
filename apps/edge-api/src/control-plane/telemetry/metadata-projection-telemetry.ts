/**
 * METADATA-VCM-06 §XXIII, implemented per METADATA-VCM-IMPL-04A. The
 * repository's only existing observability primitive on this path is
 * structured `console.error` JSON lines (Cloudflare platform logs /
 * Logpush) -- this reuses that mechanism rather than proposing a new
 * binding. This repo's own lint rule (`no-console`) permits only `warn`/
 * `error`, matching the existing repo-wide convention of routing every
 * structured JSON log line (including non-error informational ones, e.g.
 * the registry-parity suite's own `REGISTRY_FILES_PARITY_FAIL`) through
 * `console.error`, never `console.log`. Four bounded counters:
 *
 *   metadata_projection_compare_total{surface}
 *   metadata_projection_match_total{surface}
 *   metadata_projection_mismatch_total{surface,domain}
 *   metadata_projection_fallback_total{surface}
 *
 * Only digests, booleans, and counts are ever logged -- never a full
 * projection, request body, secret, or signature. Best-effort: a failure
 * in the logging call itself (e.g. a throwing console shim in a test, or a
 * platform log-sink outage) must never propagate and must never affect
 * which producer is served (VCM-06 §XXI).
 */
import type { DifferenceSummary } from '@siteborne/vcm';

export type MetadataProjectionTelemetryMode = 'shadow_compare' | 'vcm_primary_compare';

export type MetadataProjectionFailureReason =
  | 'projector'
  | 'validation'
  | 'mismatch'
  | 'comparator'
  | 'legacy_reference'
  | 'both_producers'
  | 'signing'
  | 'handler_construction';

export type MetadataProjectionLifecycleEvent =
  | 'metadata_projection_primary_attempt_total'
  | 'metadata_projection_primary_success_total'
  | 'metadata_projection_primary_failure_total'
  | 'metadata_projection_legacy_reference_attempt_total'
  | 'metadata_projection_comparator_failure_total'
  | 'metadata_projection_validation_failure_total'
  | 'metadata_projection_fallback_total'
  | 'metadata_projection_signing_failure_total';

export interface MetadataProjectionComparisonEvent {
  readonly surface: 'a2a' | 'mcp';
  readonly differenceSummary: DifferenceSummary;
  readonly fellBackToLegacy: boolean;
  readonly mode?: MetadataProjectionTelemetryMode;
  readonly fallbackReason?: MetadataProjectionFailureReason;
}

export interface MetadataProjectionLifecycleRecord {
  readonly event: MetadataProjectionLifecycleEvent;
  readonly surface: 'a2a' | 'mcp';
  readonly mode: MetadataProjectionTelemetryMode;
  readonly reason?: MetadataProjectionFailureReason;
}

function safeLog(payload: Record<string, unknown>): void {
  try {
    console.error(JSON.stringify(payload));
  } catch {
    // Telemetry is best-effort and non-authoritative (VCM-06 §XXI):
    // a broken logging sink must never affect served metadata.
  }
}

export function recordMetadataProjectionComparison(event: MetadataProjectionComparisonEvent): void {
  const { surface, differenceSummary, fellBackToLegacy, mode, fallbackReason } = event;
  safeLog({ event: 'metadata_projection_compare_total', surface, ...(mode ? { mode } : {}) });

  const mismatchCount = differenceSummary.UNEXPLAINED_DIFFERENCE;
  if (mismatchCount === 0) {
    safeLog({ event: 'metadata_projection_match_total', surface, ...(mode ? { mode } : {}) });
  } else {
    safeLog({
      event: 'metadata_projection_mismatch_total',
      surface,
      domain: 'static_semantic',
      differenceCount: mismatchCount,
      ...(mode ? { mode } : {}),
    });
  }

  if (fellBackToLegacy) {
    safeLog({
      event: 'metadata_projection_fallback_total',
      surface,
      ...(mode ? { mode } : {}),
      ...(fallbackReason ? { reason: fallbackReason } : {}),
    });
  }
}

export function recordMetadataProjectionLifecycle(event: MetadataProjectionLifecycleRecord): void {
  safeLog({
    event: event.event,
    surface: event.surface,
    mode: event.mode,
    ...(event.reason ? { reason: event.reason } : {}),
  });
}
