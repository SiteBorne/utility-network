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
import {
  attachPaymentResponseMeta,
  buildPaymentRequiredResult,
  extractPaymentPayload,
  type McpRequestMeta,
} from './x402-wire';

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
    service_id: z
      .enum([
        'company_evidence_graph.v1',
        'web_context_verified.v1',
        'document_evidence_json.v1',
        'verify_agent_output.v1',
        'company_evidence_graph.v2',
        'web_context_verified.v2',
        'document_evidence_json.v2',
        'verify_agent_output.v2',
      ])
      .describe(
        'Canonical SITEBORNE service and major version to price; selects that service’s governed pricing key, contract release, and production resource URL.'
      ),
    scheme: z
      .enum(['exact', 'upto'])
      .describe(
        'Pricing mode: exact fixes the required amount, while upto authorizes a maximum whose eventual charge cannot exceed the returned amount.'
      ),
    input: z
      .unknown()
      .describe(
        'Complete proposed input for the selected service; its canonical hash binds the quote and later payment requirement to this exact request content.'
      ),
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

const SERVICE_INPUT_DESCRIPTION_OVERRIDES: Readonly<
  Record<SiteborneServiceId, Readonly<Record<string, string>>>
> = {
  'company_evidence_graph.v1': {},
  'company_evidence_graph.v2': {
    company_name:
      'Legal or commonly used company name; supplies an entity-resolution signal when authoritative identifiers are unavailable.',
    ticker:
      'One-to-five uppercase exchange ticker symbols; narrows public-company resolution but is not globally unique without other signals.',
    domain:
      'Primary website hostname only, without a URL path; links first-party web evidence to the company identity.',
    identifiers:
      'Known authoritative entity identifiers; supplying precise identifiers reduces ambiguous name, ticker, or domain matching.',
    'identifiers.cik': 'Exactly ten decimal digits identifying the company in SEC EDGAR.',
    'identifiers.lei':
      'Exactly twenty uppercase alphanumeric characters for the Legal Entity Identifier.',
    'identifiers.isin': 'Twelve-character International Securities Identification Number.',
    'identifiers.cusip': 'Nine-character CUSIP security identifier.',
    'identifiers.ticker_symbol':
      'One-to-five uppercase characters for the primary listed ticker when it differs from ticker.',
    'identifiers.exchange':
      'Primary listing exchange name or code, up to sixteen characters; disambiguates reused ticker symbols.',
    'identifiers.figi': 'Twelve-character OpenFIGI identifier beginning with BBG.',
    requested_field_groups:
      'Unique evidence categories to collect; omitted values use the schema default, while a smaller list limits provider work and result scope.',
    buyer_urls:
      'Up to twenty public supplemental evidence URLs supplied by the buyer; these are additional sources, not replacements for entity resolution.',
    freshness_seconds:
      'Maximum acceptable source age in seconds, from 0 through 2,592,000; lower values demand fresher evidence.',
    minimum_completeness:
      'Required completeness ratio from 0 through 1; results below this threshold fail the requested acceptance condition.',
    minimum_verification_score:
      'Required PCC verification ratio from 0 through 1; raising it makes result acceptance stricter.',
    maximum_authorized_price:
      'Buyer’s decimal-safe maximum authorized price; constrains the payment requirement and never expands provider scope.',
    jurisdiction_hints:
      'Up to five two-letter uppercase jurisdiction codes used to focus regulatory context; hints do not assert incorporation.',
  },
  'web_context_verified.v1': {},
  'web_context_verified.v2': {
    target_url:
      'Public HTTP or HTTPS URL to retrieve and verify; private, loopback, and otherwise unsafe network destinations are rejected.',
    retrieval_mode:
      'direct fetches the origin response without browser rendering; rendered permits browser-backed retrieval for client-rendered pages and may cost more.',
    output_mode:
      'Result representation: clean_text normalizes prose, markdown preserves document structure, and structured validates selected fields against buyer_schema.',
    buyer_schema:
      'Optional JSON Schema governing structured output; meaningful only with output_mode structured and bounded to fifty properties and depth five.',
    field_selectors:
      'Up to thirty requested field names for structured extraction; narrows the structured result rather than changing the fetched URL.',
    freshness_seconds:
      'Maximum acceptable cached-content age in seconds, from 0 through 2,592,000; zero requests uncached content.',
    max_content_size:
      'Maximum returned content size in bytes, from 1,024 through 10,485,760; smaller limits truncate or reject oversized content sooner.',
    redirect_policy:
      'Redirect handling: follow permits the bounded chain, follow_first permits only the first hop, and manual returns redirect evidence without following.',
    max_redirects:
      'Maximum redirect hops from 0 through 10 when the selected redirect policy follows redirects.',
    locale_hint:
      'Optional BCP 47 language or language-region hint used for HTTP content negotiation; it does not translate content.',
    minimum_verification_score:
      'Required PCC verification ratio from 0 through 1; raising it makes evidence acceptance stricter.',
    maximum_authorized_price:
      'Buyer’s decimal-safe maximum authorized price; constrains the payment requirement and never changes retrieval scope.',
  },
  'document_evidence_json.v1': {},
  'document_evidence_json.v2': {
    artifact_reference:
      'Authorized stored-artifact descriptor for reference mode 1; use exactly one of artifact_reference, upload_reference, or document_url.',
    upload_reference:
      'Previously issued SITEBORNE upload handle and declared file metadata for reference mode 2; it does not upload document bytes.',
    'upload_reference.upload_id':
      'Opaque SITEBORNE upload identifier, up to 512 characters, that selects the already admitted artifact.',
    'upload_reference.media_type':
      'Declared parser media type: PDF, PNG, or JPEG; it must match the stored artifact.',
    'upload_reference.size_bytes':
      'Declared artifact size in bytes, from 1 through 10,485,760; it is checked against stored metadata.',
    'upload_reference.content_hash':
      'Optional lowercase SHA-256 integrity identifier in sha256:<64 hex> form; when supplied it must match the artifact.',
    document_url:
      'Public document URL for reference mode 3; use exactly one reference mode and never put credentials in this URL.',
    declared_page_count:
      'Optional declared page count from 1 through 10; enables early scope validation but does not override the observed document.',
    page_range:
      'Optional one-indexed inclusive page range to process; both bounds are limited to pages 1 through 10.',
    'page_range.start': 'First one-indexed page to process, inclusive.',
    'page_range.end': 'Last one-indexed page to process, inclusive and not before start.',
    extraction_request:
      'Selects text, table, key-value, and buyer-schema extraction outputs; omitted switches retain their documented defaults.',
    'extraction_request.extract_text':
      'Whether normalized text extraction is requested; defaults to true.',
    'extraction_request.extract_tables':
      'Whether bounded table extraction is requested; defaults to false and may increase processing work.',
    'extraction_request.extract_key_values':
      'Whether key-value extraction is requested; defaults to false.',
    'extraction_request.buyer_schema':
      'Optional JSON Schema, bounded to fifty properties and depth five, used to validate buyer-shaped extracted data.',
    ocr_permission:
      'Explicit permission to use OCR for image-based content; false prevents OCR even when text is not embedded.',
    table_extraction_request:
      'Explicit top-level request for table extraction; false leaves tables unrequested.',
    language_hints:
      'Up to five BCP 47 language hints used by OCR and extraction; hints do not translate the document.',
    maximum_authorized_price:
      'Buyer’s decimal-safe maximum authorized price; constrains the payment requirement and not retention or extraction policy.',
    minimum_verification_score:
      'Required PCC verification ratio from 0 through 1; raising it makes extracted-evidence acceptance stricter.',
    retention_preference:
      'Requested retention class—none, temporary, or permanent—subject to server policy; it cannot override mandatory retention limits.',
  },
  'verify_agent_output.v1': {},
  'verify_agent_output.v2': {
    verification_contract:
      'Complete set of claims and deterministic checks against which the supplied candidate output is evaluated.',
    'verification_contract.claims':
      'Up to fifty expected claims; each binds a stable claim identifier to a predicate, expected value, and optional tolerance/materiality.',
    'verification_contract.claims[].claim_id':
      'Caller-stable claim identifier up to 64 characters, used to correlate the verdict for this claim.',
    'verification_contract.claims[].predicate':
      'Comparison operation applied to the candidate value: equality, containment, pattern, ordering, existence, or nonexistence.',
    'verification_contract.claims[].expected_value':
      'Expected JSON value interpreted by the selected predicate; its shape should match the claim being tested.',
    'verification_contract.claims[].tolerance':
      'Optional nonnegative numeric tolerance for comparisons where bounded deviation is acceptable.',
    'verification_contract.claims[].materiality':
      'Claim importance—material, supporting, or contextual—which affects how the verdict weighs a failed claim.',
    'verification_contract.deterministic_requirements':
      'Up to thirty deterministic checks for schema, hashes, signatures, evidence resolution, PII, or secrets.',
    'verification_contract.deterministic_requirements[].requirement_id':
      'Caller-stable requirement identifier up to 64 characters, used to correlate the deterministic check result.',
    'verification_contract.deterministic_requirements[].check':
      'Closed deterministic check to run: schema, hash, signature, evidence resolution, PII absence, or secret absence.',
    'verification_contract.deterministic_requirements[].parameters':
      'Check-specific configuration interpreted only by the selected deterministic check; it cannot modify verifier policy.',
    candidate_output:
      'Agent-produced JSON object to evaluate, bounded to 200 properties and depth 10; it is evidence under test, not trusted policy.',
    supplied_evidence:
      'Up to twenty evidence objects supplied with the candidate output and bound to integrity hashes.',
    'supplied_evidence[].evidence_id':
      'Caller-stable evidence identifier up to 64 characters, used to connect claims to this evidence item.',
    'supplied_evidence[].content':
      'JSON evidence content whose integrity must agree with content_hash; it is treated as untrusted input.',
    'supplied_evidence[].content_hash':
      'Lowercase SHA-256 integrity identifier in sha256:<64 hex> form for the supplied content.',
    'supplied_evidence[].source_uri':
      'Optional public source URI, up to 2,048 characters, identifying where the evidence was obtained.',
    'supplied_evidence[].retrieved_at':
      'Optional UTC retrieval timestamp in the schema’s RFC 3339 form, used by freshness checks.',
    required_schema:
      'JSON Schema the candidate output must satisfy; it constrains validation and cannot change SITEBORNE verifier policy.',
    minimum_score:
      'Minimum overall verification score from 0 through 1; raising it makes the final acceptance verdict stricter.',
    verification_mode:
      'standard checks supplied material; independent_reproduction additionally attempts independently derived verification where implemented.',
    allowed_evidence_sources:
      'Up to ten permitted evidence source URIs; evidence outside this allowlist cannot satisfy source restrictions.',
    freshness_requirements:
      'Optional maximum-age limits for evidence and schemas, each expressed in seconds.',
    'freshness_requirements.evidence_max_age_seconds':
      'Maximum evidence age in seconds from 0 through 2,592,000; older evidence fails freshness requirements.',
    'freshness_requirements.schema_max_age_seconds':
      'Maximum schema age in seconds from 0 through 2,592,000; older schemas fail freshness requirements.',
    maximum_authorized_price:
      'Buyer’s decimal-safe maximum authorized price; constrains the payment requirement and never relaxes verification policy.',
  },
};

