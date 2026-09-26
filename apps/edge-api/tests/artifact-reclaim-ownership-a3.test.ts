/**
 * R3-A3-ARTIFACT-RECLAIM-OWNERSHIP-34 — closes A3-CRON-GAP-1.
 *
 * Real Miniflare D1 (migrations applied, including 0013) + real Miniflare
 * R2 behind the production `R2ArtifactStoreAdapter`. Proves:
 *   - a listed snapshot never authorizes deletion; only an atomic claim
 *     against current D1 state does;
 *   - a claimed ('reclaiming') row is never renewed or handed out again;
 *   - a crashed claim is resumed by the next sweep (no TTL reopens it);
 *   - a stale reclaimer finishing late can never delete bytes of a later
 *     row with the same content hash (per-row `storage_key`).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import {
  setupMiniflareD1R2,
  teardownMiniflareD1R2,
  type MiniflareD1R2Harness,
} from './support/v3-rest-harness-support';
import {
  ARTIFACT_PHYSICAL_RECLAMATION_AFTER_SECONDS,
  reclaimStaleArtifacts,
} from '../src/control-plane/artifacts/artifact-reclamation';
import { storeDocumentUpload } from '../src/control-plane/artifacts/document-upload';
import {
  R2ArtifactStoreAdapter,
  DOCUMENT_ARTIFACT_KEY_PREFIX,
  computeHash,
} from '../src/control-plane/artifacts/store';
import { D1ArtifactsRepository } from '../src/control-plane/repositories/d1/artifacts';
import type { ArtifactsRepository } from '../src/control-plane/repositories/interfaces';
import type { ArtifactRecord } from '../src/control-plane/types';

const SEEDED_AT = '2026-09-01T00:00:00.000Z';
const NOW_ISO = '2026-09-04T00:00:00.000Z';
const CUTOFF_ISO = new Date(
  Date.parse(NOW_ISO) - ARTIFACT_PHYSICAL_RECLAMATION_AFTER_SECONDS * 1000
).toISOString();
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34];

let harness: MiniflareD1R2Harness;
let db: D1Database;
let r2: R2Bucket;
let repo: D1ArtifactsRepository;
let store: R2ArtifactStoreAdapter;

beforeAll(async () => {
  harness = await setupMiniflareD1R2('siteborne-a3-reclaim-ownership-');
  db = harness.db as unknown as D1Database;
  r2 = harness.r2 as unknown as R2Bucket;
  repo = new D1ArtifactsRepository(harness.db);
  store = new R2ArtifactStoreAdapter(harness.r2, DOCUMENT_ARTIFACT_KEY_PREFIX);
}, 30_000);

afterAll(async () => {
  await teardownMiniflareD1R2(harness);
});

function pdf(label: string): Uint8Array {
  return new Uint8Array([...PDF_MAGIC, ...new TextEncoder().encode(label)]);
}

function upload(
  bytes: Uint8Array,
  nowIso: string,
  artifactsRepository: ArtifactsRepository = repo
) {
  return storeDocumentUpload(bytes, 'application/pdf', {
    artifactStore: store,
    artifactsRepository,
    randomId: () => crypto.randomUUID(),
    nowIso: () => nowIso,
    hash: computeHash,
  });
}

/** Seeds a real, new-style upload that is already stale by `NOW_ISO`. */
async function seedStale(label: string): Promise<{ bytes: Uint8Array; record: ArtifactRecord }> {
  const bytes = pdf(label);
  const res = await upload(bytes, SEEDED_AT);
  if (!res.ok) throw new Error(`seed failed: ${res.code}`);
  return { bytes, record: (await row(res.upload_id))! };
}

/** Seeds a pre-migration-0013 row: no storage_key, bytes at the shared
 * content-hash key. */
