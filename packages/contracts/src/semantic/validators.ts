import { z } from 'zod';

// Common validation utilities
const SHA256_REGEX = /^sha256:[a-f0-9]{64}$/;
const RFC3339_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;
const MONEY_AMOUNT_REGEX = /^(0|[1-9]\d*)(\.\d{1,18})?$/;
const DOMAIN_REGEX =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
const EXTENSION_NAMESPACE_REGEX =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?){2,}$/;
const SERVICE_ID_REGEX = /^[a-z0-9_]+\.v[0-9]+$/;
const SERVICE_VERSION_REGEX = /^v[0-9]+(\.[0-9]+)*$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const REQUEST_ID_REGEX = new RegExp(`^(?:${UUID_REGEX.source}|${ULID_REGEX.source})$`);

export function isValidSha256(hash: string): boolean {
  return SHA256_REGEX.test(hash);
}

export function isValidRfc3339(ts: string): boolean {
  return RFC3339_REGEX.test(ts);
}

export function isValidMoneyAmount(amount: string): boolean {
  return MONEY_AMOUNT_REGEX.test(amount);
}

export function isValidDomain(domain: string): boolean {
  return DOMAIN_REGEX.test(domain);
}

export function isValidExtensionNamespace(ns: string): boolean {
  return EXTENSION_NAMESPACE_REGEX.test(ns) && ns.length <= 253;
}

export function isValidServiceId(id: string): boolean {
  return SERVICE_ID_REGEX.test(id);
}

export function isValidServiceVersion(ver: string): boolean {
  return SERVICE_VERSION_REGEX.test(ver);
}

export function isValidRequestId(id: string): boolean {
  return REQUEST_ID_REGEX.test(id);
}

export function isTimestampAfter(after: string, before: string): boolean {
  return new Date(after) > new Date(before);
}

export function validateHashPairing(
  inputHash: string,
  inputSchemaHash: string,
  outputSchemaHash: string
): string[] {
  const errors: string[] = [];
  if (!isValidSha256(inputHash)) errors.push('input_hash must be valid sha256');
  if (!isValidSha256(inputSchemaHash)) errors.push('input_schema_hash must be valid sha256');
  if (!isValidSha256(outputSchemaHash)) errors.push('output_schema_hash must be valid sha256');
  return errors;
}

export function validateMoney(amount: string, currency: string): string[] {
  const errors: string[] = [];
  if (!isValidMoneyAmount(amount)) errors.push('amount must be canonical decimal string');
  if (currency !== 'USD') errors.push('currency must be USD');
  return errors;
}

export function validateExtensionNamespace(ns: string): string[] {
  const errors: string[] = [];
  if (!isValidExtensionNamespace(ns)) {
    errors.push(
      `extension namespace '${ns}' must be reverse-domain qualified (max 253 chars, min 3 labels, lowercase DNS-safe)`
    );
  }
  return errors;
}

export function validateServicePairing(serviceId: string, serviceVersion: string): string[] {
  const errors: string[] = [];
  if (!isValidServiceId(serviceId)) errors.push('service_id must match pattern');
  if (!isValidServiceVersion(serviceVersion)) errors.push('service_version must match pattern vN');
  return errors;
}

export function validateQuoteExactUpto(
  scheme: string,
  price?: unknown,
  maxPrice?: unknown
): string[] {
  const errors: string[] = [];
  if (scheme === 'exact') {
    if (!price) errors.push('exact scheme requires price');
    if (maxPrice) errors.push('exact scheme must not have maximum_authorized_price');
  }
  if (scheme === 'upto') {
    if (!maxPrice) errors.push('upto scheme requires maximum_authorized_price');
    if (price) errors.push('upto scheme must not have price');
  }
  return errors;
}

export function validateTimestampOrdering(issuedAt: string, expiresAt: string): string[] {
  const errors: string[] = [];
  if (!isValidRfc3339(issuedAt)) errors.push('issued_at must be RFC3339 UTC');
  if (!isValidRfc3339(expiresAt)) errors.push('expires_at must be RFC3339 UTC');
  if (!isTimestampAfter(expiresAt, issuedAt)) errors.push('expires_at must be after issued_at');
  return errors;
}

export function validateExactlyOneMode(
  modes: Record<string, unknown>,
  modeNames: string[]
): string[] {
  const present = modeNames.filter(
    (k) => k in modes && modes[k] !== undefined && modes[k] !== null
  );
  if (present.length !== 1) {
    return [`exactly one of [${modeNames.join(', ')}] must be provided`];
  }
  return [];
}

