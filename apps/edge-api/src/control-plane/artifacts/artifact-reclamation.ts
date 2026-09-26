/**
 * SUN-1222C0 — physical artifact reclamation.
 *
 * Closes the exact gap `document-upload.ts`'s own doc comment flagged as a
 * follow-up: `deleteExpired()` only ever removed the D1 metadata row,
 * never the underlying R2 object -- meaning even a wired-up cron would
 * have left every uploaded document's bytes in R2 forever. This module is
 * the actual two-store reclamation orchestration; wiring it to a live
 * Cron Trigger is explicitly OUT OF SCOPE for this checkpoint (SUN-1222C0
 * §9's own "Do NOT configure live Cron/R2 lifecycle here").
 *
 * Deliberately does NOT use `ArtifactRecord.expires_at` (the buyer-facing
 * "can a fresh paid request still be submitted against this upload"
 * gate, enforced separately and much more tightly -- 900s -- by
 * `resolveUploadReference` in the production executor). `job_id` is never
 * populated on a buyer-uploaded artifact's D1 row either (confirmed by
 * source trace: `storeDocumentUpload` never sets it, and the production
 * executor's `resolveUploadReference` only forwards `ctx.job_id` into the
 * in-memory input it hands to the service -- it never writes back to the
 * artifacts table), so there is no cheap "has this been consumed by an
 * in-flight job" signal to key off. Given that, this module uses a single
 * generous AGE-based retention window (`ARTIFACT_PHYSICAL_RECLAMATION_
 * AFTER_SECONDS`) applied uniformly to every artifact, deliberately much
 * longer than any real Workflow step's retry/settlement timescale in this
 * codebase (every `paid-continuation-workflow.ts` step either has a
 * bounded retry count or, for `settle`, explicitly zero retries) -- so an
 * artifact is never eligible for physical deletion while any real
 * in-flight processing could plausibly still need it, without requiring
 * new job-linkage machinery this checkpoint doesn't build.
 */
import type { ArtifactStore } from './store';
import type { ArtifactsRepository } from '../repositories/interfaces';

/** 24 hours -- a large, deliberately conservative multiple of both the
 * 900s buyer-facing upload TTL and of every real Workflow step's
 * retry/settlement timescale in this codebase. Not tuned for storage
 * cost (10MB-capped documents are cheap); tuned to make "an in-flight job
 * still needs this artifact when it gets reclaimed" implausible under
 * this system's actual, already-proven retry/timeout bounds. */
export const ARTIFACT_PHYSICAL_RECLAMATION_AFTER_SECONDS = 86_400;

export interface ArtifactReclamationDeps {
  artifactStore: ArtifactStore;
  artifactsRepository: ArtifactsRepository;
  /** Injected, never `Date.now()` directly -- same convention
   * `DocumentUploadDeps.nowIso` already uses, for deterministic tests. */
  nowIso: () => string;
}

/** Bound on `ArtifactReclamationResult.r2_delete_failure_content_hashes`
 * -- an alert payload sample, never the full failing set (SUN-1222C-
 * DOCUMENT-ARTIFACT-LOCAL-CLOSURE-R2 §3 "actionable... bounded
 * identifiers"). */
export const MAX_REPORTED_FAILURE_CONTENT_HASHES = 10;

export interface ArtifactReclamationResult {
  /** Both the R2 object and the D1 row were removed (or the R2 object was
   * already gone) for this many artifacts. */
  reclaimed: number;
  /** The R2 delete threw for this many artifacts -- their D1 rows are
   * deliberately left intact so the next reclamation pass retries them;
   * never counted as `reclaimed`. */
  r2_delete_failures: number;
  /** Content hashes of up to `MAX_REPORTED_FAILURE_CONTENT_HASHES` of the
   * artifacts counted in `r2_delete_failures` this pass -- bounded
   * identifiers for `storage-alert-sweep.ts`'s payload, never full row
   * metadata and never every failure (only a diagnostic sample). */
  r2_delete_failure_content_hashes: string[];
  /** R3-A3-ARTIFACT-RECLAIM-OWNERSHIP-34 — a D1 claim or final-delete call
   * failed for this many artifacts. Each such row is either still
   * unclaimed (retried next pass) or stays 'reclaiming' and is resumed next
   * pass; counted so it is never silently dropped. */
  metadata_failures: number;
}

