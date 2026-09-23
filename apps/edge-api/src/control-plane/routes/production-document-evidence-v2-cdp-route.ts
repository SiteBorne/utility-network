/**
 * SUN-1222B-S3R — bundle integration for `document_evidence_json.v2` /
 * CDP, mirroring `production-company-evidence-v2-cdp-route.ts` exactly.
 *
 * Registered for exactly `POST /v2/document/evidence-json`, mounted in
 * `index.ts` before the generic `app.all('/v2/*', ...)` 404 fallback.
 * Gated by `PAID_ROUTES_ENABLED` AND
 * `DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED` -- independent of the
 * other services' flags; default-absent on either -> 404.
 *
 * This is the one place that constructs `R2ArtifactStoreAdapter` from
 * `c.env.ARTIFACTS` -- which does not exist in the deployed production
 * Worker today (`ARTIFACTS` is commented out of `wrangler.toml`, SUN-0800B
 * checkpoint 3, "needs dashboard enablement first"). Until that real
 * external action happens, `c.env.ARTIFACTS` is `undefined` here and the
 * composition's own `!artifactStore` gate returns `unavailable: true` --
 * exactly the fail-closed shape every other missing-credential case
 * already produces, never a crash, never a fixture fallback.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { setPrecompiledOutputValidators } from '@siteborne/verification';
import type { Env } from '../config/env';
import { productionServiceExecutorUnavailable } from './production-paid-services';
import { createX402ServiceRoute } from './x402-service';
import { buildDocumentEvidenceJsonV2CdpProductionRouteConfig } from '../production/document-evidence-json-v2-cdp-composition';
import { isDocumentEvidenceJsonV2CdpRouteFlagEnabled } from '../config/production-payment';
import { outputValidatorsById } from '../../generated/output-validators.generated.js';
import { importContinuationEnvelopeKey } from '../continuation/envelope';
import { R2ArtifactStoreAdapter, DOCUMENT_ARTIFACT_KEY_PREFIX } from '../artifacts/store';

setPrecompiledOutputValidators(outputValidatorsById);

let cachedSubApp: Hono | undefined;
let cachedDb: Env['DB'] | undefined;

export async function documentEvidenceJsonV2CdpProductionRoute(
  c: Context<{ Bindings: Env }>
): Promise<Response> {
  if (!c.env || !isDocumentEvidenceJsonV2CdpRouteFlagEnabled(c.env)) {
    return c.notFound();
  }

  if (cachedSubApp && cachedDb === c.env.DB) {
    return cachedSubApp.request(c.req.raw);
  }

  const artifactStore = c.env.ARTIFACTS
    ? new R2ArtifactStoreAdapter(c.env.ARTIFACTS, DOCUMENT_ARTIFACT_KEY_PREFIX)
    : undefined;

  const config = await buildDocumentEvidenceJsonV2CdpProductionRouteConfig(
    {
      PAID_RECEIPT_SIGNING_PRIVATE_KEY: c.env.PAID_RECEIPT_SIGNING_PRIVATE_KEY,
      PAID_RECEIPT_SIGNING_KEY_ID: c.env.PAID_RECEIPT_SIGNING_KEY_ID,
      SELLER_WALLET_ADDRESS: c.env.SELLER_WALLET_ADDRESS,
      CDP_API_KEY_ID: c.env.CDP_API_KEY_ID,
      CDP_API_KEY_SECRET: c.env.CDP_API_KEY_SECRET,
      PAYMENT_ENVIRONMENT: c.env.PAYMENT_ENVIRONMENT,
      PRODUCTION_ENABLED: c.env.PRODUCTION_ENABLED,
      HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP: c.env.HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP,
      PRODUCTION_CDP_CREDENTIALS_APPROVED: c.env.PRODUCTION_CDP_CREDENTIALS_APPROVED,
      MODAL_DOCWORKER_ENDPOINT_URL: c.env.MODAL_DOCWORKER_ENDPOINT_URL,
      MODAL_DOCWORKER_PROXY_KEY: c.env.MODAL_DOCWORKER_PROXY_KEY,
      MODAL_DOCWORKER_PROXY_SECRET: c.env.MODAL_DOCWORKER_PROXY_SECRET,
    },
    c.env.DB,
    artifactStore
  );
  if ('unavailable' in config) {
    return productionServiceExecutorUnavailable(c);
  }

  if (!c.env.PAID_CONTINUATION_WORKFLOW || !c.env.PAYMENT_CONTINUATION_ENCRYPTION_KEY) {
    return productionServiceExecutorUnavailable(c);
  }
  config.workflow = c.env.PAID_CONTINUATION_WORKFLOW;
  config.continuationEnvelopeKey = await importContinuationEnvelopeKey(
    c.env.PAYMENT_CONTINUATION_ENCRYPTION_KEY
  );

  const subApp = new Hono();
  createX402ServiceRoute(subApp, config);
  cachedSubApp = subApp;
  cachedDb = c.env.DB;

  return subApp.request(c.req.raw);
}
