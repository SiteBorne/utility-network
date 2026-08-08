import { z } from 'zod';
import type {
  SourceObservation,
  EvidenceLocator,
  ProvenanceStep,
  HTTPMetadata,
  AdapterResultClass,
} from '../types';

export const SourceObservationSchema = z.object({
  observation_id: z.string().uuid(),
  provider_id: z.string(),
  capability: z.string(),
  source_uri: z.string().url(),
  source_type: z.enum(['authoritative', 'public_index', 'public_repository', 'public_web']),
  retrieved_at: z.string().datetime({ offset: true }),
  source_published_at: z.string().datetime({ offset: true }).optional(),
  source_updated_at: z.string().datetime({ offset: true }).optional(),
  contentHash: z.string(),
  media_type: z.string(),
  http_metadata: z
    .object({
      status: z.number().int(),
      headers: z.record(z.string()),
      final_url: z.string().url(),
      redirect_chain: z.array(z.string().url()),
    })
    .optional(),
  evidence_locators: z.array(
    z.object({
      type: z.enum([
        'json_pointer',
        'text_quote',
        'css_selector',
        'xpath',
        'byte_range',
        'artifact_pointer',
        'database_record',
        'page_region',
      ]),
      value: z.string(),
      source_uri: z.string().url().optional(),
    })
  ),
  normalized_value: z.unknown(),
  raw_value_hash: z.string().optional(),
  transformation_history: z.array(
    z.object({
      step: z.string(),
      adapter_version: z.string(),
      timestamp: z.string().datetime({ offset: true }),
      input_hash: z.string().optional(),
      output_hash: z.string().optional(),
    })
  ),
  adapter_version: z.string(),
  policy_version: z.string(),
  cache_status: z.enum(['hit', 'miss', 'stale', 'bypassed']),
  freshness_status: z.enum(['fresh', 'stale', 'unknown']),
  authorization_classification: z.enum(['public', 'buyer_authorized', 'private']),
  limitations: z.array(z.string()),
  warnings: z.array(z.string()),
  completeness_info: z.record(z.unknown()).optional(),
});

export function createObservationId(): string {
  return crypto.randomUUID();
}

export async function computeContentHash(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return 'sha256:' + hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function createSourceObservation(params: {
  providerId: string;
  capability: string;
  sourceUri: string;
  sourceType: 'authoritative' | 'public_index' | 'public_repository' | 'public_web';
  retrievedAt: Date;
  contentHash: string;
  mediaType: string;
  normalizedValue: unknown;
  evidenceLocators: EvidenceLocator[];
  adapterVersion: string;
  policyVersion: string;
  cacheStatus: 'hit' | 'miss' | 'stale' | 'bypassed';
  freshnessStatus: 'fresh' | 'stale' | 'unknown';
  authorizationClassification: 'public' | 'buyer_authorized' | 'private';
  sourcePublishedAt?: Date;
  sourceUpdatedAt?: Date;
  httpMetadata?: HTTPMetadata;
  rawValueHash?: string;
  transformationHistory?: ProvenanceStep[];
  limitations?: string[];
  warnings?: string[];
  completenessInfo?: Record<string, unknown>;
}): SourceObservation {
  return {
    observation_id: createObservationId(),
    provider_id: params.providerId,
    capability: params.capability,
    source_uri: params.sourceUri,
    source_type: params.sourceType,
    retrieved_at: params.retrievedAt.toISOString(),
    source_published_at: params.sourcePublishedAt?.toISOString(),
    source_updated_at: params.sourceUpdatedAt?.toISOString(),
    contentHash: params.contentHash,
    media_type: params.mediaType,
    http_metadata: params.httpMetadata,
    evidence_locators: params.evidenceLocators,
    normalized_value: params.normalizedValue,
    raw_value_hash: params.rawValueHash,
    transformation_history: params.transformationHistory || [],
    adapter_version: params.adapterVersion,
    policy_version: params.policyVersion,
    cache_status: params.cacheStatus,
    freshness_status: params.freshnessStatus,
    authorization_classification: params.authorizationClassification,
    limitations: params.limitations || [],
    warnings: params.warnings || [],
    completeness_info: params.completenessInfo,
  };
}

export function createProvenanceStep(
  step: string,
  adapterVersion: string,
  inputHash?: string,
  outputHash?: string
): ProvenanceStep {
  return {
    step,
    adapter_version: adapterVersion,
    timestamp: new Date().toISOString(),
    input_hash: inputHash,
    output_hash: outputHash,
  };
}

export function createHTTPMetadata(
  response: Response,
  finalUrl: string,
  redirectChain: string[]
): HTTPMetadata {
  const headers: Record<string, string> = {};
  const allowedHeaders = [
    'content-type',
    'content-length',
    'etag',
    'last-modified',
    'cache-control',
    'expires',
    'date',
    'server',
    'x-ratelimit-limit',
    'x-ratelimit-remaining',
    'x-ratelimit-reset',
    'retry-after',
  ];
  response.headers.forEach((value, key) => {
    if (allowedHeaders.includes(key.toLowerCase())) {
      headers[key.toLowerCase()] = value;
    }
  });
  return {
    status: response.status,
    headers,
    final_url: finalUrl,
    redirect_chain: redirectChain,
  };
}

export function validateObservation(observation: unknown): SourceObservation {
  return SourceObservationSchema.parse(observation);
}

export function observationToResultClass(_observation: SourceObservation): AdapterResultClass {
  return 'success';
}
