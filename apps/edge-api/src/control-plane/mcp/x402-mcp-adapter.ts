/**
 * SUN-1222C-MCP-PAYMENT-DESIGN-CORRECTION -- Architecture C: the official
 * x402-over-MCP wire carriers (packages/protocol-mcp/src/x402-wire.ts)
 * wired to SITEBORNE's EXISTING REST payment-validation/durable-handoff
 * path, not a new one.
 *
 * This module is transport adaptation ONLY. For every call it:
 *   1. translates the MCP tool call (input + an already-extracted,
 *      already-validated PaymentPayload or `undefined`) into an HTTP
 *      Request byte-shaped exactly like what the real REST v2 route
 *      already accepts (same body, same `PAYMENT-SIGNATURE` header
 *      encoding via @siteborne/protocol-x402's own encoder);
 *   2. invokes the EXACT SAME already-existing, already-hardened
 *      production route function real REST callers hit (passed in by the
 *      caller as `handlers`, e.g. `companyEvidenceGraphV2CdpProductionRoute`
 *      from production-company-evidence-v2-cdp-route.ts) -- never a
 *      second implementation of payment verification, executor
 *      selection, or settlement;
 *   3. translates that function's real Response back into the official
 *      MCP outcome shape.
 *
 * This file imports no settlement, facilitator, CDP, or Workflow
 * internals -- see x402-mcp-adapter.test.ts's static import-graph audit,
 * which fails the build if that ever stops being true. The invariant this
 * preserves:
 *   PUBLIC_API_SETTLE_CALLSITES = 0 (unchanged)
 *   MCP_ADAPTER_SETTLE_CALLSITES = 0 (this file, provably)
 *   DEDICATED_WORKFLOW_SETTLE_CALLSITES = 1 (unchanged)
 *   TOTAL_PRODUCTION_SETTLE_CALLSITES = 1 (unchanged)
 */
import {
  decodePaymentRequiredHeaderSafe,
  decodePaymentResponseHeaderSafe,
  encodePaymentSignatureHeaderSafe,
  type SiteborneServiceId,
} from '@siteborne/protocol-x402';
import type { McpServiceExecutionBoundary } from '@siteborne/protocol-mcp';
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../config/env';

/** A real production route function -- e.g.
 * `companyEvidenceGraphV2CdpProductionRoute` -- with the exact signature
 * every one of the four v2 CDP route modules already exports. */
export type McpX402RouteHandler = (c: Context<{ Bindings: Env }>) => Promise<Response>;

/** The real, already-mounted resource path for each v2 service (must stay
 * byte-identical to `index.ts`'s own route registrations and to
 * `SERVICE_RESOURCES` in packages/protocol-mcp/src/server.ts -- an x402
 * payment binds to this exact resource identity, so any drift here would
 * silently break payment/resource matching). v1 is intentionally absent:
 * no v1 route is mounted in `index.ts` today (matching the MCP layer's
 * own `SERVICE_RESOURCES`, which carries the same v1-placeholder
 * comment). */
export const MCP_X402_SERVICE_PATHS: Readonly<Partial<Record<SiteborneServiceId, string>>> = {
  'company_evidence_graph.v2': '/v2/company/evidence-graph',
  'web_context_verified.v2': '/v2/web/context',
  'document_evidence_json.v2': '/v2/document/evidence-json',
  'verify_agent_output.v2': '/v2/verify/agent-output',
};

/** A 402/error REST response body -- code/message/error only. The 200
 * (fulfilled) body is NOT this shape: it is the governed PCC document
 * itself (see `DurableCachedResult.body`'s doc comment in
 * paid-continuation-workflow.ts), read as `Readonly<Record<string,
 * unknown>>` below rather than through this narrow interface. */
interface RestErrorResultBody {
  code?: string;
  message?: string;
  error?: string;
}

/**
 * Builds an `McpServiceExecutionBoundary` that delegates every call to the
 * real REST route function for that service. `handlers` and `origin` are
 * explicit constructor inputs (not resolved internally) so this function
 * stays trivially unit-testable against injected fixture handlers,
 * independent of any real Cloudflare/D1/CDP wiring -- the real wiring
 * (the four `...CdpProductionRoute` functions) is assembled once, in
 * `apps/edge-api/src/routes/mcp.ts`, the one place production topology is
 * supposed to live.
 */
