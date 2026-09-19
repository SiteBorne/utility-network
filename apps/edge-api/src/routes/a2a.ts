import {
  buildUnsignedSiteborneAgentCard,
  createSiteborneA2aHonoApp,
  type CreateSiteborneA2aOptions,
} from '@siteborne/protocol-a2a';
import { AgentCard } from '@a2a-js/sdk';
import {
  buildRealA2aShadowContext,
  getRuntimeEffectiveView,
  projectA2aFromVcm,
} from '@siteborne/vcm';
import type { Context } from 'hono';
import type { Env } from '../control-plane/config/env';
import { resolveAgentCardSigningIdentity } from '../control-plane/config/agent-card-signing';
import {
  resolveEffectiveProductionStatusByServiceId,
  resolvePublicPaymentDestination,
  type EffectiveDiscoveryEnv,
} from '../control-plane/config/production-payment';
import type { PaymentDestination, SiteborneServiceId } from '@siteborne/protocol-x402';
import { resolveMtlsProductionActive } from '../control-plane/config/mtls-production-capability';
import {
  parseMetadataProjectionMode,
  resolveAuthorizedMetadataProjectionMode,
} from '../control-plane/config/metadata-projection-mode';
import { runShadowComparison } from '../control-plane/metadata/shadow-comparison-runner';
import { selectPrimaryProjection } from '../control-plane/metadata/primary-comparison-selector';
import { recordMetadataProjectionLifecycle } from '../control-plane/telemetry/metadata-projection-telemetry';

/** Unreleased/dev builds have no real git SHA available; `getRuntimeEffectiveView`
 * only uses this as a cache/provenance key, never to gate behavior, so a
 * fixed placeholder is correct here (VCM-06 never requires a real commit
 * for `shadow_compare`, only for a future `QualificationRecord`, out of
 * this checkpoint's scope). */
const UNRELEASED_RUNTIME_SOURCE_COMMIT = '0'.repeat(40);

/** METADATA-VCM-06 §IX/§XI, METADATA-VCM-IMPL-04A: run only at this same
 * per-isolate cache-rebuild point, never per request. Uses the identical
 * `effectiveProductionStatusByServiceId`/`mtlsProductionActive` values the
 * real card already builds from, so both producers see byte-identical
 * overlay inputs (VCM-06 §IX). Never awaited by the caller for its
 * result -- `runShadowComparison` returns `void` and can only ever affect
 * telemetry, never the served card. VCM never receives
 * `AGENT_CARD_SIGNING_PRIVATE_KEY`/`_KEY_ID`; this runs entirely on
 * unsigned card content, before the signing boundary below. */
function scheduleA2aShadowComparison(
  mode: 'legacy' | 'shadow_compare',
  effectiveProductionStatusByServiceId: Partial<Record<SiteborneServiceId, boolean>>,
  mtlsProductionActive: boolean,
  paymentDestination: PaymentDestination | null
): Promise<void> {
  if (mode !== 'shadow_compare') return Promise.resolve();
  return runShadowComparison({
    surface: 'a2a',
    existing: buildUnsignedSiteborneAgentCard(
      effectiveProductionStatusByServiceId,
      mtlsProductionActive,
      paymentDestination
    ),
    buildShadow: async () => {
      const effective = await getRuntimeEffectiveView(UNRELEASED_RUNTIME_SOURCE_COMMIT);
      const context = buildRealA2aShadowContext(
        effectiveProductionStatusByServiceId,
        mtlsProductionActive,
        paymentDestination
      );
      return projectA2aFromVcm(effective, context);
    },
    governedDifferences: [
      {
        pathPattern: /^signatures/,
        classification: 'INTENTIONAL_GOVERNED_DIFFERENCE',
        reason: 'Signing is a separate boundary; both sides are pre-signature.',
      },
    ],
  });
}

function validateVcmUnsignedAgentCard(candidate: AgentCard): void {
  if (candidate.signatures.length > 0) {
    throw new Error('VCM Agent Card projection must be unsigned');
  }
  if (
    !candidate.name ||
    candidate.supportedInterfaces.length === 0 ||
    candidate.skills.length === 0
  ) {
    throw new Error('VCM Agent Card projection is missing required discovery content');
  }
  const skillIds = candidate.skills.map((skill) => skill.id);
  if (new Set(skillIds).size !== skillIds.length || skillIds.some((id) => id.length === 0)) {
    throw new Error('VCM Agent Card projection contains invalid skill identities');
  }
}

function recordA2aSigningFailure(): void {
  try {
    recordMetadataProjectionLifecycle({
      event: 'metadata_projection_signing_failure_total',
      surface: 'a2a',
      mode: 'vcm_primary_compare',
      reason: 'signing',
    });
  } catch {
    // Telemetry is observational and cannot change fail-closed signing.
  }
}

const A2A_ALLOWED_HOSTS = [
  'utility.siteborne.net',
  'siteborne-utility-edge.siteborneutilitynetwork.workers.dev',
  'localhost',
  '127.0.0.1',
  '[::1]',
  'test.local',
] as const;