function describeInputSchema(serviceId: SiteborneServiceId): unknown {
  const overrides = SERVICE_INPUT_DESCRIPTION_OVERRIDES[serviceId];
  const visit = (value: unknown, path: string): unknown => {
    if (Array.isArray(value)) return value.map((child) => visit(child, path));
    if (value === null || typeof value !== 'object') return value;
    const record = value as Record<string, unknown>;
    const described = Object.fromEntries(
      Object.entries(record).map(([key, child]) => {
        if (key === 'properties' && child && typeof child === 'object' && !Array.isArray(child)) {
          return [
            key,
            Object.fromEntries(
              Object.entries(child as Record<string, unknown>).map(([property, schema]) => {
                const childPath = path ? `${path}.${property}` : property;
                const next = visit(schema, childPath) as Record<string, unknown>;
                return [
                  property,
                  overrides[childPath] ? { ...next, description: overrides[childPath] } : next,
                ];
              })
            ),
          ];
        }
        return [key, visit(child, key === 'items' ? `${path}[]` : path)];
      })
    );
    return described;
  };
  return visit(MCP_SERVICE_INPUT_SCHEMAS[serviceId], '');
}

function productionStatusSentence(
  serviceId: SiteborneServiceId,
  options: CreateSiteborneMcpOptions
) {
  return options.health?.services?.[serviceId]?.production === 'production_enabled'
    ? 'This service is currently production-enabled.'
    : 'This service is currently production-disabled and rejects execution.';
}

