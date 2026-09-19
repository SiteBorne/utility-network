/**
 * PRODUCTION-ECONOMICS-DISCOVERY-01: the A2A Agent Card's per-service
 * `economics` block under `vcm_primary_compare` with a real-shaped public
 * payment destination. Proves (1) the VCM-projected card is still SELECTED
 * (compare matches, no fallback) now that it carries economics, and (2) what is
 * served equals the canonical projection -- including network/asset/payTo and
 * unavailable modes -- for every service.
 */
import { describe, expect, it, vi } from 'vitest';
import { projectServiceEconomics, ECONOMIC_SERVICE_IDS } from '@siteborne/protocol-x402';
import { app } from '../src/index';

const PAY_TO = '0x2222222222222222222222222222222222222222';
const PRODUCTION_ENV = {
  A2A_METADATA_PROJECTION_MODE: 'vcm_primary_compare',
  SELLER_WALLET_ADDRESS: PAY_TO,
  PAYMENT_ENVIRONMENT: 'production',
  PRODUCTION_ENABLED: 'true',
  HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP: 'true',
  PRODUCTION_CDP_CREDENTIALS_APPROVED: 'true',
  PAID_ROUTES_ENABLED: 'false',
};

function logLines(spies: ReturnType<typeof vi.spyOn>[]): Record<string, unknown>[] {
  const lines: Record<string, unknown>[] = [];
  for (const spy of spies) {
    for (const call of spy.mock.calls) {
      try {
        lines.push(JSON.parse(call[0] as string));
      } catch {
        /* unrelated log line */
      }
    }
  }
  return lines;
}

describe('A2A card economics under vcm_primary_compare with a public payment destination', () => {
  it('selects the VCM card (no fallback) and serves the canonical economics for all services', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await app.request(
      '/.well-known/agent-card.json',
      { headers: { Host: 'test.local' } },
      PRODUCTION_ENV as never
    );
    const lines = logLines([logSpy, errorSpy]);
    logSpy.mockRestore();
    errorSpy.mockRestore();
    expect(response.status).toBe(200);

    const events = lines.map((l) => String(l.event));
    expect(events).toContain('metadata_projection_primary_success_total');
    expect(events).toContain('metadata_projection_match_total');
    expect(events.filter((e) => /mismatch|fallback|failure/.test(e))).toEqual([]);

    const card = (await response.json()) as {
      capabilities: {
        extensions: { params: { services: { serviceId: string; economics: unknown }[] } }[];
      };
    };
    const services = card.capabilities.extensions[0].params.services;
    expect(services.map((s) => s.serviceId)).toEqual([...ECONOMIC_SERVICE_IDS]);

    const destination = { network: 'eip155:8453', asset: expect.any(String), payTo: PAY_TO };
    for (const entry of services) {
      const economics = entry.economics as ReturnType<typeof projectServiceEconomics>;
      const expected = projectServiceEconomics(entry.serviceId as never, {
        productionEnabled: false,
        destination: { ...destination, asset: economics.payment!.asset },
      });
      expect(economics, entry.serviceId).toEqual(JSON.parse(JSON.stringify(expected)));
      expect(economics.payment).toMatchObject({ network: 'eip155:8453', pay_to: PAY_TO });
      expect(economics.production_enabled).toBe(false);
    }
    const web = services.find((s) => s.serviceId === 'web_context_verified.v2')!
      .economics as ReturnType<typeof projectServiceEconomics>;
    expect(web.available_modes).toEqual(['direct']);
    expect(web.modes.find((m) => m.mode === 'rendered')?.capability_available).toBe(false);
  });

  it('declares no destination (null, not a sentinel) when the address is absent or malformed', async () => {
    for (const bad of [
      { SELLER_WALLET_ADDRESS: '' },
      { SELLER_WALLET_ADDRESS: '0xnot-an-address' },
    ]) {
      const response = await app.request(
        '/.well-known/agent-card.json',
        { headers: { Host: 'test.local' } },
        { ...PRODUCTION_ENV, ...bad, A2A_METADATA_PROJECTION_MODE: 'vcm_primary_compare' } as never
      );
      const card = (await response.json()) as {
        capabilities: {
          extensions: { params: { services: { economics: { payment: unknown } }[] } }[];
        };
      };
      for (const entry of card.capabilities.extensions[0].params.services) {
        expect(entry.economics.payment).toBeNull();
      }
    }
  });
});
