import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryArtifactsRepository } from '../src/control-plane/repositories/in-memory';
import { InMemoryArtifactStore, computeHash } from '../src/control-plane/artifacts/store';
import {
  InMemoryQueueProducer,
  InMemoryQueueConsumer,
  QueueDispatchHandler,
} from '../src/control-plane/queue/dispatch';
import { ArtifactRecord, QueueDispatch } from '../src/control-plane/types';

describe('Artifact Store', () => {
  let store: InMemoryArtifactStore;

  beforeEach(() => {
    store = new InMemoryArtifactStore();
  });

  it('stores artifact with content', async () => {
    const content = new TextEncoder().encode('{"test":true}');
    const contentHash = await computeHash(content);
    const artifact: ArtifactRecord = {
      id: 'artifact-123',
      content_hash: contentHash,
      media_type: 'application/json',
      byte_length: content.length,
      created_at: new Date().toISOString(),
      authorization_class: 'private',
      retention_class: 'standard',
      artifact_type: 'input',
    };

    const result = await store.put(artifact, content);
    expect(result.id).toBe('artifact-123');
  });

  it('retrieves artifact metadata', async () => {
    const content = new TextEncoder().encode('{"test":true}');
    const contentHash = await computeHash(content);
    const artifact: ArtifactRecord = {
      id: 'artifact-123',
      content_hash: contentHash,
      media_type: 'application/json',
      byte_length: content.length,
      created_at: new Date().toISOString(),
      authorization_class: 'private',
      retention_class: 'standard',
      artifact_type: 'input',
    };

    await store.put(artifact, content);
    const metadata = await store.getMetadata('artifact-123');
    expect(metadata).not.toBeNull();
    expect(metadata?.content_hash).toBe(contentHash);
  });

  it('retrieves artifact content', async () => {
    const content = new TextEncoder().encode('{"test":true}');
    const contentHash = await computeHash(content);
    const artifact: ArtifactRecord = {
      id: 'artifact-123',
      content_hash: contentHash,
      media_type: 'application/json',
      byte_length: content.length,
      created_at: new Date().toISOString(),
      authorization_class: 'private',
      retention_class: 'standard',
      artifact_type: 'input',
    };

    await store.put(artifact, content);
    const retrieved = await store.getContent('artifact-123');
    expect(retrieved).not.toBeNull();
    expect(new TextDecoder().decode(retrieved!)).toBe('{"test":true}');
  });

  it('deduplicates same content by hash', async () => {
    const content = new TextEncoder().encode('{"test":true}');
    const contentHash = await computeHash(content);
    const artifact1: ArtifactRecord = {
      id: 'artifact-1',
      content_hash: contentHash,
      media_type: 'application/json',
      byte_length: content.length,
      created_at: new Date().toISOString(),
      authorization_class: 'private',
      retention_class: 'standard',
      artifact_type: 'input',
    };
    const artifact2: ArtifactRecord = {
      id: 'artifact-2',
      content_hash: contentHash,
      media_type: 'application/json',
      byte_length: content.length,
      created_at: new Date().toISOString(),
      authorization_class: 'private',
      retention_class: 'standard',
      artifact_type: 'output',
    };

    await store.put(artifact1, content);
    const result = await store.put(artifact2, content);
    expect(result.id).toBe('artifact-1');
  });

  it('rejects content hash mismatch', async () => {
    const content = new TextEncoder().encode('{"test":true}');
    const contentHash = await computeHash(content);
    const artifact: ArtifactRecord = {
      id: 'artifact-123',
      content_hash: 'sha256:wronghash',
      media_type: 'application/json',
      byte_length: content.length,
      created_at: new Date().toISOString(),
      authorization_class: 'private',
      retention_class: 'standard',
      artifact_type: 'input',
    };

    await expect(store.put(artifact, content)).rejects.toThrow('Content hash mismatch');
  });

  it('rejects byte length mismatch', async () => {
    const content = new TextEncoder().encode('{"test":true}');
    const contentHash = await computeHash(content);
    const artifact: ArtifactRecord = {
      id: 'artifact-123',
      content_hash: contentHash,
      media_type: 'application/json',
      byte_length: 100,
      created_at: new Date().toISOString(),
      authorization_class: 'private',
      retention_class: 'standard',
      artifact_type: 'input',
    };

    await expect(store.put(artifact, content)).rejects.toThrow('Byte length mismatch');
  });

  it('checks existence by id', async () => {
    const content = new TextEncoder().encode('{"test":true}');
    const contentHash = await computeHash(content);
    const artifact: ArtifactRecord = {
      id: 'artifact-123',
      content_hash: contentHash,
      media_type: 'application/json',
      byte_length: content.length,
      created_at: new Date().toISOString(),
      authorization_class: 'private',
      retention_class: 'standard',
      artifact_type: 'input',
    };

    await store.put(artifact, content);
    expect(await store.exists('artifact-123')).toBe(true);
    expect(await store.exists('nonexistent')).toBe(false);
  });

  it('checks existence by content hash', async () => {
    const content = new TextEncoder().encode('{"test":true}');
    const contentHash = await computeHash(content);
    const artifact: ArtifactRecord = {
      id: 'artifact-123',
      content_hash: contentHash,
      media_type: 'application/json',
      byte_length: content.length,
      created_at: new Date().toISOString(),
      authorization_class: 'private',
      retention_class: 'standard',
      artifact_type: 'input',
    };

    await store.put(artifact, content);
    expect(await store.existsByContentHash(contentHash)).toBe(true);
    expect(await store.existsByContentHash('sha256:different')).toBe(false);
  });

  it('deletes artifact', async () => {
    const content = new TextEncoder().encode('{"test":true}');
    const contentHash = await computeHash(content);
    const artifact: ArtifactRecord = {
      id: 'artifact-123',
      content_hash: contentHash,
      media_type: 'application/json',
      byte_length: content.length,
      created_at: new Date().toISOString(),
      authorization_class: 'private',
      retention_class: 'standard',
      artifact_type: 'input',
    };

    await store.put(artifact, content);
    expect(await store.delete('artifact-123')).toBe(true);
    expect(await store.exists('artifact-123')).toBe(false);
  });
});

