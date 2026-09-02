/**
 * SUN-1222B-S3R — proves `ModalDocumentWorkerBridge`'s real request/
 * response mapping and fail-closed behavior against a mocked `fetch` (the
 * network boundary), never a fake business-result executor hidden behind
 * it. Mirrors the "controlled local HTTP test server / mock transport at
 * the network boundary" pattern.
 */
import { describe, expect, it } from 'vitest';
import { ModalDocumentWorkerBridge } from './worker-bridge-http';
import type { DocumentWorkerRequest } from './worker-bridge';

const REQUEST: DocumentWorkerRequest = {
  bytes: new Uint8Array([1, 2, 3, 4]),
  mediaType: 'application/pdf',
  ocrPolicy: 'if_needed',
  tablePolicy: 'extract',
};

describe('ModalDocumentWorkerBridge', () => {
  it('fails closed (throws) when constructed with any missing credential -- never a silent fixture path', () => {
    expect(
      () =>
        new ModalDocumentWorkerBridge({
          endpointUrl: '',
          proxyKey: 'k',
          proxySecret: 's',
        })
    ).toThrow(/misconfigured/);
    expect(
      () =>
        new ModalDocumentWorkerBridge({
          endpointUrl: 'https://example.modal.run',
          proxyKey: '',
          proxySecret: 's',
        })
    ).toThrow(/misconfigured/);
  });

  it('sends Modal-Key/Modal-Secret proxy-auth headers and base64-encoded content, never the raw bytes', async () => {
    let capturedRequest: Request | undefined;
    const fetchFn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      capturedRequest = new Request(input as string, init);
      return new Response(
        JSON.stringify({
          worker_result_version: '1.0.0',
          job_id: 'j1',
          status: 'success',
          document: { sha256: 'sha256:' + '0'.repeat(64), byte_length: 4, media_type: 'application/pdf', page_count: 1 },
          pages: [],
          warnings: [],
          limitations: [],
          failure: null,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    };
    const bridge = new ModalDocumentWorkerBridge({
      endpointUrl: 'https://example.modal.run',
      proxyKey: 'test-key',
      proxySecret: 'test-secret',
      fetchFn,
    });
    const result = await bridge.run(REQUEST);
    expect(result.status).toBe('success');
    expect(capturedRequest?.headers.get('Modal-Key')).toBe('test-key');
    expect(capturedRequest?.headers.get('Modal-Secret')).toBe('test-secret');
    const sentBody = await capturedRequest?.json();
    expect(sentBody.content_base64).toBe(Buffer.from(REQUEST.bytes).toString('base64'));
    expect(sentBody.media_type).toBe('application/pdf');
  });

  it('resolves a WorkerResult with status "failed" (never throws) on a network error', async () => {
    const fetchFn = async (): Promise<Response> => {
      throw new TypeError('network unreachable');
    };
    const bridge = new ModalDocumentWorkerBridge({
      endpointUrl: 'https://example.modal.run',
      proxyKey: 'k',
      proxySecret: 's',
      fetchFn,
    });
    const result = await bridge.run(REQUEST);
    expect(result.status).toBe('failed');
    expect(result.failure?.code).toBe('DOCWORKER_TRANSPORT_ERROR');
    expect(result.document).toBeNull();
  });

  it('resolves a WorkerResult with status "failed" on a non-2xx HTTP response, surfacing the remote reason_code', async () => {
    const fetchFn = async (): Promise<Response> =>
      new Response(
        JSON.stringify({ result_class: 'failure', reason_code: 'DOCWORKER_BYTE_LIMIT_EXCEEDED', message: 'too big' }),
        { status: 413 }
      );
    const bridge = new ModalDocumentWorkerBridge({
      endpointUrl: 'https://example.modal.run',
      proxyKey: 'k',
      proxySecret: 's',
      fetchFn,
    });
    const result = await bridge.run(REQUEST);
    expect(result.status).toBe('failed');
    expect(result.failure?.code).toBe('DOCWORKER_BYTE_LIMIT_EXCEEDED');
    expect(result.failure?.retryable).toBe(false);
  });

  it('resolves a WorkerResult with status "failed" on malformed (non-JSON) response body', async () => {
    const fetchFn = async (): Promise<Response> => new Response('not json', { status: 200 });
    const bridge = new ModalDocumentWorkerBridge({
      endpointUrl: 'https://example.modal.run',
      proxyKey: 'k',
      proxySecret: 's',
      fetchFn,
    });
    const result = await bridge.run(REQUEST);
    expect(result.status).toBe('failed');
    expect(result.failure?.code).toBe('DOCWORKER_MALFORMED_RESPONSE');
  });

  it('resolves a WorkerResult with status "failed" on a schema-mismatched 200 body (defense in depth)', async () => {
    const fetchFn = async (): Promise<Response> =>
      new Response(JSON.stringify({ unexpected: 'shape' }), { status: 200 });
    const bridge = new ModalDocumentWorkerBridge({
      endpointUrl: 'https://example.modal.run',
      proxyKey: 'k',
      proxySecret: 's',
      fetchFn,
    });
    const result = await bridge.run(REQUEST);
    expect(result.status).toBe('failed');
    expect(result.failure?.code).toBe('DOCWORKER_SCHEMA_MISMATCH');
  });

  it('resolves a WorkerResult with status "failed" and retryable=true on a timeout', async () => {
    const fetchFn = (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    const bridge = new ModalDocumentWorkerBridge({
      endpointUrl: 'https://example.modal.run',
      proxyKey: 'k',
      proxySecret: 's',
      fetchFn,
      timeoutMs: 20,
    });
    const result = await bridge.run(REQUEST);
    expect(result.status).toBe('failed');
    expect(result.failure?.code).toBe('DOCWORKER_TIMEOUT');
    expect(result.failure?.retryable).toBe(true);
  });
});
