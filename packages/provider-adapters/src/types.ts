import { z } from 'zod';

export const AdapterResultClassSchema = z.enum([
  'success',
  'partial',
  'verified_absent_candidate',
  'not_found',
  'policy_blocked',
  'invalid_request',
  'rate_limited',
  'retryable_failure',
  'permanent_failure',
  'source_changed',
  'quarantined',
]);
export type AdapterResultClass = z.infer<typeof AdapterResultClassSchema>;

export const SourceClassSchema = z.enum([
  'authoritative',
  'public_index',
  'public_repository',
  'public_web',
]);
export type SourceClass = z.infer<typeof SourceClassSchema>;

export const ProviderManifestSchema = z.object({
  provider_id: z.string(),
  source_class: SourceClassSchema,
  base_uris: z.array(z.string().url()),
  capabilities: z.array(z.string()),
  commercial_application_allowed: z.union([z.boolean(), z.literal('unknown')]),
  automated_access_allowed: z.union([z.boolean(), z.literal('unknown')]),
  transformed_output_allowed: z.union([z.boolean(), z.literal('unknown')]),
  raw_access_resale_allowed: z.union([z.boolean(), z.literal('unknown')]),
  sensitive_data_allowed: z.union([z.boolean(), z.literal('unknown')]),
  account_sharing_allowed: z.literal(false),
  quota_multiplication_allowed: z.literal(false),
  credentials_required: z.literal(false),
  terms_uri: z.string().url(),
  terms_hash: z.string().nullable(),
  terms_review_status: z.enum(['verified', 'pending_review', 'blocked']),
  reviewed_at: z.string().datetime({ offset: true }).nullable(),
  rate_policy: z.object({
    strategy: z.string(),
    maximum_concurrency: z.number().int().positive(),
    minimum_interval_ms: z.number().int().nonnegative(),
    retry_after_respected: z.literal(true),
    maximum_retries: z.number().int().nonnegative(),
  }),
  promotion_state: z.string(),
});
export type ProviderManifest = z.infer<typeof ProviderManifestSchema>;

export const AdapterExecutionContextSchema = z.object({
  request_id: z.string().uuid(),
  correlation_id: z.string().uuid(),
  job_id: z.string().uuid().optional(),
  service_id: z.string().optional(),
  source_policy_version: z.string(),
  timeout_ms: z.number().int().positive(),
  max_response_bytes: z.number().int().positive(),
  freshness_requirement_ms: z.number().int().nonnegative().optional(),
  cache_policy: z.enum(['read_only', 'read_write', 'bypass']),
  cancellation_signal: z.unknown(),
  injected_clock: z.custom<InjectedClock>(),
  injected_http_client: z.custom<InjectedHttpClient>(),
  injected_rate_limiter: z.custom<RateLimiter>(),
  injected_artifact_store: z.custom<ArtifactStore>(),
  audit_event_sink: z.custom<AuditEventSink>(),
  execution_mode: z.enum(['test', 'live']),
});
export type AdapterExecutionContext = z.infer<typeof AdapterExecutionContextSchema>;

export const AdapterHealthContextSchema = z.object({
  request_id: z.string().uuid(),
  correlation_id: z.string().uuid(),
  injected_clock: z.custom<InjectedClock>(),
  injected_http_client: z.custom<InjectedHttpClient>(),
});
export type AdapterHealthContext = z.infer<typeof AdapterHealthContextSchema>;

export const CacheStatusSchema = z.enum(['hit', 'miss', 'stale', 'bypassed']);
export type CacheStatus = z.infer<typeof CacheStatusSchema>;

export const FreshnessStatusSchema = z.enum(['fresh', 'stale', 'unknown']);
export type FreshnessStatus = z.infer<typeof FreshnessStatusSchema>;

export const AuthorizationClassificationSchema = z.enum(['public', 'buyer_authorized', 'private']);
export type AuthorizationClassification = z.infer<typeof AuthorizationClassificationSchema>;

export const EvidenceLocatorTypeSchema = z.enum([
  'json_pointer',
  'text_quote',
  'css_selector',
  'xpath',
  'byte_range',
  'artifact_pointer',
  'database_record',
  'page_region',
]);
export type EvidenceLocatorType = z.infer<typeof EvidenceLocatorTypeSchema>;

export const EvidenceLocatorSchema = z.object({
  type: EvidenceLocatorTypeSchema,
  value: z.string(),
  source_uri: z.string().url().optional(),
});
export type EvidenceLocator = z.infer<typeof EvidenceLocatorSchema>;

export const ProvenanceStepSchema = z.object({
  step: z.string(),
  adapter_version: z.string(),
  timestamp: z.string().datetime({ offset: true }),
  input_hash: z.string().optional(),
  output_hash: z.string().optional(),
});
export type ProvenanceStep = z.infer<typeof ProvenanceStepSchema>;

