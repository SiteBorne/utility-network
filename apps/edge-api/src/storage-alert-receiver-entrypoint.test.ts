import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SmtpDiagnosticResult } from './smtp/ionos-smtp-diagnostic';

const sentCalls: Array<{
  config: {
    host: string;
    port: number;
    username: string;
    password: string;
    from: string;
    to: string;
  };
  envelope: { subject: string; bodyText: string };
}> = [];

const sendStorageAlertViaIonosSmtp = vi.fn(async (config, envelope) => {
  sentCalls.push({ config, envelope });
});

vi.mock('./smtp/ionos-smtp-transport', () => ({
  sendStorageAlertViaIonosSmtp: (...args: unknown[]) =>
    (sendStorageAlertViaIonosSmtp as (...a: unknown[]) => unknown)(...args),
}));

const diagnosticCalls: Array<{ host: string; port: number }> = [];
const DEFAULT_DIAGNOSTIC_RESULT: SmtpDiagnosticResult = {
  ok: true,
  reachedStage: 'COMPLETE',
  outcome: 'QUIT_OK',
  timedOut: false,
  elapsedMsByStage: { SMTP_GREETING: 12 },
};
const probeIonosSmtpConnectivity = vi.fn(
  async (config: { host: string; port: number }): Promise<SmtpDiagnosticResult> => {
    diagnosticCalls.push(config);
    return DEFAULT_DIAGNOSTIC_RESULT;
  }
);

// SUN-1222C-SMTP-ROOT-CAUSE addendum: `DEFAULT_OVERALL_TIMEOUT_MS` and
// `CLEANUP_TIMEOUT_MS` are both mocked small (rather than the real 8_000 /
// 1_000) purely so the `CONTROL_OVERALL_TIMEOUT`/`CONTROL_CLEANUP_HANG`
// tests below don't burn real seconds each -- the *values themselves* are
// never asserted against, only that the control path races `withTimeout`
// against them and reports the expected classification.
vi.mock('./smtp/ionos-smtp-diagnostic', () => ({
  probeIonosSmtpConnectivity: (...args: unknown[]) =>
    (probeIonosSmtpConnectivity as (...a: unknown[]) => unknown)(...args),
  DEFAULT_OVERALL_TIMEOUT_MS: 20,
  CLEANUP_TIMEOUT_MS: 10,
}));

// SUN-1222C-SMTP-ROOT-CAUSE addendum: mocked identically in shape to
// `probeIonosSmtpConnectivity` above -- proves the receiver's
// `?mode=IONOS_IMPLICIT_TLS_465` branch reaches this function (and only this
// function) instead of the port-587 probe, without opening a real socket.
const implicitTlsDiagnosticCalls: Array<{ host: string; port: number }> = [];
interface StandInImplicitTlsResult {
  readonly ok: boolean;
  readonly reachedStage: string;
  readonly outcome: string;
  readonly timedOut: boolean;
  readonly elapsedMsByStage: Record<string, number>;
  readonly failedStage?: string;
  readonly detail?: string;
}
const DEFAULT_IMPLICIT_TLS_RESULT: StandInImplicitTlsResult = {
  ok: true,
  reachedStage: 'COMPLETE',
  outcome: 'QUIT_OK',
  timedOut: false,
  elapsedMsByStage: { IMPLICIT_TLS_CONNECT: 9 },
};
const probeIonosSmtpImplicitTlsConnectivity = vi.fn(
  async (config: { host: string; port: number }): Promise<StandInImplicitTlsResult> => {
    implicitTlsDiagnosticCalls.push(config);
    return DEFAULT_IMPLICIT_TLS_RESULT;
  }
);
vi.mock('./smtp/ionos-smtp-implicit-tls-diagnostic', () => ({
  probeIonosSmtpImplicitTlsConnectivity: (...args: unknown[]) =>
    (probeIonosSmtpImplicitTlsConnectivity as (...a: unknown[]) => unknown)(...args),
}));

