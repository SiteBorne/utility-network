/**
 * SUN-1221E3P §16/§17 — closes a THIRD silent-diagnostic gap distinct from
 * the two E2D closed (`connect()`/`startTls()` and `writer.write()`).
 *
 * E2D wrapped the connect/TLS step and the request-write step with
 * `WEBCTX_UPSTREAM_CONNECTION_FAILED` / `WEBCTX_REQUEST_WRITE_FAILED`
 * tags. It did NOT wrap the response-*reading* phase: every
 * `reader.read()` call inside `readResponse`'s header loop, `readUntil`,
 * `readUntilClose`, and `readChunkedBody`'s `ensure()` calls straight into
 * the raw `cloudflare:sockets` platform stream with no try/catch of its
 * own (confirmed by direct source inspection, SUN-1221E3P §3). A raw
 * platform read failure there — e.g. a TCP reset mid-response — falls
 * through completely untagged into `toAdapterResult`'s generic-`Error`
 * fallback (`WEBCTX_UPSTREAM_PROTOCOL_ERROR`), indistinguishable from
 * every other unclassified failure, including a genuine parser bug.
 *
 * This is the RED/GREEN pair for that gap. These tests are the exact
 * genuine-failure proof required by the checkpoint's debugging law: the
 * current, unmodified source really does propagate the raw message with
 * no diagnostic tag (RED), and the fix tags it without changing any
 * timing, retry, buffer, or parsing behavior (GREEN).
 *
 * This is diagnostic instrumentation ONLY (SUN-1221E3P §18/§7): no retry
 * is introduced, no timeout changed, no buffer limit changed, no parser
 * behavior changed. A response that reads and parses successfully today
 * reads and parses identically after this change.
 */
import { describe, it, expect } from 'vitest';
import { SafeSocketHttpClient, type ConnectFn, type SocketLike } from '../http/socket-http-client';
import { createTestClock } from '../context';

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

/** A socket whose `readable` yields `beforeFailure` chunks successfully,
 * then rejects the next `read()` with a raw, unwrapped platform error. */
function socketFailingReadAfter(beforeFailure: Uint8Array[], failureMessage: string): SocketLike {
  let i = 0;
  const readable = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < beforeFailure.length) {
        controller.enqueue(beforeFailure[i]);
        i++;
        return;
      }
      controller.error(new Error(failureMessage));
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

describe('SUN-1221E3P — SafeSocketHttpClient response-read failures are now diagnostically tagged', () => {
  it('tags a raw read() failure during the header-read phase with WEBCTX_RESPONSE_READ_FAILED and preserves .cause', async () => {
    await expect(
      client(socketFailingReadAfter([], 'platform read reset (raw, unwrapped, header phase)')).fetch(
        'https://example.com/'
      )
    ).rejects.toMatchObject({
      message: expect.stringMatching(/^WEBCTX_RESPONSE_READ_FAILED: platform read reset \(raw, unwrapped, header phase\)/),
    });

    // Fresh socket instance — a ReadableStream that already errored once has
    // terminal state and cannot be meaningfully re-driven through a second
    // fetch(); this is a test-double lifecycle detail, unrelated to the
    // source behavior under test.
    try {
      await client(
        socketFailingReadAfter([], 'platform read reset (raw, unwrapped, header phase)')
      ).fetch('https://example.com/');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).cause).toBeInstanceOf(Error);
      expect(((err as Error).cause as Error).message).toBe('platform read reset (raw, unwrapped, header phase)');
    }
  });

  it('tags a raw read() failure during Content-Length body streaming (readUntil) with WEBCTX_RESPONSE_READ_FAILED', async () => {
    const headerBytes = new TextEncoder().encode(
      'HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\npartial-body-'
    );
    const socket = socketFailingReadAfter([headerBytes], 'platform read reset (raw, unwrapped, body phase)');
    await expect(client(socket).fetch('https://example.com/')).rejects.toMatchObject({
      message: expect.stringMatching(/^WEBCTX_RESPONSE_READ_FAILED: platform read reset \(raw, unwrapped, body phase\)/),
    });
  });

  it('tags a raw read() failure inside chunked-body reading (readChunkedBody\'s ensure()) with WEBCTX_RESPONSE_READ_FAILED', async () => {
    const headerBytes = new TextEncoder().encode(
      'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhel'
    );
    const socket = socketFailingReadAfter([headerBytes], 'platform read reset (raw, unwrapped, chunk phase)');
    await expect(client(socket).fetch('https://example.com/')).rejects.toMatchObject({
      message: expect.stringMatching(/^WEBCTX_RESPONSE_READ_FAILED: platform read reset \(raw, unwrapped, chunk phase\)/),
    });
  });

  it('does NOT re-wrap the parser\'s own deliberate errors (e.g. a genuinely malformed status line stays classified as WEBCTX_RESPONSE_PARSE_FAILED, not WEBCTX_RESPONSE_READ_FAILED)', async () => {
    const malformed = new TextEncoder().encode('NOT A STATUS LINE\r\n\r\n');
    const socket = socketFailingReadAfter([malformed], 'unreachable — read succeeds, parse fails first');
    await expect(client(socket).fetch('https://example.com/')).rejects.toMatchObject({
      message: expect.stringMatching(/^Malformed status line: NOT A STATUS LINE/),
    });
  });

  it('a successful fetch through header + Content-Length body read is completely unaffected (EXECUTOR_BEHAVIOR_CHANGED=NO)', async () => {
    const full = new TextEncoder().encode('HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhello');
    const socket: SocketLike = {
      readable: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(full);
          controller.close();
        },
      }),
      writable: new WritableStream<Uint8Array>(),
      opened: Promise.resolve({}),
      closed: Promise.resolve(),
      async close() {},
      startTls() {
        return socket as unknown as SocketLike;
      },
    };
    const response = await client(socket).fetch('https://example.com/');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('hello');
  });
});
