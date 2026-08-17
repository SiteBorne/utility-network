import { Hono } from 'hono';
import { healthRoute } from './routes/health';
import { readinessRoute } from './routes/readiness';
import { mcpRoute } from './routes/mcp';
import { a2aRoute } from './routes/a2a';
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
import {
  buildPaidServicesApp,
  buildNeverminedV2PaidServicesApp,
} from './control-plane/routes/paid-services';
import { NeverminedPaymentEvidenceProvider } from './control-plane/evidence/nevermined-provider';
import { resolveNeverminedConfig } from '@siteborne/protocol-nevermined';
import { getEnvironmentFromApiKey } from '@nevermined-io/payments';
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
app.post('/a2a', a2aRoute);
app.get('/.well-known/agent-card.json', a2aRoute);
app.get('/.well-known/jwks.json', a2aRoute);
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

app.all('/v1/nevermined/*', (c) => {
  if (c.env?.NEVERMINED_ROUTES_ENABLED !== 'true') return c.notFound();
  return c.json(
    {
      error: 'nevermined_provider_not_configured',
      message:
        'Nevermined routes require an authenticated sandbox provider; no fixture fallback is allowed',
    },
    503
  );
});

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

/**
 * SUN-1000 checkpoint 1O-B2: the real, authenticated v2 Nevermined
 * routes — the first live payment-capable Nevermined surface this
 * project has ever mounted (v1's `/v1/nevermined/*` above has always
 * been a hardcoded 503, no exception). Gated by THREE independent,
 * fail-closed conditions, all required simultaneously:
 *   1. `NEVERMINED_ROUTES_ENABLED === 'true'` (existing route-family gate)
 *   2. `resolveNeverminedConfig` resolves a usable `NVM_API_KEY`/
 *      `NEVERMINED_API_KEY` + `NVM_ENVIRONMENT` — absent/misconfigured
 *      fails the same 503 v1 has always returned, never a fixture
 *      fallback.
 *   3. `evaluateNeverminedLiveGuard` (invoked inside
 *      `NeverminedPaymentEvidenceProvider.authenticated()`) requires
 *      `RUN_LIVE_NEVERMINED === '1'` AND `NVM_ENVIRONMENT === 'sandbox'`
 *      AND the API key's own prefix-derived environment is `'sandbox'`
 *      — `'live'` is hard-rejected at every one of these three checks.
 * `production_enabled`/`production_ready` are untouched by this gate —
 * both remain `false` regardless, exactly as every other route family.
 * This app instance's `evidenceProvider` is real/authenticated — it must
 * never be reused for a CDP mount (see `buildNeverminedV2PaidServicesApp`'s
 * own doc comment).
 */
let cachedNeverminedV2App: Awaited<ReturnType<typeof buildNeverminedV2PaidServicesApp>> | undefined;
let cachedNeverminedV2Db: Env['DB'] | undefined;
let cachedNeverminedV2ApiKey: string | undefined;

app.all('/v2/nevermined/*', async (c) => {
  if (c.env?.NEVERMINED_ROUTES_ENABLED !== 'true') return c.notFound();
  if (!c.env.DB) {
    return c.json(
      {
        error: 'configuration_error',
        message: 'NEVERMINED_ROUTES_ENABLED is set but no D1 database binding is configured',
      },
      500
    );
  }
  const resolved = resolveNeverminedConfig({
    NVM_API_KEY: c.env.NVM_API_KEY,
    NEVERMINED_API_KEY: c.env.NEVERMINED_API_KEY,
    NVM_ENVIRONMENT: c.env.NVM_ENVIRONMENT,
  });
  if (!resolved.ok) {
    return c.json(
      {
        error: 'nevermined_provider_not_configured',
        message:
          'Nevermined routes require an authenticated sandbox provider; no fixture fallback is allowed',
      },
      503
    );
  }
  // Narrows the SDK's broader EnvironmentName ('staging_sandbox' /
  // 'staging_live' / 'custom' included) down to the strict 'sandbox' |
  // 'live' | 'unknown' the live guard accepts -- anything not exactly
  // 'sandbox' or 'live' fails closed as 'unknown', never silently
  // widened to pass the guard.
  const rawKeyEnvironment = getEnvironmentFromApiKey(resolved.apiKey);
  const apiKeyEnvironment: 'sandbox' | 'live' | 'unknown' =
    rawKeyEnvironment === 'sandbox' || rawKeyEnvironment === 'live' ? rawKeyEnvironment : 'unknown';
  let evidenceProvider: NeverminedPaymentEvidenceProvider;
  try {
    evidenceProvider = NeverminedPaymentEvidenceProvider.authenticated({
      apiKey: resolved.apiKey,
      environment: 'sandbox',
      liveGuard: {
        runLiveNevermined: c.env.RUN_LIVE_NEVERMINED,
        apiKeyEnvironment,
      },
    });
  } catch {
    return c.json(
      {
        error: 'nevermined_provider_not_configured',
        message:
          'Nevermined routes require an authenticated sandbox provider; no fixture fallback is allowed',
      },
      503
    );
  }
  if (
    !cachedNeverminedV2App ||
    cachedNeverminedV2Db !== c.env.DB ||
    cachedNeverminedV2ApiKey !== resolved.apiKey
  ) {
    cachedNeverminedV2App = await buildNeverminedV2PaidServicesApp({
      db: c.env.DB,
      evidenceMode: 'fixture',
      evidenceProvider,
      payTo: c.env.SELLER_WALLET_ADDRESS || undefined,
    });
    cachedNeverminedV2Db = c.env.DB;
    cachedNeverminedV2ApiKey = resolved.apiKey;
  }
  return cachedNeverminedV2App.fetch(c.req.raw, c.env);
});

/**
 * SUN-1000 checkpoint 1O-B2: the direct v2 CDP routes. Discovered during
 * this checkpoint that no `/v2/*` forward existed at all before now —
 * every prior "live v2" test called `buildPaidServicesApp`'s returned
 * Hono instance directly, bypassing this file's routing entirely. Uses
 * its own separate cached app instance (never the Nevermined one above)
 * so a real Nevermined-authenticated `evidenceProvider` can never leak
 * into a CDP route's settlement call. Same `PAID_ROUTES_ENABLED` gate as
 * `/v1/*`; `evidenceProvider` left unset here (defaults to
 * `FixturePaymentEvidenceProvider` — a real CDP proof, if performed, is a
 * separate, explicitly authorized action, not a side effect of mounting
 * this route family).
 */
let cachedV2CdpApp: Awaited<ReturnType<typeof buildPaidServicesApp>> | undefined;
let cachedV2CdpDb: Env['DB'] | undefined;

app.all('/v2/*', async (c) => {
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
  if (!cachedV2CdpApp || cachedV2CdpDb !== c.env.DB) {
    cachedV2CdpApp = await buildPaidServicesApp({
      db: c.env.DB,
      evidenceMode: 'fixture',
      payTo: c.env.SELLER_WALLET_ADDRESS || undefined,
    });
    cachedV2CdpDb = c.env.DB;
  }
  return cachedV2CdpApp.fetch(c.req.raw, c.env);
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
