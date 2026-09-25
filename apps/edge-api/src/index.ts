import { Hono } from 'hono';
import { SITEBORNE_SERVICE_IDS } from '@siteborne/protocol-a2a';
import { healthRoute } from './routes/health';
import { readinessRoute } from './routes/readiness';
import { derivePublicReleaseState } from './routes/public-release-state';
import { mcpRoute } from './routes/mcp';
import { a2aRoute } from './routes/a2a';
import { mcpRegistryAuthRoute } from './routes/mcp-registry-auth';
import { securityTxtRoute } from './routes/security-txt';
import { robotsTxtRoute } from './routes/robots-txt';
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
import { webContextVerifiedV2CdpProductionRoute } from './control-plane/routes/production-web-context-v2-cdp-route';
import { companyEvidenceGraphV2CdpProductionRoute } from './control-plane/routes/production-company-evidence-v2-cdp-route';
import {
  companyEvidenceGraphV3CandidateRoute,
  documentEvidenceJsonV3CandidateRoute,
  verifyAgentOutputV3CandidateRoute,
  webContextVerifiedV3CandidateRoute,
} from './control-plane/routes/production-public-v3-candidate-routes';
import { documentEvidenceJsonV2CdpProductionRoute } from './control-plane/routes/production-document-evidence-v2-cdp-route';
import { documentArtifactUploadRoute } from './control-plane/routes/document-artifact-upload-route';
import type { Env } from './control-plane/config/env';
import { D1WorkflowOwnerIntentRepository } from './control-plane/repositories/d1/workflow-owner-intents';
import { recoverPendingWorkflowOwnerIntents } from './control-plane/continuation/owner-recovery';
import { reclaimStaleArtifacts } from './control-plane/artifacts/artifact-reclamation';
import { runStorageAlertSweep } from './control-plane/alerting/storage-alert-sweep';
import {
  buildServiceBindingStorageAlertTransport,
  type ServiceBindingFetcher,
} from './control-plane/alerting/storage-alert-service-binding-transport';
import {
  R2ArtifactStoreAdapter,
  DOCUMENT_ARTIFACT_KEY_PREFIX,
} from './control-plane/artifacts/store';
import { D1ArtifactsRepository } from './control-plane/repositories/d1/artifacts';

export type { ControlPlaneConfig };

// SUN-1221E6R-H2BF4 -- this Worker no longer owns or exports
// `PaidContinuationWorkflow`. H2AWI-4R's own same-script export (a
// `[[workflows]]` binding's `class_name` had to be an export of whichever
// script owned the binding) is exactly the topology H2BF3's forensics
// found structurally incapable of ever producing a compiled Workflow DAG
// through this Worker's `versions upload` / `versions deploy` / `triggers
// deploy` release pipeline (see
// docs/reports/SUN-1221E6R-H2BF3-workflow-version-id-graph-forensics.md
// §12/§19). The class now lives EXCLUSIVELY in the dedicated Workflow-host
// script (`apps/edge-api/src/workflow-host-entrypoint.ts`,
// `wrangler.paid-continuation-runtime.toml`); this Worker's own
// `wrangler.toml` `[[workflows]]` block now binds to it cross-script via
// `script_name`, needing no local class export at all (see
// docs/design/SUN-1221E6R-H2BF4-dedicated-workflow-host-architecture.md
// §"Remove ambiguous same-script ownership" for the full reasoning against
// re-adding a duplicate export here).

export const app = new Hono<{ Bindings: Env }>();

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
app.route('/.well-known/security.txt', securityTxtRoute);
app.route('/robots.txt', robotsTxtRoute);
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

/**
 * SUN-1221C — the second real, bundle-reachable production paid-service
 * composition (`web_context_verified.v2` / CDP), mirroring
 * `verify_agent_output.v2`'s exact SUN-1216 registration pattern above:
 * registered for exactly `POST`, mounted before the generic `/v2/*`
 * wildcard below so Hono matches this route first for this one path
 * only. Every other method on this path, and every other of the (now)
 * 10 remaining paid routes, falls through unchanged to the wildcard
 * handlers that follow. Gated independently by `PAID_ROUTES_ENABLED` AND
 * `WEB_CONTEXT_V2_CDP_ROUTE_ENABLED` -- unrelated to
 * `VERIFY_V2_CDP_ROUTE_ENABLED`; default-absent on either -> 404.
 */
app.post('/v2/web/context', webContextVerifiedV2CdpProductionRoute);

/**
 * SUN-1222B-S3R — the third real, bundle-reachable production paid-service
 * composition (`company_evidence_graph.v2` / CDP), mirroring
 * `web_context_verified.v2`'s exact registration pattern above: registered
 * for exactly `POST`, mounted before the generic `/v2/*` wildcard below so
 * Hono matches this route first for this one path only. Every other
 * method on this path, and every other paid route, falls through
 * unchanged to the wildcard handlers that follow. Gated independently by
 * `PAID_ROUTES_ENABLED` AND `COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED`
 * -- unrelated to the other two services' flags; default-absent on either
 * -> 404.
 */
