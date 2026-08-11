import { describe, expect, it, vi } from 'vitest';
import { NEVERMINED_ROUTES, executeOnSelectedRail, selectPaymentRail } from './index';

describe('buyer-surface-specific rail selection', () => {
  it.each([
    '/v1/company/evidence-graph',
    '/v1/web/context',
    '/v1/document/evidence-json',
    '/v1/verify/agent-output',
  ])('%s remains CDP-only', (route) => expect(selectPaymentRail(route)).toBe('cdp'));

  it.each(Object.values(NEVERMINED_ROUTES))('%s is Nevermined-only', (route) => {
    expect(selectPaymentRail(route)).toBe('nevermined');
  });

  it('Nevermined failure never falls back to CDP', async () => {
    const cdp = vi.fn(async () => 'cdp');
    const nevermined = vi.fn(async () => {
      throw new Error('verification rejected');
    });
    await expect(
      executeOnSelectedRail(NEVERMINED_ROUTES['company_evidence_graph.v1'], { cdp, nevermined })
    ).rejects.toThrow('verification rejected');
    expect(nevermined).toHaveBeenCalledTimes(1);
    expect(cdp).not.toHaveBeenCalled();
  });

  it('CDP failure never falls back to Nevermined', async () => {
    const cdp = vi.fn(async () => {
      throw new Error('settlement rejected');
    });
    const nevermined = vi.fn(async () => 'nevermined');
    await expect(
      executeOnSelectedRail('/v1/company/evidence-graph', { cdp, nevermined })
    ).rejects.toThrow('settlement rejected');
    expect(cdp).toHaveBeenCalledTimes(1);
    expect(nevermined).not.toHaveBeenCalled();
  });

  it('unknown routes fail closed without invoking either provider', async () => {
    const cdp = vi.fn();
    const nevermined = vi.fn();
    await expect(executeOnSelectedRail('/unknown', { cdp, nevermined })).rejects.toThrow(
      'unknown payment route'
    );
    expect(cdp).not.toHaveBeenCalled();
    expect(nevermined).not.toHaveBeenCalled();
  });
});
