import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildUnsignedSiteborneAgentCard } from '../card';
import { createLocalA2aSigningIdentity } from '../signing';

/**
 * R3-A2A-PRESENCE-SENSITIVITY-REGRESSION-AND-INTEROP-06.
 *
 * Proves, with the actual `@a2a-js/sdk` signing/verification path and a
 * deterministic local test-only key (never a production key, no network
 * dependency), which transformations of a signed Agent Card change its JCS
 * canonicalization (and therefore its signature) and which do not.
 *
 * This is the repository-authoritative re-derivation for
 * docs/development/A2A_AGENT_CARD_INTEROP_NOTE_AGENSTRY_2026-09-25.md --
 * the prior claim that this file already existed was false; this evidence
 * supersedes it.
 */

function suppressSdkInvalidSignatureDebug() {
  vi.spyOn(console, 'debug').mockImplementation(() => undefined);
}

afterEach(() => vi.restoreAllMocks());

function reverseObjectOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseObjectOrder);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .reverse()
      .map(([key, child]) => [key, reverseObjectOrder(child)])
  );
}

describe('Agent Card JWS: field-presence sensitivity under JCS canonicalization', () => {
  it('A. the original signed fixture verifies', async () => {
    const identity = await createLocalA2aSigningIdentity();
    const signed = await identity.sign(buildUnsignedSiteborneAgentCard());
    await expect(identity.verify(signed)).resolves.toBeUndefined();
  });

  it('B. a JSON parse/serialize round-trip still verifies', async () => {
    const identity = await createLocalA2aSigningIdentity();
    const signed = await identity.sign(buildUnsignedSiteborneAgentCard());
    const roundTripped = JSON.parse(JSON.stringify(signed));
    await expect(identity.verify(roundTripped)).resolves.toBeUndefined();
  });

  it('C. reversing top-level key order still verifies (JCS is order-insensitive)', async () => {
    const identity = await createLocalA2aSigningIdentity();
    const signed = await identity.sign(buildUnsignedSiteborneAgentCard());
    const reordered = reverseObjectOrder(signed) as typeof signed;
    await expect(identity.verify(reordered)).resolves.toBeUndefined();
  });

  it('D. reversing capabilities key order still verifies', async () => {
    const identity = await createLocalA2aSigningIdentity();
    const signed = await identity.sign(buildUnsignedSiteborneAgentCard());
    const mutated = structuredClone(signed);
    mutated.capabilities = reverseObjectOrder(mutated.capabilities) as typeof mutated.capabilities;
    await expect(identity.verify(mutated)).resolves.toBeUndefined();
  });

  it('E. materializing an absent optional field as an explicit value FAILS verification', async () => {
    suppressSdkInvalidSignatureDebug();
    const identity = await createLocalA2aSigningIdentity();
    const unsigned = buildUnsignedSiteborneAgentCard();
    delete (unsigned.capabilities as unknown as Record<string, unknown>).extendedAgentCard;
    const signed = await identity.sign(unsigned);
    expect(signed.capabilities).not.toHaveProperty('extendedAgentCard');

    const mutated = structuredClone(signed);
    (mutated.capabilities as unknown as Record<string, unknown>).extendedAgentCard = false;
    await expect(identity.verify(mutated)).rejects.toThrow();
    // the untouched original (field still absent) verifies fine
    await expect(identity.verify(signed)).resolves.toBeUndefined();
  });

  it('F. changing an explicit boolean field value FAILS verification', async () => {
    suppressSdkInvalidSignatureDebug();
    const identity = await createLocalA2aSigningIdentity();
    const signed = await identity.sign(buildUnsignedSiteborneAgentCard());
    const mutated = structuredClone(signed);
    (mutated.capabilities as unknown as Record<string, unknown>).extendedAgentCard = true;
    await expect(identity.verify(mutated)).rejects.toThrow();
  });

  it('G. removing an explicit `streaming: false` field FAILS verification', async () => {
    suppressSdkInvalidSignatureDebug();
    const identity = await createLocalA2aSigningIdentity();
    const signed = await identity.sign(buildUnsignedSiteborneAgentCard());
    const mutated = structuredClone(signed);
    delete (mutated.capabilities as unknown as Record<string, unknown>).streaming;
    await expect(identity.verify(mutated)).rejects.toThrow();
  });

  it('H. removing an explicit `pushNotifications: false` field FAILS verification', async () => {
    suppressSdkInvalidSignatureDebug();
    const identity = await createLocalA2aSigningIdentity();
    const signed = await identity.sign(buildUnsignedSiteborneAgentCard());
    const mutated = structuredClone(signed);
    delete (mutated.capabilities as unknown as Record<string, unknown>).pushNotifications;
    await expect(identity.verify(mutated)).rejects.toThrow();
  });

  it('I. whitespace/pretty-print formatting differences still verify', async () => {
    const identity = await createLocalA2aSigningIdentity();
    const signed = await identity.sign(buildUnsignedSiteborneAgentCard());
    const prettyPrinted = JSON.parse(JSON.stringify(signed, null, 2));
    await expect(identity.verify(prettyPrinted)).resolves.toBeUndefined();
  });
});
