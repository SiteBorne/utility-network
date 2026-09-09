import {
  createSiteborneMcpHonoApp,
  MCP_SERVICE_TOOLS,
  type CreateSiteborneMcpOptions,
  type McpServiceHealthStatus,
} from '@siteborne/protocol-mcp';
import {
  assertPreproductionNetwork,
  isProductionPaymentAuthorized,
  resolvePaymentNetwork,
  type SiteborneServiceId,
} from '@siteborne/protocol-x402';
import type { Context } from 'hono';
import type { Env } from '../control-plane/config/env';
import {
  resolveEffectiveServiceRuntimeStatus,
  resolvePaymentAsset,
  resolveProductionAuthorizationInput,
} from '../control-plane/config/production-payment';
import {
  createMcpX402ServiceBoundary,
  type McpX402RouteHandler,
} from '../control-plane/mcp/x402-mcp-adapter';
import { companyEvidenceGraphV2CdpProductionRoute } from '../control-plane/routes/production-company-evidence-v2-cdp-route';
import { webContextVerifiedV2CdpProductionRoute } from '../control-plane/routes/production-web-context-v2-cdp-route';
import { documentEvidenceJsonV2CdpProductionRoute } from '../control-plane/routes/production-document-evidence-v2-cdp-route';
import { verifyAgentOutputV2CdpProductionRoute } from '../control-plane/routes/production-verify-v2-cdp-route';

// SUN-1222C-MCP-PAYMENT-DESIGN-CORRECTION (Architecture C): the ONLY place
// the MCP payment adapter is wired to real production route functions.
// Each of these is the EXACT function real REST callers hit at the
// matching path (POST /v2/...) -- the adapter never re-implements
// payment verification, executor selection, or settlement; it only
// translates the MCP wire shape into a request these functions already
// accept, and translates their real Response back.
const MCP_X402_PRODUCTION_HANDLERS: Readonly<Partial<Record<SiteborneServiceId, McpX402RouteHandler>>> = {
  'company_evidence_graph.v2': companyEvidenceGraphV2CdpProductionRoute,
  'web_context_verified.v2': webContextVerifiedV2CdpProductionRoute,
  'document_evidence_json.v2': documentEvidenceJsonV2CdpProductionRoute,
  'verify_agent_output.v2': verifyAgentOutputV2CdpProductionRoute,
};

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
    // SUN-1222C-MCP-PAYMENT-DESIGN-CORRECTION: the real REST route
    // functions decide for themselves (via their own PAID_ROUTES_ENABLED
    // / *_CDP_ROUTE_ENABLED / production-authorization gates) whether to
    // execute or return 404/503 -- the adapter is wired unconditionally
    // here rather than duplicating that gating; an unpaid call to a
    // gated-off service correctly surfaces as a rejected/unavailable
    // outcome from the underlying route itself, not a second gate.
    serviceBoundary: createMcpX402ServiceBoundary(
      context.env,
      MCP_X402_PRODUCTION_HANDLERS,
      new URL(context.req.raw.url).origin
    ),
  };

  if (context.env?.SELLER_WALLET_ADDRESS) {
    // SUN-1222C-MCP-PRE-CUTOVER-REMEDIATION: previously hardcoded
    // PREPRODUCTION_NETWORK unconditionally, diverging from the real v2
    // CDP production routes (production/company-evidence-graph-v2-cdp-
    // composition.ts and its siblings), which resolve network/asset
    // through the single canonical, fail-closed
    // resolveProductionAuthorizationInput -> resolvePaymentNetwork ->
    // resolvePaymentAsset chain -- production (Base mainnet) only when
    // all four ADR-0055 gates are simultaneously true, preproduction
    // (Base Sepolia) otherwise. MCP quotes now resolve through the exact
    // same chain, so a client's quote always matches what the real paid
    // route will actually require.
    const productionAuthorization = resolveProductionAuthorizationInput(context.env);
    const network = resolvePaymentNetwork(productionAuthorization);
    assertPreproductionNetwork(network, isProductionPaymentAuthorized(productionAuthorization));
    options.quote = {
      network,
      asset: resolvePaymentAsset(network).address,
      payee: context.env.SELLER_WALLET_ADDRESS,
    };
  }

  return createSiteborneMcpHonoApp(options).fetch(boundedRequest);
}