let cachedA2aAppPromise: ReturnType<typeof createSiteborneA2aHonoApp> | undefined;
let cachedA2aAppCacheKey: string | undefined;

type A2aAppEnv = Pick<
  Env,
  | 'AGENT_CARD_SIGNING_PRIVATE_KEY'
  | 'AGENT_CARD_SIGNING_KEY_ID'
  | 'DB'
  | 'MTLS_PRODUCTION_ACTIVE'
  | 'A2A_METADATA_PROJECTION_MODE'
  | 'PAYMENT_ENVIRONMENT'
  | 'PRODUCTION_ENABLED'
  | 'HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP'
  | 'PRODUCTION_CDP_CREDENTIALS_APPROVED'
> &
  EffectiveDiscoveryEnv;

/** Defensive fallback matching `x402-service.ts#safeGetExecutionCtx` --
 * `c.executionCtx` throws when no real `ExecutionContext` was bound (true
 * of plain `app.request(path, init)` calls in this repo's own test
 * suites), so a background task without one just runs un-awaited instead
 * of via `waitUntil`. `runShadowComparison` never rejects, so this is safe
 * either way. */
function safeGetExecutionCtx(
  c: Context
): { waitUntil(promise: Promise<unknown>): void } | undefined {
  try {
    return c.executionCtx;
  } catch {
    return undefined;
  }
}

/** `context.env` is optional in Hono's generic `Context` typing (every
 * other route in this file's neighborhood -- e.g.
 * `production-verify-v2-cdp-route.ts` -- reaches it via `c.env?.…` for
 * the same reason). `Env`'s three CDP/D1 binding fields are declared
 * required (never `?`), so a structurally valid fallback needs explicit
 * empty values for exactly those -- everything else in `A2aAppEnv` is
 * already optional and correctly resolves to "false" through each
 * registered resolver's own gate checks when absent, unchanged from this
 * file's behavior before SUN-1220P2. */
const EMPTY_A2A_APP_ENV: A2aAppEnv = {
  SELLER_WALLET_ADDRESS: '',
  CDP_API_KEY_ID: '',
  CDP_API_KEY_SECRET: '',
  DB: undefined as unknown as Env['DB'],
};

/**
 * SUN-0800B checkpoint 2: reads `AGENT_CARD_SIGNING_PRIVATE_KEY`/
 * `AGENT_CARD_SIGNING_KEY_ID` from real deployment config (never logged);
 * if configured, the served Agent Card is signed with the real production
 * identity. If entirely absent (the state everywhere today — no
 * production signing key has been provisioned), falls back to the same
 * ephemeral local/dev identity this route has always used. A PARTIAL
 * configuration (one of the two values set, not both) fails closed —
 * `resolveAgentCardSigningIdentity` throws rather than silently choosing
 * either path.
 *
 * SUN-1220P2: also computes every registered service's version-local
 * effective discovery status from the exact same gates that govern real
 * execution (`EFFECTIVE_DISCOVERY_RESOLVERS`) and injects the resulting
 * map into the card -- `packages/protocol-a2a/src/card.ts`'s own
 * `effectiveProductionStatusByServiceId` param was already typed
 * `Partial<Record<SiteborneServiceId, boolean>>` from SUN-1220P2, so
 * SUN-1221C's addition of a second registered service (`web_context_
 * verified.v2`) required zero change there -- only this call site's map
 * gained a second key. Within one running Worker version/isolate, `env`
 * is static, so this is still computed once and cached -- but the cache
 * key now also covers every computed boolean (not only the signing
 * fields) so a changed input can never serve a stale card: real
 * deployments never change `env` mid-isolate, but tests exercising
 * multiple env states against the same imported `app` singleton would
 * otherwise observe the first-built card forever.
 *
 * SUN-1222C-DEPLOYMENT-DEPENDENCY-AND-MTLS-TRUTHFULNESS-REMEDIATION: also
 * resolves `MTLS_PRODUCTION_ACTIVE` (default `false`) via
 * `resolveMtlsProductionActive` and injects it into
 * `mtlsProductionActive`, the sole gate for whether the served card may
 * truthfully declare `securitySchemes.mtls` -- included in the cache key
 * below for the same reason every other computed boolean already is.
 */
