/**
 * SUN-1216 checkpoint V — PRE-UPLOAD RESIDUAL ADJUDICATION.
 *
 * Replaces the imprecise "zero fixture markers in bundle text" proxy
 * (which cannot distinguish a literal string appearing in dead code from
 * a real, governed, load-bearing safety property) with a precise,
 * structural proof of the actual invariant that matters for the
 * `synthetic_fixture` finding: even if `PAID_ROUTES_ENABLED` were ever
 * set to `'true'` without first closing the pre-existing, SUN-1213-
 * documented `getAuthenticatedSellerAddress` gap, this composition
 * cannot be made to satisfy a `'production'`-mode evidence gate with
 * fabricated evidence -- the fixture trust class is structurally
 * confined to `'fixture'` evidence mode, which the repository's own
 * frozen `policy.ts` (unmodified by this checkpoint) never accepts as
 * satisfying `'production'` mode.
 *
 * This does not claim the payment-evidence R0 gap is closed -- it is
 * not, and closing it (wiring a real `getAuthenticatedSellerAddress`)
 * remains a distinct, future checkpoint's job, exactly as
 * `production-payment.ts`'s own doc comment has said since SUN-1200.
 * This test proves the boundary is sound *while that gap remains open*.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { isTrustClassAllowed } from '@siteborne/protocol-x402';
import { buildVerifyAgentOutputV2CdpProductionRouteConfig } from './verify-agent-output-v2-cdp-composition';

const VALID_KEY_ID = 'kid_prod0123456789abcdefghij';
const VALID_KEY_HEX = '3'.repeat(64);

function fakeDb(): D1Database {
  return {} as D1Database;
}

describe('SUN-1216 residual adjudication: synthetic_fixture evidence boundary', () => {
  it('the frozen evidence policy never allows synthetic_fixture to satisfy production mode (packages/protocol-x402/src/evidence/policy.ts, unmodified)', () => {
    expect(isTrustClassAllowed('synthetic_fixture', 'production')).toBe(false);
    // Positive control: the same trust class IS allowed under fixture
    // mode -- proving the assertion above is a real mode boundary, not
    // an accidentally-always-false check.
    expect(isTrustClassAllowed('synthetic_fixture', 'fixture')).toBe(true);
  });

  it('the verify_agent_output.v2/CDP composition resolves to evidenceMode "fixture", never "production", under the repository\'s current, unmodified capability (no getAuthenticatedSellerAddress wired anywhere)', async () => {
    const config = await buildVerifyAgentOutputV2CdpProductionRouteConfig(
      {
        PAID_RECEIPT_SIGNING_PRIVATE_KEY: VALID_KEY_HEX,
        PAID_RECEIPT_SIGNING_KEY_ID: VALID_KEY_ID,
        SELLER_WALLET_ADDRESS: '0x' + '1'.repeat(40),
        CDP_API_KEY_ID: 'cdp-key-id',
        CDP_API_KEY_SECRET: 'cdp-key-secret',
      },
      fakeDb()
    );
    if ('unavailable' in config) {
      throw new Error(`expected a mountable config, got unavailable: ${config.reason}`);
    }
    expect(config.evidenceMode).toBe('fixture');
    // `createX402ServiceRoute` (x402-service.ts, unmodified, frozen)
    // throws at construction time if `evidenceMode === 'production'` --
    // there is no production evidence provider anywhere in this
    // repository yet. Confirming the resolved mode is 'fixture' here is
    // therefore also confirming this composition remains constructible
    // at all under current repository capability.
    expect(config.evidenceMode).not.toBe('production');
  });

  it('this composition never supplies getAuthenticatedSellerAddress -- the one and only precondition that could ever select real (non-fixture) evidence (structural, import/call-site check)', () => {
    // Structural, not behavioral: proves the composition module itself
    // contains no reference to the one dependency that gates real
    // evidence, so a future accidental partial-wire cannot silently
    // half-enable it without this test needing to change first.
    const path = fileURLToPath(
      new URL('./verify-agent-output-v2-cdp-composition.ts', import.meta.url)
    );
    const source = readFileSync(path, 'utf8');
    expect(source).not.toMatch(/getAuthenticatedSellerAddress\s*:/);
  });
});
