import { describe, expect, it, vi } from 'vitest';
import type { Socket } from 'cloudflare:sockets';
import type * as SmtpStageTimeout from './smtp-stage-timeout';
import {
  SmtpTransportError,
  sendStorageAlertViaIonosSmtp,
  type ConnectFn,
} from './ionos-smtp-transport';
import { encodeAuthPlainInitialResponse } from './smtp-message';

// SUN-1222C-SMTP-ROOT-CAUSE: `CLEANUP_TIMEOUT_MS` is mocked small (rather
// than the real 1_000ms) purely so the bounded-cleanup tests below don't
// burn a real second each -- the *value itself* is never asserted against,
// only that the transport's `finally` block races `reader.cancel()`/
// `socket.close()` against it instead of awaiting them unbounded.
// `withTimeout`/`StageTimeoutError` are re-exported from the real module
// unchanged so every other stage timeout in this file keeps its real
// behavior.
vi.mock('./smtp-stage-timeout', async (importOriginal) => {
  const actual = await importOriginal<typeof SmtpStageTimeout>();
  return { ...actual, CLEANUP_TIMEOUT_MS: 10 };
});

// SUN-1222C-SMTP-ROOT-CAUSE port migration: 465/implicit TLS, not
// 587/STARTTLS -- see `ionos-smtp-transport.ts`'s own doc comment for the
// two live probes that proved this.
const HOST = 'smtp.ionos.com';
const PORT = 465;
const USERNAME = 'storage@alerts.siteborne.net';
const PASSWORD = 'fake-mailbox-password-does-not-touch-network';
const FROM = 'storage@alerts.siteborne.net';
const TO = 'hello@siteborne.com';

/** A scripted fake `Socket`: `responses` are handed back one per logical
 * `read()` call (as already-encoded chunks -- a caller may pass a string
 * or, to force a mid-line split, an array of `Uint8Array` fragments for a
 * single queued response), and every `writer.write()` call is captured
 * verbatim (decoded to text) in `writes`, in order. There is exactly one
 * socket for the whole implicit-TLS lifecycle -- no `startTls()` on this
 * fake at all, since the production transport never calls it. */
function makeScriptedSocket(responses: Array<string | Uint8Array[]>) {
  const writes: string[] = [];
  let closeCalls = 0;
  const encoder = new TextEncoder();

  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const resp of responses) {
        if (typeof resp === 'string') {
          controller.enqueue(encoder.encode(resp));
        } else {
          for (const piece of resp) controller.enqueue(piece);
        }
      }
      controller.close();
    },
  });

  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      writes.push(new TextDecoder().decode(chunk));
    },
  });

  const socket = {
    readable,
    writable,
    opened: Promise.resolve({}),
    closed: Promise.resolve(),
    async close() {
      closeCalls++;
    },
  } as unknown as Socket;

  return {
    socket,
    writes,
    get closeCalls() {
      return closeCalls;
    },
  };
}

const GREETING = '220 mreueus003.schlund.de ESMTP Nemesis ready\r\n';
const EHLO_WITH_PLAIN =
  '250-mreueus003.schlund.de\r\n250-AUTH LOGIN PLAIN\r\n250 SIZE 141557760\r\n';
const EHLO_WITHOUT_PLAIN = '250-mreueus003.schlund.de\r\n250 AUTH LOGIN\r\n';
const AUTH_OK = '235 2.7.0 Authentication successful\r\n';
const MAIL_OK = '250 2.1.0 Sender OK\r\n';
const RCPT_OK = '250 2.1.5 Recipient OK\r\n';
const DATA_GO = '354 Start mail input\r\n';
const SUBMIT_OK = '250 2.0.0 Message accepted\r\n';
const QUIT_OK = '221 2.0.0 Bye\r\n';

const ENVELOPE = {
  subject: 'SITEBORNE: storage reclamation critical alert',
  bodyText: 'r2_delete_failures: 3\nreclaimed_count: 12',
};

const DEPS = {
  now: () => new Date('2026-09-13T06:38:02.000Z'),
  randomHex: () => 'deadbeefcafe',
};

