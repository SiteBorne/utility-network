/**
 * SUN-1221C — closes the DNS-rebinding gap `http-ssrf.test.ts`'s own header
 * comment already documented as open ("Injected DNS-answer validation: not
 * implemented... Connection pinning / rebinding protection: not
 * implemented... not proven here").
 *
 * Two layers, tested separately:
 * 1. `resolveSafeAddress` — resolves a hostname via a fixed, trusted DoH
 *    endpoint (never the target itself) and evaluates every returned
 *    address against the same private/loopback/link-local/multicast/
 *    reserved policy `validateUrl` already applies to literal IPs. Fails
 *    closed on zero answers or ANY prohibited/mixed answer.
 * 2. `SafeSocketHttpClient` — proves the actual TOCTOU-closing invariant:
 *    the raw `connect()` call is always made with the validated literal IP,
 *    never with the original hostname, so a second, independent DNS
 *    resolution inside the connect step is structurally impossible (a
 *    literal IP has nothing left to resolve).
 */
import { describe, it, expect, vi } from 'vitest';
import { resolveSafeAddress, isProhibitedResolvedIp } from '../http/safe-dns-resolve';
import { SafeSocketHttpClient, type ConnectFn, type SocketLike } from '../http/socket-http-client';
import { createTestClock } from '../context';

function dohHttpClient(answers: {
  A?: Array<{ type: number; data: string }>;
  AAAA?: Array<{ type: number; data: string }>;
}) {
  const calledUrls: string[] = [];
  return {
    calledUrls,
    async fetch(input: RequestInfo | URL) {
      const url = input instanceof URL ? input.toString() : input.toString();
      calledUrls.push(url);
      const type = url.includes('type=AAAA') ? 'AAAA' : 'A';
      const list = answers[type] ?? [];
      return new Response(JSON.stringify({ Status: 0, Answer: list }), {
        status: 200,
        headers: { 'content-type': 'application/dns-json' },
      });
    },
  };
}

describe('resolveSafeAddress — DoH resolution fails closed on prohibited/mixed answers', () => {
  it('rejects a hostname whose only A answer is a private IPv4 address', async () => {
    const client = dohHttpClient({ A: [{ type: 1, data: '10.0.0.5' }] });
    const result = await resolveSafeAddress(client, 'evil-rebind.example.com');
    expect(result.safe).toBe(false);
    expect(result.reason).toBe('prohibited_or_mixed_dns_answer');
  });

  it('rejects a hostname whose only A answer is the cloud-metadata link-local address', async () => {
    const client = dohHttpClient({ A: [{ type: 1, data: '169.254.169.254' }] });
    const result = await resolveSafeAddress(client, 'evil-metadata.example.com');
    expect(result.safe).toBe(false);
  });

  it('rejects a hostname whose only AAAA answer is IPv6 loopback', async () => {
    const client = dohHttpClient({ AAAA: [{ type: 28, data: '::1' }] });
    const result = await resolveSafeAddress(client, 'evil-v6.example.com');
    expect(result.safe).toBe(false);
  });

  it('rejects a hostname whose only AAAA answer is an IPv4-mapped private address', async () => {
    const client = dohHttpClient({ AAAA: [{ type: 28, data: '::ffff:192.168.1.1' }] });
    const result = await resolveSafeAddress(client, 'evil-mapped.example.com');
    expect(result.safe).toBe(false);
  });

  it('rejects a hostname returning a MIX of one public and one private A answer', async () => {
    const client = dohHttpClient({
      A: [
        { type: 1, data: '93.184.216.34' },
        { type: 1, data: '10.0.0.1' },
      ],
    });
    const result = await resolveSafeAddress(client, 'mixed-answers.example.com');
    expect(result.safe).toBe(false);
    expect(result.reason).toBe('prohibited_or_mixed_dns_answer');
  });

  it('rejects a hostname that resolves to zero answers', async () => {
    const client = dohHttpClient({});
    const result = await resolveSafeAddress(client, 'nowhere.example.com');
    expect(result.safe).toBe(false);
    expect(result.reason).toBe('dns_resolution_returned_no_answers');
  });

  it('accepts a hostname whose only answer is a genuinely public IPv4 address', async () => {
    const client = dohHttpClient({ A: [{ type: 1, data: '93.184.216.34' }] });
    const result = await resolveSafeAddress(client, 'example.com');
    expect(result.safe).toBe(true);
    expect(result.selectedAddress).toEqual({ ip: '93.184.216.34', family: 4 });
  });

  it('queries the fixed, trusted DoH resolver -- never the target hostname itself', async () => {
    const client = dohHttpClient({ A: [{ type: 1, data: '93.184.216.34' }] });
    await resolveSafeAddress(client, 'example.com');
    for (const url of client.calledUrls) {
      expect(url).toMatch(/^https:\/\/cloudflare-dns\.com\/dns-query/);
    }
  });
});

