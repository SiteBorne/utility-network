/**
 * Pure VCM -> MCP tool-list shadow projection (METADATA-VCM-IMPL-03B §IX).
 * Tool selection, count, and ordering come from VCM's own current static
 * exposure facts + the injected `toolOrder`; per-tool prose/schema content
 * (governed overrides with no other typed authority) comes from context
 * unchanged -- this adapter assembles, it does not author.
 */
import type { EffectiveMetadataView } from '../effective-view';
import type { McpProjectionContext, McpToolDefinition } from './types';

function toolOrderIndex(context: McpProjectionContext, name: string): number {
  const index = context.toolOrder.indexOf(name);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

export function projectMcpToolsFromVcm(
  effective: EffectiveMetadataView,
  context: McpProjectionContext
): readonly McpToolDefinition[] {
  const serviceTools: McpToolDefinition[] = [];

  for (const service of effective.services) {
    const interaction = service.interactions.find((candidate) =>
      candidate.currentStaticExposures.some(
        (exposure) => exposure.surface === 'mcp' && exposure.exposureShape === 'standalone_tool'
      )
    );
    if (!interaction) continue;

    const toolCtx = context.serviceTool(service.id);
    serviceTools.push({
      name: toolCtx.toolName,
      title: toolCtx.title,
      description: toolCtx.description,
      inputSchema: toolCtx.inputSchema,
      outputSchema: toolCtx.outputSchema,
      annotations: {
        readOnlyHint: interaction.readOnly,
        destructiveHint: interaction.destructive,
        idempotentHint: interaction.idempotent,
        // Whether execution reaches outside SITEBORNE is a canonical fact of the
        // service's economic contract, not an MCP-authored one.
        openWorldHint: service.economicOffer.openWorld,
      },
      _meta: {
        'net.siteborne/serviceId': service.id,
        'net.siteborne/inputSchema': toolCtx.inputSchemaUri,
        'net.siteborne/outputSchema': toolCtx.outputSchemaUri,
        'net.siteborne/paymentRequired': true,
      },
    });
  }

  const utilityTools: McpToolDefinition[] = context.utilityTools.map((tool) => ({
    name: tool.toolName,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    annotations: tool.annotations,
  }));

  return [...serviceTools, ...utilityTools].sort(
    (a, b) =>
      toolOrderIndex(context, a.name) - toolOrderIndex(context, b.name) ||
      a.name.localeCompare(b.name)
  );
}