export function validateServiceExtension(
  extensions: Record<string, unknown>,
  requiredNs: string
): string[] {
  const errors: string[] = [];
  if (!(requiredNs in extensions)) {
    errors.push(`required extension namespace '${requiredNs}' is missing`);
  }
  for (const ns of Object.keys(extensions)) {
    if (!isValidExtensionNamespace(ns)) {
      errors.push(`extension namespace '${ns}' is invalid`);
    }
  }
  return errors;
}

export function validateWrongExtension(
  extensions: Record<string, unknown>,
  wrongNs: string
): string[] {
  if (wrongNs in extensions) {
    return [`wrong service extension '${wrongNs}' is not allowed`];
  }
  return [];
}

export function validateCompleteness(completeness: {
  requested_fields: number;
  populated_fields: number;
  supported_fields: number;
  score: number;
}): string[] {
  const errors: string[] = [];
  if (completeness.supported_fields > completeness.populated_fields) {
    errors.push('supported_fields cannot exceed populated_fields');
  }
  if (completeness.populated_fields > completeness.requested_fields) {
    errors.push('populated_fields cannot exceed requested_fields');
  }
  if (completeness.score < 0 || completeness.score > 1) {
    errors.push('score must be in [0, 1]');
  }
  if (
    completeness.requested_fields < 0 ||
    completeness.populated_fields < 0 ||
    completeness.supported_fields < 0
  ) {
    errors.push('counts cannot be negative');
  }
  return errors;
}

export function validateDeterministicFailures(verification: {
  decision: string;
  deterministic_failures?: string[];
}): string[] {
  if (
    verification.decision === 'pass' &&
    verification.deterministic_failures &&
    verification.deterministic_failures.length > 0
  ) {
    return ['deterministic failures prevent pass decision'];
  }
  return [];
}

// TypeScript model exports for generated code
export const MoneySchema = z.object({
  amount: z.string().regex(MONEY_AMOUNT_REGEX),
  currency: z.enum(['USD']),
  network: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(64)
    .optional(),
  asset: z
    .string()
    .regex(/^[A-Z0-9]{3,10}$/)
    .optional(),
  precision: z.number().int().min(0).max(18).optional(),
});

export const RequestEnvelopeSchema = z.object({
  request_id: z.string().regex(REQUEST_ID_REGEX),
  service_id: z.string().regex(SERVICE_ID_REGEX),
  service_version: z.string().regex(SERVICE_VERSION_REGEX),
  response_schema_version: z.string().regex(SERVICE_VERSION_REGEX),
  idempotency_key: z
    .string()
    .min(16)
    .max(128)
    .regex(/^[a-zA-Z0-9_-]+$/),
  freshness_seconds: z.number().int().min(0).max(2592000),
  minimum_verification_score: z.number().min(0).max(1),
  maximum_authorized_price: MoneySchema,
  buyer_metadata: z
    .object({
      reference: z.string().max(256).optional(),
      tags: z.array(z.string().max(64)).max(20).optional(),
    })
    .optional(),
  input: z.unknown(),
  extensions: z.record(z.unknown()).optional(),
});

export const QuoteRequestSchema = z.object({
  request_id: z.string().regex(REQUEST_ID_REGEX),
  service_id: z.string().regex(SERVICE_ID_REGEX),
  service_version: z.string().regex(SERVICE_VERSION_REGEX),
  input_hash: z.string().regex(SHA256_REGEX),
  input_schema_hash: z.string().regex(SHA256_REGEX),
  output_schema_hash: z.string().regex(SHA256_REGEX),
  requested_pricing_scheme: z.enum(['exact', 'upto']),
  maximum_authorized_price: MoneySchema.optional(),
  requested_freshness_seconds: z.number().int().min(0).max(2592000).optional(),
  requested_execution_mode: z.enum(['sync', 'async']).optional(),
  idempotency_key: z
    .string()
    .min(16)
    .max(128)
    .regex(/^[a-zA-Z0-9_-]+$/),
});

