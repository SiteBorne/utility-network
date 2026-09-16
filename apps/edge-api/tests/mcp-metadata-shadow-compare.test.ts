/**
 * METADATA-VCM-IMPL-04A: MCP dual-render integration, compare-only. The
 * real `tools/list` response may be served as JSON or SSE. Comparison
 * happens inline per request against the tool list *already served on this
 * exact response* (no second synthetic client<->server transport), and
 * must never alter what the real caller receives.
 */
import * as protocolMcp from '@siteborne/protocol-mcp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/index';

vi.mock('@siteborne/protocol-mcp', async () => {
  const actual =
    await vi.importActual<typeof import('@siteborne/protocol-mcp')>('@siteborne/protocol-mcp');
  return { ...actual };
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function callRawToolsList(extraEnv: Record<string, string> = {}): Promise<Response> {
  return app.request(
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
}

async function callToolsList(extraEnv: Record<string, string> = {}): Promise<{
  response: Response;
  tools: Array<Record<string, unknown> & { name: string }>;
  body: string;
}> {
  const response = await callRawToolsList(extraEnv);
  const text = await response.text();
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  const dataLine = text.split('\n').find((line) => line.startsWith('data:'));
  const parsed = contentType.includes('application/json')
    ? JSON.parse(text)
    : JSON.parse((dataLine ?? '').slice('data:'.length).trim());
  return { response, tools: parsed.result.tools, body: text };
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

describe('MCP metadata projection mode -- default/absent', () => {
  it('serves the real six tools and runs no VCM comparison when unset', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { response, tools } = await callToolsList();
    expect(response.status).toBe(200);
    expect(tools).toHaveLength(6);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const lines = collectStructuredLogLines({ log: logSpy, error: errorSpy });
    expect(lines.some((l) => String(l.event).startsWith('metadata_projection_'))).toBe(false);
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe('MCP metadata projection mode -- shadow_compare', () => {
  it('still serves the real six tools unchanged (VCM never becomes the served producer)', async () => {
    const { response, tools } = await callToolsList({
      MCP_METADATA_PROJECTION_MODE: 'shadow_compare',
    });
    expect(response.status).toBe(200);
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'siteborne_company_evidence_graph',
        'siteborne_web_context_verified',
        'siteborne_document_evidence_json',
        'siteborne_verify_agent_output',
        'siteborne_get_quote',
        'siteborne_get_service_health',
      ].sort()
    );
  });

  it('computes and compares the VCM shadow tool list and records a match (real data already proven parity)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const observed = await callToolsList({ MCP_METADATA_PROJECTION_MODE: 'shadow_compare' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(observed.response.headers.get('content-type')).toContain('text/event-stream');
    expect(observed.tools).toHaveLength(6);
    const lines = collectStructuredLogLines({ log: logSpy, error: errorSpy });
    expect(
      lines.some((l) => l.event === 'metadata_projection_compare_total' && l.surface === 'mcp')
    ).toBe(true);
    expect(
      lines.some((l) => l.event === 'metadata_projection_match_total' && l.surface === 'mcp')
    ).toBe(true);
    expect(lines.some((l) => l.event === 'metadata_projection_fallback_total')).toBe(false);
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it.each([
    {
      name: 'malformed application/json',
      contentType: 'application/json',
      body: '{"jsonrpc":"2.0","id":17,"result":',
    },
    {
      name: 'application/json without result.tools',
      contentType: 'application/json',
      body: JSON.stringify({ jsonrpc: '2.0', id: 17, result: { resources: [] } }),
    },
    {
      name: 'malformed text/event-stream data frame',
      contentType: 'text/event-stream',
      body: 'event: message\ndata: {"jsonrpc":"2.0","id":17,"result":\n\n',
    },
  ])(
    'fails closed observationally for $name while serving the real response unchanged',
    async ({ contentType, body }) => {
      const transportSpy = vi.spyOn(protocolMcp, 'createSiteborneMcpHonoApp').mockReturnValue({
        fetch: async () =>
          new Response(body, { status: 200, headers: { 'content-type': contentType } }),
      } as never);
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      const response = await callRawToolsList({ MCP_METADATA_PROJECTION_MODE: 'shadow_compare' });
      const servedBody = await response.text();
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain(contentType);
      expect(servedBody).toBe(body);
      const lines = collectStructuredLogLines({ log: logSpy, error: errorSpy });
      expect(
        lines.some(
          (line) =>
            line.event === 'metadata_projection_compare_total' ||
            line.event === 'metadata_projection_match_total'
        )
      ).toBe(false);

      transportSpy.mockRestore();
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  );

  it('models the live application/json JSON-RPC tools/list representation and records a six-tool match without changing the served bytes', async () => {
    const baseline = await callToolsList();
    expect(baseline.tools).toHaveLength(6);
    const jsonBody = JSON.stringify({
      jsonrpc: '2.0',
      id: 17,
      result: { tools: baseline.tools },
    });
    const transportSpy = vi.spyOn(protocolMcp, 'createSiteborneMcpHonoApp').mockReturnValue({
      fetch: async () =>
        new Response(jsonBody, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    } as never);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const observed = await callToolsList({ MCP_METADATA_PROJECTION_MODE: 'shadow_compare' });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(observed.response.status).toBe(200);
    expect(observed.response.headers.get('content-type')).toContain('application/json');
    expect(observed.body).toBe(jsonBody);
    expect(observed.tools).toHaveLength(6);
    const lines = collectStructuredLogLines({ log: logSpy, error: errorSpy });
    expect(
      lines.some(
        (line) => line.event === 'metadata_projection_compare_total' && line.surface === 'mcp'
      )
    ).toBe(true);
    expect(
      lines.some(
        (line) => line.event === 'metadata_projection_match_total' && line.surface === 'mcp'
      )
    ).toBe(true);

    transportSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('does not run a comparison for a non-tools/list MCP call (e.g. initialize)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await app.request(
      '/mcp',
      {
        method: 'POST',
        headers: {
          Host: 'test.local',
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2026-07-28',
            capabilities: {},
            clientInfo: { name: 'test', version: '1.0.0' },
          },
        }),
      },
      { MCP_METADATA_PROJECTION_MODE: 'shadow_compare' } as never
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    const lines = collectStructuredLogLines({ log: logSpy, error: errorSpy });
    expect(lines.some((l) => String(l.event).startsWith('metadata_projection_'))).toBe(false);
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe('MCP metadata projection mode -- unauthorized future modes refuse to serve VCM', () => {
  it('vcm_only behaves exactly like legacy: served tools unchanged, zero comparison', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { tools } = await callToolsList({ MCP_METADATA_PROJECTION_MODE: 'vcm_only' });
    expect(tools).toHaveLength(6);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const lines = collectStructuredLogLines({ log: logSpy, error: errorSpy });
    expect(lines.some((l) => l.event === 'metadata_projection_mode_not_yet_authorized')).toBe(true);
    expect(lines.some((l) => String(l.event).startsWith('metadata_projection_compare'))).toBe(
      false
    );
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
