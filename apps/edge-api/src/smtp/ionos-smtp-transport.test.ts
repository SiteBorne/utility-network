import { describe, expect, it } from 'vitest';
import type { Socket } from 'cloudflare:sockets';
import {
  SmtpTransportError,
  sendStorageAlertViaIonosSmtp,
  type ConnectFn,
} from './ionos-smtp-transport';
import { encodeAuthPlainInitialResponse } from './smtp-message';

const HOST = 'smtp.ionos.com';
const PORT = 587;
const USERNAME = 'storage@alerts.siteborne.net';
const PASSWORD = 'fake-mailbox-password-does-not-touch-network';
const FROM = 'storage@alerts.siteborne.net';
const TO = 'hello@siteborne.com';

/** A scripted fake `Socket`: `responses` are handed back one per logical
 * `read()` call (as already-encoded chunks -- a caller may pass a string
 * or, to force a mid-line split, an array of `Uint8Array` fragments for a
 * single queued response), and every `writer.write()` call is captured
 * verbatim (decoded to text) in `writes`, in order. */
function makeScriptedSocket(responses: Array<string | Uint8Array[]>) {
  const writes: string[] = [];
  let closeCalls = 0;
  const encoder = new TextEncoder();

  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const resp of responses) {
        if (typeof resp === 'string') {
          controller.enqueue(encoder.encode(resp));
        } else {
          for (const piece of resp) controller.enqueue(piece);
        }
      }
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

/** Wires a pre-TLS fake socket whose `startTls()` returns a second,
 * independent fake socket -- exactly Cloudflare's real contract (a brand
 * new `Socket` layered over the same connection). Returns both fakes so
 * a test can assert on each side's `writes` independently: proof that
 * nothing after the TLS upgrade ever touches the pre-TLS socket again. */
function makeTlsSocketPair(
  preTlsResponses: Array<string | Uint8Array[]>,
  postTlsResponses: Array<string | Uint8Array[]>
) {
  const pre = makeScriptedSocket(preTlsResponses);
  const post = makeScriptedSocket(postTlsResponses);
  (pre.socket as unknown as { startTls: () => Socket }).startTls = () => post.socket;
  return { pre, post };
}

const GREETING = '220 mreueus003.schlund.de ESMTP Nemesis ready\r\n';
const EHLO1_WITH_STARTTLS = '250-mreueus003.schlund.de\r\n250-PIPELINING\r\n250 STARTTLS\r\n';
const EHLO1_WITHOUT_STARTTLS = '250-mreueus003.schlund.de\r\n250 PIPELINING\r\n';
const STARTTLS_ACK = '220 2.0.0 Ready to start TLS\r\n';
const EHLO2_WITH_PLAIN =
  '250-mreueus003.schlund.de\r\n250-AUTH LOGIN PLAIN\r\n250 SIZE 141557760\r\n';
const EHLO2_WITHOUT_PLAIN = '250-mreueus003.schlund.de\r\n250 AUTH LOGIN\r\n';
const AUTH_OK = '235 2.7.0 Authentication successful\r\n';
const MAIL_OK = '250 2.1.0 Sender OK\r\n';
const RCPT_OK = '250 2.1.5 Recipient OK\r\n';
const DATA_GO = '354 Start mail input\r\n';
const SUBMIT_OK = '250 2.0.0 Message accepted\r\n';
const QUIT_OK = '221 2.0.0 Bye\r\n';

const ENVELOPE = {
  subject: 'SITEBORNE: storage reclamation critical alert',
  bodyText: 'r2_delete_failures: 3\nreclaimed_count: 12',
};

const DEPS = {
  now: () => new Date('2026-09-13T06:38:02.000Z'),
  randomHex: () => 'deadbeefcafe',
};

function config() {
  return { host: HOST, port: PORT, username: USERNAME, password: PASSWORD, from: FROM, to: TO };
}

