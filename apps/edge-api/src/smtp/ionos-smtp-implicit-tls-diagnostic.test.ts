/**
 * SUN-1222C-SMTP-ROOT-CAUSE — tests for `probeIonosSmtpImplicitTlsConnectivity`.
 *
 * Proves: the full non-delivery implicit-TLS handshake succeeds end-to-end
 * and reports `COMPLETE`/`QUIT_OK`; the connect/open, greeting, and EHLO
 * stages each report their own name and a `timedOut: true` result when they
 * hang, without ever throwing; connect() is invoked with
 * `secureTransport: "on"` (never `"starttls"`); bounded cleanup
 * (`reader.cancel()` / `socket.close()`) lets the function still return even
 * when either hangs forever; and -- structurally, not just by assertion --
 * this module never writes a `STARTTLS`, `AUTH`, `MAIL FROM`, `RCPT TO`, or
 * `DATA` command to the wire under any scenario, and never reads an
 * IONOS_SMTP_PASSWORD-shaped credential (there is no such field on its
 * config type at all).
 */
import { describe, expect, it } from 'vitest';
import type { Socket } from 'cloudflare:sockets';
import {
  probeIonosSmtpImplicitTlsConnectivity,
  type ImplicitTlsSmtpDiagnosticDeps,
} from './ionos-smtp-implicit-tls-diagnostic';

const HOST = 'smtp.ionos.com';
const PORT = 465;

const GREETING = '220 mreueus003.schlund.de ESMTP Nemesis ready\r\n';
const EHLO_OK = '250-mreueus003.schlund.de\r\n250-AUTH LOGIN PLAIN\r\n250 SIZE 141557760\r\n';
const QUIT_OK = '221 2.0.0 Bye\r\n';

function config() {
  return { host: HOST, port: PORT };
}

const FAST = {
  perStageTimeoutMs: 20,
  overallTimeoutMs: 200,
} satisfies Partial<ImplicitTlsSmtpDiagnosticDeps>;