/**
 * Reclaims every artifact whose `created_at` is older than
 * `ARTIFACT_PHYSICAL_RECLAMATION_AFTER_SECONDS`. Fully idempotent and
 * never throws: a listing failure, a missing R2 object, an R2 delete
 * throw, or an already-deleted D1 row are all handled without aborting
 * the batch or corrupting any other artifact's, job's, payment's, or
 * settlement's state (§10/§11 -- this function touches only
 * `job_artifacts` rows and their own R2 objects; it never reads or
 * writes payment/settlement/job-state tables at all, so there is
 * structurally nothing for it to corrupt there).
 *
 * Order matters: R2 delete is attempted BEFORE the D1 row is removed, so
 * a mid-batch crash (or a thrown R2 delete) never leaves a D1 row
 * pointing at bytes reclamation believes are already gone -- the row
 * simply survives to be retried on the next pass.
 */
export async function reclaimStaleArtifacts(
  deps: ArtifactReclamationDeps
): Promise<ArtifactReclamationResult> {
  const nowIso = deps.nowIso();
  const nowMs = Date.parse(nowIso);
  const cutoffIso = new Date(
    nowMs - ARTIFACT_PHYSICAL_RECLAMATION_AFTER_SECONDS * 1000
  ).toISOString();

  // SUN-1222C-DOCUMENT-ARTIFACT-LOCAL-CLOSURE-R2 §2: `nowIso` closes the
  // dedup-refresh reclamation-safety gap -- see `listReclaimable`'s own
  // doc comment in `../repositories/interfaces.ts`.
  const listed = await deps.artifactsRepository.listReclaimable(cutoffIso, nowIso);
  if (!listed.ok) {
    // Fail closed: a listing failure reclaims nothing this pass rather
    // than guessing at a partial/stale list. Never throws past this
    // function's own boundary.
    return {
      reclaimed: 0,
      r2_delete_failures: 0,
      r2_delete_failure_content_hashes: [],
      metadata_failures: 0,
    };
  }

  let reclaimed = 0;
  let r2DeleteFailures = 0;
  let metadataFailures = 0;
  const r2DeleteFailureContentHashes: string[] = [];

  for (const record of listed.value) {
    // R3-A3-ARTIFACT-RECLAIM-OWNERSHIP-34 (A3-CRON-GAP-1): the listed
    // snapshot is only a candidate. Deletion authority comes from an atomic
    // claim against CURRENT D1 state, so a dedup `refreshExpiry` landing
    // after listing makes the claim lose and the renewed artifact survives.
    // A row already 'reclaiming' was claimed by a pass that crashed or is
    // still running; resuming it is safe because a claimed row is never
    // renewed and its R2 object (`artifactObjectName`) is never reused by a
    // later row -- every row minted since migration 0013 owns its own key.
    if (record.reclaim_state !== 'reclaiming') {
      const claimed = await deps.artifactsRepository.claimForReclamation(
        record.id,
        cutoffIso,
        nowIso,
        nowIso
      );
      if (!claimed.ok) {
        metadataFailures += 1;
        continue;
      }
      if (!claimed.value) continue;
    }

    try {
      // Idempotent by construction (both `ArtifactStore` implementations'
      // own `deleteByContentHash` return `false`, never throw, when the
      // object is already gone) -- a missing object is a normal, expected
      // outcome here, not a failure.
      await deps.artifactStore.deleteForArtifact(record);
    } catch {
      // A genuine R2 outage/error. Leave the D1 row claimed -- the next
      // pass resumes both the R2 delete and the D1 delete together.
      r2DeleteFailures += 1;
      if (r2DeleteFailureContentHashes.length < MAX_REPORTED_FAILURE_CONTENT_HASHES) {
        r2DeleteFailureContentHashes.push(record.content_hash);
      }
      continue;
    }

    const deleted = await deps.artifactsRepository.deleteReclaimed(record.id);
    // `deleted.ok && deleted.value === false` means the D1 row was
    // already gone (a concurrent reclamation pass, or the row was
    // deleted some other way) -- not an error, just nothing new to
    // count. `!deleted.ok` (a genuine D1 failure) is likewise not
    // counted; the R2 object is already gone either way, so the next
    // pass's `listReclaimable` will still find this row (if it's still
    // there) and retry the (now-idempotent, already-a-no-op) R2 delete
    // harmlessly.
    if (deleted.ok && deleted.value) {
      reclaimed += 1;
    } else if (!deleted.ok) {
      metadataFailures += 1;
    }
  }

  return {
    reclaimed,
    r2_delete_failures: r2DeleteFailures,
    r2_delete_failure_content_hashes: r2DeleteFailureContentHashes,
    metadata_failures: metadataFailures,
  };
}
