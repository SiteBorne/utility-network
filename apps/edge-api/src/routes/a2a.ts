import { createSiteborneA2aHonoApp, type CreateSiteborneA2aOptions } from '@siteborne/protocol-a2a';
import type { Context } from 'hono';
import type { Env } from '../control-plane/config/env';
import { resolveAgentCardSigningIdentity } from '../control-plane/config/agent-card-signing';

const A2A_ALLOWED_HOSTS = [
  'utility.siteborne.net',
  'localhost',
  '127.0.0.1',
  '[::1]',
  'test.local',
] as const;

let cachedA2aAppPromise: ReturnType<typeof createSiteborneA2aHonoApp> | undefined;

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
 */
function resolveA2aApp(
  env: Pick<Env, 'AGENT_CARD_SIGNING_PRIVATE_KEY' | 'AGENT_CARD_SIGNING_KEY_ID'>
): ReturnType<typeof createSiteborneA2aHonoApp> {
  if (!cachedA2aAppPromise) {
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
 * otherwise the same ephemeral local identity as before); protocol-a2a
 * creates fresh task and request-handler state for every POST. The default
 * execution boundary is closed and cannot perform useful work without the
 * accepted x402 path.
 */
export async function a2aRoute(context: Context<{ Bindings: Env }>): Promise<Response> {
  return (await resolveA2aApp(context.env ?? {})).fetch(context.req.raw);
}
