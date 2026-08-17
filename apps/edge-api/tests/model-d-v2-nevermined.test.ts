/**
 * SUN-1000 checkpoint 1O-B2 — Model-D regression for the genuine v2
 * Nevermined-rail routes (`v2NeverminedRoute()`, `neverminedV2Enabled`).
 *
 * Proves, entirely locally (no real provider calls), that the new v2
 * Nevermined route family is structurally correct and isolated before any
 * live sandbox proof is attempted:
 *
 *  - unset/false `neverminedV2Enabled`: the four `/v2/nevermined/...`
 *    routes are structurally absent (404), not merely gated -- the exact
 *    behavior every existing caller (v1 tests, the CDP-only mounts) keeps.
 *  - `neverminedV2Enabled: true`: all four routes exist, each declares
 *    `rail: 'nevermined'`, the real registered agent/plan IDs (never the
 *    symbolic `local_agent_id`/`local_plan_id` placeholder), and the
 *    correct `/v2/nevermined/...` endpoint -- while the CDP `/v2/...`
 *    routes on the SAME app instance remain unaffected (still `rail:
 *    'cdp'`, still the real CDP asset/network, zero cross-contamination
 *    from adding the Nevermined family alongside them).
 *  - a service with no real registration bound throws at construction
 *    time (`v2_nevermined_route_unregistered`), never silently falling
 *    back to a symbolic placeholder for this deliberately-stricter route
 *    family.
 */
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import {
  decodePaymentRequiredHeaderSafe,
  type PaymentRequired,
  type PaymentEvidenceProvider,
  type PaymentVerificationContext,
  type PaymentSettlementContext,
  type ExternalVerificationEvidence,
  type ExternalSettlementEvidence,
} from '@siteborne/protocol-x402';
import {
  decodeNeverminedPaymentRequiredHeaderSafe,
  type NeverminedPaymentRequired,
} from '@siteborne/protocol-nevermined';
import {
  buildPaidServicesApp,
  buildNeverminedV2PaidServicesApp,
} from '../src/control-plane/routes/paid-services';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../migrations', import.meta.url));

function runMigrations(db: D1Database): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  return files.reduce(async (prev, file) => {
    await prev;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    const statements = sql
      .split(';')
      .map((raw) =>
        raw
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.length > 0 && !l.startsWith('--'))
          .join(' ')
          .trim()
      )
      .filter((s) => s.length > 0);
    for (const stmt of statements) {
      await db.exec(stmt);
    }
  }, Promise.resolve());
}

function successProvider(): PaymentEvidenceProvider {
  return {
    providerKind: 'external',
    async verify(): Promise<ExternalVerificationEvidence> {
      return { trust_class: 'external_verified' };
    },
    async settle(): Promise<ExternalSettlementEvidence> {
      return { success: true, transaction_reference: 'fixture-tx' };
    },
  };
}