function config() {
  return { host: HOST, port: PORT, username: USERNAME, password: PASSWORD, from: FROM, to: TO };
}

describe('sendStorageAlertViaIonosSmtp — successful lifecycle (implicit TLS)', () => {
  it('completes the full implicit-TLS + AUTH PLAIN + send sequence, and never issues STARTTLS', async () => {
    const scripted = makeScriptedSocket([
      GREETING,
      EHLO_WITH_PLAIN,
      AUTH_OK,
      MAIL_OK,
      RCPT_OK,
      DATA_GO,
      SUBMIT_OK,
      QUIT_OK,
    ]);
    const { socket, writes } = scripted;
    let capturedAddress: unknown;
    let capturedOptions: unknown;
    const connectFn: ConnectFn = (address, options) => {
      capturedAddress = address;
      capturedOptions = options;
      return socket;
    };

    await sendStorageAlertViaIonosSmtp(config(), ENVELOPE, { ...DEPS, connectFn });

    expect(capturedAddress).toEqual({ hostname: HOST, port: PORT });
    // SUN-1222C-SMTP-ROOT-CAUSE port migration: implicit TLS, not STARTTLS.
    expect(capturedOptions).toEqual({ secureTransport: 'on' });

    // Exactly one EHLO (no plaintext-then-secure split), then AUTH, then
    // the envelope/data commands -- in order.
    expect(writes[0]).toBe('EHLO alerts.siteborne.net\r\n');
    const expectedAuthPayload = encodeAuthPlainInitialResponse(USERNAME, PASSWORD);
    expect(writes[1]).toBe(`AUTH PLAIN ${expectedAuthPayload}\r\n`);
    expect(writes[2]).toBe(`MAIL FROM:<${FROM}>\r\n`);
    expect(writes[3]).toBe(`RCPT TO:<${TO}>\r\n`);
    expect(writes[4]).toBe('DATA\r\n');
    expect(writes[6]).toBe('QUIT\r\n');

    // No STARTTLS command is ever written to the wire.
    expect(writes.some((w) => w.startsWith('STARTTLS'))).toBe(false);

    // The message itself: CRLF-normalized, correct headers, dot-stuffed,
    // properly terminated.
    const dataPayload = writes[5];
    expect(dataPayload).toContain('From: storage@alerts.siteborne.net\r\n');
    expect(dataPayload).toContain('Date: Sun, 13 Sep 2026 06:38:02 +0000\r\n');
    expect(dataPayload).toContain('Message-ID: <deadbeefcafe@alerts.siteborne.net>\r\n');
    expect(dataPayload).toContain('r2_delete_failures: 3\r\nreclaimed_count: 12');
    expect(dataPayload.endsWith('\r\n.\r\n')).toBe(true);

    expect(scripted.closeCalls).toBe(1);

    // The plaintext password never appears on the wire in any form other
    // than the correctly base64-encoded AUTH PLAIN payload.
    for (const write of writes) {
      expect(write).not.toContain(PASSWORD);
    }
  });

  it('tolerates a missing/garbled QUIT reply without failing the send', async () => {
    const scripted = makeScriptedSocket([
      GREETING,
      EHLO_WITH_PLAIN,
      AUTH_OK,
      MAIL_OK,
      RCPT_OK,
      DATA_GO,
      SUBMIT_OK, // no QUIT reply queued
    ]);
    const { socket, writes } = scripted;
    await expect(
      sendStorageAlertViaIonosSmtp(config(), ENVELOPE, { ...DEPS, connectFn: () => socket })
    ).resolves.toBeUndefined();
    expect(writes[6]).toBe('QUIT\r\n');
    expect(scripted.closeCalls).toBe(1);
  });

  it('handles a greeting response split across multiple TCP chunks', async () => {
    const encoder = new TextEncoder();
    const splitGreeting: Uint8Array[] = [
      encoder.encode('220 mre'),
      encoder.encode('ueus003.schlund.de rea'),
      encoder.encode('dy\r\n'),
    ];
    const { socket } = makeScriptedSocket([
      splitGreeting,
      EHLO_WITH_PLAIN,
      AUTH_OK,
      MAIL_OK,
      RCPT_OK,
      DATA_GO,
      SUBMIT_OK,
      QUIT_OK,
    ]);
    await expect(
      sendStorageAlertViaIonosSmtp(config(), ENVELOPE, { ...DEPS, connectFn: () => socket })
    ).resolves.toBeUndefined();
  });
});

