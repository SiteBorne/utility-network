import {
  createMcpHandler,
  fromJsonSchema,
  McpServer,
  type JsonSchemaType,
} from '@modelcontextprotocol/server';
import { createMcpHonoApp } from '@modelcontextprotocol/hono';
import {
  buildQuote,
  buildExactPaymentRequirement,
  buildUptoPaymentRequirement,
  hashPaymentObject,
  resolvePricingSourceVersion,
  resolveServiceMaxPriceUsd,
  usdToAtomicUnits,
  type SiteborneServiceId,
} from '@siteborne/protocol-x402';
import { z } from 'zod';
import {
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  MCP_SERVICE_TOOLS,
} from './constants';
import {
  MCP_SERVICE_INPUT_SCHEMAS,
  MCP_SERVICE_OUTPUT_SCHEMAS,
  MCP_SERVICE_SCHEMA_METADATA,
} from './frozen-contracts';
import type {
  CreateSiteborneMcpOptions,
  McpInvocationContext,
  McpQuoteConfiguration,
  McpServiceExecutionBoundary,
} from './types';

const defaultBoundary: McpServiceExecutionBoundary = {
  async execute(serviceId) {
    return {
      outcome: 'payment_required',
      code: 'payment_required',
      message: `${serviceId} requires the accepted SITEBORNE x402 paid-service boundary`,
      details: { free_execution_enabled: false },
    };
  },
};

const quoteInputSchema = z
  .object({
    // SUN-1000 checkpoint 1M: .v2 added alongside .v1 (checkpoint 1L
    // PREPRODUCTION_V2_REPLACEMENT — v1 remains valid, v2 is additive).
    service_id: z.enum([
      'company_evidence_graph.v1',
      'web_context_verified.v1',
      'document_evidence_json.v1',
      'verify_agent_output.v1',
      'company_evidence_graph.v2',
      'web_context_verified.v2',
      'document_evidence_json.v2',
      'verify_agent_output.v2',
    ]),
    scheme: z.enum(['exact', 'upto']),
    input: z.unknown(),
  })
  .strict();

const quoteOutputSchema = z
  .object({
    quote_id: z.string(),
    binding_hash: z.string(),
    service_id: z.string(),
    // SUN-1000 checkpoint 1M: widened from the literal 'v1'/'1.0.0' — a
    // v2 quote genuinely reports service_version 'v2' and
    // contract_release '2.0.0'.
    service_version: z.enum(['v1', 'v2']),
    contract_release: z.enum(['1.0.0', '2.0.0']),
    input_hash: z.string(),
    pricing_key: z.string(),
    pricing_source_version: z.string(),
    scheme: z.enum(['exact', 'upto']),
    network: z.string(),
    asset: z.string(),
    amount: z.string(),
    amount_kind: z.enum(['exact', 'authorized_maximum']),
    actual_amount: z.null(),
    resource_id: z.string(),
    requirement_id: z.string(),
    payment_requirements: z.record(z.string(), z.unknown()),
    payee: z.string(),
    issued_at: z.string(),
    expires_at: z.string(),
    production_enabled: z.literal(false),
    payment_required: z.literal(true),
  })
  .strict();

const healthOutputSchema = z
  .object({
    status: z.literal('ready_local'),
    server_name: z.literal(MCP_SERVER_NAME),
    server_version: z.literal(MCP_SERVER_VERSION),
    protocol_version: z.literal(MCP_PROTOCOL_VERSION),
    tools: z.literal(6),
    production_ready: z.literal(false),
    production_enabled: z.boolean(),
    external_publication: z.literal('blocked_external'),
    services: z.record(
      z.string(),
      z.object({
        implementation: z.enum(['local_fixture_verified', 'real_executor']),
        production: z.enum(['production_disabled', 'production_enabled']),
        external: z.enum(['not_live', 'configured']),
      })
    ),
  })
  .strict();

// SUN-1000 checkpoint 1M: v2 entries are byte-identical pricing keys
// (SAME_ECONOMICS_NEW_SERVICE_MAJOR, checkpoint 1L section 9).
const EXACT_PRICING_KEYS: Readonly<
  Record<SiteborneServiceId, Parameters<typeof resolveServiceMaxPriceUsd>[0]>
> = {
  'company_evidence_graph.v1': 'company_evidence_graph',
  'web_context_verified.v1': 'web_context_verified_direct',
  'document_evidence_json.v1': 'document_evidence_json_native',
  'verify_agent_output.v1': 'verify_agent_output_standard',
  'company_evidence_graph.v2': 'company_evidence_graph',
  'web_context_verified.v2': 'web_context_verified_direct',
  'document_evidence_json.v2': 'document_evidence_json_native',
  'verify_agent_output.v2': 'verify_agent_output_standard',
};

const UPTO_PRICING_KEYS: Readonly<
  Record<SiteborneServiceId, Parameters<typeof resolveServiceMaxPriceUsd>[0]>
