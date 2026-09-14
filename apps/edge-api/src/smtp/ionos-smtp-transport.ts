/**
 * SUN-1222C-IONOS-SMTP-TRANSPORT — a minimal, dependency-free authenticated
 * SMTP client over `cloudflare:sockets`, implementing exactly the sequence
 * required to relay one message through IONOS's `smtp.ionos.com:465`
 * (implicit TLS, then `AUTH PLAIN`) and nothing else: no connection pooling,
 * no retry, no multi-recipient/multi-message batching, no mechanism other
 * than `PLAIN`.
 *
 * Replaces this Worker's previous transport (`cloudflare:email` /
 * `send_email` binding -- see git history for
 * `storage-alert-receiver-entrypoint.ts`), per the operator's explicit
 * decision to route storage-alert email through an IONOS mailbox
 * (`storage@alerts.siteborne.net`) instead of Cloudflare Email Routing.
 *
 * SUN-1222C-SMTP-ROOT-CAUSE port migration (587 STARTTLS -> 465 implicit
 * TLS): the STARTTLS-based transport this module used to implement was
 * definitively isolated, via a single human-authorized live non-delivery
 * probe (`ionos-smtp-diagnostic.ts`), to fail specifically at the
 * `startTls()`/`secureSocket.opened` step -- TCP connect, the SMTP
 * greeting, EHLO, and the STARTTLS command's own SMTP response all
 * succeeded first. A second, separately authorized live probe
 * (`ionos-smtp-implicit-tls-diagnostic.ts`), which removes `startTls()`
 * from the equation entirely by negotiating TLS as part of the initial
 * connection (`secureTransport: "on"`), completed the full handshake plus
 * greeting plus EHLO plus QUIT in ~223ms with zero timeouts -- proving
 * Cloudflare Workers CAN complete a TLS handshake against this exact IONOS
 * service, and narrowing the 587 failure specifically to the STARTTLS
 * upgrade mechanism rather than a broader Cloudflare<->IONOS TLS
 * interoperability problem. This module now connects with
 * `secureTransport: "on"` (implicit TLS) and contains no `STARTTLS`
 * command, no `startTls()` call, and no pre-TLS/post-TLS socket split:
 * there is exactly ONE socket lifecycle, secure from the moment
 * `socket.opened` resolves, exactly like the port-465 diagnostic probe
 * that proved this path viable.
 *
 * NOT WIRED to any live credential yet: `sendStorageAlertViaIonosSmtp`
 * takes the password as a plain parameter: it is this module's caller's
 * job (the entrypoint) to source it from `env.IONOS_SMTP_PASSWORD` --
 * this file has no `Env` dependency of its own, only what it's given.
 *
 * Timeout instrumentation (SUN-1222C storage-alert qualification, second
 * production attempt): previously NONE of the awaits below had a timeout
 * of their own -- a hung remote (a TCP connect that never completes, a
 * banner that never arrives) could only ever be cut off by the *caller's*
 * Service Binding `AbortController`
 * (`storage-alert-service-binding-transport.ts`, `DEFAULT_TIMEOUT_MS =
 * 10_000`), at which point this Worker's own invocation is force-canceled
 * by the platform with no chance to close its socket or report which
 * stage was stuck (this is exactly what the second live qualification
 * attempt observed: wallTime=9979ms, cpuTime=4ms, outcome=canceled, zero
 * application logs). Every awaited network operation below is now wrapped
 * in `withTimeout` with its own `perStageTimeoutMs` budget (default 3s),
 * and the whole sequence is additionally wrapped in one `overallTimeoutMs`
 * budget (default 8s -- comfortably inside the caller's outer 10s so this
 * module can always return/throw its own deterministic result and close
 * its own socket instead of being externally canceled).
 *
 * Observability correction (same investigation, after the second live
 * attempt's exact signature could not be pinned to a specific stage):
 * the very first version of this instrumentation still conflated "the
 * connection itself never opened" with "it opened, but the remote never
 * sent an SMTP greeting" -- both hung on the same `responses.readResponse()`
 * call and both surfaced under one stage. Cloudflare's `Socket.opened`
 * promise (resolves once the connection -- TCP plus, now, the implicit TLS
 * handshake -- is actually established; rejects if it fails to connect or
 * complete TLS at all) is now explicitly awaited, under its own `guarded`
 * call, BEFORE any greeting read is even attempted -- so a connection that
 * never opens (a black-holed handshake, a firewall drop, a refused
 * connection, a TLS negotiation failure) is bounded and reported as
 * `SMTP_TLS_CONNECT_FAILED` without ever touching the readable stream,
 * while a connection that DOES open but whose remote never sends a 220
 * banner is correctly its own distinct stage, `SMTP_GREETING_REJECTED`
 * (used for both a malformed/rejecting banner AND a banner that never
 * arrives -- both are equally "the greeting stage failed").
 *
 * Bounded-cleanup fix (same investigation, after `ionos-smtp-diagnostic.ts`
 * proved the same bug in its own `finally` block via a real Service Binding
 * integration test): `reader.cancel()`/`socket.close()` below are each
 * raced against `CLEANUP_TIMEOUT_MS` (`smtp-stage-timeout.ts`, shared with
 * both diagnostic modules) rather than awaited unbounded -- previously a
 * black-holed connection could hang this `finally` forever, silently
 * preventing the already-classified `SmtpTransportError` (or success) from
 * ever being thrown/returned past it. Preserved unchanged across the port
 * migration: there is still exactly one socket to close and one reader to
 * cancel (simpler than the pre-migration two-socket STARTTLS lifecycle,
 * not more complex), and both are still bounded individually so a hung
 * cleanup can never itself replace or delay the classified send outcome.
 */
