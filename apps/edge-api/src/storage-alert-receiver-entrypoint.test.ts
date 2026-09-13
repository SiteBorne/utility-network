import { beforeEach, describe, expect, it, vi } from 'vitest';

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
