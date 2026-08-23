import { Hono } from 'hono';
import { healthRoute } from './routes/health';
import { readinessRoute } from './routes/readiness';
import { mcpRoute } from './routes/mcp';
import { a2aRoute } from './routes/a2a';
import { mcpRegistryAuthRoute } from './routes/mcp-registry-auth';
import { catalogRoute } from './control-plane/routes/catalog';
import { serviceMetadataRoute } from './control-plane/routes/catalog';
import { schemasRoute } from './control-plane/routes/catalog';
import { openapiRoute } from './control-plane/routes/catalog';
import { benchmarksRoute } from './control-plane/routes/benchmarks';
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
import { D1ServicesRepository } from './control-plane/repositories/d1/services';
import { InMemoryArtifactStore } from './control-plane/artifacts/store';
import { InMemoryQueueProducer } from './control-plane/queue/dispatch';
import { QueueDispatchHandler } from './control-plane/queue/dispatch';
import { AuditLogger } from './control-plane/audit/events';
import { productionServiceExecutorUnavailable } from './control-plane/routes/production-paid-services';
import { verifyAgentOutputV2CdpProductionRoute } from './control-plane/routes/production-verify-v2-cdp-route';
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
  // SUN-1100 checkpoint 1: `/catalog`/`/services/{id}` were unconditionally
  // wired to the in-memory repository above -- confirmed live, the real
  // D1 `services` table (bound as `env.DB`, seeded with 8 rows per
  // SUN-0800B checkpoint 3) was never actually read, so the public
  // catalog endpoint always returned 0 services despite a 200 status.
  // Prefer the real D1-backed repository whenever the binding is present
  // (every real deployment); fall back to the in-memory instance only
  // when it is absent (existing unit tests that construct a bare `Env`).
  c.set('servicesRepo', c.env?.DB ? new D1ServicesRepository(c.env.DB) : repositories.services);
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
app.post('/a2a', a2aRoute);
app.get('/.well-known/agent-card.json', a2aRoute);
app.get('/.well-known/jwks.json', a2aRoute);
app.route('/.well-known/mcp-registry-auth', mcpRegistryAuthRoute);
app.route('/catalog', catalogRoute);
app.route('/services', serviceMetadataRoute);
app.route('/schemas', schemasRoute);
app.route('/benchmarks', benchmarksRoute);
app.route('/', openapiRoute);

/**
 * SUN-1206: route-family flags retain their historical 404 mounting contract,
 * but no flag, credential, request value, or payment material can select the
 * local fixture registry. The repository has no complete governed
 * Worker-compatible paid-service executor, so every enabled family stops at
 * the same deterministic 503 before quote/payment/provider/service work.
 * Payment-provider and fixture-backed orchestration remain independently
 * tested through test-only module graphs that this production entrypoint does
 * not import.
 */
app.all('/v1/nevermined/*', (c) => {
  if (c.env?.NEVERMINED_ROUTES_ENABLED !== 'true') return c.notFound();
  return productionServiceExecutorUnavailable(c);
});

app.all('/v1/*', (c) => {
  if (c.env?.PAID_ROUTES_ENABLED !== 'true') {
    return c.notFound();
  }
  return productionServiceExecutorUnavailable(c);
});

app.all('/v2/nevermined/*', (c) => {
  if (c.env?.NEVERMINED_ROUTES_ENABLED !== 'true') return c.notFound();
  return productionServiceExecutorUnavailable(c);
});

/**
 * SUN-1216: the first real, bundle-reachable production paid-service
 * composition (`verify_agent_output.v2` / CDP, built in SUN-1214).
 * Registered for exactly `POST` -- the one HTTP method
 * `createX402ServiceRoute` itself uses -- and mounted here, before the
 * generic `/v2/*` wildcard below, so Hono matches this route first for
 * this one path only. Every other method on this path, and every other
 * of the 12 paid routes, falls through unchanged to the wildcard
 * handlers that follow. Still gated by the same `PAID_ROUTES_ENABLED`
 * flag (default-absent -> 404, identical to the pre-SUN-1216 behavior);
 * no route-specific activation flag is introduced by this checkpoint.
 */
app.post('/v2/verify/agent-output', verifyAgentOutputV2CdpProductionRoute);

app.all('/v2/*', (c) => {
  if (c.env?.PAID_ROUTES_ENABLED !== 'true') {
    return c.notFound();
  }
  return productionServiceExecutorUnavailable(c);
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
