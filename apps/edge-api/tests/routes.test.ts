import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { catalogRoute } from '../src/control-plane/routes/catalog';
import { serviceMetadataRoute } from '../src/control-plane/routes/catalog';
import { schemasRoute } from '../src/control-plane/routes/catalog';
import { openapiRoute } from '../src/control-plane/routes/catalog';
import { healthRoute } from '../src/routes/health';
import { readinessRoute } from '../src/routes/readiness';
import { InMemoryServicesRepository } from '../src/control-plane/repositories/in-memory';
import { ServiceMetadata } from '../src/control-plane/types';

describe('Control Plane Routes', () => {
  let app: Hono;
  let servicesRepo: InMemoryServicesRepository;

  beforeEach(() => {
    servicesRepo = new InMemoryServicesRepository();
    app = new Hono();
    app.use('*', async (c, next) => {
      c.set('servicesRepo', servicesRepo);
      await next();
    });
    app.route('/catalog', catalogRoute);
    app.route('/services', serviceMetadataRoute);
    app.route('/schemas', schemasRoute);
    app.route('/', openapiRoute);
  });

  it('GET /catalog returns service catalog', async () => {
    const service: ServiceMetadata = {
      service_id: 'company_evidence_graph.v1',
      version: '1.0.0',
      title: 'Company Evidence Graph',
      description: 'Verify company evidence',
      price_usd: '0.039',
      production_enabled: false,
      production_ready: false,
      protocol_status: 'preproduction',
      input_schema: 'schema',
      output_schema: 'schema',
    };
    await servicesRepo.create(service);

    const res = await app.request('/catalog');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.services.length).toBe(1);
    expect(body.services[0].service_id).toBe('company_evidence_graph.v1');
    expect(body.contract_release).toBe('1.0.0');
    expect(body.pcc_version).toBe('1.0.0');
  });

  it('GET /services/:service_id returns service metadata', async () => {
    const service: ServiceMetadata = {
      service_id: 'company_evidence_graph.v1',
      version: '1.0.0',
      title: 'Company Evidence Graph',
      description: 'Verify company evidence',
      price_usd: '0.039',
      production_enabled: false,
      production_ready: false,
      protocol_status: 'preproduction',
      input_schema: 'input schema',
      output_schema: 'output schema',
    };
    await servicesRepo.create(service);

    const res = await app.request('/services/company_evidence_graph.v1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.service_id).toBe('company_evidence_graph.v1');
    expect(body.production_enabled).toBe(false);
    expect(body.production_ready).toBe(false);
    expect(body.protocol_status).toBe('preproduction');
    expect(body.bounds).toBeDefined();
  });

  it('GET /services/:service_id returns 404 for unknown service', async () => {
    const res = await app.request('/services/unknown.v1');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('SERVICE_NOT_FOUND');
  });

  it('GET /schemas returns schema references', async () => {
    const res = await app.request('/schemas');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.schemas).toBeDefined();
    expect(body.schemas['proof-carrying-context']).toBeDefined();
    expect(body.contract_release).toBe('1.0.0');
    expect(body.pcc_version).toBe('1.0.0');
  });

  it('GET /openapi.json returns OpenAPI document', async () => {
    const res = await app.request('/openapi.json');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.openapi).toBe('3.0.3');
    expect(body.info.title).toBe('SITEBORNE Utility Network API');
    expect(body.paths['/health']).toBeDefined();
    expect(body.paths['/ready']).toBeDefined();
    expect(body.paths['/catalog']).toBeDefined();
    expect(body.paths['/schemas']).toBeDefined();
    expect(body.paths['/services/{service_id}']).toBeDefined();
    expect(body.paths['/jobs']).toBeUndefined();
    expect(body.paths['/quotes']).toBeUndefined();
  });

  it('OpenAPI document shows preproduction status', async () => {
    const res = await app.request('/openapi.json');
    const body = await res.json();
    expect(body.info.version).toContain('preproduction');
    expect(body.info.description).toContain('Preproduction');
  });
});

describe('Health and Readiness Routes', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.route('/health', healthRoute);
    app.route('/ready', readinessRoute);
  });

  it('GET /health returns ok', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeDefined();
    expect(body.version).toBeDefined();
    expect(body.uptime_seconds).toBeDefined();
  });

  it('GET /ready returns not_ready with correct phase', async () => {
    const res = await app.request('/ready');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('not_ready');
    expect(body.phase).toBe('foundation');
    expect(body.production_services_enabled).toBe(false);
    expect(body.blocked_external).toContain('cloudflare_account_configuration');
    expect(body.reason).toBeDefined();
  });
});
