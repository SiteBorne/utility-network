import type { ArtifactRecord } from '../types';

/**
 * Canonical R2 key-namespace prefix for buyer-uploaded document/image
 * artifacts (`document-artifact-upload-route.ts`'s write path and every
 * `document_evidence_json.v2`/`.v3` executor's read path). This is the ONE
 * shared value both sides must construct their `R2ArtifactStoreAdapter`
 * with — a prefix mismatch between the writer and a reader silently makes
 * every real uploaded document unresolvable (404/`unavailable`) even
 * though the object genuinely exists in the bucket, since both sides derive
 * the same otherwise-correct `prefix + contentHash` key independently.
 * Every real call site in this repo must reference this constant rather
 * than a locally hand-typed string literal or the constructor's bare
 * default, so the namespace can never drift back out of sync again.
 */
export const DOCUMENT_ARTIFACT_KEY_PREFIX = 'artifacts/';

/**
 * R3-A3-ARTIFACT-RECLAIM-OWNERSHIP-34 — the object name (relative to a
 * store's prefix) holding `artifact`'s bytes. Legacy records (no
 * `storage_key`) share the content-addressed name `<sha256 hex>`; records
 * minted since migration 0013 own a per-row name, so reclaiming one row can
 * never delete bytes a later row with the same content hash depends on.
 */
export function artifactObjectName(
  artifact: Pick<ArtifactRecord, 'content_hash' | 'storage_key'>
): string {
  return artifact.storage_key ?? artifact.content_hash.replace('sha256:', '');
}

/** Per-row object name for a newly minted artifact row (see
 * `artifactObjectName`). `id` is always server-generated, never buyer input. */
export function perArtifactStorageKey(contentHash: string, id: string): string {
  return `${contentHash.replace('sha256:', '')}/${id}`;
}

export async function computeHash(content: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', content);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `sha256:${hashHex}`;
}

export class InMemoryArtifactStore implements ArtifactStore {
  private store = new Map<string, ArtifactRecord & { content: Uint8Array }>();
  /** Per-row objects (records carrying `storage_key`), keyed by
   * `artifactObjectName` — mirrors the R2 adapter's distinct keys. */
  private objects = new Map<string, Uint8Array>();

  async put(artifact: ArtifactRecord, content: Uint8Array): Promise<ArtifactRecord> {
    if (this.store.has(artifact.id)) {
      throw new Error(`Artifact already exists: ${artifact.id}`);
    }

    if (artifact.byte_length !== content.length) {
      throw new Error(
        `Byte length mismatch: expected ${artifact.byte_length}, got ${content.length}`
      );
    }

    const computedHash = await computeHash(content);
    if (computedHash !== artifact.content_hash) {
      throw new Error(
        `Content hash mismatch: expected ${artifact.content_hash}, got ${computedHash}`
      );
    }

    if (artifact.storage_key) {
      // Per-row object: never shares the content-hash index with any
      // other row (see `artifactObjectName`).
      if (!this.objects.has(artifact.storage_key)) {
        this.objects.set(artifact.storage_key, content);
        this.store.set(artifact.id, { ...artifact, content });
      }
      return artifact;
    }

    const existing = this.store.get(artifact.content_hash);
    if (existing) {
      return existing;
    }

    const record = { ...artifact, content };
    this.store.set(artifact.id, record);
    this.store.set(artifact.content_hash, record);
    return artifact;
  }

  async getMetadata(id: string): Promise<ArtifactRecord | null> {
    const record = this.store.get(id);
    if (!record) return null;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { content, ...metadata } = record;
    return metadata;
  }

  async getContent(id: string): Promise<Uint8Array | null> {
    const record = this.store.get(id);
    if (!record) return null;
    return record.content;
  }

  async getByContentHash(hash: string): Promise<ArtifactRecord | null> {
    const record = this.store.get(hash);
    if (!record) return null;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { content, ...metadata } = record;
    return metadata;
  }

  /** SUN-1222B-S3-R2: content-addressed fetch, used by the buyer-upload
   * resolution path (`upload_reference`) so the caller never needs to
   * know the store's internal `id` vs. `content_hash` keying convention. */
  async getContentByContentHash(hash: string): Promise<Uint8Array | null> {
    const record = this.store.get(hash);
    if (!record) return null;
    return record.content;
  }

