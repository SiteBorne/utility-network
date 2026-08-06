import type { ArtifactRecord, ArtifactStore } from './interfaces';

export async function computeHash(content: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', content);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `sha256:${hashHex}`;
}

export class InMemoryArtifactStore implements ArtifactStore {
  private store = new Map<string, ArtifactRecord & { content: Uint8Array }>();

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

  async delete(id: string): Promise<boolean> {
    const record = this.store.get(id);
    if (!record) return false;
    this.store.delete(id);
    this.store.delete(record.content_hash);
    return true;
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
  }
}

export class R2ArtifactStoreAdapter implements ArtifactStore {
  private bucket: R2Bucket;
  private prefix: string;

  constructor(bucket: R2Bucket, prefix = 'artifacts/') {
    this.bucket = bucket;
    this.prefix = prefix;
  }

  private getKey(artifact: ArtifactRecord): string {
    return `${this.prefix}${artifact.content_hash.replace('sha256:', '')}`;
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

  async delete(id: string): Promise<boolean> {
    const object = await this.bucket.head(id);
    if (!object) return false;
    await this.bucket.delete(id);
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
  delete(id: string): Promise<boolean>;
  exists(id: string): Promise<boolean>;
  existsByContentHash(hash: string): Promise<boolean>;
}
