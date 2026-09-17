/**
 * Real `McpProjectionContext` builder for runtime shadow comparison
 * (METADATA-VCM-IMPL-04A) -- the production analogue of METADATA-VCM-
 * IMPL-03B's `mcp-shadow.test.ts#contextFromRealTools`. Takes the tool
 * list *already served* on the current request (parsed from the real
 * `tools/list` JSON-RPC response) rather than opening a second synthetic
 * client<->server transport -- the thing being compared against is
 * literally what this response already told the real caller, not a
 * freshly re-derived approximation of it.
 */
import {
  MCP_SERVICE_SCHEMA_METADATA,
  MCP_SERVICE_TOOLS,
  MCP_TOOL_NAMES,
} from '@siteborne/protocol-mcp';
import type { SiteborneServiceId } from '@siteborne/protocol-x402';
import type { SiteborneMcpDefinitionAuthorityInputs } from '@siteborne/protocol-mcp';
import type { CanonicalServiceIdValue } from '../service-id';
import type { McpProjectionContext, McpToolDefinition, McpUtilityToolContext } from './types';

const SERVICE_TOOL_NAME_BY_SERVICE_ID = Object.fromEntries(
  Object.entries(MCP_SERVICE_TOOLS).map(([toolName, serviceId]) => [serviceId, toolName])
) as Record<CanonicalServiceIdValue, string>;

const UTILITY_TOOL_NAMES = ['siteborne_get_quote', 'siteborne_get_service_health'] as const;

/**
 * Primary-mode adapter over the protocol package's typed registration
 * authority. It never accepts a served tools/list response or executable
 * handlers; the returned context contains metadata leaf values only.
 */
export function buildCurrentMcpProjectionContext(
  authority: SiteborneMcpDefinitionAuthorityInputs
): McpProjectionContext {
  const serviceById = new Map(authority.serviceTools.map((tool) => [tool.serviceId, tool]));
  const utilityByName = new Map(authority.utilityTools.map((tool) => [tool.name, tool]));
  const utilityTools: McpUtilityToolContext[] = UTILITY_TOOL_NAMES.map((name) => {
    const tool = utilityByName.get(name);
    if (!tool) throw new Error(`typed MCP authority is missing utility tool "${name}"`);
    return {
      toolName: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      annotations: {
        readOnlyHint: tool.annotations.readOnlyHint ?? false,
        destructiveHint: tool.annotations.destructiveHint ?? false,
        idempotentHint: tool.annotations.idempotentHint ?? false,
      },
    };
  });
  return {
    toolOrder: [...authority.toolOrder],
    serviceTool: (serviceId) => {
      const tool = serviceById.get(serviceId as SiteborneServiceId);
      if (!tool) throw new Error(`typed MCP authority is missing service tool for "${serviceId}"`);
      return {
        toolName: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        inputSchemaUri: tool.inputSchemaUri,
        outputSchemaUri: tool.outputSchemaUri,
        annotations: {
          readOnlyHint: tool.annotations.readOnlyHint ?? false,
          destructiveHint: tool.annotations.destructiveHint ?? false,
          idempotentHint: tool.annotations.idempotentHint ?? false,
        },
      };
    },
    utilityTools,
  };
}

/** Response-derived context retained exclusively for legacy-serving shadow observation. */
export function buildRealMcpShadowContext(
  realTools: readonly McpToolDefinition[]
): McpProjectionContext {
  const byName = new Map(realTools.map((tool) => [tool.name, tool]));
  const utilityTools: McpUtilityToolContext[] = UTILITY_TOOL_NAMES.map((name) => {
    const tool = byName.get(name);
    if (!tool) throw new Error(`real tool list is missing expected utility tool "${name}"`);
    return {
      toolName: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      annotations: tool.annotations,
    };
  });
  return {
    toolOrder: [...MCP_TOOL_NAMES],
    serviceTool: (serviceId) => {
      const toolName = SERVICE_TOOL_NAME_BY_SERVICE_ID[serviceId];
      const tool = byName.get(toolName);
      if (!tool)
        throw new Error(`real tool list is missing expected service tool for "${serviceId}"`);
      const schemaMeta = MCP_SERVICE_SCHEMA_METADATA[serviceId as SiteborneServiceId];
      return {
        toolName,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        inputSchemaUri: schemaMeta.input_uri,
        outputSchemaUri: schemaMeta.output_uri,
        annotations: tool.annotations,
      };
    },
    utilityTools,
  };
}
