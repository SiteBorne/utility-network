/**
 * PRODUCTION-SECURITY-DECLARATIONS-PUBLICATION-01 -- the single edge-api
 * resolution point for the published security declaration.
 *
 * The publication is a pure function of the canonical declaration in
 * `@siteborne/vcm/security`; it is built once per isolate, self-validated
 * (contradictions, narrowing, private-field leakage) and injected as plain
 * data into the existing MCP, A2A, OpenAPI and catalog builders. This module
 * authors no security claim of its own.
 */
import {
  OPENAPI_SECURITY_DECLARATION_KEY,
  a2aSecurityExtension,
  buildSecurityPublication,
  catalogSecurityBlock,
  mcpSecurityMetaByToolName,
  openApiOperationSecurity,
  type SecurityPublication,
} from '@siteborne/vcm';
import { MCP_SERVICE_TOOLS } from '@siteborne/protocol-mcp';

let cached: SecurityPublication | undefined;

/** Fail-closed: a contradictory declaration throws here rather than serving. */
export function getSecurityPublication(): SecurityPublication {
  cached ??= buildSecurityPublication();
  return cached;
}

const UTILITY_TOOL_NAMES = ['siteborne_get_quote', 'siteborne_get_service_health'] as const;

export function getMcpSecurityMetaByToolName(): Record<string, Record<string, unknown>> {
  return mcpSecurityMetaByToolName(
    getSecurityPublication(),
    MCP_SERVICE_TOOLS as Readonly<Record<string, string>>,
    UTILITY_TOOL_NAMES
  );
}

export function getA2aSecurityExtension() {
  return a2aSecurityExtension(getSecurityPublication());
}

export function getCatalogSecurity(serviceId: string) {
  return catalogSecurityBlock(getSecurityPublication(), serviceId);
}

export function getOpenApiSecurityOperationExtensions(
  serviceIds: readonly string[]
): Record<string, Record<string, unknown>> {
  const publication = getSecurityPublication();
  const out: Record<string, Record<string, unknown>> = {};
  for (const id of serviceIds) {
    const ext = openApiOperationSecurity(publication, id);
    if (ext) out[id] = ext;
  }
  return out;
}

export function getOpenApiSecurityDeclaration(): Record<string, unknown> {
  return { [OPENAPI_SECURITY_DECLARATION_KEY]: getSecurityPublication().full };
}
