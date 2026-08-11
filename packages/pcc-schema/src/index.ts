import { z } from 'zod';
import canonicalSchema from '../../../schemas/proof-carrying-context.schema.json' with { type: 'json' };

export const PCC_VERSION = '1.0.0' as const;

export const SEMANTIC_FIELDS = [
  'pcc_version',
  'job_id',
  'contract',
  'subject',
  'claims',
  'evidence',
  'completeness',
  'provenance',
  'verification',
  'receipt',
] as const;

export type SemanticField = (typeof SEMANTIC_FIELDS)[number];

export const COMPATIBILITY_POLICY = {
  version: '1.0.0',
  rules: [
    'Patch: clarifications, fixture corrections, non-semantic documentation, validator bug fixes that enforce already-documented behavior',
    'Minor: backward-compatible optional fields, new extension namespaces, new enum values only where consumers are required to handle unknown values safely',
    'Major: required-field changes, semantic reinterpretation, field removal, incompatible canonicalization, incompatible signature input, closed-enum expansion where old consumers would reject it',
  ],
  validation: 'Schema compatibility tests must pass before promotion to EXECUTABLE_VERIFIED',
} as const;

export const CANONICALIZATION_POLICY = {
  version: '1.0.0',
  algorithm: 'JSON Canonicalization Scheme (RFC 8785 / JCS)',
  description: 'All PCC output hashes and signatures use JCS for deterministic serialization',
  rules: [
    'Object keys are sorted lexicographically by Unicode code point order',
    'Numbers are serialized in shortest decimal form (no scientific notation)',
    'Unicode strings are serialized as valid UTF-8 with minimal escaping',
    'Duplicate object keys are rejected before canonicalization',
    'Arrays preserve element order',
    'Null fields are included; absent fields are omitted',
    'Timestamps use RFC 3339 UTC with Z suffix and normalized fractional precision',
    'Extensions are included in canonicalization and output hashing unless explicitly excluded by policy',
  ],
  scope: 'Applied to output_hash, policy_hash, and receipt signature payload',
} as const;

export const SIGNING_POLICY = {
  version: '1.0.0',
  algorithm: 'Ed25519',
  payload: 'canonical({ output_hash, policy_hash })',
  signature_field: 'receipt.signature',
  verification: 'Deterministic; no model may override verification failure',
} as const;

// Import the canonical single source of truth so bundlers can preserve it
// without depending on the repository's runtime directory layout.
const schemaJson = canonicalSchema as unknown as Record<string, unknown> & {
  definitions?: Record<string, unknown>;
};

export const NORMATIVE_SCHEMA = schemaJson;

// Backward-compatible alias for pre-normative tests
export const PRE_NORMATIVE_DRAFT_SCHEMA = NORMATIVE_SCHEMA;

export function isPreNormative(schema: unknown): boolean {
  return (schema as Record<string, unknown>)?.pre_normative === true;
}

export function assertNotFrozen(schema: unknown): void {
  if (!isPreNormative(schema)) {
    throw new Error('Schema claimed as normative but lacks pre_normative: true marker');
  }
}

export function loadSchema(): object {
  return schemaJson;
}

// ---------------------------------------------------------------------------
// Structural validation (JSON Schema compliance)
// ---------------------------------------------------------------------------