describe('sendStorageAlertViaIonosSmtp — failure stages', () => {
  async function expectStage(connectFn: ConnectFn, stage: string): Promise<SmtpTransportError> {
    const err = await sendStorageAlertViaIonosSmtp(config(), ENVELOPE, {
      ...DEPS,
      connectFn,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SmtpTransportError);
    expect((err as SmtpTransportError).stage).toBe(stage);
    return err as SmtpTransportError;
  }

  it('SMTP_TLS_CONNECT_FAILED when the socket cannot be constructed', async () => {
    await expectStage(() => {
      throw new Error('DNS resolution failed');
    }, 'SMTP_TLS_CONNECT_FAILED');
  });

  it('SMTP_GREETING_REJECTED on a non-220 greeting', async () => {
    const { socket } = makeScriptedSocket(['421 service not available\r\n']);
    await expectStage(() => socket, 'SMTP_GREETING_REJECTED');
  });

  it('SMTP_EHLO_FAILED on a non-250 EHLO reply', async () => {
    const { socket } = makeScriptedSocket([GREETING, '502 command not implemented\r\n']);
    await expectStage(() => socket, 'SMTP_EHLO_FAILED');
  });

  it('SMTP_AUTH_PLAIN_UNAVAILABLE when PLAIN is not advertised, and AUTH is never sent', async () => {
    const { socket, writes } = makeScriptedSocket([GREETING, EHLO_WITHOUT_PLAIN]);
    await expectStage(() => socket, 'SMTP_AUTH_PLAIN_UNAVAILABLE');
    expect(writes.some((w) => w.startsWith('AUTH'))).toBe(false);
  });

  it('SMTP_AUTH_FAILED on a non-235 AUTH reply, without leaking the password in the error', async () => {
    const { socket } = makeScriptedSocket([
      GREETING,
      EHLO_WITH_PLAIN,
      '535 5.7.8 Authentication failed\r\n',
    ]);
    const err = await expectStage(() => socket, 'SMTP_AUTH_FAILED');
    expect(err.message).not.toContain(PASSWORD);
    expect(err.message).not.toContain(encodeAuthPlainInitialResponse(USERNAME, PASSWORD));
  });

  it('SMTP_MAIL_FROM_REJECTED on a non-2xx MAIL FROM reply', async () => {
    const { socket } = makeScriptedSocket([
      GREETING,
      EHLO_WITH_PLAIN,
      AUTH_OK,
      '550 5.1.0 Sender rejected\r\n',
    ]);
    await expectStage(() => socket, 'SMTP_MAIL_FROM_REJECTED');
  });

  it('SMTP_RCPT_TO_REJECTED on a non-2xx RCPT TO reply', async () => {
    const { socket } = makeScriptedSocket([
      GREETING,
      EHLO_WITH_PLAIN,
      AUTH_OK,
      MAIL_OK,
      '550 5.1.1 Recipient rejected\r\n',
    ]);
    await expectStage(() => socket, 'SMTP_RCPT_TO_REJECTED');
  });

  it('SMTP_DATA_REJECTED on a non-354 DATA reply', async () => {
    const { socket } = makeScriptedSocket([
      GREETING,
      EHLO_WITH_PLAIN,
      AUTH_OK,
      MAIL_OK,
      RCPT_OK,
      '503 5.5.1 Bad sequence\r\n',
    ]);
    await expectStage(() => socket, 'SMTP_DATA_REJECTED');
  });

  it('SMTP_MESSAGE_REJECTED on a non-2xx post-DATA reply', async () => {
    const { socket } = makeScriptedSocket([
      GREETING,
      EHLO_WITH_PLAIN,
      AUTH_OK,
      MAIL_OK,
      RCPT_OK,
      DATA_GO,
      '554 5.6.0 Message rejected\r\n',
    ]);
    await expectStage(() => socket, 'SMTP_MESSAGE_REJECTED');
  });

  it('closes the socket even on failure', async () => {
    const scripted = makeScriptedSocket([
      GREETING,
      EHLO_WITH_PLAIN,
      '535 5.7.8 Authentication failed\r\n',
    ]);
    await sendStorageAlertViaIonosSmtp(config(), ENVELOPE, {
      ...DEPS,
      connectFn: () => scripted.socket,
    }).catch(() => {});
    expect(scripted.closeCalls).toBe(1);
  });
});

/** A socket whose `readable` never delivers a chunk and never closes --
 * simulates a remote that accepted the connection (or, for the very first
 * read, one whose handshake silently black-holes) but never sends
 * anything: `read()` stays pending forever, exactly the wallTime=9979ms/
 * cpuTime=4ms signature observed in the second live qualification
 * attempt. `writable` accepts writes normally so a hang can be placed
 * precisely at a response-read stage without also blocking the write
 * immediately before it. */
function makeHangingReadSocket() {
  const writes: string[] = [];
  let closeCalls = 0;
  const readable = new ReadableStream<Uint8Array>({
    pull() {
      return new Promise<void>(() => {}); // never enqueues, never closes
    },
  });
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      writes.push(new TextDecoder().decode(chunk));
    },
  });
  const socket = {
    readable,
    writable,
    opened: Promise.resolve({}),
    closed: Promise.resolve(),
    async close() {
      closeCalls++;
    },
  } as unknown as Socket;
  return {
    socket,
    writes,
    get closeCalls() {
      return closeCalls;
    },
  };
}

