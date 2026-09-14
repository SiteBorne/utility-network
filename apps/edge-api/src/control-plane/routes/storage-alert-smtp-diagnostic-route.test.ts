/**
 * SUN-1222C-SMTP-ROOT-CAUSE — tests for the TEMPORARY
 * `POST /internal/storage-alert-smtp-diagnostic` route.
 *
 * Proves: uniform fail-closed `404` (with zero Service Binding
 * invocation) for every invalid request shape; exactly one Service
 * Binding call to the receiver's `/diagnostic/<path-token>` path for a
 * valid request; the receiver's JSON diagnostic body is forwarded
 * verbatim; a sanitized `502` on Service Binding dispatch failure; and
 * that this route's own bearer secret is entirely independent of
 * `STORAGE_ALERT_QUALIFICATION_TOKEN`.
 */
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env';
import { storageAlertSmtpDiagnosticRoute } from './storage-alert-smtp-diagnostic-route';

const DIAGNOSTIC_TOKEN = 'diagnostic-token-abc123';
const QUALIFICATION_TOKEN = 'qualification-token-should-never-work-here';
const PATH_TOKEN = 'receiver-path-token-xyz789';

function baseEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as Env['DB'],
    ARTIFACTS: {} as Env['ARTIFACTS'],
    JOBS: {} as Env['JOBS'],
    EVENTS: {} as Env['EVENTS'],
    CATALOG: {} as Env['CATALOG'],
    AI: {} as Env['AI'],
    BROWSER: {} as Env['BROWSER'],
    ENVIRONMENT: 'production',
    LOG_LEVEL: 'info',
    PCC_VERSION: '1.0.0',
    SELLER_WALLET_ADDRESS: '0x' + '1'.repeat(40),
    CDP_API_KEY_ID: 'cdp-key-id',
    CDP_API_KEY_SECRET: 'cdp-key-secret',
    VOYAGE_API_KEY: 'voyage-key',
    MODAL_TOKEN_ID: 'modal-token-id',
    MODAL_TOKEN_SECRET: 'modal-token-secret',
    SENTRY_DSN: 'https://example.invalid/sentry',
    ...overrides,
  };
}

function fakeReceiver(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  return { fetch: vi.fn(handler) };
}

function fullyProvisionedEnv(
  receiverHandler: (url: string, init?: RequestInit) => Promise<Response>,
  overrides: Partial<Env> = {}
) {
  const receiver = fakeReceiver(receiverHandler);
  const env = baseEnv({
    STORAGE_ALERT_SMTP_DIAGNOSTIC_TOKEN: DIAGNOSTIC_TOKEN,
    STORAGE_ALERT_RECEIVER: receiver as unknown as Env['STORAGE_ALERT_RECEIVER'],
    STORAGE_ALERT_PATH_TOKEN: PATH_TOKEN,
    ...overrides,
  });
  return { env, receiver };
}

function appWithRoute(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.post('/internal/storage-alert-smtp-diagnostic', storageAlertSmtpDiagnosticRoute);
  return app;
}