import type { Socket } from 'cloudflare:sockets';
import { connect as cloudflareConnect } from '../cloudflare-sockets-ambient';
import { SmtpProtocolError, SmtpResponseReader, type SmtpResponse } from './smtp-response-reader';
import {
  buildRfc822Message,
  encodeAuthPlainInitialResponse,
  encodeForDataCommand,
  generateMessageId,
} from './smtp-message';
import { StageTimeoutError, withTimeout, CLEANUP_TIMEOUT_MS } from './smtp-stage-timeout';

export type ConnectFn = (
  address: { hostname: string; port: number },
  options?: { secureTransport?: 'off' | 'on' | 'starttls' }
) => Socket;

/** Structured failure stage -- lets a caller (and this module's own
 * tests) distinguish exactly where in the protocol sequence a send
 * failed, without ever needing the message text to carry that
 * information. Deliberately covers only real decision points in the
 * sequence below; there is no catch-all "SMTP_UNKNOWN" because every
 * `guarded()` call site names its own stage explicitly. A stage timeout
 * surfaces through the SAME stage name (its `message` just reads "timed
 * out after Nms" instead of a protocol-rejection detail) so callers never
 * need a second, timeout-specific enum to distinguish the two.
 *
 * SUN-1222C-SMTP-ROOT-CAUSE port migration: `SMTP_STARTTLS_UNAVAILABLE`,
 * `SMTP_STARTTLS_REJECTED`, and `SMTP_TLS_SOCKET_OPEN_FAILED` (the
 * STARTTLS-command/TLS-upgrade split) no longer exist -- implicit TLS has
 * no separate command-then-upgrade sequence, so `SMTP_TLS_CONNECT_FAILED`
 * (renamed from `SMTP_CONNECT_FAILED`) now covers the whole connect+TLS
 * step, exactly matching `ionos-smtp-implicit-tls-diagnostic.ts`'s own
 * single `IMPLICIT_TLS_CONNECT` stage. */
export type SmtpStage =
  | 'SMTP_TLS_CONNECT_FAILED'
  | 'SMTP_GREETING_REJECTED'
  | 'SMTP_EHLO_FAILED'
  | 'SMTP_AUTH_PLAIN_UNAVAILABLE'
  | 'SMTP_AUTH_FAILED'
  | 'SMTP_MAIL_FROM_REJECTED'
  | 'SMTP_RCPT_TO_REJECTED'
  | 'SMTP_DATA_REJECTED'
  | 'SMTP_MESSAGE_REJECTED';