export function createMcpX402ServiceBoundary(
  env: Env,
  handlers: Readonly<Partial<Record<SiteborneServiceId, McpX402RouteHandler>>>,
  origin: string
): McpServiceExecutionBoundary {
  return {
    async execute(serviceId, input, _context, paymentPayload) {
      const path = MCP_X402_SERVICE_PATHS[serviceId];
      const handler = handlers[serviceId];
      if (!path || !handler) {
        return {
          outcome: 'rejected',
          code: 'service_not_wired',
          message: `${serviceId} has no MCP payment-adapter route wiring`,
        };
      }

      const headers = new Headers({ 'content-type': 'application/json' });
      if (paymentPayload) {
        // Reuses @siteborne/protocol-x402's own encoder -- the identical
        // wire encoding the REST route's own decodePaymentSignatureHeaderSafe
        // expects. This adapter never hand-encodes payment material.
        headers.set('PAYMENT-SIGNATURE', encodePaymentSignatureHeaderSafe(paymentPayload));
      }

      const request = new Request(new URL(path, origin), {
        method: 'POST',
        headers,
        body: JSON.stringify(input ?? {}),
      });

      // A throwaway, single-route Hono sub-app -- the standard, minimal
      // way to invoke an existing Hono route handler function with a
      // fully constructed Context (env bindings included) without hand-
      // building one. Mirrors the exact pattern the real production
      // route modules themselves use for their own internal caching
      // (`new Hono(); createX402ServiceRoute(subApp, config);
      // subApp.request(...)`), applied here to a single already-built
      // handler function instead.
      const subApp = new Hono<{ Bindings: Env }>();
      subApp.post(path, handler);
      const response = await subApp.request(request, undefined, env);

      if (response.status === 402) {
        const body = (await response.json().catch(() => undefined)) as
          | Readonly<Record<string, unknown>>
          | undefined;
        const headerValue = response.headers.get('PAYMENT-REQUIRED');
        const decoded = headerValue ? decodePaymentRequiredHeaderSafe(headerValue) : undefined;
        return {
          outcome: 'payment_required',
          code: 'payment_required',
          message: `${serviceId} requires payment`,
          ...(body ? { details: body as Readonly<Record<string, unknown>> } : {}),
          // Only attached when the REST layer's own header decodes
          // cleanly -- never fabricated when it doesn't, so a decode
          // failure surfaces as "no official carrier available" rather
          // than a synthesized one.
          ...(decoded?.ok ? { paymentRequired: decoded.value } : {}),
        };
      }

      if (response.status === 200) {
        // SUN-1222C-PCC-WIRE-RESULT-IMPLEMENTATION: the entire 200 body
        // *is* the governed v2 result -- the same full PCC document
        // `DurableCachedResult.body` now carries (see its doc comment in
        // paid-continuation-workflow.ts), byte-identical to what the REST
        // transport returns via `c.json(cached.body, ...)`. Never
        // unwrapped to a sub-field: MCP_SERVICE_OUTPUT_SCHEMAS validates
        // this whole object, exactly as REST and A2A do.
        const body = (await response.json()) as Readonly<Record<string, unknown>>;
        const headerValue = response.headers.get('PAYMENT-RESPONSE');
        const decoded = headerValue ? decodePaymentResponseHeaderSafe(headerValue) : undefined;
        return {
          outcome: 'fulfilled',
          result: body,
          ...(decoded?.ok ? { paymentResponse: decoded.value } : {}),
        };
      }

      // Every other status (400 malformed, 402-but-undecodable, 409
      // conflict, 5xx, ...) is a rejection -- reusing the REST layer's own
      // code/message verbatim, never inventing new economics or facts.
      const body = (await response.json().catch(() => ({
        code: 'unexpected_status',
        message: `service returned HTTP ${response.status}`,
      }))) as RestErrorResultBody;
      return {
        outcome: 'rejected',
        // The REST layer's `jsonError` carries its machine code in `error`,
        // not `code`; both are honoured so a caller sees the real reason
        // (e.g. `retrieval_mode_unavailable`) instead of a generic status.
        code: body.code ?? body.error ?? 'unexpected_status',
        message: body.message ?? body.error ?? `service returned HTTP ${response.status}`,
        details: { http_status: response.status },
      };
    },
  };
}