const DIAGNOSTIC_RESULT_JSON = JSON.stringify({
  ok: true,
  reachedStage: 'DIAG_COMPLETE',
  timedOut: false,
  elapsedMsByStage: { DIAG_GREETING: 12 },
});
const OK_RECEIVER = async () =>
  new Response(DIAGNOSTIC_RESULT_JSON, {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('storageAlertSmtpDiagnosticRoute', () => {
  it('returns 404 for GET (method not registered) with zero receiver calls', async () => {
    const app = appWithRoute();
    const { env, receiver } = fullyProvisionedEnv(OK_RECEIVER);
    const res = await app.request(
      '/internal/storage-alert-smtp-diagnostic',
      { method: 'GET' },
      env
    );
    expect(res.status).toBe(404);
    expect(receiver.fetch).not.toHaveBeenCalled();
  });

  it('returns 404 with no Authorization header, zero receiver calls', async () => {
    const app = appWithRoute();
    const { env, receiver } = fullyProvisionedEnv(OK_RECEIVER);
    const res = await app.request(
      '/internal/storage-alert-smtp-diagnostic',
      { method: 'POST' },
      env
    );
    expect(res.status).toBe(404);
    expect(receiver.fetch).not.toHaveBeenCalled();
  });

  it('returns 404 for the wrong bearer token, zero receiver calls', async () => {
    const app = appWithRoute();
    const { env, receiver } = fullyProvisionedEnv(OK_RECEIVER);
    const res = await app.request(
      '/internal/storage-alert-smtp-diagnostic',
      { method: 'POST', headers: { Authorization: 'Bearer wrong-token' } },
      env
    );
    expect(res.status).toBe(404);
    expect(receiver.fetch).not.toHaveBeenCalled();
  });

  it('the qualification token never works on this route (separate secrets)', async () => {
    const app = appWithRoute();
    const { env, receiver } = fullyProvisionedEnv(OK_RECEIVER);
    const res = await app.request(
      '/internal/storage-alert-smtp-diagnostic',
      { method: 'POST', headers: { Authorization: `Bearer ${QUALIFICATION_TOKEN}` } },
      env
    );
    expect(res.status).toBe(404);
    expect(receiver.fetch).not.toHaveBeenCalled();
  });

  it('returns 404 when STORAGE_ALERT_SMTP_DIAGNOSTIC_TOKEN is unprovisioned, zero receiver calls', async () => {
    const app = appWithRoute();
    const { env, receiver } = fullyProvisionedEnv(OK_RECEIVER, {
      STORAGE_ALERT_SMTP_DIAGNOSTIC_TOKEN: undefined,
    });
    const res = await app.request(
      '/internal/storage-alert-smtp-diagnostic',
      { method: 'POST', headers: { Authorization: `Bearer ${DIAGNOSTIC_TOKEN}` } },
      env
    );
    expect(res.status).toBe(404);
    expect(receiver.fetch).not.toHaveBeenCalled();
  });

  it('returns 404 when the Service Binding or path token is unprovisioned, zero receiver calls', async () => {
    const app = appWithRoute();
    const { env, receiver } = fullyProvisionedEnv(OK_RECEIVER, {
      STORAGE_ALERT_RECEIVER: undefined,
    });
    const res = await app.request(
      '/internal/storage-alert-smtp-diagnostic',
      { method: 'POST', headers: { Authorization: `Bearer ${DIAGNOSTIC_TOKEN}` } },
      env
    );
    expect(res.status).toBe(404);
    expect(receiver.fetch).not.toHaveBeenCalled();
  });

  it('calls the receiver diagnostic path exactly once for a valid request and forwards its JSON body', async () => {
    const app = appWithRoute();
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const { env, receiver } = fullyProvisionedEnv(async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(DIAGNOSTIC_RESULT_JSON, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const res = await app.request(
      '/internal/storage-alert-smtp-diagnostic',
      { method: 'POST', headers: { Authorization: `Bearer ${DIAGNOSTIC_TOKEN}` } },
      env
    );

    expect(res.status).toBe(200);
    expect(receiver.fetch).toHaveBeenCalledTimes(1);
    expect(capturedUrl).toBe(`https://storage-alert.internal/diagnostic/${PATH_TOKEN}`);
    expect(capturedInit?.method).toBe('POST');
    const body = await res.json();
    expect(body).toEqual(JSON.parse(DIAGNOSTIC_RESULT_JSON));
  });

  it('forwards a non-2xx receiver status (e.g. a timed-out probe) verbatim, with no retry', async () => {
    const app = appWithRoute();
    const failureJson = JSON.stringify({
      ok: false,
      reachedStage: 'DIAG_GREETING',
      failedStage: 'DIAG_GREETING',
      timedOut: true,
      elapsedMsByStage: {},
      detail: 'timed out after 3000ms',
    });
    const { env, receiver } = fullyProvisionedEnv(
      async () =>
        new Response(failureJson, { status: 502, headers: { 'content-type': 'application/json' } })
    );

    const res = await app.request(
      '/internal/storage-alert-smtp-diagnostic',
      { method: 'POST', headers: { Authorization: `Bearer ${DIAGNOSTIC_TOKEN}` } },
      env
    );

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.failedStage).toBe('DIAG_GREETING');
    expect(receiver.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns a sanitized 502 when the Service Binding dispatch itself throws', async () => {
    const app = appWithRoute();
    const { env, receiver } = fullyProvisionedEnv(async () => {
      throw new Error('service binding dispatch failed: internal detail should not leak');
    });

    const res = await app.request(
      '/internal/storage-alert-smtp-diagnostic',
      { method: 'POST', headers: { Authorization: `Bearer ${DIAGNOSTIC_TOKEN}` } },
      env
    );

    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).toBe('');
    expect(text).not.toContain('internal detail');
    expect(receiver.fetch).toHaveBeenCalledTimes(1);
  });

  it('never echoes the diagnostic token or the path token in any response', async () => {
    const app = appWithRoute();
    const { env } = fullyProvisionedEnv(OK_RECEIVER);

    const res = await app.request(
      '/internal/storage-alert-smtp-diagnostic',
      { method: 'POST', headers: { Authorization: `Bearer ${DIAGNOSTIC_TOKEN}` } },
      env
    );
    const text = await res.text();
    expect(text).not.toContain(DIAGNOSTIC_TOKEN);
    expect(text).not.toContain(PATH_TOKEN);
  });

  it('does not disturb an unrelated existing route mounted on the same app', async () => {
    const app = appWithRoute();
    app.get('/health/other', (c) => c.json({ ok: true }));
    const { env } = fullyProvisionedEnv(OK_RECEIVER);

    const res = await app.request('/health/other', { method: 'GET' }, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe('storageAlertSmtpDiagnosticRoute — SUN-1222C-SMTP-ROOT-CAUSE ?mode= zero-network control forwarding', () => {
  it('?mode=IMMEDIATE forwards to the receiver /control path (not /diagnostic) and merges caller_elapsed_ms', async () => {
    const app = appWithRoute();
    let capturedUrl = '';
    const { env, receiver } = fullyProvisionedEnv(async (url) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ control: 'IMMEDIATE', result: 'OK', elapsed_ms: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const res = await app.request(
      '/internal/storage-alert-smtp-diagnostic?mode=IMMEDIATE',
      { method: 'POST', headers: { Authorization: `Bearer ${DIAGNOSTIC_TOKEN}` } },
      env
    );

    expect(res.status).toBe(200);
    expect(receiver.fetch).toHaveBeenCalledTimes(1);
    expect(capturedUrl).toBe(`https://storage-alert.internal/control/${PATH_TOKEN}?mode=IMMEDIATE`);
    const body = await res.json();
    expect(body.control).toBe('IMMEDIATE');
    expect(body.result).toBe('OK');
    expect(body.receiver_elapsed_ms).toBe(1);
    expect(typeof body.caller_elapsed_ms).toBe('number');
  });

  it('?mode=DELAY_250MS forwards to the receiver /control path with that mode', async () => {
    const app = appWithRoute();
    let capturedUrl = '';
    const { env } = fullyProvisionedEnv(async (url) => {
      capturedUrl = url;
      return new Response(
        JSON.stringify({ control: 'DELAY_250MS', result: 'OK', elapsed_ms: 251 }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    });

    const res = await app.request(
      '/internal/storage-alert-smtp-diagnostic?mode=DELAY_250MS',
      { method: 'POST', headers: { Authorization: `Bearer ${DIAGNOSTIC_TOKEN}` } },
      env
    );

    expect(res.status).toBe(200);
    expect(capturedUrl).toBe(
      `https://storage-alert.internal/control/${PATH_TOKEN}?mode=DELAY_250MS`
    );
    const body = await res.json();
    expect(body.receiver_elapsed_ms).toBe(251);
  });

  it('?mode=OVERALL_TIMEOUT forwards to the receiver /control path with that mode', async () => {
    const app = appWithRoute();
    let capturedUrl = '';
    const { env } = fullyProvisionedEnv(async (url) => {
      capturedUrl = url;
      return new Response(
        JSON.stringify({
          control: 'OVERALL_TIMEOUT',
          result: 'TIMED_OUT_AS_EXPECTED',
          elapsed_ms: 8003,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    });

    const res = await app.request(
      '/internal/storage-alert-smtp-diagnostic?mode=OVERALL_TIMEOUT',
      { method: 'POST', headers: { Authorization: `Bearer ${DIAGNOSTIC_TOKEN}` } },
      env
    );

    expect(res.status).toBe(200);
    expect(capturedUrl).toBe(
      `https://storage-alert.internal/control/${PATH_TOKEN}?mode=OVERALL_TIMEOUT`
    );
    const body = await res.json();
    expect(body.result).toBe('TIMED_OUT_AS_EXPECTED');
    expect(body.receiver_elapsed_ms).toBe(8003);
    expect(typeof body.caller_elapsed_ms).toBe('number');
  });

  it('?mode=CLEANUP_HANG forwards to the receiver /control path with that mode', async () => {
    const app = appWithRoute();
    let capturedUrl = '';
    const { env } = fullyProvisionedEnv(async (url) => {
      capturedUrl = url;
      return new Response(
        JSON.stringify({ control: 'CLEANUP_HANG', result: 'OK', elapsed_ms: 1002 }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    });

    const res = await app.request(
      '/internal/storage-alert-smtp-diagnostic?mode=CLEANUP_HANG',
      { method: 'POST', headers: { Authorization: `Bearer ${DIAGNOSTIC_TOKEN}` } },
      env
    );

    expect(res.status).toBe(200);
    expect(capturedUrl).toBe(
      `https://storage-alert.internal/control/${PATH_TOKEN}?mode=CLEANUP_HANG`
    );
    const body = await res.json();
    expect(body.result).toBe('OK');
    expect(body.receiver_elapsed_ms).toBe(1002);
    expect(typeof body.caller_elapsed_ms).toBe('number');
  });

  it('an unrecognized ?mode= value is ignored -- falls back to the real /diagnostic path, unchanged', async () => {
    const app = appWithRoute();
    let capturedUrl = '';
    const { env } = fullyProvisionedEnv(async (url) => {
      capturedUrl = url;
      return OK_RECEIVER();
    });

    const res = await app.request(
      '/internal/storage-alert-smtp-diagnostic?mode=BOGUS',
      { method: 'POST', headers: { Authorization: `Bearer ${DIAGNOSTIC_TOKEN}` } },
      env
    );

    expect(res.status).toBe(200);
    expect(capturedUrl).toBe(`https://storage-alert.internal/diagnostic/${PATH_TOKEN}`);
    const body = await res.json();
    expect(body).toEqual(JSON.parse(DIAGNOSTIC_RESULT_JSON));
  });

  it('no ?mode= at all still exercises the original, unchanged real-diagnostic forwarding', async () => {
    const app = appWithRoute();
    let capturedUrl = '';
    const { env } = fullyProvisionedEnv(async (url) => {
      capturedUrl = url;
      return OK_RECEIVER();
    });

    const res = await app.request(
      '/internal/storage-alert-smtp-diagnostic',
      { method: 'POST', headers: { Authorization: `Bearer ${DIAGNOSTIC_TOKEN}` } },
      env
    );

    expect(res.status).toBe(200);
    expect(capturedUrl).toBe(`https://storage-alert.internal/diagnostic/${PATH_TOKEN}`);
  });

  it('a control-mode request still returns a sanitized, JSON-shaped 502 on Service Binding dispatch failure, with caller_elapsed_ms and no leaked detail', async () => {
    const app = appWithRoute();
    const { env, receiver } = fullyProvisionedEnv(async () => {
      throw new Error('service binding dispatch failed: internal detail should not leak');
    });

    const res = await app.request(
      '/internal/storage-alert-smtp-diagnostic?mode=IMMEDIATE',
      { method: 'POST', headers: { Authorization: `Bearer ${DIAGNOSTIC_TOKEN}` } },
      env
    );

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.control).toBe('IMMEDIATE');
    expect(body.result).toBe('CALLER_TIMEOUT_OR_DISPATCH_FAILURE');
    expect(typeof body.caller_elapsed_ms).toBe('number');
    expect(JSON.stringify(body)).not.toContain('internal detail');
    expect(receiver.fetch).toHaveBeenCalledTimes(1);
  });

  it('still fails closed with zero receiver calls for an invalid bearer even with ?mode= present', async () => {
    const app = appWithRoute();
    const { env, receiver } = fullyProvisionedEnv(OK_RECEIVER);
    const res = await app.request(
      '/internal/storage-alert-smtp-diagnostic?mode=IMMEDIATE',
      { method: 'POST' },
      env
    );
    expect(res.status).toBe(404);
    expect(receiver.fetch).not.toHaveBeenCalled();
  });
});
