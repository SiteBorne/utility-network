export interface Env {
  DB: D1Database;
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
  CDP_API_KEY_NAME: string;
  CDP_API_KEY_PRIVATE_KEY: string;
  CDP_WALLET_SECRET: string;
  NEVERMINED_API_KEY: string;
  VOYAGE_API_KEY: string;
  MODAL_TOKEN_ID: string;
  MODAL_TOKEN_SECRET: string;
  SENTRY_DSN: string;
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
    'CDP_API_KEY_NAME',
    'CDP_API_KEY_PRIVATE_KEY',
    'CDP_WALLET_SECRET',
    'NEVERMINED_API_KEY',
  ];
  const missingSecrets = requiredSecrets.filter((s) => !env[s]);
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
  DB: D1Database;
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