export function validateSchema(data: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  interface SchemaObject {
    type?: string;
    required?: string[];
    properties?: Record<string, unknown>;
    patternProperties?: Record<string, unknown>;
    additionalProperties?: boolean | Record<string, unknown>;
    items?: unknown;
    uniqueItems?: boolean;
    pattern?: string;
    const?: unknown;
    enum?: unknown[];
    format?: string;
    minimum?: number;
    maximum?: number;
    $ref?: string;
    maxProperties?: number;
    propertyNames?: SchemaObject;
    minLength?: number;
    maxLength?: number;
  }

  function validateObject(obj: unknown, schema: SchemaObject, path = 'root'): void {
    if (!obj || typeof obj !== 'object') {
      errors.push(`${path}: expected object`);
      return;
    }

    const objRecord = obj as Record<string, unknown>;

    // Check maxProperties
    if (schema.maxProperties !== undefined && typeof schema.maxProperties === 'number') {
      const keyCount = Object.keys(objRecord).length;
      if (keyCount > schema.maxProperties) {
        errors.push(`${path}: too many properties (max ${schema.maxProperties})`);
        // Don't return - continue validation to catch other errors
      }
    }

    if (schema.required) {
      for (const req of schema.required) {
        if (!(req in objRecord)) {
          errors.push(`${path}.${req}: required field missing`);
        }
      }
    }

    // Handle additionalProperties and patternProperties
    if (schema.additionalProperties === false) {
      const allowedKeys = new Set([
        ...Object.keys(schema.properties || {}),
        ...(schema.required || []),
      ]);

      // propertyNames allows additional keys matching the schema
      const propertyNamesSchema = schema.propertyNames as SchemaObject | undefined;

      // patternProperties allows additional keys matching patterns
      const patternSchemas = schema.patternProperties as Record<string, unknown> | undefined;

      for (const key of Object.keys(objRecord)) {
        if (!allowedKeys.has(key) && key !== 'extensions') {
          // Check if key matches propertyNames
          let matched = false;
          if (propertyNamesSchema) {
            // Validate the key against propertyNames schema
            if (propertyNamesSchema.pattern) {
              if (new RegExp(propertyNamesSchema.pattern).test(key)) {
                if (
                  propertyNamesSchema.minLength !== undefined &&
                  key.length < propertyNamesSchema.minLength
                ) {
                  errors.push(
                    `${path}.${key}: property name too short (min ${propertyNamesSchema.minLength})`
                  );
                  matched = true;
                } else if (
                  propertyNamesSchema.maxLength !== undefined &&
                  key.length > propertyNamesSchema.maxLength
                ) {
                  errors.push(
                    `${path}.${key}: property name too long (max ${propertyNamesSchema.maxLength})`
                  );
                  matched = true;
                } else {
                  // Validate against pattern schema if provided
                  // For now, we just allow it since propertyNames doesn't have a value schema
                  matched = true;
                }
              }
            }
          }
          // Check if key matches any patternProperty
          if (!matched && patternSchemas) {
            for (const [pattern, patternSchema] of Object.entries(patternSchemas)) {
              if (new RegExp(pattern).test(key)) {
                // Validate against pattern schema
                validateProperty(objRecord[key], patternSchema as SchemaObject, `${path}.${key}`);
                matched = true;
                break;
              }
            }
          }
          if (!matched) {
            errors.push(`${path}.${key}: unknown root property`);
          }
        }
      }
    } else {
      // additionalProperties is true or a schema - allow all keys
      // but still validate known properties
    }

    if (schema.properties) {
      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        if (propName in objRecord) {
          validateProperty(objRecord[propName], propSchema as SchemaObject, `${path}.${propName}`);
        }
      }
    }

    // Also validate patternProperties that are present but not in properties
    const patternSchemas2 = schema.patternProperties as Record<string, unknown> | undefined;
    if (patternSchemas2) {
      for (const key of Object.keys(objRecord)) {
        if (!(key in (schema.properties || {}))) {
          for (const [pattern, patternSchema] of Object.entries(patternSchemas2)) {
            if (new RegExp(pattern).test(key)) {
              validateProperty(objRecord[key], patternSchema as SchemaObject, `${path}.${key}`);
              break;
            }
          }
        }
      }
    }
  }

  function validateProperty(value: unknown, propSchema: SchemaObject, path: string): void {
    if (propSchema.$ref) {
      const refName = String(propSchema.$ref).split('/').pop();
      if (refName && NORMATIVE_SCHEMA.definitions && NORMATIVE_SCHEMA.definitions[refName]) {
        validateProperty(value, NORMATIVE_SCHEMA.definitions[refName] as SchemaObject, path);
      }
      return;
    }

    if (propSchema.type === 'array') {
      if (!Array.isArray(value)) {
        errors.push(`${path}: expected array`);
        return;
      }
      if (propSchema.items) {
        value.forEach((item, idx) =>
          validateProperty(item, propSchema.items as SchemaObject, `${path}[${idx}]`)
        );
      }
      if (propSchema.uniqueItems) {
        const seen = new Set<string>();
        value.forEach((item, idx) => {
          const key = JSON.stringify(item);
          if (seen.has(key)) {
            errors.push(`${path}[${idx}]: duplicate item`);
          }
          seen.add(key);
        });
      }
      return;
    }

    if (propSchema.type === 'object') {
      validateObject(value, propSchema, path);
      return;
    }

    if (propSchema.type === 'string') {
      if (typeof value !== 'string') {
        errors.push(`${path}: expected string`);
        return;
      }
      if (propSchema.pattern && !new RegExp(String(propSchema.pattern)).test(value)) {
        errors.push(`${path}: pattern mismatch`);
      }
      if (propSchema.const && value !== propSchema.const) {
        errors.push(`${path}: must equal ${propSchema.const}`);
      }
      if (propSchema.enum && Array.isArray(propSchema.enum) && !propSchema.enum.includes(value)) {
        errors.push(`${path}: must be one of ${propSchema.enum.join(', ')}`);
      }
      if (propSchema.format === 'uri') {
        try {
          new URL(value);
        } catch {
          errors.push(`${path}: invalid URI`);
        }
      }
      if (propSchema.format === 'date-time') {
        const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;
        if (!isoRegex.test(value)) {
          errors.push(`${path}: invalid RFC3339 timestamp`);
        }
      }
      return;
    }

    if (propSchema.type === 'number') {
      if (typeof value !== 'number') {
        errors.push(`${path}: expected number`);
        return;
      }
      if (
        propSchema.minimum !== undefined &&
        typeof propSchema.minimum === 'number' &&
        value < propSchema.minimum
      ) {
        errors.push(`${path}: below minimum ${propSchema.minimum}`);
      }
      if (
        propSchema.maximum !== undefined &&
        typeof propSchema.maximum === 'number' &&
        value > propSchema.maximum
      ) {
        errors.push(`${path}: above maximum ${propSchema.maximum}`);
      }
      return;
    }

    if (propSchema.type === 'integer') {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        errors.push(`${path}: expected integer`);
        return;
      }
      // value is now known to be a number
      const numValue = value as number;
      if (
        propSchema.minimum !== undefined &&
        typeof propSchema.minimum === 'number' &&
        numValue < propSchema.minimum
      ) {
        errors.push(`${path}: below minimum ${propSchema.minimum}`);
      }
      return;
    }

    if (propSchema.type === 'boolean') {
      if (typeof value !== 'boolean') {
        errors.push(`${path}: expected boolean`);
      }
      return;
    }
  }

  validateObject(data, NORMATIVE_SCHEMA as SchemaObject);

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Semantic validation (business rules)
// ---------------------------------------------------------------------------