describe('isProhibitedResolvedIp', () => {
  it('flags private, loopback, link-local, multicast, reserved IPv4', () => {
    expect(isProhibitedResolvedIp('10.1.2.3', 4)).toBe(true);
    expect(isProhibitedResolvedIp('127.0.0.1', 4)).toBe(true);
    expect(isProhibitedResolvedIp('169.254.169.254', 4)).toBe(true);
    expect(isProhibitedResolvedIp('224.0.0.1', 4)).toBe(true);
    expect(isProhibitedResolvedIp('0.0.0.0', 4)).toBe(true);
  });

  it('flags IPv6 loopback, link-local, unique-local, and mapped-private', () => {
    expect(isProhibitedResolvedIp('::1', 6)).toBe(true);
    expect(isProhibitedResolvedIp('fe80::1', 6)).toBe(true);
    expect(isProhibitedResolvedIp('fc00::1', 6)).toBe(true);
    expect(isProhibitedResolvedIp('::ffff:10.0.0.1', 6)).toBe(true);
  });

  it('does not flag a genuinely public address', () => {
    expect(isProhibitedResolvedIp('93.184.216.34', 4)).toBe(false);
    expect(isProhibitedResolvedIp('2606:2800:220:1:248:1893:25c8:1946', 6)).toBe(false);
  });
});

/** Builds a fake socket whose `.readable` yields `responseBytes` and whose
 * `.writable` captures every write into `written` for assertion. */
function fakeSocket(responseBytes: Uint8Array, written: Uint8Array[]): SocketLike {
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(responseBytes);
      controller.close();
    },
  });
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      written.push(chunk);
    },
  });
  const socket: SocketLike = {
    readable,
    writable,
    opened: Promise.resolve({}),
    closed: Promise.resolve(),
    async close() {},
    startTls() {
      return socket;
    },
  };
  return socket;
}

function httpResponseBytes(status: number, headers: Record<string, string>, body: string): Uint8Array {
  let text = `HTTP/1.1 ${status} OK\r\n`;
  for (const [k, v] of Object.entries(headers)) text += `${k}: ${v}\r\n`;
  text += `\r\n${body}`;
  return new TextEncoder().encode(text);
}