app.post('/v2/company/evidence-graph', companyEvidenceGraphV2CdpProductionRoute);
app.post('/v3/company/evidence-graph', companyEvidenceGraphV3CandidateRoute);
app.post('/v3/web/context', webContextVerifiedV3CandidateRoute);
app.post('/v3/document/evidence-json', documentEvidenceJsonV3CandidateRoute);
app.post('/v3/verify/agent-output', verifyAgentOutputV3CandidateRoute);

/**
 * SUN-1222B-S3R — the fourth real, bundle-reachable production
 * paid-service composition (`document_evidence_json.v2` / CDP), mirroring
 * `company_evidence_graph.v2`'s exact registration pattern above. Gated
 * independently by `PAID_ROUTES_ENABLED` AND
 * `DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED`; the route ALSO requires
 * `env.ARTIFACTS` and `MODAL_DOCWORKER_*` to be genuinely present (both
 * absent in the deployed production Worker today) or the composition
 * returns `unavailable: true` -- see that route module's own doc comment.
 */
app.post('/v2/document/evidence-json', documentEvidenceJsonV2CdpProductionRoute);

/**
 * SUN-1222B-S3-R2 — the buyer-facing document upload endpoint that closes
 * `document_evidence_json.v2`'s `upload_reference` input-mode gap (see
 * `document-artifact-upload-route.ts`'s own doc comment). Deliberately
 * mounted as its own route, never behind `x402-service.ts`'s paid-route
 * machinery -- this handler performs no payment/PCC/settlement work, only
 * validate-hash-store, gated by `PAID_ROUTES_ENABLED` AND
 * `DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED` (both `'true'`) plus real
 * `DB`/`ARTIFACTS` bindings, or it 404s.
 */
app.post('/v2/artifacts/documents', documentArtifactUploadRoute);

// SUN-1222C closure: the temporary `/internal/storage-alert-qualification`
// and `/internal/storage-alert-smtp-diagnostic` routes (and the secrets that
// guarded them) have been removed now that both checkpoints they existed for
// are closed -- real end-to-end delivery was mailbox-confirmed via the
// qualification route, and the SMTP root cause (a STARTTLS-upgrade-specific
// TLS handshake hang on port 587; port 465 implicit TLS proven clean) was
// isolated via the diagnostic route. See git history for their
// implementation and `storage-alert-receiver-entrypoint.ts`'s own doc
// comment for the permanent production path that remains.

// SUN-1218 checkpoint X: see the `/v1/*` wildcard's own doc comment
// above -- same correction, same reasoning, unconditional 404.
app.all('/v2/*', (c) => c.notFound());

