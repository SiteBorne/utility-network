/**
 * SUN-1222B-S3-R2 — adversarial security matrix for the buyer-facing
 * document upload path (`storeDocumentUpload`/`sniffMediaType`/
 * `readBoundedBody`). Uses the REAL `InMemoryArtifactStore` and REAL
 * `InMemoryArtifactsRepository` (both already implement the exact
 * production interfaces this module depends on) rather than hand-rolled
 * mocks, mirroring this repo's own stated preference (see
 * `document-evidence-json-v2-cdp-composition.test.ts`'s doc comment) for
 * real implementations standing in for real bindings wherever the
 * interface itself is what's under test.
 *
 * Covers, per the SUN-1222B-S3-R2 spec's own security requirements:
 *   - path traversal / buyer-controlled object keys (§9)
 *   - oversized content, both declared-length and streamed (§12)
 *   - magic-byte / declared-Content-Type mismatch (malformed content, §15)
 *   - unsupported media types
 *   - empty body
 *   - content-hash dedup (idempotent re-upload)
 *   - concurrent-identical-content race handling (DUPLICATE_ARTIFACT)
 *   - storage_failure propagation without ever throwing past the boundary
 *   - retention/TTL fields are always populated on the returned record
 */
import { describe, expect, it } from 'vitest';
import {
  storeDocumentUpload,
  sniffMediaType,
  isAllowedMediaType,
  readBoundedBody,
  DOCUMENT_UPLOAD_MAX_BYTES,
  DOCUMENT_UPLOAD_TTL_SECONDS,
  type DocumentUploadDeps,
} from './document-upload';
import { InMemoryArtifactStore } from './store';
import { InMemoryArtifactsRepository } from '../repositories/in-memory';
import type { ArtifactsRepository } from '../repositories/interfaces';

const REAL_PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // "%PDF-1.4"
const REAL_PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0]);
const REAL_JPEG_MAGIC = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);

function pdfBytes(extra = 'sun-1222b-s3-r2 test fixture'): Uint8Array {
  const body = new TextEncoder().encode(extra);
  const out = new Uint8Array(REAL_PDF_MAGIC.length + body.length);
  out.set(REAL_PDF_MAGIC, 0);
  out.set(body, REAL_PDF_MAGIC.length);
  return out;
}

async function realHash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `sha256:${hex}`;
}

let uuidCounter = 0;
function freshDeps(overrides: Partial<DocumentUploadDeps> = {}): DocumentUploadDeps & {
  __repo: InMemoryArtifactsRepository;
  __store: InMemoryArtifactStore;
} {
  const store = new InMemoryArtifactStore();
  const repo = new InMemoryArtifactsRepository();
  uuidCounter += 1;
  const id = `00000000-0000-4000-8000-${String(uuidCounter).padStart(12, '0')}`;
  return {
    artifactStore: store,
    artifactsRepository: repo,
    randomId: () => id,
    nowIso: () => '2026-09-01T00:00:00.000Z',
    hash: realHash,
    __repo: repo,
    __store: store,
    ...overrides,
  };
}

describe('sniffMediaType / isAllowedMediaType', () => {
  it('recognizes real PDF, PNG, and JPEG magic bytes', () => {
    expect(sniffMediaType(pdfBytes())).toBe('application/pdf');
    expect(sniffMediaType(REAL_PNG_MAGIC)).toBe('image/png');
    expect(sniffMediaType(REAL_JPEG_MAGIC)).toBe('image/jpeg');
  });

  it('returns null for unrecognized bytes, including near-miss signatures', () => {
    expect(sniffMediaType(new TextEncoder().encode('not a document at all'))).toBeNull();
    // One byte off from the real PDF magic -- must not be sniffed as a match.
    expect(sniffMediaType(new Uint8Array([0x25, 0x50, 0x44, 0x45, 0x2d]))).toBeNull();
    expect(sniffMediaType(new Uint8Array(0))).toBeNull();
  });

  it('isAllowedMediaType accepts only the exact three frozen strings', () => {
    expect(isAllowedMediaType('application/pdf')).toBe(true);
    expect(isAllowedMediaType('image/png')).toBe(true);
    expect(isAllowedMediaType('image/jpeg')).toBe(true);
    expect(isAllowedMediaType('application/pdf ')).toBe(false);
    expect(isAllowedMediaType('APPLICATION/PDF')).toBe(false);
    expect(isAllowedMediaType('text/html')).toBe(false);
    expect(isAllowedMediaType('')).toBe(false);
  });
});

