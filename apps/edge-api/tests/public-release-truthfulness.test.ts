import { readFile } from 'node:fs/promises';
import { describe, expect, it, beforeAll } from 'vitest';
import { app } from '../src/index';

async function generateTestPrivateJwkJson(): Promise<string> {
  const keyPair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  return JSON.stringify(await crypto.subtle.exportKey('jwk', keyPair.privateKey));
}

describe('truthful public release state', () => {
  let privateKey: string;

  beforeAll(async () => {
    privateKey = await generateTestPrivateJwkJson();
  });

  function productionEnv(overrides: Record<string, unknown> = {}) {
    return {
      ENVIRONMENT: 'production',
      DB: {},
      PAID_ROUTES_ENABLED: 'false',
      AGENT_CARD_SIGNING_PRIVATE_KEY: privateKey,
      AGENT_CARD_SIGNING_KEY_ID: 'siteborne-agent-card-test',
      ...overrides,
    };
  }

  it('reports the healthy production public runtime ready while paid routes remain disabled', async () => {
    const response = await app.request('/ready', {}, productionEnv() as never);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: 'ready',
      phase: 'production',
      production_services_enabled: false,
      blocked_external: [],
    });
    expect(body.reason).toBe('Public production runtime ready; paid services disabled by policy.');
  });

  it('derives the utility root identity from the same release state without stale labels', async () => {
    const response = await app.request('/', {}, productionEnv() as never);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.status).toBe('ready');
    expect(JSON.stringify(body).toLowerCase()).not.toMatch(/foundation|preproduction/);
  });

  it('fails readiness when the required public D1 binding is missing', async () => {
    const env = productionEnv();
    delete env.DB;
    const response = await app.request('/ready', {}, env as never);
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.status).toBe('not_ready');
    expect(body.phase).toBe('production');
    expect(body.blocked_external).toEqual(['database_binding_missing']);
  });

  it('fails readiness when the production signing identity is absent', async () => {
    const env = productionEnv();
    delete env.AGENT_CARD_SIGNING_PRIVATE_KEY;
    delete env.AGENT_CARD_SIGNING_KEY_ID;
    const response = await app.request('/ready', {}, env as never);
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.status).toBe('not_ready');
    expect(body.blocked_external).toEqual(['agent_card_signing_identity_missing']);
  });

  it('fails readiness on a partial or malformed signing identity', async () => {
    for (const env of [
      productionEnv({ AGENT_CARD_SIGNING_PRIVATE_KEY: undefined }),
      productionEnv({ AGENT_CARD_SIGNING_PRIVATE_KEY: 'not-json' }),
    ]) {
      const response = await app.request('/ready', {}, env as never);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.status).toBe('not_ready');
      expect(body.blocked_external).toEqual(['agent_card_signing_identity_invalid']);
    }
  });

  it('fails safely for missing or unknown release environment configuration', async () => {
    for (const environment of [undefined, 'staging', 'PRODUCTION']) {
      const response = await app.request(
        '/ready',
        {},
        productionEnv({ ENVIRONMENT: environment }) as never
      );
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.status).toBe('not_ready');
      expect(body.phase).toBe('unconfigured');
      expect(body.blocked_external).toEqual(['production_environment_not_configured']);
    }
  });

  it('removes the static apex placeholder foundation claims without activating payments', async () => {
    const html = await readFile(new URL('../../network-site/index.html', import.meta.url), 'utf8');
    const renderedText = html.replace(/\s+/g, ' ');
    expect(html.toLowerCase()).not.toMatch(/preproduction foundation|protocols \(planned\)/);
    expect(renderedText).toContain('Production public runtime');
    expect(renderedText).toContain('Paid services are disabled by policy');
    expect(renderedText).not.toContain(
      'No payment endpoints, registry entries, or live services exist yet.'
    );
  });
});
