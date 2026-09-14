/**
 * SUN-1222C-SMTP-ROOT-CAUSE — a bounded, NON-DELIVERY implicit-TLS (port 465)
 * connectivity probe for `smtp.ionos.com`, added specifically to answer one
 * narrow question the port-587 STARTTLS probe (`ionos-smtp-diagnostic.ts`)
 * could not settle on its own: that probe's one live, human-authorized run
 * showed TCP connect, the SMTP greeting, EHLO, and the STARTTLS command's own
 * SMTP response (`STARTTLS_COMMAND_ACCEPTED`) all succeeding, then
 * `TLS_SOCKET_OPEN` (`secureSocket.opened`, after `startTls()`) timing out at
 * its 3000ms per-stage budget. That result alone does not tell us whether
 * Cloudflare Workers can complete ANY TLS handshake against this exact IONOS
 * service, or whether the failure is specific to the STARTTLS upgrade
 * sequence. This module answers that by removing `startTls()` from the
 * equation entirely: connecting with `secureTransport: "on"` negotiates TLS
 * as part of the initial connection, so `socket.opened` resolving is itself
 * proof a full TLS handshake completed -- there is exactly one connect/open
 * stage here (`IMPLICIT_TLS_CONNECT`), not the two-stage
 * STARTTLS_COMMAND/TLS_SOCKET_OPEN split the port-587 probe needs.
 *
 * This module never calls `startTls()` and contains no STARTTLS code path
 * whatsoever -- no `STARTTLS` line is ever written to the wire, and
 * `hasStartTls` (the port-587 probe's advertised-capability check) is not
 * imported here. Structurally incapable of sending mail, identically to
 * `ionos-smtp-diagnostic.ts`: no `AUTH`, no `MAIL FROM`, no `RCPT TO`, no
 * `DATA`, no password/credential type anywhere in this file or its
 * `ImplicitTlsSmtpDiagnosticConfig`. The sequence is exactly: connect with
 * implicit TLS -> await socket.opened -> read greeting -> EHLO -> best-effort
 * QUIT -> close.
 *
 * Every stage is individually bounded (`perStageTimeoutMs`, default 3s) and
 * the whole probe is additionally bounded overall (`overallTimeoutMs`,
 * default 8s), via the same `withTimeout` helper the STARTTLS probe and the
 * real transport both use. Cleanup (`reader.cancel()` / `socket.close()`) in
 * the `finally` block is bounded by the same `CLEANUP_TIMEOUT_MS` budget, for
 * the same SUN-1222C-SMTP-ROOT-CAUSE reason documented in
 * `smtp-stage-timeout.ts` and `ionos-smtp-diagnostic.ts`: an unbounded
 * cleanup await could otherwise prevent this function from ever returning a
 * structured result, even once the actual probe outcome is already known.
 *
 * Never throws; every outcome (success, protocol rejection, or timeout at
 * any stage) is reported in the returned `ImplicitTlsSmtpDiagnosticResult`.
 * Nothing this module logs, returns, or throws ever contains a secret -- it
 * has none to leak.
 */
import type { Socket } from 'cloudflare:sockets';
import { connect as cloudflareConnect } from '../cloudflare-sockets-ambient';
import { SmtpResponseReader } from './smtp-response-reader';
import { writeLine, type ConnectFn } from './ionos-smtp-transport';
import { StageTimeoutError, withTimeout, CLEANUP_TIMEOUT_MS } from './smtp-stage-timeout';

export { CLEANUP_TIMEOUT_MS };

/** Coarse stage identity used for elapsed-time bookkeeping and as the
 * `failedStage`/`reachedStage` value on failure. Deliberately only four
 * stages -- there is no STARTTLS_COMMAND/TLS_SOCKET_OPEN split here because
 * implicit TLS has no separate command-then-upgrade sequence; the TLS
 * handshake IS the connect. */
export type ImplicitTlsDiagnosticStage = 'IMPLICIT_TLS_CONNECT' | 'SMTP_GREETING' | 'EHLO' | 'QUIT';