export function validateSemantic(data: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Not an object'] };
  }

  const claims = data.claims as Array<Record<string, unknown>> | undefined;
  const evidence = data.evidence as Array<Record<string, unknown>> | undefined;
  const completeness = data.completeness as Record<string, unknown> | undefined;
  const verification = data.verification as Record<string, unknown> | undefined;
  const contract = data.contract as Record<string, unknown> | undefined;

  // Material claims must reference at least one evidence item
  if (claims && evidence) {
    const evidenceIds = new Set(evidence.map((e) => e.evidence_id as string));
    for (const claim of claims) {
      if (claim.materiality === 'material' && claim.verification_status !== 'unsupported') {
        const evIds = claim.evidence_ids as string[] | undefined;
        if (!evIds || evIds.length === 0) {
          errors.push(
            `Claim ${claim.claim_id}: material supported claim must reference at least one evidence item`
          );
        } else {
          for (const eid of evIds) {
            if (!evidenceIds.has(eid)) {
              errors.push(`Claim ${claim.claim_id}: references unknown evidence_id ${eid}`);
            }
          }
        }
      }
      // Unsupported claims must have empty evidence and low confidence
      if (claim.verification_status === 'unsupported') {
        const evIds = claim.evidence_ids as string[] | undefined;
        if (evIds && evIds.length > 0) {
          errors.push(`Claim ${claim.claim_id}: unsupported claim must not reference evidence`);
        }
        if ((claim.confidence as number) > 0.1) {
          errors.push(
            `Claim ${claim.claim_id}: unsupported claim must have low confidence (<= 0.1)`
          );
        }
      }
    }
  }

  // Completeness invariants
  if (completeness) {
    const c = completeness;
    if ((c.supported_fields as number) > (c.populated_fields as number)) {
      errors.push('completeness: supported_fields cannot exceed populated_fields');
    }
    if ((c.populated_fields as number) > (c.requested_fields as number)) {
      // Allow enrichment only if explicitly justified
      const enriched =
        (c.enrichment_metadata as Record<string, unknown> | undefined)?.justified === true;
      if (!enriched) {
        errors.push(
          'completeness: populated_fields cannot exceed requested_fields unless explicitly justified by enrichment metadata'
        );
      }
    }
    if ((c.score as number) < 0 || (c.score as number) > 1) {
      errors.push('completeness: score must be in [0, 1]');
    }
    if (
      (c.requested_fields as number) < 0 ||
      (c.populated_fields as number) < 0 ||
      (c.supported_fields as number) < 0
    ) {
      errors.push('completeness: counts cannot be negative');
    }
    for (const v of (c.vector as Array<Record<string, unknown>>) || []) {
      if ((v.supported as number) > (v.populated as number)) {
        errors.push(`completeness.vector.${v.dimension}: supported cannot exceed populated`);
      }
      if ((v.populated as number) > (v.requested as number)) {
        const enriched = v.enrichment_justified === true;
        if (!enriched) {
          errors.push(`completeness.vector.${v.dimension}: populated cannot exceed requested`);
        }
      }
      if ((v.score as number) < 0 || (v.score as number) > 1) {
        errors.push(`completeness.vector.${v.dimension}: score must be in [0, 1]`);
      }
    }
  }

  // Verification invariants
  if (verification) {
    const v = verification;
    if (
      v.decision === 'pass' &&
      (v.deterministic_failures as string[] | undefined) &&
      (v.deterministic_failures as string[]).length > 0
    ) {
      errors.push('verification: deterministic failures prevent pass decision');
    }
    const validDecisions = ['pass', 'conditional', 'fail', 'quarantined'];
    if (!validDecisions.includes(v.decision as string)) {
      errors.push(`verification: decision must be one of ${validDecisions.join(', ')}`);
    }
    if ((v.score as number) < 0 || (v.score as number) > 1) {
      errors.push('verification: score must be in [0, 1]');
    }
  }

  // Contract mode invariants
  if (contract) {
    const ct = contract;
    if (ct.mode === 'paid') {
      if (!ct.price && !ct.maximum_authorized_price) {
        errors.push('contract: paid mode requires price or maximum_authorized_price');
      }
      if (!ct.network) {
        errors.push('contract: paid mode requires network');
      }
    }
    if (ct.mode === 'benchmark' || ct.mode === 'offline_verification') {
      if (ct.price || ct.maximum_authorized_price || ct.network) {
        errors.push(`contract: ${ct.mode} mode must not include payment fields`);
      }
    }
  }

  // Duplicate ID checks
  if (claims) {
    const claimIds = new Set<string>();
    for (const claim of claims) {
      if (claimIds.has(claim.claim_id as string)) {
        errors.push(`Duplicate claim_id: ${claim.claim_id}`);
      }
      claimIds.add(claim.claim_id as string);
    }
  }

  if (evidence) {
    const evidenceIds = new Set<string>();
    for (const ev of evidence) {
      if (evidenceIds.has(ev.evidence_id as string)) {
        errors.push(`Duplicate evidence_id: ${ev.evidence_id}`);
      }
      evidenceIds.add(ev.evidence_id as string);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Canonicalization & Hashing
// ---------------------------------------------------------------------------

import { createHash } from 'crypto';

// RFC 8785 / JCS validation
// Only reject non-finite numbers (NaN, Infinity) and integers outside the safe range
// that are represented as "int-like" values (no scientific notation in their string form).
// The underlying canonical-json library handles ECMA-262 compliant number serialization.

function validateJCSNumbers(obj: unknown, path = 'root'): void {
  if (obj === null || obj === undefined) return;

  if (typeof obj === 'number') {
    if (!Number.isFinite(obj)) {
      throw new Error(`${path}: JCS forbids non-finite numbers (NaN, Infinity)`);
    }
    // Reject integers outside safe range that are "int-like" (no scientific notation)
    // This matches Python rfc8785 behavior which rejects int types outside safe range
    // but accepts float types.
    if (Number.isInteger(obj)) {
      const str = obj.toString();
      if (
        !str.includes('e') &&
        !str.includes('E') &&
        (obj > 9007199254740991 || obj < -9007199254740991)
      ) {
        throw new Error(
          `${path}: JCS integer ${obj} exceeds safe range [-9007199254740991, 9007199254740991]`
        );
      }
    }
    return;
  }

  if (Array.isArray(obj)) {
    obj.forEach((item, idx) => validateJCSNumbers(item, `${path}[${idx}]`));
    return;
  }

  if (typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj)) {
      validateJCSNumbers(value, `${path}.${key}`);
    }
    return;
  }
}