/** Deliberately never includes the SMTP username/password or the AUTH
 * PLAIN base64 payload -- `message` is built only from the `stage` name
 * and either a reply code/text the server itself sent back (never
 * secret), a generic transport-error description, or (for a timeout) the
 * configured budget in milliseconds -- never anything about the awaited
 * operation's own state. */
export class SmtpTransportError extends Error {
  constructor(
    readonly stage: SmtpStage,
    message: string
  ) {
    super(`${stage}: ${message}`);
    this.name = 'SmtpTransportError';
  }
}

export interface IonosSmtpConfig {
  readonly host: string;
  readonly port: number;
  /** IONOS mailbox login -- identical to `from` for this Worker's single
   * mailbox, kept as a separate field because SMTP AUTH identity and the
   * envelope `From` are conceptually distinct even when equal in value. */
  readonly username: string;
  readonly password: string;
  readonly from: string;
  readonly to: string;
}

export interface SmtpEnvelope {
  readonly subject: string;
  readonly bodyText: string;
}

/** Comfortably above real-world SMTP round-trip latency to a legitimate,
 * responsive server, while still small enough that a hung stage is
 * diagnosable (not just "eventually canceled") well inside the caller's
 * outer 10s Service Binding budget. */
const DEFAULT_PER_STAGE_TIMEOUT_MS = 3_000;

/** The whole send sequence's hard cap, deliberately well under the
 * caller's outer `DEFAULT_TIMEOUT_MS = 10_000`
 * (`storage-alert-service-binding-transport.ts`) so this module always
 * gets to close its own socket and return/throw its own result rather
 * than being force-canceled by the platform once the caller's own
 * `AbortController` fires. */
const DEFAULT_OVERALL_TIMEOUT_MS = 8_000;

/** Injected only by tests: `now`/`randomHex` make the `Date`/`Message-ID`
 * headers deterministic without touching the real clock or `crypto`;
 * `perStageTimeoutMs`/`overallTimeoutMs` let tests exercise a hang
 * deterministically (with millisecond-scale budgets) instead of waiting
 * out the real production defaults. */
export interface IonosSmtpDeps {
  readonly connectFn?: ConnectFn;
  readonly now?: () => Date;
  readonly randomHex?: () => string;
  /** Hostname this client introduces itself as in `EHLO` -- the sending
   * domain, not a secret. */
  readonly ehloHostname?: string;
  readonly perStageTimeoutMs?: number;
  readonly overallTimeoutMs?: number;
}

const DEFAULT_EHLO_HOSTNAME = 'alerts.siteborne.net';

function requireExactCode(resp: SmtpResponse, expected: number, stage: SmtpStage): void {
  if (resp.code !== expected) {
    throw new SmtpTransportError(
      stage,
      `expected ${expected}, got ${resp.code} (${resp.lines.join(' / ')})`
    );
  }
}

function requireSuccessCode(resp: SmtpResponse, stage: SmtpStage): void {
  if (resp.code < 200 || resp.code >= 300) {
    throw new SmtpTransportError(
      stage,
      `expected a 2xx reply, got ${resp.code} (${resp.lines.join(' / ')})`
    );
  }
}

/** Runs `fn` under a `timeoutMs` budget, converting ANY exception it
 * throws (a network-level rejection, a `SmtpProtocolError` from a
 * malformed reply, or this budget's own `StageTimeoutError`) into this
 * stage's `SmtpTransportError` -- except an `SmtpTransportError` already
 * thrown by an explicit `requireExactCode`/`requireSuccessCode` check
 * inside `fn`, which is rethrown as-is so its own, more specific stage is
 * preserved. A timeout never includes the awaited operation's own
 * state -- only the stage name and the budget that elapsed. */