describe('sendStorageAlertViaIonosSmtp — successful lifecycle', () => {
  it('completes the full STARTTLS + AUTH PLAIN + send sequence', async () => {
    const { pre, post } = makeTlsSocketPair(
      [GREETING, EHLO1_WITH_STARTTLS, STARTTLS_ACK],
      [EHLO2_WITH_PLAIN, AUTH_OK, MAIL_OK, RCPT_OK, DATA_GO, SUBMIT_OK, QUIT_OK]
    );
    let capturedAddress: unknown;
    let capturedOptions: unknown;
    const connectFn: ConnectFn = (address, options) => {
      capturedAddress = address;
      capturedOptions = options;
      return pre.socket;
    };

    await sendStorageAlertViaIonosSmtp(config(), ENVELOPE, { ...DEPS, connectFn });

    expect(capturedAddress).toEqual({ hostname: HOST, port: PORT });
    expect(capturedOptions).toEqual({ secureTransport: 'starttls' });

    // Pre-TLS socket: exactly EHLO then STARTTLS, nothing more -- proves
    // the old reader/writer are abandoned after the TLS upgrade (nothing
    // written to this socket happens during or after it).
    expect(pre.writes).toEqual(['EHLO alerts.siteborne.net\r\n', 'STARTTLS\r\n']);

    // Post-TLS socket: EHLO happens again (capabilities re-read over TLS),
    // strictly before AUTH, which is strictly before the envelope/data
    // commands.
    expect(post.writes[0]).toBe('EHLO alerts.siteborne.net\r\n');
    const expectedAuthPayload = encodeAuthPlainInitialResponse(USERNAME, PASSWORD);
    expect(post.writes[1]).toBe(`AUTH PLAIN ${expectedAuthPayload}\r\n`);
    expect(post.writes[2]).toBe(`MAIL FROM:<${FROM}>\r\n`);
    expect(post.writes[3]).toBe(`RCPT TO:<${TO}>\r\n`);
    expect(post.writes[4]).toBe('DATA\r\n');
    expect(post.writes[6]).toBe('QUIT\r\n');

    // The message itself: CRLF-normalized, correct headers, dot-stuffed,
    // properly terminated.
    const dataPayload = post.writes[5];
    expect(dataPayload).toContain('From: storage@alerts.siteborne.net\r\n');
    expect(dataPayload).toContain('Date: Sun, 13 Sep 2026 06:38:02 +0000\r\n');
    expect(dataPayload).toContain('Message-ID: <deadbeefcafe@alerts.siteborne.net>\r\n');
    expect(dataPayload).toContain('r2_delete_failures: 3\r\nreclaimed_count: 12');
    expect(dataPayload.endsWith('\r\n.\r\n')).toBe(true);

    // The socket actually used at the end (post-TLS) was closed.
    expect(post.closeCalls).toBe(1);

    // The plaintext password never appears on the wire in any form other
    // than the correctly base64-encoded AUTH PLAIN payload.
    for (const write of [...pre.writes, ...post.writes]) {
      expect(write).not.toContain(PASSWORD);
    }
  });

  it('never sends AUTH before the TLS upgrade', async () => {
    const { pre, post } = makeTlsSocketPair(
      [GREETING, EHLO1_WITH_STARTTLS, STARTTLS_ACK],
      [EHLO2_WITH_PLAIN, AUTH_OK, MAIL_OK, RCPT_OK, DATA_GO, SUBMIT_OK, QUIT_OK]
    );
    await sendStorageAlertViaIonosSmtp(config(), ENVELOPE, {
      ...DEPS,
      connectFn: () => pre.socket,
    });
    expect(pre.writes.some((w) => w.startsWith('AUTH'))).toBe(false);
    expect(post.writes[0]).toBe('EHLO alerts.siteborne.net\r\n');
  });

  it('tolerates a missing/garbled QUIT reply without failing the send', async () => {
    const { pre, post } = makeTlsSocketPair(
      [GREETING, EHLO1_WITH_STARTTLS, STARTTLS_ACK],
      [EHLO2_WITH_PLAIN, AUTH_OK, MAIL_OK, RCPT_OK, DATA_GO, SUBMIT_OK] // no QUIT reply queued
    );
    await expect(
      sendStorageAlertViaIonosSmtp(config(), ENVELOPE, { ...DEPS, connectFn: () => pre.socket })
    ).resolves.toBeUndefined();
    expect(post.writes[6]).toBe('QUIT\r\n');
    expect(post.closeCalls).toBe(1);
  });

  it('handles a greeting response split across multiple TCP chunks', async () => {
    const encoder = new TextEncoder();
    const splitGreeting: Uint8Array[] = [
      encoder.encode('220 mre'),
      encoder.encode('ueus003.schlund.de rea'),
      encoder.encode('dy\r\n'),
    ];
    const { pre } = makeTlsSocketPair(
      [splitGreeting, EHLO1_WITH_STARTTLS, STARTTLS_ACK],
      [EHLO2_WITH_PLAIN, AUTH_OK, MAIL_OK, RCPT_OK, DATA_GO, SUBMIT_OK, QUIT_OK]
    );
    await expect(
      sendStorageAlertViaIonosSmtp(config(), ENVELOPE, { ...DEPS, connectFn: () => pre.socket })
    ).resolves.toBeUndefined();
  });
});

