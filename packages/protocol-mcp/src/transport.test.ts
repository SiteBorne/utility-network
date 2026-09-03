import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import {
  frozenInputExample,
  frozenOutputExample,
  type SiteborneServiceId,
} from '@siteborne/protocol-x402';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_NAME,
  MCP_TOOL_NAMES,
  createSiteborneMcpHonoApp,
  createSiteborneMcpServer,
  type McpInvocationContext,
  type McpServiceExecutionBoundary,
} from './index';

const SERVICE_TOOL_MATRIX = [
  ['siteborne_company_evidence_graph', 'company_evidence_graph.v2'],
  ['siteborne_web_context_verified', 'web_context_verified.v2'],
  ['siteborne_document_evidence_json', 'document_evidence_json.v2'],
  ['siteborne_verify_agent_output', 'verify_agent_output.v2'],
] as const;

function createBoundary(): McpServiceExecutionBoundary {
  return {
    execute: vi.fn(async (serviceId: SiteborneServiceId) => ({
      outcome: 'fulfilled' as const,
      result: frozenOutputExample(serviceId),
    })),
  };
}

function createFixtureApp(boundary = createBoundary()) {
  const serverInstanceIds: string[] = [];
  const app = createSiteborneMcpHonoApp({
    serviceBoundary: boundary,
    quote: {
      network: 'eip155:84532',
      asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7c',
      payee: '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1',
      now: () => new Date('2026-08-10T12:00:00.000Z'),
    },
    health: {
      production_ready: false,
      production_enabled: false,
    },
    onServerCreated: (id) => serverInstanceIds.push(id),
    allowedHosts: ['test.local'],
    allowedOrigins: ['test.local'],
  });
  return { app, boundary, serverInstanceIds };
}

async function connectClient(
  app: ReturnType<typeof createSiteborneMcpHonoApp>,
  name = 'siteborne-mcp-test-client'
) {
  const client = new Client(
    { name, version: '1.0.0' },
    { versionNegotiation: { mode: { pin: MCP_PROTOCOL_VERSION } } }
  );
  const transport = new StreamableHTTPClientTransport(new URL('http://test.local/mcp'), {
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set('Host', 'test.local');
      return app.fetch(new Request(input, { ...init, headers }));
    },
  });
  await client.connect(transport);
  return client;
}

const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

// The 2025-11-25 streamable-HTTP transport is free to answer a stateless
// legacy request as an SSE-framed stream rather than a bare JSON body -- a
// real legacy client (and the official SDK's own client transport) handles
// both; this helper parses either so assertions exercise actual response
// content, not a shape assumption. Hoisted to module scope (SUN-1222B-S3-R3-
// RS) so both the SUN-1222A legacy-handshake suite and the R3-RS
// interoperability matrix below share one implementation.
async function readJsonRpcResult(response: Response): Promise<{
  error?: { code: number; message: string };
  result?: Record<string, unknown>;
}> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  const text = await response.text();
  const dataLine = text
    .split('\n')
    .find((line) => line.startsWith('data:'))
    ?.slice('data:'.length)
    .trim();
  if (!dataLine) {
    throw new Error(`no SSE data frame found in response: ${text}`);
  }
  return JSON.parse(dataLine) as {
    error?: { code: number; message: string };
    result?: Record<string, unknown>;
  };
}

