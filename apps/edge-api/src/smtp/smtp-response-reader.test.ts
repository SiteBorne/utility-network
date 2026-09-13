import { describe, expect, it } from 'vitest';
import {
  SmtpProtocolError,
  SmtpResponseReader,
  type ByteChunkReader,
} from './smtp-response-reader';

/** A fake byte source that hands back one queued chunk per `read()` call,
 * then reports `done`. Each queued chunk may be a string (UTF-8 encoded
 * here) or a raw `Uint8Array`, so a test can force an arbitrary split
 * point mid-line without caring about text encoding at all. */
function queueReader(chunks: Array<string | Uint8Array>): ByteChunkReader {
  const queue = chunks.map((c) => (typeof c === 'string' ? new TextEncoder().encode(c) : c));
  let i = 0;
  return {
    async read() {
      if (i >= queue.length) return { done: true };
      return { done: false, value: queue[i++] };
    },
  };
}

describe('SmtpResponseReader', () => {
  it('parses a single-line response delivered in one chunk', async () => {
    const reader = new SmtpResponseReader(queueReader(['250 OK\r\n']));
    const resp = await reader.readResponse();
    expect(resp.code).toBe(250);
    expect(resp.lines).toEqual(['OK']);
  });

  it('parses a multiline response where each line arrives in its own chunk', async () => {
    const reader = new SmtpResponseReader(
      queueReader(['250-first line\r\n', '250-second line\r\n', '250 final line\r\n'])
    );
    const resp = await reader.readResponse();
    expect(resp.code).toBe(250);
    expect(resp.lines).toEqual(['first line', 'second line', 'final line']);
  });

  it('parses a multiline response where several lines arrive in one chunk', async () => {
    const reader = new SmtpResponseReader(queueReader(['250-a\r\n250-b\r\n250 c\r\n']));
    const resp = await reader.readResponse();
    expect(resp.code).toBe(250);
    expect(resp.lines).toEqual(['a', 'b', 'c']);
  });

  it('parses a response whose line is split across chunk boundaries', async () => {
    const reader = new SmtpResponseReader(queueReader(['25', '0 O', 'K\r', '\n']));
    const resp = await reader.readResponse();
    expect(resp.code).toBe(250);
    expect(resp.lines).toEqual(['OK']);
  });

  it('parses a multiline response split mid-line across chunks, including across the continuation boundary', async () => {
    const reader = new SmtpResponseReader(
      queueReader(['250-AUTH LO', 'GIN PLAIN\r\n250 SIZE ', '141557760\r\n'])
    );
    const resp = await reader.readResponse();
    expect(resp.code).toBe(250);
    expect(resp.lines).toEqual(['AUTH LOGIN PLAIN', 'SIZE 141557760']);
  });

  it('tolerates bare LF line endings (no CR)', async () => {
    const reader = new SmtpResponseReader(queueReader(['250 OK\n']));
    const resp = await reader.readResponse();
    expect(resp.code).toBe(250);
    expect(resp.lines).toEqual(['OK']);
  });

  it('reads a second, independent response after the first with leftover buffered bytes', async () => {
    const reader = new SmtpResponseReader(queueReader(['220 greeting\r\n250 EHLO ok\r\n']));
    const first = await reader.readResponse();
    expect(first.code).toBe(220);
    const second = await reader.readResponse();
    expect(second.code).toBe(250);
    expect(second.lines).toEqual(['EHLO ok']);
  });

  it('rejects a malformed response line', async () => {
    const reader = new SmtpResponseReader(queueReader(['not-a-valid-smtp-line\r\n']));
    await expect(reader.readResponse()).rejects.toBeInstanceOf(SmtpProtocolError);
  });

  it('rejects a multiline response whose continuation lines disagree on the reply code', async () => {
    const reader = new SmtpResponseReader(queueReader(['250-first\r\n251 final\r\n']));
    await expect(reader.readResponse()).rejects.toBeInstanceOf(SmtpProtocolError);
  });

  it('rejects when the connection closes before a complete response is received', async () => {
    const reader = new SmtpResponseReader(queueReader([]));
    await expect(reader.readResponse()).rejects.toBeInstanceOf(SmtpProtocolError);
  });

  it('rejects when the connection closes mid-multiline-response', async () => {
    const reader = new SmtpResponseReader(queueReader(['250-first line\r\n']));
    await expect(reader.readResponse()).rejects.toBeInstanceOf(SmtpProtocolError);
  });
});
