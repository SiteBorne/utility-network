import type { InjectedHttpClient, InjectedClock } from '../context';
import type { NetworkPolicy } from '../policy/network-policy';
import type { HTTPMetadata } from '../types';
import {
  validateUrl,
  validateRedirectChain,
  DEFAULT_NETWORK_POLICY,
} from '../policy/network-policy';
import { computeContentHash } from '../evidence/source-observation';
import { createHTTPMetadata } from '../evidence/source-observation';
import { parseRetryAfterMs } from '../rate-limit/backoff';
import {
  NotFoundError,
  PermanentFailureError,
  RateLimitedError,
  RetryableFailureError,
} from '../errors';

export interface HttpClientConfig {
  maxResponseBytes: number;
  maxRedirects: number;
  timeoutMs: number;
  allowedMediaTypes: string[];
  networkPolicy: NetworkPolicy;
  decompressionLimit: number;
}

export const DEFAULT_HTTP_CONFIG: HttpClientConfig = {
  maxResponseBytes: 10 * 1024 * 1024,
  maxRedirects: 10,
  timeoutMs: 30000,
  allowedMediaTypes: [
    'text/html',
    'application/json',
    'application/xml',
    'text/xml',
    'text/plain',
    'application/xhtml+xml',
  ],
  networkPolicy: DEFAULT_NETWORK_POLICY,
  decompressionLimit: 50 * 1024 * 1024,
};

export interface HttpResponse<T = unknown> {
  data: T;
  metadata: HTTPMetadata;
  contentHash: string;
  truncated: boolean;
}

/**
 * SUN-1222C2-Q1-R2: before this checkpoint, `SecureHttpClient.fetch()`
 * never inspected `response.status` beyond the five 3xx redirect codes --
 * every other status (200, 429, 403, 500, ...) fell through to
 * `readBoundedBody`/JSON parsing and was returned as an ordinary
 * successful `HttpResponse` as long as the body was JSON-parseable and the
 * media type allowed. A JSON-shaped 429/403/5xx body was therefore
 * indistinguishable from real provider data to every caller
 * (`sec-edgar-user-agent-compliance.test.ts`'s sibling
 * `secure-http-client-status-semantics.test.ts` proves this both before
 * and after this fix).
 *
 * Deliberately reuses this package's own existing `AdapterError` subclass
 * taxonomy (`errors.ts`) instead of inventing a new one:
 * `toAdapterResult()` already gives each subclass's `resultClass` special
 * handling, so every adapter built on `SecureHttpClient` gets the correct
 * result classification for free, with zero per-adapter changes needed.
 * Conservative, existing-architecture-derived mapping (SUN-1222C2-Q1-R2
 * §4/§7 -- no code path here was invented without a documented rationale):
 *  - 2xx: success, unchanged.
 *  - 404: `NotFoundError` (an existing, exact-match subclass).
 *  - 429: `RateLimitedError`, honoring a valid `Retry-After` if present
 *    (`parseRetryAfterMs` -- same bounded parser `ExponentialBackoff`
 *    already uses, so behavior is consistent repo-wide). Never fabricates
 *    a wait time when the header is absent or malformed.
 *  - 401/403: `PermanentFailureError` -- retrying the identical request
 *    cannot succeed without a credential/authorization change.
 *  - 408: `RetryableFailureError` -- a request timeout is transient by
 *    definition.
 *  - 5xx: `RetryableFailureError`, honoring `Retry-After` the same way as
 *    429 (503 in particular commonly carries one).
 *  - every other non-2xx status (other 4xx, and any 3xx this function
 *    would only see if the redirect loop above did NOT already consume
 *    it): `PermanentFailureError` -- fails closed rather than silently
 *    treating an unrecognized status as success.
 * Never includes the response body in the thrown error's message --
 * `readBoundedBody` is never called for a rejected status, so there is
 * nothing to leak, and the message text itself names only the status
 * code.
 */
function classifyTerminalHttpStatus(
  response: Response,
  clock: InjectedClock
): PermanentFailureError | RateLimitedError | RetryableFailureError | NotFoundError | null {
  const status = response.status;
  if (status >= 200 && status < 300) return null;
  // SUN-1222C2-Q1-R2 section 11 (cross-adapter regression): `304 Not
  // Modified` is an intentional SUCCESS outcome for a conditional GET
  // (If-None-Match/If-Modified-Since) -- `PublicHttpAdapter.fetchAndProcess`
  // deliberately depends on receiving a normal `HttpResponse` for it
  // (checks `response.metadata.status === 304` itself). Confirmed the only
  // such caller repo-wide (grep for `metadata.status ===` across every
  // SecureHttpClient consumer before this fix).
  if (status === 304) return null;

  const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'), clock.nowMs());

  if (status === 404) {
    return new NotFoundError(`HTTP 404: resource not found`);
  }
  if (status === 429) {
    return new RateLimitedError(`HTTP 429: rate limited`, retryAfterMs);
  }
  if (status === 401 || status === 403) {
    return new PermanentFailureError(`HTTP ${status}: forbidden or unauthorized`);
  }
  if (status === 408) {
    return new RetryableFailureError(`HTTP 408: request timeout`, retryAfterMs);
  }
  if (status >= 500 && status < 600) {
    return new RetryableFailureError(`HTTP ${status}: server error`, retryAfterMs);
  }
  return new PermanentFailureError(`HTTP ${status}: unexpected status`);
}

export class SecureHttpClient {
  private config: HttpClientConfig;
  private httpClient: InjectedHttpClient;
  private clock: InjectedClock;