export const QuoteResponseSchema = z.object({
  quote_id: z.string().regex(REQUEST_ID_REGEX),
  request_id: z.string().regex(REQUEST_ID_REGEX),
  service_id: z.string().regex(SERVICE_ID_REGEX),
  service_version: z.string().regex(SERVICE_VERSION_REGEX),
  pricing_scheme: z.enum(['exact', 'upto']),
  price: MoneySchema.optional(),
  maximum_authorized_price: MoneySchema.optional(),
  currency: z.literal('USD'),
  payment_network: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(64),
  payment_asset: z.string().regex(/^[A-Z0-9]{3,10}$/),
  estimated_execution_class: z.enum(['light', 'standard', 'heavy', 'intensive']),
  execution_mode: z.enum(['sync', 'async']),
  issued_at: z.string().regex(RFC3339_REGEX),
  expires_at: z.string().regex(RFC3339_REGEX),
  input_hash: z.string().regex(SHA256_REGEX),
  input_schema_hash: z.string().regex(SHA256_REGEX),
  output_schema_hash: z.string().regex(SHA256_REGEX),
  pricing_policy_version: z.string().regex(SERVICE_VERSION_REGEX),
  expected_completeness: z.number().min(0).max(1),
  declared_limitations: z.array(z.string().max(256)).max(20),
  production_enabled: z.literal(false),
  payment_required: z.boolean(),
});

export const StructuredErrorSchema = z.object({
  error_id: z.string().regex(REQUEST_ID_REGEX),
  error_code: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]*$/)
    .max(64),
  category: z.enum([
    'validation',
    'authorization',
    'payment_required',
    'payment_invalid',
    'rate_limited',
    'unsupported',
    'unavailable',
    'provider_failure',
    'verification_failure',
    'conflict',
    'duplicate',
    'internal',
    'quarantined',
  ]),
  message: z.string().max(512),
  retryable: z.boolean(),
  request_id: z.string().regex(REQUEST_ID_REGEX),
  service_id: z.string().regex(SERVICE_ID_REGEX),
  occurred_at: z.string().regex(RFC3339_REGEX),
  job_id: z.string().regex(REQUEST_ID_REGEX).optional(),
  quote_id: z.string().regex(REQUEST_ID_REGEX).optional(),
  failed_field_paths: z
    .array(z.string().regex(/^(\/[^~]+)+$|^$/))
    .max(50)
    .optional(),
  limitations: z.array(z.string().max(256)).max(20).optional(),
  retry_after_seconds: z.number().int().min(1).max(86400).optional(),
  original_receipt_reference: z.string().regex(SHA256_REGEX).optional(),
  provider_class: z
    .string()
    .regex(/^[a-z0-9_-]+$/)
    .max(32)
    .optional(),
  quarantine_reason: z.string().max(256).optional(),
  extensions: z.record(z.unknown()).optional(),
});

export const ServiceMetadataSchema = z.object({
  service_id: z.string().regex(SERVICE_ID_REGEX),
  service_version: z.string().regex(SERVICE_VERSION_REGEX),
  title: z.string().max(128),
  description: z.string().max(1024),
  capabilities: z.array(z.string().max(64)).max(20),
  input_schema_uri: z.string().url().optional(),
  input_schema_hash: z.string().regex(SHA256_REGEX),
  output_schema_uri: z.string().url().optional(),
  output_schema_hash: z.string().regex(SHA256_REGEX),
  pcc_version: z.literal('1.0.0'),
  pricing_schemes: z
    .array(z.enum(['exact', 'upto']))
    .min(1)
    .max(2),
  base_price: MoneySchema,
  maximum_price: MoneySchema.optional(),
  execution_mode: z.enum(['sync', 'async', 'both']),
  maximum_input_bytes: z.number().int().min(0).max(10485760),
  expected_latency_class: z.enum(['fast', 'standard', 'slow', 'variable']),
  authorization_classification: z.enum(['public', 'buyer_authorized', 'restricted']),
  promotion_state: z.enum([
    'draft',
    'case_supported',
    'multi_case_supported',
    'verified_pattern',
    'executable_candidate',
    'executable_verified',
    'retired',
    'tombstoned',
  ]),
  production_enabled: z.literal(false),
  declared_limitations: z.array(z.string().max(256)).max(20),
  protocols: z.object({
    x402: z.enum(['planned', 'scaffolded', 'tested', 'enabled', 'not_enabled']),
    mcp: z.enum(['planned', 'scaffolded', 'tested', 'enabled', 'not_enabled']),
    a2a: z.enum(['planned', 'scaffolded', 'tested', 'enabled', 'not_enabled']),
    nevermined: z.enum(['planned', 'scaffolded', 'tested', 'enabled', 'not_enabled']),
    agentverse: z.enum(['planned', 'scaffolded', 'tested', 'enabled', 'not_enabled']),
    coinbase_bazaar: z.enum(['planned', 'scaffolded', 'tested', 'enabled', 'not_enabled']),
    mcp_registry: z.enum(['planned', 'scaffolded', 'tested', 'enabled', 'not_enabled']),
  }),
  updated_at: z.string().regex(RFC3339_REGEX),
});

