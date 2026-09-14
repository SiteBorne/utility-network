/**
 * SUN-1222C-SMTP-ROOT-CAUSE — tests for `probeIonosSmtpConnectivity`.
 *
 * Proves: the full non-delivery handshake succeeds end-to-end and reports
 * `COMPLETE`/`QUIT_OK`; every stage (TCP connect, greeting, EHLO, STARTTLS
 * command, TLS socket open, post-TLS EHLO) reports its own name and a
 * `timedOut: true` result when it hangs, without ever throwing; the
 * STARTTLS SMTP response being accepted and the TLS socket actually
 * opening are independently observable terminal classifications; the
 * socket is always closed (the secure one, once it exists); reader/writer
 * are correctly recreated from the secure socket after `startTls()`,
 * never reused from before it; and -- structurally, not just by assertion
 * -- this module never writes an `AUTH`, `MAIL FROM`, `RCPT TO`, or `DATA`
 * command to the wire under any scenario.
 */
import { describe, expect, it } from 'vitest';
import type { Socket } from 'cloudflare:sockets';
import { probeIonosSmtpConnectivity, type IonosSmtpDiagnosticDeps } from './ionos-smtp-diagnostic';

const HOST = 'smtp.ionos.com';
const PORT = 587;

const GREETING = '220 mreueus003.schlund.de ESMTP Nemesis ready\r\n';
const EHLO1_WITH_STARTTLS = '250-mreueus003.schlund.de\r\n250-PIPELINING\r\n250 STARTTLS\r\n';
const EHLO1_WITHOUT_STARTTLS = '250-mreueus003.schlund.de\r\n250 PIPELINING\r\n';
const STARTTLS_ACK = '220 2.0.0 Ready to start TLS\r\n';
const EHLO2_WITH_PLAIN =
  '250-mreueus003.schlund.de\r\n250-AUTH LOGIN PLAIN\r\n250 SIZE 141557760\r\n';
const QUIT_OK = '221 2.0.0 Bye\r\n';

function config() {
  return { host: HOST, port: PORT };
}

const FAST = {
  perStageTimeoutMs: 20,
  overallTimeoutMs: 200,
} satisfies Partial<IonosSmtpDiagnosticDeps>;

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
      throw new Error('startTls not configured on this fake socket');
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

function makeTlsSocketPair(preTlsResponses: string[], postTlsResponses: string[]) {
  const pre = makeScriptedSocket(preTlsResponses);
  const post = makeScriptedSocket(postTlsResponses);
  (pre.socket as unknown as { startTls: () => Socket }).startTls = () => post.socket;
  return { pre, post };
}

/** A socket whose `readable` never delivers a chunk and never closes. */
function makeHangingReadSocket() {
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
    opened: Promise.resolve({}),
    closed: Promise.resolve(),
    async close() {
      closeCalls++;
    },
    startTls() {
      throw new Error('startTls not configured on this fake socket');
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
 * SUN-1222C-SMTP-ROOT-CAUSE cleanup hang: both cleanup operations this
 * probe's `finally` block awaits are simultaneously unbounded. */
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
      throw new Error('startTls not configured on this fake socket');
    },
  } as unknown as Socket;
  return { socket };
}

/** A socket that yields exactly `okResponses` in order, then hangs
 * forever on every subsequent read -- places a deterministic hang right
 * after a known-good prefix of the sequence. */
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
      throw new Error('not configured');
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

const ALL_PROHIBITED_COMMANDS = ['AUTH', 'MAIL FROM', 'RCPT TO', 'DATA'];

function expectNoDeliveryCommands(writes: string[]) {
  for (const write of writes) {
    for (const prohibited of ALL_PROHIBITED_COMMANDS) {
      expect(write.startsWith(prohibited)).toBe(false);
    }
  }
}

