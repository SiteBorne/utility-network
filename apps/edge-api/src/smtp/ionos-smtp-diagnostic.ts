/**
 * SUN-1222C-SMTP-ROOT-CAUSE — a bounded, NON-DELIVERY SMTP connectivity
 * probe for `smtp.ionos.com`. Exists to identify exactly which stage of
 * the STARTTLS handshake is hanging (the second live storage-alert
 * qualification attempt observed wallTime=9979ms, cpuTime=4ms,
 * outcome=canceled, zero logs -- consistent with an indefinite hang
 * somewhere in `ionos-smtp-transport.ts`'s protocol sequence, but not, by
 * itself, proof of *which* stage) without ever risking a real email send.
 *
 * Structurally incapable of sending mail: this module has no code path
 * for `AUTH`, `MAIL FROM`, `RCPT TO`, or `DATA` at all -- it does not
 * import `encodeAuthPlainInitialResponse`, `buildRfc822Message`, or any
 * password/credential type, and its own `IonosSmtpDiagnosticConfig` has no
 * `password`/`username`/`from`/`to` field for a caller to even attempt to
 * supply one. The sequence it performs is exactly: TCP connect -> read
 * greeting -> EHLO -> (if STARTTLS is advertised) STARTTLS -> TLS upgrade
 * -> post-TLS EHLO -> best-effort QUIT -> close. Every step shares
 * `ionos-smtp-transport.ts`'s own `hasStartTls`/`writeLine`/
 * `SmtpResponseReader` so the wire behavior this probes is exactly the
 * real transport's, not a re-implementation that could silently drift.
 *
 * Every stage is individually bounded (`perStageTimeoutMs`, default 3s)
 * and the whole probe additionally bounded overall (`overallTimeoutMs`,
 * default 8s) via the same `withTimeout` helper `ionos-smtp-transport.ts`
 * uses -- a dead server or black-holed connection can consume at most one
 * stage's budget before this module reports exactly where it got stuck,
 * closes its socket, and returns a deterministic result. Never throws:
 * every failure mode (including a timeout) is reported in the returned
 * `SmtpDiagnosticResult`, never as a rejected promise, so a caller never
 * needs its own catch-all to stay fail-closed.
 *
 * `TCP_CONNECT` explicitly covers BOTH ways the TCP connection itself can
 * fail to establish: `connectFn()` throwing synchronously (e.g. a DNS
 * resolution failure) and Cloudflare's `Socket.opened` promise rejecting
 * or never settling -- the latter is explicitly awaited, under its own
 * bounded stage, before any greeting read is even attempted. This keeps
 * "the TCP connection never opened" (`TCP_CONNECT_TIMEOUT`/
 * `TCP_CONNECT_ERROR`) independently observable from "it opened, but the
 * remote never sent an SMTP banner" (`SMTP_GREETING_*`) -- the same
 * distinction `ionos-smtp-transport.ts`'s real transport now makes.
 *
 * STARTTLS/TLS observability correction (same investigation, after the
 * TCP/greeting distinction above still left one more conflation in
 * place): "the STARTTLS command was accepted by the SMTP server" (a
 * 220 reply to the `STARTTLS` line, still over plaintext) and "the TLS
 * socket Cloudflare handed back from `startTls()` is actually open and
 * usable" are two DIFFERENT things that can independently hang or fail --
 * a server can accept STARTTLS at the protocol level while the TLS
 * handshake itself (certificate negotiation, network path) never
 * completes, or vice versa is simply not possible (this transport never
 * calls `startTls()` before the 220), but the important direction is the
 * one that previously WAS conflated: a hang or rejection here used to be
 * reported under one combined stage regardless of whether the SMTP
 * response or the TLS handshake was what actually got stuck. This module
 * now keeps them as two distinct stages, `STARTTLS_COMMAND` (send the
 * command, read and classify the SMTP response --
 * `STARTTLS_COMMAND_REJECTED` on a non-220 reply,
 * `STARTTLS_COMMAND_ACCEPTED` internally once it is) and `TLS_SOCKET_OPEN`
 * (call `startTls()`, treat its returned secure `Socket` as the new
 * authoritative socket immediately, then explicitly await THAT socket's
 * own `.opened` promise under its own bounded timeout -- `TLS_SOCKET_OPEN_OK`
 * only once that settles). The pre-TLS reader/writer/`SmtpResponseReader`
 * are never read from or written to again once `startTls()` resolves; the
 * post-TLS EHLO is performed exclusively against fresh reader/writer
 * instances obtained from the secure socket.
 *
 * Nothing this module logs, returns, or throws ever contains a secret --
 * it has none to leak (no password, no bearer/path token; those live only
 * in the receiver's `fetch` handler and the qualification/diagnostic edge
 * routes, neither of which this module touches or imports).
 */
