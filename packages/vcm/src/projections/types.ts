/**
 * Shared shapes for shadow protocol projections (METADATA-VCM-IMPL-03B).
 * Every SITEBORNE-specific literal a projector needs (agent name, origin,
 * protocol version, per-service route/scheme, mTLS gate, tool schemas) is
 * supplied through a context object populated by the caller from the real
 * typed authorities (`@siteborne/protocol-a2a`, `@siteborne/protocol-mcp`,
 * `@siteborne/protocol-x402`) -- the adapters themselves hold no
 * SITEBORNE-specific identifiers and cannot independently author one.
 */
import type { EconomicOfferProjection, PaymentDestination } from '@siteborne/pricing';
import type { CanonicalServiceIdValue } from '../service-id';

// ---------------------------------------------------------------------------
// A2A
// ---------------------------------------------------------------------------
export interface A2aMtlsSecurityScheme {
  readonly key: string;
  readonly description: string;
}

export interface A2aProjectionContext {
  readonly agentName: string;
  readonly agentDescription: string;
  readonly agentVersion: string;
  readonly documentationUrl: string;
  readonly interfaceUrl: string;
  readonly protocolVersion: string;
  readonly provider: { readonly organization: string; readonly url: string };
  readonly x402ExtensionUri: string;
  readonly x402Version: number;
  readonly resourceOrigin: string;
  /** Declared skill order (real system: `SITEBORNE_SERVICE_IDS`). Services
   * present in the effective view but absent from this list sort after all
   * listed services, ordered alphabetically among themselves. */
  readonly serviceOrder: readonly CanonicalServiceIdValue[];
  readonly resourcePath: (serviceId: CanonicalServiceIdValue) => string;
  readonly scheme: (serviceId: CanonicalServiceIdValue) => 'exact' | 'upto';
  readonly effectiveProductionStatusByServiceId: Readonly<
    Partial<Record<CanonicalServiceIdValue, boolean>>
  >;
  readonly mtlsSecurityScheme: A2aMtlsSecurityScheme | null;
  /** OPERATIONAL public payment destination; `null` = not configured. */
  readonly paymentDestination: PaymentDestination | null;
  /** Additive security-declaration extension (publication); absent = none. */
  readonly securityDeclarationExtension?: {
    readonly uri: string;
    readonly description: string;
    readonly required: false;
    readonly params: Readonly<Record<string, unknown>>;
  } | null;
}

export interface UnsignedAgentSkill {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly examples: readonly string[];
  readonly inputModes: readonly string[];
  readonly outputModes: readonly string[];
  readonly securityRequirements: readonly unknown[];
}

export interface UnsignedAgentCardX402ServiceEntry {
  readonly serviceId: CanonicalServiceIdValue;
  readonly serviceVersion: string;
  readonly scheme: 'exact' | 'upto';
  readonly resource: string;
  readonly inputSchemaUri: string;
  readonly outputSchemaUri: string;
  readonly declaredLimitations: readonly string[];
  readonly productionEnabled: boolean;
  readonly economics: EconomicOfferProjection;
}

export interface UnsignedAgentCard {
  readonly name: string;
  readonly description: string;
  readonly supportedInterfaces: readonly {
    readonly url: string;
    readonly protocolBinding: 'JSONRPC';
    readonly protocolVersion: string;
    readonly tenant: string;
  }[];
  readonly provider: { readonly organization: string; readonly url: string };
  readonly version: string;
  readonly documentationUrl: string;
  readonly capabilities: {
    readonly streaming: boolean;
    readonly pushNotifications: boolean;
    readonly extendedAgentCard: boolean;
    readonly extensions: readonly {
      readonly uri: string;
      readonly description: string;
      readonly required: boolean;
      readonly params:
        | {
            readonly x402Version: number;
            readonly paymentRequiredForUsefulExecution: boolean;
            readonly productionEnabled: boolean;
            readonly services: readonly UnsignedAgentCardX402ServiceEntry[];
          }
        // Additive security-declaration extension (publication).
        | Readonly<Record<string, unknown>>;
    }[];
  };
  readonly securitySchemes: Readonly<Record<string, unknown>>;
  readonly securityRequirements: readonly unknown[];
  readonly defaultInputModes: readonly string[];
  readonly defaultOutputModes: readonly string[];
  readonly skills: readonly UnsignedAgentSkill[];
  readonly signatures: readonly unknown[];
}

// ---------------------------------------------------------------------------
// MCP
// ---------------------------------------------------------------------------
export interface McpToolAnnotations {
  readonly readOnlyHint: boolean;
  readonly destructiveHint: boolean;
  readonly idempotentHint: boolean;
  readonly openWorldHint: boolean;
}

export interface McpServiceToolContext {
  readonly toolName: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: unknown;
  readonly outputSchema: unknown;
  readonly inputSchemaUri: string;
  readonly outputSchemaUri: string;
  readonly annotations: McpToolAnnotations;
  /** Additive `net.siteborne/security*` metadata only (publication). */
  readonly securityMeta?: Readonly<Record<string, unknown>>;
}

export interface McpUtilityToolContext {
  readonly toolName: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: unknown;
  readonly outputSchema: unknown;
  readonly annotations: McpToolAnnotations;
  readonly securityMeta?: Readonly<Record<string, unknown>>;
}

export interface McpProjectionContext {
  /** Real declared registration order (`MCP_TOOL_NAMES`). */
  readonly toolOrder: readonly string[];
  readonly serviceTool: (serviceId: CanonicalServiceIdValue) => McpServiceToolContext;
  readonly utilityTools: readonly McpUtilityToolContext[];
}

export interface McpToolDefinition {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: unknown;
  readonly outputSchema: unknown;
  readonly annotations: McpToolAnnotations;
  readonly _meta?: Readonly<Record<string, unknown>>;
}
