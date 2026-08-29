/**
 * SUN-1221E3P §12 (mandatory) — `SafeSocketHttpClient`'s hand-rolled
 * HTTP/1.1 parser (`socket-http-client.ts`) must not assume one
 * `reader.read()` call delivers one complete HTTP structure. Real TCP/TLS
 * delivery can split a legal response at any byte boundary. This suite
 * takes representative valid HTTP/1.1 response fixtures (`Content-Length`
 * framing and `Transfer-Encoding: chunked` framing) and re-delivers each
 * one fragmented at the specific boundaries this checkpoint calls out —
 * proving the parser produces an identical semantic result regardless of
 * how the bytes were chopped into socket reads.
 *
 * A failing case here would be a genuine, reproducible root-cause
 * candidate for SUN-1221E2/E3's HTTP 502 (`WEBCTX_UPSTREAM_PROTOCOL_ERROR`)
 * — this suite is the evidence that class of bug does NOT exist in the
 * current parser, not a guess.
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

/** Delivers `full` as separate `reader.read()` chunks, split exactly at
 * `splitOffsets` (sorted, strictly ascending, each `0 < offset < full.length`).
 * An `await` between each `controller.enqueue` forces the consumer to see
 * genuinely separate reads, not one microtask-coalesced blob. */
function fragmentedSocket(full: Uint8Array, splitOffsets: number[]): SocketLike {
  const bounds = [0, ...splitOffsets, full.length];
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (let i = 0; i < bounds.length - 1; i++) {
        controller.enqueue(full.slice(bounds[i], bounds[i + 1]));
        await Promise.resolve(); // deliberate: force separate reads, one per loop iteration
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

async function fetchViaFragmentedSocket(full: Uint8Array, splitOffsets: number[]) {
  const connect: ConnectFn = () => fragmentedSocket(full, splitOffsets);
  const client = new SafeSocketHttpClient({ connect, dohHttpClient: dohHttpClient(), clock: createTestClock() });
  return client.fetch('https://example.com/');
}

const CRLF = '\r\n';

// Fixture A: Content-Length-framed response, body = "hello world" (11 bytes).
const RESPONSE_A_TEXT =
  `HTTP/1.1 200 OK${CRLF}` +
  `Content-Type: text/plain${CRLF}` +
  `Content-Length: 11${CRLF}` +
  CRLF +
  `hello world`;
const RESPONSE_A = new TextEncoder().encode(RESPONSE_A_TEXT);

// Fixture B: Transfer-Encoding: chunked response, body chunks "hello" + " world".
const RESPONSE_B_TEXT =
  `HTTP/1.1 200 OK${CRLF}` +
  `Transfer-Encoding: chunked${CRLF}` +
  CRLF +
  `5${CRLF}hello${CRLF}` +
  `6${CRLF} world${CRLF}` +
  `0${CRLF}${CRLF}`;
const RESPONSE_B = new TextEncoder().encode(RESPONSE_B_TEXT);

async function expectIdenticalToUnfragmented(full: Uint8Array, splitOffsets: number[]) {
  const baseline = await fetchViaFragmentedSocket(full, []);
  const fragmented = await fetchViaFragmentedSocket(full, splitOffsets);
  expect(fragmented.status).toBe(baseline.status);
  expect(await fragmented.text()).toBe(await baseline.text());
}

describe('SUN-1221E3P §12 — TCP/TLS read fragmentation matrix (Content-Length framing)', () => {
  it('splits inside "HTTP/1.1" (after "HTTP/1")', async () => {
    await expectIdenticalToUnfragmented(RESPONSE_A, [6]);
  });

  it('splits between status-line digits ("20" | "0 OK")', async () => {
    const offset = RESPONSE_A_TEXT.indexOf('200') + 2;
    await expectIdenticalToUnfragmented(RESPONSE_A, [offset]);
  });

  it('splits between the status line\'s CR and LF', async () => {
    const offset = RESPONSE_A_TEXT.indexOf(`${CRLF}Content-Type`) + 1; // right after \r, before \n
    await expectIdenticalToUnfragmented(RESPONSE_A, [offset]);
  });

  it('splits in the middle of a header name ("Cont" | "ent-Type: ...")', async () => {
    const offset = RESPONSE_A_TEXT.indexOf('Content-Type') + 4;
    await expectIdenticalToUnfragmented(RESPONSE_A, [offset]);
  });

  it('splits in the middle of a header value ("text/pl" | "ain")', async () => {
    const offset = RESPONSE_A_TEXT.indexOf('text/plain') + 7;
    await expectIdenticalToUnfragmented(RESPONSE_A, [offset]);
  });

  it('splits inside the CRLFCRLF header/body boundary sequence', async () => {
    const headerEnd = RESPONSE_A_TEXT.indexOf(`${CRLF}${CRLF}`);
    // headerEnd, +1, +2, +3 are the four bytes of \r\n\r\n; split after each.
    for (const delta of [1, 2, 3]) {
      await expectIdenticalToUnfragmented(RESPONSE_A, [headerEnd + delta]);
    }
  });

  it('splits inside the Content-Length-framed body ("hello " | "world")', async () => {
    const offset = RESPONSE_A_TEXT.indexOf('hello world') + 6;
    await expectIdenticalToUnfragmented(RESPONSE_A, [offset]);
  });

  it('splits at every single byte boundary (exhaustive)', async () => {
    for (let offset = 1; offset < RESPONSE_A.length; offset++) {
      await expectIdenticalToUnfragmented(RESPONSE_A, [offset]);
    }
  });
});

describe('SUN-1221E3P §12 — TCP/TLS read fragmentation matrix (chunked Transfer-Encoding framing)', () => {
  it('splits inside a chunk-size line ("5" is delivered as its own read before CRLF)', async () => {
    const offset = RESPONSE_B_TEXT.indexOf(`5${CRLF}hello`) + 1;
    await expectIdenticalToUnfragmented(RESPONSE_B, [offset]);
  });

  it('splits between chunk-data and its trailing CRLF ("hello" | "\\r\\n6...")', async () => {
    const offset = RESPONSE_B_TEXT.indexOf('hello') + 5;
    await expectIdenticalToUnfragmented(RESPONSE_B, [offset]);
  });

  it('splits between the second chunk-data and its trailing CRLF (" world" | "\\r\\n0...")', async () => {
    const offset = RESPONSE_B_TEXT.indexOf(' world') + 6;
    await expectIdenticalToUnfragmented(RESPONSE_B, [offset]);
  });

  it('splits inside the terminating 0-length chunk\'s trailing CRLFCRLF', async () => {
    const offset = RESPONSE_B_TEXT.lastIndexOf(`0${CRLF}${CRLF}`) + 2;
    await expectIdenticalToUnfragmented(RESPONSE_B, [offset]);
  });

  it('splits at every single byte boundary (exhaustive)', async () => {
    for (let offset = 1; offset < RESPONSE_B.length; offset++) {
      await expectIdenticalToUnfragmented(RESPONSE_B, [offset]);
    }
  });

  it('splits at multiple simultaneous boundaries in one response (compound fragmentation)', async () => {
    const offsets = [6, 20, RESPONSE_B_TEXT.indexOf('hello') + 2, RESPONSE_B_TEXT.indexOf(' world') + 3];
    await expectIdenticalToUnfragmented(RESPONSE_B, offsets.sort((a, b) => a - b));
  });
});