async function guarded<T>(stage: SmtpStage, fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  try {
    return await withTimeout(stage, fn(), timeoutMs);
  } catch (err) {
    if (err instanceof SmtpTransportError) throw err;
    if (err instanceof StageTimeoutError) {
      throw new SmtpTransportError(stage, `timed out after ${timeoutMs}ms`);
    }
    const detail = err instanceof Error ? err.message : String(err);
    throw new SmtpTransportError(stage, detail);
  }
}

function findAuthMechanisms(lines: readonly string[]): string[] {
  for (const line of lines) {
    const match = /^AUTH\s+(.+)$/i.exec(line.trim());
    if (match)
      return match[1]
        .split(/\s+/)
        .filter(Boolean)
        .map((s) => s.toUpperCase());
  }
  return [];
}

/** No longer called by `sendStorageAlertViaIonosSmtp` itself (implicit TLS
 * has no STARTTLS advertisement to check), but still exported: the
 * retired-for-production but still-preserved port-587 STARTTLS diagnostic
 * (`ionos-smtp-diagnostic.ts`) imports this exact check so its own
 * forensic/regression probe logic never drifts from what this transport
 * used to (and, for that diagnostic's non-delivery purposes, still needs
 * to) verify. */
export function hasStartTls(lines: readonly string[]): boolean {
  return lines.some((line) => /^STARTTLS\s*$/i.test(line.trim()));
}

export async function writeLine(writer: WritableStreamDefaultWriter<Uint8Array>, line: string) {
  await writer.write(new TextEncoder().encode(`${line}\r\n`));
}

async function writeRaw(writer: WritableStreamDefaultWriter<Uint8Array>, text: string) {
  await writer.write(new TextEncoder().encode(text));
}

/**
 * Sends exactly one message over a fresh connection, following the exact
 * sequence: connect with implicit TLS -> await socket.opened -> greeting ->
 * EHLO -> AUTH PLAIN -> MAIL FROM -> RCPT TO -> DATA -> message -> QUIT.
 * Throws `SmtpTransportError` (with a `.stage`) on the first failure --
 * including a per-stage or overall timeout -- and always closes the
 * socket before returning or throwing.
 *
 * SUN-1222C-SMTP-ROOT-CAUSE port migration: never issues `STARTTLS` and
 * never calls `socket.startTls()` -- TLS is negotiated as part of the
 * connection itself (`secureTransport: "on"`), so there is exactly one
 * socket for the lifetime of this call, not a pre-TLS/post-TLS pair.
 */