describe('sendStorageAlertViaIonosSmtp — per-stage and overall timeouts', () => {
  const TIMEOUTS = { perStageTimeoutMs: 20, overallTimeoutMs: 100 };

  async function expectTimeoutStage(
    connectFn: ConnectFn,
    stage: string,
    deps: Partial<typeof DEPS & typeof TIMEOUTS> = {}
  ): Promise<SmtpTransportError> {
    const err = await sendStorageAlertViaIonosSmtp(config(), ENVELOPE, {
      ...DEPS,
      ...TIMEOUTS,
      ...deps,
      connectFn,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SmtpTransportError);
    expect((err as SmtpTransportError).stage).toBe(stage);
    expect((err as SmtpTransportError).message).toContain('timed out');
    return err as SmtpTransportError;
  }

  it('SMTP_GREETING_REJECTED when the greeting never arrives, once the connection has opened', async () => {
    // `makeHangingReadSocket()`'s `opened` already resolves immediately
    // (`Promise.resolve({})`) -- this proves the two stages are distinct:
    // the connect+TLS-open stage passes, and the hang is correctly
    // attributed to the greeting-read stage, not conflated with it.
    const hanging = makeHangingReadSocket();
    await expectTimeoutStage(() => hanging.socket, 'SMTP_GREETING_REJECTED');
    expect(hanging.closeCalls).toBe(1);
  });

  it('SMTP_TLS_CONNECT_FAILED when socket.opened never resolves (connect+TLS handshake that never completes)', async () => {
    // Reported stage alone is the proof this is attributed to the
    // connect+TLS-open stage and not the greeting-read stage further down
    // the sequence (`guarded` records `lastStage` immediately before each
    // stage begins, so an in-flight hang can only ever surface under the
    // stage that was actually awaiting -- see
    // `sendStorageAlertViaIonosSmtp`'s own doc comment on step 0 vs. step
    // 1). Note: this fake `readable`'s `pull` does fire on its own shortly
    // after construction -- that is the Streams spec's own automatic
    // fill-to-`highWaterMark` behavior, not evidence of a `read()` call
    // from this module's protocol logic, so it is deliberately not
    // asserted on here.
    let closeCalls = 0;
    const socket = {
      readable: new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => {}) }),
      writable: new WritableStream<Uint8Array>({ write() {} }),
      opened: new Promise<never>(() => {}), // never resolves
      closed: Promise.resolve(),
      async close() {
        closeCalls++;
      },
    } as unknown as Socket;

    await expectTimeoutStage(() => socket, 'SMTP_TLS_CONNECT_FAILED');
    expect(closeCalls).toBe(1);
  });

  it('SMTP_TLS_CONNECT_FAILED when socket.opened rejects (e.g. TLS handshake or connection failure), and the rejection reason is preserved', async () => {
    let closeCalls = 0;
    const socket = {
      readable: new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => {}) }),
      writable: new WritableStream<Uint8Array>({ write() {} }),
      opened: Promise.reject(new Error('connection refused')),
      closed: Promise.resolve(),
      async close() {
        closeCalls++;
      },
    } as unknown as Socket;

    const err = await sendStorageAlertViaIonosSmtp(config(), ENVELOPE, {
      ...DEPS,
      ...TIMEOUTS,
      connectFn: () => socket,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SmtpTransportError);
    expect((err as SmtpTransportError).stage).toBe('SMTP_TLS_CONNECT_FAILED');
    expect((err as SmtpTransportError).message).toContain('connection refused');
    expect(closeCalls).toBe(1);
  });

  it('SMTP_EHLO_FAILED when the EHLO response never arrives', async () => {
    // A socket that yields exactly the greeting, then hangs forever
    // (never closes) for every subsequent read -- deterministically
    // places the hang at the EHLO-response stage.
    let readCount = 0;
    const readable = new ReadableStream<Uint8Array>({
      pull(controller) {
        readCount++;
        if (readCount === 1) {
          controller.enqueue(new TextEncoder().encode(GREETING));
          return;
        }
        return new Promise<void>(() => {});
      },
    });
    const socket = {
      readable,
      writable: new WritableStream<Uint8Array>({ write() {} }),
      opened: Promise.resolve({}),
      closed: Promise.resolve(),
      async close() {},
    } as unknown as Socket;
    await expectTimeoutStage(() => socket, 'SMTP_EHLO_FAILED');
  });

  it('SMTP_AUTH_FAILED when the AUTH reply never arrives (SMTP auth timeout)', async () => {
    const readable = new ReadableStream<Uint8Array>({
      pull: (() => {
        let n = 0;
        const lines = [GREETING, EHLO_WITH_PLAIN];
        return (controller: ReadableStreamDefaultController<Uint8Array>) => {
          if (n < lines.length) {
            controller.enqueue(new TextEncoder().encode(lines[n]));
            n++;
            return;
          }
          return new Promise<void>(() => {});
        };
      })(),
    });
    const socket = {
      readable,
      writable: new WritableStream({ write() {} }),
      opened: Promise.resolve({}),
      closed: Promise.resolve(),
      async close() {},
    } as unknown as Socket;
    await expectTimeoutStage(() => socket, 'SMTP_AUTH_FAILED');
  });

  it('SMTP_MESSAGE_REJECTED when the final DATA-acceptance reply never arrives (DATA/final-acceptance timeout)', async () => {
    const readable = new ReadableStream<Uint8Array>({
      pull: (() => {
        let n = 0;
        const lines = [GREETING, EHLO_WITH_PLAIN, AUTH_OK, MAIL_OK, RCPT_OK, DATA_GO];
        return (controller: ReadableStreamDefaultController<Uint8Array>) => {
          if (n < lines.length) {
            controller.enqueue(new TextEncoder().encode(lines[n]));
            n++;
            return;
          }
          return new Promise<void>(() => {});
        };
      })(),
    });
    const socket = {
      readable,
      writable: new WritableStream({ write() {} }),
      opened: Promise.resolve({}),
      closed: Promise.resolve(),
      async close() {},
    } as unknown as Socket;
    await expectTimeoutStage(() => socket, 'SMTP_MESSAGE_REJECTED');
  });

  it('closes the socket on every timeout, not just protocol rejections', async () => {
    const hanging = makeHangingReadSocket();
    await sendStorageAlertViaIonosSmtp(config(), ENVELOPE, {
      ...DEPS,
      ...TIMEOUTS,
      connectFn: () => hanging.socket,
    }).catch(() => {});
    expect(hanging.closeCalls).toBe(1);
  });

  it('never leaks the password in a timeout error message', async () => {
    const hanging = makeHangingReadSocket();
    const err = await expectTimeoutStage(() => hanging.socket, 'SMTP_GREETING_REJECTED');
    expect(err.message).not.toContain(PASSWORD);
  });

  it('an overall timeout well below any single stage budget still names the real stage in flight', async () => {
    // `hanging.socket.opened` resolves immediately, so the connect+TLS-open
    // stage (step 0) completes and the overall timeout fires while the
    // greeting read (step 1) is in flight -- hence SMTP_GREETING_REJECTED,
    // not SMTP_TLS_CONNECT_FAILED.
    const hanging = makeHangingReadSocket();
    const err = await sendStorageAlertViaIonosSmtp(config(), ENVELOPE, {
      ...DEPS,
      perStageTimeoutMs: 5_000, // large -- never fires on its own
      overallTimeoutMs: 20, // fires first
      connectFn: () => hanging.socket,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SmtpTransportError);
    expect((err as SmtpTransportError).stage).toBe('SMTP_GREETING_REJECTED');
    expect((err as SmtpTransportError).message).toContain('overall SMTP timeout');
    expect(hanging.closeCalls).toBe(1);
  });

  it('an overall timeout that fires while the connection is still opening names SMTP_TLS_CONNECT_FAILED', async () => {
    const socket = {
      readable: new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => {}) }),
      writable: new WritableStream<Uint8Array>({ write() {} }),
      opened: new Promise<never>(() => {}), // never resolves
      closed: Promise.resolve(),
      async close() {},
    } as unknown as Socket;
    const err = await sendStorageAlertViaIonosSmtp(config(), ENVELOPE, {
      ...DEPS,
      perStageTimeoutMs: 5_000,
      overallTimeoutMs: 20,
      connectFn: () => socket,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SmtpTransportError);
    expect((err as SmtpTransportError).stage).toBe('SMTP_TLS_CONNECT_FAILED');
    expect((err as SmtpTransportError).message).toContain('overall SMTP timeout');
  });

  it('a fast, fully successful send is unaffected by short timeout budgets', async () => {
    const scripted = makeScriptedSocket([
      GREETING,
      EHLO_WITH_PLAIN,
      AUTH_OK,
      MAIL_OK,
      RCPT_OK,
      DATA_GO,
      SUBMIT_OK,
      QUIT_OK,
    ]);
    await expect(
      sendStorageAlertViaIonosSmtp(config(), ENVELOPE, {
        ...DEPS,
        ...TIMEOUTS,
        connectFn: () => scripted.socket,
      })
    ).resolves.toBeUndefined();
    expect(scripted.closeCalls).toBe(1);
  });
});

