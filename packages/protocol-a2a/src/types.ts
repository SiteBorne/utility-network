import type { SiteborneServiceId } from '@siteborne/protocol-x402';

export interface SiteborneA2aInvocation {
  skillId: SiteborneServiceId;
  serviceVersion: 'v1';
  input: unknown;
  /** Opaque transport context only. The accepted x402 boundary validates it. */
  payment?: unknown;
}

export interface A2aInvocationContext {
  messageId: string;
  taskId: string;
  contextId: string;
  protocolVersion: '1.0';
}

export type A2aExecutionFailureCode =
  | 'payment_required'
  | 'production_disabled'
  | 'external_dependency_unavailable'
  | 'service_verification_failed'
  | 'repository_error';

export type A2aServiceExecutionOutcome =
  | { outcome: 'fulfilled'; result: unknown }
  | {
      outcome: 'failed';
      code: A2aExecutionFailureCode;
      message: string;
    };

export interface A2aServiceExecutionBoundary {
  execute(
    serviceId: SiteborneServiceId,
    input: unknown,
    context: A2aInvocationContext
  ): Promise<A2aServiceExecutionOutcome>;
}

export interface CreateSiteborneA2aOptions {
  serviceBoundary?: A2aServiceExecutionBoundary;
  allowedHosts?: readonly string[];
  allowedOrigins?: readonly string[];
}