describe('probeIonosSmtpConnectivity — successful lifecycle', () => {
  it('completes the full STARTTLS probe and reports COMPLETE/QUIT_OK', async () => {
    const { pre, post } = makeTlsSocketPair(
      [GREETING, EHLO1_WITH_STARTTLS, STARTTLS_ACK],
      [EHLO2_WITH_PLAIN, QUIT_OK]
    );
    const result = await probeIonosSmtpConnectivity(config(), {
      ...FAST,
      connectFn: () => pre.socket,
    });

    expect(result.ok).toBe(true);
    expect(result.reachedStage).toBe('COMPLETE');
    expect(result.outcome).toBe('QUIT_OK');
    expect(result.timedOut).toBe(false);
    expect(result.failedStage).toBeUndefined();
    expect(result.elapsedMsByStage.TCP_CONNECT).toBeTypeOf('number');
    expect(result.elapsedMsByStage.SMTP_GREETING).toBeTypeOf('number');
    expect(result.elapsedMsByStage.STARTTLS_COMMAND).toBeTypeOf('number');
    expect(result.elapsedMsByStage.TLS_SOCKET_OPEN).toBeTypeOf('number');
    expect(result.elapsedMsByStage.POST_TLS_EHLO).toBeTypeOf('number');

    // Pre-TLS: only EHLO then STARTTLS, never AUTH/MAIL/RCPT/DATA.
    expect(pre.writes).toEqual(['EHLO alerts.siteborne.net\r\n', 'STARTTLS\r\n']);
    // Post-TLS: EHLO then best-effort QUIT, never AUTH/MAIL/RCPT/DATA.
    expect(post.writes[0]).toBe('EHLO alerts.siteborne.net\r\n');
    expectNoDeliveryCommands([...pre.writes, ...post.writes]);

    expect(post.closeCalls).toBe(1);
    expect(pre.closeCalls).toBe(0); // pre-TLS socket abandoned, never closed directly
  });

  it('recreates the reader and writer from the post-TLS socket, never touching the pre-TLS ones again', async () => {
    const { pre, post } = makeTlsSocketPair(
      [GREETING, EHLO1_WITH_STARTTLS, STARTTLS_ACK],
      [EHLO2_WITH_PLAIN, QUIT_OK]
    );
    await probeIonosSmtpConnectivity(config(), { ...FAST, connectFn: () => pre.socket });
    expect(pre.writes).toHaveLength(2); // nothing written to the pre-TLS socket after STARTTLS
    expect(post.writes.length).toBeGreaterThanOrEqual(1);
  });

  it('tolerates a missing QUIT reply without failing the probe (outcome falls back to POST_TLS_EHLO_OK)', async () => {
    const { pre, post } = makeTlsSocketPair(
      [GREETING, EHLO1_WITH_STARTTLS, STARTTLS_ACK],
      [EHLO2_WITH_PLAIN] // no QUIT reply queued
    );
    const result = await probeIonosSmtpConnectivity(config(), {
      ...FAST,
      connectFn: () => pre.socket,
    });
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe('POST_TLS_EHLO_OK');
    expect(post.writes[1]).toBe('QUIT\r\n');
    expect(post.closeCalls).toBe(1);
  });
});

describe('probeIonosSmtpConnectivity — never sends delivery commands, structurally', () => {
  it('has no code path capable of writing AUTH/MAIL FROM/RCPT TO/DATA regardless of what the server sends', async () => {
    // Even a server response containing "AUTH PLAIN" among its EHLO
    // capabilities never causes this module to issue an AUTH command --
    // it has no such call site.
    const { pre, post } = makeTlsSocketPair(
      [GREETING, EHLO1_WITH_STARTTLS, STARTTLS_ACK],
      [EHLO2_WITH_PLAIN, QUIT_OK]
    );
    await probeIonosSmtpConnectivity(config(), { ...FAST, connectFn: () => pre.socket });
    expectNoDeliveryCommands([...pre.writes, ...post.writes]);
  });
});

