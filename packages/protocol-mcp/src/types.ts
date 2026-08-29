import type { Network, SiteborneServiceId } from '@siteborne/protocol-x402';

export interface McpInvocationContext {
  protocol_version: '2026-07-28';
  client_name?: string;
  client_version?: string;
}

export type McpServiceBoundaryOutcome =
  | { outcome: 'fulfilled'; result: unknown }
  | {
      outcome: 'payment_required' | 'rejected';
      code: string;
      message: string;
      details?: Readonly<Record<string, unknown>>;
    };

export interface McpServiceExecutionBoundary {
  execute(
    serviceId: SiteborneServiceId,
    input: unknown,
    context: McpInvocationContext
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
