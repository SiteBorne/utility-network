import { describe, it, expect } from 'vitest';
import { app } from '../src/index';
import { validateHealthResponse, validateReadinessResponse } from '@siteborne/contracts';
import { SITEBORNE_SERVICE_IDS } from '@siteborne/protocol-a2a';

describe('apps/edge-api - foundation endpoints', () => {
  describe('GET /', () => {
    it('returns network identity', async () => {
      const res = await app.request('/');
      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.name).toBe('SITEBORNE Utility Network');
      expect(json.domains).toEqual(
        expect.objectContaining({
          machine: 'siteborne.net',
          production_origin: 'utility.siteborne.net',
        })
      );
      expect(json.standard).toBe('Proof-Carrying Context v1.0.0');
      expect(json.status).toBe('not_ready');
      expect(String(json.status)).not.toMatch(/foundation|preproduction/);
      expect(Array.isArray(json.services)).toBe(true);
      expect(json.services).toEqual(SITEBORNE_SERVICE_IDS);
    });
  });

  describe('GET /health', () => {
    it('returns ok status with timestamp', async () => {
      const res = await app.request('/health');
      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.status).toBe('ok');
      expect(json.timestamp).toBeDefined();
      expect(json.version).toBe('0.0.0');
      expect(typeof json.uptime_seconds).toBe('number');
    });

    it('response matches HealthResponseSchema', async () => {
      const res = await app.request('/health');
      const json = (await res.json()) as Record<string, unknown>;
      const validated = validateHealthResponse(json);
      expect(validated.status).toBe('ok');
      expect(new Date(validated.timestamp).toString()).not.toBe('Invalid Date');
    });
  });

  describe('GET /ready', () => {
    it('returns not_ready in unconfigured phase without runtime bindings', async () => {
      const res = await app.request('/ready');
      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.status).toBe('not_ready');
      expect(json.phase).toBe('unconfigured');
      expect(json.production_services_enabled).toBe(false);
      expect(Array.isArray(json.blocked_external)).toBe(true);
      expect(json.blocked_external).toEqual(['production_environment_not_configured']);
      expect(json.reason).toBeDefined();
    });

    it('response matches ReadinessResponseSchema', async () => {
      const res = await app.request('/ready');
      const json = (await res.json()) as Record<string, unknown>;
      const validated = validateReadinessResponse(json);
      expect(['ready', 'not_ready']).toContain(validated.status);
      expect(typeof validated.production_services_enabled).toBe('boolean');
    });
  });
});