let canonicalJson: (data: unknown) => string | undefined;

export async function loadCanonicalJson(): Promise<void> {
  const mod = await import('canonical-json');
  canonicalJson = mod.default || mod;
}

// Initialize on first use
function ensureCanonicalJson(): void {
  if (!canonicalJson) {
    throw new Error('canonical-json not loaded. Call loadCanonicalJson() first.');
  }
}

export function canonicalize(data: unknown): string {
  ensureCanonicalJson();
  validateJCSNumbers(data);
  const result = canonicalJson(data);
  if (result === undefined) {
    throw new Error('canonical-json returned undefined');
  }
  return result;
}

export async function hashCanonical(data: unknown): Promise<string> {
  ensureCanonicalJson();
  const canonical = canonicalize(data);
  const hash = createHash('sha256').update(canonical).digest('hex');
  return `sha256:${hash}`;
}

// ---------------------------------------------------------------------------
// Signing & Verification
// ---------------------------------------------------------------------------

// Domain separation string for receipt signatures
export const RECEIPT_SIGNATURE_CONTEXT = 'SITEBORNE-PCC-RECEIPT-V1';

// Receipt signature preimage structure
export interface ReceiptSignaturePreimage {
  signature_context: string;
  pcc_version: string;
  job_id: string;
  service_id: string;
  service_version: string;
  contract_mode: string;
  input_hash: string;
  input_schema_hash: string;
  output_schema_hash: string;
  quote_id?: string;
  output_hash: string;
  policy_hash: string;
  canonicalization_algorithm: string;
  signature_algorithm: string;
  signing_key_id: string;
  signed_at: string;
}

