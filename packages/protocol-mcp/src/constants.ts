import type { SiteborneServiceId } from '@siteborne/protocol-x402';

export const MCP_PROTOCOL_VERSION = '2026-07-28' as const;
export const MCP_SERVER_NAME = 'net.siteborne/utility' as const;
export const MCP_SERVER_VERSION = '0.1.0' as const;

export const MCP_SERVICE_TOOLS = {
  siteborne_company_evidence_graph: 'company_evidence_graph.v1',
  siteborne_web_context_verified: 'web_context_verified.v1',
  siteborne_document_evidence_json: 'document_evidence_json.v1',
  siteborne_verify_agent_output: 'verify_agent_output.v1',
} as const satisfies Readonly<Record<string, SiteborneServiceId>>;

export const MCP_TOOL_NAMES = [
  ...Object.keys(MCP_SERVICE_TOOLS),
  'siteborne_get_quote',
  'siteborne_get_service_health',
] as const;

export type SiteborneMcpToolName = (typeof MCP_TOOL_NAMES)[number];
