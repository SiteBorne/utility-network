import {
  createSiteborneMcpHonoApp,
  MCP_SERVICE_TOOLS,
  type CreateSiteborneMcpOptions,
  type McpServiceHealthStatus,
} from '@siteborne/protocol-mcp';
import { PREPRODUCTION_NETWORK } from '@siteborne/protocol-x402';
import { getDefaultAsset } from '@x402/evm';
import type { Context } from 'hono';
import type { Env } from '../control-plane/config/env';
import { resolveEffectiveServiceRuntimeStatus } from '../control-plane/config/production-payment';

const MCP_ALLOWED_HOSTS = [
  'utility.siteborne.net',
  'localhost',
  '127.0.0.1',
  '[::1]',
  'test.local',
] as const;

// MCP is a public discovery surface. Keep its measured request envelope far
// below the Worker's general 10 MiB service-upload ceiling: MCP requests carry
// JSON-RPC metadata and bounded tool arguments, never document bytes.
const MCP_MAX_REQUEST_BYTES = 1024 * 1024;

async function readBoundedMcpRequest(request: Request): Promise<Request | null> {
  if (request.method === 'GET' || request.method === 'HEAD' || request.body === null)
    return request;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let observed = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      observed += value.byteLength;
      if (observed > MCP_MAX_REQUEST_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(observed);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Request(request, { body });
}

/**
 * Credential-independent MCP endpoint. Each HTTP request receives a fresh
 * official SDK handler/server. Service tools use protocol-mcp's closed
 * default boundary, which returns payment_required and cannot execute a
 * useful service for free. A seller address enables quote construction
 * only; it does not enable paid execution, settlement, or production.
 */
export async function mcpRoute(context: Context<{ Bindings: Env }>): Promise<Response> {
  const boundedRequest = await readBoundedMcpRequest(context.req.raw);
  if (!boundedRequest) {
    return Response.json(
      {
        code: 'PAYLOAD_TOO_LARGE',
        message: `MCP request body exceeds maximum size of ${MCP_MAX_REQUEST_BYTES} bytes`,
      },
      { status: 413 }
    );
  }

  const hasDb = Boolean(context.env?.DB);
  const services: Record<string, McpServiceHealthStatus> = {};
  for (const serviceId of Object.values(MCP_SERVICE_TOOLS)) {
    const status = resolveEffectiveServiceRuntimeStatus(serviceId, context.env, hasDb);
    const serialized: McpServiceHealthStatus = {
      implementation: status.hasProductionExecutor ? 'real_executor' : 'local_fixture_verified',
      production: status.productionEnabled ? 'production_enabled' : 'production_disabled',
      external: status.externalConfigured ? 'configured' : 'not_live',
    };
    services[serviceId] = serialized;
  }
  const productionEnabled = Object.values(services).some(
    (service) => service?.production === 'production_enabled'
  );

  const options: CreateSiteborneMcpOptions = {
    health: { production_ready: false, production_enabled: productionEnabled, services },
    allowedHosts: [...MCP_ALLOWED_HOSTS],
    allowedOrigins: [...MCP_ALLOWED_HOSTS],
  };

  if (context.env?.SELLER_WALLET_ADDRESS) {
    // SUN-1000 checkpoint 1O-A: now sourced from the same canonical
    // network constant and the official @x402/evm asset table as every
    // other first-party payment declaration (paid-services.ts,
    // discovery.ts) -- this file previously hand-typed both values
    // independently, and its asset address had drifted by one hex
    // character from the real, accepted Base Sepolia USDC contract
    // address every live-proof test uses
    // (...dCF7c here vs the correct ...dCF7e).
    options.quote = {
      network: PREPRODUCTION_NETWORK,
      asset: getDefaultAsset(PREPRODUCTION_NETWORK).address,
      payee: context.env.SELLER_WALLET_ADDRESS,
    };
  }

  return createSiteborneMcpHonoApp(options).fetch(boundedRequest);
}
