/**
 * SUN-1222C-R4 — tests for the TEMPORARY
 * `POST /internal/storage-alert-qualification` qualification route.
 *
 * Proves: uniform fail-closed `404` (with zero Service Binding
 * invocation) for every invalid request shape; exactly one call to the
 * real `buildServiceBindingStorageAlertTransport` production transport for
 * a valid request, carrying a fully server-generated, zero-real-failure
 * payload; a sanitized `502` (no secret/detail leakage) on transport
 * failure with no automatic retry; and that no other registered route is
 * disturbed by this addition.
 */
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env';
import { storageAlertQualificationRoute } from './storage-alert-qualification-route';
import * as transportModule from '../alerting/storage-alert-service-binding-transport';

const QUALIFICATION_TOKEN = 'qualification-token-abc123';
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
    STORAGE_ALERT_QUALIFICATION_TOKEN: QUALIFICATION_TOKEN,
    STORAGE_ALERT_RECEIVER: receiver as unknown as Env['STORAGE_ALERT_RECEIVER'],
    STORAGE_ALERT_PATH_TOKEN: PATH_TOKEN,
    ...overrides,
  });
  return { env, receiver };
}

function appWithRoute(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.post('/internal/storage-alert-qualification', storageAlertQualificationRoute);
  return app;
}

const OK_RECEIVER = async () => new Response(null, { status: 202 });