describe('Queue Dispatch', () => {
  let producer: InMemoryQueueProducer;
  let consumer: InMemoryQueueConsumer;
  let handler: QueueDispatchHandler;
  let repo: any;

  beforeEach(() => {
    producer = new InMemoryQueueProducer();
    consumer = new InMemoryQueueConsumer();
    repo = {
      getByJobIdAndAttempt: async (jobId: string, attempt: number) => ({ ok: false, value: null }),
      create: async (dispatch: QueueDispatch) => ({ ok: true, value: dispatch }),
    };
    handler = new QueueDispatchHandler(producer, repo);
  });

  it('creates dispatch and sends to queue', async () => {
    const dispatch = await handler.dispatch(
      'job-123',
      1,
      'company_evidence_graph.v1',
      '1.0.0',
      'artifact-123',
      'contract-hash',
      'trace-123',
      new Date(Date.now() + 3600000).toISOString()
    );

    expect(dispatch.job_id).toBe('job-123');
    expect(dispatch.attempt_number).toBe(1);
    expect(producer.getQueue().length).toBe(1);
  });

  it('handles duplicate delivery', async () => {
    const existingDispatch: QueueDispatch = {
      id: 'dispatch-123',
      job_id: 'job-123',
      attempt_number: 1,
      service_id: 'company_evidence_graph.v1',
      service_version: '1.0.0',
      input_artifact_ref: 'artifact-123',
      contract_hash: 'contract-hash',
      trace_context: 'trace-123',
      dispatched_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      retry_count: 0,
    };

    repo.getByJobIdAndAttempt = async () => ({ ok: true, value: existingDispatch });

    const result = await handler.handleDuplicateDelivery({
      job_id: 'job-123',
      attempt_number: 1,
      service_id: 'company_evidence_graph.v1',
      service_version: '1.0.0',
      input_artifact_ref: 'artifact-123',
      contract_hash: 'contract-hash',
      trace_context: 'trace-123',
      dispatched_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      retry_count: 0,
    });

    expect(result.isDuplicate).toBe(true);
    expect(result.dispatch).toBe(existingDispatch);
  });

  it('validates message expiration', async () => {
    const valid = await handler.validateMessage({
      job_id: 'job-123',
      attempt_number: 1,
      service_id: 'company_evidence_graph.v1',
      service_version: '1.0.0',
      input_artifact_ref: 'artifact-123',
      contract_hash: 'contract-hash',
      trace_context: 'trace-123',
      dispatched_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      retry_count: 0,
    });

    expect(valid.valid).toBe(true);

    const expired = await handler.validateMessage({
      job_id: 'job-123',
      attempt_number: 1,
      service_id: 'company_evidence_graph.v1',
      service_version: '1.0.0',
      input_artifact_ref: 'artifact-123',
      contract_hash: 'contract-hash',
      trace_context: 'trace-123',
      dispatched_at: new Date().toISOString(),
      expires_at: new Date(Date.now() - 1000).toISOString(),
      retry_count: 0,
    });

    expect(expired.valid).toBe(false);
    expect(expired.reason).toBe('Message expired');
  });

  it('validates max retries', async () => {
    const result = await handler.validateMessage({
      job_id: 'job-123',
      attempt_number: 1,
      service_id: 'company_evidence_graph.v1',
      service_version: '1.0.0',
      input_artifact_ref: 'artifact-123',
      contract_hash: 'contract-hash',
      trace_context: 'trace-123',
      dispatched_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      retry_count: 6,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Max retries exceeded');
  });
});
