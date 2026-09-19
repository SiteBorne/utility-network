import type { PaymentDestination, SiteborneServiceId } from '@siteborne/protocol-x402';
import type { AgentCard } from '@a2a-js/sdk';
import type { SiteborneA2aSigningIdentity } from './signing';

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
  /** A complete unsigned card selected by an upstream metadata authority.
   * The transport rejects pre-signed input, then uses the existing signer
   * and verifier exactly once. Omission preserves the legacy card builder. */
  unsignedAgentCard?: AgentCard;
  serviceBoundary?: A2aServiceExecutionBoundary;
  allowedHosts?: readonly string[];
  allowedOrigins?: readonly string[];
  /** Injected signing identity (SUN-1000 checkpoint SUN-0800B-2). Defaults to
   * an ephemeral, non-production `createLocalA2aSigningIdentity()` when
   * omitted -- the same behavior as before this option existed. A real
   * caller (edge-api) constructs a production identity from configured key
   * material and injects it here; this package itself never reads secrets
   * or environment variables. */
  signingIdentity?: SiteborneA2aSigningIdentity;
  /** SUN-1220P2 -- version-local effective public-discovery availability,
   * keyed by service id. Omitted entirely (every caller before this
   * checkpoint, and every caller that doesn't explicitly opt in) keeps
   * every service's `productionEnabled` at the default `false`. A real
   * caller (edge-api) computes this from the exact same version-local
   * ADR-0055/route-flag gates that already govern real execution
   * (`resolveVerifyAgentOutputV2CdpEffectiveDiscoveryStatus`) and injects
   * the result here -- this credential-independent package never reads
   * `env` or D1 itself, preserving the same dependency direction as
   * `signingIdentity`. SUN-1222B: the x402 extension's top-level
   * `productionEnabled` is derived from this map (true iff any entry is
   * true), not set independently -- see `buildX402ExtensionParams` in
   * `card.ts`. */
  effectiveProductionStatusByServiceId?: Partial<Record<SiteborneServiceId, boolean>>;
  /** SUN-1222C-DEPLOYMENT-DEPENDENCY-AND-MTLS-TRUTHFULNESS-REMEDIATION --
   * whether the card may truthfully declare `securitySchemes.mtls`.
   * Omitted entirely (every caller before this checkpoint) keeps the
   * declaration absent, the production-compatible default until a real
   * mTLS production interface is operator-qualified. A real caller
   * (edge-api) computes this from `MTLS_PRODUCTION_ACTIVE` via
   * `resolveMtlsProductionActive` and injects it here -- this
   * credential-independent package never reads `env` itself, the same
   * dependency direction as `signingIdentity` and
   * `effectiveProductionStatusByServiceId` above. */
  mtlsProductionActive?: boolean;
  /** PRODUCTION-ECONOMICS-DISCOVERY-01: the public projection of the governed
   * payment destination (network, asset, payTo), resolved by the caller from
   * real configuration. Absent/`null` means "not configured": the card then
   * declares no destination rather than a placeholder. */
  paymentDestination?: PaymentDestination | null;
}
