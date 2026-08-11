import { createSiteborneA2aHonoApp, type CreateSiteborneA2aOptions } from '@siteborne/protocol-a2a';
import type { Context } from 'hono';
import type { Env } from '../control-plane/config/env';

const A2A_ALLOWED_HOSTS = [
  'utility.siteborne.net',
  'localhost',
  '127.0.0.1',
  '[::1]',
  'test.local',
] as const;

let cachedA2aAppPromise: ReturnType<typeof createSiteborneA2aHonoApp> | undefined;

async function resolveA2aApp() {
  if (!cachedA2aAppPromise) {
    const options: CreateSiteborneA2aOptions = {
      allowedHosts: A2A_ALLOWED_HOSTS,
      allowedOrigins: A2A_ALLOWED_HOSTS,
    };
    cachedA2aAppPromise = createSiteborneA2aHonoApp(options);
  }
  return cachedA2aAppPromise;
}

/**
 * Credential-independent A2A v1 edge route. The cached app owns only its
 * immutable local signing identity/card/JWKS; protocol-a2a creates fresh task
 * and request-handler state for every POST. The default execution boundary is
 * closed and cannot perform useful work without the accepted x402 path.
 */
export async function a2aRoute(context: Context<{ Bindings: Env }>): Promise<Response> {
  return (await resolveA2aApp()).fetch(context.req.raw);
}
