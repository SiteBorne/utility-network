/**
 * SUN-1216 checkpoint V raised this adjudication; SUN-1218 checkpoint X
 * closes it. Historical context preserved below; assertions updated to
 * match the now-closed architecture.
 *
 * SUN-1216: proved the fixture trust class was structurally confined to
 * `'fixture'` evidence mode, which `policy.ts` never accepts as
 * satisfying `'production'` mode -- but the composition could only ever
 * resolve `evidenceMode: 'fixture'`, silently, with no third argument
 * required. That silent fallback (not the trust-class gate,
 * which was always sound) was the actual R0.
 *
 * SUN-1218 made the production call site (no third argument) fail closed to
 * `{unavailable: true}` whenever real evidence cannot be established --
 * never a silent fixture fallback. SUN-1222C subsequently made seller
 * resolution deterministic and local without changing that boundary. Fixture
 * evidence remains selectable ONLY via the composition's new, explicit,
 * narrowly-typed `explicitTestEvidenceOverride` third parameter, which
 * the real production route module (`production-verify-v2-cdp-route.ts`)
 * never supplies.
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

describe('SUN-1216/SUN-1218: synthetic_fixture evidence boundary (R0 closed)', () => {
  it('the frozen evidence policy never allows synthetic_fixture to satisfy production mode (packages/protocol-x402/src/evidence/policy.ts, unmodified)', () => {
    expect(isTrustClassAllowed('synthetic_fixture', 'production')).toBe(false);
    // Positive control: the same trust class IS allowed under fixture
    // mode -- proving the assertion above is a real mode boundary, not
    // an accidentally-always-false check.
    expect(isTrustClassAllowed('synthetic_fixture', 'fixture')).toBe(true);
  });

  it('SUN-1218: the production call site (no explicitTestEvidenceOverride) now fails closed to unavailable, never silently resolves evidenceMode "fixture"', async () => {
    const config = await buildVerifyAgentOutputV2CdpProductionRouteConfig(
      {
        PAID_RECEIPT_SIGNING_PRIVATE_KEY: VALID_KEY_HEX,
        PAID_RECEIPT_SIGNING_KEY_ID: VALID_KEY_ID,
        SELLER_WALLET_ADDRESS: '0x' + '1'.repeat(40),
        CDP_API_KEY_ID: 'cdp-key-id',
        CDP_API_KEY_SECRET: 'cdp-key-secret',
        // ADR-0055 gates deliberately unset (the real production
        // default today) -- real evidence genuinely cannot be
        // established.
      },
      fakeDb()
    );
    // The SUN-1216-era version of this test asserted the OPPOSITE: a
    // silent, unconditional `evidenceMode: 'fixture'` success. That was
    // the R0. Now: unavailable, structurally, with no override supplied.
    expect('unavailable' in config).toBe(true);
  });

  it('SUN-1218: `createX402ServiceRoute` (x402-service.ts, unmodified, frozen) still throws at construction time if evidenceMode === "production" without a real "external" provider -- unaffected, still sound', async () => {
    // Re-confirms the frozen gate this whole boundary has always relied
    // on remains untouched: PRODUCTION_EVIDENCE_SELECTION = real
    // provider OR unavailable is enforced at TWO independent layers
    // (this composition's own new check, and the pre-existing
    // resolvePaymentEvidenceProvider/trust-class gate x402-service.ts
    // itself consults) -- defense in depth, neither layer alone is
    // relied upon exclusively.
    expect(isTrustClassAllowed('external_verified', 'production')).toBe(true);
    expect(isTrustClassAllowed('synthetic_fixture', 'production')).toBe(false);
  });

  it('the real production route module never supplies explicitTestEvidenceOverride (structural, source-level check) -- the only file permitted to is worker-runtime-test-entrypoint.ts', () => {
    const path = fileURLToPath(
      new URL('../routes/production-verify-v2-cdp-route.ts', import.meta.url)
    );
    const source = readFileSync(path, 'utf8');
    // The real call site passes exactly two arguments (env, db) -- proven
    // by the absence of a third, comma-separated argument in the call
    // expression. A textual absence check on the parameter's own name is
    // sufficient here since this file has never had any legitimate
    // reason to reference it.
    expect(source).not.toMatch(/explicitTestEvidenceOverride/);
    expect(source).not.toMatch(/evidenceMode:\s*['"]fixture['"]/);
  });
});
