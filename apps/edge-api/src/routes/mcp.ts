import { getMcpSecurityMetaByToolName } from '../control-plane/security-publication';
import {
  assertValidSiteborneMcpToolDefinitions,
  buildLegacySiteborneMcpToolDefinitions,
  buildSiteborneMcpDefinitionAuthorityInputs,
  createSiteborneMcpHonoApp,
  MCP_SERVICE_TOOLS,
  type CreateSiteborneMcpOptions,
  type McpServiceHealthStatus,
  type SiteborneMcpToolDefinition,
} from '@siteborne/protocol-mcp';
import {
  assertPreproductionNetwork,
  isProductionPaymentAuthorized,
  resolvePaymentNetwork,
  type SiteborneServiceId,
} from '@siteborne/protocol-x402';
import {
  buildCurrentMcpProjectionContext,
  buildRealMcpShadowContext,
  getRuntimeEffectiveView,
  projectMcpToolsFromVcm,
  type McpToolDefinition,
} from '@siteborne/vcm';
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
import {
  parseMetadataProjectionMode,
  resolveAuthorizedMetadataProjectionMode,
} from '../control-plane/config/metadata-projection-mode';
import { runShadowComparison } from '../control-plane/metadata/shadow-comparison-runner';
import { selectPrimaryProjection } from '../control-plane/metadata/primary-comparison-selector';
import { recordMetadataProjectionLifecycle } from '../control-plane/telemetry/metadata-projection-telemetry';
import { buildResultAuthorizationRuntime } from '../control-plane/security/request-principal';
import { D1ResultAuthorizationRepository } from '../control-plane/repositories/d1/result-authorization';
import { companyEvidenceGraphV2CdpProductionRoute } from '../control-plane/routes/production-company-evidence-v2-cdp-route';
import { webContextVerifiedV2CdpProductionRoute } from '../control-plane/routes/production-web-context-v2-cdp-route';
import { documentEvidenceJsonV2CdpProductionRoute } from '../control-plane/routes/production-document-evidence-v2-cdp-route';
import { verifyAgentOutputV2CdpProductionRoute } from '../control-plane/routes/production-verify-v2-cdp-route';
import {
  companyEvidenceGraphV3CandidateRoute,
  documentEvidenceJsonV3CandidateRoute,
  verifyAgentOutputV3CandidateRoute,
  webContextVerifiedV3CandidateRoute,
} from '../control-plane/routes/production-public-v3-candidate-routes';

// SUN-1222C-MCP-PAYMENT-DESIGN-CORRECTION (Architecture C): the ONLY place
// the MCP payment adapter is wired to real production route functions.
// Each of these is the EXACT function real REST callers hit at the
// matching path (POST /v2/...) -- the adapter never re-implements
// payment verification, executor selection, or settlement; it only
// translates the MCP wire shape into a request these functions already
// accept, and translates their real Response back.
const MCP_X402_PRODUCTION_HANDLERS: Readonly<
  Partial<Record<SiteborneServiceId, McpX402RouteHandler>>
