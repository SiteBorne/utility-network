import type { SiteborneServiceId } from '@siteborne/protocol-x402';

export const MCP_PROTOCOL_VERSION = '2026-07-28' as const;
export const MCP_SERVER_NAME = 'net.siteborne/utility' as const;
export const MCP_SERVER_VERSION = '0.1.0' as const;

// SUN-1000 checkpoint 1M: tool names stay stable; forward tool execution
// now targets the v2 service IDs (checkpoint 1L section 16 — the existing
// tool-name convention was never version-suffixed, so this is a pure
// value remap, no rename). v1 protocol evidence is preserved separately
// in fixtures/tests, not in this live map.
export const MCP_SERVICE_TOOLS = {
  siteborne_build_company_evidence_graph: 'company_evidence_graph.v2',
  siteborne_retrieve_verified_web_context: 'web_context_verified.v2',
  siteborne_extract_document_evidence_json: 'document_evidence_json.v2',
  siteborne_verify_agent_output: 'verify_agent_output.v2',
} as const satisfies Readonly<Record<string, SiteborneServiceId>>;

export const MCP_TOOL_NAMES = [
  ...Object.keys(MCP_SERVICE_TOOLS),
  'siteborne_get_quote',
  'siteborne_get_service_health',
] as const;

export type SiteborneMcpToolName = (typeof MCP_TOOL_NAMES)[number];