// ---------------------------------------------------------------------------
// Service input/output schema semantic validators (SUN-0101 Task 10)
// ---------------------------------------------------------------------------
//
// Each of the 4 services' output document is a PCC document (allOf-composed
// with the frozen PCC 1.0.0/1.0.1 schema) that must carry exactly its own
// namespaced extension and no other service's. The structural JSON Schema
// already enforces the extension's required presence and payload shape; this
// layer re-checks the same invariant plus the cross-field checks JSON Schema
// composition can't express cleanly (contract hash pairing, timestamp
// ordering, completeness/verification consistency), so application code has
// one call to make per service output rather than re-deriving this list.

export const SERVICE_EXTENSION_NAMESPACE: Record<string, string> = {
  'company_evidence_graph.v1': 'net.siteborne.company-evidence.v1',
  'web_context_verified.v1': 'net.siteborne.web-context.v1',
  'document_evidence_json.v1': 'net.siteborne.document-evidence.v1',
  'verify_agent_output.v1': 'net.siteborne.agent-verification.v1',
};

interface ServiceOutputDocument {
  contract: {
    service_id: string;
    service_version: string;
    input_hash: string;
    input_schema_hash: string;
    output_schema_hash: string;
    issued_at: string;
    expires_at: string;
  };
  extensions?: Record<string, unknown>;
  completeness: {
    requested_fields: number;
    populated_fields: number;
    supported_fields: number;
    score: number;
  };
  verification: { decision: string; deterministic_failures?: string[] };
}

/**
 * Validate a service output PCC document against the semantic invariants for
 * `expectedServiceId`: correct service/version pairing, valid contract hash
 * triple, its own (and only its own) namespaced extension present, valid
 * issued/expires ordering, and internally-consistent completeness/decision.
 */
export function validateServiceOutputDocument(
  doc: ServiceOutputDocument,
  expectedServiceId: string
): string[] {
  const errors: string[] = [];
  const requiredNs = SERVICE_EXTENSION_NAMESPACE[expectedServiceId];
  if (!requiredNs) {
    return [
      `unknown service_id '${expectedServiceId}' — not in SERVICE_EXTENSION_NAMESPACE registry`,
    ];
  }

  if (doc.contract.service_id !== expectedServiceId) {
    errors.push(
      `contract.service_id must be '${expectedServiceId}', got '${doc.contract.service_id}'`
    );
  }
  errors.push(...validateServicePairing(doc.contract.service_id, doc.contract.service_version));
  errors.push(
    ...validateHashPairing(
      doc.contract.input_hash,
      doc.contract.input_schema_hash,
      doc.contract.output_schema_hash
    )
  );
  errors.push(...validateTimestampOrdering(doc.contract.issued_at, doc.contract.expires_at));

  const extensions = doc.extensions ?? {};
  errors.push(...validateServiceExtension(extensions, requiredNs));
  for (const [otherServiceId, otherNs] of Object.entries(SERVICE_EXTENSION_NAMESPACE)) {
    if (otherServiceId === expectedServiceId) continue;
    errors.push(...validateWrongExtension(extensions, otherNs));
  }

  errors.push(...validateCompleteness(doc.completeness));
  errors.push(...validateDeterministicFailures(doc.verification));

  return errors;
}

/**
 * document-evidence-input.v1 requires exactly one of artifact_reference /
 * upload_reference / document_url (enforced structurally via `oneOf`); this
 * is the same invariant re-checked at the application layer.
 */
export function validateDocumentEvidenceInputMode(input: Record<string, unknown>): string[] {
  return validateExactlyOneMode(input, ['artifact_reference', 'upload_reference', 'document_url']);
}

/**
 * company-evidence-input.v1 requires at least one of company_name / ticker /
 * domain / identifiers (enforced structurally via `anyOf`); re-checked here
 * as a semantic-layer guard.
 */
export function validateCompanyEvidenceInputHasIdentifier(
  input: Record<string, unknown>
): string[] {
  const keys = ['company_name', 'ticker', 'domain', 'identifiers'];
  const present = keys.filter((k) => input[k] !== undefined && input[k] !== null);
  if (present.length === 0) {
    return [`at least one of [${keys.join(', ')}] must be provided`];
  }
  return [];
}
