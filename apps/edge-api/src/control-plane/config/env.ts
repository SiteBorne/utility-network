import type { D1Database as CloudflareD1Database } from '@cloudflare/workers-types';

export interface Env {
  DB: CloudflareD1Database;
  ARTIFACTS: R2Bucket;
  JOBS: Queue;
  EVENTS: Queue;
  CATALOG: KVNamespace;
  AI: Ai;
  BROWSER: BrowserBinding;
  ENVIRONMENT: string;
  LOG_LEVEL: string;
  PCC_VERSION: string;
  SELLER_WALLET_ADDRESS: string;
  CDP_API_KEY_ID: string;
  CDP_API_KEY_SECRET: string;
  CDP_WALLET_SECRET: string;
  /** SUN-1000 checkpoint 1O-A: canonical Nevermined credential name,
   * matching `packages/protocol-nevermined/src/config.ts`'s own already-
   * correct `resolveNeverminedConfig` boundary (`canonical`/
   * `deprecated_alias` source tracking, `NVM_ENVIRONMENT` required,
   * `'live'` hard-disabled) -- that pure boundary function existed but
   * was never wired to this Env surface before this checkpoint, which is
   * itself the regression this correction closes. Optional here (as
   * `NEVERMINED_API_KEY` below) because `resolveNeverminedConfig`, not
   * this interface, is the actual presence/conflict validator; either
   * name alone is accepted, both set to different values is rejected at
   * that boundary. */
  NVM_API_KEY?: string;
  /** Required alongside `NVM_API_KEY`/`NEVERMINED_API_KEY` — must be
   * exactly `'sandbox'`; `'live'` is explicitly rejected by
   * `resolveNeverminedConfig`, and any other value is invalid. */
  NVM_ENVIRONMENT?: string;
  /** Deprecated alias for `NVM_API_KEY` — still accepted (never silently
   * ignored), per `resolveNeverminedConfig`'s `deprecated_alias` source
   * tracking. Do not require a new credential to be provisioned under
   * this name; prefer `NVM_API_KEY` for anything newly configured. */
  NEVERMINED_API_KEY?: string;
  VOYAGE_API_KEY: string;
  MODAL_TOKEN_ID: string;
  MODAL_TOKEN_SECRET: string;
  SENTRY_DSN: string;
  /** SUN-0700A checkpoint 5 (directive §6): explicit, additive config
   * gate for mounting the local paid-service routes at all. Optional and
   * additive so existing Env-shaped fixtures/tests are unaffected.
   * Absent/unset (the default everywhere today) means the routes are not
   * mounted — no default configuration can accidentally expose them.
   * This is independent of, and does not itself enable, real payment
   * execution: `production_enabled` remains `false` regardless. */
  PAID_ROUTES_ENABLED?: string;
  /** Additive Nevermined route-family gate. Checkpoint 2 still has no
   * authenticated sandbox provider, so setting this alone fails closed. */
  NEVERMINED_ROUTES_ENABLED?: string;
  /** SUN-1000 checkpoint 1O-B2: the explicit future-live guard flag
   * consumed by `evaluateNeverminedLiveGuard` (via
   * `NeverminedPaymentEvidenceProvider.authenticated()`) — must be
   * exactly `'1'`, together with `NVM_ENVIRONMENT === 'sandbox'` and a
   * sandbox-prefixed API key, before any real Nevermined SDK call can
   * occur. Setting this alone (without the other two conditions) does
   * nothing; all three are required simultaneously. */
  RUN_LIVE_NEVERMINED?: string;
  CF_PAGES_COMMIT_SHA?: string;
  CF_WORKER_VERSION?: string;
  /** SUN-0800B checkpoint 2: production Agent Card signing key material, a
   * JSON-serialized private ES256 JWK (`{"kty":"EC","crv":"P-256","d":...,
   * "x":...,"y":...}`). Both this and `AGENT_CARD_SIGNING_KEY_ID` must be
   * present together or both absent — see
   * `resolveAgentCardSigningIdentity`, which fails closed on a partial
   * configuration rather than silently falling back to the ephemeral
   * local/dev identity. Never logged, hashed, or echoed anywhere. */
  AGENT_CARD_SIGNING_PRIVATE_KEY?: string;
  /** Stable, versioned key identifier paired with
   * `AGENT_CARD_SIGNING_PRIVATE_KEY` (e.g. `siteborne-a2a-es256-2026-01`) —
   * distinct from the ephemeral local identity's hardcoded key id, so a
   * real deployment can rotate keys without colliding with the dev/test
   * identity. */
  AGENT_CARD_SIGNING_KEY_ID?: string;
  /** SUN-1200 checkpoint A (ADR 0055): explicit payment-environment
   * selector. Must be the exact literal `'production'` to have any
   * effect; every other value (including unset, empty, or any other
   * string) fails closed to `'preproduction'`. Never inferred from
   * `ENVIRONMENT`, hostname, `NODE_ENV`, or secret presence — see
   * `resolvePaymentEnvironment`. */
  PAYMENT_ENVIRONMENT?: string;
  /** The standing production kill switch for payment execution
   * specifically (distinct from `ENVIRONMENT`/`ControlPlaneConfig`'s own
   * unrelated, currently-unwired `productionEnabled` concept). Must be
   * the exact literal `'true'`; absent/unset (the default everywhere
   * today) makes production economically unreachable regardless of every
   * other flag. */
  PRODUCTION_ENABLED?: string;
  /** ADR 0055's per-action human bootstrap authorization. Must be the
   * exact literal `'true'`, and per the ADR is meant to be set for one
   * specific, bounded, explicitly-authorized action — never left on as
   * standing configuration. */
  HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP?: string;
  /** Separate from `PRODUCTION_ENABLED`: whether the CDP credentials
   * currently configured have been explicitly approved for mainnet use.
   * Must be the exact literal `'true'`. A previously-exposed sandbox/
   * testnet credential set never automatically satisfies this — see ADR
   * 0055 §8 (credential policy) and SUN-1200 checkpoint A's report. */
  PRODUCTION_CDP_CREDENTIALS_APPROVED?: string;
}