describe('readBoundedBody', () => {
  function streamOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
    let i = 0;
    return new ReadableStream({
      pull(controller) {
        if (i < chunks.length) {
          controller.enqueue(chunks[i]);
          i += 1;
        } else {
          controller.close();
        }
      },
    });
  }

  it('returns all bytes and exceeded:false for a body within the limit', async () => {
    const chunk = new Uint8Array([1, 2, 3, 4, 5]);
    const { bytes, exceeded } = await readBoundedBody(streamOf(chunk), 100);
    expect(exceeded).toBe(false);
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4, 5]);
  });

  it('stops reading and reports exceeded:true the instant the limit is crossed, never buffering unbounded past it', async () => {
    // An infinite producer of 40-byte chunks against a 50-byte limit --
    // readBoundedBody must stop and cancel the reader after the second
    // chunk crosses the limit, never draining the (endless) rest.
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(40));
      },
      cancel() {
        // Reader was cancelled -- exactly the early-exit behavior required.
      },
    });
    const { exceeded, bytes } = await readBoundedBody(stream, 50);
    expect(exceeded).toBe(true);
    // Never returns more than limit+1 bytes even though far more was
    // available upstream.
    expect(bytes.length).toBeLessThanOrEqual(51);
  });

  it('returns an empty, non-exceeded result for a null body', async () => {
    const { bytes, exceeded } = await readBoundedBody(null, 100);
    expect(exceeded).toBe(false);
    expect(bytes.length).toBe(0);
  });
});

