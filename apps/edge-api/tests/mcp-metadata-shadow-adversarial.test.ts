/**
 * METADATA-VCM-IMPL-04A §XX: integration-level mutation tests beyond the
 * pure comparator/runner unit tests -- prove that even when the *real*
 * route wiring feeds a deliberately wrong or throwing VCM tool projection
 * into `shadow_compare`, the served `tools/list` response is completely
 * unaffected, and no handler binding is ever touched (VCM only ever
 * supplies the `definition` argument's content to an existing,
 * unmoved `registerTool()` call site -- it never adds/removes a
 * registration itself).
 */
import * as protocolMcp from '@siteborne/protocol-mcp';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@siteborne/vcm', async () => {
  const actual = await vi.importActual<typeof import('@siteborne/vcm')>('@siteborne/vcm');
  return { ...actual };
});

vi.mock('@siteborne/protocol-mcp', async () => {
  const actual =
    await vi.importActual<typeof import('@siteborne/protocol-mcp')>('@siteborne/protocol-mcp');
  return { ...actual };
});

async function callToolsList(extraEnv: Record<string, string>): Promise<{
  response: Response;
  tools: Array<{ name: string }>;
}> {
  const { app } = await import('../src/index');
  const response = await app.request(
    '/mcp',
    {
      method: 'POST',
      headers: {
        Host: 'test.local',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    },
    { SELLER_WALLET_ADDRESS: '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1', ...extraEnv } as never
  );
  const text = await response.text();
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  const dataLine = text.split('\n').find((line) => line.startsWith('data:'));
  const parsed = contentType.includes('application/json')
    ? JSON.parse(text)
    : JSON.parse((dataLine ?? '').slice('data:'.length).trim());
  return { response, tools: parsed.result.tools };
}

function structuredLines(...spies: Array<ReturnType<typeof vi.spyOn>>): Record<string, unknown>[] {
  return spies
    .flatMap((spy) => spy.mock.calls)
    .map((call) => {
      try {
        return JSON.parse(call[0] as string) as Record<string, unknown>;
      } catch {
        return undefined;
      }
    })
    .filter((line): line is Record<string, unknown> => Boolean(line));
}

describe('MCP metadata shadow_compare -- adversarial VCM behavior never reaches the served tools/list', () => {
  it('a VCM tool list with a missing tool never changes the served response, and is recorded as a mismatch', async () => {
    vi.resetModules();
    const actualVcm = await vi.importActual<typeof import('@siteborne/vcm')>('@siteborne/vcm');
    const vcmModule = await import('@siteborne/vcm');
    const spy = vi
      .spyOn(vcmModule, 'projectMcpToolsFromVcm')
      .mockImplementation((effective, context) =>
        actualVcm.projectMcpToolsFromVcm(effective, context).slice(1)
      );
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { response, tools } = await callToolsList({
      MCP_METADATA_PROJECTION_MODE: 'shadow_compare',
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(response.status).toBe(200);
    expect(tools).toHaveLength(6); // real, unaffected by the mutated shadow

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
      lines.some((l) => l.event === 'metadata_projection_fallback_total' && l.surface === 'mcp')
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

  it('a throwing VCM tool projection never changes the served response', async () => {
    vi.resetModules();
    const vcmModule = await import('@siteborne/vcm');
    const spy = vi.spyOn(vcmModule, 'projectMcpToolsFromVcm').mockImplementation(() => {
      throw new Error('VCM MCP projector exploded');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { response, tools } = await callToolsList({
      MCP_METADATA_PROJECTION_MODE: 'shadow_compare',
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(response.status).toBe(200);
    expect(tools).toHaveLength(6);

    spy.mockRestore();
    errorSpy.mockRestore();
  });

  it('a throwing VCM comparator never changes the served response', async () => {
    vi.resetModules();
    const vcmModule = await import('@siteborne/vcm');
    const spy = vi.spyOn(vcmModule, 'compareProjections').mockImplementation(() => {
      throw new Error('VCM comparator exploded');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { response, tools } = await callToolsList({
      MCP_METADATA_PROJECTION_MODE: 'shadow_compare',
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(response.status).toBe(200);
    expect(tools).toHaveLength(6);

    spy.mockRestore();
    errorSpy.mockRestore();
  });

  it('a throwing comparison telemetry sink never changes the served response', async () => {
    vi.resetModules();
    const telemetryModule = await import(
      '../src/control-plane/telemetry/metadata-projection-telemetry'
    );
    const spy = vi
      .spyOn(telemetryModule, 'recordMetadataProjectionComparison')
      .mockImplementation(() => {
        throw new Error('comparison telemetry exploded');
      });

    const { response, tools } = await callToolsList({
      MCP_METADATA_PROJECTION_MODE: 'shadow_compare',
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(response.status).toBe(200);
    expect(tools).toHaveLength(6);

    spy.mockRestore();
  });
});

describe('MCP metadata vcm_primary_compare -- fail-safe definition selection', () => {
  it('selects independent legacy definitions on semantic mismatch', async () => {
    vi.resetModules();
    const actualVcm = await vi.importActual<typeof import('@siteborne/vcm')>('@siteborne/vcm');
    const vcmModule = await import('@siteborne/vcm');
    const projectorSpy = vi
      .spyOn(vcmModule, 'projectMcpToolsFromVcm')
      .mockImplementation((effective, context) =>
        actualVcm
          .projectMcpToolsFromVcm(effective, context)
          .map((tool, index) =>
            index === 0 ? { ...tool, description: `${tool.description} mismatch` } : tool
          )
      );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { response, tools } = await callToolsList({
      MCP_METADATA_PROJECTION_MODE: 'vcm_primary_compare',
    });

    expect(response.status).toBe(200);
    expect(tools).toHaveLength(6);
    expect(tools[0]?.description).not.toContain('mismatch');
    expect(tools.map((tool) => tool.name)).toEqual([...protocolMcp.MCP_TOOL_NAMES]);
    const lines = structuredLines(errorSpy);
    expect(lines.some((line) => line.event === 'metadata_projection_mismatch_total')).toBe(true);
    expect(
      lines.some(
        (line) => line.event === 'metadata_projection_fallback_total' && line.reason === 'mismatch'
      )
    ).toBe(true);

    projectorSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('selects independent legacy definitions when the VCM projector throws', async () => {
    vi.resetModules();
    const vcmModule = await import('@siteborne/vcm');
    const projectorSpy = vi.spyOn(vcmModule, 'projectMcpToolsFromVcm').mockImplementation(() => {
      throw new Error('primary MCP projector failed');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { response, tools } = await callToolsList({
      MCP_METADATA_PROJECTION_MODE: 'vcm_primary_compare',
    });

    expect(response.status).toBe(200);
    expect(tools).toHaveLength(6);
    expect(
      structuredLines(errorSpy).some(
        (line) => line.event === 'metadata_projection_fallback_total' && line.reason === 'projector'
      )
    ).toBe(true);

    projectorSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('selects independent legacy definitions when exact-set validation fails', async () => {
    vi.resetModules();
    const actualVcm = await vi.importActual<typeof import('@siteborne/vcm')>('@siteborne/vcm');
    const vcmModule = await import('@siteborne/vcm');
    const projectorSpy = vi
      .spyOn(vcmModule, 'projectMcpToolsFromVcm')
      .mockImplementation((effective, context) =>
        actualVcm.projectMcpToolsFromVcm(effective, context).slice(1)
      );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { response, tools } = await callToolsList({
      MCP_METADATA_PROJECTION_MODE: 'vcm_primary_compare',
    });

    expect(response.status).toBe(200);
    expect(tools).toHaveLength(6);
    expect(
      structuredLines(errorSpy).some(
        (line) =>
          line.event === 'metadata_projection_fallback_total' && line.reason === 'validation'
      )
    ).toBe(true);

    projectorSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('selects independent legacy definitions when comparison throws', async () => {
    vi.resetModules();
    const vcmModule = await import('@siteborne/vcm');
    const comparatorSpy = vi.spyOn(vcmModule, 'compareProjections').mockImplementation(() => {
      throw new Error('primary MCP comparator failed');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { response, tools } = await callToolsList({
      MCP_METADATA_PROJECTION_MODE: 'vcm_primary_compare',
    });

    expect(response.status).toBe(200);
    expect(tools).toHaveLength(6);
    expect(
      structuredLines(errorSpy).some(
        (line) =>
          line.event === 'metadata_projection_fallback_total' && line.reason === 'comparator'
      )
    ).toBe(true);

    comparatorSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('fails closed before app construction when the legacy definition builder fails', async () => {
    vi.resetModules();
    const protocolModule = await import('@siteborne/protocol-mcp');
    const legacySpy = vi
      .spyOn(protocolModule, 'buildLegacySiteborneMcpToolDefinitions')
      .mockImplementation(() => {
        throw new Error('legacy MCP definition builder failed');
      });
    const createSpy = vi.spyOn(protocolModule, 'createSiteborneMcpHonoApp');

    const { app } = await import('../src/index');
    const response = await app.request(
      '/mcp',
      {
        method: 'POST',
        headers: {
          Host: 'test.local',
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      },
      { MCP_METADATA_PROJECTION_MODE: 'vcm_primary_compare' } as never
    );
    expect(response.status).toBe(500);
    expect(createSpy).not.toHaveBeenCalled();

    legacySpy.mockRestore();
    createSpy.mockRestore();
  });

  it('keeps safe selection when telemetry throws', async () => {
    vi.resetModules();
    const telemetryModule = await import(
      '../src/control-plane/telemetry/metadata-projection-telemetry'
    );
    const lifecycleSpy = vi
      .spyOn(telemetryModule, 'recordMetadataProjectionLifecycle')
      .mockImplementation(() => {
        throw new Error('primary lifecycle telemetry failed');
      });
    const comparisonSpy = vi
      .spyOn(telemetryModule, 'recordMetadataProjectionComparison')
      .mockImplementation(() => {
        throw new Error('primary comparison telemetry failed');
      });

    const { response, tools } = await callToolsList({
      MCP_METADATA_PROJECTION_MODE: 'vcm_primary_compare',
    });

    expect(response.status).toBe(200);
    expect(tools).toHaveLength(6);

    lifecycleSpy.mockRestore();
    comparisonSpy.mockRestore();
  });
});
