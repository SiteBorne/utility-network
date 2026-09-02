/**
 * SUN-1222B-S3R — the Worker-reachable `DocumentWorkerBridge` for
 * `document_evidence_json.v2`: an HTTP client calling the deployed Modal
 * `process_document_http` endpoint (`services/modal-worker/src/modal_worker/
 * modal_app.py`), mirroring `webctx-safe-egress`'s `ModalSafeEgressClient`
 * (`@siteborne/provider-adapters`) request/auth shape -- Modal's
 * `requires_proxy_auth=True` platform gate expects the `Modal-Key` /
 * `Modal-Secret` header pair, never a bespoke auth scheme.
 *
 * Deliberately NEVER falls back to `SubprocessDocumentWorkerBridge`
 * (`node:child_process` does not exist in the Workers runtime) or to any
 * fixture/canned `WorkerResult` -- on any transport/schema failure this
 * resolves a real `WorkerResult` with `status: 'failed'` and a
 * `WorkerFailure`, exactly the shape `DocumentEvidenceJsonService.execute`
 * already handles via its `worker.status === 'failed'` branch (never
 * throws -- `DocumentWorkerBridge.run` is documented to always resolve).
 */
import type { DocumentWorkerBridge, DocumentWorkerRequest } from './worker-bridge';
import type { WorkerFailure, WorkerResult } from './worker-result-types';

export interface ModalDocumentWorkerBridgeConfig {
  /** The deployed `process_document_http` endpoint URL -- fails closed
   * (constructor throws) if empty, matching `ModalSafeEgressClient`'s own
   * fail-closed-on-missing-config convention. */
  endpointUrl: string;
  /** Modal's own platform-enforced proxy-auth token pair
   * (`requires_proxy_auth=True`) -- sent as `Modal-Key`/`Modal-Secret`
   * headers, never logged, never included in any error message this
   * class produces. */
  proxyKey: string;
  proxySecret: string;
  /** Overridable only for tests -- defaults to the real platform `fetch`. */
  fetchFn?: typeof fetch;
  /** Milliseconds before this bridge gives up and resolves a `TIMEOUT`
   * failure -- bounded, never unbounded, matching the worker's own
   * `MAX_TIMEOUT_MS` (300_000) contract. */
  timeoutMs?: number;
}

function toBase64(bytes: Uint8Array): string {
  // Workers runtime has no `Buffer` by default in every context -- chunked
  // `String.fromCharCode` avoids both a `Buffer` dependency and blowing the
  // call stack on large documents (bounded at 10 MiB by the frozen
  // contract regardless).
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function failureResult(jobId: string, failure: WorkerFailure): WorkerResult {
  return {
    worker_result_version: '1.0.0',
    job_id: jobId,
    status: 'failed',
    document: null,
    pages: [],
    warnings: [],
    limitations: [],
    failure,
  };
}

/**
 * `DocumentWorkerRequest` has no `job_id`/`request_id` (that's a
 * `DocumentEvidenceJsonService`-internal concept `worker-bridge.ts`'s
 * interface never needed before this bridge). Generates fresh IDs per
 * call via the platform `crypto.randomUUID()` -- always available in
 * Workers, never a fixture/deterministic ID standing in for a real one.
 */
export class ModalDocumentWorkerBridge implements DocumentWorkerBridge {
  private readonly endpointUrl: string;
  private readonly proxyKey: string;
  private readonly proxySecret: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(config: ModalDocumentWorkerBridgeConfig) {
    if (!config.endpointUrl || !config.proxyKey || !config.proxySecret) {
      throw new Error(
        'modal_document_worker_bridge_misconfigured: endpointUrl/proxyKey/proxySecret are all required -- ' +
          'never constructed with any missing, matching ModalSafeEgressClient\'s fail-closed convention'
      );
    }
    this.endpointUrl = config.endpointUrl;
    this.proxyKey = config.proxyKey;
    this.proxySecret = config.proxySecret;
    this.fetchFn = config.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = config.timeoutMs ?? 60_000;
  }

  async run(request: DocumentWorkerRequest): Promise<WorkerResult> {
    const jobId = crypto.randomUUID();
    const requestId = crypto.randomUUID();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchFn(this.endpointUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Modal-Key': this.proxyKey,
          'Modal-Secret': this.proxySecret,
        },
        body: JSON.stringify({
          job_id: jobId,
          request_id: requestId,
          media_type: request.mediaType,
          content_base64: toBase64(request.bytes),
          ocr_policy: request.ocrPolicy ?? 'if_needed',
          table_policy: request.tablePolicy ?? 'extract',
        }),
        signal: controller.signal,
      });
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError';
      return failureResult(jobId, {
        code: aborted ? 'DOCWORKER_TIMEOUT' : 'DOCWORKER_TRANSPORT_ERROR',
        message: aborted
          ? `document worker request timed out after ${this.timeoutMs}ms`
          : `document worker request failed: ${err instanceof Error ? err.message : String(err)}`,
        retryable: aborted,
        stage: 'transport',
        partial_result_available: false,
      });
    } finally {
      clearTimeout(timeout);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return failureResult(jobId, {
        code: 'DOCWORKER_MALFORMED_RESPONSE',
        message: `document worker returned non-JSON response (status ${response.status})`,
        retryable: false,
        stage: 'response_parsing',
        partial_result_available: false,
      });
    }

    if (!response.ok) {
      const reason =
        body && typeof body === 'object' && 'reason_code' in body
          ? String((body as Record<string, unknown>).reason_code)
          : 'DOCWORKER_HTTP_ERROR';
      const message =
        body && typeof body === 'object' && 'message' in body
          ? String((body as Record<string, unknown>).message)
          : `document worker returned HTTP ${response.status}`;
      return failureResult(jobId, {
        code: reason,
        message,
        retryable: response.status >= 500,
        stage: 'remote_execution',
        partial_result_available: false,
      });
    }

    // Structural shape check only (defense-in-depth) -- the deployed
    // endpoint's own `WorkerResult.model_dump(mode="json")` is the real
    // schema authority; this never reimplements Pydantic validation.
    if (
      !body ||
      typeof body !== 'object' ||
      typeof (body as Record<string, unknown>).status !== 'string' ||
      !Array.isArray((body as Record<string, unknown>).pages)
    ) {
      return failureResult(jobId, {
        code: 'DOCWORKER_SCHEMA_MISMATCH',
        message: 'document worker response did not match the expected WorkerResult shape',
        retryable: false,
        stage: 'response_validation',
        partial_result_available: false,
      });
    }

    return body as WorkerResult;
  }
}