export async function sendStorageAlertViaIonosSmtp(
  config: IonosSmtpConfig,
  envelope: SmtpEnvelope,
  deps: IonosSmtpDeps = {}
): Promise<void> {
  const connectFn = deps.connectFn ?? cloudflareConnect;
  const now = deps.now ?? (() => new Date());
  const randomHex = deps.randomHex;
  const ehloHostname = deps.ehloHostname ?? DEFAULT_EHLO_HOSTNAME;
  const perStageTimeoutMs = deps.perStageTimeoutMs ?? DEFAULT_PER_STAGE_TIMEOUT_MS;
  const overallTimeoutMs = deps.overallTimeoutMs ?? DEFAULT_OVERALL_TIMEOUT_MS;

  let socket: Socket;
  try {
    socket = connectFn({ hostname: config.host, port: config.port }, { secureTransport: 'on' });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new SmtpTransportError('SMTP_TLS_CONNECT_FAILED', detail);
  }

  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  const responses = new SmtpResponseReader(reader);
  // Tracks the stage in flight when the OVERALL budget (rather than any
  // individual stage's own budget) is what fires -- e.g. several stages
  // each individually fast but summing past `overallTimeoutMs`. Updated
  // immediately before each stage begins, so an overall-timeout error
  // still names a real, specific stage instead of a generic label.
  let lastStage: SmtpStage = 'SMTP_TLS_CONNECT_FAILED';

  const runSequence = async (): Promise<void> => {
    // 0. Explicit connect+TLS confirmation. `socket.opened` resolves once
    // the connection -- TCP handshake AND the implicit TLS negotiation
    // `secureTransport: "on"` performs as part of establishing it -- is
    // actually usable (rejects if either fails); no read of the greeting
    // is attempted before this settles, so a connection/TLS failure is
    // bounded and reported as `SMTP_TLS_CONNECT_FAILED` without ever
    // touching the readable stream, distinctly from a connection that DOES
    // open but whose remote never sends a banner, below.
    lastStage = 'SMTP_TLS_CONNECT_FAILED';
    await guarded('SMTP_TLS_CONNECT_FAILED', () => socket.opened, perStageTimeoutMs);

    // 1. Greeting. The secure connection is confirmed open at this point
    // (step 0, above); any failure here (a malformed line, a non-220 code,
    // or a timeout) is therefore specifically an SMTP-greeting failure,
    // not a connect/TLS-level one.
    lastStage = 'SMTP_GREETING_REJECTED';
    const greeting = await guarded(
      'SMTP_GREETING_REJECTED',
      () => responses.readResponse(),
      perStageTimeoutMs
    );
    requireExactCode(greeting, 220, 'SMTP_GREETING_REJECTED');

    // 2. EHLO -- exactly once. Unlike the retired STARTTLS transport,
    // there is no plaintext capability list to distrust and no need to
    // re-issue EHLO after a mid-connection upgrade: this connection has
    // been secure since `socket.opened` resolved above.
    lastStage = 'SMTP_EHLO_FAILED';
    await guarded(
      'SMTP_EHLO_FAILED',
      () => writeLine(writer, `EHLO ${ehloHostname}`),
      perStageTimeoutMs
    );
    const ehlo = await guarded(
      'SMTP_EHLO_FAILED',
      () => responses.readResponse(),
      perStageTimeoutMs
    );
    requireExactCode(ehlo, 250, 'SMTP_EHLO_FAILED');
    const authMechanisms = findAuthMechanisms(ehlo.lines);
    if (!authMechanisms.includes('PLAIN')) {
      throw new SmtpTransportError(
        'SMTP_AUTH_PLAIN_UNAVAILABLE',
        `AUTH PLAIN not advertised (advertised: ${authMechanisms.join(', ') || '(none)'})`
      );
    }

    // 3. AUTH PLAIN -- the only mechanism this client ever sends,
    // regardless of what else the server advertises (e.g. LOGIN).
    lastStage = 'SMTP_AUTH_FAILED';
    const authPayload = encodeAuthPlainInitialResponse(config.username, config.password);
    await guarded(
      'SMTP_AUTH_FAILED',
      () => writeLine(writer, `AUTH PLAIN ${authPayload}`),
      perStageTimeoutMs
    );
    const authResp = await guarded(
      'SMTP_AUTH_FAILED',
      () => responses.readResponse(),
      perStageTimeoutMs
    );
    requireExactCode(authResp, 235, 'SMTP_AUTH_FAILED');

    // 4. MAIL FROM.
    lastStage = 'SMTP_MAIL_FROM_REJECTED';
    await guarded(
      'SMTP_MAIL_FROM_REJECTED',
      () => writeLine(writer, `MAIL FROM:<${config.from}>`),
      perStageTimeoutMs
    );
    const mailResp = await guarded(
      'SMTP_MAIL_FROM_REJECTED',
      () => responses.readResponse(),
      perStageTimeoutMs
    );
    requireSuccessCode(mailResp, 'SMTP_MAIL_FROM_REJECTED');

    // 5. RCPT TO.
    lastStage = 'SMTP_RCPT_TO_REJECTED';
    await guarded(
      'SMTP_RCPT_TO_REJECTED',
      () => writeLine(writer, `RCPT TO:<${config.to}>`),
      perStageTimeoutMs
    );
    const rcptResp = await guarded(
      'SMTP_RCPT_TO_REJECTED',
      () => responses.readResponse(),
      perStageTimeoutMs
    );
    requireSuccessCode(rcptResp, 'SMTP_RCPT_TO_REJECTED');

    // 6. DATA.
    lastStage = 'SMTP_DATA_REJECTED';
    await guarded('SMTP_DATA_REJECTED', () => writeLine(writer, 'DATA'), perStageTimeoutMs);
    const dataResp = await guarded(
      'SMTP_DATA_REJECTED',
      () => responses.readResponse(),
      perStageTimeoutMs
    );
    requireExactCode(dataResp, 354, 'SMTP_DATA_REJECTED');

    // 7. The message itself, dot-stuffed and terminated. Its "final
    // acceptance" read (the reply to the trailing `.`) is guarded exactly
    // like every other stage -- a server that accepts DATA but then never
    // replies to the terminator is bounded by the same per-stage budget.
    lastStage = 'SMTP_MESSAGE_REJECTED';
    const message = buildRfc822Message({
      from: config.from,
      to: config.to,
      subject: envelope.subject,
      bodyText: envelope.bodyText,
      date: now(),
      messageId: generateMessageId(ehloHostname, randomHex),
    });
    await guarded(
      'SMTP_MESSAGE_REJECTED',
      () => writeRaw(writer, encodeForDataCommand(message)),
      perStageTimeoutMs
    );
    const submitResp = await guarded(
      'SMTP_MESSAGE_REJECTED',
      () => responses.readResponse(),
      perStageTimeoutMs
    );
    requireSuccessCode(submitResp, 'SMTP_MESSAGE_REJECTED');

    // 8. QUIT -- best-effort; the message is already accepted at this
    // point, so a broken/absent/slow QUIT reply must not surface as a
    // send failure. Still bounded by the per-stage budget so a hung QUIT
    // reply cannot itself consume the whole overall budget.
    try {
      await writeLine(writer, 'QUIT');
      await withTimeout('SMTP_QUIT', responses.readResponse(), perStageTimeoutMs);
    } catch {
      // Intentionally ignored -- see comment above.
    }
  };

  try {
    await withTimeout('SMTP_OVERALL', runSequence(), overallTimeoutMs);
  } catch (err) {
    if (err instanceof SmtpTransportError) throw err;
    if (err instanceof StageTimeoutError) {
      throw new SmtpTransportError(
        lastStage,
        `overall SMTP timeout (${overallTimeoutMs}ms) exceeded`
      );
    }
    throw err;
  } finally {
    // SUN-1222C-SMTP-ROOT-CAUSE fix (preserved across the port migration):
    // these two cleanup steps used to be awaited with no bound of their
    // own -- fine when the socket is healthy, but exactly the kind of
    // operation that can hang indefinitely on a black-holed connection.
    // When that happened, the `SMTP_OVERALL` timeout above still fired and
    // was still caught, but the classified `SmtpTransportError` could
    // never actually be thrown past this `finally` -- so the caller (the
    // Service Binding fetch in `storage-alert-service-binding-transport.ts`)
    // saw nothing until its OWN, unrelated 10s budget force-canceled the
    // whole invocation, with no application-level error ever surfacing.
    // Racing each step against the identical `CLEANUP_TIMEOUT_MS` budget
    // both diagnostic modules use keeps the worst case at
    // `overallTimeoutMs + 2 * CLEANUP_TIMEOUT_MS`, comfortably under that
    // 10s caller budget, and guarantees this function's own
    // `return`/`throw` always reflects the actual send outcome (success,
    // or the specific `SmtpTransportError` classified above) rather than a
    // stuck cleanup silently replacing it with an external cancellation.
    // `.catch(() => {})` on each ensures a cleanup failure can never itself
    // become the thrown error, overriding the classified one from the
    // `catch` block above. Only one socket/reader exists now (no
    // pre-TLS/post-TLS pair to abandon), so this is simpler than the
    // pre-migration STARTTLS lifecycle, not more complex.
    await withTimeout('CLEANUP_READER_CANCEL', reader.cancel(), CLEANUP_TIMEOUT_MS).catch(() => {});
    await withTimeout('CLEANUP_SOCKET_CLOSE', socket.close(), CLEANUP_TIMEOUT_MS).catch(() => {});
  }
}

// Re-exported so callers can narrow a caught error without importing from
// the response-reader module directly.
export { SmtpProtocolError };