/** The full set of terminal classifications this probe can report.
 * `IMPLICIT_TLS_CONNECT_OK`, `SMTP_GREETING_OK`, and `EHLO_OK` are
 * deliberately distinct values -- mirroring `ionos-smtp-diagnostic.ts`'s
 * `STARTTLS_COMMAND_ACCEPTED`/`TLS_SOCKET_OPEN_OK` pattern -- even though
 * each is a "success" that lets the probe continue past it; they are only
 * ever the probe's *external* outcome when the probe stops immediately
 * after reaching them (which does not currently happen for
 * `IMPLICIT_TLS_CONNECT_OK`/`SMTP_GREETING_OK`, since the sequence always
 * continues, but they are reported as `outcome` whenever that IS the
 * furthest point actually reached on success -- see `finalOutcome` below). */
export type ImplicitTlsDiagnosticOutcome =
  | 'IMPLICIT_TLS_CONNECT_TIMEOUT'
  | 'IMPLICIT_TLS_CONNECT_ERROR'
  | 'IMPLICIT_TLS_CONNECT_OK'
  | 'SMTP_GREETING_TIMEOUT'
  | 'SMTP_GREETING_PROTOCOL_ERROR'
  | 'SMTP_GREETING_OK'
  | 'EHLO_TIMEOUT'
  | 'EHLO_PROTOCOL_ERROR'
  | 'EHLO_OK'
  | 'QUIT_OK';

export interface ImplicitTlsSmtpDiagnosticConfig {
  readonly host: string;
  readonly port: number;
}

