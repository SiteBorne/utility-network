import { createSiteborneA2aHonoApp, type CreateSiteborneA2aOptions } from '@siteborne/protocol-a2a';
import type { Context } from 'hono';
import type { Env } from '../control-plane/config/env';
import { resolveAgentCardSigningIdentity } from '../control-plane/config/agent-card-signing';
import {
  resolveEffectiveProductionStatusByServiceId,
  type EffectiveDiscoveryEnv,
} from '../control-plane/config/production-payment';

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

type A2aAppEnv = Pick<Env, 'AGENT_CARD_SIGNING_PRIVATE_KEY' | 'AGENT_CARD_SIGNING_KEY_ID' | 'DB'> &
  EffectiveDiscoveryEnv;

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
 */
function resolveA2aApp(env: A2aAppEnv): ReturnType<typeof createSiteborneA2aHonoApp> {
  const hasDb = Boolean(env.DB);
  const effectiveProductionStatusByServiceId = resolveEffectiveProductionStatusByServiceId(
    env,
    hasDb
  );
  const cacheKey = JSON.stringify([
    env.AGENT_CARD_SIGNING_PRIVATE_KEY ?? '',
    env.AGENT_CARD_SIGNING_KEY_ID ?? '',
    effectiveProductionStatusByServiceId,
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
      };
      return createSiteborneA2aHonoApp(options);
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
  return (await resolveA2aApp(context.env ?? EMPTY_A2A_APP_ENV)).fetch(context.req.raw);
}
