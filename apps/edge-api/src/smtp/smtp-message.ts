/**
 * SUN-1222C-IONOS-SMTP-TRANSPORT — message construction and wire-encoding
 * helpers for the direct authenticated-SMTP transport
 * (`ionos-smtp-transport.ts`). Deliberately has no network/socket
 * dependency of its own so every function here is a pure, synchronous
 * unit under test.
 */

/** Thrown by `buildRfc822Message` when a header value would let the
 * caller inject additional headers or SMTP commands by smuggling a CR or
 * LF into what is meant to be a single header line. None of this
 * module's own callers currently pass attacker-controlled values into
 * `subject`/`from`/`to` (the entrypoint's payload schema constrains the
 * alert body, and `from`/`to` are fixed constants), but this guard makes
 * that an enforced invariant rather than an incidental one. */
export class SmtpMessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SmtpMessageError';
  }
}

/** Normalizes every line ending (`\r\n`, bare `\r`, or bare `\n`) to
 * `\r\n` -- SMTP DATA content is defined in terms of CRLF lines, and
 * nothing upstream (JSON strings, template literals) guarantees that. */
export function normalizeToCrlf(text: string): string {
  return text.replace(/\r\n|\r|\n/g, '\r\n');
}

/** RFC 5321 §4.5.2 "dot-stuffing": any line that begins with `.` gets a
 * second `.` prepended, so the receiving server's own end-of-DATA
 * detector (a line consisting of exactly `.`) can never be triggered by
 * message content. Must run on already-CRLF-normalized text so "line"
 * boundaries are unambiguous. */
export function dotStuff(crlfText: string): string {
  return crlfText.replace(/(^|\r\n)\./g, '$1..');
}

/** A header value must be exactly one line: reject anything containing a
 * bare CR or LF before it ever reaches the wire. */
function assertSingleLine(value: string, fieldName: string): void {
  if (/[\r\n]/.test(value)) {
    throw new SmtpMessageError(`header injection attempt: ${fieldName} contains a line break`);
  }
}

/** RFC 5322 §3.3 date-time, always rendered in UTC (`+0000`) so this
 * function needs no timezone-offset arithmetic. */
export function formatRfc5322Date(date: Date): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const day = days[date.getUTCDay()];
  const dom = pad2(date.getUTCDate());
  const month = months[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  const hh = pad2(date.getUTCHours());
  const mm = pad2(date.getUTCMinutes());
  const ss = pad2(date.getUTCSeconds());
  return `${day}, ${dom} ${month} ${year} ${hh}:${mm}:${ss} +0000`;
}

/** Generates a `Message-ID` header value scoped to `idDomain`. `randomHex`
 * is injectable so tests can assert exact output instead of merely
 * "looks unique"; defaults to a real random source. */
export function generateMessageId(
  idDomain: string,
  randomHex: () => string = () => crypto.randomUUID().replace(/-/g, '')
): string {
  return `<${randomHex()}@${idDomain}>`;
}

export interface Rfc822MessageInput {
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly bodyText: string;
  readonly date: Date;
  readonly messageId: string;
}

/** Builds a minimal, standards-safe plain-text RFC 822/5322 message:
 * headers + a blank line + the (CRLF-normalized) body. No HTML, no
 * attachments, no MIME multipart -- matches the existing hand-rolled
 * message this replaces; `mimetext` remains the natural upgrade if a
 * richer body is ever needed. */
export function buildRfc822Message(input: Rfc822MessageInput): string {
  assertSingleLine(input.from, 'From');
  assertSingleLine(input.to, 'To');
  assertSingleLine(input.subject, 'Subject');
  assertSingleLine(input.messageId, 'Message-ID');

  const headers = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    `Date: ${formatRfc5322Date(input.date)}`,
    `Message-ID: ${input.messageId}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
  ];
  const body = normalizeToCrlf(input.bodyText);
  return `${headers.join('\r\n')}\r\n\r\n${body}`;
}

/** Encodes an already-built RFC 822 message as the exact byte content an
 * SMTP `DATA` command must send: dot-stuffed, then terminated with the
 * bare `\r\n.\r\n` end-of-data marker. Deliberately takes CRLF-normalized
 * input (i.e. the output of `buildRfc822Message`) rather than
 * normalizing again here, so there is exactly one place that decides what
 * counts as a "line" for dot-stuffing purposes. */
export function encodeForDataCommand(crlfMessage: string): string {
  return `${dotStuff(crlfMessage)}\r\n.\r\n`;
}

/** RFC 4954 `AUTH PLAIN` initial-response payload: base64 of
 * `\0<username>\0<password>` (an empty authorization-identity, then the
 * authentication identity, then the password). Operates on UTF-8 bytes,
 * not JS string codepoints, so it is correct even if either credential
 * contains non-ASCII characters. */
export function encodeAuthPlainInitialResponse(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`\0${username}\0${password}`);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