function resolveA2aApp(
  env: A2aAppEnv,
  scheduleBackground: (promise: Promise<unknown>) => void = () => undefined
): ReturnType<typeof createSiteborneA2aHonoApp> {
  const hasDb = Boolean(env.DB);
  const effectiveProductionStatusByServiceId = resolveEffectiveProductionStatusByServiceId(
    env,
    hasDb
  );
  const mtlsProductionActive = resolveMtlsProductionActive(env);
  // PRODUCTION-ECONOMICS-DISCOVERY-01: public projection of the governed
  // payment destination (`null` = not configured); same real gates the paid
  // routes use, no secret read.
  const paymentDestination = resolvePublicPaymentDestination(env);
  // METADATA-VCM-IMPL-04A: included in the cache key alongside every other
  // computed input, for the same reason `mtlsProductionActive` is (see the
  // SUN-1220P2/SUN-1222C doc comment above) -- a real deployment never
  // changes `env` mid-isolate (mode is baked into a Worker Version at
  // creation, VCM-06 §XVIII), but this keeps the cache-rebuild point (and
  // therefore the comparison scheduled at it) correctly re-entered by any
  // test exercising multiple modes against the same imported `app`.
  const authorizedMode = resolveAuthorizedMetadataProjectionMode(
    parseMetadataProjectionMode(env.A2A_METADATA_PROJECTION_MODE, 'a2a'),
    'a2a'
  );
  const cacheKey = JSON.stringify([
    env.AGENT_CARD_SIGNING_PRIVATE_KEY ?? '',
    env.AGENT_CARD_SIGNING_KEY_ID ?? '',
    effectiveProductionStatusByServiceId,
    mtlsProductionActive,
    authorizedMode,
    paymentDestination,
  ]);
  if (!cachedA2aAppPromise || cachedA2aAppCacheKey !== cacheKey) {
    cachedA2aAppCacheKey = cacheKey;
    // Assigned synchronously (an async IIFE, not an `await` before the
    // assignment) so a concurrent second caller sees `cachedA2aAppPromise`
    // already set before this function's first `await` ever yields --
    // otherwise two requests racing in before either resolves would each
    // independently build their OWN signing identity (e.g. two different
    // ephemeral key pairs), and whichever assignment won the race would
    // silently serve a JWKS that doesn't match the OTHER request's already
    // -signed Agent Card, breaking signature verification unpredictably.
    cachedA2aAppPromise = (async () => {
      const signingIdentity = await resolveAgentCardSigningIdentity(env);
      const options: CreateSiteborneA2aOptions = {
        allowedHosts: A2A_ALLOWED_HOSTS,
        allowedOrigins: A2A_ALLOWED_HOSTS,
        ...(signingIdentity ? { signingIdentity } : {}),
        effectiveProductionStatusByServiceId,
        mtlsProductionActive,
        paymentDestination,
      };
      if (authorizedMode === 'shadow_compare') {
        // METADATA-VCM-06 §IX: scheduled at this exact cache-rebuild point,
        // not per request. Runs on unsigned content only, entirely before
        // (and independent of) the signing call `createSiteborneA2aHonoApp`
        // performs internally -- VCM never sees `signingIdentity`.
        scheduleBackground(
          scheduleA2aShadowComparison(
            authorizedMode,
            effectiveProductionStatusByServiceId,
            mtlsProductionActive,
            paymentDestination
          )
        );
      }

      if (authorizedMode === 'vcm_primary_compare') {
        const selection = await selectPrimaryProjection({
          surface: 'a2a',
          buildLegacy: () =>
            buildUnsignedSiteborneAgentCard(
              effectiveProductionStatusByServiceId,
              mtlsProductionActive,
              paymentDestination
            ),
          buildPrimary: async () => {
            const effective = await getRuntimeEffectiveView(UNRELEASED_RUNTIME_SOURCE_COMMIT);
            const context = buildRealA2aShadowContext(
              effectiveProductionStatusByServiceId,
              mtlsProductionActive,
              paymentDestination
            );
            const projected = projectA2aFromVcm(effective, context);
            const candidate = AgentCard.fromJSON(
              AgentCard.toJSON(projected as unknown as AgentCard)
            );
            // The SDK decoder materializes an absent optional iconUrl as an
            // empty string. Preserve the projector's actual absence so the
            // strict semantic comparison observes the authored shape.
            if (!Object.hasOwn(projected, 'iconUrl')) delete candidate.iconUrl;
            return candidate;
          },
          validatePrimary: validateVcmUnsignedAgentCard,
          governedDifferences: [
            {
              pathPattern: /^signatures/,
              classification: 'INTENTIONAL_GOVERNED_DIFFERENCE',
              reason: 'Signing is a separate boundary; both sides are pre-signature.',
            },
          ],
        });
        options.unsignedAgentCard = selection.selected;
      }

      try {
        return await createSiteborneA2aHonoApp(options);
      } catch (error) {
        if (authorizedMode === 'vcm_primary_compare') recordA2aSigningFailure();
        throw error;
      }
    })();
  }
  return cachedA2aAppPromise;
}

/**
 * A2A v1 edge route. The cached app owns only its immutable signing
 * identity/card/JWKS (production-configured if
 * `AGENT_CARD_SIGNING_PRIVATE_KEY`/`AGENT_CARD_SIGNING_KEY_ID` are set,
 * otherwise the same ephemeral local identity as before) plus the
 * version-local discovery overlay computed above; protocol-a2a creates
 * fresh task and request-handler state for every POST. The default
 * execution boundary is closed and cannot perform useful work without the
 * accepted x402 path.
 */
export async function a2aRoute(context: Context<{ Bindings: Env }>): Promise<Response> {
  const executionCtx = safeGetExecutionCtx(context);
  const scheduleBackground = executionCtx
    ? (promise: Promise<unknown>) => executionCtx.waitUntil(promise)
    : (promise: Promise<unknown>) => {
        void promise;
      };
  return (await resolveA2aApp(context.env ?? EMPTY_A2A_APP_ENV, scheduleBackground)).fetch(
    context.req.raw
  );
}