function serviceToolDescription(
  serviceId: SiteborneServiceId,
  options: CreateSiteborneMcpOptions
): string {
  const status = productionStatusSentence(serviceId, options);
  const descriptions: Readonly<Record<SiteborneServiceId, string>> = {
    'company_evidence_graph.v1': '',
    'web_context_verified.v1': '',
    'document_evidence_json.v1': '',
    'verify_agent_output.v1': '',
    'company_evidence_graph.v2':
      'Build a proof-carrying graph of public company identity, SEC filings, website observations, regulatory mentions, and repository signals. Use when: the request needs entity-level evidence synthesized across sources. Do not use when: one URL is the subject (use siteborne_web_context_verified), one document is the subject (use siteborne_document_evidence_json), or an existing agent output needs evaluation (use siteborne_verify_agent_output). Behavior: may enter the governed paid service flow; an unpaid enabled request returns payment_required, while a paid request may query public providers and persist governed payment, audit, job, and Workflow state. ' +
      status +
      ' Returns: a company evidence graph with provenance, completeness, verification, and PCC context—not a raw webpage or document extraction.',
    'web_context_verified.v2':
      'Retrieve and verify evidence from one public web URL using direct or browser-rendered acquisition. Use when: the request is specifically about the content and provenance of a URL. Do not use when: evidence must be synthesized for a company (use siteborne_company_evidence_graph), extracted from an authorized document (use siteborne_document_evidence_json), or checked against an existing output contract (use siteborne_verify_agent_output). Behavior: may enter the governed paid service flow; an unpaid enabled request returns payment_required, while a paid request may perform bounded network/browser retrieval and persist governed payment, audit, job, and Workflow state. ' +
      status +
      ' Returns: normalized, source-attributed web context with verification and PCC evidence.',
    'document_evidence_json.v2':
      'Extract and verify structured evidence from exactly one authorized artifact, prior SITEBORNE upload, or public document URL. Use when: the source of truth is a PDF or supported image and the desired result is evidence JSON. Do not use when: a webpage alone is sufficient (use siteborne_web_context_verified), company-wide public evidence is needed (use siteborne_company_evidence_graph), or an existing agent response needs evaluation (use siteborne_verify_agent_output). Behavior: may enter the governed paid service flow; an unpaid enabled request returns payment_required, while a paid request may read governed artifact storage, call the document provider, and persist payment, audit, job, and Workflow state. ' +
      status +
      ' Returns: extracted document evidence, integrity/provenance findings, and PCC verification—not an uploaded file.',
    'verify_agent_output.v2':
      'Evaluate a supplied agent output against explicit claims, deterministic requirements, a required JSON Schema, and optional evidence. Use when: the caller already has an output and needs a governed verification verdict or independent-reproduction check. Do not use when: evidence must first be gathered from a company (use siteborne_company_evidence_graph), URL (use siteborne_web_context_verified), or document (use siteborne_document_evidence_json). Behavior: may enter the governed paid service flow; an unpaid enabled request returns payment_required, while a paid request evaluates the supplied material and may persist governed payment, audit, job, and Workflow state. ' +
      status +
      ' Returns: claim-level and deterministic-check results, an overall verification verdict, and PCC evidence—not newly gathered source content.',
  };
  return descriptions[serviceId];
}