  constructor(config: HttpClientConfig, httpClient: InjectedHttpClient, clock: InjectedClock) {
    this.config = config;
    this.httpClient = httpClient;
    this.clock = clock;
  }

  async fetch(url: string, options: RequestInit = {}): Promise<HttpResponse<Uint8Array>> {
    const parsedUrl = new URL(url);
    const urlValidation = validateUrl(parsedUrl, this.config.networkPolicy);
    if (!urlValidation.valid) {
      throw new Error(`URL validation failed: ${urlValidation.reason}`);
    }

    const controller = new AbortController();
    const timeoutId = this.clock.setTimeout(() => controller.abort(), this.config.timeoutMs);

    const redirectChain: string[] = [];
    let currentUrl = parsedUrl;
    let response: Response;

    try {
      let finalResponse: Response | null = null;
      for (let redirectCount = 0; redirectCount <= this.config.maxRedirects; redirectCount++) {
        redirectChain.push(currentUrl.toString());
        response = await this.httpClient.fetch(currentUrl.toString(), {
          ...options,
          signal: controller.signal,
          redirect: 'manual',
        });

        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location');
          if (!location) {
            throw new Error('Redirect without Location header');
          }

          const redirectUrl = new URL(location, currentUrl);
          const redirectValidation = validateUrl(redirectUrl, this.config.networkPolicy);
          if (!redirectValidation.valid) {
            throw new Error(`Redirect target validation failed: ${redirectValidation.reason}`);
          }

          currentUrl = redirectUrl;
        } else {
          finalResponse = response;
          break;
        }
      }

      if (!finalResponse) {
        throw new Error('Maximum redirects exceeded');
      }

      const chainValidation = validateRedirectChain(
        redirectChain.map((u) => new URL(u)),
        this.config.networkPolicy
      );
      if (!chainValidation.valid) {
        throw new Error(`Redirect chain validation failed: ${chainValidation.reason}`);
      }

      const statusError = classifyTerminalHttpStatus(finalResponse, this.clock);
      if (statusError) {
        throw statusError;
      }

      const contentType = finalResponse.headers.get('content-type') || '';
      const mediaType = contentType.split(';')[0].trim().toLowerCase();
      if (!this.config.allowedMediaTypes.includes(mediaType)) {
        throw new Error(`Media type not allowed: ${mediaType}`);
      }

      const contentLength = finalResponse.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > this.config.maxResponseBytes) {
        throw new Error(
          `Response exceeds maximum size: ${contentLength} > ${this.config.maxResponseBytes}`
        );
      }

      const body = await this.readBoundedBody(finalResponse);
      const contentHash = await computeContentHash(body);
      const truncated = body.length >= this.config.maxResponseBytes;

      const metadata = createHTTPMetadata(finalResponse, currentUrl.toString(), redirectChain);

      return {
        data: body,
        metadata,
        contentHash,
        truncated,
      };
    } finally {
      this.clock.clearTimeout(timeoutId);
    }
  }

  private async readBoundedBody(response: Response): Promise<Uint8Array> {
    const contentEncoding = response.headers.get('content-encoding')?.toLowerCase();
    const reader = response.body?.getReader();
    if (!reader) {
      return new Uint8Array(0);
    }

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    let decompressedBytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        totalBytes += value.length;
        if (totalBytes > this.config.maxResponseBytes) {
          throw new Error(`Response body exceeds maximum size during streaming`);
        }

        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    let body = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.length;
    }

    if (contentEncoding === 'gzip' || contentEncoding === 'deflate') {
      try {
        // Use DecompressionStream if available (Cloudflare Workers, modern browsers)
        // Fall back to manual decompression if not available
        if (typeof DecompressionStream !== 'undefined') {
          const decompressionStream = new DecompressionStream(contentEncoding);
          const response = new Response(body);
          // @ts-expect-error - pipeThrough is available in Cloudflare Workers
          const decompressed = await response.pipeThrough(decompressionStream).arrayBuffer();
          body = new Uint8Array(decompressed);
        } else {
          // For Node.js environments, we'll skip decompression for now
          // In production, use a proper decompression library
          throw new Error('Decompression not supported in this environment');
        }
        decompressedBytes = body.length;

        if (decompressedBytes > this.config.decompressionLimit) {
          throw new Error(
            `Decompressed response exceeds limit: ${decompressedBytes} > ${this.config.decompressionLimit}`
          );
        }
      } catch (e) {
        if (e instanceof Error && e.message.includes('exceeds limit')) throw e;
        throw new Error(`Decompression failed: ${e instanceof Error ? e.message : 'unknown'}`);
      }
    }

    return body;
  }

  async fetchText(url: string, options: RequestInit = {}): Promise<HttpResponse<string>> {
    const response = await this.fetch(url, options);
    const text = new TextDecoder('utf-8', { fatal: false }).decode(response.data);
    return {
      ...response,
      data: text,
    };
  }

  async fetchJson<T>(url: string, options: RequestInit = {}): Promise<HttpResponse<T>> {
    const response = await this.fetchText(url, options);
    let data: T;
    try {
      data = JSON.parse(response.data);
    } catch (e) {
      throw new Error(`JSON parse failed: ${e instanceof Error ? e.message : 'unknown'}`);
    }
    return {
      ...response,
      data,
    };
  }
}

export function createTestHttpClient(responses: Map<string, Response>): InjectedHttpClient {
  return {
    async fetch(input, _init) {
      const url = input instanceof URL ? input.toString() : input.toString();
      const response = responses.get(url);
      if (!response) {
        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
      }
      return response.clone();
    },
  };
}