async function seedLegacyStale(
  label: string
): Promise<{ bytes: Uint8Array; record: ArtifactRecord }> {
  const bytes = pdf(label);
  const record: ArtifactRecord = {
    id: crypto.randomUUID(),
    content_hash: await computeHash(bytes),
    media_type: 'application/pdf',
    byte_length: bytes.length,
    created_at: SEEDED_AT,
    expires_at: '2026-09-01T00:15:00.000Z',
    authorization_class: 'buyer_authorized',
    retention_class: 'ephemeral',
    artifact_type: 'input',
  };
  await store.put(record, bytes);
  const created = await repo.create(record);
  if (!created.ok) throw new Error('legacy seed failed');
  return { bytes, record };
}

async function row(id: string): Promise<ArtifactRecord | null> {
  const r = await repo.getById(id);
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

/** Mirrors `resolveUploadReference`'s gates: row present, not reclaiming,
 * not expired, bytes present at the row's own object. */
async function usable(id: string, nowIso: string): Promise<boolean> {
  const record = await row(id);
  if (!record || record.reclaim_state) return false;
  if (record.expires_at && Date.parse(record.expires_at) <= Date.parse(nowIso)) return false;
  return (await store.getContentForArtifact(record)) !== null;
}

function sweep(artifactsRepository: ArtifactsRepository = repo, nowIso = NOW_ISO) {
  return reclaimStaleArtifacts({ artifactStore: store, artifactsRepository, nowIso: () => nowIso });
}

/** Repository whose methods delegate to the real D1 repo, with overrides. */
function withOverrides(overrides: Partial<ArtifactsRepository>): ArtifactsRepository {
  return Object.assign(Object.create(repo) as ArtifactsRepository, overrides);
}

describe('A3-CRON-GAP-1: reclaim ownership (real D1 + real R2)', () => {
  it('1. refresh before listing: the renewed artifact is not a candidate and survives', async () => {
    const { bytes, record } = await seedStale('refresh-before-list');
    const renewed = await upload(bytes, NOW_ISO);
    expect(renewed.ok && renewed.upload_id).toBe(record.id);

    const result = await sweep();

    expect(result.reclaimed).toBe(0);
    expect(await usable(record.id, NOW_ISO)).toBe(true);
  });

  it('2. refresh between listing and claim: the claim CAS loses and the renewed upload stays usable (former it.fails regression)', async () => {
    const { bytes, record } = await seedStale('refresh-between-list-and-claim');
    let renewedId: string | undefined;
    const racing = withOverrides({
      listReclaimable: async (olderThan, now) => {
        const listed = await repo.listReclaimable(olderThan, now);
        const renewed = await upload(bytes, NOW_ISO);
        renewedId = renewed.ok ? renewed.upload_id : undefined;
        return listed;
      },
    });

    const result = await sweep(racing);

    expect(renewedId).toBe(record.id);
    expect(result).toMatchObject({ reclaimed: 0, r2_delete_failures: 0, metadata_failures: 0 });
    expect((await row(record.id))?.reclaim_state).toBeUndefined();
    expect(await usable(record.id, NOW_ISO)).toBe(true);
  });

  it('3. refresh after a successful claim cannot return a usable live artifact', async () => {
    const { bytes, record } = await seedStale('refresh-after-claim');
    let duringClaim: Awaited<ReturnType<typeof upload>> | undefined;
    let refreshDuringClaim: unknown;
    const claimingThenRacing = withOverrides({
      claimForReclamation: async (id, olderThan, now, at) => {
        const claimed = await repo.claimForReclamation(id, olderThan, now, at);
        if (id === record.id) {
          duringClaim = await upload(bytes, NOW_ISO);
          refreshDuringClaim = await repo.refreshExpiry(id, '2026-09-04T00:15:00.000Z');
        }
        return claimed;
      },
    });

    const result = await sweep(claimingThenRacing);

    expect(duringClaim).toMatchObject({
      ok: false,
      code: 'expired_dedupe_refresh_failed',
      retryable: true,
    });
    expect(refreshDuringClaim).toEqual({ ok: true, value: null });
    expect(result.reclaimed).toBeGreaterThanOrEqual(1);
    expect(await row(record.id)).toBeNull();
    expect(await store.getContentForArtifact(record)).toBeNull();
  });

  it('4. a stale listing snapshot cannot delete a row that was renewed after the snapshot', async () => {
    const { bytes, record } = await seedStale('stale-snapshot');
    const renewed = await upload(bytes, NOW_ISO);
    expect(renewed.ok).toBe(true);
    // Snapshot taken before the renewal (expired expires_at) replayed by a
    // late sweep.
    const stale = withOverrides({ listReclaimable: async () => ({ ok: true, value: [record] }) });

    const result = await sweep(stale);

    expect(result.reclaimed).toBe(0);
    expect(await usable(record.id, NOW_ISO)).toBe(true);
  });

  it('5. two reclaimers: at most one acquires initial reclaim authority, and the artifact is reclaimed exactly once', async () => {
    const a = await seedStale('two-claimers');
    const claims = await Promise.all([
      repo.claimForReclamation(a.record.id, CUTOFF_ISO, NOW_ISO, NOW_ISO),
      repo.claimForReclamation(a.record.id, CUTOFF_ISO, NOW_ISO, NOW_ISO),
    ]);
    expect(claims.filter((c) => c.ok && c.value)).toHaveLength(1);

    const b = await seedStale('two-sweeps');
    const [x, y] = await Promise.all([sweep(), sweep()]);
    expect(await row(b.record.id)).toBeNull();
    expect(await store.getContentForArtifact(b.record)).toBeNull();
    expect(x.r2_delete_failures + y.r2_delete_failures).toBe(0);
    expect(x.metadata_failures + y.metadata_failures).toBe(0);
  });

  it('6. a duplicate R2 delete is harmless', async () => {
    const { record } = await seedStale('dup-r2-delete');
    expect(await store.deleteForArtifact(record)).toBe(true);
    expect(await store.deleteForArtifact(record)).toBe(false);
  });

  it('7. crash after claim, before R2 delete: the row stays fenced (no auto-expiry) and a later sweep resumes it', async () => {
    const { bytes, record } = await seedStale('crash-after-claim');
    expect(await repo.claimForReclamation(record.id, CUTOFF_ISO, NOW_ISO, NOW_ISO)).toEqual({
      ok: true,
      value: true,
    });
    // "Crash": nothing else happens. Much later, the claim has not expired.
    const muchLater = '2026-12-01T00:00:00.000Z';
    expect((await upload(bytes, muchLater)).ok).toBe(false);
    expect(await repo.refreshExpiry(record.id, '2026-12-01T00:15:00.000Z')).toEqual({
      ok: true,
      value: null,
    });
    expect((await row(record.id))?.reclaim_state).toBe('reclaiming');

    const result = await sweep(repo, muchLater);

    expect(result.reclaimed).toBeGreaterThanOrEqual(1);
    expect(await row(record.id)).toBeNull();
    expect(await store.getContentForArtifact(record)).toBeNull();
    // After reclamation completes, an identical upload mints a fresh, usable row.
    const fresh = await upload(bytes, muchLater);
    expect(fresh.ok && fresh.upload_id).not.toBe(record.id);
    expect(fresh.ok && (await usable(fresh.upload_id, muchLater))).toBe(true);
  });

  it('8. crash after R2 delete, before D1 delete: a later sweep completes the reclamation', async () => {
    const { record } = await seedStale('crash-after-r2-delete');
    await repo.claimForReclamation(record.id, CUTOFF_ISO, NOW_ISO, NOW_ISO);
    await store.deleteForArtifact(record);

    const result = await sweep();

    expect(result.r2_delete_failures).toBe(0);
    expect(await row(record.id)).toBeNull();
    expect(await repo.deleteReclaimed(record.id)).toEqual({ ok: true, value: false });
  });

  it('9 + 12. a stale reclaimer finishing late cannot delete bytes of a later row with the same content hash (new-style and legacy rows)', async () => {
    for (const seed of [
      () => seedStale('shared-key-new'),
      () => seedLegacyStale('shared-key-legacy'),
    ]) {
      const { bytes, record } = await seed();
      // Reclaimer A claims and then stalls. Reclaimer B resumes and finishes.
      await repo.claimForReclamation(record.id, CUTOFF_ISO, NOW_ISO, NOW_ISO);
      // Identical upload while RECLAIMING never becomes a live reference.
      expect(await upload(bytes, NOW_ISO)).toMatchObject({ ok: false, retryable: true });
      await sweep();
      expect(await row(record.id)).toBeNull();

      // A new upload of identical content becomes live under its own key.
      const fresh = await upload(bytes, NOW_ISO);
      if (!fresh.ok) throw new Error(fresh.code);
      const freshRecord = (await row(fresh.upload_id))!;
      expect(freshRecord.content_hash).toBe(record.content_hash);
      expect(freshRecord.storage_key).toBeDefined();
      expect(freshRecord.storage_key).not.toBe(record.storage_key);

      // Stale A now performs its delayed R2 delete + CAS D1 delete.
      await store.deleteForArtifact(record);
      await repo.deleteReclaimed(record.id);

      expect(await usable(fresh.upload_id, NOW_ISO)).toBe(true);
    }
  });

  it('10. an unrelated content hash is unaffected by another artifact being reclaimed', async () => {
    const stale = await seedStale('unrelated-stale');
    const live = await upload(pdf('unrelated-live'), '2026-09-03T23:59:00.000Z');
    if (!live.ok) throw new Error(live.code);

    await sweep();

    expect(await row(stale.record.id)).toBeNull();
    expect(await usable(live.upload_id, NOW_ISO)).toBe(true);
  });

  it('11. an active (non-expired) or too-young artifact is never claimable', async () => {
    const { bytes, record } = await seedStale('never-claimable');
    await upload(bytes, NOW_ISO); // renews expires_at into the future
    expect(await repo.claimForReclamation(record.id, CUTOFF_ISO, NOW_ISO, NOW_ISO)).toEqual({
      ok: true,
      value: false,
    });

    const young = await upload(pdf('too-young'), '2026-09-03T12:00:00.000Z');
    if (!young.ok) throw new Error(young.code);
    // Expired for the buyer, but inside the 24h physical retention window.
    expect(await repo.claimForReclamation(young.upload_id, CUTOFF_ISO, NOW_ISO, NOW_ISO)).toEqual({
      ok: true,
      value: false,
    });
    expect((await row(young.upload_id))?.reclaim_state).toBeUndefined();
  });

  it('a repeated R2 failure keeps the row fenced in RECLAIMING and is reported every pass (stuck reclaim observable)', async () => {
    const { bytes, record } = await seedStale('stuck-r2');
    const failing = Object.assign(Object.create(store) as R2ArtifactStoreAdapter, {
      deleteForArtifact: async () => {
        throw new Error('simulated R2 outage');
      },
    });
    for (let pass = 0; pass < 2; pass++) {
      const result = await reclaimStaleArtifacts({
        artifactStore: failing,
        artifactsRepository: repo,
        nowIso: () => NOW_ISO,
      });
      expect(result.r2_delete_failures).toBeGreaterThanOrEqual(1);
      expect(result.r2_delete_failure_content_hashes).toContain(record.content_hash);
    }
    expect((await row(record.id))?.reclaim_state).toBe('reclaiming');
    expect((await upload(bytes, NOW_ISO)).ok).toBe(false);

    // Clears once R2 recovers.
    await sweep();
    expect(await row(record.id)).toBeNull();
  });

  it('migration 0013 is additive: pre-existing rows default to live (NULL reclaim_state) and legacy shared keys', async () => {
    const { record } = await seedLegacyStale('legacy-defaults');
    const raw = await db
      .prepare(
        'SELECT reclaim_state, reclaim_claimed_at, storage_key FROM job_artifacts WHERE id = ?'
      )
      .bind(record.id)
      .first();
    expect(raw).toEqual({ reclaim_state: null, reclaim_claimed_at: null, storage_key: null });
    expect(
      await r2.head(`${DOCUMENT_ARTIFACT_KEY_PREFIX}${record.content_hash.slice(7)}`)
    ).not.toBeNull();
  });
});