describe('sendStorageAlertViaIonosSmtp — failure stages', () => {
  async function expectStage(connectFn: ConnectFn, stage: string): Promise<SmtpTransportError> {
    const err = await sendStorageAlertViaIonosSmtp(config(), ENVELOPE, {
      ...DEPS,
      connectFn,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SmtpTransportError);
    expect((err as SmtpTransportError).stage).toBe(stage);
    return err as SmtpTransportError;
  }

  it('SMTP_CONNECT_FAILED when the socket cannot be constructed', async () => {
    await expectStage(() => {
      throw new Error('DNS resolution failed');
    }, 'SMTP_CONNECT_FAILED');
  });

  it('SMTP_GREETING_REJECTED on a non-220 greeting', async () => {
    const { pre } = makeTlsSocketPair(['421 service not available\r\n'], []);
    await expectStage(() => pre.socket, 'SMTP_GREETING_REJECTED');
  });

  it('SMTP_EHLO_FAILED on a non-250 pre-TLS EHLO reply', async () => {
    const { pre } = makeTlsSocketPair([GREETING, '502 command not implemented\r\n'], []);
    await expectStage(() => pre.socket, 'SMTP_EHLO_FAILED');
  });

  it('SMTP_STARTTLS_UNAVAILABLE when STARTTLS is not advertised, and never attempts it', async () => {
    const { pre } = makeTlsSocketPair([GREETING, EHLO1_WITHOUT_STARTTLS], []);
    await expectStage(() => pre.socket, 'SMTP_STARTTLS_UNAVAILABLE');
    expect(pre.writes.some((w) => w.startsWith('STARTTLS'))).toBe(false);
  });

  it('SMTP_STARTTLS_REJECTED on a non-220 STARTTLS reply', async () => {
    const { pre } = makeTlsSocketPair(
      [GREETING, EHLO1_WITH_STARTTLS, '454 TLS not available\r\n'],
      []
    );
    await expectStage(() => pre.socket, 'SMTP_STARTTLS_REJECTED');
  });

  it('SMTP_EHLO_FAILED on a non-250 post-TLS EHLO reply', async () => {
    const { pre } = makeTlsSocketPair(
      [GREETING, EHLO1_WITH_STARTTLS, STARTTLS_ACK],
      ['502 command not implemented\r\n']
    );
    await expectStage(() => pre.socket, 'SMTP_EHLO_FAILED');
  });

  it('SMTP_AUTH_PLAIN_UNAVAILABLE when PLAIN is not advertised post-TLS, and AUTH is never sent', async () => {
    const { pre, post } = makeTlsSocketPair(
      [GREETING, EHLO1_WITH_STARTTLS, STARTTLS_ACK],
      [EHLO2_WITHOUT_PLAIN]
    );
    await expectStage(() => pre.socket, 'SMTP_AUTH_PLAIN_UNAVAILABLE');
    expect(post.writes.some((w) => w.startsWith('AUTH'))).toBe(false);
  });

  it('SMTP_AUTH_FAILED on a non-235 AUTH reply, without leaking the password in the error', async () => {
    const { pre } = makeTlsSocketPair(
      [GREETING, EHLO1_WITH_STARTTLS, STARTTLS_ACK],
      [EHLO2_WITH_PLAIN, '535 5.7.8 Authentication failed\r\n']
    );
    const err = await expectStage(() => pre.socket, 'SMTP_AUTH_FAILED');
    expect(err.message).not.toContain(PASSWORD);
    expect(err.message).not.toContain(encodeAuthPlainInitialResponse(USERNAME, PASSWORD));
  });

  it('SMTP_MAIL_FROM_REJECTED on a non-2xx MAIL FROM reply', async () => {
    const { pre } = makeTlsSocketPair(
      [GREETING, EHLO1_WITH_STARTTLS, STARTTLS_ACK],
      [EHLO2_WITH_PLAIN, AUTH_OK, '550 5.1.0 Sender rejected\r\n']
    );
    await expectStage(() => pre.socket, 'SMTP_MAIL_FROM_REJECTED');
  });

  it('SMTP_RCPT_TO_REJECTED on a non-2xx RCPT TO reply', async () => {
    const { pre } = makeTlsSocketPair(
      [GREETING, EHLO1_WITH_STARTTLS, STARTTLS_ACK],
      [EHLO2_WITH_PLAIN, AUTH_OK, MAIL_OK, '550 5.1.1 Recipient rejected\r\n']
    );
    await expectStage(() => pre.socket, 'SMTP_RCPT_TO_REJECTED');
  });

  it('SMTP_DATA_REJECTED on a non-354 DATA reply', async () => {
    const { pre } = makeTlsSocketPair(
      [GREETING, EHLO1_WITH_STARTTLS, STARTTLS_ACK],
      [EHLO2_WITH_PLAIN, AUTH_OK, MAIL_OK, RCPT_OK, '503 5.5.1 Bad sequence\r\n']
    );
    await expectStage(() => pre.socket, 'SMTP_DATA_REJECTED');
  });

  it('SMTP_MESSAGE_REJECTED on a non-2xx post-DATA reply', async () => {
    const { pre } = makeTlsSocketPair(
      [GREETING, EHLO1_WITH_STARTTLS, STARTTLS_ACK],
      [EHLO2_WITH_PLAIN, AUTH_OK, MAIL_OK, RCPT_OK, DATA_GO, '554 5.6.0 Message rejected\r\n']
    );
    await expectStage(() => pre.socket, 'SMTP_MESSAGE_REJECTED');
  });

  it('closes the currently-active socket even on failure', async () => {
    const { pre, post } = makeTlsSocketPair(
      [GREETING, EHLO1_WITH_STARTTLS, STARTTLS_ACK],
      [EHLO2_WITH_PLAIN, '535 5.7.8 Authentication failed\r\n']
    );
    await sendStorageAlertViaIonosSmtp(config(), ENVELOPE, {
      ...DEPS,
      connectFn: () => pre.socket,
    }).catch(() => {});
    // The post-TLS socket is the "currently active" one at the point of
    // failure (auth happens after the upgrade), so it -- not the
    // abandoned pre-TLS socket -- must be the one actually closed.
    expect(post.closeCalls).toBe(1);
    expect(pre.closeCalls).toBe(0);
  });
});