const SERVICE_TOOL_TITLES: Readonly<Record<SiteborneServiceId, string>> = {
  'company_evidence_graph.v1': 'Build company evidence graph',
  'company_evidence_graph.v2': 'Build company evidence graph',
  'web_context_verified.v1': 'Verify web context',
  'web_context_verified.v2': 'Verify web context',
  'document_evidence_json.v1': 'Extract document evidence JSON',
  'document_evidence_json.v2': 'Extract document evidence JSON',
  'verify_agent_output.v1': 'Verify agent output',
  'verify_agent_output.v2': 'Verify agent output',
};

// SUN-1222B-S3 / SUN-1222C-R3: all four v2 services now have dedicated,
// isolated experiment pricing keys, split from the frozen v1 keys.
const EXACT_PRICING_KEYS: Readonly<
  Record<SiteborneServiceId, Parameters<typeof resolveServiceMaxPriceUsd>[0]>
> = {
  'company_evidence_graph.v1': 'company_evidence_graph',
  'web_context_verified.v1': 'web_context_verified_direct',
  'document_evidence_json.v1': 'document_evidence_json_native',
  'verify_agent_output.v1': 'verify_agent_output_standard',
  'company_evidence_graph.v2': 'company_evidence_graph_v2',
  'web_context_verified.v2': 'web_context_verified_direct_v2',
  'document_evidence_json.v2': 'document_evidence_json_native_v2',
  'verify_agent_output.v2': 'verify_agent_output_standard_v2',
};

