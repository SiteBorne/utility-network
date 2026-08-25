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
 *
 * SUN-1218 checkpoint X: `NEVERMINED_ROUTES_ENABLED` is a genuinely
 * separate, unrelated flag from `PAID_ROUTES_ENABLED` -- unaffected by
 * this checkpoint's activation-model correction -- and these two
 * wildcards (still covering only unsupported, no-real-executor routes)
 * retain their original 503-on-flag-true diagnostic unchanged.
 */
app.all('/v1/nevermined/*', (c) => {
  if (c.env?.NEVERMINED_ROUTES_ENABLED !== 'true') return c.notFound();
  return productionServiceExecutorUnavailable(c);
});

/**
 * SUN-1218 checkpoint X: `/v1/*` and `/v2/*` (below) previously shared
 * `PAID_ROUTES_ENABLED` with the verify route's own activation gate --
 * turning that flag on to authorize the one qualified route also flipped
 * these 7 unrelated, permanently-unsupported routes from 404 to 503, an
 * externally-observable behavior change this checkpoint's own activation
 * design never intended. `PAID_ROUTES_ENABLED`'s meaning has shifted
 * (since SUN-1216) from "enable this whole family" to "one of two
 * required gates for an individually-activated route" -- the SUN-1206
 * family-wide 503 diagnostic no longer applies here. Neither wildcard
 * covers any route with a real executor, and none is expected to: a
 * future route with one gets pulled out into its own exact route + its
 * own two-level gate, exactly like verify was in SUN-1216 -- never by
 * reintroducing a flag check here. `productionServiceExecutorUnavailable`
 * itself is untouched and still reachable, exclusively from the verify
 * route's own dependency-unavailable branch.
 */
app.all('/v1/*', (c) => c.notFound());

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
 * handlers that follow. Gated by `PAID_ROUTES_ENABLED` AND (SUN-1218
 * checkpoint X) `VERIFY_V2_CDP_ROUTE_ENABLED` -- both required, checked
 * inside the handler itself; default-absent on either -> 404, identical
 * to the pre-SUN-1216 behavior.
 */
app.post('/v2/verify/agent-output', verifyAgentOutputV2CdpProductionRoute);

// SUN-1218 checkpoint X: see the `/v1/*` wildcard's own doc comment
// above -- same correction, same reasoning, unconditional 404.
app.all('/v2/*', (c) => c.notFound());

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