import type { Socket } from 'cloudflare:sockets';
import { connect as cloudflareConnect } from '../cloudflare-sockets-ambient';
import { SmtpResponseReader } from './smtp-response-reader';
import { hasStartTls, writeLine, type ConnectFn } from './ionos-smtp-transport';
import { StageTimeoutError, withTimeout } from './smtp-stage-timeout';

/** Coarse stage identity used for elapsed-time bookkeeping and as the
 * `failedStage`/`reachedStage` value on failure. Kept deliberately
 * separate from `SmtpDiagnosticOutcome` (below): a single stage can reach
 * more than one distinct terminal classification (e.g. `STARTTLS_COMMAND`
 * can end in `STARTTLS_COMMAND_TIMEOUT` or `STARTTLS_COMMAND_REJECTED`). */
export type SmtpDiagnosticStage =
  | 'TCP_CONNECT'
  | 'SMTP_GREETING'
  | 'EHLO'
  | 'STARTTLS_COMMAND'
  | 'TLS_SOCKET_OPEN'
  | 'POST_TLS_EHLO'
  | 'QUIT';

/** The full set of terminal classifications this probe can report.
 * `STARTTLS_COMMAND_ACCEPTED` and `TLS_SOCKET_OPEN_OK` are deliberately
 * distinct values -- see this module's doc comment -- even though both
 * are "successes" that let the probe continue past them; they are only
 * ever the probe's *external* outcome when the probe stops immediately
 * after reaching them (which does not currently happen, since the
 * sequence always continues on to the next stage, but they are reported
 * as the `outcome` of the fully-successful result whenever that IS the
 * furthest point actually reached, e.g. a caller that only cares "did
 * TLS come up" can stop trusting the result past that field). */
export type SmtpDiagnosticOutcome =
  | 'TCP_CONNECT_TIMEOUT'
  | 'TCP_CONNECT_ERROR'
  | 'SMTP_GREETING_TIMEOUT'
  | 'SMTP_GREETING_PROTOCOL_ERROR'
  | 'EHLO_TIMEOUT'
  | 'EHLO_PROTOCOL_ERROR'
  | 'STARTTLS_NOT_ADVERTISED'
  | 'STARTTLS_COMMAND_TIMEOUT'
  | 'STARTTLS_COMMAND_REJECTED'
  | 'STARTTLS_COMMAND_ACCEPTED'
  | 'TLS_SOCKET_OPEN_TIMEOUT'
  | 'TLS_SOCKET_OPEN_ERROR'
  | 'TLS_SOCKET_OPEN_OK'
  | 'POST_TLS_EHLO_TIMEOUT'
  | 'POST_TLS_EHLO_PROTOCOL_ERROR'
  | 'POST_TLS_EHLO_OK'
  | 'QUIT_OK';

export interface IonosSmtpDiagnosticConfig {
  readonly host: string;
  readonly port: number;
}

export interface IonosSmtpDiagnosticDeps {
  readonly connectFn?: ConnectFn;
  readonly ehloHostname?: string;
  readonly perStageTimeoutMs?: number;
  readonly overallTimeoutMs?: number;
}

/** Every field here is safe to return to a caller (and ultimately to
 * serialize as a JSON HTTP response body): reply codes/text the remote
 * server itself sent in plaintext, stage/outcome names, elapsed
 * milliseconds, and a boolean. Never a credential, because none is ever
 * read. */
export interface SmtpDiagnosticResult {
  readonly ok: boolean;
  /** The last stage this probe entered. `'COMPLETE'` only when every
   * stage above succeeded (including a best-effort QUIT attempt). */
  readonly reachedStage: SmtpDiagnosticStage | 'COMPLETE';
  /** The precise terminal classification reached -- see
   * `SmtpDiagnosticOutcome`. Always present, success or failure. */
  readonly outcome: SmtpDiagnosticOutcome;
  /** Present only when `ok` is `false`: the stage that actually failed or
   * timed out. */
  readonly failedStage?: SmtpDiagnosticStage;
  readonly timedOut: boolean;
  readonly elapsedMsByStage: Partial<Record<SmtpDiagnosticStage, number>>;
  /** Non-secret detail: a server reply code/text, a timeout description,
   * or a transport-level error message (e.g. "DNS resolution failed").
   * Absent on full success. */
  readonly detail?: string;
}