describe('SITEBORNE MCP 2026-07-28 Hono transport', () => {
  it('constructs a complete isolated server instance', () => {
    expect(createSiteborneMcpServer).not.toThrow();
  });

  it('lists exactly the six frozen SITEBORNE tools through the official modern client', async () => {
    const { app } = createFixtureApp();
    const client = await connectClient(app);
    clients.push(client);

    const listed = await client.listTools();

    expect(listed.tools.map((tool) => tool.name).sort()).toEqual([...MCP_TOOL_NAMES].sort());
    expect(listed.tools).toHaveLength(6);
  });

  it.each(SERVICE_TOOL_MATRIX)(
    'invokes %s through the accepted injected service boundary',
    async (toolName, serviceId) => {
      const { app, boundary } = createFixtureApp();
      const client = await connectClient(app);
      clients.push(client);
      const input = frozenInputExample(serviceId);

      const result = await client.callTool({
        name: toolName,
        arguments: input as Record<string, unknown>,
      });

      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual(frozenOutputExample(serviceId));
      expect(boundary.execute).toHaveBeenCalledTimes(1);
      expect(boundary.execute).toHaveBeenCalledWith(
        serviceId,
        input,
        expect.objectContaining({ protocol_version: MCP_PROTOCOL_VERSION })
      );
    }
  );

  it('builds canonical exact and upto quotes, preserving maximum-not-actual semantics', async () => {
    const { app } = createFixtureApp();
    const client = await connectClient(app);
    clients.push(client);
    const input = frozenInputExample('document_evidence_json.v2');

    const exact = await client.callTool({
      name: 'siteborne_get_quote',
      arguments: { service_id: 'document_evidence_json.v2', scheme: 'exact', input },
    });
    const upto = await client.callTool({
      name: 'siteborne_get_quote',
      arguments: { service_id: 'document_evidence_json.v2', scheme: 'upto', input },
    });

    expect(exact.isError).not.toBe(true);
    expect(upto.isError).not.toBe(true);
    expect(exact.structuredContent).toEqual(
      expect.objectContaining({
        scheme: 'exact',
        amount_kind: 'exact',
        payment_requirements: expect.objectContaining({ scheme: 'exact' }),
      })
    );
    expect(upto.structuredContent).toEqual(
      expect.objectContaining({
        scheme: 'upto',
        amount_kind: 'authorized_maximum',
        payment_requirements: expect.objectContaining({ scheme: 'upto' }),
      })
    );
    const uptoQuote = upto.structuredContent as { amount: string; actual_amount: unknown };
    expect(BigInt(uptoQuote.amount)).toBeGreaterThan(0n);
    expect(uptoQuote.actual_amount).toBeNull();
  });

  it('quotes company v2 at 31200 atomic without repricing company v1', async () => {
    const { app } = createFixtureApp();
    const client = await connectClient(app);
    clients.push(client);

    const quote = async (service_id: 'company_evidence_graph.v1' | 'company_evidence_graph.v2') =>
      client.callTool({
        name: 'siteborne_get_quote',
        arguments: {
          service_id,
          scheme: 'exact',
          input: frozenInputExample(service_id),
        },
      });
    const v1 = await quote('company_evidence_graph.v1');
    const v2 = await quote('company_evidence_graph.v2');

    expect(v1.structuredContent).toMatchObject({
      amount: '39000',
      pricing_key: 'company_evidence_graph',
    });
    expect(v2.structuredContent).toMatchObject({
      amount: '31200',
      pricing_key: 'company_evidence_graph_v2',
    });
  });

  it('reports production false and local protocol readiness truthfully', async () => {
    const { app } = createFixtureApp();
    const client = await connectClient(app);
    clients.push(client);

    const result = await client.callTool({ name: 'siteborne_get_service_health', arguments: {} });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(
      expect.objectContaining({
        server_name: MCP_SERVER_NAME,
        protocol_version: MCP_PROTOCOL_VERSION,
        production_ready: false,
        production_enabled: false,
        services: expect.objectContaining({
          'company_evidence_graph.v2': expect.objectContaining({
            implementation: 'local_fixture_verified',
            production: 'production_disabled',
            external: 'not_live',
          }),
        }),
      })
    );
    expect(Object.keys((result.structuredContent as { services: object }).services)).toHaveLength(
      4
    );
  });

  it('rejects invalid service input at the SDK schema boundary without execution', async () => {
    const { app, boundary } = createFixtureApp();
    const client = await connectClient(app);
    clients.push(client);

    const result = await client.callTool({
      name: 'siteborne_company_evidence_graph',
      arguments: { ticker: 'not-a-valid-ticker' },
    });

    expect(result.isError).toBe(true);
    expect(boundary.execute).not.toHaveBeenCalled();
  });

  it('maps every accepted boundary failure to an MCP tool error without stacks', async () => {
    const codes = [
      'payment_required',
      'production_disabled',
      'external_dependency_unavailable',
      'internal_verification_failure',
      'repository_runtime_failure',
    ];
    for (const code of codes) {
      const boundary: McpServiceExecutionBoundary = {
        async execute() {
          return { outcome: 'rejected', code, message: `closed:${code}` };
        },
      };
      const { app } = createFixtureApp(boundary);
      const client = await connectClient(app, `failure-${code}`);
      clients.push(client);
      const result = await client.callTool({
        name: 'siteborne_company_evidence_graph',
        arguments: frozenInputExample('company_evidence_graph.v2') as Record<string, unknown>,
      });

      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain(code);
      expect(JSON.stringify(result.content).toLowerCase()).not.toContain('stack');
    }
  });

  it('turns a boundary result that violates the frozen output schema into an MCP error', async () => {
    const boundary: McpServiceExecutionBoundary = {
      async execute() {
        return { outcome: 'fulfilled', result: { production_enabled: true } };
      },
    };
    const { app } = createFixtureApp(boundary);
    const client = await connectClient(app);
    clients.push(client);

    const result = await client.callTool({
      name: 'siteborne_company_evidence_graph',
      arguments: frozenInputExample('company_evidence_graph.v2') as Record<string, unknown>,
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
  });

  it('rejects unknown tools, unsupported quote modes, hostile keys, and production spoofing', async () => {
    const { app, boundary } = createFixtureApp();
    const client = await connectClient(app);
    clients.push(client);

    await expect(client.callTool({ name: 'siteborne_unknown', arguments: {} })).rejects.toThrow(
      'Tool siteborne_unknown not found'
    );
    const unsupportedMode = await client.callTool({
      name: 'siteborne_get_quote',
      arguments: {
        service_id: 'company_evidence_graph.v2',
        scheme: 'exact',
        mode: 'unbounded-live',
        input: frozenInputExample('company_evidence_graph.v2'),
      },
    });
    await expect(
      client.callTool({
        name: 'siteborne_company_evidence_graph',
        arguments: JSON.parse(
          '{"company_name":"Acme","__proto__":{"production_enabled":true}}'
        ) as Record<string, unknown>,
      })
    ).rejects.toThrow('forbidden object key');
    const spoof = await client.callTool({
      name: 'siteborne_get_service_health',
      arguments: { production_enabled: true },
    });

    expect(unsupportedMode.isError).toBe(true);
    expect(spoof.isError).toBe(true);
    expect(boundary.execute).not.toHaveBeenCalled();
  });

  it('uses no ambient network for quote, health, or fixture-bound service invocation', async () => {
    const ambientFetch = vi.fn(() => {
      throw new Error('ambient network forbidden');
    });
    vi.stubGlobal('fetch', ambientFetch);
    try {
      const { app } = createFixtureApp();
      const client = await connectClient(app);
      clients.push(client);
      await client.callTool({ name: 'siteborne_get_service_health', arguments: {} });
      await client.callTool({
        name: 'siteborne_get_quote',
        arguments: {
          service_id: 'web_context_verified.v2',
          scheme: 'exact',
          input: frozenInputExample('web_context_verified.v2'),
        },
      });
      await client.callTool({
        name: 'siteborne_web_context_verified',
        arguments: frozenInputExample('web_context_verified.v2') as Record<string, unknown>,
      });
      expect(ambientFetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    ['Mcp-Method', 'tools/list', 'tools/call'],
    ['Mcp-Name', 'siteborne_get_quote', 'siteborne_get_service_health'],
  ])('fails closed when %s disagrees with the JSON-RPC body', async (header, sent, body) => {
    const { app, boundary } = createFixtureApp();
    const requestBody = {
      jsonrpc: '2.0',
      id: 41,
      method: 'tools/call',
      params: {
        name: body,
        arguments: {},
        _meta: {
          'io.modelcontextprotocol/protocolVersion': MCP_PROTOCOL_VERSION,
          'io.modelcontextprotocol/clientInfo': { name: 'raw-test', version: '1.0.0' },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    };
    const headers = new Headers({
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
      'Mcp-Method': 'tools/call',
      'Mcp-Name': body,
      Host: 'test.local',
    });
    headers.set(header, sent);

    const response = await app.request('/mcp', {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });
    const payload = (await response.json()) as { error: { code: number } };

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe(-32020);
    expect(boundary.execute).not.toHaveBeenCalled();
  });

  it('fails closed when the required Mcp-Name header is missing', async () => {
    const { app, boundary } = createFixtureApp();
    const body = {
      jsonrpc: '2.0',
      id: 42,
      method: 'tools/call',
      params: {
        name: 'siteborne_get_service_health',
        arguments: {},
        _meta: {
          'io.modelcontextprotocol/protocolVersion': MCP_PROTOCOL_VERSION,
          'io.modelcontextprotocol/clientInfo': { name: 'raw-test', version: '1.0.0' },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    };
    const response = await app.request('/mcp', {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
        'Mcp-Method': 'tools/call',
        Host: 'test.local',
      },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as { error: { code: number } };

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe(-32020);
    expect(boundary.execute).not.toHaveBeenCalled();
  });

  it('returns HTTP 404 and method-not-found for an unknown modern RPC method', async () => {
    const { app, boundary } = createFixtureApp();
    const body = {
      jsonrpc: '2.0',
      id: 43,
      method: 'siteborne/unknown',
      params: {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': MCP_PROTOCOL_VERSION,
          'io.modelcontextprotocol/clientInfo': { name: 'raw-test', version: '1.0.0' },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    };
    const response = await app.request('/mcp', {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
        'Mcp-Method': 'siteborne/unknown',
        Host: 'test.local',
      },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as { error: { code: number } };

    expect(response.status).toBe(404);
    expect(payload.error.code).toBe(-32601);
    expect(boundary.execute).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON and an unsupported protocol version before dispatch', async () => {
    const { app, boundary } = createFixtureApp();
    const malformed = await app.request('/mcp', {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
        'Mcp-Method': 'tools/list',
        Host: 'test.local',
      },
      body: '{',
    });
    const wrongVersionBody = {
      jsonrpc: '2.0',
      id: 44,
      method: 'tools/list',
      params: {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2099-01-01',
          'io.modelcontextprotocol/clientInfo': { name: 'raw-test', version: '1.0.0' },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    };
    const wrongVersion = await app.request('/mcp', {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': '2099-01-01',
        'Mcp-Method': 'tools/list',
        Host: 'test.local',
      },
      body: JSON.stringify(wrongVersionBody),
    });

    expect(malformed.status).toBe(400);
    expect(await malformed.text()).toBe('Invalid JSON');
    expect(wrongVersion.status).toBe(400);
    expect(((await wrongVersion.json()) as { error: { code: number } }).error.code).toBe(-32022);
    expect(boundary.execute).not.toHaveBeenCalled();
  });

  it('rejects a disallowed browser Origin before protocol dispatch', async () => {
    const { app, boundary } = createFixtureApp();
    const response = await app.request('/mcp', {
      method: 'POST',
      headers: {
        Origin: 'https://attacker.example',
        Host: 'test.local',
        'Content-Type': 'application/json',
      },
      body: '{}',
    });

    expect(response.status).toBe(403);
    expect(boundary.execute).not.toHaveBeenCalled();
  });

  it('uses a fresh server instance for every modern request and never exposes a session id', async () => {
    const { app, serverInstanceIds } = createFixtureApp();
    const first = await connectClient(app, 'client-a');
    const second = await connectClient(app, 'client-b');
    clients.push(first, second);

    await Promise.all([first.listTools(), second.listTools()]);

    expect(new Set(serverInstanceIds).size).toBe(serverInstanceIds.length);
    expect(serverInstanceIds.length).toBeGreaterThanOrEqual(4);
  });

  describe('2025-11-25 legacy handshake compatibility (SUN-1222A)', () => {
    // External MCP directories/scanners (MCP Registry client, Odel, Glama,
    // FastDrop-style probes -- SUN-1222A §1/§6/§44) perform the *original*
    // MCP HTTP lifecycle: a plain JSON-RPC `initialize` call carrying no
    // `io.modelcontextprotocol/*` `_meta` envelope and no
    // `MCP-Protocol-Version` header, followed by `notifications/initialized`
    // and `tools/list` -- the 2025-11-25 family this SDK's own type system
    // calls the "legacy" wire era (as opposed to the 2026-07-28+ per-request
    // envelope "modern" era every other test in this file exercises via a
    // version-pinned client). `createMcpHandler`'s own default posture for
    // that era is `legacy: 'stateless'`; SITEBORNE had explicitly opted into
    // `legacy: 'reject'`, which answers every such request with an
    // unsupported-protocol-version error -- observed live in production
    // (`docs/reports/SUN-1222A-post-release-baseline-and-commercial-readiness.md`)
    // and matching exactly the external failure class this checkpoint's own
    // brief describes. This block reproduces that failure class directly
    // against the real Hono app/handler (no envelope, no version header --
    // an actual 2025-era request), independent of this file's own
    // `connectClient` helper, which -- like every previously-existing test in
    // this file -- pins the modern version and therefore could never have
    // caught this regression.
    async function legacyRequest(app: ReturnType<typeof createSiteborneMcpHonoApp>, body: unknown) {
      return app.request('/mcp', {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          Host: 'test.local',
        },
        body: JSON.stringify(body),
      });
    }

    it('answers a bare 2025-11-25 `initialize` request (no envelope, no version header)', async () => {
      const { app } = createFixtureApp();

      const response = await legacyRequest(app, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'external-mcp-directory-probe', version: '1.0.0' },
        },
      });
      const payload = (await readJsonRpcResult(response)) as {
        error?: { code: number; message: string };
        result?: { protocolVersion?: string; serverInfo?: { name?: string } };
      };

      expect(payload.error).toBeUndefined();
      expect(response.status).toBe(200);
      expect(payload.result?.serverInfo?.name).toBe(MCP_SERVER_NAME);
      expect(typeof payload.result?.protocolVersion).toBe('string');
    });

    it('answers a bare legacy `tools/list` request with the six frozen tools', async () => {
      const { app } = createFixtureApp();

      const response = await legacyRequest(app, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      });
      const payload = (await readJsonRpcResult(response)) as {
        error?: { code: number };
        result?: { tools?: Array<{ name: string }> };
      };

      expect(payload.error).toBeUndefined();
      expect(response.status).toBe(200);
      expect(payload.result?.tools?.map((tool) => tool.name).sort()).toEqual(
        [...MCP_TOOL_NAMES].sort()
      );
    });

    it('still serves the modern 2026-07-28 envelope path unchanged alongside legacy', async () => {
      // Guards against a same-time regression in the opposite direction --
      // the fix must add legacy compatibility, not replace modern serving.
      const { app } = createFixtureApp();
      const client = await connectClient(app);
      clients.push(client);

      const listed = await client.listTools();

      expect(listed.tools).toHaveLength(6);
    });
  });

  it('keeps two clients metadata-isolated and reconstructs repeated stateless results', async () => {
    const contexts: McpInvocationContext[] = [];
    const boundary: McpServiceExecutionBoundary = {
      async execute(serviceId, _input, context) {
        contexts.push(context);
        return { outcome: 'fulfilled', result: frozenOutputExample(serviceId) };
      },
    };
    const { app } = createFixtureApp(boundary);
    const first = await connectClient(app, 'isolated-client-a');
    const second = await connectClient(app, 'isolated-client-b');
    clients.push(first, second);

    await Promise.all([
      first.callTool({
        name: 'siteborne_company_evidence_graph',
        arguments: frozenInputExample('company_evidence_graph.v2') as Record<string, unknown>,
      }),
      second.callTool({
        name: 'siteborne_web_context_verified',
        arguments: frozenInputExample('web_context_verified.v2') as Record<string, unknown>,
      }),
    ]);
    const healthA = await first.callTool({
      name: 'siteborne_get_service_health',
      arguments: {},
    });
    const healthReplay = await first.callTool({
      name: 'siteborne_get_service_health',
      arguments: {},
    });

    expect(contexts.map((context) => context.client_name).sort()).toEqual([
      'isolated-client-a',
      'isolated-client-b',
    ]);
    expect(healthReplay.structuredContent).toEqual(healthA.structuredContent);
    expect(JSON.stringify(healthA)).not.toContain('isolated-client-b');
    expect(JSON.stringify(healthReplay)).not.toContain('isolated-client-b');
  });

  // SUN-1222B-S3-R3-RS: repo/spec-derived interoperability hardening matrix.
  // A prior checkpoint (SUN-1222B-S3-R3) was BLOCKED because the traffic
  // capture it was meant to validate against was never persisted anywhere
  // retrievable this session -- no file in docs/, no bookmark holding its
  // raw content. This block does NOT reconstruct that missing dataset or
  // any client identity/count from it. Every case below was derived from,
  // and executed against, only: the installed @modelcontextprotocol/server
  // 2.0.0 SDK's own type contract (classifyInboundRequest,
  // validateStandardRequestHeaders, SEP-2243) and this file's existing
  // fixture app -- each expectation was captured by running the actual
  // request through the real Hono app first, not assumed.
  describe('protocol interoperability hardening matrix (SUN-1222B-S3-R3-RS)', () => {
    it.each(['GET', 'HEAD', 'OPTIONS'] as const)(
      'answers %s /mcp with 405 Method Not Allowed, no dispatch',
      async (method) => {
        const { app, boundary } = createFixtureApp();
        const response = await app.request('/mcp', { method, headers: { Host: 'test.local' } });
        expect(response.status).toBe(405);
        expect(boundary.execute).not.toHaveBeenCalled();
      }
    );

    it('rejects a POST with no Content-Type as 415 before dispatch', async () => {
      const { app, boundary } = createFixtureApp();
      const response = await app.request('/mcp', {
        method: 'POST',
        headers: { Accept: 'application/json, text/event-stream', Host: 'test.local' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      });
      expect(response.status).toBe(415);
      expect(boundary.execute).not.toHaveBeenCalled();
    });

    it('rejects a POST with a non-JSON Content-Type as 415 before dispatch', async () => {
      const { app, boundary } = createFixtureApp();
      const response = await app.request('/mcp', {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'text/plain',
          Host: 'test.local',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      });
      expect(response.status).toBe(415);
      expect(boundary.execute).not.toHaveBeenCalled();
    });

    it('accepts a charset-qualified application/json Content-Type', async () => {
      const { app } = createFixtureApp();
      const response = await app.request('/mcp', {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json; charset=utf-8',
          Host: 'test.local',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      });
      expect(response.status).toBe(200);
    });

    // Distinct from the existing "%s disagrees with the JSON-RPC body" case
    // (transport.test.ts line ~307), which sends a WRONG Mcp-Method value.
    // This proves the header's ABSENCE alone is fail-closed on a
    // modern-classified request -- direct evidence for this checkpoint's
    // §8/§10 Mcp-Method audit. Per the installed SDK's own
    // `validateStandardRequestHeaders` (SEP-2243 standard-header rung),
    // this is enforced by the SDK itself; SITEBORNE neither weakens nor
    // reimplements it, so no source change accompanies this test -- it
    // locks in already-correct, already-shipped behavior only.
    it('fails closed when the required Mcp-Method header is entirely absent on a modern request', async () => {
      const { app, boundary } = createFixtureApp();
      const body = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {
          _meta: {
            'io.modelcontextprotocol/protocolVersion': MCP_PROTOCOL_VERSION,
            'io.modelcontextprotocol/clientInfo': { name: 'raw-test', version: '1.0.0' },
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      };
      const response = await app.request('/mcp', {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
          Host: 'test.local',
          // Mcp-Method deliberately omitted.
        },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { error: { code: number } };

      expect(response.status).toBe(400);
      expect(payload.error.code).toBe(-32020);
      expect(boundary.execute).not.toHaveBeenCalled();
    });

    it('accepts a bodyless notification with 202 and never dispatches to the boundary', async () => {
      const { app, boundary } = createFixtureApp();
      const response = await app.request('/mcp', {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
          'Mcp-Method': 'notifications/initialized',
          Host: 'test.local',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
          params: {
            _meta: {
              'io.modelcontextprotocol/protocolVersion': MCP_PROTOCOL_VERSION,
              'io.modelcontextprotocol/clientInfo': { name: 'raw-test', version: '1.0.0' },
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }),
      });
      expect(response.status).toBe(202);
      expect(boundary.execute).not.toHaveBeenCalled();
    });

    it('rejects a wrong JSON-RPC version string before dispatch', async () => {
      const { app, boundary } = createFixtureApp();
      const response = await app.request('/mcp', {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          Host: 'test.local',
        },
        body: JSON.stringify({ jsonrpc: '1.0', id: 1, method: 'tools/list', params: {} }),
      });
      const payload = (await response.json()) as { error: { code: number } };

      expect(response.status).toBe(400);
      expect(payload.error.code).toBe(-32600);
      expect(boundary.execute).not.toHaveBeenCalled();
    });

    it('rejects non-object params before dispatch', async () => {
      const { app, boundary } = createFixtureApp();
      const response = await app.request('/mcp', {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          Host: 'test.local',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: 'not-an-object',
        }),
      });
      const payload = (await response.json()) as { error: { code: number } };

      expect(response.status).toBe(400);
      expect(payload.error.code).toBe(-32600);
      expect(boundary.execute).not.toHaveBeenCalled();
    });

    it('rejects a JSON-RPC null id before dispatch', async () => {
      const { app, boundary } = createFixtureApp();
      const response = await app.request('/mcp', {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          Host: 'test.local',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: null, method: 'tools/list', params: {} }),
      });
      const payload = (await response.json()) as { error: { code: number } };

      expect(response.status).toBe(400);
      expect(payload.error.code).toBe(-32600);
      expect(boundary.execute).not.toHaveBeenCalled();
    });

    it('rejects a malformed (non-string) legacy protocolVersion without dispatching', async () => {
      const { app, boundary } = createFixtureApp();
      const response = await app.request('/mcp', {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          Host: 'test.local',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: 12345,
            capabilities: {},
            clientInfo: { name: 'p', version: '1' },
          },
        }),
      });
      const payload = (await readJsonRpcResult(response)) as { error?: { code: number } };

      expect(payload.error).toBeDefined();
      expect(boundary.execute).not.toHaveBeenCalled();
    });

    // A well-formed but unrecognized legacy protocolVersion is NOT rejected
    // -- the SDK's documented legacy-initialize posture is to counter-offer
    // its own first supported 2025-era version rather than error, matching
    // how a real legacy client/server pair negotiates (SUN-1222A's own
    // "MCP directories/scanners" class relies on exactly this: they send
    // whatever legacy version they were built against and expect a usable
    // counter-offer, not a hard rejection).
    it('counter-offers the supported legacy version for an unrecognized but well-formed protocolVersion', async () => {
      const { app } = createFixtureApp();
      const response = await app.request('/mcp', {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          Host: 'test.local',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '1999-01-01',
            capabilities: {},
            clientInfo: { name: 'p', version: '1' },
          },
        }),
      });
      const payload = (await readJsonRpcResult(response)) as {
        error?: unknown;
        result?: { protocolVersion?: string };
      };

      expect(payload.error).toBeUndefined();
      expect(typeof payload.result?.protocolVersion).toBe('string');
    });
  });
});