export const HTTPMetadataSchema = z.object({
  status: z.number().int(),
  headers: z.record(z.string()),
  final_url: z.string().url(),
  redirect_chain: z.array(z.string().url()),
});
export type HTTPMetadata = z.infer<typeof HTTPMetadataSchema>;

export const SourceObservationSchema = z.object({
  observation_id: z.string().uuid(),
  provider_id: z.string(),
  capability: z.string(),
  source_uri: z.string().url(),
  source_type: SourceClassSchema,
  retrieved_at: z.string().datetime({ offset: true }),
  source_published_at: z.string().datetime({ offset: true }).optional(),
  source_updated_at: z.string().datetime({ offset: true }).optional(),
  contentHash: z.string(),
  media_type: z.string(),
  http_metadata: HTTPMetadataSchema.optional(),
  evidence_locators: z.array(EvidenceLocatorSchema),
  normalized_value: z.unknown(),
  raw_value_hash: z.string().optional(),
  transformation_history: z.array(ProvenanceStepSchema),
  adapter_version: z.string(),
  policy_version: z.string(),
  cache_status: CacheStatusSchema,
  freshness_status: FreshnessStatusSchema,
  authorization_classification: AuthorizationClassificationSchema,
  limitations: z.array(z.string()),
  warnings: z.array(z.string()),
  completeness_info: z.record(z.unknown()).optional(),
});
export type SourceObservation = z.infer<typeof SourceObservationSchema>;

export const AdapterResultSchema = z.object({
  resultClass: AdapterResultClassSchema,
  provider_id: z.string(),
  capability: z.string(),
  observations: z.array(SourceObservationSchema).optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      details: z.unknown().optional(),
      retry_after_ms: z.number().int().nonnegative().optional(),
    })
    .optional(),
  cache_status: CacheStatusSchema,
  freshness_status: FreshnessStatusSchema,
  warnings: z.array(z.string()),
  limitations: z.array(z.string()),
});
export type AdapterResult<T = unknown> = z.infer<typeof AdapterResultSchema> & {
  observations?: SourceObservation[];
  _type?: T;
};

export const AdapterHealthResultSchema = z.object({
  provider_id: z.string(),
  state: z.enum([
    'fixture_verified',
    'locally_live_verified',
    'live_unverified',
    'policy_blocked',
    'degraded',
    'unavailable',
    'unknown',
  ]),
  last_fixture_test: z.string().datetime({ offset: true }).optional(),
  last_live_success: z.string().datetime({ offset: true }).optional(),
  last_live_failure: z.string().datetime({ offset: true }).optional(),
  fixture_pass_rate: z.number().min(0).max(1).optional(),
  live_success_rate: z.number().min(0).max(1).optional(),
  p50_latency_ms: z.number().nonnegative().optional(),
  p95_latency_ms: z.number().nonnegative().optional(),
  rate_limited_count: z.number().int().nonnegative(),
  schema_drift_count: z.number().int().nonnegative(),
  circuit_state: z.enum(['closed', 'open', 'half_open']),
  terms_status: z.enum(['verified', 'pending_review', 'blocked']),
  adapter_version: z.string(),
  limitations: z.array(z.string()),
});
export type AdapterHealthResult = z.infer<typeof AdapterHealthResultSchema>;

export interface ProviderAdapter<TInput, TOutput> {
  readonly providerId: string;
  readonly capabilities: readonly string[];
  readonly manifest: ProviderManifest;

  execute(input: TInput, context: AdapterExecutionContext): Promise<AdapterResult<TOutput>>;

  health(context: AdapterHealthContext): Promise<AdapterHealthResult>;
}

export interface ArtifactStore {
  put(
    artifact: { id: string; contentHash: string; media_type: string; byte_length: number },
    content: Uint8Array
  ): Promise<void>;
  getMetadata(
    id: string
  ): Promise<{ contentHash: string; media_type: string; byte_length: number } | null>;
  getContent(id: string): Promise<Uint8Array | null>;
  exists(id: string): Promise<boolean>;
}

export interface RateLimiter {
  acquire(): Promise<void>;
  release(): void;
  tryAcquire(): boolean;
  getState(): {
    tokens: number;
    lastRefill: number;
    activeRequests: number;
    queuedRequests: number;
  };
  getAvailableTokens(): number;
}

export interface InjectedClock {
  now(): Date;
  nowMs(): number;
  setTimeout(callback: () => void, delay: number): unknown;
  clearTimeout(id: unknown): void;
  advance(ms: number): void;
  getCurrentTime(): number;
  setTime(ms: number): void;
}

export interface InjectedHttpClient {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface AuditEventSink {
  log(event: {
    type: string;
    details: Record<string, unknown>;
    correlationId?: string;
  }): Promise<void>;
  getEvents(): Array<{
    type: string;
    details: Record<string, unknown>;
    correlationId?: string;
    timestamp: number;
  }>;
  clear(): void;
}
