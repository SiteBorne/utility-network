/**
 * R3-57A — migration 0016 (economic observation ledger) on Miniflare D1 with
 * every migration applied. Local only. Additive, append-only, unknown stays
 * unknown, authority pinned NONE.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import {
  buildEconomicObservation,
  deriveCreditBenefit,
} from '../../../packages/evidence-graph/src/index';

const DIR = fileURLToPath(new URL('../../../migrations', import.meta.url));
const stmts = (f: string) =>
  readFileSync(join(DIR, f), 'utf8')
    .split(/;(?!\s*END\b)/)
    .map((r) => r.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('--')).join(' ').trim())
    .filter(Boolean);

const INSERT = `INSERT INTO economic_observations (observation_id,payment_identifier,service_id,provider_id,execution_id,environment,platform_version_id,currency,revenue_atomic,normalized_cogs_atomic,cash_cogs_atomic,credit_benefit_atomic,observation_kind,bound_atomic,observed_at,authority,body_jcs) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(observation_id) DO NOTHING`;
const COLS = ['observation_id','payment_identifier','service_id','provider_id','execution_id','environment','platform_version_id','currency','revenue_atomic','normalized_cogs_atomic','cash_cogs_atomic','credit_benefit_atomic','observation_kind','bound_atomic','observed_at','authority','body_jcs'];

const q = (value: string | null, quality: any, source: string | null = 'test') => ({ value, quality, source });

describe('migration 0016 economic_observations', () => {
  let mf: Miniflare;
  let db: D1Database;
  beforeAll(async () => {
    mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response(null) } }', d1Databases: { DB: 'eo' } });
    db = (await mf.getD1Database('DB')) as unknown as D1Database;
    for (const f of readdirSync(DIR).filter((n) => n.endsWith('.sql') && n <= '0016_economic_observations.sql').sort())
      for (const s of stmts(f)) await db.exec(s);
  });
  afterAll(async () => { await mf?.dispose(); });
  const put = (o: { row: Record<string, string | null> }) =>
    db.prepare(INSERT).bind(...COLS.map((c) => o.row[c])).run();
  const count = async () => (await db.prepare('SELECT COUNT(*) n FROM economic_observations').first<{ n: number }>())!.n;

  const base = { payment_identifier: 'pay_x', environment: 'local' as const, currency: 'USDC', observed_at: '2026-01-01T00:00:00Z' };

  it('stores unknowns as NULL, never zero', async () => {
    const o = await buildEconomicObservation({ ...base, kind: 'REVENUE', revenue: q('1000', 'AUTHORITATIVE_AVAILABLE', 'x402.settle') });
    await put(o);
    const r = await db.prepare('SELECT * FROM economic_observations WHERE observation_id=?').bind(o.observation_id).first<any>();
    expect(r.revenue_atomic).toBe('1000');
    expect(r.normalized_cogs_atomic).toBeNull();
    expect(r.cash_cogs_atomic).toBeNull();
    expect(r.credit_benefit_atomic).toBeNull();
    expect(r.authority).toBe('NONE');
  });

  it('derives CreditBenefit only from both operands', async () => {
    const o = await buildEconomicObservation({ ...base, kind: 'POST_EXECUTION_ACTUAL', payment_identifier: 'pay_y',
      normalized_cogs: q('500', 'AUTHORITATIVE_AVAILABLE', 'prov.list'), cash_cogs: q('120', 'AUTHORITATIVE_AVAILABLE', 'prov.bill') });
    expect(JSON.parse(o.body_jcs).credit_benefit.value).toBe('380');
    await put(o);
    expect(deriveCreditBenefit(q('5', 'DERIVABLE'), q(null, 'NOT_AVAILABLE', null)).value).toBeNull();
    expect(deriveCreditBenefit(q('5', 'DERIVABLE'), q('9', 'DERIVABLE')).value).toBeNull();
  });

  it('rejects estimates recorded as values, and malformed amounts', async () => {
    await expect(buildEconomicObservation({ ...base, kind: 'POST_EXECUTION_ACTUAL', cash_cogs: q('1', 'ESTIMATE_ONLY') })).rejects.toThrow(/ESTIMATE_ONLY/);
    await expect(buildEconomicObservation({ ...base, kind: 'POST_EXECUTION_ACTUAL', cash_cogs: q('-1', 'DERIVABLE') })).rejects.toThrow();
    await expect(buildEconomicObservation({ ...base, kind: 'POST_EXECUTION_ACTUAL', cash_cogs: q('1', 'DERIVABLE', null) })).rejects.toThrow(/source/);
  });

  it('DB rejects inconsistent credit benefit, non-NONE authority, bad body', async () => {
    const o = await buildEconomicObservation({ ...base, kind: 'REVENUE', payment_identifier: 'pay_z', revenue: q('7', 'DERIVABLE') });
    await expect(put({ row: { ...o.row, normalized_cogs_atomic: '10', cash_cogs_atomic: '3', credit_benefit_atomic: '99' } })).rejects.toThrow();
    await expect(put({ row: { ...o.row, authority: 'EXECUTE' } })).rejects.toThrow();
    await expect(put({ row: { ...o.row, currency: 'EUR' } })).rejects.toThrow();
  });

  it('identical re-insert is a no-op; different body under same id raises', async () => {
    const o = await buildEconomicObservation({ ...base, kind: 'REVENUE', payment_identifier: 'pay_idem', revenue: q('1', 'DERIVABLE') });
    await put(o);
    const n = await count();
    await put(o);
    expect(await count()).toBe(n);
    const tampered = { ...o.row, body_jcs: o.row.body_jcs!.replace('"1"', '"2"'), revenue_atomic: '2' };
    await expect(put({ row: tampered })).rejects.toThrow();
  });

  it('UPDATE and DELETE are rejected with zero row change', async () => {
    const n = await count();
    await expect(db.prepare("UPDATE economic_observations SET currency='X'").run()).rejects.toThrow(/append-only/);
    await expect(db.prepare('DELETE FROM economic_observations').run()).rejects.toThrow(/append-only/);
    expect(await count()).toBe(n);
  });

  it('DB refuses an estimate/bound/actual column mix and an unknown kind', async () => {
    const o = await buildEconomicObservation({ ...base, kind: 'POST_EXECUTION_ACTUAL', payment_identifier: 'pay_k', cash_cogs: q('5', 'AUTHORITATIVE_AVAILABLE') });
    const bad = (mut: Record<string, string | null>) => put({ row: { ...o.row, ...mut } });
    await expect(bad({ observation_kind: 'ESTIMATE' })).rejects.toThrow();
    await expect(bad({ observation_kind: 'REVENUE' })).rejects.toThrow();
    await expect(bad({ observation_kind: 'BOGUS' })).rejects.toThrow();
    await expect(bad({ bound_atomic: '1' })).rejects.toThrow();
  });

  it('re-running 0016 on an already-migrated database is a no-op', async () => {
    const before = await count();
    for (const s of stmts('0016_economic_observations.sql')) await db.exec(s);
    expect(await count()).toBe(before);
  });
});