const DEFAULT_PER_STAGE_TIMEOUT_MS = 3_000;
/** Exported so `storage-alert-receiver-entrypoint.ts`'s zero-network
 * `CONTROL_OVERALL_TIMEOUT` control can race the identical duration against
 * the identical `withTimeout` primitive this module uses for its own
 * `DIAG_OVERALL` stage -- proving (or disproving) the timeout/catch path in
 * isolation from any socket/stream involvement, without duplicating the
 * magic number. */
export const DEFAULT_OVERALL_TIMEOUT_MS = 8_000;
const DEFAULT_EHLO_HOSTNAME = 'alerts.siteborne.net';
/** SUN-1222C-SMTP-ROOT-CAUSE fix: the `finally` block below used to `await`
 * `reader.cancel()` and `currentSocket.close()` with no bound of their own
 * -- fine when the socket is healthy, but exactly the kind of operation
 * that can hang indefinitely on a black-holed or half-upgraded TLS
 * connection, which is the very failure mode this probe exists to detect.
 * When that happened, the `DIAG_OVERALL` timeout still fired internally at
 * `overallTimeoutMs` and was still caught, but the resulting
 * `SmtpDiagnosticResult` could never actually be `return`ed past this
 * `finally` -- so the caller (the Service Binding fetch in
 * `storage-alert-smtp-diagnostic-route.ts`) saw nothing until its OWN,
 * unrelated 12s budget aborted the whole call, with zero structured result
 * ever received. Bounding each cleanup step keeps the worst case at
 * `overallTimeoutMs + 2 * CLEANUP_TIMEOUT_MS`, comfortably under that 12s
 * caller budget, and guarantees this function's own `return`/`throw`
 * always reflects the actual probe outcome, never a stuck cleanup.
 *
 * Exported (SUN-1222C-SMTP-ROOT-CAUSE Service-Binding-isolation addendum)
 * solely so `storage-alert-receiver-entrypoint.ts`'s zero-network
 * `CLEANUP_HANG` control mode can race the exact same budget against
 * never-resolving stand-ins for `reader.cancel()`/`socket.close()`,
 * proving the bounded-cleanup fix itself without duplicating the magic
 * number or touching a real socket. */
export const CLEANUP_TIMEOUT_MS = 1_000;

/** Maps each stage to the outcome its own timeout resolves to -- used
 * when the OVERALL budget (rather than any individual stage's own
 * budget) is what actually fires, so that path still reports a real,
 * stage-specific outcome instead of a generic one. `QUIT` never actually
 * surfaces via this path (its own failures are swallowed as best-effort,
 * see below) but is included so the map is total over `SmtpDiagnosticStage`. */
const STAGE_TIMEOUT_OUTCOME: Record<SmtpDiagnosticStage, SmtpDiagnosticOutcome> = {
  TCP_CONNECT: 'TCP_CONNECT_TIMEOUT',
  SMTP_GREETING: 'SMTP_GREETING_TIMEOUT',
  EHLO: 'EHLO_TIMEOUT',
  STARTTLS_COMMAND: 'STARTTLS_COMMAND_TIMEOUT',
  TLS_SOCKET_OPEN: 'TLS_SOCKET_OPEN_TIMEOUT',
  POST_TLS_EHLO: 'POST_TLS_EHLO_TIMEOUT',
  QUIT: 'QUIT_OK',
};

/** Thrown internally only -- never escapes `probeIonosSmtpConnectivity`,
 * which catches every instance of this and converts it into a
 * `SmtpDiagnosticResult`. Carries exactly the fields needed to build that
 * result: which stage, which terminal classification, a non-secret
 * detail string, and whether it was a timeout. */
class DiagnosticFailure extends Error {
  constructor(
    readonly stage: SmtpDiagnosticStage,
    readonly outcome: SmtpDiagnosticOutcome,
    readonly detail: string,
    readonly timedOut: boolean
  ) {
    super(detail);
    this.name = 'DiagnosticFailure';
  }
}