  async delete(id: string): Promise<boolean> {
    const record = this.store.get(id);
    if (!record) return false;
    this.store.delete(id);
    this.store.delete(record.content_hash);
    return true;
  }

  /** SUN-1222C0 — physical reclamation's own entry point: mirrors
   * `delete()` but keyed the same way `getContentByContentHash` already
   * is (this store indexes by both `id` and `content_hash`, so either
   * key reaches the same record; deleting removes both index entries). */
  async deleteByContentHash(hash: string): Promise<boolean> {
    const record = this.store.get(hash);
    if (!record) return false;
    this.store.delete(record.id);
    this.store.delete(record.content_hash);
    return true;
  }

  async getContentForArtifact(
    artifact: Pick<ArtifactRecord, 'content_hash' | 'storage_key'>
  ): Promise<Uint8Array | null> {
    if (artifact.storage_key) return this.objects.get(artifact.storage_key) ?? null;
    return this.getContentByContentHash(artifact.content_hash);
  }

  async deleteForArtifact(
    artifact: Pick<ArtifactRecord, 'id' | 'content_hash' | 'storage_key'>
  ): Promise<boolean> {
    if (artifact.storage_key) {
      const record = this.store.get(artifact.id);
      if (record?.storage_key === artifact.storage_key) this.store.delete(artifact.id);
      return this.objects.delete(artifact.storage_key);
    }
    return this.deleteByContentHash(artifact.content_hash);
  }

  async exists(id: string): Promise<boolean> {
    return this.store.has(id);
  }

  async existsByContentHash(hash: string): Promise<boolean> {
    return this.store.has(hash);
  }

  private async computeHash(content: Uint8Array): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', content);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    return `sha256:${hashHex}`;
  }

  clear(): void {
    this.store.clear();
    this.objects.clear();
  }
}

export class R2ArtifactStoreAdapter implements ArtifactStore {
  private bucket: R2Bucket;
  private prefix: string;

  constructor(bucket: R2Bucket, prefix = DOCUMENT_ARTIFACT_KEY_PREFIX) {
    this.bucket = bucket;
    this.prefix = prefix;
  }

  private getKey(artifact: Pick<ArtifactRecord, 'content_hash' | 'storage_key'>): string {
    return `${this.prefix}${artifactObjectName(artifact)}`;
  }

  async put(artifact: ArtifactRecord, content: Uint8Array): Promise<ArtifactRecord> {
    const key = this.getKey(artifact);
    const computedHash = await computeHash(content);
    if (computedHash !== artifact.content_hash) {
      throw new Error(
        `Content hash mismatch: expected ${artifact.content_hash}, got ${computedHash}`
      );
    }

    const existing = await this.bucket.head(key);
    if (existing) {
      return artifact;
    }

    await this.bucket.put(key, content, {
      httpMetadata: {
        contentType: artifact.media_type,
      },
      customMetadata: {
        'content-hash': artifact.content_hash,
        'byte-length': String(artifact.byte_length),
        'media-type': artifact.media_type,
        'authorization-class': artifact.authorization_class,
        'retention-class': artifact.retention_class,
        'artifact-type': artifact.artifact_type,
        'job-id': artifact.job_id ?? '',
        'created-at': artifact.created_at,
      },
    });

    return artifact;
  }

  async getMetadata(id: string): Promise<ArtifactRecord | null> {
    const object = await this.bucket.head(id);
    if (!object) return null;

    return {
      id: object.key,
      content_hash: object.customMetadata['content-hash'] ?? '',
      media_type:
        object.customMetadata['media-type'] ??
        object.httpMetadata?.contentType ??
        'application/octet-stream',
      byte_length: parseInt(object.customMetadata['byte-length'] ?? '0', 10),
      created_at: object.customMetadata['created-at'] ?? object.uploaded.toISOString(),
      expires_at: undefined,
      authorization_class:
        (object.customMetadata['authorization-class'] as
          | 'public'
          | 'buyer_authorized'
          | 'private') ?? 'private',
      retention_class:
        (object.customMetadata['retention-class'] as 'ephemeral' | 'standard' | 'archival') ??
        'standard',
      job_id: object.customMetadata['job-id'] || undefined,
      artifact_type:
        (object.customMetadata['artifact-type'] as
          | 'input'
          | 'output'
          | 'intermediate'
          | 'receipt'
          | 'audit') ?? 'intermediate',
    };
  }

