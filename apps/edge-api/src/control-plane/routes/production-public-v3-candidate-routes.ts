import { Hono } from 'hono';
import type { Context } from 'hono';
import { R2ArtifactStoreAdapter } from '../artifacts/store';
import type { Env } from '../config/env';
import {
  isCompanyEvidenceGraphV2CdpRouteFlagEnabled,
  isDocumentEvidenceJsonV2CdpRouteFlagEnabled,
  isVerifyAgentOutputV2CdpRouteFlagEnabled,
  isWebContextV2CdpRouteFlagEnabled,
} from '../config/production-payment';
import { importContinuationEnvelopeKey } from '../continuation/envelope';
import { PccResultArtifactStore } from '../results/pcc-result-artifact';
import { buildCompanyEvidenceGraphV2CdpProductionRouteConfig } from '../production/company-evidence-graph-v2-cdp-composition';
import { buildWebContextV2CdpProductionRouteConfig } from '../production/web-context-v2-cdp-composition';
import { buildDocumentEvidenceJsonV2CdpProductionRouteConfig } from '../production/document-evidence-json-v2-cdp-composition';
import { buildVerifyAgentOutputV2CdpProductionRouteConfig } from '../production/verify-agent-output-v2-cdp-composition';
import { createX402ServiceRoute, type X402ServiceRouteConfig } from './x402-service';
import { productionServiceExecutorUnavailable } from './production-paid-services';
import { buildResultAuthorizationRuntime } from '../security/request-principal';
import { consumeVerifiedPrincipal } from '../security/verified-principal-context';

const RELEASE_SELECTION = '3.0.0-public-candidate';

function compositionEnv(env: Env) {
  return {
    PAID_RECEIPT_SIGNING_PRIVATE_KEY: env.PAID_RECEIPT_SIGNING_PRIVATE_KEY,
    PAID_RECEIPT_SIGNING_KEY_ID: env.PAID_RECEIPT_SIGNING_KEY_ID,
    SELLER_WALLET_ADDRESS: env.SELLER_WALLET_ADDRESS,
    CDP_API_KEY_ID: env.CDP_API_KEY_ID,
    CDP_API_KEY_SECRET: env.CDP_API_KEY_SECRET,
    PAYMENT_ENVIRONMENT: env.PAYMENT_ENVIRONMENT,
    PRODUCTION_ENABLED: env.PRODUCTION_ENABLED,
    HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP: env.HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP,
    PRODUCTION_CDP_CREDENTIALS_APPROVED: env.PRODUCTION_CDP_CREDENTIALS_APPROVED,
    MODAL_WEBCTX_ENDPOINT_URL: env.MODAL_WEBCTX_ENDPOINT_URL,
    MODAL_WEBCTX_PROXY_KEY: env.MODAL_WEBCTX_PROXY_KEY,
    MODAL_WEBCTX_PROXY_SECRET: env.MODAL_WEBCTX_PROXY_SECRET,
    MODAL_DOCWORKER_ENDPOINT_URL: env.MODAL_DOCWORKER_ENDPOINT_URL,
    MODAL_DOCWORKER_PROXY_KEY: env.MODAL_DOCWORKER_PROXY_KEY,
    MODAL_DOCWORKER_PROXY_SECRET: env.MODAL_DOCWORKER_PROXY_SECRET,
    JWT_RUNTIME_DIAGNOSTIC_ENABLED: env.JWT_RUNTIME_DIAGNOSTIC_ENABLED,
  };
}

function buyerCandidateEnabled(env: Env, serviceGate: (env: Env) => boolean): boolean {
  return env.BUYER_AUTHORIZED_V3_ROUTE_ENABLED === 'true' && serviceGate(env);
}