export interface ControlPlaneConfig {
  environment: 'production' | 'development' | 'test';
  buildId: string;
  productionEnabled: boolean;
  paidOverflowEnabled: boolean;
  maxConcurrentHeavyJobs: number;
  maxRequestBytes: number;
  maxJobCostUsd: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  pccVersion: string;
}

export function createControlPlaneConfig(env: Env): ControlPlaneConfig {
  const environment = (env.ENVIRONMENT as ControlPlaneConfig['environment']) ?? 'development';
  const productionEnabled = environment === 'production';
  const paidOverflowEnabled = false;
  const maxConcurrentHeavyJobs = 5;
  const maxRequestBytes = 10 * 1024 * 1024;
  const maxJobCostUsd = '10.00';
  const logLevel = (env.LOG_LEVEL as ControlPlaneConfig['logLevel']) ?? 'info';
  const pccVersion = env.PCC_VERSION ?? '1.0.0';
  const buildId = env.CF_PAGES_COMMIT_SHA ?? env.CF_WORKER_VERSION ?? 'local';

  if (productionEnabled) {
    validateProductionBindings(env);
  }

  return {
    environment,
    buildId,
    productionEnabled,
    paidOverflowEnabled,
    maxConcurrentHeavyJobs,
    maxRequestBytes,
    maxJobCostUsd,
    logLevel,
    pccVersion,
  };
}

function validateProductionBindings(env: Env): void {
  const requiredBindings: (keyof Env)[] = ['DB', 'ARTIFACTS', 'JOBS', 'EVENTS'];
  const missing = requiredBindings.filter((b) => !env[b]);
  if (missing.length > 0) {
    throw new Error(`Missing required production bindings: ${missing.join(', ')}`);
  }

  const requiredSecrets: (keyof Env)[] = [
    'SELLER_WALLET_ADDRESS',
    'CDP_API_KEY_ID',
    'CDP_API_KEY_SECRET',
    'CDP_WALLET_SECRET',
  ];
  const missingSecrets = requiredSecrets.filter((s) => !env[s]);
  // SUN-1000 checkpoint 1O-A: the Nevermined credential is accepted under
  // either its canonical name (NVM_API_KEY) or the deprecated alias
  // (NEVERMINED_API_KEY) -- mirroring resolveNeverminedConfig's own
  // either-name-accepted semantics, never requiring a new credential to
  // be provisioned under a name this codebase no longer treats as
  // canonical.
  if (!env.NVM_API_KEY && !env.NEVERMINED_API_KEY) {
    missingSecrets.push('NVM_API_KEY');
  }
  if (missingSecrets.length > 0) {
    throw new Error(`Missing required production secrets: ${missingSecrets.join(', ')}`);
  }
}

export function createTestConfig(overrides: Partial<ControlPlaneConfig> = {}): ControlPlaneConfig {
  return {
    environment: 'test',
    buildId: 'test-build',
    productionEnabled: false,
    paidOverflowEnabled: false,
    maxConcurrentHeavyJobs: 10,
    maxRequestBytes: 10 * 1024 * 1024,
    maxJobCostUsd: '10.00',
    logLevel: 'debug',
    pccVersion: '1.0.0',
    ...overrides,
  };
}

export function createDevelopmentConfig(
  overrides: Partial<ControlPlaneConfig> = {}
): ControlPlaneConfig {
  return {
    environment: 'development',
    buildId: 'dev-build',
    productionEnabled: false,
    paidOverflowEnabled: false,
    maxConcurrentHeavyJobs: 5,
    maxRequestBytes: 10 * 1024 * 1024,
    maxJobCostUsd: '10.00',
    logLevel: 'debug',
    pccVersion: '1.0.0',
    ...overrides,
  };
}

export const BINDING_NAMES = {
  DB: 'DB',
  ARTIFACTS: 'ARTIFACTS',
  JOBS: 'JOBS',
  EVENTS: 'EVENTS',
  CATALOG: 'CATALOG',
  AI: 'AI',
  BROWSER: 'BROWSER',
} as const;

export type BindingName = (typeof BINDING_NAMES)[keyof typeof BINDING_NAMES];

