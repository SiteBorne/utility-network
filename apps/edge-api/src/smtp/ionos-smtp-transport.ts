/**
 * SUN-1222C-IONOS-SMTP-TRANSPORT — a minimal, dependency-free authenticated
 * SMTP client over `cloudflare:sockets`, implementing exactly the sequence
 * required to relay one message through IONOS's `smtp.ionos.com:587`
 * (STARTTLS, then `AUTH PLAIN`) and nothing else: no connection pooling, no
 * retry, no multi-recipient/multi-message batching, no mechanism other than
 * `PLAIN`.
 *
 * Replaces this Worker's previous transport (`cloudflare:email` /
 * `send_email` binding -- see git history for
 * `storage-alert-receiver-entrypoint.ts`), per the operator's explicit
 * decision to route storage-alert email through an IONOS mailbox
 * (`storage@alerts.siteborne.net`) instead of Cloudflare Email Routing.
 *
 * Socket lifecycle (Cloudflare's own documented contract for
 * `secureTransport: "starttls"`): the connection starts in plaintext;
 * `socket.startTls()` returns a *new* `Socket` layered over the same
 * underlying TCP connection, and every reader/writer obtained from the
 * pre-TLS socket becomes unusable the moment that happens. This module
 * never reads or writes through the pre-TLS streams again after calling
 * `startTls()` -- see the explicit "old reader/writer are now abandoned"
 * comment at that call site below.
 *
 * NOT wired to any live credential yet: `sendStorageAlertViaIonosSmtp`
 * takes the password as a plain parameter: it is this module's caller's
 * job (the entrypoint) to source it from `env.IONOS_SMTP_PASSWORD` --
 * this file has no `Env` dependency of its own, only what it's given.
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

export type ConnectFn = (
  address: { hostname: string; port: number },
  options?: { secureTransport?: 'off' | 'on' | 'starttls' }
) => Socket;

/** Structured failure stage -- lets a caller (and this module's own
 * tests) distinguish exactly where in the protocol sequence a send
 * failed, without ever needing the message text to carry that
 * information. Deliberately covers only real decision points in the
 * sequence below; there is no catch-all "SMTP_UNKNOWN" because every
 * `guarded()` call site names its own stage explicitly. */
export type SmtpStage =
  | 'SMTP_CONNECT_FAILED'
  | 'SMTP_GREETING_REJECTED'
  | 'SMTP_EHLO_FAILED'
  | 'SMTP_STARTTLS_UNAVAILABLE'
  | 'SMTP_STARTTLS_REJECTED'
  | 'SMTP_AUTH_PLAIN_UNAVAILABLE'
  | 'SMTP_AUTH_FAILED'
  | 'SMTP_MAIL_FROM_REJECTED'
  | 'SMTP_RCPT_TO_REJECTED'
  | 'SMTP_DATA_REJECTED'
  | 'SMTP_MESSAGE_REJECTED';

/** Deliberately never includes the SMTP username/password or the AUTH
 * PLAIN base64 payload -- `message` is built only from the `stage` name
 * and either a reply code/text the server itself sent back (never
 * secret) or a generic transport-error description. */
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

/** Injected only by tests: `now`/`randomHex` make the `Date`/`Message-ID`
 * headers deterministic without touching the real clock or `crypto`. */