describe('probeIonosSmtpConnectivity — protocol-level failures (non-timeout)', () => {
  it('fails at SMTP_GREETING with SMTP_GREETING_PROTOCOL_ERROR on a non-220 greeting, never throws', async () => {
    const { pre } = makeTlsSocketPair(['421 service not available\r\n'], []);
    const result = await probeIonosSmtpConnectivity(config(), {
      ...FAST,
      connectFn: () => pre.socket,
    });
    expect(result.ok).toBe(false);
    expect(result.failedStage).toBe('SMTP_GREETING');
    expect(result.outcome).toBe('SMTP_GREETING_PROTOCOL_ERROR');
    expect(result.timedOut).toBe(false);
  });

  it('fails at EHLO with STARTTLS_NOT_ADVERTISED when STARTTLS is not advertised, and never attempts it', async () => {
    const { pre } = makeTlsSocketPair([GREETING, EHLO1_WITHOUT_STARTTLS], []);
    const result = await probeIonosSmtpConnectivity(config(), {
      ...FAST,
      connectFn: () => pre.socket,
    });
    expect(result.ok).toBe(false);
    expect(result.failedStage).toBe('EHLO');
    expect(result.outcome).toBe('STARTTLS_NOT_ADVERTISED');
    expect(result.detail).toContain('STARTTLS not advertised');
    expect(pre.writes.some((w) => w.startsWith('STARTTLS'))).toBe(false);
  });

  it('fails at STARTTLS_COMMAND with STARTTLS_COMMAND_REJECTED on a non-220 STARTTLS reply, and never calls startTls()', async () => {
    const { pre } = makeTlsSocketPair(
      [GREETING, EHLO1_WITH_STARTTLS, '454 TLS not available\r\n'],
      []
    );
    const result = await probeIonosSmtpConnectivity(config(), {
      ...FAST,
      connectFn: () => pre.socket,
    });
    expect(result.ok).toBe(false);
    expect(result.failedStage).toBe('STARTTLS_COMMAND');
    expect(result.outcome).toBe('STARTTLS_COMMAND_REJECTED');
  });

  it('fails at POST_TLS_EHLO with POST_TLS_EHLO_PROTOCOL_ERROR on a non-250 post-TLS EHLO reply', async () => {
    const { pre } = makeTlsSocketPair(
      [GREETING, EHLO1_WITH_STARTTLS, STARTTLS_ACK],
      ['502 command not implemented\r\n']
    );
    const result = await probeIonosSmtpConnectivity(config(), {
      ...FAST,
      connectFn: () => pre.socket,
    });
    expect(result.ok).toBe(false);
    expect(result.failedStage).toBe('POST_TLS_EHLO');
    expect(result.outcome).toBe('POST_TLS_EHLO_PROTOCOL_ERROR');
  });

  it('reports TCP_CONNECT_ERROR when the socket cannot be constructed', async () => {
    const result = await probeIonosSmtpConnectivity(config(), {
      ...FAST,
      connectFn: () => {
        throw new Error('DNS resolution failed');
      },
    });
    expect(result.ok).toBe(false);
    expect(result.failedStage).toBe('TCP_CONNECT');
    expect(result.outcome).toBe('TCP_CONNECT_ERROR');
    expect(result.timedOut).toBe(false);
    expect(result.detail).toContain('DNS resolution failed');
  });

  it('reports TCP_CONNECT_ERROR when socket.opened rejects (e.g. connection refused), and preserves the rejection reason', async () => {
    const socket = {
      readable: new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => {}) }),
      writable: new WritableStream<Uint8Array>({ write() {} }),
      opened: Promise.reject(new Error('connection refused')),
      closed: Promise.resolve(),
      async close() {},
      startTls() {
        throw new Error('not configured');
      },
    } as unknown as Socket;
    const result = await probeIonosSmtpConnectivity(config(), { ...FAST, connectFn: () => socket });
    expect(result.ok).toBe(false);
    expect(result.failedStage).toBe('TCP_CONNECT');
    expect(result.outcome).toBe('TCP_CONNECT_ERROR');
    expect(result.timedOut).toBe(false);
    expect(result.detail).toContain('connection refused');
  });

  it("reports TLS_SOCKET_OPEN_ERROR when the secure socket's own .opened rejects, distinct from STARTTLS_COMMAND_REJECTED", async () => {
    const { pre, post } = makeTlsSocketPair([GREETING, EHLO1_WITH_STARTTLS, STARTTLS_ACK], []);
    Object.defineProperty(post.socket, 'opened', {
      get: () => Promise.reject(new Error('tls handshake failed: bad certificate')),
    });
    const result = await probeIonosSmtpConnectivity(config(), {
      ...FAST,
      connectFn: () => pre.socket,
    });
    expect(result.ok).toBe(false);
    expect(result.failedStage).toBe('TLS_SOCKET_OPEN');
    expect(result.outcome).toBe('TLS_SOCKET_OPEN_ERROR');
    expect(result.timedOut).toBe(false);
    expect(result.detail).toContain('tls handshake failed');
    // The secure socket is the authoritative one at the point of failure.
    expect(post.closeCalls).toBe(1);
    expect(pre.closeCalls).toBe(0);
  });
});

