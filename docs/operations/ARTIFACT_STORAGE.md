# Artifact Storage Operations

## Overview

The artifact storage system provides content-addressed storage with SHA-256
verification for all job inputs, outputs, and intermediate artifacts.

## Interface

### ArtifactStore

```typescript
interface ArtifactStore {
  put(artifact: ArtifactRecord, content: Uint8Array): Promise<ArtifactRecord>;
  getMetadata(id: string): Promise<ArtifactRecord | null>;
  getContent(id: string): Promise<Uint8Array | null>;
  getByContentHash(hash: string): Promise<ArtifactRecord | null>;
  delete(id: string): Promise<boolean>;
  exists(id: string): Promise<boolean>;
  existsByContentHash(hash: string): Promise<boolean>;
}
```

### ArtifactRecord

```typescript
interface ArtifactRecord {
  id: string; // UUID
  content_hash: string; // sha256:<hex>
  media_type: string; // MIME type
  byte_length: number; // Content length in bytes
  created_at: string; // ISO 8601
  expires_at?: string; // Optional TTL
  authorization_class: 'public' | 'buyer_authorized' | 'private';
  retention_class: 'ephemeral' | 'standard' | 'archival';
  job_id?: string; // Associated job
  artifact_type: 'input' | 'output' | 'intermediate' | 'receipt' | 'audit';
}
```

## Implementations

### InMemoryArtifactStore (Local/Test)

- Map-based storage keyed by artifact ID and content hash
- Deduplication by content hash (same content = same storage)
- Full SHA-256 verification on put
- Byte length enforcement
- TTL support via expires_at
- Authorization and retention metadata

### R2ArtifactStoreAdapter (Production)

- Cloudflare R2 bucket storage
- Keys: `artifacts/<content_hash_without_prefix>`
- Metadata stored in R2 custom metadata
- Content-Type from media_type
- Same interface as in-memory for seamless swap

## Operations

### Storing an Artifact

```typescript
const artifact: ArtifactRecord = {
  id: crypto.randomUUID(),
  content_hash: 'sha256:abc123...',
  media_type: 'application/json',
  byte_length: content.length,
  created_at: new Date().toISOString(),
  authorization_class: 'private',
  retention_class: 'standard',
  job_id: 'job-uuid',
  artifact_type: 'input',
};

await artifactStore.put(artifact, content);
```

### Retrieving Metadata

```typescript
const metadata = await artifactStore.getMetadata(artifactId);
if (metadata) {
  console.log(metadata.content_hash, metadata.byte_length);
}
```

### Retrieving Content

```typescript
const content = await artifactStore.getContent(artifactId);
if (content) {
  const text = new TextDecoder().decode(content);
}
```

### Content-Based Lookup

```typescript
const existing = await artifactStore.getByContentHash('sha256:abc123...');
if (existing) {
  // Content already stored, reuse existing artifact
}
```

### Deletion

```typescript
const deleted = await artifactStore.delete(artifactId);
```

### Existence Checks

```typescript
const exists = await artifactStore.exists(artifactId);
const existsByHash =
  await artifactStore.existsByContentHash('sha256:abc123...');
```

## Deduplication

- Same content hash = same artifact (single storage)
- Second put with same hash returns existing artifact
- Reference counting not implemented (simplified for SUN-0200)

## Verification

- SHA-256 computed on put using Web Crypto API
- Mismatch throws error
- Byte length verified against content.length

## Authorization Classes

- `public`: Discoverable via catalog/routes
- `buyer_authorized`: Accessible only to job owner
- `private`: Internal use only

## Retention Classes

- `ephemeral`: Short TTL (hours), auto-deleted
- `standard`: Default retention (days)
- `archival`: Long-term retention (compliance)

## Artifact Types

- `input`: Customer-provided input documents
- `output`: Service execution results
- `intermediate`: Processing intermediates
- `receipt`: Signed verification receipts
- `audit`: Audit/security event exports

## Limits

- Maximum artifact size: 50 MB (configurable)
- Maximum artifacts per job: 100 (configurable)
- Total storage per account: 10 GB (configurable)

## Cleanup

- Expired artifacts deleted by background job
- `deleteExpired()` returns count of deleted artifacts
- Orphaned artifacts (no job_id) cleaned after retention period

## Testing

```bash
# Run artifact tests
pnpm test -- apps/edge-api/tests/artifacts-queue.test.ts
```

## Production Deployment

1. Create R2 bucket: `wrangler r2 bucket create siteborne-artifacts`
2. Configure binding in wrangler.toml
3. Deploy Worker with R2 binding
4. Verify artifact operations work end-to-end
