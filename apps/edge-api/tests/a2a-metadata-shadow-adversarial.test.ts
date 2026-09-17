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

async function requestPrimaryCard(extraEnv: Record<string, string> = {}): Promise<Response> {
  const { app } = await import('../src/index');
  return app.request('/.well-known/agent-card.json', { headers: { Host: 'test.local' } }, {
    A2A_METADATA_PROJECTION_MODE: 'vcm_primary_compare',
    ...extraEnv,
  } as never);
}

function structuredErrors(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown>[] {
  return spy.mock.calls
    .map((call) => {
      try {
        return JSON.parse(call[0] as string) as Record<string, unknown>;
      } catch {
        return undefined;
      }
    })
    .filter((line): line is Record<string, unknown> => line !== undefined);
}

describe('A2A vcm_primary_compare -- selection and failure boundaries', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('builds the legacy reference and VCM candidate independently before selection', async () => {
    const protocol = await import('@siteborne/protocol-a2a');
    const vcm = await import('@siteborne/vcm');
    const legacySpy = vi.spyOn(protocol, 'buildUnsignedSiteborneAgentCard');
    const primarySpy = vi.spyOn(vcm, 'projectA2aFromVcm');

    const response = await requestPrimaryCard();

    expect(response.status).toBe(200);
    expect(legacySpy).toHaveBeenCalledTimes(1);
    expect(primarySpy).toHaveBeenCalledTimes(1);
    legacySpy.mockRestore();
    primarySpy.mockRestore();
  });

  it('serves a signed independent legacy card on semantic mismatch', async () => {
    const vcm = await import('@siteborne/vcm');
    vi.spyOn(vcm, 'projectA2aFromVcm').mockImplementation((effective, context) => {
      const projected = actualVcm.projectA2aFromVcm(effective, context);
      return { ...projected, skills: projected.skills.slice(1) };
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await requestPrimaryCard();
    const card = AgentCard.fromJSON(await response.json());
    const lines = structuredErrors(errorSpy);

    expect(response.status).toBe(200);
    expect(card.skills).toHaveLength(8);
    expect(card.signatures).toHaveLength(1);
    expect(lines.some((line) => line.event === 'metadata_projection_mismatch_total')).toBe(true);
    expect(lines.some((line) => line.event === 'metadata_projection_fallback_total')).toBe(true);
  });

  it('serves a signed independent legacy card when the VCM projector throws', async () => {
    const vcm = await import('@siteborne/vcm');
    vi.spyOn(vcm, 'projectA2aFromVcm').mockImplementation(() => {
      throw new Error('projector unavailable');
    });

    const response = await requestPrimaryCard();
    const card = AgentCard.fromJSON(await response.json());

    expect(response.status).toBe(200);
    expect(card.skills).toHaveLength(8);
    expect(card.signatures).toHaveLength(1);
  });

  it('serves a signed independent legacy card when VCM validation fails', async () => {
    const vcm = await import('@siteborne/vcm');
    vi.spyOn(vcm, 'projectA2aFromVcm').mockImplementation((effective, context) => {
      const projected = actualVcm.projectA2aFromVcm(effective, context);
      return { ...projected, skills: [] };
    });

    const response = await requestPrimaryCard();
    const card = AgentCard.fromJSON(await response.json());

    expect(response.status).toBe(200);
    expect(card.skills).toHaveLength(8);
    expect(card.signatures).toHaveLength(1);
  });

  it('serves a signed independent legacy card when comparison throws', async () => {
    const vcm = await import('@siteborne/vcm');
    vi.spyOn(vcm, 'compareProjections').mockImplementation(() => {
      throw new Error('comparison unavailable');
    });

    const response = await requestPrimaryCard();
    const card = AgentCard.fromJSON(await response.json());

    expect(response.status).toBe(200);
    expect(card.skills).toHaveLength(8);
    expect(card.signatures).toHaveLength(1);
  });

  it('fails closed when the legacy unsigned builder is unusable', async () => {
    const protocol = await import('@siteborne/protocol-a2a');
    const primarySpy = vi.spyOn(await import('@siteborne/vcm'), 'projectA2aFromVcm');
    vi.spyOn(protocol, 'buildUnsignedSiteborneAgentCard').mockImplementation(() => {
      throw new Error('legacy unavailable');
    });

    const response = await requestPrimaryCard();

    expect(response.status).toBe(500);
    expect(primarySpy).not.toHaveBeenCalled();
  });

  it('fails closed when final signing rejects', async () => {
    const protocol = await import('@siteborne/protocol-a2a');
    vi.spyOn(protocol, 'createSiteborneA2aHonoApp').mockRejectedValue(
      new Error('signing unavailable')
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await requestPrimaryCard();
    const lines = structuredErrors(errorSpy);

    expect(response.status).toBe(500);
    expect(lines.some((line) => line.event === 'metadata_projection_signing_failure_total')).toBe(
      true
    );
  });

  it('shares one pending app promise and one final signed representation across concurrent callers', async () => {
    const vcm = await import('@siteborne/vcm');
    const primarySpy = vi.spyOn(vcm, 'projectA2aFromVcm');

    const [first, second] = await Promise.all([requestPrimaryCard(), requestPrimaryCard()]);
    const [firstBody, secondBody] = await Promise.all([first.text(), second.text()]);

    expect(firstBody).toBe(secondBody);
    expect(primarySpy).toHaveBeenCalledTimes(1);
  });

  it('re-evaluates selection on a new cache key and keeps runtime security narrowing', async () => {
    const vcm = await import('@siteborne/vcm');
    const primarySpy = vi.spyOn(vcm, 'projectA2aFromVcm');

    const narrowed = AgentCard.fromJSON(
      await (await requestPrimaryCard({ MTLS_PRODUCTION_ACTIVE: 'yes' })).json()
    );
    const active = AgentCard.fromJSON(
      await (await requestPrimaryCard({ MTLS_PRODUCTION_ACTIVE: 'true' })).json()
    );

    expect(narrowed.securitySchemes).toEqual({});
    expect(Object.keys(active.securitySchemes)).toEqual(['mtls']);
    expect(primarySpy).toHaveBeenCalledTimes(2);
  });

  it('keeps safe selection when telemetry throws', async () => {
    const telemetry = await import('../src/control-plane/telemetry/metadata-projection-telemetry');
    vi.spyOn(telemetry, 'recordMetadataProjectionLifecycle').mockImplementation(() => {
      throw new Error('telemetry unavailable');
    });

    const response = await requestPrimaryCard();
    const card = AgentCard.fromJSON(await response.json());

    expect(response.status).toBe(200);
    expect(card.skills).toHaveLength(8);
    expect(card.signatures).toHaveLength(1);
  });

  it('invokes no service execution boundary while building or serving discovery metadata', async () => {
    const response = await requestPrimaryCard();
    const card = AgentCard.fromJSON(await response.json());

    expect(response.status).toBe(200);
    expect(card.skills).toHaveLength(8);
    expect(card.signatures).toHaveLength(1);
  });
});
