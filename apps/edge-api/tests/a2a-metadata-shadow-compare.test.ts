/**
 * METADATA-VCM-IMPL-04A: A2A dual-render integration, compare-only. Proves
 * §XIX (default/absent config -> served output byte-identical to before
 * this checkpoint), §VI-§VII (shadow_compare serves legacy and computes +
 * compares the VCM projection, without ever altering the response), and
 * §XIV (an unauthorized future mode behaves exactly like legacy, not like
 * shadow_compare -- no second producer, no comparison).
 *
 * `resolveA2aApp`'s cache is keyed (in part) by the resolved projection
 * mode (routes/a2a.ts), so each `describe` block below uses its own
 * distinct mode value the first time it fetches, guaranteeing a fresh
 * cache (re)build -- the exact point the comparison logic runs -- occurs
 * while its log spies are already attached. A later fetch with the same
 * mode in the same block is a deliberate cache *hit*, used only to assert
 * on served content, not on logs.
 */
import { AgentCard } from '@a2a-js/sdk';
import { describe, expect, it, vi } from 'vitest';
import { app } from '../src/index';

async function fetchCard(extraEnv: Record<string, string> = {}): Promise<Response> {
  return app.request(
    '/.well-known/agent-card.json',
    { headers: { Host: 'test.local' } },
    extraEnv as never
  );
}

function collectStructuredLogLines(spies: {
  log: ReturnType<typeof vi.spyOn>;
  error: ReturnType<typeof vi.spyOn>;
}): Record<string, unknown>[] {
  const lines: Record<string, unknown>[] = [];
  for (const spy of [spies.log, spies.error]) {
    for (const call of spy.mock.calls) {
      try {
        lines.push(JSON.parse(call[0] as string));
      } catch {
        // non-JSON log line from an unrelated code path; ignore
      }
    }
  }
  return lines;
}

describe('A2A metadata projection mode -- default/absent (first use in this module)', () => {
  it('runs no VCM comparison at all when unset (zero steady-state overhead)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await fetchCard();
    expect(response.status).toBe(200);
    const lines = collectStructuredLogLines({ log: logSpy, error: errorSpy });
    expect(lines.some((l) => String(l.event).startsWith('metadata_projection_'))).toBe(false);
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('serves a byte-identical card whether the mode is absent or explicitly "legacy"', async () => {
    const withoutConfig = await fetchCard();
    const explicitLegacy = await fetchCard({ A2A_METADATA_PROJECTION_MODE: 'legacy' });
    const [a, b] = await Promise.all([withoutConfig.json(), explicitLegacy.json()]);
    // signatures are nondeterministic (ES256), so compare everything else.
    const strip = (card: Record<string, unknown>) => {
      const { signatures, ...rest } = card;
      return rest;
    };
    expect(strip(a as Record<string, unknown>)).toEqual(strip(b as Record<string, unknown>));
  });
});

describe('A2A metadata projection mode -- shadow_compare (first use in this module)', () => {
  it('computes and compares the VCM shadow projection and records a match (real data already proven parity)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await fetchCard({ A2A_METADATA_PROJECTION_MODE: 'shadow_compare' });
    expect(response.status).toBe(200);
    // isolate cache-rebuild comparison may be scheduled via waitUntil; give
    // any floating microtask/task a turn before asserting.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const lines = collectStructuredLogLines({ log: logSpy, error: errorSpy });
    expect(
      lines.some((l) => l.event === 'metadata_projection_compare_total' && l.surface === 'a2a')
    ).toBe(true);
    expect(
      lines.some((l) => l.event === 'metadata_projection_match_total' && l.surface === 'a2a')
    ).toBe(true);
    expect(lines.some((l) => l.event === 'metadata_projection_fallback_total')).toBe(false);
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('still serves the real signed legacy card (VCM never becomes the served producer)', async () => {
    const response = await fetchCard({ A2A_METADATA_PROJECTION_MODE: 'shadow_compare' });
    const card = AgentCard.fromJSON(await response.json());
    expect(response.status).toBe(200);
    expect(card.signatures).toHaveLength(1);
    expect(card.skills).toHaveLength(8);
  });
});

describe('A2A metadata projection mode -- unauthorized future modes refuse to serve VCM', () => {
  it('vcm_only behaves exactly like legacy: served card unchanged, zero comparison', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await fetchCard({ A2A_METADATA_PROJECTION_MODE: 'vcm_only' });
    const card = AgentCard.fromJSON(await response.json());
    expect(card.skills).toHaveLength(8);
    const lines = collectStructuredLogLines({ log: logSpy, error: errorSpy });
    expect(lines.some((l) => l.event === 'metadata_projection_mode_not_yet_authorized')).toBe(true);
    expect(lines.some((l) => String(l.event).startsWith('metadata_projection_compare'))).toBe(
      false
    );
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