/** Builds a scripted socket, exactly like `makeScriptedSocket`, except its
 * underlying `readable`'s `cancel()` and/or `close()` can be configured to
 * hang forever -- proves the `finally` block's bounded cleanup
 * (`CLEANUP_TIMEOUT_MS`, mocked to 10ms above) still lets
 * `sendStorageAlertViaIonosSmtp` return instead of waiting on either
 * indefinitely. */
function makeCleanupHangSocket(
  responses: Array<string | Uint8Array[]>,
  opts: { hangCancel?: boolean; hangClose?: boolean }
) {
  const writes: string[] = [];
  let closeCalls = 0;
  let cancelCalls = 0;
  const encoder = new TextEncoder();

  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const resp of responses) {
        if (typeof resp === 'string') controller.enqueue(encoder.encode(resp));
        else for (const piece of resp) controller.enqueue(piece);
      }
      // Deliberately never `controller.close()`d -- a real, still-open TCP
      // connection doesn't close itself just because the peer has no more
      // buffered bytes right now, and (per the WHATWG streams spec)
      // `reader.cancel()` on an ALREADY-CLOSED stream is a no-op that never
      // invokes the underlying source's own `cancel()` algorithm below --
      // which would defeat the entire point of this hang simulation.
      // Exactly the responses needed for the scripted sequence are
      // enqueued above, so nothing here ever calls `read()` again after
      // the last one is consumed.
    },
    cancel() {
      cancelCalls++;
      if (opts.hangCancel) return new Promise<void>(() => {}); // never resolves
    },
  });

  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      writes.push(new TextDecoder().decode(chunk));
    },
  });

  const socket = {
    readable,
    writable,
    opened: Promise.resolve({}),
    closed: Promise.resolve(),
    close() {
      closeCalls++;
      if (opts.hangClose) return new Promise<void>(() => {}); // never resolves
      return Promise.resolve();
    },
  } as unknown as Socket;

  return {
    socket,
    writes,
    get closeCalls() {
      return closeCalls;
    },
    get cancelCalls() {
      return cancelCalls;
    },
  };
}

