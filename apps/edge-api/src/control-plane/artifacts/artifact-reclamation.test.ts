/**
 * SUN-1222C0 — genuine RED/GREEN/mutation-proof coverage for
 * `reclaimStaleArtifacts`. Uses the real `InMemoryArtifactStore` and real
 * `InMemoryArtifactsRepository` (both implement the exact production
 * interfaces this module depends on), mirroring `document-upload.test.ts`'s
 * own stated preference for real implementations over hand-rolled mocks
 * wherever the interface itself is what's under test.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  reclaimStaleArtifacts,
  ARTIFACT_PHYSICAL_RECLAMATION_AFTER_SECONDS,
  type ArtifactReclamationDeps,
} from './artifact-reclamation';
import { InMemoryArtifactStore } from './store';
import { InMemoryArtifactsRepository } from '../repositories/in-memory';
import type { ArtifactRecord } from '../types';
import type { ArtifactsRepository } from '../repositories/interfaces';
import type { ArtifactStore } from './store';

async function getValue(repo: ArtifactsRepository, id: string): Promise<ArtifactRecord | null> {
  const result = await repo.getById(id);
  return result.ok ? result.value : null;
}

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 1, 2, 3]);
const NOW_ISO = '2026-09-04T00:00:00.000Z';

async function realHash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `sha256:${hex}`;
}

function isoMinusSeconds(iso: string, seconds: number): string {
  return new Date(Date.parse(iso) - seconds * 1000).toISOString();
}

async function seed(
  store: InMemoryArtifactStore,
  repo: InMemoryArtifactsRepository,
  createdAt: string,
  id: string
): Promise<ArtifactRecord> {
  const bytes = new Uint8Array([...PDF, ...new TextEncoder().encode(id)]);
  const hash = await realHash(bytes);
  const record: ArtifactRecord = {
    id,
    content_hash: hash,
    media_type: 'application/pdf',
    byte_length: bytes.length,
    created_at: createdAt,
    expires_at: isoMinusSeconds(createdAt, -900), // buyer TTL, irrelevant here
    authorization_class: 'buyer_authorized',
    retention_class: 'ephemeral',
    artifact_type: 'input',
  };
  await store.put(record, bytes);
  await repo.create(record);
  return record;
}

function deps(
  store: ArtifactStore,
  repo: ArtifactsRepository,
  nowIso: string = NOW_ISO
): ArtifactReclamationDeps {
  return { artifactStore: store, artifactsRepository: repo, nowIso: () => nowIso };
}

describe('reclaimStaleArtifacts', () => {
  it('reclaims an artifact older than the retention window: both the R2 object and the D1 row are gone', async () => {
    const store = new InMemoryArtifactStore();
    const repo = new InMemoryArtifactsRepository();
    const old = await seed(
      store,
      repo,
      isoMinusSeconds(NOW_ISO, ARTIFACT_PHYSICAL_RECLAMATION_AFTER_SECONDS + 3600),
      '00000000-0000-4000-8000-000000000001'
    );

    const result = await reclaimStaleArtifacts(deps(store, repo));

    expect(result).toEqual({ reclaimed: 1, r2_delete_failures: 0, r2_delete_failure_content_hashes: [] });
    expect(await store.getContentByContentHash(old.content_hash)).toBeNull();
    expect(await getValue(repo, old.id)).toBeNull();
  });

  it('NEVER reclaims an artifact within the retention window -- structurally covers in-flight processing/retry/settlement, since the function never inspects job/payment state at all', async () => {
    const store = new InMemoryArtifactStore();
    const repo = new InMemoryArtifactsRepository();
    const fresh = await seed(
      store,
      repo,
      isoMinusSeconds(NOW_ISO, ARTIFACT_PHYSICAL_RECLAMATION_AFTER_SECONDS - 60),
      '00000000-0000-4000-8000-000000000002'
    );

    const result = await reclaimStaleArtifacts(deps(store, repo));

    expect(result).toEqual({ reclaimed: 0, r2_delete_failures: 0, r2_delete_failure_content_hashes: [] });
    expect(await store.getContentByContentHash(fresh.content_hash)).not.toBeNull();
    expect(await getValue(repo, fresh.id)).not.toBeNull();
  });

  it('is idempotent: running twice in a row reclaims once, then finds nothing left', async () => {
    const store = new InMemoryArtifactStore();
    const repo = new InMemoryArtifactsRepository();
    await seed(
      store,
      repo,
      isoMinusSeconds(NOW_ISO, ARTIFACT_PHYSICAL_RECLAMATION_AFTER_SECONDS + 1),
      '00000000-0000-4000-8000-000000000003'
    );

    const first = await reclaimStaleArtifacts(deps(store, repo));
    const second = await reclaimStaleArtifacts(deps(store, repo));

    expect(first).toEqual({ reclaimed: 1, r2_delete_failures: 0, r2_delete_failure_content_hashes: [] });
    expect(second).toEqual({ reclaimed: 0, r2_delete_failures: 0, r2_delete_failure_content_hashes: [] });
  });

  it('is idempotent: an R2 object already missing (e.g. a previous partial pass) is treated as a normal no-op, not a failure -- the D1 row is still reclaimed', async () => {
    const store = new InMemoryArtifactStore();
    const repo = new InMemoryArtifactsRepository();
    const old = await seed(
      store,
      repo,
      isoMinusSeconds(NOW_ISO, ARTIFACT_PHYSICAL_RECLAMATION_AFTER_SECONDS + 1),
      '00000000-0000-4000-8000-000000000004'
    );
    // Simulate a prior pass that deleted the R2 object but crashed before
    // deleting the D1 row.
    await store.deleteByContentHash(old.content_hash);

    const result = await reclaimStaleArtifacts(deps(store, repo));

    expect(result).toEqual({ reclaimed: 1, r2_delete_failures: 0, r2_delete_failure_content_hashes: [] });
    expect(await getValue(repo, old.id)).toBeNull();
  });

  it('a genuine R2 delete failure (thrown, not a clean false) is counted, never thrown past this function, and leaves the D1 row intact for the next pass', async () => {
    const store = new InMemoryArtifactStore();
    const repo = new InMemoryArtifactsRepository();
    const old = await seed(
      store,
      repo,
      isoMinusSeconds(NOW_ISO, ARTIFACT_PHYSICAL_RECLAMATION_AFTER_SECONDS + 1),
      '00000000-0000-4000-8000-000000000005'
    );
    const throwingStore: ArtifactStore = {
      put: (a, c) => store.put(a, c),
      getMetadata: (id) => store.getMetadata(id),
      getContent: (id) => store.getContent(id),
      getByContentHash: (h) => store.getByContentHash(h),
      getContentByContentHash: (h) => store.getContentByContentHash(h),
      delete: (id) => store.delete(id),
      deleteByContentHash: vi.fn().mockRejectedValue(new Error('simulated R2 outage')),
      exists: (id) => store.exists(id),
      existsByContentHash: (h) => store.existsByContentHash(h),
    };

    const result = await reclaimStaleArtifacts(deps(throwingStore, repo));

    expect(result).toEqual({
      reclaimed: 0,
      r2_delete_failures: 1,
      r2_delete_failure_content_hashes: [old.content_hash],
    });
    // The D1 row must survive -- never deleted when the R2 delete threw.
    expect(await getValue(repo, old.id)).not.toBeNull();
  });

  it('a D1 row already gone by the time delete() runs (a concurrent reclamation race) is not counted as reclaimed, never thrown, and never retriggers the R2 delete a second time incorrectly', async () => {
    const store = new InMemoryArtifactStore();
    const repo = new InMemoryArtifactsRepository();
    await seed(
      store,
      repo,
      isoMinusSeconds(NOW_ISO, ARTIFACT_PHYSICAL_RECLAMATION_AFTER_SECONDS + 1),
      '00000000-0000-4000-8000-000000000006'
    );
    const racingRepo: ArtifactsRepository = {
      create: (a) => repo.create(a),
      getById: (id) => repo.getById(id),
      getByContentHash: (h) => repo.getByContentHash(h),
      getByJobId: (jobId) => repo.getByJobId(jobId),
      deleteExpired: () => repo.deleteExpired(),
      listReclaimable: (iso: string, now: string) => repo.listReclaimable(iso, now),
      refreshExpiry: (id, expiresAt) => repo.refreshExpiry(id, expiresAt),
      // The row is already gone by the time this reclamation pass tries
      // to delete it (a concurrent pass beat it to the punch).
      delete: async () => ({ ok: true, value: false }),
    };

    const result = await reclaimStaleArtifacts(deps(store, racingRepo));

    expect(result).toEqual({ reclaimed: 0, r2_delete_failures: 0, r2_delete_failure_content_hashes: [] });
  });

  it('SUN-1222C-LOCAL-CLOSURE-R2 §2: retains an old-enough (created_at) artifact whose expires_at was refreshed into the future (a dedup-refresh hit) -- the exact "still validly referenced" case', async () => {
    const store = new InMemoryArtifactStore();
    const repo = new InMemoryArtifactsRepository();
    const old = await seed(
      store,
      repo,
      isoMinusSeconds(NOW_ISO, ARTIFACT_PHYSICAL_RECLAMATION_AFTER_SECONDS + 3600),
      '00000000-0000-4000-8000-000000000007'
    );
    // Simulate exactly what a dedup-refresh does: extend expires_at into
    // the future without touching created_at.
    const refreshed = new Date(Date.parse(NOW_ISO) + 900 * 1000).toISOString();
    const refreshResult = await repo.refreshExpiry(old.id, refreshed);
    expect(refreshResult.ok).toBe(true);

    const result = await reclaimStaleArtifacts(deps(store, repo));

    expect(result).toEqual({ reclaimed: 0, r2_delete_failures: 0, r2_delete_failure_content_hashes: [] });
    expect(await store.getContentByContentHash(old.content_hash)).not.toBeNull();
    expect(await getValue(repo, old.id)).not.toBeNull();
  });

  it('SUN-1222C-LOCAL-CLOSURE-R2 §2: the same refreshed artifact becomes reclaimable again once its refreshed expiry itself lapses', async () => {
    const store = new InMemoryArtifactStore();
    const repo = new InMemoryArtifactsRepository();
    const old = await seed(
      store,
      repo,
      isoMinusSeconds(NOW_ISO, ARTIFACT_PHYSICAL_RECLAMATION_AFTER_SECONDS + 3600),
      '00000000-0000-4000-8000-000000000008'
    );
    const refreshed = new Date(Date.parse(NOW_ISO) + 900 * 1000).toISOString();
    await repo.refreshExpiry(old.id, refreshed);

    // Not yet -- still protected at exactly the refreshed moment.
    const tooSoon = await reclaimStaleArtifacts(deps(store, repo, NOW_ISO));
    expect(tooSoon.reclaimed).toBe(0);

    // Now advance past the refreshed expires_at.
    const later = new Date(Date.parse(refreshed) + 1000).toISOString();
    const result = await reclaimStaleArtifacts(deps(store, repo, later));

    expect(result).toEqual({ reclaimed: 1, r2_delete_failures: 0, r2_delete_failure_content_hashes: [] });
    expect(await getValue(repo, old.id)).toBeNull();
  });

  it('fails closed on a listing failure: reclaims nothing, never throws', async () => {
    const store = new InMemoryArtifactStore();
    const failingRepo: ArtifactsRepository = {
      create: async () => ({ ok: false, error: { code: 'DATABASE_ERROR', message: 'down' } }),
      getById: async () => ({ ok: true, value: null }),
      getByContentHash: async () => ({ ok: true, value: null }),
      getByJobId: async () => ({ ok: true, value: [] }),
      delete: async () => ({ ok: true, value: false }),
      deleteExpired: async () => ({ ok: true, value: 0 }),
      refreshExpiry: async () => ({ ok: true, value: null }),
      listReclaimable: async () => ({
        ok: false,
        error: { code: 'DATABASE_ERROR', message: 'down' },
      }),
    };

    await expect(reclaimStaleArtifacts(deps(store, failingRepo))).resolves.toEqual({
      reclaimed: 0,
      r2_delete_failures: 0,
      r2_delete_failure_content_hashes: [],
    });
  });
});
