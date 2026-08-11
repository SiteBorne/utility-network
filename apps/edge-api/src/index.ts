import { Hono } from 'hono';
import { healthRoute } from './routes/health';
import { readinessRoute } from './routes/readiness';
import { mcpRoute } from './routes/mcp';
import { catalogRoute } from './control-plane/routes/catalog';
import { serviceMetadataRoute } from './control-plane/routes/catalog';
import { schemasRoute } from './control-plane/routes/catalog';
import { openapiRoute } from './control-plane/routes/catalog';
import { createIdempotencyMiddleware } from './control-plane/middleware/request-context';
import { createBodySizeMiddleware } from './control-plane/middleware/request-context';
import { createContentTypeMiddleware } from './control-plane/middleware/request-context';
import { createStructuredErrorMiddleware } from './control-plane/middleware/request-context';
import { createSecurityHeadersMiddleware } from './control-plane/middleware/request-context';
import { createRequestTimingMiddleware } from './control-plane/middleware/request-context';
import { createAuditContextMiddleware } from './control-plane/middleware/request-context';
import { createDevelopmentModeMiddleware } from './control-plane/middleware/request-context';
import type { ControlPlaneConfig } from './control-plane/config/env';
import { createInMemoryRepositories } from './control-plane/repositories/in-memory';
import { InMemoryArtifactStore } from './control-plane/artifacts/store';
import { InMemoryQueueProducer } from './control-plane/queue/dispatch';
import { QueueDispatchHandler } from './control-plane/queue/dispatch';
import { AuditLogger } from './control-plane/audit/events';
import { buildPaidServicesApp } from './control-plane/routes/paid-services';
import type { Env } from './control-plane/config/env';

export type { ControlPlaneConfig };

const app = new Hono<{ Bindings: Env }>();

app.use('*', createStructuredErrorMiddleware());
app.use('*', createSecurityHeadersMiddleware());
app.use('*', createRequestTimingMiddleware());
app.use('*', createAuditContextMiddleware());
app.use('*', createDevelopmentModeMiddleware());
app.use('*', createIdempotencyMiddleware());
app.use('*', createBodySizeMiddleware());
app.use('*', createContentTypeMiddleware());

const repositories = createInMemoryRepositories();
const artifactStore = new InMemoryArtifactStore();
const queueProducer = new InMemoryQueueProducer();
const dispatchHandler = new QueueDispatchHandler(queueProducer, repositories.queueDispatch);
const auditLogger = new AuditLogger(repositories.audit, repositories.security);

app.use('*', async (c, next) => {
  c.set('servicesRepo', repositories.services);
  c.set('serviceVersionsRepo', repositories.serviceVersions);
  c.set('jobsRepo', repositories.jobs);
  c.set('jobAttemptsRepo', repositories.jobAttempts);
  c.set('stateEventsRepo', repositories.stateEvents);
  c.set('idempotencyRepo', repositories.idempotency);
  c.set('artifactsRepo', repositories.artifacts);
  c.set('queueDispatchRepo', repositories.queueDispatch);
  c.set('quotaRepo', repositories.quota);
  c.set('auditRepo', repositories.audit);
  c.set('securityRepo', repositories.security);
  c.set('artifactStore', artifactStore);
  c.set('queueProducer', queueProducer);
  c.set('dispatchHandler', dispatchHandler);
  c.set('auditLogger', auditLogger);
  await next();
});

app.route('/health', healthRoute);
app.route('/ready', readinessRoute);
app.all('/mcp', mcpRoute);
app.route('/catalog', catalogRoute);
app.route('/services', serviceMetadataRoute);
app.route('/schemas', schemasRoute);
app.route('/', openapiRoute);

/**
 * SUN-0700A checkpoint 5's local x402 paid-service routes (directive §6:
 * "no default configuration may accidentally enable payment execution").
 * Mounted ONLY when `PAID_ROUTES_ENABLED === 'true'` AND a real D1
 * binding is present — both absent by default in every environment
 * today, so `/v1/*` is a plain 404 unless explicitly opted in.
 * `evidenceMode` is hardcoded `'fixture'` here (never `'production'` —
 * `resolvePaymentEvidenceProvider` has no production provider to satisfy
 * that mode regardless). This gate does not itself change
 * `production_ready`/`production_enabled`, which remain `false`
 * everywhere else in the system.
 */
let cachedPaidServicesApp: Awaited<ReturnType<typeof buildPaidServicesApp>> | undefined;
let cachedPaidServicesDb: Env['DB'] | undefined;

app.all('/v1/*', async (c) => {
  if (c.env?.PAID_ROUTES_ENABLED !== 'true') {
    return c.notFound();
  }
  if (!c.env.DB) {
    return c.json(
      {
        error: 'configuration_error',
        message: 'PAID_ROUTES_ENABLED is set but no D1 database binding is configured',
      },
      500
    );
  }
  if (!cachedPaidServicesApp || cachedPaidServicesDb !== c.env.DB) {
    cachedPaidServicesApp = await buildPaidServicesApp({
      db: c.env.DB,
      evidenceMode: 'fixture',
      payTo: c.env.SELLER_WALLET_ADDRESS || undefined,
    });
    cachedPaidServicesDb = c.env.DB;
  }
  return cachedPaidServicesApp.fetch(c.req.raw, c.env);
});

app.get('/', (c) => {
  return c.json({
    name: 'SITEBORNE Utility Network',
    version: '0.0.0',
    status: 'preproduction foundation',
    domains: {
      human: 'siteborne.com',
      machine: 'siteborne.net',
      production_origin: 'utility.siteborne.net',
    },
    standard: 'Proof-Carrying Context v1.0.0',
    services: [
      'company_evidence_graph.v1',
      'web_context_verified.v1',
      'document_evidence_json.v1',
      'verify_agent_output.v1',
    ],
    control_plane: {
      state_machine: 'implemented',
      idempotency: 'implemented',
      artifacts: 'implemented',
      queue_dispatch: 'implemented',
      quota_guard: 'implemented',
      audit_logging: 'implemented',
      d1_migrations: 'defined',
      local_testing: 'enabled',
    },
  });
});

export type AppType = typeof app;
export default app;