export async function signReceipt(
  outputHash: string,
  policyHash: string,
  privateKey: Uint8Array,
  preimage: Omit<ReceiptSignaturePreimage, 'signature_context' | 'signed_at'>
): Promise<{ signature: string; signedAt: string }> {
  await loadCanonicalJson();
  const { signAsync } = await import('@noble/ed25519');

  const fullPreimage: ReceiptSignaturePreimage = {
    signature_context: RECEIPT_SIGNATURE_CONTEXT,
    ...preimage,
    signed_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };

  const payload = canonicalize(fullPreimage);
  const message = new TextEncoder().encode(payload);
  const signature = await signAsync(message, privateKey);
  const signatureB64 = Buffer.from(signature).toString('base64url');
  const signedAt = fullPreimage.signed_at;
  return { signature: signatureB64, signedAt };
}

export async function verifyReceipt(
  outputHash: string,
  policyHash: string,
  signature: string,
  publicKey: Uint8Array,
  preimage: Omit<ReceiptSignaturePreimage, 'signature_context'>
): Promise<boolean> {
  await loadCanonicalJson();
  const { verifyAsync } = await import('@noble/ed25519');

  const fullPreimage: ReceiptSignaturePreimage = {
    signature_context: RECEIPT_SIGNATURE_CONTEXT,
    ...preimage,
  };

  const payload = canonicalize(fullPreimage);
  const message = new TextEncoder().encode(payload);
  const sigBytes = Buffer.from(signature, 'base64url');
  return verifyAsync(sigBytes, message, publicKey);
}

// ---------------------------------------------------------------------------
// Zod Runtime Types (generated from canonical schema)
// ---------------------------------------------------------------------------

export const HashZ = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export type Hash = z.infer<typeof HashZ>;

export const TimestampZ = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/);
export type Timestamp = z.infer<typeof TimestampZ>;

export const DecimalStringZ = z.string().regex(/^(0|[1-9]\d*)(\.\d+)?$/);
export type DecimalString = z.infer<typeof DecimalStringZ>;

export const CurrencyZ = z.enum(['USD', 'USDC']);
export type Currency = z.infer<typeof CurrencyZ>;

export const ContractModeZ = z.enum(['paid', 'benchmark', 'offline_verification']);
export type ContractMode = z.infer<typeof ContractModeZ>;