function configureBuyerAuthorization(
  env: Env,
  config: X402ServiceRouteConfig
): X402ServiceRouteConfig | { unavailable: true; reason: string } {
  let runtime: ReturnType<typeof buildResultAuthorizationRuntime>;
  try {
    runtime = buildResultAuthorizationRuntime(env);
  } catch (error) {
    return {
      unavailable: true,
      reason: error instanceof Error ? error.message : 'invalid auth config',
    };
  }
  if (!runtime) return { unavailable: true, reason: 'result authorization is not configured' };
  config.resultAuthorization = {
    authenticate: (requestContext) =>
      Promise.resolve(consumeVerifiedPrincipal(requestContext.req.raw)).then(
        (principal) => principal ?? runtime!.authenticate(requestContext.req.raw)
      ),
    subjectReferenceKey: runtime.subjectReferenceKey,
    revokedSubjectRefs: runtime.revokedSubjectRefs,
  };
  return config;
}

async function serveCandidate(
  c: Context<{ Bindings: Env }>,
  routeEnabled: (env: Env) => boolean,
  build: () => Promise<X402ServiceRouteConfig | { unavailable: true; reason: string }>
): Promise<Response> {
  if (
    !c.env ||
    c.env.RESULT_CONTRACT_RELEASE_SELECTION !== RELEASE_SELECTION ||
    !routeEnabled(c.env)
  ) {
    return c.notFound();
  }
  if (
    !c.env.ARTIFACTS ||
    !c.env.PAID_CONTINUATION_WORKFLOW ||
    !c.env.PAYMENT_CONTINUATION_ENCRYPTION_KEY
  ) {
    return productionServiceExecutorUnavailable(c);
  }

  const config = await build();
  if ('unavailable' in config) return productionServiceExecutorUnavailable(c);
  config.workflow = c.env.PAID_CONTINUATION_WORKFLOW;
  config.continuationEnvelopeKey = await importContinuationEnvelopeKey(
    c.env.PAYMENT_CONTINUATION_ENCRYPTION_KEY
  );
  config.resultArtifactReader = new PccResultArtifactStore(
    new R2ArtifactStoreAdapter(c.env.ARTIFACTS, 'results/pcc/')
  );
  const app = new Hono();
  createX402ServiceRoute(app, config);
  return app.request(c.req.raw);
}

export function companyEvidenceGraphV3CandidateRoute(
  c: Context<{ Bindings: Env }>
): Promise<Response> {
  return serveCandidate(c, isCompanyEvidenceGraphV2CdpRouteFlagEnabled, () =>
    buildCompanyEvidenceGraphV2CdpProductionRouteConfig(
      compositionEnv(c.env),
      c.env.DB,
      undefined,
      'company_evidence_graph.v3'
    )
  );
}

export function webContextVerifiedV3CandidateRoute(
  c: Context<{ Bindings: Env }>
): Promise<Response> {
  return serveCandidate(c, isWebContextV2CdpRouteFlagEnabled, () =>
    buildWebContextV2CdpProductionRouteConfig(
      compositionEnv(c.env),
      c.env.DB,
      undefined,
      'web_context_verified.v3'
    )
  );
}

export function documentEvidenceJsonV3CandidateRoute(
  c: Context<{ Bindings: Env }>
): Promise<Response> {
  return serveCandidate(
    c,
    (env) => buyerCandidateEnabled(env, isDocumentEvidenceJsonV2CdpRouteFlagEnabled),
    async () => {
      const artifacts = new R2ArtifactStoreAdapter(c.env.ARTIFACTS, 'documents/');
      const built = await buildDocumentEvidenceJsonV2CdpProductionRouteConfig(
        compositionEnv(c.env),
        c.env.DB,
        artifacts,
        undefined,
        'document_evidence_json.v3'
      );
      return 'unavailable' in built ? built : configureBuyerAuthorization(c.env, built);
    }
  );
}

export function verifyAgentOutputV3CandidateRoute(
  c: Context<{ Bindings: Env }>
): Promise<Response> {
  return serveCandidate(
    c,
    (env) => buyerCandidateEnabled(env, isVerifyAgentOutputV2CdpRouteFlagEnabled),
    async () => {
      const built = await buildVerifyAgentOutputV2CdpProductionRouteConfig(
        compositionEnv(c.env),
        c.env.DB,
        undefined,
        'verify_agent_output.v3'
      );
      return 'unavailable' in built ? built : configureBuyerAuthorization(c.env, built);
    }
  );
}