import worker, { type Env } from './storage-alert-receiver-entrypoint';

const TOKEN = 'a'.repeat(48); // stand-in for a real cryptographically random token
const PASSWORD = 'stand-in-ionos-mailbox-password';
const VALID_PAYLOAD = {
  event: 'siteborne.storage_reclamation.critical_alert',
  operation_class: 'artifact_reclamation_r2_delete_failure',
  r2_delete_failures: 3,
  reclaimed_count: 12,
  swept_at: '2026-09-13T05:00:00.000Z',
  sample_content_hashes: ['abc123', 'def456'],
};

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    ALERT_PATH_TOKEN: TOKEN,
    IONOS_SMTP_PASSWORD: PASSWORD,
    ...overrides,
  };
}

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://storage-alert-receiver.example/${path}`, {
    method: 'POST',
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });
}

beforeEach(() => {
  sentCalls.length = 0;
  sendStorageAlertViaIonosSmtp.mockClear();
  sendStorageAlertViaIonosSmtp.mockImplementation(async (config, envelope) => {
    sentCalls.push({ config, envelope } as (typeof sentCalls)[number]);
  });
  diagnosticCalls.length = 0;
  probeIonosSmtpConnectivity.mockClear();
  probeIonosSmtpConnectivity.mockImplementation(async (config) => {
    diagnosticCalls.push(config as { host: string; port: number });
    return DEFAULT_DIAGNOSTIC_RESULT;
  });
  implicitTlsDiagnosticCalls.length = 0;
  probeIonosSmtpImplicitTlsConnectivity.mockClear();
  probeIonosSmtpImplicitTlsConnectivity.mockImplementation(async (config) => {
    implicitTlsDiagnosticCalls.push(config as { host: string; port: number });
    return DEFAULT_IMPLICIT_TLS_RESULT;
  });
});