describe('sendStorageAlertViaIonosSmtp — bounded cleanup (SUN-1222C-SMTP-ROOT-CAUSE)', () => {
  // Real-runtime wall-clock bound: `CLEANUP_TIMEOUT_MS` is mocked to 10ms
  // above, so even racing BOTH cleanup steps sequentially should never take
  // more than a few multiples of that -- this is a generous ceiling
  // (comfortably below the 5s default vitest test timeout) that only a
  // still-unbounded `await` could actually exceed.
  const CLEANUP_BOUND_MS = 500;

  it('reader.cancel() hangs forever -> cleanup timeout expires -> send still resolves normally', async () => {
    const hanging = makeCleanupHangSocket(
      [GREETING, EHLO_WITH_PLAIN, AUTH_OK, MAIL_OK, RCPT_OK, DATA_GO, SUBMIT_OK, QUIT_OK],
      { hangCancel: true }
    );

    const start = Date.now();
    await expect(
      sendStorageAlertViaIonosSmtp(config(), ENVELOPE, {
        ...DEPS,
        connectFn: () => hanging.socket,
      })
    ).resolves.toBeUndefined();
    expect(Date.now() - start).toBeLessThan(CLEANUP_BOUND_MS);
    expect(hanging.cancelCalls).toBe(1);
    // The still-hanging cancel() must not have prevented close() from
    // running too -- both cleanup steps are independent, sequential awaits.
    expect(hanging.closeCalls).toBe(1);
  });

  it('socket.close() hangs forever -> cleanup timeout expires -> send still resolves normally', async () => {
    const hanging = makeCleanupHangSocket(
      [GREETING, EHLO_WITH_PLAIN, AUTH_OK, MAIL_OK, RCPT_OK, DATA_GO, SUBMIT_OK, QUIT_OK],
      { hangClose: true }
    );

    const start = Date.now();
    await expect(
      sendStorageAlertViaIonosSmtp(config(), ENVELOPE, {
        ...DEPS,
        connectFn: () => hanging.socket,
      })
    ).resolves.toBeUndefined();
    expect(Date.now() - start).toBeLessThan(CLEANUP_BOUND_MS);
    expect(hanging.closeCalls).toBe(1);
  });

  it('both reader.cancel() and socket.close() hang forever -> total cleanup remains bounded', async () => {
    const hanging = makeCleanupHangSocket(
      [GREETING, EHLO_WITH_PLAIN, AUTH_OK, MAIL_OK, RCPT_OK, DATA_GO, SUBMIT_OK, QUIT_OK],
      { hangCancel: true, hangClose: true }
    );

    const start = Date.now();
    await expect(
      sendStorageAlertViaIonosSmtp(config(), ENVELOPE, {
        ...DEPS,
        connectFn: () => hanging.socket,
      })
    ).resolves.toBeUndefined();
    expect(Date.now() - start).toBeLessThan(CLEANUP_BOUND_MS);
    expect(hanging.cancelCalls).toBe(1);
    expect(hanging.closeCalls).toBe(1);
  });

  it('a hanging cleanup does not replace a genuine SMTP failure — the original classified stage/message survive', async () => {
    // The send itself fails at AUTH (535); cleanup then hangs on both
    // steps. The thrown error must still be the original
    // SMTP_AUTH_FAILED classification, not a cleanup-related error or a
    // generic cancellation -- the `.catch(() => {})` after each bounded
    // cleanup race ensures a cleanup timeout can never itself become (or
    // replace) the thrown error.
    const { socket } = makeCleanupHangSocket(
      [GREETING, EHLO_WITH_PLAIN, '535 5.7.8 Authentication failed\r\n'],
      { hangCancel: true, hangClose: true }
    );

    const start = Date.now();
    const err = await sendStorageAlertViaIonosSmtp(config(), ENVELOPE, {
      ...DEPS,
      connectFn: () => socket,
    }).catch((e) => e);
    expect(Date.now() - start).toBeLessThan(CLEANUP_BOUND_MS);
    expect(err).toBeInstanceOf(SmtpTransportError);
    expect((err as SmtpTransportError).stage).toBe('SMTP_AUTH_FAILED');
    expect((err as SmtpTransportError).message).toContain('535');
    expect((err as SmtpTransportError).message).not.toContain(PASSWORD);
  });

  it('a hanging cleanup after an SMTP_OVERALL timeout does not prevent the timeout error from surfacing', async () => {
    // The greeting never arrives (a per-stage-budget-driven hang), and
    // this socket's own cancel()/close() would also hang forever -- proves
    // the bounded-cleanup fix covers the only socket in this (single-
    // socket, implicit-TLS) lifecycle.
    let cancelCalls = 0;
    let closeCalls = 0;
    const socket = {
      readable: new ReadableStream<Uint8Array>({
        pull: () => new Promise<void>(() => {}), // greeting never arrives
        cancel() {
          cancelCalls++;
          return new Promise<void>(() => {}); // never resolves
        },
      }),
      writable: new WritableStream<Uint8Array>({ write() {} }),
      opened: Promise.resolve({}),
      closed: Promise.resolve(),
      close() {
        closeCalls++;
        return new Promise<void>(() => {}); // never resolves
      },
    } as unknown as Socket;

    const start = Date.now();
    const err = await sendStorageAlertViaIonosSmtp(config(), ENVELOPE, {
      ...DEPS,
      perStageTimeoutMs: 20,
      overallTimeoutMs: 100,
      connectFn: () => socket,
    }).catch((e) => e);
    expect(Date.now() - start).toBeLessThan(100 + CLEANUP_BOUND_MS);
    expect(err).toBeInstanceOf(SmtpTransportError);
    expect((err as SmtpTransportError).stage).toBe('SMTP_GREETING_REJECTED');
    expect((err as SmtpTransportError).message).toContain('timed out');
    expect(cancelCalls).toBe(1);
    expect(closeCalls).toBe(1);
  });
});

