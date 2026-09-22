import { Hono } from 'hono';
import type { Context } from 'hono';
import { R2ArtifactStoreAdapter } from '../artifacts/store';
import type { Env } from '../config/env';
import {
  isCompanyEvidenceGraphV2CdpRouteFlagEnabled,
  isWebContextV2CdpRouteFlagEnabled,
} from '../config/production-payment';
import { importContinuationEnvelopeKey } from '../continuation/envelope';
import { PccResultArtifactStore } from '../results/pcc-result-artifact';
import { buildCompanyEvidenceGraphV2CdpProductionRouteConfig } from '../production/company-evidence-graph-v2-cdp-composition';
import { buildWebContextV2CdpProductionRouteConfig } from '../production/web-context-v2-cdp-composition';
import { createX402ServiceRoute, type X402ServiceRouteConfig } from './x402-service';
import { productionServiceExecutorUnavailable } from './production-paid-services';

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
  };
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