> = {
  'company_evidence_graph.v1': 'company_evidence_graph',
  'web_context_verified.v1': 'web_context_verified_rendered',
  'document_evidence_json.v1': 'document_evidence_json_max_job',
  'verify_agent_output.v1': 'verify_agent_output_reproduction',
  'company_evidence_graph.v2': 'company_evidence_graph',
  'web_context_verified.v2': 'web_context_verified_rendered',
  'document_evidence_json.v2': 'document_evidence_json_max_job',
  'verify_agent_output.v2': 'verify_agent_output_reproduction',
};

const SERVICE_RESOURCES: Readonly<Record<SiteborneServiceId, string>> = {
  'company_evidence_graph.v1': 'https://utility.siteborne.net/v1/company_evidence_graph',
  'web_context_verified.v1': 'https://utility.siteborne.net/v1/web_context_verified',
  'document_evidence_json.v1': 'https://utility.siteborne.net/v1/document_evidence_json',
  'verify_agent_output.v1': 'https://utility.siteborne.net/v1/verify_agent_output',
  'company_evidence_graph.v2': 'https://utility.siteborne.net/v2/company_evidence_graph',
  'web_context_verified.v2': 'https://utility.siteborne.net/v2/web_context_verified',
  'document_evidence_json.v2': 'https://utility.siteborne.net/v2/document_evidence_json',
  'verify_agent_output.v2': 'https://utility.siteborne.net/v2/verify_agent_output',
};

const HOSTILE_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function containsHostileObjectKey(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsHostileObjectKey);
  }
  if (value === null || typeof value !== 'object') {
    return false;
  }
  return Object.entries(value).some(
    ([key, nested]) => HOSTILE_OBJECT_KEYS.has(key) || containsHostileObjectKey(nested)
  );
}

function invocationContext(context: {
  mcpReq: {
    envelope?: {
      'io.modelcontextprotocol/clientInfo'?: { name?: string; version?: string };
    };
  };
}): McpInvocationContext {
  const clientInfo = context.mcpReq.envelope?.['io.modelcontextprotocol/clientInfo'];
  return {
    protocol_version: MCP_PROTOCOL_VERSION,
    client_name: clientInfo?.name,
    client_version: clientInfo?.version,
  };
}

function errorResult(code: string, message: string, details?: Readonly<Record<string, unknown>>) {
  const safe = { code, message, ...(details ? { details } : {}) };
  return {
    isError: true as const,
    content: [{ type: 'text' as const, text: JSON.stringify(safe) }],
  };
}

async function buildCanonicalQuote(
  input: z.infer<typeof quoteInputSchema>,
  config: McpQuoteConfiguration
) {
  const pricingKey =
    input.scheme === 'exact'
      ? EXACT_PRICING_KEYS[input.service_id]
      : UPTO_PRICING_KEYS[input.service_id];
  const amount = usdToAtomicUnits(resolveServiceMaxPriceUsd(pricingKey), 6);
  const now = (config.now ?? (() => new Date()))();
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + (config.ttlSeconds ?? 300) * 1000).toISOString();
  // SUN-1000 checkpoint 1M: derived from the requested service_id's own
  // major suffix rather than hardcoded literals.
  const isV2 = input.service_id.endsWith('.v2');
  const quote = await buildQuote({
    service_id: input.service_id,
    service_version: isV2 ? 'v2' : 'v1',
    contract_release: isV2 ? '2.0.0' : '1.0.0',
    input_hash: await hashPaymentObject(input.input),
    pricing_key: pricingKey,
    pricing_source_version: resolvePricingSourceVersion(),
    scheme: input.scheme,
    network: config.network,
    asset: config.asset,
    amount,
    payee: config.payee,
    issued_at: issuedAt,
    expires_at: expiresAt,
  });
  const resourceId = SERVICE_RESOURCES[input.service_id];
  const paymentRequirement =
    input.scheme === 'exact'
      ? await buildExactPaymentRequirement({
          quote,
          resource_id: resourceId,
          maxTimeoutSeconds: config.ttlSeconds ?? 300,
        })
      : await buildUptoPaymentRequirement({
          quote,
          resource_id: resourceId,
          maxTimeoutSeconds: config.ttlSeconds ?? 300,
        });
  return {
    quote_id: quote.quote_id,
    binding_hash: quote.binding_hash,
    service_id: quote.service_id,
    service_version: quote.service_version,
    contract_release: quote.contract_release,
    input_hash: quote.input_hash,
    pricing_key: quote.pricing_key,
    pricing_source_version: quote.pricing_source_version ?? 'unknown',
    scheme: quote.scheme,
    network: quote.network,
    asset: quote.asset,
    amount: quote.amount,
    amount_kind: input.scheme === 'exact' ? ('exact' as const) : ('authorized_maximum' as const),
    actual_amount: null,
    resource_id: resourceId,
    requirement_id: paymentRequirement.requirement_id,
    payment_requirements: paymentRequirement.requirement,
    payee: quote.payee,
    issued_at: quote.issued_at,
    expires_at: quote.expires_at,
    production_enabled: false as const,
    payment_required: true as const,
  };
}

