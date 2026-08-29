import type { InjectedHttpClient, InjectedClock } from '../types';
import type { NetworkPolicy } from '../policy/network-policy';
import { DEFAULT_NETWORK_POLICY, validateUrl } from '../policy/network-policy';
import { resolveSafeAddress } from './safe-dns-resolve';

/**
 * Minimal shape of the real `cloudflare:sockets` `Socket`, narrowed to
 * exactly what this client uses. `startTls`'s `expectedServerHostname`
 * (a real, typed field on the platform's own `TlsOptions`, confirmed
 * against `@cloudflare/workers-types`) is the mechanism that lets this
 * client pin the TCP connection to a validated literal IP while TLS
 * certificate validation still checks against the real hostname -- the
 * IP and the hostname are deliberately supplied to two different calls.
 */
export interface SocketLike {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  opened: Promise<{ remoteAddress?: string; localAddress?: string }>;
  closed: Promise<void>;
  close(): Promise<void>;
  startTls(options?: { expectedServerHostname?: string }): SocketLike;
}

export type ConnectFn = (
  address: { hostname: string; port: number },
  options?: { secureTransport?: 'off' | 'on' | 'starttls'; allowHalfOpen?: boolean }
) => SocketLike;

export interface SafeSocketHttpClientConfig {
  /** The real `connect` from `cloudflare:sockets` in production; a fake
   * in tests. Injected, never imported directly, so this module never
   * touches the real Workers-runtime-only global at test time. */
  connect: ConnectFn;
  /** Used ONLY for the DoH lookup itself (a fixed, trusted resolver) --
   * never for the buyer-supplied target URL. */
  dohHttpClient: InjectedHttpClient;
  clock: InjectedClock;
  networkPolicy?: NetworkPolicy;
  maxResponseBytes?: number;
}

const CRLF = '\r\n';
const CR = 13;
const LF = 10;

/**
 * An `InjectedHttpClient` that closes the DNS-rebinding gap SUN-1221B
 * found in `validateUrl` (it only inspects the URL's literal hostname
 * string, never a resolved address). This client:
 *
 * 1. Runs the existing `validateUrl` first (unchanged, defense in depth
 *    -- rejects literal private IPs / bad ports / bad schemes / the
 *    `localhost` literal exactly as before, with zero DNS lookup).
 * 2. If the hostname is already a literal IP, `validateUrl` alone proved
 *    it safe -- connects directly to it, no DNS involved at all.
 * 3. Otherwise resolves the hostname via `resolveSafeAddress` (a fixed,
 *    trusted DoH resolver -- never the target) and fails closed on any
 *    unsafe/mixed/empty result.
 * 4. Connects via the injected `connect()` using the exact validated
 *    literal IP as `SocketAddress.hostname` -- a socket connect to a
 *    literal IP has no hostname left for the runtime to independently
 *    re-resolve, closing the TOCTOU window structurally rather than by
 *    convention. TLS (`startTls`) separately pins `expectedServerHostname`
 *    to the real hostname, so certificate validation is unaffected.
 * 5. Speaks a minimal hand-rolled HTTP/1.1 GET (the only method this
 *    codebase's real caller, `PublicHttpAdapter`, ever issues) over the
 *    raw socket, since Workers' `fetch()` cannot be pointed at a
 *    pre-opened socket. Supports `Content-Length` and `Transfer-Encoding:
 *    chunked` response bodies, and enforces its own response-size bound
 *    during the read loop (defense in depth alongside `SecureHttpClient`'s
 *    own streaming bound).
 *
 * Every hop of `SecureHttpClient`'s existing redirect-following loop
 * calls `this.httpClient.fetch(...)` again for each new URL -- wiring
 * this class in as that `httpClient` therefore re-runs this entire
 * resolve-validate-connect pipeline on every redirect hop for free,
 * without any change to `SecureHttpClient` itself.
 */
export class SafeSocketHttpClient implements InjectedHttpClient {
  private readonly policy: NetworkPolicy;
  private readonly maxResponseBytes: number;

  constructor(private readonly config: SafeSocketHttpClientConfig) {
    this.policy = config.networkPolicy ?? DEFAULT_NETWORK_POLICY;
    this.maxResponseBytes = config.maxResponseBytes ?? 10 * 1024 * 1024;
  }

