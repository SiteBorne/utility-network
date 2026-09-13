/**
 * SUN-1222C-DOCUMENT-ARTIFACT-LOCAL-CLOSURE-R2 §3 — coverage for
 * `runStorageAlertSweep`: successful delivery, transport failure/thrown
 * exception, dedupe/rate-bounding of an unchanged failure count, and the
 * zero-failure no-alert case.
 */
import { describe, expect, it } from 'vitest';
import { runStorageAlertSweep, type StorageAlertPayload } from './storage-alert-sweep';

const NOW_ISO = '2026-09-13T00:00:00.000Z';

describe('runStorageAlertSweep', () => {
  it('sends no alert and reports not-suppressed when there are zero R2 delete failures', async () => {
    let called = false;
    const result = await runStorageAlertSweep(
      { r2DeleteFailures: 0, reclaimedCount: 5, failedContentHashes: [], nowIso: NOW_ISO },
      {
        transport: async () => {
          called = true;
          return { delivered: true };
        },
      }
    );
    expect(called).toBe(false);
    expect(result).toEqual({ alerted: false, delivered: false, suppressedAsDuplicate: false });
  });

  it('delivers exactly one alert with actionable, bounded, secret-free fields when failures are nonzero', async () => {
    let received: StorageAlertPayload | undefined;
    const result = await runStorageAlertSweep(
      {
        r2DeleteFailures: 3,
        reclaimedCount: 12,
        failedContentHashes: ['sha256:a', 'sha256:b', 'sha256:c'],
        nowIso: NOW_ISO,
      },
      {
        transport: async (payload) => {
          received = payload;
          return { delivered: true };
        },
      }
    );
    expect(result).toEqual({ alerted: true, delivered: true, suppressedAsDuplicate: false });
    expect(received).toEqual({
      event: 'siteborne.storage_reclamation.critical_alert',
      operation_class: 'artifact_reclamation_r2_delete_failure',
      r2_delete_failures: 3,
      reclaimed_count: 12,
      swept_at: NOW_ISO,
      sample_content_hashes: ['sha256:a', 'sha256:b', 'sha256:c'],
    });
    // No economic credential, no CDP/payment field, no full artifact
    // content anywhere in the payload.
    const serialized = JSON.stringify(received);
    expect(serialized).not.toMatch(/cdp|payment|secret|wallet/i);
  });

  it('caps sample_content_hashes at 10 even when far more artifacts failed', async () => {
    const many = Array.from({ length: 47 }, (_, i) => `sha256:${i}`);
    let received: StorageAlertPayload | undefined;
    await runStorageAlertSweep(
      { r2DeleteFailures: 47, reclaimedCount: 0, failedContentHashes: many, nowIso: NOW_ISO },
      { transport: async (payload) => ((received = payload), { delivered: true }) }
    );
    expect(received?.sample_content_hashes.length).toBe(10);
  });

  it('reports delivered:false, never throws, when the transport returns delivered:false', async () => {
    const result = await runStorageAlertSweep(
      { r2DeleteFailures: 1, reclaimedCount: 0, failedContentHashes: [], nowIso: NOW_ISO },
      { transport: async () => ({ delivered: false }) }
    );
    expect(result).toEqual({ alerted: true, delivered: false, suppressedAsDuplicate: false });
  });

  it('reports delivered:false, never throws, when the transport itself throws', async () => {
    const result = await runStorageAlertSweep(
      { r2DeleteFailures: 1, reclaimedCount: 0, failedContentHashes: [], nowIso: NOW_ISO },
      {
        transport: async () => {
          throw new Error('simulated network failure');
        },
      }
    );
    expect(result).toEqual({ alerted: true, delivered: false, suppressedAsDuplicate: false });
  });

  it('suppresses a repeat alert when the failure count is unchanged from the previous sweep (dedupe/rate-bounding)', async () => {
    let calls = 0;
    const result = await runStorageAlertSweep(
      { r2DeleteFailures: 5, reclaimedCount: 0, failedContentHashes: [], nowIso: NOW_ISO },
      {
        transport: async () => {
          calls += 1;
          return { delivered: true };
        },
        previousFailureCount: 5,
      }
    );
    expect(calls).toBe(0);
    expect(result).toEqual({ alerted: false, delivered: false, suppressedAsDuplicate: true });
  });

  it('re-alerts when the failure count changes from the previous sweep, growing or shrinking', async () => {
    const grew = await runStorageAlertSweep(
      { r2DeleteFailures: 8, reclaimedCount: 0, failedContentHashes: [], nowIso: NOW_ISO },
      { transport: async () => ({ delivered: true }), previousFailureCount: 5 }
    );
    expect(grew.alerted).toBe(true);

    const shrank = await runStorageAlertSweep(
      { r2DeleteFailures: 2, reclaimedCount: 0, failedContentHashes: [], nowIso: NOW_ISO },
      { transport: async () => ({ delivered: true }), previousFailureCount: 5 }
    );
    expect(shrank.alerted).toBe(true);
  });

  it('always alerts on any nonzero count when no previousFailureCount is supplied (safe default, never silently drops an incident)', async () => {
    let calls = 0;
    await runStorageAlertSweep(
      { r2DeleteFailures: 5, reclaimedCount: 0, failedContentHashes: [], nowIso: NOW_ISO },
      { transport: async () => ((calls += 1), { delivered: true }) }
    );
    await runStorageAlertSweep(
      { r2DeleteFailures: 5, reclaimedCount: 0, failedContentHashes: [], nowIso: NOW_ISO },
      { transport: async () => ((calls += 1), { delivered: true }) }
    );
    expect(calls).toBe(2);
  });
});