export function createSiteborneMcpServer(options: CreateSiteborneMcpOptions = {}): McpServer {
  const serverInstanceId = crypto.randomUUID();
  options.onServerCreated?.(serverInstanceId);
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { capabilities: { tools: {} } }
  );
  const boundary = options.serviceBoundary ?? defaultBoundary;

  for (const [toolName, serviceId] of Object.entries(MCP_SERVICE_TOOLS)) {
    server.registerTool(
      toolName,
      {
        title: toolName.replaceAll('_', ' '),
        description: `Invoke ${serviceId} through the accepted SITEBORNE execution/payment boundary.`,
        inputSchema: fromJsonSchema(MCP_SERVICE_INPUT_SCHEMAS[serviceId] as JsonSchemaType),
        outputSchema: fromJsonSchema(MCP_SERVICE_OUTPUT_SCHEMAS[serviceId] as JsonSchemaType),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
        _meta: {
          'net.siteborne/serviceId': serviceId,
          'net.siteborne/inputSchema': MCP_SERVICE_SCHEMA_METADATA[serviceId].input_uri,
          'net.siteborne/outputSchema': MCP_SERVICE_SCHEMA_METADATA[serviceId].output_uri,
          'net.siteborne/paymentRequired': true,
        },
      },
      async (input, context) => {
        if (containsHostileObjectKey(input)) {
          return errorResult('invalid_input', 'input contains a forbidden object key');
        }
        const outcome = await boundary.execute(serviceId, input, invocationContext(context));
        if (outcome.outcome !== 'fulfilled') {
          return errorResult(outcome.code, outcome.message, outcome.details);
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(outcome.result) }],
          structuredContent: outcome.result,
        };
      }
    );
  }

  server.registerTool(
    'siteborne_get_quote',
    {
      title: 'Get SITEBORNE quote',
      description: 'Build a canonical x402-bound exact or upto quote without executing a service.',
      inputSchema: quoteInputSchema,
      outputSchema: quoteOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (input) => {
      if (!options.quote) {
        return errorResult('quote_configuration_unavailable', 'quote configuration is unavailable');
      }
      const quote = await buildCanonicalQuote(input, options.quote);
      return {
        content: [{ type: 'text', text: JSON.stringify(quote) }],
        structuredContent: quote,
      };
    }
  );

  server.registerTool(
    'siteborne_get_service_health',
    {
      title: 'Get SITEBORNE service health',
      description:
        'Report the credential-independent MCP foundation and production gate truthfully.',
      inputSchema: z.object({}).strict(),
      outputSchema: healthOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async () => {
      const health = {
        status: 'ready_local' as const,
        server_name: MCP_SERVER_NAME,
        server_version: MCP_SERVER_VERSION,
        protocol_version: MCP_PROTOCOL_VERSION,
        tools: 6 as const,
        production_ready: options.health?.production_ready ?? false,
        production_enabled: options.health?.production_enabled ?? false,
        external_publication: 'blocked_external' as const,
        services: Object.fromEntries(
          Object.values(MCP_SERVICE_TOOLS).map((serviceId) => {
            const defaultStatus = {
              implementation: 'local_fixture_verified' as const,
              production: 'production_disabled' as const,
              external: 'not_live' as const,
            };
            return [serviceId, options.health?.services?.[serviceId] ?? defaultStatus];
          })
        ),
      };
      return {
        content: [{ type: 'text', text: JSON.stringify(health) }],
        structuredContent: health,
      };
    }
  );

  return server;
}

export function createSiteborneMcpHandler(options: CreateSiteborneMcpOptions = {}) {
  const handler = createMcpHandler(() => createSiteborneMcpServer(options), { legacy: 'reject' });
  return {
    async fetch(request: Request): Promise<Response> {
      if (request.method === 'POST') {
        try {
          const payload: unknown = await request.clone().json();
          if (containsHostileObjectKey(payload)) {
            return Response.json(
              {
                jsonrpc: '2.0',
                id: null,
                error: { code: -32602, message: 'Invalid params: forbidden object key' },
              },
              { status: 400 }
            );
          }
        } catch {
          // The official SDK owns malformed JSON and protocol error mapping.
        }
      }
      return handler.fetch(request);
    },
  };
}

export function createSiteborneMcpHonoApp(options: CreateSiteborneMcpOptions = {}) {
  const app = createMcpHonoApp({
    host: options.allowedHosts?.[0] ?? '127.0.0.1',
    allowedHosts: options.allowedHosts,
    allowedOrigins: options.allowedOrigins,
  });
  const handler = createSiteborneMcpHandler(options);
  app.all('/mcp', (context) => handler.fetch(context.req.raw));
  return app;
}
