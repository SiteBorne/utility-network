/**
 * METADATA-VCM-IMPL-04A: MCP dual-render integration, compare-only. The
 * real `tools/list` response is served over SSE (`text/event-stream`,
 * `event: message` / `data: {...}` framing) -- confirmed by direct
 * inspection of `mcpRoute`'s real output, not assumed. Comparison happens
 * inline per request against the tool list *already served on this exact
 * response* (no second synthetic client<->server transport), and must
 * never alter what the real caller receives.
 */
import { describe, expect, it, vi } from 'vitest';
import { app } from '../src/index';

async function callToolsList(extraEnv: Record<string, string> = {}): Promise<{
  response: Response;
  tools: Array<{ name: string }>;
}> {
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
  const dataLine = text.split('\n').find((line) => line.startsWith('data:'));
  const parsed = JSON.parse((dataLine ?? '').slice('data:'.length).trim());
  return { response, tools: parsed.result.tools };
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
    await callToolsList({ MCP_METADATA_PROJECTION_MODE: 'shadow_compare' });
    await new Promise((resolve) => setTimeout(resolve, 20));
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