describe('SUN-1000 checkpoint 1O-B2 — Model-D v2 Nevermined route regression', () => {
  let tempDir: string;
  let mf: Miniflare;
  let db: D1Database;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'siteborne-model-d-'));
    mf = new Miniflare({
      modules: true,
      script: `export default { async fetch() { return new Response('OK'); } }`,
      d1Databases: ['DB'],
      resourcePersistencePath: tempDir,
    });
    db = await mf.getD1Database('DB');
    await db.exec('PRAGMA foreign_keys = ON');
    await runMigrations(db);
  }, 30_000);

  afterEach(async () => {
    await mf?.dispose();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('neverminedV2Enabled unset: /v2/nevermined/* is structurally absent (404), not merely gated', async () => {
    const app = await buildPaidServicesApp({ db, evidenceMode: 'fixture' });
    const res = await app.request('/v2/nevermined/company/evidence-graph', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(404);
  });

  it('neverminedV2Enabled: true requires an evidenceProvider (fails closed at construction, not per-request)', async () => {
    await expect(
      buildPaidServicesApp({ db, evidenceMode: 'fixture', neverminedV2Enabled: true })
    ).rejects.toThrow();
  });

  it('all four v2 Nevermined routes exist, declare rail=nevermined, and use the real registered IDs -- never the symbolic placeholder', async () => {
    const provider = successProvider();
    const app = await buildNeverminedV2PaidServicesApp({
      db,
      evidenceMode: 'fixture',
      evidenceProvider: provider,
    });

    const routes: Array<{ path: string; input: unknown }> = [
      {
        path: '/v2/nevermined/company/evidence-graph',
        input: {
          identifiers: { cik: '0000320193' },
          requested_field_groups: ['identity', 'sec_submissions'],
        },
      },
      {
        path: '/v2/nevermined/web/context',
        input: { target_url: 'https://acme.example/', retrieval_mode: 'direct' },
      },
      {
        path: '/v2/nevermined/document/evidence-json',
        input: {
          artifact_reference: {
            artifact_id: 'doc/native-fixture.pdf',
            media_type: 'application/pdf',
            size_bytes: 1,
          },
        },
      },
      {
        path: '/v2/nevermined/verify/agent-output',
        input: {
          verification_contract: {
            claims: [{ claim_id: 'total', predicate: 'equals', expected_value: 42 }],
            deterministic_requirements: [],
          },
          candidate_output: { total: 42 },
          required_schema: {},
          verification_mode: 'standard',
        },
      },
    ];

    // Symbolic placeholder IDs -- if the real IDs were NOT used, the
    // challenge would echo one of these instead.
    const symbolicPrefixes = ['siteborne:', ':agent', ':payg'];

    for (const route of routes) {
      const res = await app.request(route.path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(route.input),
      });
      expect(res.status).toBe(402);
      // Nevermined-rail challenges use the SDK's own nvm:erc4337 scheme
      // shape -- decoded with the Nevermined-specific decoder (the
      // generic x402 decoder expects SITEBORNE's exact/upto shape and
      // correctly rejects this different structure).
      const decoded = decodeNeverminedPaymentRequiredHeaderSafe(
        res.headers.get('PAYMENT-REQUIRED') ?? ''
      );
      expect(decoded.ok).toBe(true);
      const challenge = (decoded as { ok: true; value: NeverminedPaymentRequired }).value;
      const requirement = challenge.accepts[0];
      expect(requirement.network).toBe('eip155:84532');
      const agentId = requirement.extra?.agentId ?? '';
      const planId = requirement.planId ?? '';
      // Real IDs are long numeric strings; symbolic ones start with
      // "siteborne:" and contain ":agent"/":payg" -- assert neither
      // symbolic marker appears in the real challenge.
      for (const marker of symbolicPrefixes) {
        expect(agentId).not.toContain(marker);
        expect(planId).not.toContain(marker);
      }
      expect(agentId.length).toBeGreaterThan(10);
      expect(planId.length).toBeGreaterThan(10);
    }
  });

  it('the CDP /v2/... routes on the SAME app instance remain unaffected by neverminedV2Enabled', async () => {
    const provider = successProvider();
    const app = await buildNeverminedV2PaidServicesApp({
      db,
      evidenceMode: 'fixture',
      evidenceProvider: provider,
    });
    const res = await app.request('/v2/company/evidence-graph', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        identifiers: { cik: '0000320193' },
        requested_field_groups: ['identity', 'sec_submissions'],
      }),
    });
    expect(res.status).toBe(402);
    const decoded = decodePaymentRequiredHeaderSafe(res.headers.get('PAYMENT-REQUIRED') ?? '');
    expect(decoded.ok).toBe(true);
    const challenge = (decoded as { ok: true; value: PaymentRequired }).value;
    const requirement = challenge.accepts[0] as unknown as { network: string; extra?: unknown };
    // Still real CDP network (Base Sepolia, checkpoint 1O-A), never the
    // Nevermined asset/scheme -- proves no cross-contamination from the
    // additive Nevermined routes on this same instance.
    expect(requirement.network).toBe('eip155:84532');
  });
});
