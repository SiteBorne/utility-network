import { describe, expect, it } from 'vitest';
import {
  SmtpMessageError,
  buildRfc822Message,
  dotStuff,
  encodeAuthPlainInitialResponse,
  encodeForDataCommand,
  formatRfc5322Date,
  generateMessageId,
  normalizeToCrlf,
} from './smtp-message';

describe('normalizeToCrlf', () => {
  it('converts bare LF to CRLF', () => {
    expect(normalizeToCrlf('a\nb\nc')).toBe('a\r\nb\r\nc');
  });

  it('converts bare CR to CRLF', () => {
    expect(normalizeToCrlf('a\rb')).toBe('a\r\nb');
  });

  it('leaves existing CRLF untouched (no double-conversion)', () => {
    expect(normalizeToCrlf('a\r\nb')).toBe('a\r\nb');
  });

  it('handles mixed line endings in one string', () => {
    expect(normalizeToCrlf('a\nb\r\nc\rd')).toBe('a\r\nb\r\nc\r\nd');
  });
});

describe('dotStuff', () => {
  it('prefixes a leading dot on the first line', () => {
    expect(dotStuff('.hello')).toBe('..hello');
  });

  it('prefixes a leading dot on an interior line', () => {
    expect(dotStuff('line one\r\n.line two\r\nline three')).toBe(
      'line one\r\n..line two\r\nline three'
    );
  });

  it('does not touch a dot that is not at the start of a line', () => {
    expect(dotStuff('a line with a . in the middle')).toBe('a line with a . in the middle');
  });

  it('stuffs a line consisting of exactly one dot', () => {
    expect(dotStuff('before\r\n.\r\nafter')).toBe('before\r\n..\r\nafter');
  });

  it('stuffs consecutive dot-leading lines independently', () => {
    expect(dotStuff('.a\r\n.b')).toBe('..a\r\n..b');
  });
});

describe('formatRfc5322Date', () => {
  it('renders a known UTC instant in RFC 5322 form', () => {
    const date = new Date('2026-09-13T06:38:02.000Z');
    expect(formatRfc5322Date(date)).toBe('Sun, 13 Sep 2026 06:38:02 +0000');
  });

  it('zero-pads single-digit day/hour/minute/second', () => {
    const date = new Date('2026-01-02T03:04:05.000Z');
    expect(formatRfc5322Date(date)).toBe('Fri, 02 Jan 2026 03:04:05 +0000');
  });
});

describe('generateMessageId', () => {
  it('wraps the injected random source and domain in angle brackets', () => {
    expect(generateMessageId('alerts.siteborne.net', () => 'deadbeef')).toBe(
      '<deadbeef@alerts.siteborne.net>'
    );
  });

  it('defaults to a real random source producing distinct ids', () => {
    const a = generateMessageId('alerts.siteborne.net');
    const b = generateMessageId('alerts.siteborne.net');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^<[^@]+@alerts\.siteborne\.net>$/);
  });
});

describe('encodeAuthPlainInitialResponse', () => {
  it('matches a known base64(\\0user\\0pass) vector', () => {
    expect(encodeAuthPlainInitialResponse('alice', 'secret')).toBe('AGFsaWNlAHNlY3JldA==');
  });

  it('encodes non-ASCII password bytes as UTF-8, not code points', () => {
    expect(encodeAuthPlainInitialResponse('alice', 'sécret')).toBe('AGFsaWNlAHPDqWNyZXQ=');
  });

  it('never returns the plaintext password substring', () => {
    const encoded = encodeAuthPlainInitialResponse(
      'storage@alerts.siteborne.net',
      'super-secret-value'
    );
    expect(encoded).not.toContain('super-secret-value');
  });
});

describe('buildRfc822Message', () => {
  const base = {
    from: 'storage@alerts.siteborne.net',
    to: 'hello@siteborne.com',
    subject: 'SITEBORNE: storage reclamation critical alert',
    bodyText: 'line one\nline two',
    date: new Date('2026-09-13T06:38:02.000Z'),
    messageId: '<abc123@alerts.siteborne.net>',
  };

  it('includes all required headers with CRLF separators', () => {
    const message = buildRfc822Message(base);
    expect(message).toContain('From: storage@alerts.siteborne.net\r\n');
    expect(message).toContain('To: hello@siteborne.com\r\n');
    expect(message).toContain('Subject: SITEBORNE: storage reclamation critical alert\r\n');
    expect(message).toContain('Date: Sun, 13 Sep 2026 06:38:02 +0000\r\n');
    expect(message).toContain('Message-ID: <abc123@alerts.siteborne.net>\r\n');
    expect(message).toContain('MIME-Version: 1.0\r\n');
    expect(message).toContain('Content-Type: text/plain; charset=UTF-8\r\n');
    expect(message).toContain('Content-Transfer-Encoding: 8bit\r\n');
  });

  it('separates headers from body with exactly one blank line', () => {
    const message = buildRfc822Message(base);
    const [, bodyPart] = message.split('\r\n\r\n');
    expect(bodyPart).toBe('line one\r\nline two');
  });

  it('normalizes bare-LF body content to CRLF', () => {
    const message = buildRfc822Message({ ...base, bodyText: 'a\nb\nc' });
    expect(message.endsWith('a\r\nb\r\nc')).toBe(true);
  });

  it('rejects a From header value containing a line break (header injection)', () => {
    expect(() =>
      buildRfc822Message({ ...base, from: 'attacker@example.com\r\nBcc: victim@example.com' })
    ).toThrow(SmtpMessageError);
  });

  it('rejects a Subject header value containing a line break (header injection)', () => {
    expect(() => buildRfc822Message({ ...base, subject: 'hi\r\nX-Injected: yes' })).toThrow(
      SmtpMessageError
    );
  });

  it('rejects a To header value containing a bare LF', () => {
    expect(() => buildRfc822Message({ ...base, to: 'a@example.com\nBcc: b@example.com' })).toThrow(
      SmtpMessageError
    );
  });
});

describe('encodeForDataCommand', () => {
  it('dot-stuffs the message and terminates with CRLF . CRLF', () => {
    const message = 'Subject: x\r\n\r\nhello';
    expect(encodeForDataCommand(message)).toBe('Subject: x\r\n\r\nhello\r\n.\r\n');
  });

  it('dot-stuffs a body line that begins with a dot', () => {
    const message = 'Subject: x\r\n\r\n.gitignore is not a header';
    expect(encodeForDataCommand(message)).toBe(
      'Subject: x\r\n\r\n..gitignore is not a header\r\n.\r\n'
    );
  });

  it('produces exactly one terminator, not a duplicate, when the body already ends without a trailing dot line', () => {
    const encoded = encodeForDataCommand('a\r\nb');
    const terminatorCount = encoded.split('\r\n.\r\n').length - 1;
    expect(terminatorCount).toBe(1);
    expect(encoded).toBe('a\r\nb\r\n.\r\n');
  });
});
