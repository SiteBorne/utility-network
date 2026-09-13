/**
 * SUN-1222C-IONOS-SMTP-TRANSPORT — an incremental, chunk-boundary-safe
 * parser for RFC 5321 SMTP text responses.
 *
 * A single logical SMTP response is one or more lines sharing the same
 * three-digit reply code, e.g.:
 *
 *   250-mreueus003.schlund.de Hello
 *   250-AUTH LOGIN PLAIN
 *   250 SIZE 141557760
 *
 * Continuation lines use `<code>-`; the final line uses `<code><space>`.
 * Nothing about a raw TCP stream guarantees any of this arrives aligned to
 * a "line" -- a single `read()` may deliver less than one line, more than
 * one line, or a line split mid-way through -- so this reader buffers
 * decoded text across calls and only ever hands back whole, validated
 * response lines to its caller.
 */

/** Structural subset of `ReadableStreamDefaultReader<Uint8Array>` -- kept
 * this narrow (rather than importing the DOM/Workers type) so this module
 * has zero platform-specific type dependency and its own tests can pass a
 * trivial hand-rolled fake with no stream machinery at all. */
export interface ByteChunkReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
}

export interface SmtpResponse {
  /** The three-digit reply code shared by every line of this response. */
  readonly code: number;
  /** Each line's text with the `<code>[ -]` prefix already stripped. */
  readonly lines: readonly string[];
}

/** Malformed-protocol condition: a line didn't match `<3 digits><space|dash>`,
 * a multiline response's continuation lines disagreed on their code, or the
 * connection closed mid-response. Deliberately distinct from
 * `SmtpTransportError` (in `ionos-smtp-transport.ts`) -- this class knows
 * nothing about *which SMTP command* was in flight; the transport wraps it
 * with that stage context. */
export class SmtpProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SmtpProtocolError';
  }
}

const RESPONSE_LINE = /^(\d{3})([ -])(.*)$/;

export class SmtpResponseReader {
  private buffer = '';
  private readonly decoder = new TextDecoder();
  private closed = false;

  constructor(private readonly source: ByteChunkReader) {}

  /** Reads one complete (possibly multiline) SMTP response, consuming
   * exactly the bytes that belong to it and leaving any following bytes
   * buffered for the next call. */
  async readResponse(): Promise<SmtpResponse> {
    const lines: string[] = [];
    let code: number | undefined;
    for (;;) {
      const rawLine = await this.nextLine();
      const match = RESPONSE_LINE.exec(rawLine);
      if (!match) {
        throw new SmtpProtocolError(`malformed SMTP response line: ${JSON.stringify(rawLine)}`);
      }
      const [, codeText, separator, text] = match;
      const lineCode = Number(codeText);
      if (code === undefined) {
        code = lineCode;
      } else if (lineCode !== code) {
        throw new SmtpProtocolError(
          `inconsistent multiline SMTP response code: started ${code}, continuation line had ${lineCode}`
        );
      }
      lines.push(text);
      if (separator === ' ') break; // final line of this response
    }
    return { code: code as number, lines };
  }

  /** Pulls one CRLF- or LF-terminated line out of the buffer, reading more
   * chunks from the underlying source as needed. A trailing partial line
   * delivered right as the stream ends is still returned once (SMTP
   * servers always terminate their final line before closing, but this
   * keeps the reader from hanging forever on a misbehaving one). */
  private async nextLine(): Promise<string> {
    for (;;) {
      const newlineIndex = this.buffer.indexOf('\n');
      if (newlineIndex !== -1) {
        let line = this.buffer.slice(0, newlineIndex);
        this.buffer = this.buffer.slice(newlineIndex + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        return line;
      }
      if (this.closed) {
        if (this.buffer.length > 0) {
          const line = this.buffer;
          this.buffer = '';
          return line;
        }
        throw new SmtpProtocolError(
          'connection closed before a complete SMTP response line was received'
        );
      }
      const { done, value } = await this.source.read();
      if (done) {
        this.closed = true;
        continue;
      }
      if (value && value.byteLength > 0) {
        this.buffer += this.decoder.decode(value, { stream: true });
      }
    }
  }
}
