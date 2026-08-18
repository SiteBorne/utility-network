/**
 * SUN-0800B checkpoint 2 — deterministic tests for
 * `resolveAgentCardSigningIdentity`. No network, no real secrets; the test
 * key pair is generated ephemerally and never stored in repository state.
 */
import { describe, expect, it } from 'vitest';
import {
  resolveAgentCardSigningIdentity,
  AgentCardSigningConfigError,
} from '../src/control-plane/config/agent-card-signing';

async function generateTestPrivateJwkJson(): Promise<string> {
  const keyPair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const exported = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  return JSON.stringify(exported);
}

describe('resolveAgentCardSigningIdentity', () => {
  it('returns undefined (fall back to ephemeral local identity) when neither value is configured', async () => {
    const identity = await resolveAgentCardSigningIdentity({});
    expect(identity).toBeUndefined();
  });

  it('fails closed on a partial configuration -- key present, keyId absent', async () => {
    const privateKey = await generateTestPrivateJwkJson();
    await expect(
      resolveAgentCardSigningIdentity({ AGENT_CARD_SIGNING_PRIVATE_KEY: privateKey })
    ).rejects.toThrow(AgentCardSigningConfigError);
  });

  it('fails closed on a partial configuration -- keyId present, key absent', async () => {
    await expect(
      resolveAgentCardSigningIdentity({ AGENT_CARD_SIGNING_KEY_ID: 'siteborne-a2a-es256-2026-01' })
    ).rejects.toThrow(AgentCardSigningConfigError);
  });

  it('fails closed on malformed (non-JSON) key material', async () => {
    await expect(
      resolveAgentCardSigningIdentity({
        AGENT_CARD_SIGNING_PRIVATE_KEY: 'not-json-at-all',
        AGENT_CARD_SIGNING_KEY_ID: 'siteborne-a2a-es256-2026-01',
      })
    ).rejects.toThrow(AgentCardSigningConfigError);
  });

  it('fails closed on structurally invalid key material (missing private "d")', async () => {
    const keyPair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    const publicOnly = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    await expect(
      resolveAgentCardSigningIdentity({
        AGENT_CARD_SIGNING_PRIVATE_KEY: JSON.stringify(publicOnly),
        AGENT_CARD_SIGNING_KEY_ID: 'siteborne-a2a-es256-2026-01',
      })
    ).rejects.toThrow(AgentCardSigningConfigError);
  });

  it('constructs a real signing identity when both values are validly configured', async () => {
    const privateKey = await generateTestPrivateJwkJson();
    const identity = await resolveAgentCardSigningIdentity({
      AGENT_CARD_SIGNING_PRIVATE_KEY: privateKey,
      AGENT_CARD_SIGNING_KEY_ID: 'siteborne-a2a-es256-2026-01',
    });
    expect(identity).toBeDefined();
    expect(identity!.jwks.keys[0]).toMatchObject({ kid: 'siteborne-a2a-es256-2026-01' });
    expect(identity!.jwks.keys[0]).not.toHaveProperty('d');
  });
});
