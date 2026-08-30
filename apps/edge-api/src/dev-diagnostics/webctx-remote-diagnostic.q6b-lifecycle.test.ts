/**
 * SUN-1221E5Q6B — unit-level proof that `wrapSocketForDiagnostics` (the
 * dev-diagnostic-seam-only socket/stream instrumentation layer this
 * checkpoint adds) is byte-for-byte transparent and never alters the
 * awaited-operation sequence `SafeSocketHttpClient.fetch()` performs
 * against a real socket — using fake `SocketLike` objects, never touching
 * `cloudflare:sockets`. This file is never imported by production
 * (`apps/edge-api/src/index.ts`) or bundled — same isolation guarantee as
 * `webctx-remote-diagnostic.ts` itself (see
 * `scripts/test-worker-runtime.mts`'s bundle-isolation phase, unaffected
 * by this addition since it only adds exports, no new import edges from
 * production).
 */
import { describe, it, expect } from 'vitest';
import type { SocketLike } from '@siteborne/provider-adapters';
import { wrapSocketForDiagnostics, newQ6BLifecycle } from './webctx-remote-diagnostic';

/** Mirrors `socket-http-client-premature-eof.test.ts`'s own fake-socket
 * harness: yields `chunks` successfully, then closes cleanly
 * (`done: true`, no error) — a normal remote peer close, not a raw
 * platform read rejection. `readableAccessed`/`writableAccessed` let a
 * test prove a getter was never touched (STARTTLS DISCIPLINE: the pre-TLS
 * socket's streams must stay untouched in the https path). */
function fakeSocket(chunks: Uint8Array[]): SocketLike & { readableAccessed: boolean; writableAccessed: boolean } {
  let i = 0;
  const state = { readableAccessed: false, writableAccessed: false };
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
  const writes: Uint8Array[] = [];
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      writes.push(chunk);
    },
  });
  const socket = {
    get readable() {
      state.readableAccessed = true;
      return readable;
    },
    get writable() {
      state.writableAccessed = true;
      return writable;
    },
    get readableAccessed() {
      return state.readableAccessed;
    },
    get writableAccessed() {
      return state.writableAccessed;
    },
    opened: Promise.resolve({ remoteAddress: '93.184.216.34:443' }),
    closed: new Promise<void>(() => {
      /* never resolves within these tests — mirrors a live socket that
       * hasn't closed yet at the point the header loop hits EOF */
    }),
    async close() {},
    startTls() {
      return socket;
    },
  };
  Object.defineProperty(socket, 'writes', { value: writes });
  return socket as unknown as SocketLike & { readableAccessed: boolean; writableAccessed: boolean };
}

function encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

async function drain(readable: ReadableStream<Uint8Array>): Promise<{ chunks: Uint8Array[]; totalBytes: number }> {
  const reader = readable.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalBytes += value.length;
  }
  return { chunks, totalBytes };
}

