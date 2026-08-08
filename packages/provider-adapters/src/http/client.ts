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