app.get('/', async (c) => {
  const releaseState = await derivePublicReleaseState(c.env);
  return c.json({
    name: 'SITEBORNE Utility Network',
    version: '0.0.0',
    status: releaseState.status,
    domains: {
      human: 'siteborne.com',
      machine: 'siteborne.net',
      production_origin: 'utility.siteborne.net',
    },
    standard: 'Proof-Carrying Context v1.0.0',
    services: SITEBORNE_SERVICE_IDS,
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
/**
 * Model-C durable owner recovery. The HTTP request's waitUntil remains the
 * low-latency first attempt; this scheduled scan is the independent durable
 * owner that repairs a committed pending intent after client/process loss.
 * It can only call the deterministic Workflow binding. It has no facilitator,
 * provider, settlement, or buyer-signing capability.
 */
export async function recoverWorkflowOwnerIntentsScheduled(
  env: Pick<Env, 'DB' | 'PAID_CONTINUATION_WORKFLOW'>
): Promise<void> {
  if (!env.DB || !env.PAID_CONTINUATION_WORKFLOW) return;
  await recoverPendingWorkflowOwnerIntents(
    new D1WorkflowOwnerIntentRepository(env.DB),
    env.PAID_CONTINUATION_WORKFLOW
  );
}

/**
 * SUN-1222C-document-artifact-production-closure — wires physical artifact
 * reclamation (`artifact-reclamation.ts`) to the now-proven-working
 * scheduled dispatcher. Previously unwired entirely (confirmed by trace,
 * flagged as a deliberate deferral by both `artifact-reclamation.ts`'s own
 * doc comment and `document-ingress-admission-control.ts`'s), meaning the
 * bounded-RATE admission control on `POST /v2/artifacts/documents` bounded
 * how fast storage could accumulate but never how much could accumulate in
 * total over an unbounded time horizon. This closes that gap using only
 * already-existing, already-proven-safe machinery: no new binding, no new
 * secret, no new D1 table, no new Cron Trigger (the same `* * * * *`
 * trigger `recoverWorkflowOwnerIntentsScheduled` already uses).
 *
 * Alerting (SUN-1222C-DOCUMENT-ARTIFACT-LOCAL-CLOSURE-R2 §3 — "critical
 * storage/reclamation alerting"): a persistent `r2_delete_failures > 0`
 * after a pass means R2 deletes are failing while the D1 rows are
 * (correctly, per `reclaimStaleArtifacts`'s own contract) being left in
 * place for retry — safe, but worth surfacing. The unconditional
 * structured `console.error` (Cloudflare platform logs / Logpush, no new
 * binding) remains and is never suppressed. Additionally, when
 * `env.STORAGE_ALERT_RECEIVER` (a Cloudflare Service Binding to the
 * dedicated, internal-only `siteborne-storage-alert-receiver` Worker) and
 * `env.STORAGE_ALERT_PATH_TOKEN` are both provisioned, one bounded
 * delivery is attempted via `buildServiceBindingStorageAlertTransport` —
 * no public HTTPS webhook, no Custom Domain, no DNS dependency (see that
 * module's own doc comment for why a Service Binding replaced the earlier
 * `STORAGE_RECLAMATION_ALERT_WEBHOOK_URL` design). Payload carries no
 * economic credential, no artifact content, only counts/timestamp/a
 * bounded content-hash sample — unchanged from before this transport swap.
 * A transport failure or missing binding/secret never blocks or delays
 * reclamation itself: this call happens strictly after `reclaimStaleArtifacts`
 * has already fully run and been counted, and its own result is not
 * awaited by anything that could roll reclamation back.
 */
export async function reclaimStaleArtifactsScheduled(
  env: Pick<Env, 'DB' | 'ARTIFACTS' | 'STORAGE_ALERT_RECEIVER' | 'STORAGE_ALERT_PATH_TOKEN'>
): Promise<void> {
  if (!env.DB || !env.ARTIFACTS) return;
  const nowIso = new Date().toISOString();
  const result = await reclaimStaleArtifacts({
    artifactStore: new R2ArtifactStoreAdapter(env.ARTIFACTS, DOCUMENT_ARTIFACT_KEY_PREFIX),
    artifactsRepository: new D1ArtifactsRepository(env.DB),
    nowIso: () => nowIso,
  });
  if (result.r2_delete_failures > 0) {
    console.error(
      JSON.stringify({
        event: 'siteborne.artifact_reclamation.r2_delete_failures',
        reclaimed: result.reclaimed,
        r2_delete_failures: result.r2_delete_failures,
        observed_at: nowIso,
      })
    );
  }
  const receiver = env.STORAGE_ALERT_RECEIVER;
  const pathToken = env.STORAGE_ALERT_PATH_TOKEN;
  if (receiver && pathToken) {
    try {
      await runStorageAlertSweep(
        {
          r2DeleteFailures: result.r2_delete_failures,
          reclaimedCount: result.reclaimed,
          failedContentHashes: result.r2_delete_failure_content_hashes,
          nowIso,
        },
        {
          transport: buildServiceBindingStorageAlertTransport(
            // `Fetcher.fetch`'s generated type is a stricter,
            // Cloudflare-flavored variant of the ambient DOM
            // `RequestInit`/`Response` that `ServiceBindingFetcher`
            // deliberately uses instead (see that module's own doc
            // comment) — every real Service Binding fetcher accepts a
            // plain `string` URL and ordinary `RequestInit` at runtime
            // regardless, so this narrows the type only.
            receiver as unknown as ServiceBindingFetcher,
            pathToken
          ),
        }
      );
    } catch {
      // §3 "alert transport failure that never blocks reclamation
      // itself" — reclamation has already fully completed above;
      // a construction/delivery error here is swallowed, never rethrown.
    }
  }
}

// SUN-1222C cron export remediation: the previous `Object.assign(app, {
// scheduled })` default export is the Hono application instance itself,
// merely augmented with an own `scheduled` property. That shape is
// sufficient for `wrangler versions view`'s static handler-list
// introspection and for ordinary HTTP dispatch (Hono's own `fetch` is
// unaffected by the extra property), but the live platform's Cron Trigger
// dispatcher never invoked it -- zero `scheduled` invocations were
// observed despite a confirmed, registered `* * * * *` trigger (see
// docs/reports/SUN-1222C-cron-runtime-invocation-blocker-diagnosis.md).
// `siteborne-settlement-alert` (`./settlement-alert-worker-entrypoint.ts`)
// is the proven-working precedent in this same repo: a plain object
// literal default export with explicit `fetch`/`scheduled` properties,
// not the augmented application instance. `satisfies ExportedHandler<Env>`
// is deliberately not applied here either, for the same `Response`-type
// incompatibility already documented on that file and on
// `./workflow-host-entrypoint.ts`.
export default {
  fetch: app.fetch,
  scheduled(
    _controller: { readonly scheduledTime: number; readonly cron: string },
    env: Env,
    ctx: { waitUntil(promise: Promise<unknown>): void }
  ): void {
    ctx.waitUntil(recoverWorkflowOwnerIntentsScheduled(env));
    ctx.waitUntil(reclaimStaleArtifactsScheduled(env));
  },
};
