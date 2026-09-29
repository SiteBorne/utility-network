import { describe, expect, it } from 'vitest';
import { evaluateCostBound, type CostBound } from '../src/control-plane/config/economic-bound-gate';
import { buildEconomicObservation } from '../../../packages/evidence-graph/src/index';

const now = new Date('2026-01-01T00:00:00Z');
const cap = { amount_atomic: '1000', currency: 'USDC' };
const ok: CostBound = { amount_atomic: '900', currency: 'USDC', source: 'PROVIDER_QUOTE' };
const reason = (b: any, c: any = cap) => (evaluateCostBound(b, c, now) as any).reason;

describe('R3-58A cost-bound gate fails closed', () => {
  it('passes only for an authoritative bound <= cap', () => {
    expect(evaluateCostBound(ok, cap, now).proceed_to_other_checks).toBe(true);
    expect(evaluateCostBound({ ...ok, amount_atomic: '1000', source: 'PROVIDER_CONTRACT_MAX' }, cap, now).proceed_to_other_checks).toBe(true);
  });
  it('denies over cap, missing, wrong currency, expired, no cap', () => {
    expect(reason({ ...ok, amount_atomic: '1001' })).toBe('bound_exceeds_launch_cap');
    expect(reason(null)).toBe('bound_missing');
    expect(reason({ amount_atomic: null, currency: null, source: null })).toBe('bound_missing');
    expect(reason({ ...ok, currency: 'USD' })).toBe('currency_mismatch');
    expect(reason({ ...ok, expires_at: '2025-12-31T00:00:00Z' })).toBe('bound_expired');
    expect(reason({ ...ok, expires_at: 'garbage' })).toBe('bound_expired');
    expect(reason(ok, null)).toBe('launch_cap_missing');
    expect(reason({ ...ok, amount_atomic: '-1' })).toBe('bound_malformed');
  });
  it('Jev advisory and internal estimates never satisfy the bound', () => {
    expect(reason({ ...ok, source: 'JEV_ADVISORY' })).toBe('bound_not_authoritative');
    expect(reason({ ...ok, source: 'INTERNAL_ESTIMATE' })).toBe('bound_not_authoritative');
  });
});

describe('R3-58A capture contract', () => {
  const base = { payment_identifier: 'p', environment: 'local' as const, currency: 'USDC', observed_at: '2026-01-01T00:00:00Z' };
  const q = (v: string, quality: any) => ({ value: v, quality, source: 's' });
  it('a bound is never an actual and an estimate never carries an amount', async () => {
    await expect(buildEconomicObservation({ ...base, kind: 'POST_EXECUTION_ACTUAL', bound: q('1', 'AUTHORITATIVE_AVAILABLE') })).rejects.toThrow(/not allowed/);
    await expect(buildEconomicObservation({ ...base, kind: 'PRE_EXECUTION_BOUND', cash_cogs: q('1', 'AUTHORITATIVE_AVAILABLE') })).rejects.toThrow(/not allowed/);
    await expect(buildEconomicObservation({ ...base, kind: 'ESTIMATE', cash_cogs: q('1', 'AUTHORITATIVE_AVAILABLE') })).rejects.toThrow(/not allowed/);
    await expect(buildEconomicObservation({ ...base, kind: 'PRE_EXECUTION_BOUND', bound: q('1', 'ESTIMATE_ONLY') })).rejects.toThrow();
    const o = await buildEconomicObservation({ ...base, kind: 'PRE_EXECUTION_BOUND', bound: q('5', 'AUTHORITATIVE_AVAILABLE') });
    expect(o.row.bound_atomic).toBe('5');
    expect(o.row.cash_cogs_atomic).toBeNull();
    expect(o.row.authority).toBe('NONE');
  });
});
