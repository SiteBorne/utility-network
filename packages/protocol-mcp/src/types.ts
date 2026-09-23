import type { Network, SiteborneServiceId } from '@siteborne/protocol-x402';
import type { JsonSchemaType, MetaObject, ToolAnnotations } from '@modelcontextprotocol/server';
import type { PaymentPayload, PaymentRequired, SettleResponse } from '@x402/core/types';
import type { MCP_SERVICE_TOOLS, SiteborneMcpToolName } from './constants';

export interface McpInvocationContext {
  protocol_version: '2026-07-28';
  client_name?: string;
  client_version?: string;
}

// SUN-1222C-MCP-PAYMENT-DESIGN-CORRECTION (Architecture C): a
// 'payment_required' outcome now carries the official PaymentRequired
// object (see x402-wire.ts) so the tool handler can emit the exact
// upstream wire shape instead of an ad-hoc SITEBORNE-only one. A
// 'fulfilled' outcome may carry a SettleResponse to attach as the
// official payment-response carrier -- optional because not every
// boundary (e.g. the closed-by-default defaultBoundary, which never
// reaches a real payment) has one to report.
export type McpServiceBoundaryOutcome =
  | { outcome: 'fulfilled'; result: unknown; paymentResponse?: SettleResponse }
  | {
      outcome: 'payment_required';
      code: string;
      message: string;
      details?: Readonly<Record<string, unknown>>;
      paymentRequired?: PaymentRequired;
    }
  | {
      outcome: 'rejected';
      code: string;
      message: string;
      details?: Readonly<Record<string, unknown>>;
    };

export interface McpServiceExecutionBoundary {
  execute(
    serviceId: SiteborneServiceId,
    input: unknown,
    context: McpInvocationContext,
    // The already-extracted, already-schema-validated PaymentPayload from
    // this call's `_meta["x402/payment"]` (see x402-wire.ts's
    // extractPaymentPayload) -- undefined for a genuinely unpaid call.
    // Extraction happens once, centrally, in server.ts; a boundary
    // implementation never re-parses `_meta` itself.
    paymentPayload: PaymentPayload | undefined
  ): Promise<McpServiceBoundaryOutcome>;
}

export interface McpQuoteConfiguration {
  network: Network;
  asset: string;
  payee: string;
  now?: () => Date;
  ttlSeconds?: number;
}

export interface McpHealthConfiguration {
  production_ready: false;
  production_enabled: boolean;
  services?: Partial<Record<SiteborneServiceId, McpServiceHealthStatus>>;
}

export interface McpServiceHealthStatus {
  implementation: 'local_fixture_verified' | 'real_executor';
  production: 'production_disabled' | 'production_enabled';
  external: 'not_live' | 'configured';
}

export interface CreateSiteborneMcpOptions {
  readonly toolDefinitions?: readonly SiteborneMcpToolDefinition[];
  serviceBoundary?: McpServiceExecutionBoundary;
  quote?: McpQuoteConfiguration;
  health?: McpHealthConfiguration;
  allowedHosts?: string[];
  allowedOrigins?: string[];
  /** Exact governed selector required before any Release 3 candidate tool executes. */
  releaseSelection?: '3.0.0-public-candidate';
  onServerCreated?: (serverInstanceId: string) => void;
  /**
   * PRODUCTION-SECURITY-DECLARATIONS-PUBLICATION-01: additive per-tool `_meta`
   * entries (keyed by MCP tool name) derived from the canonical security
   * declaration by the caller. Plain data only; this package never imports the
   * declaration. Absent = no security metadata, exactly as before. Entries may
   * only add `net.siteborne/security*` keys; they cannot override an existing
   * `_meta` key, the tool name, schemas, annotations or the tool count.
   */
  readonly securityMetaByToolName?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  /** Server-owned transport authentication is configured for the two
   * buyer-authorized v3 tools. This is capability state, never client input. */
  readonly buyerResultAuthorizationReady?: boolean;
  /** Verified transport principal for this request, supplied by the server. */
  readonly buyerResultCallerAuthenticated?: boolean;
}

export interface SiteborneMcpToolDefinition {
  readonly name: SiteborneMcpToolName;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: JsonSchemaType;
  readonly outputSchema: JsonSchemaType;
  readonly annotations: ToolAnnotations;
  readonly _meta?: MetaObject;
}

export interface SiteborneMcpServiceDefinitionAuthorityInput extends SiteborneMcpToolDefinition {
  readonly name: keyof typeof MCP_SERVICE_TOOLS;
  readonly serviceId: SiteborneServiceId;
  readonly inputSchemaUri: string;
  readonly outputSchemaUri: string;
}

export interface SiteborneMcpUtilityDefinitionAuthorityInput extends SiteborneMcpToolDefinition {
  readonly name: 'siteborne_get_quote' | 'siteborne_get_service_health';
}

export interface SiteborneMcpDefinitionAuthorityInputs {
  readonly toolOrder: readonly SiteborneMcpToolName[];
  readonly serviceTools: readonly SiteborneMcpServiceDefinitionAuthorityInput[];
  readonly utilityTools: readonly SiteborneMcpUtilityDefinitionAuthorityInput[];
}