describe('storeDocumentUpload — adversarial matrix', () => {
  it('rejects an unsupported/missing declared Content-Type before ever hashing or sniffing', async () => {
    const deps = freshDeps();
    const result = await storeDocumentUpload(pdfBytes(), 'application/zip', deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('unsupported_media_type');
  });

  it('rejects a missing Content-Type header the same way as an unsupported one', async () => {
    const deps = freshDeps();
    const result = await storeDocumentUpload(pdfBytes(), undefined, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('unsupported_media_type');
  });

  it('rejects an empty (0-byte) body', async () => {
    const deps = freshDeps();
    const result = await storeDocumentUpload(new Uint8Array(0), 'application/pdf', deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('empty_body');
  });

  it('rejects a body over DOCUMENT_UPLOAD_MAX_BYTES even if it happens to start with a valid PDF signature', async () => {
    const deps = freshDeps();
    const oversized = new Uint8Array(DOCUMENT_UPLOAD_MAX_BYTES + 1);
    oversized.set(REAL_PDF_MAGIC, 0);
    const result = await storeDocumentUpload(oversized, 'application/pdf', deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('byte_limit_exceeded');
      expect(result.declaredOrObservedBytes).toBe(DOCUMENT_UPLOAD_MAX_BYTES + 1);
    }
  });

  it('rejects declared Content-Type "application/pdf" for bytes that are actually a PNG (magic-byte / declared-type disagreement)', async () => {
    const deps = freshDeps();
    const result = await storeDocumentUpload(REAL_PNG_MAGIC, 'application/pdf', deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('media_type_mismatch');
  });

  it('rejects declared Content-Type "application/pdf" for garbage bytes with no recognizable signature at all (malformed content)', async () => {
    const deps = freshDeps();
    const garbage = new TextEncoder().encode('this is definitely not a real PDF');
    const result = await storeDocumentUpload(garbage, 'application/pdf', deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('media_type_mismatch');
      expect(result.message).toMatch(/unrecognized/);
    }
  });

  it('accepts a genuine PDF and NEVER lets buyer input become the R2 key or D1 row id (§9) -- id is always deps.randomId(), never derived from the request', async () => {
    const deps = freshDeps({ randomId: () => 'fixed-server-id-not-buyer-controlled' });
    const bytes = pdfBytes();
    const result = await storeDocumentUpload(bytes, 'application/pdf', deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.upload_id).toBe('fixed-server-id-not-buyer-controlled');
      expect(result.media_type).toBe('application/pdf');
      expect(result.size_bytes).toBe(bytes.length);
      expect(result.content_hash).toBe(await realHash(bytes));
      // The stored record is retrievable ONLY via the server-issued id /
      // server-computed content hash -- never via anything the buyer sent
      // in the request body (there was no id in the request at all).
      const fetched = await deps.__store.getContent('fixed-server-id-not-buyer-controlled');
      expect(fetched).not.toBeNull();
      expect(Array.from(fetched!)).toEqual(Array.from(bytes));
    }
  });

  it('sets authorization_class:buyer_authorized, retention_class:ephemeral, artifact_type:input, and a real expires_at exactly TTL seconds after nowIso -- never a bare/immortal record', async () => {
    const deps = freshDeps();
    const bytes = pdfBytes();
    const result = await storeDocumentUpload(bytes, 'application/pdf', deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const expectedExpiry = new Date(
        new Date(deps.nowIso()).getTime() + DOCUMENT_UPLOAD_TTL_SECONDS * 1000
      ).toISOString();
      expect(result.expires_at).toBe(expectedExpiry);
      const metadata = await deps.__store.getMetadata(result.upload_id);
      expect(metadata?.authorization_class).toBe('buyer_authorized');
      expect(metadata?.retention_class).toBe('ephemeral');
      expect(metadata?.artifact_type).toBe('input');
    }
  });

  it('deduplicates by content hash: a second upload of byte-identical content reuses the FIRST upload_id rather than minting a new one', async () => {
    const deps = freshDeps({ randomId: () => 'first-id' });
    const bytes = pdfBytes('identical content for dedup test');
    const first = await storeDocumentUpload(bytes, 'application/pdf', deps);
    expect(first.ok).toBe(true);

    const secondDeps = freshDeps({
      artifactStore: deps.artifactStore,
      artifactsRepository: deps.artifactsRepository,
      randomId: () => 'second-id-should-never-be-used',
    });
    const second = await storeDocumentUpload(bytes, 'application/pdf', secondDeps);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.upload_id).toBe(first.upload_id);
      expect(second.upload_id).not.toBe('second-id-should-never-be-used');
    }
  });

  it('a dedup hit whose existing expires_at already lapsed (physical reclamation has not yet run) is refreshed to a fresh TTL rather than handed back dead-on-arrival', async () => {
    const deps = freshDeps({
      randomId: () => 'first-id',
      nowIso: () => '2026-09-01T00:00:00.000Z',
    });
    const bytes = pdfBytes('expired-dedupe regression fixture');
    const first = await storeDocumentUpload(bytes, 'application/pdf', deps);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.expires_at).toBe(
      new Date(Date.parse('2026-09-01T00:00:00.000Z') + DOCUMENT_UPLOAD_TTL_SECONDS * 1000)
        .toISOString()
    );

    // Re-upload the byte-identical content well past the first upload's
    // expires_at (900s), but before any physical reclamation pass (24h)
    // would have removed the row -- exactly the window this fix closes.
    const laterIso = '2026-09-01T01:00:00.000Z'; // 1h later, TTL was 900s
    const secondDeps = freshDeps({
      artifactStore: deps.artifactStore,
      artifactsRepository: deps.artifactsRepository,
      randomId: () => 'second-id-should-never-be-used',
      nowIso: () => laterIso,
    });
    const second = await storeDocumentUpload(bytes, 'application/pdf', secondDeps);
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    // Same content-addressed identity, but the TTL must now be live again
    // (fresh now + TTL), never the already-past original value.
    expect(second.upload_id).toBe(first.upload_id);
    expect(Date.parse(second.expires_at)).toBeGreaterThan(Date.parse(laterIso));
    expect(second.expires_at).toBe(
      new Date(Date.parse(laterIso) + DOCUMENT_UPLOAD_TTL_SECONDS * 1000).toISOString()
    );

    // The refresh is durable, not response-only: reading the row back
    // independently must show the same extended expiry.
    const stored = await deps.__repo.getById(first.upload_id);
    expect(stored.ok && stored.value?.expires_at).toBe(second.expires_at);
  });

  it('SUN-1222C-LOCAL-CLOSURE-R2 §1: a dedup hit whose existing expires_at already lapsed AND whose refresh fails is rejected -- NEVER returns the stale upload_id as a success', async () => {
    const bytes = pdfBytes('expired-dedupe-refresh-failure fixture');
    const hash = await realHash(bytes);
    const staleExisting = {
      id: 'stale-existing-id',
      content_hash: hash,
      media_type: 'application/pdf' as const,
      byte_length: bytes.length,
      created_at: '2026-09-01T00:00:00.000Z',
      expires_at: '2026-09-01T00:15:00.000Z', // already in the past relative to nowIso below
      authorization_class: 'buyer_authorized' as const,
      retention_class: 'ephemeral' as const,
      artifact_type: 'input' as const,
    };
    const deps = freshDeps({
      nowIso: () => '2026-09-01T01:00:00.000Z', // 45 minutes after expires_at
      artifactsRepository: {
        create: async () => ({ ok: false as const, error: { code: 'DUPLICATE_ARTIFACT', message: 'x' } }),
        getById: async () => ({ ok: true as const, value: staleExisting }),
        getByContentHash: async () => ({ ok: true as const, value: staleExisting }),
        getByJobId: async () => ({ ok: true as const, value: [] }),
        delete: async () => ({ ok: true as const, value: false }),
        deleteExpired: async () => ({ ok: true as const, value: 0 }),
        listReclaimable: async () => ({ ok: true as const, value: [] }),
        claimForReclamation: async () => ({ ok: true as const, value: false }),
        deleteReclaimed: async () => ({ ok: true as const, value: false }),
        // Simulates a genuine repository fault during the refresh attempt.
        refreshExpiry: async () => ({
          ok: false as const,
          error: { code: 'DATABASE_ERROR', message: 'simulated transient D1 fault' },
        }),
      },
    });

    const result = await storeDocumentUpload(bytes, 'application/pdf', deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('expired_dedupe_refresh_failed');
    expect(result.retryable).toBe(true);
    // Critically: nothing in the rejection carries the dead upload_id as if
    // it were usable.
    expect(JSON.stringify(result)).not.toContain('stale-existing-id');
  });

  it('SUN-1222C-LOCAL-CLOSURE-R2 §1: a dedup hit whose refresh races a concurrent physical reclamation (row already gone) is also rejected, never falls back to the dead reference', async () => {
    const bytes = pdfBytes('expired-dedupe-race-with-reclamation fixture');
    const hash = await realHash(bytes);
    const staleExisting = {
      id: 'raced-away-id',
      content_hash: hash,
      media_type: 'application/pdf' as const,
      byte_length: bytes.length,
      created_at: '2026-09-01T00:00:00.000Z',
      expires_at: '2026-09-01T00:15:00.000Z',
      authorization_class: 'buyer_authorized' as const,
      retention_class: 'ephemeral' as const,
      artifact_type: 'input' as const,
    };
    const deps = freshDeps({
      nowIso: () => '2026-09-01T01:00:00.000Z',
      artifactsRepository: {
        create: async () => ({ ok: false as const, error: { code: 'DUPLICATE_ARTIFACT', message: 'x' } }),
        getById: async () => ({ ok: true as const, value: staleExisting }),
        getByContentHash: async () => ({ ok: true as const, value: staleExisting }),
        getByJobId: async () => ({ ok: true as const, value: [] }),
        delete: async () => ({ ok: true as const, value: false }),
        deleteExpired: async () => ({ ok: true as const, value: 0 }),
        listReclaimable: async () => ({ ok: true as const, value: [] }),
        claimForReclamation: async () => ({ ok: true as const, value: false }),
        deleteReclaimed: async () => ({ ok: true as const, value: false }),
        // `ok: true, value: null` -- the documented "row is gone" outcome.
        refreshExpiry: async () => ({ ok: true as const, value: null }),
      },
    });

    const result = await storeDocumentUpload(bytes, 'application/pdf', deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('expired_dedupe_refresh_failed');
  });

  it('SUN-1222C-LOCAL-CLOSURE-R2 §1: retrying an expired-dedupe-refresh-failure is idempotent -- a subsequent retry that succeeds returns a genuinely live reference, no duplicate rows created', async () => {
    const deps = freshDeps({ randomId: () => 'first-id', nowIso: () => '2026-09-01T00:00:00.000Z' });
    const bytes = pdfBytes('idempotent-retry-after-refresh-failure fixture');
    const first = await storeDocumentUpload(bytes, 'application/pdf', deps);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    let refreshCalls = 0;
    const flakyRepo: ArtifactsRepository = {
      create: (a) => deps.__repo.create(a),
      getById: (id) => deps.__repo.getById(id),
      getByContentHash: (h) => deps.__repo.getByContentHash(h),
      getByJobId: (jobId) => deps.__repo.getByJobId(jobId),
      delete: (id) => deps.__repo.delete(id),
      deleteExpired: () => deps.__repo.deleteExpired(),
      listReclaimable: (a, b) => deps.__repo.listReclaimable(a, b),
      claimForReclamation: (id, a, b, at) => deps.__repo.claimForReclamation(id, a, b, at),
      deleteReclaimed: (id) => deps.__repo.deleteReclaimed(id),
      refreshExpiry: async (id, expiresAt) => {
        refreshCalls += 1;
        if (refreshCalls === 1) {
          return { ok: false, error: { code: 'DATABASE_ERROR', message: 'first attempt fails' } };
        }
        return deps.__repo.refreshExpiry(id, expiresAt);
      },
    };

    const retryDeps = freshDeps({
      artifactStore: deps.artifactStore,
      artifactsRepository: flakyRepo,
      randomId: () => 'never-used-id',
      nowIso: () => '2026-09-01T01:00:00.000Z',
    });

    const failedAttempt = await storeDocumentUpload(bytes, 'application/pdf', retryDeps);
    expect(failedAttempt.ok).toBe(false);

    const retried = await storeDocumentUpload(bytes, 'application/pdf', retryDeps);
    expect(retried.ok).toBe(true);
    if (!retried.ok) return;
    expect(retried.upload_id).toBe(first.upload_id);
    expect(Date.parse(retried.expires_at)).toBeGreaterThan(Date.parse('2026-09-01T01:00:00.000Z'));

    // No duplicate row was ever created by either attempt.
    const stored = await deps.__repo.getByContentHash(await realHash(bytes));
    expect(stored.ok && stored.value?.id).toBe(first.upload_id);
  });

  it('a dedup hit whose existing expires_at is still live is left untouched (dedup never shortens anyone\'s window)', async () => {
    const deps = freshDeps({
      randomId: () => 'first-id',
      nowIso: () => '2026-09-01T00:00:00.000Z',
    });
    const bytes = pdfBytes('still-live dedupe fixture');
    const first = await storeDocumentUpload(bytes, 'application/pdf', deps);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Re-upload 10s later -- well within the 900s TTL.
    const secondDeps = freshDeps({
      artifactStore: deps.artifactStore,
      artifactsRepository: deps.artifactsRepository,
      randomId: () => 'second-id-should-never-be-used',
      nowIso: () => '2026-09-01T00:00:10.000Z',
    });
    const second = await storeDocumentUpload(bytes, 'application/pdf', secondDeps);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.expires_at).toBe(first.expires_at);
  });

  it('handles a concurrent-identical-content race (D1 create returns DUPLICATE_ARTIFACT) by re-reading rather than surfacing a storage_failure for a perfectly successful upload', async () => {
    const bytes = pdfBytes('race condition fixture');
    const hash = await realHash(bytes);
    const realRepo = new InMemoryArtifactsRepository();
    // Pre-seed the repo as if a concurrent request already committed the
    // same content hash under a different id, then force `create` to
    // report the race exactly as D1's UNIQUE INDEX would.
    await realRepo.create({
      id: '11111111-1111-4111-8111-111111111111',
      content_hash: hash,
      media_type: 'application/pdf',
      byte_length: bytes.length,
      created_at: '2026-09-01T00:00:00.000Z',
      expires_at: '2026-09-01T00:15:00.000Z',
      authorization_class: 'buyer_authorized',
      retention_class: 'ephemeral',
      artifact_type: 'input',
    });
    // Built as an explicit object (not spread from `realRepo`) -- spreading
    // a class instance copies only its own enumerable properties, not
    // `InMemoryArtifactsRepository`'s prototype methods, which would
    // silently drop `getById`/`getByJobId`/`delete`/`deleteExpired`.
    let getByContentHashCalls = 0;
    const racingRepo: ArtifactsRepository = {
      // getByContentHash intentionally returns null the FIRST time (as if
      // the dedup pre-check ran before the concurrent writer committed),
      // forcing storeDocumentUpload down the create() -> DUPLICATE_ARTIFACT
      // -> re-read path rather than the earlier dedup short-circuit.
      getByContentHash: async (h: string) => {
        getByContentHashCalls += 1;
        if (getByContentHashCalls === 1) return { ok: true as const, value: null };
        return realRepo.getByContentHash(h);
      },
      create: async () => ({
        ok: false as const,
        error: { code: 'DUPLICATE_ARTIFACT', message: 'race' },
      }),
      getById: (id: string) => realRepo.getById(id),
      getByJobId: (jobId: string) => realRepo.getByJobId(jobId),
      delete: (id: string) => realRepo.delete(id),
      deleteExpired: () => realRepo.deleteExpired(),
      listReclaimable: (olderThanIso: string, nowIso: string) =>
        realRepo.listReclaimable(olderThanIso, nowIso),
      refreshExpiry: (id: string, expiresAt: string) => realRepo.refreshExpiry(id, expiresAt),
      claimForReclamation: (id: string, a: string, b: string, at: string) =>
        realRepo.claimForReclamation(id, a, b, at),
      deleteReclaimed: (id: string) => realRepo.deleteReclaimed(id),
    };
    const deps = freshDeps({ artifactsRepository: racingRepo, randomId: () => 'never-used-id' });
    const result = await storeDocumentUpload(bytes, 'application/pdf', deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.upload_id).toBe('11111111-1111-4111-8111-111111111111');
    }
  });

  it('surfaces a genuine R2 write failure as storage_failure without throwing past the function boundary', async () => {
    const deps = freshDeps({
      artifactStore: {
        put: async () => {
          throw new Error('simulated R2 outage');
        },
        getMetadata: async () => null,
        getContent: async () => null,
        getByContentHash: async () => null,
        getContentByContentHash: async () => null,
        delete: async () => false,
        deleteByContentHash: async () => false,
        getContentForArtifact: async () => null,
        deleteForArtifact: async () => false,
        exists: async () => false,
        existsByContentHash: async () => false,
      },
    });
    const result = await storeDocumentUpload(pdfBytes(), 'application/pdf', deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('storage_failure');
      expect(result.message).toMatch(/simulated R2 outage/);
    }
  });

  it('surfaces a genuine D1 metadata write failure (non-race) as storage_failure', async () => {
    const deps = freshDeps({
      artifactsRepository: {
        create: async () => ({
          ok: false as const,
          error: { code: 'D1_ERROR', message: 'disk full' },
        }),
        getById: async () => ({ ok: true as const, value: null }),
        getByContentHash: async () => ({ ok: true as const, value: null }),
        getByJobId: async () => ({ ok: true as const, value: [] }),
        delete: async () => ({ ok: true as const, value: false }),
        deleteExpired: async () => ({ ok: true as const, value: 0 }),
        listReclaimable: async () => ({ ok: true as const, value: [] }),
        claimForReclamation: async () => ({ ok: true as const, value: false }),
        deleteReclaimed: async () => ({ ok: true as const, value: false }),
        refreshExpiry: async () => ({ ok: true as const, value: null }),
      },
    });
    const result = await storeDocumentUpload(pdfBytes(), 'application/pdf', deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('storage_failure');
      expect(result.message).toMatch(/disk full/);
    }
  });
});
