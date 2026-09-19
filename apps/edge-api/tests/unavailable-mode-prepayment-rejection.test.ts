/**
 * PRODUCTION-ECONOMICS-DISCOVERY-01 -- UNSUPPORTED_MODE_PRE_PAYMENT_REJECTION.
 *
 * `web_context_verified` `rendered` and `verify_agent_output`
 * `independent_reproduction` carry a governed price but no production
 * implementation. A request selecting either must be rejected BEFORE any
 * quote, 402 challenge, payment-header handling, authorization, job, or
 * provider invocation -- and must never be silently served by the available
 * mode. Proven against the real route boundary with a real (Miniflare) D1 so
 * "no economic state" is observed, not assumed.
 */
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { buildPaidServicesApp } from '../src/control-plane/routes/paid-services';

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
    for (const stmt of statements) await db.exec(stmt);
  }, Promise.resolve());
}

const WEB_INPUT = { target_url: 'https://acme.example/' };
const verifyInput = (mode: string) => ({
  verification_contract: {
    claims: [{ claim_id: 'total', predicate: 'equals', expected_value: 42 }],
    deterministic_requirements: [],
  },
  candidate_output: { total: 42 },
  required_schema: {},
  verification_mode: mode,
});

const ECONOMIC_TABLES = [
  'x402_quotes',
  'x402_service_results',
  'payment_attempts',
  'jobs',
  'job_attempts',
] as const;

describe('unavailable modes are rejected before any payment or economic step', () => {
  let tempDir: string;
  let mf: Miniflare;
  let db: D1Database;
  let app: Awaited<ReturnType<typeof buildPaidServicesApp>>;

  async function economicRowCount(): Promise<number> {
    let total = 0;
    for (const table of ECONOMIC_TABLES) {
      const row = await db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).first<{ c: number }>();
      total += row?.c ?? 0;
    }
    return total;
  }

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'siteborne-mode-prepay-'));
    mf = new Miniflare({
      modules: true,
      script: `export default { async fetch() { return new Response('OK'); } }`,
      d1Databases: ['DB'],
      resourcePersistencePath: tempDir,
    });
    db = await mf.getD1Database('DB');
    await db.exec('PRAGMA foreign_keys = ON');
    await runMigrations(db);
    app = await buildPaidServicesApp({ db, evidenceMode: 'fixture' });
  }, 30_000);

  afterAll(async () => {
    await mf?.dispose();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  const REJECTED = [
    ['/v2/web/context', { ...WEB_INPUT, retrieval_mode: 'rendered' }, 'retrieval_mode_unavailable'],
    ['/v1/web/context', { ...WEB_INPUT, retrieval_mode: 'rendered' }, 'retrieval_mode_unavailable'],
    [
      '/v2/verify/agent-output',
      verifyInput('independent_reproduction'),
      'verification_mode_unavailable',
    ],
    [
      '/v1/verify/agent-output',
      verifyInput('independent_reproduction'),
      'verification_mode_unavailable',
    ],
  ] as const;

  it.each(REJECTED)(
    '%s rejects the unavailable mode with a deterministic non-payment error',
    async (path, body, code) => {
      const before = await economicRowCount();
      const res = await app.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
      const json = (await res.json()) as { code?: string; error?: string; message: string };
      expect(json.code ?? json.error).toBe(code);
      expect(json.message).toContain('No quote was created and nothing was charged');
      expect(res.headers.get('PAYMENT-REQUIRED')).toBeNull();
      expect(await economicRowCount()).toBe(before);
    }
  );

  it.each(REJECTED)(
    '%s rejects before payment-header handling even when a payment header is presented',
    async (path, body, code) => {
      const before = await economicRowCount();
      const res = await app.request(path, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'PAYMENT-SIGNATURE': 'not-a-real-payment-signature',
        },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
      const json = (await res.json()) as { code?: string; error?: string };
      expect(json.code ?? json.error).toBe(code);
      expect(await economicRowCount()).toBe(before);
    }
  );

  it('does not silently substitute the available mode: nothing is executed or quoted', async () => {
    const res = await app.request('/v2/web/context', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...WEB_INPUT, retrieval_mode: 'rendered' }),
    });
    expect(res.status).not.toBe(402);
    expect(res.status).not.toBe(200);
  });

  it('positive control: the available modes still receive the normal 402 challenge', async () => {
    const web = await app.request('/v2/web/context', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...WEB_INPUT, retrieval_mode: 'direct' }),
    });
    expect(web.status).toBe(402);
    expect(web.headers.get('PAYMENT-REQUIRED')).toBeTruthy();
    const verify = await app.request('/v2/verify/agent-output', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(verifyInput('standard')),
    });
    expect(verify.status).toBe(402);
    expect(verify.headers.get('PAYMENT-REQUIRED')).toBeTruthy();
  });
});
