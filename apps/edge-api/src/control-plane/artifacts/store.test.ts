/**
 * SUN-1222C0 — first dedicated coverage for `store.ts`. Scoped narrowly to
 * `deleteByContentHash` (the new method this checkpoint adds for physical
 * artifact reclamation) rather than retroactively covering the whole file
 * -- `InMemoryArtifactStore`/`R2ArtifactStoreAdapter`'s other methods are
 * already exercised indirectly, extensively, by `document-upload.test.ts`
 * and the production executor's own test suite. Flagged as a known,
 * pre-existing gap in the SUN-1222C0 evidence report, not silently
 * expanded here.
 *
 * `R2ArtifactStoreAdapter` is tested against a minimal, hand-rolled
 * `R2Bucket` double (head/get/put/delete only -- the only methods this
 * adapter ever calls) rather than Miniflare, mirroring the lightweight-
 * fake convention this repo already uses elsewhere for narrow unit tests.
 */
import { describe, expect, it } from 'vitest';
import { InMemoryArtifactStore, R2ArtifactStoreAdapter } from './store';
import type { ArtifactRecord } from '../types';

const REAL_PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

async function realHash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `sha256:${hex}`;
}

function fakeRecord(contentHash: string): ArtifactRecord {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    content_hash: contentHash,
    media_type: 'application/pdf',
    byte_length: REAL_PDF.length,
    created_at: '2026-09-01T00:00:00.000Z',
    authorization_class: 'buyer_authorized',
    retention_class: 'ephemeral',
    artifact_type: 'input',
  };
}

/** Minimal in-memory double for the exact three R2Bucket methods
 * `R2ArtifactStoreAdapter` ever calls (`head`/`get`/`put`/`delete`) --
 * never a full Miniflare R2 simulation, which this narrow unit test
 * doesn't need. */
class FakeR2Bucket {
  private objects = new Map<string, { body: Uint8Array; customMetadata: Record<string, string> }>();

  async put(key: string, value: Uint8Array, opts?: { customMetadata?: Record<string, string> }) {
    this.objects.set(key, { body: value, customMetadata: opts?.customMetadata ?? {} });
  }

  async head(key: string) {
    return this.objects.has(key) ? { key } : null;
  }

  async get(key: string) {
    const obj = this.objects.get(key);
    if (!obj) return null;
    return { arrayBuffer: async () => obj.body.buffer };
  }

  async delete(key: string) {
    this.objects.delete(key);
  }
}

describe('InMemoryArtifactStore.deleteByContentHash', () => {
  it('deletes a stored artifact by content hash and makes it unreachable by id or hash', async () => {
    const store = new InMemoryArtifactStore();
    const hash = await realHash(REAL_PDF);
    const record = fakeRecord(hash);
    await store.put(record, REAL_PDF);

    const deleted = await store.deleteByContentHash(hash);

    expect(deleted).toBe(true);
    expect(await store.getContentByContentHash(hash)).toBeNull();
    expect(await store.getContent(record.id)).toBeNull();
  });

  it('is idempotent: deleting a content hash that was never stored returns false, never throws', async () => {
    const store = new InMemoryArtifactStore();
    await expect(store.deleteByContentHash('sha256:' + '0'.repeat(64))).resolves.toBe(false);
  });

  it('is idempotent: deleting the same content hash twice returns false the second time', async () => {
    const store = new InMemoryArtifactStore();
    const hash = await realHash(REAL_PDF);
    await store.put(fakeRecord(hash), REAL_PDF);

    expect(await store.deleteByContentHash(hash)).toBe(true);
    expect(await store.deleteByContentHash(hash)).toBe(false);
  });
});

describe('R2ArtifactStoreAdapter.deleteByContentHash', () => {
  it('deletes the real R2 object at the content-hash-derived key', async () => {
    const bucket = new FakeR2Bucket();
    const store = new R2ArtifactStoreAdapter(bucket as never);
    const hash = await realHash(REAL_PDF);
    await store.put(fakeRecord(hash), REAL_PDF);

    expect(await store.existsByContentHash(hash)).toBe(true);
    const deleted = await store.deleteByContentHash(hash);
    expect(deleted).toBe(true);
    expect(await store.existsByContentHash(hash)).toBe(false);
  });

  it('is idempotent: deleting a content hash with no backing R2 object returns false, never throws', async () => {
    const bucket = new FakeR2Bucket();
    const store = new R2ArtifactStoreAdapter(bucket as never);
    await expect(store.deleteByContentHash('sha256:' + '1'.repeat(64))).resolves.toBe(false);
  });
});