function makeScriptedSocket(responses: string[]) {
  const writes: string[] = [];
  let closeCalls = 0;
  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const resp of responses) controller.enqueue(encoder.encode(resp));
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
    startTls() {
      throw new Error('startTls must never be called by the implicit-TLS probe');
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

/** A socket whose `opened` promise never settles. */
function makeHangingOpenSocket() {
  const writes: string[] = [];
  let closeCalls = 0;
  const readable = new ReadableStream<Uint8Array>({
    pull() {
      return new Promise<void>(() => {});
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
    opened: new Promise<void>(() => {}),
    closed: Promise.resolve(),
    async close() {
      closeCalls++;
    },
    startTls() {
      throw new Error('startTls must never be called by the implicit-TLS probe');
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

/** A socket whose `readable` never delivers a chunk (so `reader.cancel()`
 * in the probe's `finally` block races a stream that has a pending read),
 * and whose own `close()` never resolves either -- reproduces the
 * SUN-1222C-SMTP-ROOT-CAUSE cleanup hang for this probe too. */
function makeHangingCleanupSocket() {
  const readable = new ReadableStream<Uint8Array>({
    pull() {
      return new Promise<void>(() => {});
    },
    cancel() {
      return new Promise<void>(() => {});
    },
  });
  const writable = new WritableStream<Uint8Array>({
    write() {},
  });
  const socket = {
    readable,
    writable,
    opened: Promise.resolve({}),
    closed: new Promise<void>(() => {}),
    close() {
      return new Promise<void>(() => {});
    },
    startTls() {
      throw new Error('startTls must never be called by the implicit-TLS probe');
    },
  } as unknown as Socket;
  return { socket };
}

/** A socket that yields exactly `okResponses` in order, then hangs forever
 * on every subsequent read. */
function makeHangsAfterSocket(okResponses: string[]) {
  let n = 0;
  const readable = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (n < okResponses.length) {
        controller.enqueue(new TextEncoder().encode(okResponses[n]));
        n++;
        return;
      }
      return new Promise<void>(() => {});
    },
  });
  const writes: string[] = [];
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      writes.push(new TextDecoder().decode(chunk));
    },
  });
  let closeCalls = 0;
  const socket = {
    readable,
    writable,
    opened: Promise.resolve({}),
    closed: Promise.resolve(),
    async close() {
      closeCalls++;
    },
    startTls() {
      throw new Error('startTls must never be called by the implicit-TLS probe');
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

const ALL_PROHIBITED_COMMANDS = ['STARTTLS', 'AUTH', 'MAIL FROM', 'RCPT TO', 'DATA'];

function expectNoStartTlsOrDeliveryCommands(writes: string[]) {
  for (const write of writes) {
    for (const prohibited of ALL_PROHIBITED_COMMANDS) {
      expect(write.startsWith(prohibited)).toBe(false);
    }
  }
}

describe('probeIonosSmtpImplicitTlsConnectivity — successful lifecycle', () => {
  it('completes the full implicit-TLS probe and reports COMPLETE/QUIT_OK', async () => {
    const { socket, writes } = makeScriptedSocket([GREETING, EHLO_OK, QUIT_OK]);
    let capturedOptions: { secureTransport?: string } | undefined;
    const result = await probeIonosSmtpImplicitTlsConnectivity(config(), {
      ...FAST,
      connectFn: (address, options) => {
        capturedOptions = options;
        expect(address).toEqual({ hostname: HOST, port: PORT });
        return socket;
      },
    });

    expect(result.ok).toBe(true);
    expect(result.reachedStage).toBe('COMPLETE');
    expect(result.outcome).toBe('QUIT_OK');
    expect(result.timedOut).toBe(false);
    expect(result.failedStage).toBeUndefined();
    expect(result.elapsedMsByStage.IMPLICIT_TLS_CONNECT).toBeTypeOf('number');
    expect(result.elapsedMsByStage.SMTP_GREETING).toBeTypeOf('number');
    expect(result.elapsedMsByStage.EHLO).toBeTypeOf('number');

    // Implicit TLS, never STARTTLS.
    expect(capturedOptions).toEqual({ secureTransport: 'on' });

    expect(writes).toEqual(['EHLO alerts.siteborne.net\r\n', 'QUIT\r\n']);
    expectNoStartTlsOrDeliveryCommands(writes);
  });

  it('closes the socket exactly once on success', async () => {
    const fake = makeScriptedSocket([GREETING, EHLO_OK, QUIT_OK]);
    await probeIonosSmtpImplicitTlsConnectivity(config(), {
      ...FAST,
      connectFn: () => fake.socket,
    });
    expect(fake.closeCalls).toBe(1);
  });

  it('tolerates a missing QUIT reply without failing the probe (outcome falls back to EHLO_OK)', async () => {
    const fake = makeScriptedSocket([GREETING, EHLO_OK]); // no QUIT reply queued
    const result = await probeIonosSmtpImplicitTlsConnectivity(config(), {
      ...FAST,
      connectFn: () => fake.socket,
    });
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe('EHLO_OK');
    expect(fake.writes[1]).toBe('QUIT\r\n');
    expect(fake.closeCalls).toBe(1);
  });
});

describe('probeIonosSmtpImplicitTlsConnectivity — per-stage timeouts', () => {
  it('IMPLICIT_TLS_CONNECT_TIMEOUT when socket.opened never resolves', async () => {
    const fake = makeHangingOpenSocket();
    const result = await probeIonosSmtpImplicitTlsConnectivity(config(), {
      ...FAST,
      connectFn: () => fake.socket,
    });
    expect(result.ok).toBe(false);
    expect(result.failedStage).toBe('IMPLICIT_TLS_CONNECT');
    expect(result.outcome).toBe('IMPLICIT_TLS_CONNECT_TIMEOUT');
    expect(result.timedOut).toBe(true);
    expect(fake.closeCalls).toBe(1); // still cleaned up
  });

  it('IMPLICIT_TLS_CONNECT_ERROR when connectFn throws synchronously', async () => {
    const result = await probeIonosSmtpImplicitTlsConnectivity(config(), {
      ...FAST,
      connectFn: () => {
        throw new Error('DNS resolution failed');
      },
    });
    expect(result.ok).toBe(false);
    expect(result.failedStage).toBe('IMPLICIT_TLS_CONNECT');
    expect(result.outcome).toBe('IMPLICIT_TLS_CONNECT_ERROR');
    expect(result.timedOut).toBe(false);
    expect(result.detail).toContain('DNS resolution failed');
  });

  it('SMTP_GREETING_TIMEOUT when the remote never sends a banner', async () => {
    const fake = makeHangsAfterSocket([]);
    const result = await probeIonosSmtpImplicitTlsConnectivity(config(), {
      ...FAST,
      connectFn: () => fake.socket,
    });
    expect(result.ok).toBe(false);
    expect(result.failedStage).toBe('SMTP_GREETING');
    expect(result.outcome).toBe('SMTP_GREETING_TIMEOUT');
    expect(result.timedOut).toBe(true);
    expect(fake.closeCalls).toBe(1);
  });

  it('SMTP_GREETING_PROTOCOL_ERROR on a non-220 greeting', async () => {
    const { socket } = makeHangsAfterSocket(['421 service not available\r\n']);
    const result = await probeIonosSmtpImplicitTlsConnectivity(config(), {
      ...FAST,
      connectFn: () => socket,
    });
    expect(result.ok).toBe(false);
    expect(result.failedStage).toBe('SMTP_GREETING');
    expect(result.outcome).toBe('SMTP_GREETING_PROTOCOL_ERROR');
    expect(result.timedOut).toBe(false);
  });

  it('EHLO_TIMEOUT when the EHLO reply never arrives', async () => {
    const fake = makeHangsAfterSocket([GREETING]);
    const result = await probeIonosSmtpImplicitTlsConnectivity(config(), {
      ...FAST,
      connectFn: () => fake.socket,
    });
    expect(result.ok).toBe(false);
    expect(result.failedStage).toBe('EHLO');
    expect(result.outcome).toBe('EHLO_TIMEOUT');
    expect(result.timedOut).toBe(true);
    expect(fake.closeCalls).toBe(1);
  });

  it('EHLO_PROTOCOL_ERROR on a non-250 EHLO reply', async () => {
    const { socket } = makeHangsAfterSocket([GREETING, '550 go away\r\n']);
    const result = await probeIonosSmtpImplicitTlsConnectivity(config(), {
      ...FAST,
      connectFn: () => socket,
    });
    expect(result.ok).toBe(false);
    expect(result.failedStage).toBe('EHLO');
    expect(result.outcome).toBe('EHLO_PROTOCOL_ERROR');
    expect(result.timedOut).toBe(false);
  });
});

describe('probeIonosSmtpImplicitTlsConnectivity — bounded cleanup (SUN-1222C-SMTP-ROOT-CAUSE)', () => {
  it('still returns a structured result within the cleanup budget when reader.cancel() and socket.close() both hang forever', async () => {
    const { socket } = makeHangingCleanupSocket();
    const start = Date.now();
    const result = await probeIonosSmtpImplicitTlsConnectivity(config(), {
      ...FAST,
      connectFn: () => socket,
    });
    const elapsed = Date.now() - start;

    expect(result.ok).toBe(false);
    // `opened` resolves immediately on this fake; the hang is in the first
    // read, so the stage that actually times out is SMTP_GREETING, not the
    // connect stage -- the point of this test is bounded cleanup, not which
    // stage got there.
    expect(result.failedStage).toBe('SMTP_GREETING');
    // FAST.overallTimeoutMs=200 + 2×CLEANUP_TIMEOUT_MS bound, comfortably
    // under what an unbounded hang would take (this test would otherwise
    // never resolve at all).
    expect(elapsed).toBeLessThan(FAST.overallTimeoutMs + 2_500);
  });
});

describe('probeIonosSmtpImplicitTlsConnectivity — structural non-delivery guarantees', () => {
  it('never writes STARTTLS/AUTH/MAIL FROM/RCPT TO/DATA across a full successful run', async () => {
    const { socket, writes } = makeScriptedSocket([GREETING, EHLO_OK, QUIT_OK]);
    await probeIonosSmtpImplicitTlsConnectivity(config(), { ...FAST, connectFn: () => socket });
    expectNoStartTlsOrDeliveryCommands(writes);
  });

  it('never invokes socket.startTls() (the fake socket throws if it is called)', async () => {
    const { socket } = makeScriptedSocket([GREETING, EHLO_OK, QUIT_OK]);
    // makeScriptedSocket's startTls() throws synchronously if ever called;
    // a successful, non-throwing probe run is itself the proof this
    // module never calls it.
    await expect(
      probeIonosSmtpImplicitTlsConnectivity(config(), { ...FAST, connectFn: () => socket })
    ).resolves.toMatchObject({ ok: true });
  });

  it('has no password/username/from/to field on its config type (compile-time guarantee)', () => {
    // If this file compiles, `config()` -- typed as
    // `ImplicitTlsSmtpDiagnosticConfig` -- has only `host`/`port`; adding a
    // credential field to that interface would not break this assertion,
    // which is why the real guarantee is the absence of any
    // `IONOS_SMTP_PASSWORD`/`encodeAuthPlainInitialResponse` import above,
    // not a runtime check. This test exists so intent is visible next to
    // the behavioral tests above, not as the enforcement mechanism itself.
    expect(Object.keys(config())).toEqual(['host', 'port']);
  });
});