  async fetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const method = (init.method ?? 'GET').toUpperCase();
    if (method !== 'GET') {
      throw new Error(`SafeSocketHttpClient only supports GET, got ${method}`);
    }

    const rawUrl = input instanceof Request ? input.url : input.toString();
    const url = new URL(rawUrl);

    const literalValidation = validateUrl(url, this.policy);
    if (!literalValidation.valid) {
      throw new Error(`URL validation failed: ${literalValidation.reason}`);
    }

    const hostname = stripBrackets(url.hostname);
    const connectIp = isIpLiteral(hostname) ? hostname : await this.resolveOrThrow(hostname);

    const port = url.port ? parseInt(url.port, 10) : url.protocol === 'https:' ? 443 : 80;
    const isHttps = url.protocol === 'https:';

    let socket: SocketLike;
    try {
      socket = this.config.connect(
        { hostname: connectIp, port },
        { secureTransport: isHttps ? 'starttls' : 'off', allowHalfOpen: false }
      );
      if (isHttps) {
        socket = socket.startTls({ expectedServerHostname: hostname });
      }
    } catch (err) {
      // SUN-1221E2D — `connect()`/`startTls()` call straight into the real
      // `cloudflare:sockets` platform with no prior wrapping anywhere in
      // this codebase; whatever raw, unclassified error the platform
      // throws here used to propagate all the way to
      // `toAdapterResult`'s generic-`Error` fallback indistinguishable
      // from every other failure class. Tagged with a stable, parseable
      // prefix `errors.ts`'s `classifyGenericAdapterErrorReason` now
      // recognizes; the original is preserved verbatim via `cause`,
      // never discarded.
      throw new Error(
        `WEBCTX_UPSTREAM_CONNECTION_FAILED: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err }
      );
    }

    await this.writeRequest(socket, url, hostname, init.headers);
    const { status, statusText, responseHeaders, body } = await this.readResponse(socket.readable);

    return new Response(body, { status, statusText, headers: responseHeaders });
  }

  private async resolveOrThrow(hostname: string): Promise<string> {
    const resolution = await resolveSafeAddress(this.config.dohHttpClient, hostname);
    if (!resolution.safe || !resolution.selectedAddress) {
      throw new Error(`DNS resolution failed safety policy: ${resolution.reason ?? 'unknown'}`);
    }
    return resolution.selectedAddress.ip;
  }

  private async writeRequest(
    socket: SocketLike,
    url: URL,
    hostname: string,
    initHeaders: HeadersInit | undefined
  ): Promise<void> {
    const headers = new Headers(initHeaders);
    if (!headers.has('host')) headers.set('host', hostname);
    if (!headers.has('connection')) headers.set('connection', 'close');
    if (!headers.has('accept-encoding')) headers.set('accept-encoding', 'identity');

    const path = url.pathname + url.search;
    let requestText = `GET ${path} HTTP/1.1${CRLF}`;
    headers.forEach((value, key) => {
      requestText += `${key}: ${value}${CRLF}`;
    });
    requestText += CRLF;

    const writer = socket.writable.getWriter();
    try {
      await writer.write(new TextEncoder().encode(requestText));
    } catch (err) {
      // SUN-1221E2D — same reasoning as the connect/TLS wrap above: a raw
      // platform write failure (e.g. the connection was reset while
      // sending the request) used to propagate completely unwrapped. The
      // secondary `close()` failure that closing an already-failed
      // writer usually produces is deliberately swallowed here so it
      // never masks the real, original write failure -- a masked reason
      // is itself a silent branch (SUN-1221E2D §0).
      try {
        await writer.close();
      } catch {
        // secondary failure closing an already-failed writer; the
        // original write error below already tells the real story.
      }
      throw new Error(
        `WEBCTX_REQUEST_WRITE_FAILED: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err }
      );
    }
    await writer.close();
  }

  private async readResponse(readable: ReadableStream<Uint8Array>): Promise<{
    status: number;
    statusText: string;
    responseHeaders: Headers;
    body: Uint8Array;
  }> {
    const reader = readable.getReader();
    let buffered = new Uint8Array(0);

    try {
      let headerEnd = -1;
      while (headerEnd === -1) {
        const { done, value } = await reader.read();
        if (done) throw new Error('Connection closed before response headers completed');
        buffered = concat(buffered, value);
        if (buffered.length > this.maxResponseBytes) {
          throw new Error('Response headers exceed maximum size');
        }
        headerEnd = findCrlfCrlf(buffered);
      }

      const headerText = new TextDecoder('ascii').decode(buffered.slice(0, headerEnd));
      const lines = headerText.split(CRLF).filter((l) => l.length > 0);
      const statusLine = lines[0] ?? '';
      const statusMatch = /^HTTP\/1\.[01] (\d{3})\s?(.*)$/.exec(statusLine);
      if (!statusMatch) throw new Error(`Malformed status line: ${statusLine}`);
      const status = parseInt(statusMatch[1], 10);
      const statusText = statusMatch[2] ?? '';

      const responseHeaders = new Headers();
      for (const line of lines.slice(1)) {
        const idx = line.indexOf(':');
        if (idx === -1) continue;
        responseHeaders.append(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
      }

      let bodyBytes = buffered.slice(headerEnd);
      const transferEncoding = responseHeaders.get('transfer-encoding')?.toLowerCase();
      const contentLengthHeader = responseHeaders.get('content-length');

      if (transferEncoding === 'chunked') {
        bodyBytes = await this.readChunkedBody(reader, bodyBytes);
      } else if (contentLengthHeader) {
        const contentLength = parseInt(contentLengthHeader, 10);
        if (contentLength > this.maxResponseBytes) {
          throw new Error(
            `Response exceeds maximum size: ${contentLength} > ${this.maxResponseBytes}`
          );
        }
        bodyBytes = await this.readUntil(reader, bodyBytes, contentLength);
      } else {
        bodyBytes = await this.readUntilClose(reader, bodyBytes);
      }

      return { status, statusText, responseHeaders, body: bodyBytes };
    } finally {
      reader.releaseLock();
    }
  }

  private async readUntil(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    initial: Uint8Array,
    targetLength: number
  ): Promise<Uint8Array> {
    let buffered = initial;
    while (buffered.length < targetLength) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered = concat(buffered, value);
      if (buffered.length > this.maxResponseBytes) {
        throw new Error('Response body exceeds maximum size during streaming');
      }
    }
    return buffered;
  }

  private async readUntilClose(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    initial: Uint8Array
  ): Promise<Uint8Array> {
    let buffered = initial;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered = concat(buffered, value);
      if (buffered.length > this.maxResponseBytes) {
        throw new Error('Response body exceeds maximum size during streaming');
      }
    }
    return buffered;
  }

  private async readChunkedBody(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    initial: Uint8Array
  ): Promise<Uint8Array> {
    let buffered = initial;
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    const ensure = async (minBytes: number): Promise<void> => {
      while (buffered.length < minBytes) {
        const { done, value } = await reader.read();
        if (done) throw new Error('Connection closed mid-chunk');
        buffered = concat(buffered, value);
      }
    };

    while (true) {
      let lineEnd = findCrlf(buffered);
      while (lineEnd === -1) {
        await ensure(buffered.length + 1);
        lineEnd = findCrlf(buffered);
      }
      const sizeLine = new TextDecoder('ascii')
        .decode(buffered.slice(0, lineEnd))
        .split(';')[0]
        .trim();
      const size = parseInt(sizeLine, 16);
      if (Number.isNaN(size)) throw new Error(`Malformed chunk size: ${sizeLine}`);
      buffered = buffered.slice(lineEnd + 2);

      if (size === 0) break;

      await ensure(size + 2);
      chunks.push(buffered.slice(0, size));
      totalBytes += size;
      if (totalBytes > this.maxResponseBytes) {
        throw new Error('Response body exceeds maximum size during streaming');
      }
      buffered = buffered.slice(size + 2);
    }

    const out = new Uint8Array(totalBytes);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.length;
    }
    return out;
  }
}

function isIpLiteral(hostname: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.includes(':');
}

function stripBrackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function findCrlf(buf: Uint8Array): number {
  for (let i = 0; i + 1 < buf.length; i++) {
    if (buf[i] === CR && buf[i + 1] === LF) return i;
  }
  return -1;
}

function findCrlfCrlf(buf: Uint8Array): number {
  for (let i = 0; i + 3 < buf.length; i++) {
    if (buf[i] === CR && buf[i + 1] === LF && buf[i + 2] === CR && buf[i + 3] === LF) {
      return i + 4;
    }
  }
  return -1;
}
