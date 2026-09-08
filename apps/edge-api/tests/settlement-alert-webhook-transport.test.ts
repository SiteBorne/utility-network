/**
 * SUN-1222C-R4-D12 — HTTPS webhook transport unit tests.
 *
 * `fetchImpl` is always a controlled test double — `REAL_WEBHOOK_CALLS=0`
 * (D12 §27/§33). No real network call is ever made from this file.
 */
import { describe, expect, it, vi } from 'vitest';
import { buildHttpsWebhookTransport } from '../src/control-plane/alerting/settlement-alert-webhook-transport';
import type { SettlementAlertPayload } from '../src/control-plane/alerting/settlement-alert-sweep';

const PAYLOAD: SettlementAlertPayload = {
  event: 'siteborne.settlement.manual_intervention_required',
  payment_identifier: 'pay_test',
  job_id: 'job_test',
  recovery_stage: 'ambiguous',
  first_observed_at: '2026-01-01T00:00:00.000Z',
  last_observed_at: '2026-01-01T00:05:00.000Z',
  reconciliation_attempts: 5,
  transaction_reference_present: false,
};

describe('SUN-1222C-R4-D12 buildHttpsWebhookTransport', () => {
  it('rejects a non-HTTPS URL at construction time', () => {
    expect(() => buildHttpsWebhookTransport('http://example.com/hook')).toThrow(/HTTPS/);
  });

  it('POSTs the exact payload as JSON and reports delivered:true on 2xx', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const transport = buildHttpsWebhookTransport('https://example.com/hook', { fetchImpl });
    const outcome = await transport(PAYLOAD);
    expect(outcome).toEqual({ delivered: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://example.com/hook');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(init?.redirect).toBe('manual');
    expect(JSON.parse(init?.body as string)).toEqual(PAYLOAD);
  });

  it('reports delivered:false on a 4xx response', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 404 }));
    const transport = buildHttpsWebhookTransport('https://example.com/hook', { fetchImpl });
    expect(await transport(PAYLOAD)).toEqual({ delivered: false });
  });

  it('reports delivered:false on a 5xx response', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 502 }));
    const transport = buildHttpsWebhookTransport('https://example.com/hook', { fetchImpl });
    expect(await transport(PAYLOAD)).toEqual({ delivered: false });
  });

  it('reports delivered:false on a 3xx response rather than following it', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302 }));
    const transport = buildHttpsWebhookTransport('https://example.com/hook', { fetchImpl });
    expect(await transport(PAYLOAD)).toEqual({ delivered: false });
  });

  it('reports delivered:false and never throws when fetch itself rejects', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('simulated network error');
    });
    const transport = buildHttpsWebhookTransport('https://example.com/hook', { fetchImpl });
    await expect(transport(PAYLOAD)).resolves.toEqual({ delivered: false });
  });

  it('aborts and reports delivered:false when the request exceeds the configured timeout', async () => {
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });
    const transport = buildHttpsWebhookTransport('https://example.com/hook', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 5,
    });
    await expect(transport(PAYLOAD)).resolves.toEqual({ delivered: false });
  });
});
