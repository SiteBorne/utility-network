/**
 * METADATA-VCM-IMPL-04A §XX: integration-level mutation tests beyond the
 * pure comparator/runner unit tests -- prove that even when the *real*
 * route wiring feeds a deliberately wrong or throwing VCM projection into
 * `shadow_compare`, the served Agent Card is completely unaffected and the
 * failure is only ever visible as telemetry. `@siteborne/vcm` is
 * module-mocked in this file only (Vitest per-file isolation), so it does
 * not affect any other test's real-data parity assertions.
 */
import { AgentCard } from '@a2a-js/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actualVcm = await vi.importActual<typeof import('@siteborne/vcm')>('@siteborne/vcm');

vi.mock('@siteborne/vcm', async () => {
  const actual = await vi.importActual<typeof import('@siteborne/vcm')>('@siteborne/vcm');
  return { ...actual };
});

describe('A2A metadata shadow_compare -- adversarial VCM behavior never reaches the served card', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('a VCM projection with a missing skill never changes the served card, and is recorded as a mismatch', async () => {
    const vcmModule = await import('@siteborne/vcm');
    const spy = vi
      .spyOn(vcmModule, 'projectA2aFromVcm')
      .mockImplementation((effective, context) => {
        const real = actualVcm.projectA2aFromVcm(effective, context);
        return { ...real, skills: real.skills.slice(1) };
      });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { app } = await import('../src/index');
    const response = await app.request(
      '/.well-known/agent-card.json',
      { headers: { Host: 'test.local' } },
      { A2A_METADATA_PROJECTION_MODE: 'shadow_compare' } as never
    );
    const card = AgentCard.fromJSON(await response.json());
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(response.status).toBe(200);
    expect(card.skills).toHaveLength(8); // real, unaffected by the mutated shadow

    const lines = [...logSpy.mock.calls, ...errorSpy.mock.calls]
      .map((call) => {
        try {
          return JSON.parse(call[0] as string);
        } catch {
          return undefined;
        }
      })
      .filter(Boolean) as Record<string, unknown>[];
    expect(
      lines.some((l) => l.event === 'metadata_projection_fallback_total' && l.surface === 'a2a')
    ).toBe(true);
    expect(
      lines.some(
        (l) => l.event === 'metadata_projection_mismatch_total' && (l.differenceCount as number) > 0
      )
    ).toBe(true);

    spy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('a throwing VCM projection never changes the served card, and never propagates to the response', async () => {
    const vcmModule = await import('@siteborne/vcm');
    const spy = vi.spyOn(vcmModule, 'projectA2aFromVcm').mockImplementation(() => {
      throw new Error('VCM projector exploded');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { app } = await import('../src/index');
    const response = await app.request(
      '/.well-known/agent-card.json',
      { headers: { Host: 'test.local' } },
      { A2A_METADATA_PROJECTION_MODE: 'shadow_compare' } as never
    );
    const card = AgentCard.fromJSON(await response.json());
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(response.status).toBe(200);
    expect(card.skills).toHaveLength(8);
    expect(card.signatures).toHaveLength(1);

    spy.mockRestore();
    errorSpy.mockRestore();
  });
});
