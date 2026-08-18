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
import {
  buildPaidServicesApp,
  buildNeverminedV2PaidServicesApp,
} from './control-plane/routes/paid-services';
import { NeverminedPaymentEvidenceProvider } from './control-plane/evidence/nevermined-provider';
import { resolveNeverminedEnvironmentFromApiKey } from './control-plane/evidence/nevermined-http-client';
import { resolveNeverminedConfig } from '@siteborne/protocol-nevermined';
import {
  buildCdpSellerAddressLookup,
  buildProductionCdpAccountLookupClientFactory,
  resolveProductionAuthorizationInput,
  resolveProductionCdpEvidenceProvider,
} from './control-plane/config/production-payment';
import { buildProductionCdpChainReceiptChecker } from './control-plane/evidence/chain-receipt-checker';
import { createCdpFacilitatorClient } from '@coinbase/cdp-sdk/x402';
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

const UNAUTHORIZED_PRODUCTION_INPUT = {
  environment: 'preproduction' as const,
  productionEnabled: false,
  humanBootstrapAuthorized: false,
  productionCredentialsApproved: false,
};

/**
 * SUN-1200 checkpoint B: the single provider-construction boundary for
 * both `/v1/*` and `/v2/*` CDP routes. Delegates entirely to
 * `resolveProductionCdpEvidenceProvider` — falls back to the existing,
 * always-safe `evidenceMode: 'fixture'` unless every ADR 0055 gate, every
 * required secret, AND the seller-identity hook (real as of checkpoint D
 * — see below) all succeed.
 *
 * SUN-1200 checkpoint D: `getAuthenticatedSellerAddress` is now wired to
 * the real `buildCdpSellerAddressLookup` (a real CDP account lookup — see
 * `production-payment.ts`), replacing checkpoint B/C's deliberately
 * omitted hook. This does NOT make production reachable by itself:
 * `resolveProductionCdpEvidenceProvider` still requires all four ADR 0055
 * gates AND all four required secrets to be genuinely true/present
 * BEFORE it ever calls this hook at all (§4 ordering, proven in
 * `production-cdp-outer-router.test.ts`) — supplying the hook only
 * removes what was, through checkpoint C, an *additional*, undisclosed-
 * by-any-flag safety margin beyond the four governed gates. The governed
 * gates (env vars) are the only thing that has ever controlled whether
 * production is reachable; this checkpoint completes the previously-
 * unfinished implementation without changing what controls it.
 * Constructing the lookup closure here makes no network call — only a
 * genuine call to it (itself gated behind every other check already
 * passing) would ever construct a real `CdpClient` or reach the network.
 *
 * IMPORTANT (found and fixed during checkpoint B's own outer-router
 * testing): the `productionAuthorization` passed to `buildPaidServicesApp`
 * (which drives `paid-services.ts`'s network/asset resolution) MUST NEVER
 * be more permissive than `cdpEvidence.evidenceMode`. An earlier version
 * of this function passed the raw, env-var-only authorization input
 * straight through -- meaning the four `PAYMENT_ENVIRONMENT`/
 * `PRODUCTION_ENABLED`/`HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP`/
 * `PRODUCTION_CDP_CREDENTIALS_APPROVED` env vars alone (no real secrets
 * needed at all) were enough to make the live app construct and serve a
 * real Base-mainnet 402 challenge (real chain ID, real USDC contract
 * address) while `evidenceMode` correctly stayed `'fixture'` underneath
 * -- a truthfulness defect (advertising real mainnet payment terms with
 * zero real settlement capability behind them), not merely cosmetic.
 * Fixed by deriving `productionAuthorization` from the SAME success/
 * failure outcome as evidence-provider construction: network/asset
 * resolution and evidence-provider selection are now always in lockstep,
 * never independently divergent.
 */
async function resolveCdpEvidence(env: Env) {
  const rawAuthorization = resolveProductionAuthorizationInput(env);
  const cdpEvidence = await resolveProductionCdpEvidenceProvider(rawAuthorization, env, {
    createFacilitatorClient: createCdpFacilitatorClient,
    getAuthenticatedSellerAddress: buildCdpSellerAddressLookup(
      buildProductionCdpAccountLookupClientFactory(env),
      env.SELLER_WALLET_ADDRESS
    ),
  });
  const productionAuthorization =
    cdpEvidence.evidenceMode === 'production' ? rawAuthorization : UNAUTHORIZED_PRODUCTION_INPUT;
  return { productionAuthorization, cdpEvidence };
}

/**
 * SUN-1200 checkpoint D: the real, read-only chain-receipt checker,
 * wired into both CDP-rail route families below. Construction alone
 * makes no network call — see `buildProductionCdpChainReceiptChecker`'s
 * own doc comment. The returned function is only ever invoked from
 * inside `attemptCdpRecovery`'s own optional chain-check branch during a
 * genuine ambiguous CDP settlement, itself unreachable in fixture mode
 * (`FixturePaymentEvidenceProvider` never produces an ambiguous
 * settlement) — so wiring this unconditionally, independent of the ADR
 * 0055 production gates, changes no reachable behavior in fixture mode
 * and adds no new authorization surface: it is read-only by construction
 * and never itself decides whether a payment settles.
 */
function resolveCdpChainReceiptChecker(env: Env) {
  return buildProductionCdpChainReceiptChecker({
    productionRpcUrl: env.BASE_RPC_URL,
    preproductionRpcUrl: env.BASE_SEPOLIA_RPC_URL,
  });
}

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
    const { productionAuthorization, cdpEvidence } = await resolveCdpEvidence(c.env);
    cachedPaidServicesApp = await buildPaidServicesApp({
      db: c.env.DB,
      evidenceMode: cdpEvidence.evidenceMode,
      evidenceProvider: cdpEvidence.evidenceProvider,
      payTo: c.env.SELLER_WALLET_ADDRESS || undefined,
      productionAuthorization,
      cdpChainReceiptChecker: resolveCdpChainReceiptChecker(c.env),
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
  const rawKeyEnvironment = resolveNeverminedEnvironmentFromApiKey(resolved.apiKey);
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
 * `/v1/*`. SUN-1200 checkpoint B: `evidenceMode`/`evidenceProvider` now
 * flow through the same `resolveCdpEvidence` boundary as `/v1/*` -- falls
 * back to `FixturePaymentEvidenceProvider` (`evidenceMode: 'fixture'`)
 * unless every production authorization/credential/seller-identity gate
 * passes, which today it structurally cannot (no real seller-identity
 * hook is wired) -- a real CDP proof remains a separate, explicitly
 * authorized action, not a side effect of mounting this route family.
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
    const { productionAuthorization, cdpEvidence } = await resolveCdpEvidence(c.env);
    cachedV2CdpApp = await buildPaidServicesApp({
      db: c.env.DB,
      evidenceMode: cdpEvidence.evidenceMode,
      evidenceProvider: cdpEvidence.evidenceProvider,
      payTo: c.env.SELLER_WALLET_ADDRESS || undefined,
      productionAuthorization,
      cdpChainReceiptChecker: resolveCdpChainReceiptChecker(c.env),
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