export const MaterialityZ = z.enum(['material', 'supporting', 'contextual']);
export type Materiality = z.infer<typeof MaterialityZ>;

export const VerificationStatusZ = z.enum(['verified', 'unsupported', 'disputed', 'pending']);
export type VerificationStatus = z.infer<typeof VerificationStatusZ>;

export const LocatorTypeZ = z.enum([
  'json_pointer',
  'xpath',
  'css_selector',
  'text_quote',
  'page_region',
  'byte_range',
  'database_record',
  'artifact_pointer',
]);
export type LocatorType = z.infer<typeof LocatorTypeZ>;

export const VerificationDecisionZ = z.enum(['pass', 'conditional', 'fail', 'quarantined']);
export type VerificationDecision = z.infer<typeof VerificationDecisionZ>;

export const LocatorZ = z.object({
  type: LocatorTypeZ,
  value: z.string().min(1),
});
export type Locator = z.infer<typeof LocatorZ>;

export const TransformationZ = z.object({
  type: z.string().min(1),
  timestamp: TimestampZ,
  tool_version: z.string().min(1),
  parameters: z.record(z.unknown()).optional(),
});
export type Transformation = z.infer<typeof TransformationZ>;

export const EvidenceItemZ = z.object({
  evidence_id: z.string().regex(/^evd_[a-z0-9]{24}$/),
  source_uri: z.string().min(1),
  source_timestamp: TimestampZ.optional(),
  retrieved_at: TimestampZ,
  content_hash: HashZ,
  media_type: z.string().min(1),
  locator: LocatorZ,
  accessibility_status: z.enum([
    'accessible',
    'unavailable',
    'restricted',
    'requires_authorization',
  ]),
  transformation_history: z.array(TransformationZ),
  authorization_classification: z.enum([
    'public',
    'buyer_authorized',
    'restricted',
    'confidential',
  ]),
  freshness_status: z.enum(['fresh', 'stale', 'unknown']),
});
export type EvidenceItem = z.infer<typeof EvidenceItemZ>;

export const ClaimZ = z.object({
  claim_id: z.string().regex(/^clm_[a-z0-9]{24}$/),
  predicate: z.string().min(1),
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.object({}),
    z.array(z.unknown()),
    z.null(),
  ]),
  confidence: z.number().min(0).max(1),
  evidence_ids: z.array(z.string().regex(/^evd_[a-z0-9]{24}$/)),
  materiality: MaterialityZ,
  verification_status: VerificationStatusZ,
});
export type Claim = z.infer<typeof ClaimZ>;

export const CompletenessVectorEntryZ = z.object({
  dimension: z.string().min(1),
  requested: z.number().int().min(0),
  populated: z.number().int().min(0),
  supported: z.number().int().min(0),
  score: z.number().min(0).max(1),
});
export type CompletenessVectorEntry = z.infer<typeof CompletenessVectorEntryZ>;

export const CompletenessZ = z.object({
  requested_fields: z.number().int().min(0),
  populated_fields: z.number().int().min(0),
  supported_fields: z.number().int().min(0),
  score: z.number().min(0).max(1),
  missing_fields: z.array(z.string().min(1)),
  unsupported_fields: z.array(z.string().min(1)),
  stale_fields: z.array(z.string().min(1)),
  vector: z.array(CompletenessVectorEntryZ),
});
export type Completeness = z.infer<typeof CompletenessZ>;

export const ProvenanceRouteZ = z.object({
  type: z.enum(['cache', 'direct', 'deterministic', 'model', 'hybrid']),
  provider: z.string().min(1),
  version: z.string().min(1),
  model_name: z.string().optional(),
  model_version: z.string().optional(),
  parameters: z.record(z.unknown()).optional(),
});
export type ProvenanceRoute = z.infer<typeof ProvenanceRouteZ>;

