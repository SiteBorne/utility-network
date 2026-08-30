/**
 * SUN-1221E4P §3/§6/§7 — a FOURTH silent-diagnostic gap, distinct from the
 * three E2D/E3P already closed (connect/TLS, request-write, raw
 * `reader.read()` rejection).
 *
 * Source inspection (SUN-1221E4P §3) found two call sites in
 * `readResponse`/`readChunkedBody` that throw a plain, untagged
 * `new Error(...)` when the socket's `readable` stream reports `done: true`
 * (a clean, successful platform read that simply signals "no more bytes")
 * strictly *before* this parser has what it needs:
 *
 *   - `readResponse`'s header loop: `if (done) throw new Error('Connection
 *     closed before response headers completed')` — the server closed the
 *     connection before `\r\n\r\n` was ever seen.
 *   - `readChunkedBody`'s `ensure()`: `if (done) throw new Error('Connection
 *     closed mid-chunk')` — the server closed mid chunked-body.
 *
 * Neither message matches any pattern in `WEBCTX_DIAGNOSTIC_REASON_PATTERNS`
 * (confirmed by direct read of `errors.ts`), so both fall all the way
 * through to the generic `WEBCTX_UPSTREAM_PROTOCOL_ERROR` bucket — the
 * exact same bucket E3 and E4's real live failures were classified into.
 * This is NOT a raw platform rejection (that's already `readOrThrow`'s
 * `WEBCTX_RESPONSE_READ_FAILED`, proven absent in E4's real diagnostic
 * trail) — it is this parser's *own* deliberate throw reacting to a clean
 * `done: true`, i.e. exactly the kind of "genuinely unclassified but
 * actually well-understood" branch SUN-1221E4P exists to eliminate.
 *
 * RED (this file, run against unmodified source): both throw the plain,
 * untagged message, which `classifyGenericAdapterErrorReason` collapses to
 * `WEBCTX_UPSTREAM_PROTOCOL_ERROR`. GREEN (after the fix): both carry a
 * stable `WEBCTX_HTTP_PREMATURE_EOF:` prefix classified to its own reason
 * code, distinct from every other branch.
 *
 * Diagnostic-tagging only (SUN-1221E4P §9/§19): no retry, no timeout
 * change, no buffer-limit change, no parsing-behavior change — a response
 * that already parses successfully today parses identically after this.
 */
import { describe, it, expect } from 'vitest';
import { SafeSocketHttpClient, type ConnectFn, type SocketLike } from '../http/socket-http-client';
import { createTestClock } from '../context';
import { classifyGenericAdapterErrorReason } from '../errors';

function dohHttpClient() {
  return {
    async fetch() {
      return new Response(
        JSON.stringify({ Status: 0, Answer: [{ type: 1, data: '93.184.216.34' }] }),
        { status: 200, headers: { 'content-type': 'application/dns-json' } }
      );
    },
  };
}

/** A socket whose `readable` yields `chunks` successfully, then closes
 * cleanly (`done: true`, no error) — simulating the remote peer closing
 * the TCP connection normally, not a raw platform read rejection. */
function socketClosingCleanlyAfter(chunks: Uint8Array[]): SocketLike {
  let i = 0;
  const readable = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(chunks[i]);
        i++;
        return;
      }
      controller.close();
    },
  });
  const writable = new WritableStream<Uint8Array>();
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

function client(socket: SocketLike) {
  const connect: ConnectFn = () => socket;
  return new SafeSocketHttpClient({ connect, dohHttpClient: dohHttpClient(), clock: createTestClock() });
}

describe('SUN-1221E4P — premature clean connection close is now diagnostically tagged, not generic', () => {
  it('tags a clean close before headers complete with WEBCTX_HTTP_PREMATURE_EOF (not the generic fallback)', async () => {
    // No CRLFCRLF ever arrives; the socket then closes cleanly.
    const socket = socketClosingCleanlyAfter([new TextEncoder().encode('HTTP/1.1 200 OK\r\nContent-Le')]);
    let caught: Error | undefined;
    try {
      await client(socket).fetch('https://example.com/');
      expect.unreachable('fetch should have thrown');
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toMatch(/^WEBCTX_HTTP_PREMATURE_EOF:/);
    expect(caught!.message).toMatch(/headers/);
    expect(classifyGenericAdapterErrorReason(caught!)).toBe('WEBCTX_HTTP_PREMATURE_EOF');
  });

  it('tags a clean close mid-chunk with WEBCTX_HTTP_PREMATURE_EOF (not the generic fallback)', async () => {
    const headerAndPartialChunk = new TextEncoder().encode(
      'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhel'
    );
    const socket = socketClosingCleanlyAfter([headerAndPartialChunk]);
    let caught: Error | undefined;
    try {
      await client(socket).fetch('https://example.com/');
      expect.unreachable('fetch should have thrown');
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toMatch(/^WEBCTX_HTTP_PREMATURE_EOF:/);
    expect(caught!.message).toMatch(/chunk/);
    expect(classifyGenericAdapterErrorReason(caught!)).toBe('WEBCTX_HTTP_PREMATURE_EOF');
  });

  it('does NOT tag a clean close that terminates a connection-close-delimited body (the expected, successful case)', async () => {
    // No Content-Length, no Transfer-Encoding -- readUntilClose treats a
    // clean `done` as the normal end of body, not an error. Must stay so.
    const full = new TextEncoder().encode('HTTP/1.1 200 OK\r\n\r\nhello world');
    const socket = socketClosingCleanlyAfter([full]);
    const response = await client(socket).fetch('https://example.com/');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('hello world');
  });

  it('does NOT tag a clean close that lands exactly on a complete Content-Length body (the expected, successful case)', async () => {
    const full = new TextEncoder().encode('HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhello');
    const socket = socketClosingCleanlyAfter([full]);
    const response = await client(socket).fetch('https://example.com/');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('hello');
  });

  it('a raw read() rejection still classifies as WEBCTX_RESPONSE_READ_FAILED, never WEBCTX_HTTP_PREMATURE_EOF (branches stay distinct)', async () => {
    const readable = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('platform read reset (raw, unwrapped)'));
      },
    });
    const socket: SocketLike = {
      readable,
      writable: new WritableStream<Uint8Array>(),
      opened: Promise.resolve({}),
      closed: Promise.resolve(),
      async close() {},
      startTls() {
        return socket as unknown as SocketLike;
      },
    };
    await expect(client(socket).fetch('https://example.com/')).rejects.toMatchObject({
      message: expect.stringMatching(/^WEBCTX_RESPONSE_READ_FAILED:/),
    });
  });
});