/**
 * Probes SMTP + STARTTLS connectivity to `config.host:config.port` without
 * ever authenticating or attempting delivery. Never throws; every outcome
 * (success, protocol rejection, or timeout at any stage) is reported in
 * the returned `SmtpDiagnosticResult`. Always closes whatever socket it
 * last held open before returning.
 */
export async function probeIonosSmtpConnectivity(
  config: IonosSmtpDiagnosticConfig,
  deps: IonosSmtpDiagnosticDeps = {}
): Promise<SmtpDiagnosticResult> {
  const connectFn = deps.connectFn ?? cloudflareConnect;
  const ehloHostname = deps.ehloHostname ?? DEFAULT_EHLO_HOSTNAME;
  const perStageTimeoutMs = deps.perStageTimeoutMs ?? DEFAULT_PER_STAGE_TIMEOUT_MS;
  const overallTimeoutMs = deps.overallTimeoutMs ?? DEFAULT_OVERALL_TIMEOUT_MS;

  const elapsedMsByStage: Partial<Record<SmtpDiagnosticStage, number>> = {};
  const startedAt = Date.now();
  const markElapsed = (stage: SmtpDiagnosticStage) => {
    elapsedMsByStage[stage] = Date.now() - startedAt;
  };

  let reachedStage: SmtpDiagnosticStage = 'TCP_CONNECT';

  function fail(
    stage: SmtpDiagnosticStage,
    outcome: SmtpDiagnosticOutcome,
    detail: string,
    timedOut = false
  ): SmtpDiagnosticResult {
    return {
      ok: false,
      reachedStage: stage,
      outcome,
      failedStage: stage,
      timedOut,
      elapsedMsByStage,
      detail,
    };
  }

  /** Runs one stage's operation under the per-stage budget. On success,
   * records elapsed time and returns the value. On failure, records
   * elapsed time and throws a `DiagnosticFailure` classified as
   * `timeoutOutcome` (if the per-stage budget itself fired) or
   * `errorOutcome` (any other exception -- a rejected promise, a thrown
   * error). Protocol-level rejections (a non-2xx/220/250 reply the
   * remote server DID send) are raised as their own, more specific
   * `DiagnosticFailure` by the call site instead, after this returns. */
  async function stage<T>(
    name: SmtpDiagnosticStage,
    fn: () => Promise<T>,
    timeoutOutcome: SmtpDiagnosticOutcome,
    errorOutcome: SmtpDiagnosticOutcome
  ): Promise<T> {
    reachedStage = name;
    try {
      const result = await withTimeout(name, fn(), perStageTimeoutMs);
      markElapsed(name);
      return result;
    } catch (err) {
      markElapsed(name);
      if (err instanceof StageTimeoutError) {
        throw new DiagnosticFailure(
          name,
          timeoutOutcome,
          `timed out after ${perStageTimeoutMs}ms`,
          true
        );
      }
      const detail = err instanceof Error ? err.message : String(err);
      throw new DiagnosticFailure(name, errorOutcome, detail, false);
    }
  }

  let socket: Socket;
  try {
    socket = connectFn(
      { hostname: config.host, port: config.port },
      { secureTransport: 'starttls' }
    );
  } catch (err) {
    markElapsed('TCP_CONNECT');
    return fail(
      'TCP_CONNECT',
      'TCP_CONNECT_ERROR',
      err instanceof Error ? err.message : String(err)
    );
  }

  let reader = socket.readable.getReader();
  let writer = socket.writable.getWriter();
  let responses = new SmtpResponseReader(reader);
  let currentSocket = socket;

  const run = async (): Promise<SmtpDiagnosticResult> => {
    try {
      // 0. Explicit TCP-open confirmation -- no read of the greeting is
      // attempted before `socket.opened` settles, so a connection that
      // never opens at all (black-holed handshake, firewall drop,
      // connection refused) is bounded and reported here, never confused
      // with a connection that opens but whose remote stays silent.
      await stage('TCP_CONNECT', () => socket.opened, 'TCP_CONNECT_TIMEOUT', 'TCP_CONNECT_ERROR');

      // 1. Greeting.
      const greeting = await stage(
        'SMTP_GREETING',
        () => responses.readResponse(),
        'SMTP_GREETING_TIMEOUT',
        'SMTP_GREETING_PROTOCOL_ERROR'
      );
      if (greeting.code !== 220) {
        throw new DiagnosticFailure(
          'SMTP_GREETING',
          'SMTP_GREETING_PROTOCOL_ERROR',
          `expected 220, got ${greeting.code} (${greeting.lines.join(' / ')})`,
          false
        );
      }

      // 2. EHLO.
      await stage(
        'EHLO',
        () => writeLine(writer, `EHLO ${ehloHostname}`),
        'EHLO_TIMEOUT',
        'EHLO_PROTOCOL_ERROR'
      );
      const ehlo1 = await stage(
        'EHLO',
        () => responses.readResponse(),
        'EHLO_TIMEOUT',
        'EHLO_PROTOCOL_ERROR'
      );
      if (ehlo1.code !== 250) {
        throw new DiagnosticFailure(
          'EHLO',
          'EHLO_PROTOCOL_ERROR',
          `expected 250, got ${ehlo1.code} (${ehlo1.lines.join(' / ')})`,
          false
        );
      }
      if (!hasStartTls(ehlo1.lines)) {
        throw new DiagnosticFailure(
          'EHLO',
          'STARTTLS_NOT_ADVERTISED',
          'STARTTLS not advertised',
          false
        );
      }

      // 3. STARTTLS command: send it, read the SMTP response to it, and
      // classify that response ON ITS OWN -- independently of whether the
      // TLS socket itself subsequently opens (step 4). A 220 here means
      // only "the server agreed, in plaintext, to let us try" --
      // `STARTTLS_COMMAND_ACCEPTED` -- never that the secure channel
      // actually exists yet.
      await stage(
        'STARTTLS_COMMAND',
        () => writeLine(writer, 'STARTTLS'),
        'STARTTLS_COMMAND_TIMEOUT',
        'STARTTLS_COMMAND_REJECTED'
      );
      const starttlsResp = await stage(
        'STARTTLS_COMMAND',
        () => responses.readResponse(),
        'STARTTLS_COMMAND_TIMEOUT',
        'STARTTLS_COMMAND_REJECTED'
      );
      if (starttlsResp.code !== 220) {
        throw new DiagnosticFailure(
          'STARTTLS_COMMAND',
          'STARTTLS_COMMAND_REJECTED',
          `expected 220, got ${starttlsResp.code} (${starttlsResp.lines.join(' / ')})`,
          false
        );
      }
      // STARTTLS_COMMAND_ACCEPTED reached -- recorded via elapsedMsByStage
      // above; the sequence continues immediately into TLS_SOCKET_OPEN
      // below rather than returning here, so this classification is only
      // ever the externally-visible `outcome` if a LATER stage is what
      // ultimately fails (in which case `outcome` reflects that later
      // stage instead) or if the whole probe never gets further than this
      // (which cannot currently happen given the code below always
      // proceeds, but is documented here for clarity of intent).

      // 4. Call startTls(). Its own settling (resolve/reject/hang) is
      // bounded exactly like every other stage.
      const secureSocket = await stage(
        'TLS_SOCKET_OPEN',
        async () => socket.startTls(),
        'TLS_SOCKET_OPEN_TIMEOUT',
        'TLS_SOCKET_OPEN_ERROR'
      );
      // 5. The moment startTls() resolves, its returned socket becomes
      // the new authoritative socket -- reassigned BEFORE the explicit
      // `.opened` await below, so that if THAT hangs or rejects, the
      // `finally` block at the end of this function closes the secure
      // socket (the one actually in play), never the abandoned pre-TLS
      // one. Never reused: `reader`/`writer`/`responses` above still
      // point at the pre-TLS socket at this instant and are never read
      // from or written to again from here on.
      currentSocket = secureSocket;

      // 6. Explicitly await the secure socket's OWN `.opened` promise,
      // under its own bounded stage -- proves the TLS handshake itself
      // actually completed and the channel is usable, which a resolved
      // `startTls()` call alone does not guarantee.
      await stage(
        'TLS_SOCKET_OPEN',
        () => secureSocket.opened,
        'TLS_SOCKET_OPEN_TIMEOUT',
        'TLS_SOCKET_OPEN_ERROR'
      );
      // 7. TLS_SOCKET_OPEN_OK reached.

      // 8. Only now are fresh reader/writer/response-reader instances
      // created, and only from the secure socket.
      reader = secureSocket.readable.getReader();
      writer = secureSocket.writable.getWriter();
      responses = new SmtpResponseReader(reader);

      // 9. Post-TLS EHLO -- performed exclusively on the new secure
      // reader/writer from step 8; proves the secure channel is actually
      // usable, not merely that `.opened` resolved.
      await stage(
        'POST_TLS_EHLO',
        () => writeLine(writer, `EHLO ${ehloHostname}`),
        'POST_TLS_EHLO_TIMEOUT',
        'POST_TLS_EHLO_PROTOCOL_ERROR'
      );
      const ehlo2 = await stage(
        'POST_TLS_EHLO',
        () => responses.readResponse(),
        'POST_TLS_EHLO_TIMEOUT',
        'POST_TLS_EHLO_PROTOCOL_ERROR'
      );
      if (ehlo2.code !== 250) {
        throw new DiagnosticFailure(
          'POST_TLS_EHLO',
          'POST_TLS_EHLO_PROTOCOL_ERROR',
          `expected 250, got ${ehlo2.code} (${ehlo2.lines.join(' / ')})`,
          false
        );
      }
      // POST_TLS_EHLO_OK reached.

      // 10. Best-effort QUIT -- never AUTH, never MAIL FROM/RCPT TO/DATA;
      // those code paths do not exist in this module. A missing/slow
      // QUIT reply never fails the probe -- everything that actually
      // proves connectivity already succeeded by this point.
      let finalOutcome: SmtpDiagnosticOutcome = 'POST_TLS_EHLO_OK';
      try {
        reachedStage = 'QUIT';
        await withTimeout('QUIT', writeLine(writer, 'QUIT'), perStageTimeoutMs);
        await withTimeout('QUIT', responses.readResponse(), perStageTimeoutMs);
        markElapsed('QUIT');
        finalOutcome = 'QUIT_OK';
      } catch {
        markElapsed('QUIT');
      }

      return {
        ok: true,
        reachedStage: 'COMPLETE',
        outcome: finalOutcome,
        timedOut: false,
        elapsedMsByStage,
      };
    } catch (err) {
      if (err instanceof DiagnosticFailure) {
        return fail(err.stage, err.outcome, err.detail, err.timedOut);
      }
      // Defensive fallback -- every throw site above is a
      // `DiagnosticFailure`, so this should be unreachable in practice.
      const timedOut = err instanceof StageTimeoutError;
      const detail = timedOut
        ? `timed out after ${perStageTimeoutMs}ms`
        : err instanceof Error
          ? err.message
          : String(err);
      return fail(reachedStage, STAGE_TIMEOUT_OUTCOME[reachedStage], detail, timedOut);
    }
  };

  try {
    return await withTimeout('DIAG_OVERALL', run(), overallTimeoutMs);
  } catch (err) {
    const timedOut = err instanceof StageTimeoutError;
    return fail(
      reachedStage,
      STAGE_TIMEOUT_OUTCOME[reachedStage],
      timedOut ? `overall diagnostic timeout (${overallTimeoutMs}ms) exceeded` : String(err),
      timedOut
    );
  } finally {
    // Each cleanup step is itself raced against CLEANUP_TIMEOUT_MS via the
    // same `withTimeout` primitive the probe stages use -- if `cancel()`/
    // `close()` doesn't settle in time, this function still returns; the
    // abandoned promise is left to resolve/reject on its own in the
    // background, same as any other `withTimeout` loser (see that
    // function's own doc comment).
    // NOTE: only `currentSocket` is ever closed here, deliberately never
    // the original pre-TLS `socket` once `startTls()` has produced a
    // secure socket (`currentSocket !== socket`) -- `startTls()` upgrades
    // the SAME underlying TCP connection in place, so the original
    // `Socket` object is superseded, not a second independent connection;
    // closing `currentSocket` alone closes the one real connection this
    // probe ever opened. (Verified by this module's own pre-existing
    // tests -- `pre.closeCalls` stays `0` in every post-TLS-upgrade
    // scenario.)
    await withTimeout('CLEANUP_READER_CANCEL', reader.cancel(), CLEANUP_TIMEOUT_MS).catch(() => {});
    await withTimeout('CLEANUP_SOCKET_CLOSE', currentSocket.close(), CLEANUP_TIMEOUT_MS).catch(
      () => {}
    );
  }
}