describe('storage-alert-receiver-entrypoint', () => {
  it('valid token + valid payload + successful send -> 2xx', async () => {
    const env = makeEnv();
    const res = await worker.fetch(post(`alert/${TOKEN}`, VALID_PAYLOAD), env);
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
    expect(sendStorageAlertViaIonosSmtp).toHaveBeenCalledTimes(1);
    expect(sentCalls).toHaveLength(1);
    expect(sentCalls[0].config.to).toBe('hello@siteborne.com');
  });

  it('uses the IONOS-subdomain sender, never the old apex sender', async () => {
    const env = makeEnv();
    const res = await worker.fetch(post(`alert/${TOKEN}`, VALID_PAYLOAD), env);
    expect(res.status).toBeLessThan(300);
    expect(sentCalls[0].config.from).toBe('storage@alerts.siteborne.net');
    expect(sentCalls[0].config.username).toBe('storage@alerts.siteborne.net');
    expect(sentCalls[0].config.from).not.toBe('storage-alert@siteborne.net');
  });

  it('targets smtp.ionos.com:587 and passes the env-sourced password through', async () => {
    const env = makeEnv();
    await worker.fetch(post(`alert/${TOKEN}`, VALID_PAYLOAD), env);
    expect(sentCalls[0].config.host).toBe('smtp.ionos.com');
    expect(sentCalls[0].config.port).toBe(587);
    expect(sentCalls[0].config.password).toBe(PASSWORD);
  });

  it('invalid token -> 404', async () => {
    const env = makeEnv();
    const res = await worker.fetch(post(`alert/${'b'.repeat(48)}`, VALID_PAYLOAD), env);
    expect(res.status).toBe(404);
    expect(sendStorageAlertViaIonosSmtp).not.toHaveBeenCalled();
  });

  it('missing token segment (wrong path) -> 404', async () => {
    const env = makeEnv();
    const res = await worker.fetch(post('alert/', VALID_PAYLOAD), env);
    expect(res.status).toBe(404);
    expect(sendStorageAlertViaIonosSmtp).not.toHaveBeenCalled();
  });

  it('unrelated path -> 404', async () => {
    const env = makeEnv();
    const res = await worker.fetch(post('health', VALID_PAYLOAD), env);
    expect(res.status).toBe(404);
  });

  it('token unprovisioned (env.ALERT_PATH_TOKEN undefined) fails closed -> 404', async () => {
    const env = makeEnv({ ALERT_PATH_TOKEN: undefined });
    const res = await worker.fetch(post(`alert/${TOKEN}`, VALID_PAYLOAD), env);
    expect(res.status).toBe(404);
    expect(sendStorageAlertViaIonosSmtp).not.toHaveBeenCalled();
  });

  it('SMTP password unprovisioned (env.IONOS_SMTP_PASSWORD undefined) fails closed -> 502, no connection attempted', async () => {
    const env = makeEnv({ IONOS_SMTP_PASSWORD: undefined });
    const res = await worker.fetch(post(`alert/${TOKEN}`, VALID_PAYLOAD), env);
    expect(res.status).toBe(502);
    expect(sendStorageAlertViaIonosSmtp).not.toHaveBeenCalled();
  });

  it('GET on the valid path -> non-2xx (404)', async () => {
    const env = makeEnv();
    const req = new Request(`https://storage-alert-receiver.example/alert/${TOKEN}`, {
      method: 'GET',
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(404);
    expect(res.status < 200 || res.status >= 300).toBe(true); // non-2xx
  });

  it('PUT on the valid path -> non-2xx (404)', async () => {
    const env = makeEnv();
    const req = new Request(`https://storage-alert-receiver.example/alert/${TOKEN}`, {
      method: 'PUT',
      body: JSON.stringify(VALID_PAYLOAD),
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(404);
  });

  it('malformed JSON -> 400', async () => {
    const env = makeEnv();
    const res = await worker.fetch(post(`alert/${TOKEN}`, '{not json'), env);
    expect(res.status).toBe(400);
    expect(sendStorageAlertViaIonosSmtp).not.toHaveBeenCalled();
  });

  it('oversized body -> 413', async () => {
    const env = makeEnv();
    const oversized = JSON.stringify({
      ...VALID_PAYLOAD,
      sample_content_hashes: Array.from({ length: 2000 }, (_, i) => `hash-${i}-`.padEnd(20, 'x')),
    });
    const res = await worker.fetch(post(`alert/${TOKEN}`, oversized), env);
    expect(res.status).toBe(413);
    expect(sendStorageAlertViaIonosSmtp).not.toHaveBeenCalled();
  });

  it('invalid payload schema (wrong event literal) -> 400', async () => {
    const env = makeEnv();
    const res = await worker.fetch(
      post(`alert/${TOKEN}`, { ...VALID_PAYLOAD, event: 'something.else' }),
      env
    );
    expect(res.status).toBe(400);
    expect(sendStorageAlertViaIonosSmtp).not.toHaveBeenCalled();
  });

  it('invalid payload schema (extra unexpected field, strict) -> 400', async () => {
    const env = makeEnv();
    const res = await worker.fetch(
      post(`alert/${TOKEN}`, { ...VALID_PAYLOAD, artifact_content: 'should not exist' }),
      env
    );
    expect(res.status).toBe(400);
  });

  it('invalid payload schema (negative count) -> 400', async () => {
    const env = makeEnv();
    const res = await worker.fetch(
      post(`alert/${TOKEN}`, { ...VALID_PAYLOAD, r2_delete_failures: -1 }),
      env
    );
    expect(res.status).toBe(400);
  });

  it('SMTP send failure -> non-2xx (502)', async () => {
    sendStorageAlertViaIonosSmtp.mockRejectedValueOnce(new Error('smtp failure'));
    const env = makeEnv();
    const res = await worker.fetch(post(`alert/${TOKEN}`, VALID_PAYLOAD), env);
    expect(res.status).toBe(502);
  });

  it('rendered envelope contains no prohibited fields and only approved content', async () => {
    const env = makeEnv();
    const res = await worker.fetch(post(`alert/${TOKEN}`, VALID_PAYLOAD), env);
    expect(res.status).toBeLessThan(300);
    const bodyText = sentCalls[0].envelope.bodyText;

    // Approved fields present.
    expect(bodyText).toContain('r2_delete_failures: 3');
    expect(bodyText).toContain('reclaimed_count: 12');
    expect(bodyText).toContain('2026-09-13T05:00:00.000Z');
    expect(bodyText).toContain('abc123');

    // Prohibited categories: never present because this payload shape
    // structurally cannot carry them, but assert explicitly so a future
    // schema/rendering change that accidentally introduces one of these
    // field names would fail this test.
    for (const prohibited of [
      'CDP_API_KEY',
      'payment',
      'settlement_tx',
      'signing_key',
      'buyer',
      'credential',
      'artifact_content',
      TOKEN,
      PASSWORD,
    ]) {
      expect(bodyText.toLowerCase()).not.toContain(prohibited.toLowerCase());
    }
  });

  it('response body never echoes the request body, token, or URL on any failure path', async () => {
    const env = makeEnv();
    const res = await worker.fetch(post(`alert/${'wrong'.repeat(10)}`, VALID_PAYLOAD), env);
    const text = await res.text();
    expect(text).toBe('');
  });
});

describe('storage-alert-receiver-entrypoint — SUN-1222C-SMTP-ROOT-CAUSE /diagnostic path', () => {
  it('valid token + successful probe -> 200 with the probe result as JSON, zero SMTP send attempted', async () => {
    const env = makeEnv();
    const res = await worker.fetch(post(`diagnostic/${TOKEN}`, undefined), env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(DEFAULT_DIAGNOSTIC_RESULT);
    expect(probeIonosSmtpConnectivity).toHaveBeenCalledTimes(1);
    expect(sendStorageAlertViaIonosSmtp).not.toHaveBeenCalled();
  });

  it('targets smtp.ionos.com:587, identically to the real send path', async () => {
    const env = makeEnv();
    await worker.fetch(post(`diagnostic/${TOKEN}`, undefined), env);
    expect(diagnosticCalls[0]).toEqual({ host: 'smtp.ionos.com', port: 587 });
  });

  it('failed probe -> 502 with the failure detail as JSON, zero SMTP send attempted', async () => {
    probeIonosSmtpConnectivity.mockResolvedValueOnce({
      ok: false,
      reachedStage: 'SMTP_GREETING',
      outcome: 'SMTP_GREETING_TIMEOUT',
      failedStage: 'SMTP_GREETING',
      timedOut: true,
      elapsedMsByStage: {},
      detail: 'timed out after 3000ms',
    });
    const env = makeEnv();
    const res = await worker.fetch(post(`diagnostic/${TOKEN}`, undefined), env);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.failedStage).toBe('SMTP_GREETING');
    expect(body.outcome).toBe('SMTP_GREETING_TIMEOUT');
    expect(sendStorageAlertViaIonosSmtp).not.toHaveBeenCalled();
  });

  it('never reads IONOS_SMTP_PASSWORD -- the probe still runs even when it is unprovisioned', async () => {
    const env = makeEnv({ IONOS_SMTP_PASSWORD: undefined });
    const res = await worker.fetch(post(`diagnostic/${TOKEN}`, undefined), env);
    expect(res.status).toBe(200); // unlike /alert/<token>, never fails closed on a missing SMTP password
    expect(probeIonosSmtpConnectivity).toHaveBeenCalledTimes(1);
  });

  it('invalid token on the diagnostic path -> identical 404, zero probe calls', async () => {
    const env = makeEnv();
    const res = await worker.fetch(post(`diagnostic/${'b'.repeat(48)}`, undefined), env);
    expect(res.status).toBe(404);
    expect(probeIonosSmtpConnectivity).not.toHaveBeenCalled();
  });

  it('missing token segment (wrong path) -> 404, zero probe calls', async () => {
    const env = makeEnv();
    const res = await worker.fetch(post('diagnostic/', undefined), env);
    expect(res.status).toBe(404);
    expect(probeIonosSmtpConnectivity).not.toHaveBeenCalled();
  });

  it('GET on the diagnostic path -> 404, zero probe calls', async () => {
    const req = new Request(`https://storage-alert-receiver.example/diagnostic/${TOKEN}`, {
      method: 'GET',
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(404);
    expect(probeIonosSmtpConnectivity).not.toHaveBeenCalled();
  });

  it('ALERT_PATH_TOKEN unprovisioned fails closed -> 404, zero probe calls', async () => {
    const env = makeEnv({ ALERT_PATH_TOKEN: undefined });
    const res = await worker.fetch(post(`diagnostic/${TOKEN}`, undefined), env);
    expect(res.status).toBe(404);
    expect(probeIonosSmtpConnectivity).not.toHaveBeenCalled();
  });

  it('reuses the same ALERT_PATH_TOKEN as the /alert path -- no second receiver-side secret required', async () => {
    const env = makeEnv();
    const alertRes = await worker.fetch(post(`alert/${TOKEN}`, VALID_PAYLOAD), env);
    const diagRes = await worker.fetch(post(`diagnostic/${TOKEN}`, undefined), env);
    expect(alertRes.status).toBeLessThan(300);
    expect(diagRes.status).toBe(200);
  });

  it('does not disturb the existing /alert path (both routes coexist)', async () => {
    const env = makeEnv();
    const res = await worker.fetch(post(`alert/${TOKEN}`, VALID_PAYLOAD), env);
    expect(res.status).toBeLessThan(300);
    expect(sendStorageAlertViaIonosSmtp).toHaveBeenCalledTimes(1);
    expect(probeIonosSmtpConnectivity).not.toHaveBeenCalled();
  });
});

describe('storage-alert-receiver-entrypoint — SUN-1222C-SMTP-ROOT-CAUSE /diagnostic path, ?mode=IONOS_IMPLICIT_TLS_465', () => {
  it('valid token + mode=IONOS_IMPLICIT_TLS_465 -> 200 with the implicit-TLS probe result, reaches only the implicit-TLS module', async () => {
    const env = makeEnv();
    const res = await worker.fetch(
      post(`diagnostic/${TOKEN}?mode=IONOS_IMPLICIT_TLS_465`, undefined),
      env
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(DEFAULT_IMPLICIT_TLS_RESULT);
    expect(probeIonosSmtpImplicitTlsConnectivity).toHaveBeenCalledTimes(1);
    expect(probeIonosSmtpConnectivity).not.toHaveBeenCalled();
    expect(sendStorageAlertViaIonosSmtp).not.toHaveBeenCalled();
  });

  it('targets smtp.ionos.com:465, not 587', async () => {
    const env = makeEnv();
    await worker.fetch(post(`diagnostic/${TOKEN}?mode=IONOS_IMPLICIT_TLS_465`, undefined), env);
    expect(implicitTlsDiagnosticCalls[0]).toEqual({ host: 'smtp.ionos.com', port: 465 });
  });

  it('no mode param -> unchanged 587 behavior, zero implicit-TLS calls', async () => {
    const env = makeEnv();
    await worker.fetch(post(`diagnostic/${TOKEN}`, undefined), env);
    expect(probeIonosSmtpConnectivity).toHaveBeenCalledTimes(1);
    expect(probeIonosSmtpImplicitTlsConnectivity).not.toHaveBeenCalled();
  });

  it('unrecognized mode value -> falls back to unchanged 587 behavior, zero implicit-TLS calls', async () => {
    const env = makeEnv();
    await worker.fetch(post(`diagnostic/${TOKEN}?mode=NOT_A_REAL_MODE`, undefined), env);
    expect(probeIonosSmtpConnectivity).toHaveBeenCalledTimes(1);
    expect(probeIonosSmtpImplicitTlsConnectivity).not.toHaveBeenCalled();
  });

  it('failed implicit-TLS probe -> 502 with the failure detail as JSON, zero SMTP send attempted', async () => {
    probeIonosSmtpImplicitTlsConnectivity.mockResolvedValueOnce({
      ok: false,
      reachedStage: 'IMPLICIT_TLS_CONNECT',
      outcome: 'IMPLICIT_TLS_CONNECT_TIMEOUT',
      failedStage: 'IMPLICIT_TLS_CONNECT',
      timedOut: true,
      elapsedMsByStage: {},
      detail: 'timed out after 3000ms',
    });
    const env = makeEnv();
    const res = await worker.fetch(
      post(`diagnostic/${TOKEN}?mode=IONOS_IMPLICIT_TLS_465`, undefined),
      env
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.failedStage).toBe('IMPLICIT_TLS_CONNECT');
    expect(sendStorageAlertViaIonosSmtp).not.toHaveBeenCalled();
  });

  it('wrong path token, implicit-TLS mode requested -> identical 404, zero probe calls of any kind', async () => {
    const env = makeEnv();
    const res = await worker.fetch(
      post(`diagnostic/${'b'.repeat(48)}?mode=IONOS_IMPLICIT_TLS_465`, undefined),
      env
    );
    expect(res.status).toBe(404);
    expect(probeIonosSmtpImplicitTlsConnectivity).not.toHaveBeenCalled();
    expect(probeIonosSmtpConnectivity).not.toHaveBeenCalled();
  });

  it('never reads IONOS_SMTP_PASSWORD on the implicit-TLS branch either', async () => {
    const env = makeEnv({ IONOS_SMTP_PASSWORD: undefined });
    const res = await worker.fetch(
      post(`diagnostic/${TOKEN}?mode=IONOS_IMPLICIT_TLS_465`, undefined),
      env
    );
    expect(res.status).toBe(200);
    expect(probeIonosSmtpImplicitTlsConnectivity).toHaveBeenCalledTimes(1);
  });
});

describe('storage-alert-receiver-entrypoint — SUN-1222C-SMTP-ROOT-CAUSE /control path (zero-network isolation controls)', () => {
  it('mode=IMMEDIATE -> 200 with a small elapsed_ms, zero probe/send calls', async () => {
    const env = makeEnv();
    const res = await worker.fetch(post(`control/${TOKEN}?mode=IMMEDIATE`, undefined), env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.control).toBe('IMMEDIATE');
    expect(body.result).toBe('OK');
    expect(typeof body.elapsed_ms).toBe('number');
    expect(probeIonosSmtpConnectivity).not.toHaveBeenCalled();
    expect(sendStorageAlertViaIonosSmtp).not.toHaveBeenCalled();
  });

  it('mode=DELAY_250MS -> 200 after an actual ~250ms async wait, zero probe/send calls', async () => {
    const env = makeEnv();
    const startedAt = Date.now();
    const res = await worker.fetch(post(`control/${TOKEN}?mode=DELAY_250MS`, undefined), env);
    const elapsedMs = Date.now() - startedAt;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.control).toBe('DELAY_250MS');
    expect(body.result).toBe('OK');
    expect(elapsedMs).toBeGreaterThanOrEqual(240); // real timer, small jitter margin
    expect(probeIonosSmtpConnectivity).not.toHaveBeenCalled();
    expect(sendStorageAlertViaIonosSmtp).not.toHaveBeenCalled();
  });

  it('mode=OVERALL_TIMEOUT -> 200, races the real withTimeout primitive against a never-resolving promise and reports TIMED_OUT_AS_EXPECTED, zero probe/send calls', async () => {
    const env = makeEnv();
    const res = await worker.fetch(post(`control/${TOKEN}?mode=OVERALL_TIMEOUT`, undefined), env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.control).toBe('OVERALL_TIMEOUT');
    expect(body.result).toBe('TIMED_OUT_AS_EXPECTED');
    expect(typeof body.elapsed_ms).toBe('number');
    expect(probeIonosSmtpConnectivity).not.toHaveBeenCalled();
    expect(sendStorageAlertViaIonosSmtp).not.toHaveBeenCalled();
  });

  it('mode=CLEANUP_HANG -> 200, races the real withTimeout primitive/CLEANUP_TIMEOUT_MS against two never-resolving stand-ins for reader.cancel()/socket.close() and still returns OK, zero probe/send calls', async () => {
    const env = makeEnv();
    const startedAt = Date.now();
    const res = await worker.fetch(post(`control/${TOKEN}?mode=CLEANUP_HANG`, undefined), env);
    const elapsedMs = Date.now() - startedAt;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.control).toBe('CLEANUP_HANG');
    expect(body.result).toBe('OK');
    expect(typeof body.elapsed_ms).toBe('number');
    // Proves the handler actually returned instead of hanging forever on
    // the never-resolving stand-ins -- bounded by the mocked
    // `CLEANUP_TIMEOUT_MS`, not by the test's own timeout.
    expect(elapsedMs).toBeLessThan(2000);
    expect(probeIonosSmtpConnectivity).not.toHaveBeenCalled();
    expect(sendStorageAlertViaIonosSmtp).not.toHaveBeenCalled();
  });

  it('missing mode -> 404, zero probe/send calls', async () => {
    const env = makeEnv();
    const res = await worker.fetch(post(`control/${TOKEN}`, undefined), env);
    expect(res.status).toBe(404);
    expect(probeIonosSmtpConnectivity).not.toHaveBeenCalled();
    expect(sendStorageAlertViaIonosSmtp).not.toHaveBeenCalled();
  });

  it('unrecognized mode -> 404, zero probe/send calls', async () => {
    const env = makeEnv();
    const res = await worker.fetch(post(`control/${TOKEN}?mode=BOGUS`, undefined), env);
    expect(res.status).toBe(404);
    expect(probeIonosSmtpConnectivity).not.toHaveBeenCalled();
    expect(sendStorageAlertViaIonosSmtp).not.toHaveBeenCalled();
  });

  it('wrong token -> identical 404, zero probe/send calls', async () => {
    const env = makeEnv();
    const res = await worker.fetch(
      post(`control/${'b'.repeat(48)}?mode=IMMEDIATE`, undefined),
      env
    );
    expect(res.status).toBe(404);
    expect(probeIonosSmtpConnectivity).not.toHaveBeenCalled();
    expect(sendStorageAlertViaIonosSmtp).not.toHaveBeenCalled();
  });

  it('GET on the control path -> 404, zero probe/send calls', async () => {
    const req = new Request(
      `https://storage-alert-receiver.example/control/${TOKEN}?mode=IMMEDIATE`,
      { method: 'GET' }
    );
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(404);
    expect(probeIonosSmtpConnectivity).not.toHaveBeenCalled();
    expect(sendStorageAlertViaIonosSmtp).not.toHaveBeenCalled();
  });

  it('ALERT_PATH_TOKEN unprovisioned fails closed -> 404', async () => {
    const env = makeEnv({ ALERT_PATH_TOKEN: undefined });
    const res = await worker.fetch(post(`control/${TOKEN}?mode=IMMEDIATE`, undefined), env);
    expect(res.status).toBe(404);
  });

  it('control path never reads IONOS_SMTP_PASSWORD', async () => {
    const env = makeEnv({ IONOS_SMTP_PASSWORD: undefined });
    const res = await worker.fetch(post(`control/${TOKEN}?mode=IMMEDIATE`, undefined), env);
    expect(res.status).toBe(200);
  });

  it('reuses the same ALERT_PATH_TOKEN as /alert and /diagnostic -- no third receiver-side secret required', async () => {
    const env = makeEnv();
    const res = await worker.fetch(post(`control/${TOKEN}?mode=IMMEDIATE`, undefined), env);
    expect(res.status).toBe(200);
  });
});