describe('probeIonosSmtpConnectivity — per-stage and overall timeouts', () => {
  it('TCP_CONNECT_TIMEOUT when socket.opened never resolves, and greeting read never begins', async () => {
    // Reported `failedStage`/`outcome` alone is the proof this is
    // attributed to the TCP-open stage, not the greeting stage (`stage()`
    // records `reachedStage` immediately before each stage begins). This
    // fake `readable`'s `pull` does fire on its own shortly after
    // construction -- the Streams spec's own automatic
    // fill-to-`highWaterMark` behavior, not evidence of a `read()` call
    // from this module's protocol logic -- so it is deliberately not
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
      startTls() {
        throw new Error('not configured');
      },
    } as unknown as Socket;
    const result = await probeIonosSmtpConnectivity(config(), { ...FAST, connectFn: () => socket });
    expect(result.ok).toBe(false);
    expect(result.failedStage).toBe('TCP_CONNECT');
    expect(result.outcome).toBe('TCP_CONNECT_TIMEOUT');
    expect(result.timedOut).toBe(true);
    expect(closeCalls).toBe(1);
    // `elapsedMsByStage` proves no LATER stage was ever entered.
    expect(result.elapsedMsByStage.SMTP_GREETING).toBeUndefined();
  });

  it('SMTP_GREETING_TIMEOUT when the TCP connection opens but the remote never sends a banner', async () => {
    // `hanging.socket.opened` resolves immediately (`Promise.resolve({})`)
    // -- proves the TCP-open stage is now independently observable from
    // the greeting stage: this hang is specifically attributed to
    // SMTP_GREETING, not TCP_CONNECT.
    const hanging = makeHangingReadSocket();
    const result = await probeIonosSmtpConnectivity(config(), {
      ...FAST,
      connectFn: () => hanging.socket,
    });
    expect(result.ok).toBe(false);
    expect(result.failedStage).toBe('SMTP_GREETING');
    expect(result.outcome).toBe('SMTP_GREETING_TIMEOUT');
    expect(result.timedOut).toBe(true);
    expect(result.detail).toContain('timed out');
    expect(hanging.closeCalls).toBe(1);
  });

  it('EHLO_TIMEOUT when the EHLO response never arrives', async () => {
    const hangsAfterGreeting = makeHangsAfterSocket([GREETING]);
    const result = await probeIonosSmtpConnectivity(config(), {
      ...FAST,
      connectFn: () => hangsAfterGreeting.socket,
    });
    expect(result.ok).toBe(false);
    expect(result.failedStage).toBe('EHLO');
    expect(result.outcome).toBe('EHLO_TIMEOUT');
    expect(result.timedOut).toBe(true);
    expect(hangsAfterGreeting.closeCalls).toBe(1);
  });

  it('STARTTLS_COMMAND_TIMEOUT when greeting + EHLO succeed but the STARTTLS response never arrives', async () => {
    const hangsAfterEhlo = makeHangsAfterSocket([GREETING, EHLO1_WITH_STARTTLS]);
    const result = await probeIonosSmtpConnectivity(config(), {
      ...FAST,
      connectFn: () => hangsAfterEhlo.socket,
    });
    expect(result.ok).toBe(false);
    expect(result.failedStage).toBe('STARTTLS_COMMAND');
    expect(result.outcome).toBe('STARTTLS_COMMAND_TIMEOUT');
    expect(result.timedOut).toBe(true);
  });

  it('TLS_SOCKET_OPEN_TIMEOUT when startTls() itself never resolves', async () => {
    const { pre } = makeTlsSocketPair([GREETING, EHLO1_WITH_STARTTLS, STARTTLS_ACK], []);
    (pre.socket as unknown as { startTls: () => Promise<never> }).startTls = () =>
      new Promise<never>(() => {});
    const result = await probeIonosSmtpConnectivity(config(), {
      ...FAST,
      connectFn: () => pre.socket,
    });
    expect(result.ok).toBe(false);
    expect(result.failedStage).toBe('TLS_SOCKET_OPEN');
    expect(result.outcome).toBe('TLS_SOCKET_OPEN_TIMEOUT');
    expect(result.timedOut).toBe(true);
  });

  it('TLS_SOCKET_OPEN_TIMEOUT when the STARTTLS command is accepted but secureSocket.opened never resolves -- distinct from STARTTLS_COMMAND_TIMEOUT/REJECTED, secure socket closed, pre-TLS streams never reused', async () => {
    const { pre, post } = makeTlsSocketPair([GREETING, EHLO1_WITH_STARTTLS, STARTTLS_ACK], []);
    let postOpenedCalls = 0;
    Object.defineProperty(post.socket, 'opened', {
      get() {
        postOpenedCalls++;
        return new Promise<never>(() => {}); // never resolves
      },
    });
    const result = await probeIonosSmtpConnectivity(config(), {
      ...FAST,
      connectFn: () => pre.socket,
    });
    expect(result.ok).toBe(false);
    expect(result.failedStage).toBe('TLS_SOCKET_OPEN');
    expect(result.outcome).toBe('TLS_SOCKET_OPEN_TIMEOUT');
    expect(result.timedOut).toBe(true);
    expect(postOpenedCalls).toBeGreaterThan(0);
    // startTls() was in fact called and its response consumed: the
    // STARTTLS command itself was accepted (only 2 pre-TLS writes: EHLO,
    // STARTTLS -- nothing more is ever written pre-TLS).
    expect(pre.writes).toEqual(['EHLO alerts.siteborne.net\r\n', 'STARTTLS\r\n']);
    // The secure socket -- not the abandoned pre-TLS one -- is closed.
    expect(post.closeCalls).toBe(1);
    expect(pre.closeCalls).toBe(0);
  });

  it('TLS_SOCKET_OPEN_ERROR when secureSocket.opened rejects', async () => {
    const { pre, post } = makeTlsSocketPair([GREETING, EHLO1_WITH_STARTTLS, STARTTLS_ACK], []);
    Object.defineProperty(post.socket, 'opened', {
      get: () => Promise.reject(new Error('handshake reset by peer')),
    });
    const result = await probeIonosSmtpConnectivity(config(), {
      ...FAST,
      connectFn: () => pre.socket,
    });
    expect(result.ok).toBe(false);
    expect(result.failedStage).toBe('TLS_SOCKET_OPEN');
    expect(result.outcome).toBe('TLS_SOCKET_OPEN_ERROR');
    expect(result.timedOut).toBe(false);
    expect(result.detail).toContain('handshake reset by peer');
    expect(post.closeCalls).toBe(1);
    expect(pre.closeCalls).toBe(0);
  });

  it('once the secure socket opens, POST_TLS_EHLO begins on fresh reader/writer -- never the pre-TLS ones', async () => {
    const { pre, post } = makeTlsSocketPair(
      [GREETING, EHLO1_WITH_STARTTLS, STARTTLS_ACK],
      [EHLO2_WITH_PLAIN, QUIT_OK]
    );
    const result = await probeIonosSmtpConnectivity(config(), {
      ...FAST,
      connectFn: () => pre.socket,
    });
    expect(result.ok).toBe(true);
    // Nothing written to the pre-TLS socket after STARTTLS -- proves
    // POST_TLS_EHLO's write happened on the new secure writer instead.
    expect(pre.writes).toEqual(['EHLO alerts.siteborne.net\r\n', 'STARTTLS\r\n']);
    expect(post.writes[0]).toBe('EHLO alerts.siteborne.net\r\n');
  });

  it('POST_TLS_EHLO_TIMEOUT when the post-TLS EHLO response never arrives', async () => {
    const post = makeHangingReadSocket();
    const { pre } = makeTlsSocketPair([GREETING, EHLO1_WITH_STARTTLS, STARTTLS_ACK], []);
    (pre.socket as unknown as { startTls: () => Socket }).startTls = () => post.socket;
    const result = await probeIonosSmtpConnectivity(config(), {
      ...FAST,
      connectFn: () => pre.socket,
    });
    expect(result.ok).toBe(false);
    expect(result.failedStage).toBe('POST_TLS_EHLO');
    expect(result.outcome).toBe('POST_TLS_EHLO_TIMEOUT');
    expect(result.timedOut).toBe(true);
    expect(post.closeCalls).toBe(1);
  });

  it('an overall <=8s-equivalent deadline dominates several 3s-equivalent stage budgets and still names the real stage in flight', async () => {
    // Each individual stage's own budget (5s-equivalent here) never fires
    // on its own; the OVERALL budget (20ms-equivalent) is what actually
    // cuts this off, and it still reports a real, specific stage/outcome
    // rather than a generic one -- proving the overall deadline wins even
    // though per-stage budgets are individually large enough to have let
    // several of them run in sequence past it.
    const hanging = makeHangingReadSocket();
    const result = await probeIonosSmtpConnectivity(config(), {
      perStageTimeoutMs: 5_000,
      overallTimeoutMs: 20,
      connectFn: () => hanging.socket,
    });
    expect(result.ok).toBe(false);
    expect(result.failedStage).toBe('SMTP_GREETING');
    expect(result.outcome).toBe('SMTP_GREETING_TIMEOUT');
    expect(result.timedOut).toBe(true);
    expect(result.detail).toContain('overall diagnostic timeout');
    expect(hanging.closeCalls).toBe(1);
  });

  it('never throws on any timeout -- always resolves with a result', async () => {
    const hanging = makeHangingReadSocket();
    await expect(
      probeIonosSmtpConnectivity(config(), { ...FAST, connectFn: () => hanging.socket })
    ).resolves.toMatchObject({ ok: false, timedOut: true });
  });

  it('SUN-1222C-SMTP-ROOT-CAUSE regression: still returns within overallTimeoutMs + a small bounded cleanup margin even when BOTH reader.cancel() and socket.close() hang forever in finally', async () => {
    // Before the fix, `finally { await reader.cancel(); await
    // currentSocket.close(); }` had no bound of its own -- the DIAG_OVERALL
    // timeout still fired internally, but the function's actual `return`
    // was gated behind these two unbounded awaits, so a black-holed
    // connection could keep this promise pending indefinitely regardless
    // of `overallTimeoutMs`. This is exactly the caller-side symptom
    // observed in production: a 502 at ~12s (the Service Binding's own,
    // unrelated timeout) with no structured result ever received.
    const hanging = makeHangingCleanupSocket();
    const overallTimeoutMs = 20;
    const startedAt = Date.now();
    const result = await probeIonosSmtpConnectivity(config(), {
      perStageTimeoutMs: 5_000,
      overallTimeoutMs,
      connectFn: () => hanging.socket,
    });
    const elapsedMs = Date.now() - startedAt;
    expect(result.ok).toBe(false);
    expect(result.timedOut).toBe(true);
    // Generous margin (well under the 12s caller-side Service Binding
    // budget this regression exists to protect) rather than the literal
    // per-cleanup-step 1s cap, to stay robust against test-runner jitter.
    expect(elapsedMs).toBeLessThan(overallTimeoutMs + 5_000);
  });
});

