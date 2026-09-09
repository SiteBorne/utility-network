import type { Network, SiteborneServiceId } from '@siteborne/protocol-x402';
import type { PaymentPayload, PaymentRequired, SettleResponse } from '@x402/core/types';

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
  serviceBoundary?: McpServiceExecutionBoundary;
  quote?: McpQuoteConfiguration;
  health?: McpHealthConfiguration;
  allowedHosts?: string[];
  allowedOrigins?: string[];
  onServerCreated?: (serverInstanceId: string) => void;
}
