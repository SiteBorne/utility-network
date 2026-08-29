/**
 * SUN-1221E2D — closes the second silent-diagnostic gap SUN-1221E2R
 * traced: `SafeSocketHttpClient.fetch()`'s connect/TLS step and its
 * request-write step call straight into the real `cloudflare:sockets`
 * platform with NO try/catch at all (`socket-http-client.ts`, confirmed
 * by direct source inspection) -- whatever raw, unclassified error the
 * platform throws there propagates unwrapped, all the way up through
 * `SecureHttpClient` and `PublicHttpAdapter`, arriving at
 * `toAdapterResult`'s generic-`Error` fallback with nothing to
 * distinguish it from any other failure. These are the exact `RED`
 * tests for §5/§6 of the checkpoint: the current, unmodified source
 * genuinely propagates the raw message with no diagnostic tag.
 */
import { describe, it, expect } from 'vitest';
import { SafeSocketHttpClient, type ConnectFn, type SocketLike } from '../http/socket-http-client';
import { createTestClock } from '../context';

function dohHttpClient(answers: { A?: Array<{ type: number; data: string }> }) {
  return {
    async fetch(input: RequestInfo | URL) {
      const url = input instanceof URL ? input.toString() : input.toString();
      const type = url.includes('type=AAAA') ? 'AAAA' : 'A';
      const list = (answers as Record<string, Array<{ type: number; data: string }>>)[type] ?? [];
      return new Response(JSON.stringify({ Status: 0, Answer: list }), {
        status: 200,
        headers: { 'content-type': 'application/dns-json' },
      });
    },
  };
}

const PUBLIC_ANSWER = dohHttpClient({ A: [{ type: 1, data: '93.184.216.34' }] });

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

/** A socket whose `writable` rejects every write — simulates a platform
 * write-time failure (e.g. connection reset while sending the request). */
function socketWithFailingWrite(failureMessage: string): SocketLike {
  const readable = new ReadableStream<Uint8Array>();
  const writable = new WritableStream<Uint8Array>({
    write() {
      throw new Error(failureMessage);
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

describe('SUN-1221E2D — SafeSocketHttpClient connect/TLS-step failures are now diagnostically tagged', () => {
  it('tags a raw connect() throw with the WEBCTX_UPSTREAM_CONNECTION_FAILED prefix and preserves the original as .cause', async () => {
    const connect: ConnectFn = () => {
      throw new Error('platform connection refused (raw, unwrapped)');
    };
    const client = new SafeSocketHttpClient({ connect, dohHttpClient: PUBLIC_ANSWER, clock: createTestClock() });

    await expect(client.fetch('https://example.com/')).rejects.toMatchObject({
      message: expect.stringMatching(/^WEBCTX_UPSTREAM_CONNECTION_FAILED: platform connection refused/),
    });

    try {
      await client.fetch('https://example.com/');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).cause).toBeInstanceOf(Error);
      expect(((err as Error).cause as Error).message).toBe('platform connection refused (raw, unwrapped)');
    }
  });

  it('tags a raw startTls() throw the same way (TLS handshake step is inside the same connect try/catch)', async () => {
    const connect: ConnectFn = () => ({
      readable: new ReadableStream<Uint8Array>({ start() {} }),
      writable: new WritableStream<Uint8Array>(),
      opened: Promise.resolve({}),
      closed: Promise.resolve(),
      async close() {},
      startTls() {
        throw new Error('tls handshake rejected (raw, unwrapped)');
      },
    });
    const client = new SafeSocketHttpClient({ connect, dohHttpClient: PUBLIC_ANSWER, clock: createTestClock() });

    await expect(client.fetch('https://example.com/')).rejects.toMatchObject({
      message: expect.stringMatching(/^WEBCTX_UPSTREAM_CONNECTION_FAILED: tls handshake rejected/),
    });
  });

  it('tags a raw request-write failure with the WEBCTX_REQUEST_WRITE_FAILED prefix and preserves .cause', async () => {
    const connect: ConnectFn = () => socketWithFailingWrite('socket reset during write (raw, unwrapped)');
    const client = new SafeSocketHttpClient({ connect, dohHttpClient: PUBLIC_ANSWER, clock: createTestClock() });

    await expect(client.fetch('https://example.com/')).rejects.toMatchObject({
      message: expect.stringMatching(/^WEBCTX_REQUEST_WRITE_FAILED: socket reset during write/),
    });

    try {
      await client.fetch('https://example.com/');
      expect.unreachable();
    } catch (err) {
      expect((err as Error).cause).toBeInstanceOf(Error);
      expect(((err as Error).cause as Error).message).toBe('socket reset during write (raw, unwrapped)');
    }
  });

  it('a successful fetch through connect/write/read is completely unaffected (EXECUTOR_BEHAVIOR_CHANGED=NO)', async () => {
    const written: Uint8Array[] = [];
    const responseBytes = new TextEncoder().encode(
      'HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nok'
    );
    const connect: ConnectFn = () => fakeSocket(responseBytes, written);
    const client = new SafeSocketHttpClient({ connect, dohHttpClient: PUBLIC_ANSWER, clock: createTestClock() });

    const response = await client.fetch('https://example.com/path');
    expect(response.status).toBe(200);
    expect(written.length).toBeGreaterThan(0);
  });
});