export interface ImplicitTlsSmtpDiagnosticDeps {
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
export interface ImplicitTlsSmtpDiagnosticResult {
  readonly ok: boolean;
  readonly reachedStage: ImplicitTlsDiagnosticStage | 'COMPLETE';
  readonly outcome: ImplicitTlsDiagnosticOutcome;
  readonly failedStage?: ImplicitTlsDiagnosticStage;
  readonly timedOut: boolean;
  readonly elapsedMsByStage: Partial<Record<ImplicitTlsDiagnosticStage, number>>;
  readonly detail?: string;
}

const DEFAULT_PER_STAGE_TIMEOUT_MS = 3_000;
export const DEFAULT_OVERALL_TIMEOUT_MS = 8_000;
const DEFAULT_EHLO_HOSTNAME = 'alerts.siteborne.net';

const STAGE_TIMEOUT_OUTCOME: Record<ImplicitTlsDiagnosticStage, ImplicitTlsDiagnosticOutcome> = {
  IMPLICIT_TLS_CONNECT: 'IMPLICIT_TLS_CONNECT_TIMEOUT',
  SMTP_GREETING: 'SMTP_GREETING_TIMEOUT',
  EHLO: 'EHLO_TIMEOUT',
  QUIT: 'QUIT_OK',
};

/** Thrown internally only -- never escapes `probeIonosSmtpImplicitTlsConnectivity`. */
class DiagnosticFailure extends Error {
  constructor(
    readonly stage: ImplicitTlsDiagnosticStage,
    readonly outcome: ImplicitTlsDiagnosticOutcome,
    readonly detail: string,
    readonly timedOut: boolean
  ) {
    super(detail);
    this.name = 'DiagnosticFailure';
  }
}

/**
 * Probes implicit-TLS (port 465 style) SMTP connectivity to
 * `config.host:config.port` without ever authenticating or attempting
 * delivery. Never throws; every outcome (success, protocol rejection, or
 * timeout at any stage) is reported in the returned
 * `ImplicitTlsSmtpDiagnosticResult`. Always closes whatever socket it opened
 * before returning.
 */
export async function probeIonosSmtpImplicitTlsConnectivity(
  config: ImplicitTlsSmtpDiagnosticConfig,
  deps: ImplicitTlsSmtpDiagnosticDeps = {}
): Promise<ImplicitTlsSmtpDiagnosticResult> {
  const connectFn = deps.connectFn ?? cloudflareConnect;
  const ehloHostname = deps.ehloHostname ?? DEFAULT_EHLO_HOSTNAME;
  const perStageTimeoutMs = deps.perStageTimeoutMs ?? DEFAULT_PER_STAGE_TIMEOUT_MS;
  const overallTimeoutMs = deps.overallTimeoutMs ?? DEFAULT_OVERALL_TIMEOUT_MS;

  const elapsedMsByStage: Partial<Record<ImplicitTlsDiagnosticStage, number>> = {};
  const startedAt = Date.now();
  const markElapsed = (stage: ImplicitTlsDiagnosticStage) => {
    elapsedMsByStage[stage] = Date.now() - startedAt;
  };

  let reachedStage: ImplicitTlsDiagnosticStage = 'IMPLICIT_TLS_CONNECT';

  function fail(
    stage: ImplicitTlsDiagnosticStage,
    outcome: ImplicitTlsDiagnosticOutcome,
    detail: string,
    timedOut = false
  ): ImplicitTlsSmtpDiagnosticResult {
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

  async function stage<T>(
    name: ImplicitTlsDiagnosticStage,
    fn: () => Promise<T>,
    timeoutOutcome: ImplicitTlsDiagnosticOutcome,
    errorOutcome: ImplicitTlsDiagnosticOutcome
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
    // Implicit TLS: `secureTransport: "on"` -- deliberately never
    // `"starttls"`. There is no plaintext phase and no STARTTLS command in
    // this mode; the returned socket IS the (eventually) secure channel.
    socket = connectFn({ hostname: config.host, port: config.port }, { secureTransport: 'on' });
  } catch (err) {
    markElapsed('IMPLICIT_TLS_CONNECT');
    return fail(
      'IMPLICIT_TLS_CONNECT',
      'IMPLICIT_TLS_CONNECT_ERROR',
      err instanceof Error ? err.message : String(err)
    );
  }

  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  const responses = new SmtpResponseReader(reader);

  const run = async (): Promise<ImplicitTlsSmtpDiagnosticResult> => {
    try {
      // 0. The implicit-TLS handshake itself -- `socket.opened` resolving
      // IS proof the TLS channel is up; there is no separate startTls()
      // step, and no reader/writer/socket reassignment, at any point in
      // this module.
      await stage(
        'IMPLICIT_TLS_CONNECT',
        () => socket.opened,
        'IMPLICIT_TLS_CONNECT_TIMEOUT',
        'IMPLICIT_TLS_CONNECT_ERROR'
      );

      // 1. Greeting -- read over the already-secure reader.
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

      // 2. EHLO -- proves the secure channel is actually usable for a real
      // protocol exchange, not merely that `.opened` resolved.
      await stage(
        'EHLO',
        () => writeLine(writer, `EHLO ${ehloHostname}`),
        'EHLO_TIMEOUT',
        'EHLO_PROTOCOL_ERROR'
      );
      const ehlo = await stage(
        'EHLO',
        () => responses.readResponse(),
        'EHLO_TIMEOUT',
        'EHLO_PROTOCOL_ERROR'
      );
      if (ehlo.code !== 250) {
        throw new DiagnosticFailure(
          'EHLO',
          'EHLO_PROTOCOL_ERROR',
          `expected 250, got ${ehlo.code} (${ehlo.lines.join(' / ')})`,
          false
        );
      }
      // EHLO_OK reached.

      // 3. Best-effort QUIT -- never AUTH, never MAIL FROM/RCPT TO/DATA;
      // those code paths do not exist in this module. A missing/slow QUIT
      // reply never fails the probe -- everything that actually proves
      // connectivity already succeeded by this point.
      let finalOutcome: ImplicitTlsDiagnosticOutcome = 'EHLO_OK';
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
    // Bounded exactly like `ionos-smtp-diagnostic.ts`'s identical `finally`
    // block -- see `smtp-stage-timeout.ts`'s doc comment for why. Only one
    // socket ever exists in this module (implicit TLS has no mid-stream
    // upgrade to a second `Socket` object), so there is no
    // `currentSocket`/`socket` distinction to make here.
    await withTimeout('CLEANUP_READER_CANCEL', reader.cancel(), CLEANUP_TIMEOUT_MS).catch(() => {});
    await withTimeout('CLEANUP_SOCKET_CLOSE', socket.close(), CLEANUP_TIMEOUT_MS).catch(() => {});
  }
}