export const ProvenanceZ = z.object({
  routes: z.array(ProvenanceRouteZ),
  providers: z.array(
    z.object({
      name: z.string().min(1),
      version: z.string().min(1),
      capabilities: z.array(z.string()),
    })
  ),
  tools: z.record(z.string()),
  models: z.array(
    z.object({
      name: z.string().min(1),
      version: z.string().min(1),
      provider: z.string().min(1),
    })
  ),
  software_versions: z.record(z.string()),
  policy_versions: z.record(z.string()),
  transformations: z.array(TransformationZ),
  cache_provenance: z.object({
    enabled: z.boolean(),
    hit: z.boolean(),
    cache_key: z.string().optional(),
    stored_at: TimestampZ.optional(),
  }),
  execution_environment: z.object({
    runtime: z.string().min(1),
    version: z.string().min(1),
    platform: z.string().min(1),
    container_image: z.string().optional(),
  }),
  verification_routes: z.array(ProvenanceRouteZ),
});
export type Provenance = z.infer<typeof ProvenanceZ>;

export const VerificationZ = z.object({
  schema_valid: z.boolean(),
  material_claims_supported: z.boolean(),
  evidence_accessibility: z.number().min(0).max(1),
  freshness: z.number().min(0).max(1),
  completeness: z.number().min(0).max(1),
  cross_source_agreement: z.number().min(0).max(1),
  provenance_valid: z.boolean(),
  prompt_injection_result: z.object({
    checked: z.boolean(),
    result: z.enum(['clean', 'suspected', 'confirmed']),
    details: z.string().optional(),
  }),
  deterministic_failures: z.array(z.string().min(1)),
  verifier_versions: z.record(z.string()),
  policy: z.string().regex(/^pol_[a-z0-9]{24}$/),
  decision: VerificationDecisionZ,
  score: z.number().min(0).max(1),
  failed_requirements: z.array(z.string().min(1)),
});
export type Verification = z.infer<typeof VerificationZ>;

export const ReceiptZ = z.object({
  output_hash: HashZ,
  canonicalization_algorithm: z.literal('RFC8785-JCS'),
  policy_hash: HashZ,
  schema_hash: HashZ,
  signature_algorithm: z.literal('Ed25519'),
  signing_key_id: z.string().regex(/^kid_[a-z0-9]{24}$/),
  signature: z.string().regex(/^[A-Za-z0-9_-]{86,88}$/),
  signed_at: TimestampZ,
});
export type Receipt = z.infer<typeof ReceiptZ>;

export const ContractZ = z.object({
  service_id: z.enum([
    'company_evidence_graph.v1',
    'web_context_verified.v1',
    'document_evidence_json.v1',
    'verify_agent_output.v1',
  ]),
  service_version: z.string().regex(/^v\d+(\.\d+)*$/),
  input_hash: HashZ,
  input_schema_hash: HashZ,
  output_schema_hash: HashZ,
  quote_id: z.string().regex(/^qte_[a-z0-9]{24}$/),
  price: DecimalStringZ.optional(),
  maximum_authorized_price: DecimalStringZ.optional(),
  mode: ContractModeZ,
  currency: CurrencyZ,
  network: z.enum(['base', 'base-testnet']).optional(),
  minimum_quality: z.number().min(0).max(1),
  freshness_seconds: z.number().int().min(1),
  issued_at: TimestampZ,
  expires_at: TimestampZ,
  idempotency_key: z.string().regex(/^idk_[a-z0-9]{24}$/),
});
export type Contract = z.infer<typeof ContractZ>;

export const SubjectZ = z.object({
  type: z.enum(['organization', 'person', 'document', 'webpage', 'other']),
  canonical_name: z.string().min(1),
  identifiers: z.record(z.string()).optional(),
});
export type Subject = z.infer<typeof SubjectZ>;

export const ExtensionContainerZ = z.record(z.object({}));
export type ExtensionContainer = z.infer<typeof ExtensionContainerZ>;

export const PCCDocumentZ = z.object({
  pcc_version: z.literal('1.0.0'),
  job_id: z.string().regex(/^job_[a-z0-9]{24}$/),
  contract: ContractZ,
  subject: SubjectZ,
  claims: z.array(ClaimZ),
  evidence: z.array(EvidenceItemZ),
  completeness: CompletenessZ,
  provenance: ProvenanceZ,
  verification: VerificationZ,
  receipt: ReceiptZ,
  extensions: ExtensionContainerZ.optional(),
});
export type PCCDocument = z.infer<typeof PCCDocumentZ>;

// ---------------------------------------------------------------------------
// Schema hash for drift detection
// ---------------------------------------------------------------------------

export async function getSchemaHash(): Promise<string> {
  await loadCanonicalJson();
  return await hashCanonical(NORMATIVE_SCHEMA);
}