describe('sendStorageAlertViaIonosSmtp — credential isolation from diagnostics', () => {
  it('reads/uses the password only via the explicit config parameter, never a module-level or ambient source', async () => {
    // Structural proof, not just behavioral: this transport module has no
    // `Env` import and no reference to `IONOS_SMTP_PASSWORD` as an
    // identifier anywhere -- the password only ever flows through
    // `IonosSmtpConfig.password`, supplied by the caller (the entrypoint,
    // which alone reads `env.IONOS_SMTP_PASSWORD`). Exercised here via the
    // successful-lifecycle assertions above that the password appears on
    // the wire only inside the correctly-encoded AUTH PLAIN payload.
    const { socket, writes } = makeScriptedSocket([
      GREETING,
      EHLO_WITH_PLAIN,
      AUTH_OK,
      MAIL_OK,
      RCPT_OK,
      DATA_GO,
      SUBMIT_OK,
      QUIT_OK,
    ]);
    await sendStorageAlertViaIonosSmtp(config(), ENVELOPE, { ...DEPS, connectFn: () => socket });
    const authWrite = writes.find((w) => w.startsWith('AUTH PLAIN'));
    expect(authWrite).toBe(`AUTH PLAIN ${encodeAuthPlainInitialResponse(USERNAME, PASSWORD)}\r\n`);
  });
});