describe('SUN-1221E5Q6B — wrapSocketForDiagnostics is byte-for-byte transparent', () => {
  it('forwards every readable chunk unchanged and reports ZERO_RESPONSE_BYTES lifecycle facts for a clean close with no bytes at all', async () => {
    const raw = fakeSocket([]);
    const lifecycle = newQ6BLifecycle();
    const wrapped = wrapSocketForDiagnostics(raw, 'secure', lifecycle);

    const { chunks, totalBytes } = await drain(wrapped.readable);

    expect(chunks).toEqual([]);
    expect(totalBytes).toBe(0);
    expect(lifecycle.eofObserved).toBe(true);
    expect(lifecycle.totalResponseBytesAtEof).toBe(0);
    expect(lifecycle.firstResponseByteObserved).toBe(false);
    expect(lifecycle.statusLineComplete).toBe(false);
    expect(lifecycle.headerTerminatorSeen).toBe(false);
  });

  it('forwards partial header bytes unchanged (no reordering/buffering across chunk boundaries) and reports PARTIAL_RESPONSE_HEADERS lifecycle facts', async () => {
    const partial = ['HTTP/1.1 200', ' OK\r\n', 'Content-Typ', 'e: text/html\r\n'];
    const raw = fakeSocket(partial.map(encode));
    const lifecycle = newQ6BLifecycle();
    const wrapped = wrapSocketForDiagnostics(raw, 'secure', lifecycle);

    const { chunks, totalBytes } = await drain(wrapped.readable);

    // Byte-for-byte identical to the source chunks, in the same order —
    // no coalescing, no splitting, no drop.
    expect(chunks.map((c) => new TextDecoder().decode(c))).toEqual(partial);
    expect(totalBytes).toBe(partial.join('').length);
    expect(lifecycle.eofObserved).toBe(true);
    expect(lifecycle.totalResponseBytesAtEof).toBe(totalBytes);
    expect(lifecycle.firstResponseByteObserved).toBe(true);
    // Status line's CRLF appears (after "HTTP/1.1 200 OK\r\n"); the
    // header block's CRLFCRLF never does — this is exactly the
    // PARTIAL_RESPONSE_HEADERS case Q6B's primary fork distinguishes.
    expect(lifecycle.statusLineComplete).toBe(true);
    expect(lifecycle.headerTerminatorSeen).toBe(false);
  });

  it('records requestWriteResolved and explicitLocalSocketCloseBeforeEof at the same points the real writer would resolve, without adding any new await', async () => {
    const raw = fakeSocket([]);
    const lifecycle = newQ6BLifecycle();
    const wrapped = wrapSocketForDiagnostics(raw, 'secure', lifecycle);

    const writer = wrapped.writable.getWriter();
    expect(lifecycle.requestWriteResolved).toBeUndefined();
    await writer.write(encode('GET / HTTP/1.1\r\n\r\n'));
    expect(lifecycle.requestWriteResolved).toBe(true);

    expect(lifecycle.explicitLocalSocketCloseBeforeEof).toBeUndefined();
    await writer.close();
    // The header loop hasn't run yet in this test (no reader created) —
    // eofObserved is still false, so a close here is correctly "before EOF".
    expect(lifecycle.explicitLocalSocketCloseBeforeEof).toBe(true);
  });

  it('does NOT mark close-before-eof once EOF has already been observed (proves the flag is a real ordering fact, not a tautology)', async () => {
    const raw = fakeSocket([]);
    const lifecycle = newQ6BLifecycle();
    const wrapped = wrapSocketForDiagnostics(raw, 'secure', lifecycle);

    await drain(wrapped.readable); // observes EOF first
    expect(lifecycle.eofObserved).toBe(true);

    const writer = wrapped.writable.getWriter();
    await writer.write(encode('x'));
    await writer.close();
    expect(lifecycle.explicitLocalSocketCloseBeforeEof).toBe(false);
  });

  it('startTls() returns a genuinely distinct wrapped secure socket, never the pre-TLS socket\'s own streams', () => {
    const raw = fakeSocket([]);
    const secureRaw = fakeSocket([]);
    (raw as unknown as { startTls: () => SocketLike }).startTls = () => secureRaw;

    const lifecycle = newQ6BLifecycle();
    const wrappedInitial = wrapSocketForDiagnostics(raw, 'initial', lifecycle);
    const wrappedSecure = wrappedInitial.startTls({ expectedServerHostname: 'example.com' });

    expect(lifecycle.secureSocketCreated).toBe(true);
    expect(lifecycle.secureSocketIsDistinctObject).toBe(true);
    // STARTTLS DISCIPLINE — the pre-TLS socket's own readable/writable
    // getters must never have been touched merely by wrapping+upgrading.
    // Checked BEFORE the `.not.toBe()` identity assertion below: vitest's
    // `toBe` internally walks object properties (including getters) to
    // build its diff/equality preview even when the check passes by
    // reference, which would otherwise flip these flags as a pure test-
    // harness artifact, not a real interaction from the code under test
    // (confirmed by an isolated non-vitest Node repro during this
    // checkpoint).
    expect(raw.readableAccessed).toBe(false);
    expect(raw.writableAccessed).toBe(false);
    expect(wrappedSecure).not.toBe(wrappedInitial);
  });

  it('never touches the pre-TLS initial socket\'s readable/writable at all when only the returned secure socket\'s streams are used (mirrors the real https path exactly)', async () => {
    const raw = fakeSocket([]);
    const secureRaw = fakeSocket([encode('HTTP/1.1 200 OK\r\n\r\n')]);
    (raw as unknown as { startTls: () => SocketLike }).startTls = () => secureRaw;

    const lifecycle = newQ6BLifecycle();
    const wrappedInitial = wrapSocketForDiagnostics(raw, 'initial', lifecycle);
    const wrappedSecure = wrappedInitial.startTls({ expectedServerHostname: 'example.com' });

    await drain(wrappedSecure.readable);

    expect(raw.readableAccessed).toBe(false);
    expect(raw.writableAccessed).toBe(false);
    expect(secureRaw.readableAccessed).toBe(true);
  });

  it('opened/closed are handed back as the exact same promise references — a non-consuming side observer never replaces them', () => {
    const raw = fakeSocket([]);
    const lifecycle = newQ6BLifecycle();
    const wrapped = wrapSocketForDiagnostics(raw, 'secure', lifecycle);

    expect(wrapped.opened).toBe(raw.opened);
    expect(wrapped.closed).toBe(raw.closed);
  });

  it('records initialSocketOpenedResolved via a non-gating observer without this file ever awaiting `.opened` itself', async () => {
    const raw = fakeSocket([]);
    const lifecycle = newQ6BLifecycle();
    wrapSocketForDiagnostics(raw, 'initial', lifecycle);

    // Give the non-gating `.then()` observer a microtask tick to settle —
    // production code never does this wait; this test only proves the
    // observer eventually fires, not that anything awaits it.
    await Promise.resolve();
    await Promise.resolve();

    expect(lifecycle.initialSocketOpenedResolved).toBe(true);
  });
});