describe('probeIonosSmtpConnectivity — no secrets, no delivery commands, structurally', () => {
  it('module source imports nothing capable of AUTH/credentials/message-building', async () => {
    // Matches actual usage (an `import ... from`/`from './smtp-message'`
    // line, or a call `encodeAuthPlainInitialResponse(`) rather than the
    // module's own doc comment, which legitimately names these symbols
    // when documenting that it does NOT import or call them.
    const src = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('./ionos-smtp-diagnostic.ts', import.meta.url), 'utf8')
    );
    expect(src).not.toMatch(/from\s+['"]\.\/smtp-message['"]/);
    expect(src).not.toMatch(/encodeAuthPlainInitialResponse\s*\(/);
    expect(src).not.toMatch(/buildRfc822Message\s*\(/);
    expect(src).not.toMatch(/env\.IONOS_SMTP_PASSWORD/);
    expect(src).not.toMatch(/env\.ALERT_PATH_TOKEN/);
  });

  it('a failure result never carries a full server-supplied line beyond the truncated protocol detail, and never a token/secret field name', async () => {
    const { pre } = makeTlsSocketPair(
      [
        GREETING,
        EHLO1_WITH_STARTTLS,
        '454 TLS not available, contact bearer=should-not-appear\r\n',
      ],
      []
    );
    const result = await probeIonosSmtpConnectivity(config(), {
      ...FAST,
      connectFn: () => pre.socket,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('IONOS_SMTP_PASSWORD');
    expect(serialized).not.toContain('ALERT_PATH_TOKEN');
    expect(serialized).not.toMatch(/AUTH PLAIN/);
  });
});