export interface TypedBindings {
  DB: CloudflareD1Database;
  ARTIFACTS: R2Bucket;
  JOBS: Queue<QueueDispatchMessage>;
  EVENTS: Queue<AuditEventMessage>;
  CATALOG: KVNamespace;
}

export interface QueueDispatchMessage {
  job_id: string;
  attempt_number: number;
  service_id: string;
  service_version: string;
  input_artifact_ref: string;
  contract_hash: string;
  trace_context: string;
  dispatched_at: string;
  expires_at: string;
  retry_count: number;
}

export interface AuditEventMessage {
  event_type: string;
  job_id?: string;
  attempt_number?: number;
  service_id?: string;
  actor: string;
  details: Record<string, unknown>;
  timestamp: string;
  correlation_id?: string;
}

declare global {
  interface D1Database {
    prepare(query: string): D1PreparedStatement;
    exec(query: string): Promise<D1ExecResult>;
    dump(): Promise<ArrayBuffer>;
  }

  interface D1PreparedStatement {
    bind(...values: unknown[]): D1PreparedStatement;
    first<T = unknown>(colName?: string): Promise<T | null>;
    run(): Promise<D1Result>;
    all<T = unknown>(): Promise<D1Result<T>>;
    raw<T = unknown>(): Promise<T[]>;
  }

  interface D1Result<T = unknown> {
    results: T[];
    success: boolean;
    meta: D1Meta;
  }

  interface D1ExecResult {
    count: number;
    duration: number;
  }

  interface D1Meta {
    last_row_id: number;
    changed_db: boolean;
    changes: number;
    size_after: number;
    rows_read: number;
    rows_written: number;
  }

  interface R2Bucket {
    put(
      key: string,
      value: ReadableStream | ArrayBuffer | string,
      options?: R2PutOptions
    ): Promise<R2Object | null>;
    get(key: string, options?: R2GetOptions): Promise<R2ObjectBody | null>;
    head(key: string): Promise<R2Object | null>;
    delete(key: string): Promise<void>;
    list(options?: R2ListOptions): Promise<R2Objects>;
  }

  interface R2Object {
    key: string;
    version: string;
    size: number;
    etag: string;
    httpMetadata: R2HTTPMetadata;
    customMetadata: Record<string, string>;
    uploaded: Date;
  }

  interface R2ObjectBody extends R2Object {
    body: ReadableStream;
    arrayBuffer(): Promise<ArrayBuffer>;
    text(): Promise<string>;
    json<T>(): Promise<T>;
  }

  interface R2PutOptions {
    onlyIf?: R2Condition;
    httpMetadata?: R2HTTPMetadata;
    customMetadata?: Record<string, string>;
  }

  interface R2GetOptions {
    onlyIf?: R2Condition;
    range?: R2Range;
  }

  interface R2ListOptions {
    prefix?: string;
    cursor?: string;
    delimiter?: string;
    limit?: number;
  }

  interface R2Objects {
    objects: R2Object[];
    truncated: boolean;
    cursor?: string;
  }

  interface R2HTTPMetadata {
    contentType?: string;
    contentLanguage?: string;
    contentEncoding?: string;
    contentDisposition?: string;
    cacheControl?: string;
    contentLength?: number;
  }

  interface R2Condition {
    etagMatches?: string;
    etagDoesNotMatch?: string;
    uploadedBefore?: Date;
    uploadedAfter?: Date;
  }

  interface R2Range {
    offset: number;
    length?: number;
    suffix?: number;
  }

  interface Queue<T = unknown> {
    send(message: T, options?: QueueSendOptions): Promise<void>;
    sendBatch(messages: T[], options?: QueueSendOptions): Promise<void>;
    receive(batchSize?: number, waitTimeSeconds?: number): Promise<QueueBatch<T>>;
  }

  interface QueueSendOptions {
    delaySeconds?: number;
  }

  interface QueueBatch<T> {
    messages: QueueMessage<T>[];
    ackAll(): void;
    retryAll(): void;
  }

  interface QueueMessage<T> {
    body: T;
    id: string;
    timestamp: number;
    ack(): void;
    retry(options?: { delaySeconds?: number }): void;
  }

  interface KVNamespace {
    get(
      key: string,
      type?: 'text' | 'json' | 'arrayBuffer' | 'stream'
    ): Promise<string | unknown | ArrayBuffer | ReadableStream | null>;
    put(
      key: string,
      value: string | ReadableStream | ArrayBuffer,
      options?: KVNamespacePutOptions
    ): Promise<void>;
    delete(key: string): Promise<void>;
    list(options?: KVNamespaceListOptions): Promise<KVNamespaceListResult>;
  }

  interface KVNamespacePutOptions {
    expiration?: number;
    expirationTtl?: number;
    metadata?: unknown;
  }

  interface KVNamespaceListOptions {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }

  interface KVNamespaceListResult {
    keys: { name: string; expiration?: number; metadata?: unknown }[];
    list_complete: boolean;
    cursor?: string;
  }

  interface Ai {
    run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
  }

  interface BrowserBinding {
    fetch(url: string, options?: RequestInit): Promise<Response>;
  }
}