export interface IonosSmtpDeps {
  readonly connectFn?: ConnectFn;
  readonly now?: () => Date;
  readonly randomHex?: () => string;
  /** Hostname this client introduces itself as in `EHLO` -- the sending
   * domain, not a secret. */
  readonly ehloHostname?: string;
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

/** Runs `fn`, converting ANY exception it throws (a network-level
 * rejection, or `SmtpProtocolError` from a malformed reply) into this
 * stage's `SmtpTransportError` -- except an `SmtpTransportError` already
 * thrown by an explicit `requireExactCode`/`requireSuccessCode` check
 * inside `fn`, which is rethrown as-is so its own, more specific stage is
 * preserved. */
async function guarded<T>(stage: SmtpStage, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof SmtpTransportError) throw err;
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

function hasStartTls(lines: readonly string[]): boolean {
  return lines.some((line) => /^STARTTLS\s*$/i.test(line.trim()));
}

async function writeLine(writer: WritableStreamDefaultWriter<Uint8Array>, line: string) {
  await writer.write(new TextEncoder().encode(`${line}\r\n`));
}

async function writeRaw(writer: WritableStreamDefaultWriter<Uint8Array>, text: string) {
  await writer.write(new TextEncoder().encode(text));
}

/**
 * Sends exactly one message over a fresh connection, following the exact
 * sequence: connect -> greeting -> EHLO -> STARTTLS -> TLS upgrade -> EHLO
 * -> AUTH PLAIN -> MAIL FROM -> RCPT TO -> DATA -> message -> QUIT. Throws
 * `SmtpTransportError` (with a `.stage`) on the first failure; always
 * closes the socket before returning or throwing.
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

  let socket: Socket;
  try {
    socket = connectFn(
      { hostname: config.host, port: config.port },
      { secureTransport: 'starttls' }
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new SmtpTransportError('SMTP_CONNECT_FAILED', detail);
  }

  let reader = socket.readable.getReader();
  let writer = socket.writable.getWriter();
  let responses = new SmtpResponseReader(reader);
  let currentSocket = socket;

  try {
    // 1. Greeting. Any failure here (including a malformed line) is a
    // connect-level failure: nothing about the SMTP session has started
    // yet from this client's point of view.
    const greeting = await guarded('SMTP_CONNECT_FAILED', () => responses.readResponse());
    requireExactCode(greeting, 220, 'SMTP_GREETING_REJECTED');

    // 2. Pre-TLS EHLO -- only to confirm STARTTLS is offered; nothing
    // else on this plaintext connection is trusted or used.
    await guarded('SMTP_EHLO_FAILED', () => writeLine(writer, `EHLO ${ehloHostname}`));
    const ehlo1 = await guarded('SMTP_EHLO_FAILED', () => responses.readResponse());
    requireExactCode(ehlo1, 250, 'SMTP_EHLO_FAILED');
    if (!hasStartTls(ehlo1.lines)) {
      throw new SmtpTransportError('SMTP_STARTTLS_UNAVAILABLE', 'STARTTLS not advertised');
    }

    // 3. STARTTLS.
    await guarded('SMTP_STARTTLS_REJECTED', () => writeLine(writer, 'STARTTLS'));
    const starttlsResp = await guarded('SMTP_STARTTLS_REJECTED', () => responses.readResponse());
    requireExactCode(starttlsResp, 220, 'SMTP_STARTTLS_REJECTED');

    // 4. TLS upgrade. `startTls()` returns a brand-new `Socket`; the
    // pre-TLS `reader`/`writer`/`responses` above are now abandoned
    // outright -- never read from or written to again, never explicitly
    // closed (closing them would tear down the very TCP connection the
    // TLS upgrade is reusing).
    const secureSocket = await guarded('SMTP_STARTTLS_REJECTED', async () => socket.startTls());
    currentSocket = secureSocket;
    reader = secureSocket.readable.getReader();
    writer = secureSocket.writable.getWriter();
    responses = new SmtpResponseReader(reader);

    // 5. Post-TLS EHLO -- capabilities must be re-read; a pre-TLS
    // capability list is untrusted (it was seen in plaintext).
    await guarded('SMTP_EHLO_FAILED', () => writeLine(writer, `EHLO ${ehloHostname}`));
    const ehlo2 = await guarded('SMTP_EHLO_FAILED', () => responses.readResponse());
    requireExactCode(ehlo2, 250, 'SMTP_EHLO_FAILED');
    const authMechanisms = findAuthMechanisms(ehlo2.lines);
    if (!authMechanisms.includes('PLAIN')) {
      throw new SmtpTransportError(
        'SMTP_AUTH_PLAIN_UNAVAILABLE',
        `AUTH PLAIN not advertised post-TLS (advertised: ${authMechanisms.join(', ') || '(none)'})`
      );
    }

    // 6. AUTH PLAIN -- the only mechanism this client ever sends,
    // regardless of what else the server advertises (e.g. LOGIN).
    const authPayload = encodeAuthPlainInitialResponse(config.username, config.password);
    await guarded('SMTP_AUTH_FAILED', () => writeLine(writer, `AUTH PLAIN ${authPayload}`));
    const authResp = await guarded('SMTP_AUTH_FAILED', () => responses.readResponse());
    requireExactCode(authResp, 235, 'SMTP_AUTH_FAILED');

    // 7. MAIL FROM.
    await guarded('SMTP_MAIL_FROM_REJECTED', () => writeLine(writer, `MAIL FROM:<${config.from}>`));
    const mailResp = await guarded('SMTP_MAIL_FROM_REJECTED', () => responses.readResponse());
    requireSuccessCode(mailResp, 'SMTP_MAIL_FROM_REJECTED');

    // 8. RCPT TO.
    await guarded('SMTP_RCPT_TO_REJECTED', () => writeLine(writer, `RCPT TO:<${config.to}>`));
    const rcptResp = await guarded('SMTP_RCPT_TO_REJECTED', () => responses.readResponse());
    requireSuccessCode(rcptResp, 'SMTP_RCPT_TO_REJECTED');

    // 9. DATA.
    await guarded('SMTP_DATA_REJECTED', () => writeLine(writer, 'DATA'));
    const dataResp = await guarded('SMTP_DATA_REJECTED', () => responses.readResponse());
    requireExactCode(dataResp, 354, 'SMTP_DATA_REJECTED');

    // 10. The message itself, dot-stuffed and terminated.
    const message = buildRfc822Message({
      from: config.from,
      to: config.to,
      subject: envelope.subject,
      bodyText: envelope.bodyText,
      date: now(),
      messageId: generateMessageId(ehloHostname, randomHex),
    });
    await guarded('SMTP_MESSAGE_REJECTED', () => writeRaw(writer, encodeForDataCommand(message)));
    const submitResp = await guarded('SMTP_MESSAGE_REJECTED', () => responses.readResponse());
    requireSuccessCode(submitResp, 'SMTP_MESSAGE_REJECTED');

    // 11. QUIT -- best-effort; the message is already accepted at this
    // point, so a broken/absent QUIT reply must not surface as a send
    // failure.
    try {
      await writeLine(writer, 'QUIT');
      await responses.readResponse();
    } catch {
      // Intentionally ignored -- see comment above.
    }
  } finally {
    await reader.cancel().catch(() => {});
    await currentSocket.close().catch(() => {});
  }
}

// Re-exported so callers can narrow a caught error without importing from
// the response-reader module directly.
export { SmtpProtocolError };