  async getContent(id: string): Promise<Uint8Array | null> {
    const object = await this.bucket.get(id);
    if (!object) return null;
    return new Uint8Array(await object.arrayBuffer());
  }

  async getByContentHash(hash: string): Promise<ArtifactRecord | null> {
    const key = `${this.prefix}${hash.replace('sha256:', '')}`;
    return this.getMetadata(key);
  }

  /** SUN-1222B-S3-R2: content-addressed fetch, using the exact same key
   * derivation `put()`/`getByContentHash()` already use internally
   * (`prefix + hash-without-"sha256:"`). Deliberately NOT built on the raw
   * `getContent(id)` above — that method treats `id` as an already-fully-
   * qualified R2 key (the pre-existing `artifact_reference` mode's own
   * contract, unchanged by this checkpoint; see this file's `getContent`
   * doc note in the SUN-1222B-S3-R2 evidence report for the trace proving
   * that contract). This is the one new, additive method the buyer-upload
   * resolution path actually calls. */
  async getContentByContentHash(hash: string): Promise<Uint8Array | null> {
    const key = `${this.prefix}${hash.replace('sha256:', '')}`;
    const object = await this.bucket.get(key);
    if (!object) return null;
    return new Uint8Array(await object.arrayBuffer());
  }

  async delete(id: string): Promise<boolean> {
    const object = await this.bucket.head(id);
    if (!object) return false;
    await this.bucket.delete(id);
    return true;
  }

  /** SUN-1222C0 — physical reclamation's own entry point: same
   * content-hash-derived key `getContentByContentHash`/`existsByContentHash`
   * already use. `head()` first (matches `delete()`'s own idempotent
   * pattern above) so a missing object is a clean `false`, never a
   * `bucket.delete()` call on a key that was never there. */
  async deleteByContentHash(hash: string): Promise<boolean> {
    const key = `${this.prefix}${hash.replace('sha256:', '')}`;
    const object = await this.bucket.head(key);
    if (!object) return false;
    await this.bucket.delete(key);
    return true;
  }

  async getContentForArtifact(
    artifact: Pick<ArtifactRecord, 'content_hash' | 'storage_key'>
  ): Promise<Uint8Array | null> {
    const object = await this.bucket.get(this.getKey(artifact));
    if (!object) return null;
    return new Uint8Array(await object.arrayBuffer());
  }

  /** Idempotent: a missing object is `false`, never a throw. */
  async deleteForArtifact(
    artifact: Pick<ArtifactRecord, 'id' | 'content_hash' | 'storage_key'>
  ): Promise<boolean> {
    const key = this.getKey(artifact);
    const object = await this.bucket.head(key);
    if (!object) return false;
    await this.bucket.delete(key);
    return true;
  }

  async exists(id: string): Promise<boolean> {
    const object = await this.bucket.head(id);
    return object !== null;
  }

  async existsByContentHash(hash: string): Promise<boolean> {
    const key = `${this.prefix}${hash.replace('sha256:', '')}`;
    const object = await this.bucket.head(key);
    return object !== null;
  }
}

export interface ArtifactStore {
  put(artifact: ArtifactRecord, content: Uint8Array): Promise<ArtifactRecord>;
  getMetadata(id: string): Promise<ArtifactRecord | null>;
  getContent(id: string): Promise<Uint8Array | null>;
  getByContentHash(hash: string): Promise<ArtifactRecord | null>;
  /** SUN-1222B-S3-R2 addition — see both implementations' own doc comments. */
  getContentByContentHash(hash: string): Promise<Uint8Array | null>;
  delete(id: string): Promise<boolean>;
  /** SUN-1222C0 addition — see both implementations' own doc comments. */
  deleteByContentHash(hash: string): Promise<boolean>;
  /** R3-A3-ARTIFACT-RECLAIM-OWNERSHIP-34 — read/delete the object backing
   * one D1 artifact row (`artifactObjectName`). Buyer-upload resolution and
   * physical reclamation must use these, never the hash-keyed variants,
   * so they honor per-row `storage_key`s. */
  getContentForArtifact(
    artifact: Pick<ArtifactRecord, 'content_hash' | 'storage_key'>
  ): Promise<Uint8Array | null>;
  deleteForArtifact(
    artifact: Pick<ArtifactRecord, 'id' | 'content_hash' | 'storage_key'>
  ): Promise<boolean>;
  exists(id: string): Promise<boolean>;
  existsByContentHash(hash: string): Promise<boolean>;
}