> = {
  'company_evidence_graph.v2': companyEvidenceGraphV2CdpProductionRoute,
  'web_context_verified.v2': webContextVerifiedV2CdpProductionRoute,
  'document_evidence_json.v2': documentEvidenceJsonV2CdpProductionRoute,
  'verify_agent_output.v2': verifyAgentOutputV2CdpProductionRoute,
  'company_evidence_graph.v3': companyEvidenceGraphV3CandidateRoute,
  'web_context_verified.v3': webContextVerifiedV3CandidateRoute,
  'document_evidence_json.v3': documentEvidenceJsonV3CandidateRoute,
  'verify_agent_output.v3': verifyAgentOutputV3CandidateRoute,
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

const BUYER_RESULT_AUTHORIZATION_META = {
  'net.siteborne/security/result-authorization.v1': {
    authorization_classification: 'buyer_authorized',
    authentication_methods: ['oidc_bearer', 'mutual_tls'],
    subject_binding: 'issuer_qualified_subject_reference',
    existence_hiding: true,
  },
} as const;

function resultAwareMcpSecurityMeta(): Record<string, Record<string, unknown>> {
  const published = getMcpSecurityMetaByToolName();
  return {
    ...published,
    siteborne_extract_document_evidence_json_v3_candidate: {
      ...published.siteborne_extract_document_evidence_json_v3_candidate,
      ...BUYER_RESULT_AUTHORIZATION_META,
    },
    siteborne_verify_agent_output_v3_candidate: {
      ...published.siteborne_verify_agent_output_v3_candidate,
      ...BUYER_RESULT_AUTHORIZATION_META,
    },
  };
}

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

/** See `routes/a2a.ts`'s identical helper -- `c.executionCtx` throws when
 * no real `ExecutionContext` was bound (every plain `app.request(path,
 * init)` call in this repo's test suites), so a background comparison
 * without one just runs un-awaited instead of via `waitUntil`.
 * `runShadowComparison` never rejects, so this is safe either way. */
function safeGetExecutionCtx(
  c: Context
): { waitUntil(promise: Promise<unknown>): void } | undefined {
  try {
    return c.executionCtx;
  } catch {
    return undefined;
  }
}

/** Unreleased/dev builds have no real git SHA available -- see
 * `routes/a2a.ts`'s identical constant/rationale. */
const UNRELEASED_RUNTIME_SOURCE_COMMIT = '0'.repeat(40);

async function readJsonRpcMethod(request: Request): Promise<string | undefined> {
  try {
    const body = JSON.parse(await request.text()) as { method?: unknown };
    return typeof body.method === 'string' ? body.method : undefined;
  } catch {
    return undefined;
  }
}

/** A legitimate `tools/list` response may arrive either as a direct JSON-RPC
 * `application/json` document or as a JSON-RPC `data:` frame inside
 * `text/event-stream`. The shadow observer accepts both representations and
 * parses only what it needs: an actual `result.tools` array. Any malformed or
 * unrecognized observation fails closed without affecting the real response. */
async function extractToolsListFromResponse(
  response: Response
): Promise<readonly McpToolDefinition[] | undefined> {
  try {
    const text = await response.text();

    const extractTools = (value: unknown): readonly McpToolDefinition[] | undefined => {
      if (typeof value !== 'object' || value === null) return undefined;
      const result = (value as { result?: unknown }).result;
      if (typeof result !== 'object' || result === null) return undefined;
      const tools = (result as { tools?: unknown }).tools;
      return Array.isArray(tools) ? (tools as McpToolDefinition[]) : undefined;
    };

    const parseJson = (): readonly McpToolDefinition[] | undefined => {
      try {
        return extractTools(JSON.parse(text));
      } catch {
        return undefined;
      }
    };

    const parseEventStream = (): readonly McpToolDefinition[] | undefined => {
      for (const line of text.split('\n')) {
        if (!line.startsWith('data:')) continue;
        try {
          const tools = extractTools(JSON.parse(line.slice('data:'.length).trim()));
          if (tools) return tools;
        } catch {
          // A malformed observational frame is ignored; keep looking for a
          // valid JSON-RPC message without affecting the served response.
        }
      }
      return undefined;
    };

    const contentType = response.headers
      .get('content-type')
      ?.split(';', 1)[0]
      ?.trim()
      .toLowerCase();
    if (contentType === 'application/json' || contentType?.endsWith('+json')) {
      return parseJson();
    }
    if (contentType === 'text/event-stream') {
      return parseEventStream();
    }

    // Missing or unfamiliar content types are observationally fail-safe: an
    // exact recognized JSON-RPC shape may still be read, but no other payload
    // is promoted into a comparison input.
    return parseJson() ?? parseEventStream();
  } catch {
    return undefined;
  }
}

/**
 * METADATA-VCM-06 §IX/§XII, METADATA-VCM-IMPL-04A: compares against the
 * tool list *already served on this exact response* -- not a second
 * synthetic client<->server transport round trip -- so there is nothing to
 * independently re-derive; VCM only supplies the `definition` content
 * that would flow into the existing `registerTool()` call sites (§IV),
 * never a handler. Silently returns (no comparison) for any MCP method
 * other than `tools/list`, since that is the only response shape this
 * checkpoint models.
 */
async function scheduleMcpShadowComparison(
  mode: 'legacy' | 'shadow_compare',
  requestForMethodSniffing: Request,
  responseForToolsSniffing: Response
): Promise<void> {
  if (mode !== 'shadow_compare') return;
  const method = await readJsonRpcMethod(requestForMethodSniffing);
  if (method !== 'tools/list') return;
  const realTools = await extractToolsListFromResponse(responseForToolsSniffing);
  if (!realTools) return;
  await runShadowComparison({
    surface: 'mcp',
    existing: realTools,
    buildShadow: async () => {
      const effective = await getRuntimeEffectiveView(UNRELEASED_RUNTIME_SOURCE_COMMIT);
      return projectMcpToolsFromVcm(effective, buildRealMcpShadowContext(realTools));
    },
  });
}

function recordMcpHandlerConstructionFailure(): void {
  try {
    recordMetadataProjectionLifecycle({
      event: 'metadata_projection_primary_failure_total',
      surface: 'mcp',
      mode: 'vcm_primary_compare',
      reason: 'handler_construction',
    });
  } catch {
    // Telemetry is observational and cannot change fail-closed construction.
  }
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
  let resultAuthorizationRuntime: ReturnType<typeof buildResultAuthorizationRuntime> = null;
  try {
    // Same persisted revocation authority as the HTTP result-release
    // routes (`production-public-v3-candidate-routes.ts`'s
    // `configureBuyerAuthorization`) -- no protocol-specific revocation
    // logic. The MCP boundary forwards each service call to that same
    // underlying route handler (`createMcpX402ServiceBoundary`), which
    // builds its own runtime instance for the actual release decision;
    // this one governs MCP-transport authentication only, but it must
    // not keep a stale empty stub either.
    const revocationRepository = hasDb ? new D1ResultAuthorizationRepository(context.env.DB) : null;
    resultAuthorizationRuntime = buildResultAuthorizationRuntime(
      context.env,
      revocationRepository ? () => revocationRepository.revokedSubjectRefs() : undefined
    );
  } catch {
    resultAuthorizationRuntime = null;
  }
  const verifiedPrincipal = resultAuthorizationRuntime
    ? await resultAuthorizationRuntime.authenticate(context.req.raw)
    : null;

  const options: CreateSiteborneMcpOptions = {
    health: { production_ready: false, production_enabled: productionEnabled, services },
    allowedHosts: [...MCP_ALLOWED_HOSTS],
    allowedOrigins: [...MCP_ALLOWED_HOSTS],
    // PRODUCTION-SECURITY-DECLARATIONS-PUBLICATION-01: additive per-tool
    // security `_meta`, derived from the canonical declaration.
    securityMetaByToolName: resultAwareMcpSecurityMeta(),
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
      new URL(context.req.raw.url).origin,
      verifiedPrincipal
    ),
    buyerResultAuthorizationReady: resultAuthorizationRuntime !== null,
    buyerResultCallerAuthenticated: verifiedPrincipal !== null,
  };

  if (context.env?.RESULT_CONTRACT_RELEASE_SELECTION === '3.0.0-public-candidate') {
    options.releaseSelection = '3.0.0-public-candidate';
  }

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

  const authorizedMode = resolveAuthorizedMetadataProjectionMode(
    parseMetadataProjectionMode(context.env?.MCP_METADATA_PROJECTION_MODE, 'mcp'),
    'mcp'
  );

  let selectedOptions = options;
  if (authorizedMode === 'vcm_primary_compare') {
    const selection = await selectPrimaryProjection<readonly SiteborneMcpToolDefinition[]>({
      surface: 'mcp',
      buildLegacy: () => {
        const definitions = buildLegacySiteborneMcpToolDefinitions(options);
        assertValidSiteborneMcpToolDefinitions(definitions);
        return definitions;
      },
      buildPrimary: async () => {
        const effective = await getRuntimeEffectiveView(UNRELEASED_RUNTIME_SOURCE_COMMIT);
        const authority = buildSiteborneMcpDefinitionAuthorityInputs(options);
        return projectMcpToolsFromVcm(
          effective,
          buildCurrentMcpProjectionContext(authority)
        ) as readonly SiteborneMcpToolDefinition[];
      },
      validatePrimary: assertValidSiteborneMcpToolDefinitions,
    });
    selectedOptions = { ...options, toolDefinitions: selection.selected };
  }

  // Cloned *before* the real fetch consumes `boundedRequest`'s body -- both
  // copies remain independently readable since the body is already a
  // static, fully-buffered Uint8Array at this point (`readBoundedMcpRequest`).
  const requestForMethodSniffing =
    authorizedMode === 'shadow_compare' ? boundedRequest.clone() : undefined;

  let response: Response;
  try {
    response = await createSiteborneMcpHonoApp(selectedOptions).fetch(boundedRequest);
  } catch (error) {
    if (authorizedMode === 'vcm_primary_compare') recordMcpHandlerConstructionFailure();
    throw error;
  }

  if (authorizedMode === 'shadow_compare' && requestForMethodSniffing) {
    // Cloned before returning `response` up the stack -- nothing has begun
    // reading its body yet, so this never affects what the real caller
    // receives (METADATA-VCM-06 §XVI: legacy remains served regardless).
    const responseForToolsSniffing = response.clone();
    const comparison = scheduleMcpShadowComparison(
      authorizedMode,
      requestForMethodSniffing,
      responseForToolsSniffing
    );
    const executionCtx = safeGetExecutionCtx(context);
    if (executionCtx) {
      executionCtx.waitUntil(comparison);
    } else {
      void comparison;
    }
  }

  return response;
}