describe('SafeSocketHttpClient — connect() is always called with the validated literal IP, never the hostname', () => {
  it('proves the TOCTOU-closing invariant: DoH validates a public IP, connect() receives exactly that IP', async () => {
    const written: Uint8Array[] = [];
    const responseBytes = httpResponseBytes(200, { 'content-length': '2' }, 'ok');
    const connectCalls: Array<{ hostname: string; port: number }> = [];
    const connect: ConnectFn = (address) => {
      connectCalls.push(address);
      return fakeSocket(responseBytes, written);
    };
    const dohClient = dohHttpClient({ A: [{ type: 1, data: '93.184.216.34' }] });

    const client = new SafeSocketHttpClient({
      connect,
      dohHttpClient: dohClient,
      clock: createTestClock(),
    });

    const response = await client.fetch('https://example.com/path');

    expect(response.status).toBe(200);
    expect(connectCalls).toHaveLength(1);
    // The critical assertion: connect() received the DoH-validated literal
    // IP, not the original hostname -- a second, independent DNS
    // resolution at connect time is structurally impossible because there
    // is no hostname left for the runtime to re-resolve.
    expect(connectCalls[0].hostname).toBe('93.184.216.34');
    expect(connectCalls[0].hostname).not.toBe('example.com');
  });

  it('never calls connect() when DoH resolution is unsafe (private-IP answer)', async () => {
    const connectCalls: unknown[] = [];
    const connect: ConnectFn = (address) => {
      connectCalls.push(address);
      throw new Error('connect() must not be called for an unsafe resolution');
    };
    const dohClient = dohHttpClient({ A: [{ type: 1, data: '169.254.169.254' }] });
    const client = new SafeSocketHttpClient({ connect, dohHttpClient: dohClient, clock: createTestClock() });

    await expect(client.fetch('https://evil-rebind.example.com/')).rejects.toThrow();
    expect(connectCalls).toHaveLength(0);
  });

  it('never calls connect() when DoH resolution is unsafe (mixed public/private answers)', async () => {
    const connectCalls: unknown[] = [];
    const connect: ConnectFn = () => {
      connectCalls.push(true);
      throw new Error('connect() must not be called');
    };
    const dohClient = dohHttpClient({
      A: [
        { type: 1, data: '93.184.216.34' },
        { type: 1, data: '10.0.0.1' },
      ],
    });
    const client = new SafeSocketHttpClient({ connect, dohHttpClient: dohClient, clock: createTestClock() });

    await expect(client.fetch('https://mixed.example.com/')).rejects.toThrow();
    expect(connectCalls).toHaveLength(0);
  });

  it('skips DoH entirely for an already-validated literal public IP in the URL', async () => {
    const written: Uint8Array[] = [];
    const responseBytes = httpResponseBytes(200, { 'content-length': '2' }, 'ok');
    const connectCalls: Array<{ hostname: string; port: number }> = [];
    const connect: ConnectFn = (address) => {
      connectCalls.push(address);
      return fakeSocket(responseBytes, written);
    };
    const doh = vi.fn();
    const client = new SafeSocketHttpClient({
      connect,
      dohHttpClient: { fetch: doh },
      clock: createTestClock(),
    });

    await client.fetch('https://93.184.216.34/path');

    expect(doh).not.toHaveBeenCalled();
    expect(connectCalls[0].hostname).toBe('93.184.216.34');
  });

  it('rejects a literal private IP before ever calling connect() (existing validateUrl path, unchanged)', async () => {
    const connectCalls: unknown[] = [];
    const connect: ConnectFn = () => {
      connectCalls.push(true);
      throw new Error('must not be called');
    };
    const client = new SafeSocketHttpClient({
      connect,
      dohHttpClient: { fetch: vi.fn() },
      clock: createTestClock(),
    });

    await expect(client.fetch('https://169.254.169.254/latest/meta-data/')).rejects.toThrow();
    expect(connectCalls).toHaveLength(0);
  });

  it('sets expectedServerHostname to the original hostname for TLS, not the connected IP', async () => {
    const written: Uint8Array[] = [];
    const responseBytes = httpResponseBytes(200, { 'content-length': '2' }, 'ok');
    let capturedTlsOptions: { expectedServerHostname?: string } | undefined;
    const connect: ConnectFn = () => {
      const socket = fakeSocket(responseBytes, written);
      return {
        ...socket,
        startTls(options) {
          capturedTlsOptions = options;
          return socket;
        },
      };
    };
    const dohClient = dohHttpClient({ A: [{ type: 1, data: '93.184.216.34' }] });
    const client = new SafeSocketHttpClient({ connect, dohHttpClient: dohClient, clock: createTestClock() });

    await client.fetch('https://example.com/path');

    expect(capturedTlsOptions?.expectedServerHostname).toBe('example.com');
  });

  it('parses a chunked-transfer-encoded response body correctly', async () => {
    const written: Uint8Array[] = [];
    const chunked =
      'HTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\n\r\n5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n';
    const connect: ConnectFn = () =>
      fakeSocket(new TextEncoder().encode(chunked), written);
    const dohClient = dohHttpClient({ A: [{ type: 1, data: '93.184.216.34' }] });
    const client = new SafeSocketHttpClient({ connect, dohHttpClient: dohClient, clock: createTestClock() });

    const response = await client.fetch('https://example.com/path');
    const text = await response.text();

    expect(text).toBe('hello world');
  });

  it('enforces a maximum response body size even over a raw socket', async () => {
    const written: Uint8Array[] = [];
    const bigBody = 'x'.repeat(1000);
    const responseBytes = httpResponseBytes(200, { 'content-length': String(bigBody.length) }, bigBody);
    const connect: ConnectFn = () => fakeSocket(responseBytes, written);
    const dohClient = dohHttpClient({ A: [{ type: 1, data: '93.184.216.34' }] });
    const client = new SafeSocketHttpClient({
      connect,
      dohHttpClient: dohClient,
      clock: createTestClock(),
      maxResponseBytes: 100,
    });

    await expect(client.fetch('https://example.com/path')).rejects.toThrow(/exceed(s)? maximum size/);
  });

  it('enforces the Content-Length-specific bound distinctly from the header-buffering bound (headers arrive in one small chunk well under the limit; only the body, streamed across many chunks, crosses it)', async () => {
    const headerBytes = new TextEncoder().encode(
      'HTTP/1.1 200 OK\r\ncontent-length: 1000\r\n\r\n'
    );
    const bodyChunk = new TextEncoder().encode('y'.repeat(50));
    const readable = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(headerBytes); // ~43 bytes -- well under maxResponseBytes=200
        for (let i = 0; i < 20; i++) controller.enqueue(bodyChunk); // 20 x 50 = 1000 bytes total
        controller.close();
      },
    });
    const written: Uint8Array[] = [];
    const writable = new WritableStream<Uint8Array>({ write: (c) => void written.push(c) });
    const socket: SocketLike = {
      readable,
      writable,
      opened: Promise.resolve({}),
      closed: Promise.resolve(),
      async close() {},
      startTls() {
        return socket;
      },
    };
    const connect: ConnectFn = () => socket;
    const dohClient = dohHttpClient({ A: [{ type: 1, data: '93.184.216.34' }] });
    const client = new SafeSocketHttpClient({
      connect,
      dohHttpClient: dohClient,
      clock: createTestClock(),
      maxResponseBytes: 200,
    });

    await expect(client.fetch('https://example.com/path')).rejects.toThrow(
      /Response exceeds maximum size: 1000 > 200/
    );
  });

  it('rejects a non-GET method BEFORE ever calling connect() -- the wire request always literally says GET regardless of init.method, so only this early guard distinguishes "rejected" from "silently sent as GET"', async () => {
    const written: Uint8Array[] = [];
    const responseBytes = httpResponseBytes(200, { 'content-length': '2' }, 'ok');
    const connectCalls: unknown[] = [];
    const connect: ConnectFn = (address) => {
      connectCalls.push(address);
      return fakeSocket(responseBytes, written);
    };
    const dohClient = dohHttpClient({ A: [{ type: 1, data: '93.184.216.34' }] });
    const client = new SafeSocketHttpClient({ connect, dohHttpClient: dohClient, clock: createTestClock() });

    await expect(client.fetch('https://example.com/', { method: 'POST' })).rejects.toThrow(
      /only supports GET/
    );
    expect(connectCalls).toHaveLength(0);
  });
});
