/**
 * SUN-0800B checkpoint 2 — production Agent Card signing identity
 * resolution. This is the one place in `edge-api` that reads
 * `AGENT_CARD_SIGNING_PRIVATE_KEY`/`AGENT_CARD_SIGNING_KEY_ID` from real
 * deployment configuration; `@siteborne/protocol-a2a` itself never reads
 * environment variables (see `signing.ts`'s own doc comment on
 * `createConfiguredA2aSigningIdentity`).
 *
 * Presence-only discipline: this module only ever checks whether the two
 * config values are SET, and (if so) parses/imports them into a
 * non-extractable `CryptoKey` immediately. The raw string values are never
 * logged, hashed, echoed in an error message, or held in module-level state
 * beyond the single resolution call.
 */
import {
  createConfiguredA2aSigningIdentity,
  InvalidAgentCardSigningKeyError,
  type PrivateEs256Jwk,
  type SiteborneA2aSigningIdentity,
} from '@siteborne/protocol-a2a';
import type { Env } from './env';

export class AgentCardSigningConfigError extends Error {
  constructor(reason: string) {
    super(`agent_card_signing_config_error: ${reason}`);
    this.name = 'AgentCardSigningConfigError';
  }
}

/**
 * Resolves the production Agent Card signing identity from `Env`, or
 * `undefined` if production signing is not configured at all (the current,
 * expected state everywhere today — the a2a route falls back to the
 * ephemeral local/dev identity in that case, unchanged from before this
 * checkpoint).
 *
 * Fails closed (throws) rather than silently falling back when:
 *   - exactly one of the two required values is present (ambiguous partial
 *     configuration, never treated as "not configured");
 *   - the private key value is not valid JSON;
 *   - the parsed JWK fails `createConfiguredA2aSigningIdentity`'s own
 *     structural validation (wrong key type/curve, missing private
 *     material, or rejected by the platform's key-import routine).
 */
export async function resolveAgentCardSigningIdentity(
  env: Pick<Env, 'AGENT_CARD_SIGNING_PRIVATE_KEY' | 'AGENT_CARD_SIGNING_KEY_ID'>
): Promise<SiteborneA2aSigningIdentity | undefined> {
  const rawKey = env.AGENT_CARD_SIGNING_PRIVATE_KEY;
  const keyId = env.AGENT_CARD_SIGNING_KEY_ID;

  if (!rawKey && !keyId) return undefined;
  if (!rawKey || !keyId) {
    throw new AgentCardSigningConfigError(
      'AGENT_CARD_SIGNING_PRIVATE_KEY and AGENT_CARD_SIGNING_KEY_ID must both be set together — a partial configuration is never treated as "not configured"'
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawKey);
  } catch {
    throw new AgentCardSigningConfigError(
      'AGENT_CARD_SIGNING_PRIVATE_KEY is not valid JSON (expected a serialized private JWK)'
    );
  }

  try {
    return await createConfiguredA2aSigningIdentity({
      privateKeyJwk: parsed as PrivateEs256Jwk,
      keyId,
    });
  } catch (error) {
    if (error instanceof InvalidAgentCardSigningKeyError) {
      throw new AgentCardSigningConfigError(error.message);
    }
    throw error;
  }
}