const UPTO_PRICING_KEYS: Readonly<
  Record<SiteborneServiceId, Parameters<typeof resolveServiceMaxPriceUsd>[0]>
> = {
  'company_evidence_graph.v1': 'company_evidence_graph',
  'web_context_verified.v1': 'web_context_verified_rendered',
  'document_evidence_json.v1': 'document_evidence_json_max_job',
  'verify_agent_output.v1': 'verify_agent_output_reproduction',
  'company_evidence_graph.v2': 'company_evidence_graph_v2',
  'web_context_verified.v2': 'web_context_verified_rendered',
  'document_evidence_json.v2': 'document_evidence_json_max_job',
  'verify_agent_output.v2': 'verify_agent_output_reproduction',
};

// SUN-1222C-MCP-PRE-CUTOVER-REMEDIATION: v1 paths are placeholders — no v1
// route is mounted in `apps/edge-api/src/index.ts` today (only the four v2
// CDP production routes are real), so there is no live v1 divergence to
// correct. The four v2 entries previously used a synthetic
// underscore-joined path (`/v2/company_evidence_graph`) that does not match
// any route Hono actually serves; a client paying against that resource
// would bind its x402 payment to a path returning 404. Corrected to the
// exact real mounted paths (`index.ts`'s own `app.post('/v2/...', ...)`
// registrations).
const SERVICE_RESOURCES: Readonly<Record<SiteborneServiceId, string>> = {
  'company_evidence_graph.v1': 'https://utility.siteborne.net/v1/company_evidence_graph',
  'web_context_verified.v1': 'https://utility.siteborne.net/v1/web_context_verified',
  'document_evidence_json.v1': 'https://utility.siteborne.net/v1/document_evidence_json',
  'verify_agent_output.v1': 'https://utility.siteborne.net/v1/verify_agent_output',
  'company_evidence_graph.v2': 'https://utility.siteborne.net/v2/company/evidence-graph',
  'web_context_verified.v2': 'https://utility.siteborne.net/v2/web/context',
  'document_evidence_json.v2': 'https://utility.siteborne.net/v2/document/evidence-json',
  'verify_agent_output.v2': 'https://utility.siteborne.net/v2/verify/agent-output',
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
        title: SERVICE_TOOL_TITLES[serviceId],
        description: serviceToolDescription(serviceId, options),
        inputSchema: fromJsonSchema(describeInputSchema(serviceId) as JsonSchemaType),
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
        // SUN-1222C-MCP-PAYMENT-DESIGN-CORRECTION: the official carrier
        // for the buyer's payment authorization on a retried tools/call.
        // `context.mcpReq._meta` is the SDK's own per-call metadata
        // accessor (reserved io.modelcontextprotocol/* envelope keys
        // already lifted out) -- extraction and schema validation happen
        // exactly once, here, so no boundary implementation re-parses
        // `_meta` itself. containsHostileObjectKey already guarded
        // `input`; the payload's own JSON.parse-reachable pollution
        // surface is covered by @x402/core's own parsePaymentPayload
        // (see x402-wire.ts's doc comment).
        const paymentPayload = extractPaymentPayload(
          context.mcpReq._meta as McpRequestMeta | undefined
        );
        const outcome = await boundary.execute(
          serviceId,
          input,
          invocationContext(context),
          paymentPayload
        );
        if (outcome.outcome === 'payment_required' && outcome.paymentRequired) {
          // Official wire shape (verified against the real, published
          // @x402/mcp package -- see the design-correction report) takes
          // precedence over the ad-hoc SITEBORNE-only errorResult shape
          // whenever the boundary supplies a genuine PaymentRequired
          // object.
          return buildPaymentRequiredResult(outcome.paymentRequired);
        }
        if (outcome.outcome !== 'fulfilled') {
          return errorResult(outcome.code, outcome.message, outcome.details);
        }
        const fulfilled = {
          content: [{ type: 'text' as const, text: JSON.stringify(outcome.result) }],
          structuredContent: outcome.result,
        };
        return outcome.paymentResponse
          ? attachPaymentResponseMeta(fulfilled, outcome.paymentResponse)
          : fulfilled;
      }
    );
  }

  server.registerTool(
    'siteborne_get_quote',
    {
      title: 'Get SITEBORNE quote',
      description:
        'Build a canonical x402 payment quote for one SITEBORNE service and exact request input. Use when: an agent needs the governed price, payee, resource, expiry, and payment requirement before deciding whether to invoke a paid service. Do not use when: evidence work is required now (use the matching siteborne_company_evidence_graph, siteborne_web_context_verified, siteborne_document_evidence_json, or siteborne_verify_agent_output tool), or only availability is needed (use siteborne_get_service_health). Behavior: quote-only and read-only; it hashes the proposed input, selects exact or upto pricing, and does not execute the underlying paid service, verify payment, call a provider, create a Workflow, or settle. Returns: an expiring input-bound quote and x402 payment requirement whose amount is either fixed or an authorized maximum.',
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
        'Report MCP server readiness and production-enable status for each SITEBORNE service. Use when: an agent must check protocol availability, tool count, or whether a service is currently production-enabled before selecting a paid tool. Do not use when: a quote is needed (use siteborne_get_quote) or company, web, document, or agent-output evidence work is required (use the corresponding SITEBORNE service tool). Behavior: read-only and credential-independent; it does not perform paid evidence work, create quotes, verify payment, call providers, write service state, create Workflows, or settle. Returns: the server and protocol versions plus truthful local, production, and external-publication status for all four evidence services.',
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
  // SUN-1222A: `legacy: 'reject'` (this handler's prior configuration)
  // answers every 2025-11-25-family request -- the plain, envelope-free
  // `initialize` → `tools/list` lifecycle the official MCP Registry client,
  // Odel, Glama, FastDrop-style probes, and most MCP clients still in the
  // field as of the 2026-07-28 "modern" era's introduction actually speak --
  // with an unsupported-protocol-version error. That is the exact external
  // MCP-interoperability failure class reported against production
  // (SUN-1222A evidence: reproduced live and in
  // `transport.test.ts`'s "2025-11-25 legacy handshake compatibility"
  // suite, which fails against `'reject'` and passes against `'stateless'`).
  // `'stateless'` is `createMcpHandler`'s own documented default: it serves
  // 2025-11-25 traffic from a fresh, per-request stateless instance of the
  // exact same server/tool factory the modern 2026-07-28 envelope path uses
  // -- no separate tool definitions, no scanner/user-agent/host special
  // casing, both eras served side by side. Set explicitly (rather than left
  // to the default) so this choice reads as a decision, not an oversight.
  const handler = createMcpHandler(() => createSiteborneMcpServer(options), {
    legacy: 'stateless',
  });
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
