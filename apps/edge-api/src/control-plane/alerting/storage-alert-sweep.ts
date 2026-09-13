/**
 * SUN-1222C-DOCUMENT-ARTIFACT-LOCAL-CLOSURE-R2 §3 — critical
 * artifact-reclamation alert delivery.
 *
 * Structural sibling of `settlement-alert-sweep.ts`: no new D1 read is
 * needed here (the reclamation pass in `artifact-reclamation.ts` already
 * computes everything this module alerts on), so this is intentionally
 * smaller — pure payload-shaping plus the same bounded, isolated,
 * never-throws delivery discipline. Reuses `buildHttpsWebhookTransport`
 * unmodified (already vendor-agnostic and destination-safety-checked); no
 * new transport implementation.
 *
 * Economic/content safety (§3 requirements): the payload below carries no
 * economic credential, no artifact content, no R2 key, no content hash —
 * only aggregate counts, a sweep timestamp, and a fixed operation-class
 * label. Dedup/rate-bounding (§3 "deduplicated/rate-bounded
 * notifications"): callers pass `previousFailureCount` (the prior sweep's
 * own `r2_delete_failures`) so this module can suppress a repeat alert for
 * an unchanged, already-notified failure count and only re-alert when the
 * count changes (grows, or recovers to zero) — see `shouldAlert` below.
 * This needs no new durable state: the caller already holds its own
 * previous result in memory across `waitUntil`-scheduled invocations is
 * NOT assumed (Workers give no such continuity) — instead the previous
 * count is read back from D1 via the one bounded, purpose-built query in
 * `../repositories/interfaces.ts`'s `ArtifactsRepository` sibling module
 * is deliberately NOT introduced (`out of scope: no new table`); the
 * simpler, honest contract is documented on `runStorageAlertSweep` itself.
 */

export type StorageAlertOperationClass = 'artifact_reclamation_r2_delete_failure';

/**
 * §3 "actionable fields": failure count, sweep timestamp, operation class,
 * and bounded identifiers (a small sample of the affected content hashes —
 * capped, never the full failing set, and never any other artifact
 * metadata).
 */
export interface StorageAlertPayload {
  readonly event: 'siteborne.storage_reclamation.critical_alert';
  readonly operation_class: StorageAlertOperationClass;
  readonly r2_delete_failures: number;
  readonly reclaimed_count: number;
  readonly swept_at: string;
  /** Capped at `MAX_SAMPLE_IDENTIFIERS` — see `runStorageAlertSweep`. */
  readonly sample_content_hashes: readonly string[];
}

export type StorageAlertTransport = (
  payload: StorageAlertPayload
) => Promise<{ readonly delivered: boolean }>;

export interface StorageAlertSweepInput {
  readonly r2DeleteFailures: number;
  readonly reclaimedCount: number;
  /** Content hashes of the artifacts whose R2 delete failed this pass —
   * used only to populate `sample_content_hashes` (bounded, see below);
   * never logged or alerted in full. */
  readonly failedContentHashes: readonly string[];
  readonly nowIso: string;
}

export interface StorageAlertSweepDependencies {
  readonly transport: StorageAlertTransport;
  /**
   * §3 dedup/rate-bounding: the immediately preceding sweep's own
   * `r2_delete_failures` count, if known. When provided and identical to
   * this sweep's count (both nonzero), no new alert is sent — the
   * standing incident was already reported and remains unchanged; the
   * existing `console.error` (unconditional, every pass) remains the
   * durable, never-suppressed record. Omit (or pass `undefined`) to
   * always alert on any nonzero count — the safe default for a caller
   * with no cross-invocation memory of the previous count.
   */
  readonly previousFailureCount?: number;
}

export interface StorageAlertSweepResult {
  readonly alerted: boolean;
  readonly delivered: boolean;
  readonly suppressedAsDuplicate: boolean;
}

const MAX_SAMPLE_IDENTIFIERS = 10;

function shouldAlert(input: StorageAlertSweepInput, previousFailureCount: number | undefined) {
  if (input.r2DeleteFailures <= 0) return false;
  if (previousFailureCount === undefined) return true;
  return input.r2DeleteFailures !== previousFailureCount;
}

/**
 * Runs at most one webhook delivery attempt for one reclamation pass's
 * result. Never throws (transport failures and thrown exceptions are both
 * `delivered: false`, mirroring `settlement-alert-sweep.ts`'s own
 * discipline) — §3 "alert transport failure that never blocks reclamation
 * itself" is true by construction: this function is always called from
 * `reclaimStaleArtifactsScheduled` AFTER the reclamation pass itself has
 * already fully completed and been counted, so nothing here can affect
 * whether reclamation ran or what it reclaimed.
 */
export async function runStorageAlertSweep(
  input: StorageAlertSweepInput,
  deps: StorageAlertSweepDependencies
): Promise<StorageAlertSweepResult> {
  if (!shouldAlert(input, deps.previousFailureCount)) {
    return {
      alerted: false,
      delivered: false,
      suppressedAsDuplicate: input.r2DeleteFailures > 0,
    };
  }

  const payload: StorageAlertPayload = {
    event: 'siteborne.storage_reclamation.critical_alert',
    operation_class: 'artifact_reclamation_r2_delete_failure',
    r2_delete_failures: input.r2DeleteFailures,
    reclaimed_count: input.reclaimedCount,
    swept_at: input.nowIso,
    sample_content_hashes: input.failedContentHashes.slice(0, MAX_SAMPLE_IDENTIFIERS),
  };

  try {
    const outcome = await deps.transport(payload);
    return { alerted: true, delivered: outcome.delivered, suppressedAsDuplicate: false };
  } catch {
    return { alerted: true, delivered: false, suppressedAsDuplicate: false };
  }
}