describe('storageAlertQualificationRoute', () => {
  it('returns 404 for GET (method not registered) with zero receiver calls', async () => {
    const app = appWithRoute();
    const { env, receiver } = fullyProvisionedEnv(OK_RECEIVER);
    const res = await app.request('/internal/storage-alert-qualification', { method: 'GET' }, env);
    expect(res.status).toBe(404);
    expect(receiver.fetch).not.toHaveBeenCalled();
  });

  it('returns 404 with no Authorization header, zero receiver calls', async () => {
    const app = appWithRoute();
    const { env, receiver } = fullyProvisionedEnv(OK_RECEIVER);
    const res = await app.request('/internal/storage-alert-qualification', { method: 'POST' }, env);
    expect(res.status).toBe(404);
    expect(receiver.fetch).not.toHaveBeenCalled();
  });

  it('returns 404 for a malformed bearer header (missing "Bearer " prefix), zero receiver calls', async () => {
    const app = appWithRoute();
    const { env, receiver } = fullyProvisionedEnv(OK_RECEIVER);
    const res = await app.request(
      '/internal/storage-alert-qualification',
      { method: 'POST', headers: { Authorization: QUALIFICATION_TOKEN } },
      env
    );
    expect(res.status).toBe(404);
    expect(receiver.fetch).not.toHaveBeenCalled();
  });

  it('returns 404 for the wrong bearer token, zero receiver calls', async () => {
    const app = appWithRoute();
    const { env, receiver } = fullyProvisionedEnv(OK_RECEIVER);
    const res = await app.request(
      '/internal/storage-alert-qualification',
      { method: 'POST', headers: { Authorization: 'Bearer wrong-token' } },
      env
    );
    expect(res.status).toBe(404);
    expect(receiver.fetch).not.toHaveBeenCalled();
  });

  it('returns 404 when STORAGE_ALERT_QUALIFICATION_TOKEN is unprovisioned, zero receiver calls', async () => {
    const app = appWithRoute();
    const { env, receiver } = fullyProvisionedEnv(OK_RECEIVER, {
      STORAGE_ALERT_QUALIFICATION_TOKEN: undefined,
    });
    const res = await app.request(
      '/internal/storage-alert-qualification',
      { method: 'POST', headers: { Authorization: `Bearer ${QUALIFICATION_TOKEN}` } },
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
      '/internal/storage-alert-qualification',
      { method: 'POST', headers: { Authorization: `Bearer ${QUALIFICATION_TOKEN}` } },
      env
    );
    expect(res.status).toBe(404);
    expect(receiver.fetch).not.toHaveBeenCalled();
  });

  it('calls the real Service Binding transport exactly once for a valid request and returns 202', async () => {
    const app = appWithRoute();
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const { env, receiver } = fullyProvisionedEnv(async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(null, { status: 202 });
    });
    const transportSpy = vi.spyOn(transportModule, 'buildServiceBindingStorageAlertTransport');

    const res = await app.request(
      '/internal/storage-alert-qualification',
      { method: 'POST', headers: { Authorization: `Bearer ${QUALIFICATION_TOKEN}` } },
      env
    );

    expect(res.status).toBe(202);
    expect(receiver.fetch).toHaveBeenCalledTimes(1);
    expect(transportSpy).toHaveBeenCalledTimes(1);
    // Real production transport constructor, real receiver binding, real path
    // token, and (SUN-1222C receiver-side delivery containment) the
    // qualification-bypass header forwarded only after this route's own
    // bearer authentication above already succeeded.
    expect(transportSpy).toHaveBeenCalledWith(receiver, PATH_TOKEN, {
      extraHeaders: { 'X-Siteborne-Storage-Alert-Qualification': QUALIFICATION_TOKEN },
    });
    expect(capturedUrl).toBe(`https://storage-alert.internal/alert/${PATH_TOKEN}`);
    expect(
      (capturedInit?.headers as Record<string, string>)['X-Siteborne-Storage-Alert-Qualification']
    ).toBe(QUALIFICATION_TOKEN);

    const body = JSON.parse(capturedInit?.body as string);
    expect(body.event).toBe('siteborne.storage_reclamation.critical_alert');
    expect(body.operation_class).toBe('artifact_reclamation_r2_delete_failure');
    expect(body.r2_delete_failures).toBe(0);
    expect(body.reclaimed_count).toBe(0);
    expect(typeof body.swept_at).toBe('string');
    expect(() => new Date(body.swept_at).toISOString()).not.toThrow();
    expect(body.sample_content_hashes).toHaveLength(1);
    expect(body.sample_content_hashes[0]).toMatch(
      /^SITEBORNE-SMTP-PRODUCTION-QUALIFICATION-[0-9a-f-]{36}$/
    );

    transportSpy.mockRestore();
  });

  it('produces a fresh unique marker on every call (server-generated, not caller-controlled)', async () => {
    const app = appWithRoute();
    const seen: string[] = [];
    const { env } = fullyProvisionedEnv(async (_url, init) => {
      const body = JSON.parse((init?.body as string) ?? '{}');
      seen.push(body.sample_content_hashes[0]);
      return new Response(null, { status: 202 });
    });

    await app.request(
      '/internal/storage-alert-qualification',
      { method: 'POST', headers: { Authorization: `Bearer ${QUALIFICATION_TOKEN}` } },
      env
    );
    await app.request(
      '/internal/storage-alert-qualification',
      { method: 'POST', headers: { Authorization: `Bearer ${QUALIFICATION_TOKEN}` } },
      env
    );

    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]);
  });

  it('ignores any caller-supplied request body entirely', async () => {
    const app = appWithRoute();
    let capturedInit: RequestInit | undefined;
    const { env } = fullyProvisionedEnv(async (_url, init) => {
      capturedInit = init;
      return new Response(null, { status: 202 });
    });

    await app.request(
      '/internal/storage-alert-qualification',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${QUALIFICATION_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ r2_delete_failures: 999999, evil: true }),
      },
      env
    );

    const body = JSON.parse(capturedInit?.body as string);
    expect(body.r2_delete_failures).toBe(0);
    expect(body).not.toHaveProperty('evil');
  });

  it('returns a sanitized 502 (no secret/detail leakage) when the transport reports delivered=false, with no retry', async () => {
    const app = appWithRoute();
    const { env, receiver } = fullyProvisionedEnv(async () => new Response(null, { status: 502 }));

    const res = await app.request(
      '/internal/storage-alert-qualification',
      { method: 'POST', headers: { Authorization: `Bearer ${QUALIFICATION_TOKEN}` } },
      env
    );

    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).toBe('');
    expect(receiver.fetch).toHaveBeenCalledTimes(1); // exactly one attempt, no retry
  });

  it('returns a sanitized 502 when the Service Binding dispatch itself throws', async () => {
    const app = appWithRoute();
    const { env, receiver } = fullyProvisionedEnv(async () => {
      throw new Error('service binding dispatch failed: internal detail should not leak');
    });

    const res = await app.request(
      '/internal/storage-alert-qualification',
      { method: 'POST', headers: { Authorization: `Bearer ${QUALIFICATION_TOKEN}` } },
      env
    );

    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).toBe('');
    expect(text).not.toContain('internal detail');
    expect(receiver.fetch).toHaveBeenCalledTimes(1);
  });

  it('never echoes the qualification token or the path token in any response', async () => {
    const app = appWithRoute();
    const { env } = fullyProvisionedEnv(OK_RECEIVER);

    const res = await app.request(
      '/internal/storage-alert-qualification',
      { method: 'POST', headers: { Authorization: `Bearer ${QUALIFICATION_TOKEN}` } },
      env
    );
    const text = await res.text();
    expect(text).not.toContain(QUALIFICATION_TOKEN);
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
