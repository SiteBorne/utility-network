import type {
  D1Database as CloudflareD1Database,
  Fetcher,
  Workflow,
} from '@cloudflare/workers-types';
import type { WorkflowContinuationInput } from '../continuation/types';

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
  /** SUN-1200 checkpoint E: no longer required by the production payment
   * runtime -- see `production-payment.ts`'s `checkProductionBindingsPresent`
   * doc comment for the full reconciliation against the installed
   * `@coinbase/cdp-sdk`'s own documented semantics (Wallet Secret
   * authenticates only POST/DELETE Account-API writes; this repository's
   * two real CDP call sites, the x402 facilitator client and the
   * read-only seller `getAccount` lookup, need neither). Kept optional,
   * not removed entirely, so a genuinely future wallet-write use case can
   * still supply it without a further `Env` change. */
  CDP_WALLET_SECRET?: string;
  /** SUN-1222C-DOCUMENT-ARTIFACT-LOCAL-CLOSURE-R2 §3 — critical
   * artifact-reclamation alerting (persistent R2 delete failures),
   * delivered to the dedicated `siteborne-storage-alert-receiver` Worker
   * over a Cloudflare Service Binding (`[[services]]` in `wrangler.toml`),
   * not a public HTTPS webhook — the receiver is internal-only by design
   * (no Custom Domain, no workers.dev route). Superseded design: an
   * earlier `STORAGE_RECLAMATION_ALERT_WEBHOOK_URL` HTTPS-webhook secret,
   * retired because it required the receiver to be publicly reachable.
   * Absent this binding, `reclaimStaleArtifactsScheduled` still emits its
   * existing `console.error` (captured by `wrangler tail`/Logpush) — this
   * is additive delivery, not a replacement, and its absence never blocks
   * or degrades reclamation itself (§3 "alert transport failure that never
   * blocks reclamation itself"). NOT yet deployed/wired live by this
   * checkpoint — repository/implementation preparation only; see
   * `wrangler.toml`'s `[[services]]` entry and
   * `wrangler.storage-alert-receiver.toml` for the full non-deployment
   * rationale and the separately-gated steps still required. */
  STORAGE_ALERT_RECEIVER?: Fetcher;
  /** Path-segment capability token the receiver checks against its own
   * `ALERT_PATH_TOKEN` secret (constant-time compare) — defense-in-depth
   * even though the binding itself is not publicly reachable. Provisioned
   * via `wrangler secret put STORAGE_ALERT_PATH_TOKEN`, never a `[vars]`
   * entry. NOT yet provisioned by this checkpoint. */
  STORAGE_ALERT_PATH_TOKEN?: string;
  // SUN-1222C closure: `STORAGE_ALERT_QUALIFICATION_TOKEN` and
  // `STORAGE_ALERT_SMTP_DIAGNOSTIC_TOKEN` (and the scaffolding routes they
  // guarded, `storage-alert-qualification-route.ts` and
  // `storage-alert-smtp-diagnostic-route.ts`) were temporary, single-use
  // checkpoints — real end-to-end delivery was qualified (mailbox-confirmed)
  // and the SMTP root cause (STARTTLS-upgrade-specific TLS handshake hang on
  // port 587; port 465 implicit TLS confirmed clean) was isolated. Both
  // routes and their secrets were removed from this Worker once evidenced;
  // see git history for the qualification/diagnostic-era implementation and
  // `storage-alert-receiver-entrypoint.ts`'s own doc comment for what
  // remains permanently.
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
  /** SUN-1221E5Q6G — dedicated environment-scoped credentials for the
   * off-Cloudflare safe-egress executor (`services/webctx-safe-egress`, a
   * SEPARATE Modal App from the one `MODAL_TOKEN_ID`/`MODAL_TOKEN_SECRET`
   * above authenticate against). Deliberately distinct names/values from
   * the OCR app's credentials — `REUSE_EXISTING_MODAL_OCR_CREDENTIALS=NO`
   * per the human-approved SUN-1221E5Q6F/G architecture. All three
   * optional: unset until the dedicated Modal App is actually deployed
   * and these are legitimately provisioned (never fabricated by this
   * repository) — `isWebContextV2CdpRouteFlagEnabled`-gated production
   * code paths that need them fail closed (`unavailable: true`) when
   * absent, exactly like `PAID_RECEIPT_SIGNING_PRIVATE_KEY` above. */
  MODAL_WEBCTX_ENDPOINT_URL?: string;
  MODAL_WEBCTX_PROXY_KEY?: string;
  MODAL_WEBCTX_PROXY_SECRET?: string;
  SENTRY_DSN: string;
  /** SUN-0700A checkpoint 5 (directive §6): explicit, additive config
   * gate for mounting the local paid-service routes at all. Optional and
   * additive so existing Env-shaped fixtures/tests are unaffected.
   * Absent/unset (the default everywhere today) means the routes are not
   * mounted — no default configuration can accidentally expose them.
   * This is independent of, and does not itself enable, real payment
   * execution: `production_enabled` remains `false` regardless. */
  PAID_ROUTES_ENABLED?: string;
  /** SUN-1218 checkpoint X: the route-specific activation gate for
   * `verify_agent_output.v2` / CDP, required IN ADDITION TO
   * `PAID_ROUTES_ENABLED` (both must be the exact literal `'true'`) --
   * `PAID_ROUTES_ENABLED` alone is no longer sufficient to reach this
   * one route, and no longer affects any other paid route's disposition
   * at all (the `/v1/*`/`/v2/*` wildcards are now unconditional 404,
   * independent of any flag). Absent/unset (the default everywhere
   * today) means the route is not reachable, matching every other
   * paid-route gate's fail-closed convention. */
  VERIFY_V2_CDP_ROUTE_ENABLED?: string;
  /** SUN-1221C — the route-specific activation gate for
   * `web_context_verified.v2` / CDP, mirroring
   * `VERIFY_V2_CDP_ROUTE_ENABLED` exactly: required IN ADDITION TO
   * `PAID_ROUTES_ENABLED` (both must be the exact literal `'true'`).
   * Independent of `VERIFY_V2_CDP_ROUTE_ENABLED` -- either service can be
   * active while the other is not (SUN-1221B §20 /
   * FIRST_SERVICE_DOES_NOT_DEPEND_ON_SECOND_SERVICE_FLAG). Absent/unset
   * means the route is not reachable, matching every other paid-route
   * gate's fail-closed convention. */
  WEB_CONTEXT_V2_CDP_ROUTE_ENABLED?: string;
  /** SUN-1222B-S3R — the route-specific activation gate for
   * `company_evidence_graph.v2` / CDP, mirroring
   * `WEB_CONTEXT_V2_CDP_ROUTE_ENABLED` exactly: required IN ADDITION TO
   * `PAID_ROUTES_ENABLED` (both must be the exact literal `'true'`).
   * Independent of the other two services' own flags. Absent/unset means
   * the route is not reachable, matching every other paid-route gate's
   * fail-closed convention. */
  COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED?: string;
  /** SUN-1222B-S3R — the route-specific activation gate for
   * `document_evidence_json.v2` / CDP, mirroring
   * `COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED` exactly. Setting this
   * `'true'` alone does NOT make the route reachable in production today
   * -- the route's own composition also requires `env.ARTIFACTS` (R2,
   * commented out of `wrangler.toml` since SUN-0800B checkpoint 3) and
   * `MODAL_DOCWORKER_*` (undeployed, SUN-0400B) to be present; absent
   * either, the composition returns `unavailable: true` and the route
   * 404s exactly like every other missing-credential case. */
  DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED?: string;
  /** SUN-1222B-S3R — dedicated Modal App/credential set for
   * `siteborne-document-worker`'s new `process_document_http` endpoint.
   * Deliberately NOT `MODAL_WEBCTX_*` -- a different Modal App with its
   * own proxy-auth token pair once deployed (SUN-0400B, not yet run). */
  MODAL_DOCWORKER_ENDPOINT_URL?: string;
  MODAL_DOCWORKER_PROXY_KEY?: string;
  MODAL_DOCWORKER_PROXY_SECRET?: string;
  /** SUN-1222B-S3-R2 — the route-specific activation gate for the
   * buyer-facing `POST /v2/artifacts/documents` upload endpoint, mirroring
   * `DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED`'s convention exactly:
   * required IN ADDITION TO `PAID_ROUTES_ENABLED`, and the route's own
   * handler additionally fails closed (404, never 500) if `DB`/`ARTIFACTS`
   * are not bound, regardless of this flag. */
  DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED?: string;
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
  /** SUN-1222C-DEPLOYMENT-DEPENDENCY-AND-MTLS-TRUTHFULNESS-REMEDIATION:
   * the sole gate for whether the live Agent Card is truthfully allowed
   * to advertise native A2A `mutualTLS` caller-identity *capability*
   * (`securitySchemes.mtls` in `packages/protocol-a2a/src/card.ts`).
   * `mtls-caller-context.ts` (SUN-1222C-AGENT-TRUST-100-IMPLEMENTATION-A)
   * added the source-level mTLS support but wired it into zero routes;
   * the card's `securitySchemes.mtls` declaration was left unconditional
   * from that same checkpoint, meaning a deploy of that code today would
   * advertise a capability before any real, operator-qualified
   * production mTLS interface exists (the exact "metadata says X, wire
   * behavior says not-X" case `productionEnabled` on the x402 extension
   * already guards against on the payment side, see
   * `production-payment.ts`'s resolvers). Must be the exact literal
   * `'true'`; absent/unset (the default everywhere today, and the only
   * production-compatible value until real mTLS provisioning is
   * qualified) means the card omits `securitySchemes.mtls` entirely.
   * This flag alone enables no request-time behavior whatsoever — it
   * governs ONLY this one static metadata field; Cloudflare edge mTLS
   * enforcement, x402 payment gating, and every other route's
   * authorization are all completely independent of it. See
   * `resolveMtlsProductionActive` in
   * `./mtls-production-capability.ts`. */
  MTLS_PRODUCTION_ACTIVE?: string;
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
  /** SUN-1215 checkpoint U: dedicated Ed25519 paid-receipt signing key
   * material (raw hex), provisioned as a real Cloudflare secret,
   * distinct from `AGENT_CARD_SIGNING_PRIVATE_KEY` (different key,
   * different algorithm family, different trust domain). Consumed only
   * by `buildProductionSigner`/`buildVerifyAgentOutputV2CdpProductionRouteConfig`
   * (SUN-1214), which fail closed on any missing/malformed value — never
   * falls back to a fixture key. Never logged, hashed, or echoed
   * anywhere. */
  PAID_RECEIPT_SIGNING_PRIVATE_KEY?: string;
  /** Paired with `PAID_RECEIPT_SIGNING_PRIVATE_KEY` above — must match
   * the frozen PCC receipt block's `signing_key_id` pattern
   * (`^kid_[a-z0-9]{24}$`); see `production-signer.ts`. */
  PAID_RECEIPT_SIGNING_KEY_ID?: string;
  /** SUN-1200 checkpoint D: non-secret Base mainnet JSON-RPC endpoint URL
   * for the read-only chain-receipt checker (`chain-receipt-checker.ts`).
   * A public RPC URL is not credential material -- never a secret -- but
   * is kept configurable rather than hardcoded so a real deployment can
   * point at a dedicated/rate-limited provider instead of viem's public
   * default. Absent/unset falls back to viem's own built-in default Base
   * mainnet RPC (`viem/chains`'s `base.rpcUrls.default`), unchanged
   * behavior. */
  BASE_RPC_URL?: string;
  /** Same as `BASE_RPC_URL`, for Base Sepolia (preproduction). */
  BASE_SEPOLIA_RPC_URL?: string;
  /** SUN-1221E6R-H2AWI-3: the Cloudflare Workflows binding for the durable
   * paid-continuation Workflow (`../workflows/paid-continuation-workflow.ts`'s
   * `PaidContinuationWorkflow`, H2AWI-2). Type-only addition this
   * checkpoint, per the plan's H2AWI-3/H2AWI-4 split -- the actual
   * `wrangler.toml` `[[workflows]]` binding block that makes this
   * genuinely resolve at runtime is H2AWI-4 scope (a real Cloudflare
   * Workflow provisioning action, requiring its own fresh human
   * authorization). Optional/absent until then: `x402-service.ts`'s own
   * durable-handoff call site fails closed (never falls back to a local
   * settle) when this binding is not configured, matching this
   * codebase's established "missing required config fails closed"
   * convention (see `MODAL_WEBCTX_*`, `PAID_RECEIPT_SIGNING_PRIVATE_KEY`
   * above). */
  PAID_CONTINUATION_WORKFLOW?: Workflow<WorkflowContinuationInput>;

  /** SUN-1221E6R-H2AWI-3F — base64-encoded 256-bit AES-GCM key sealing the
   * durable continuation envelope handed to `PAID_CONTINUATION_WORKFLOW`.
   * Paired 1:1 with the binding above: both are required together for a
   * paid production route to accept real traffic; either missing fails
   * closed via `production-web-context-v2-cdp-route.ts` /
   * `production-verify-v2-cdp-route.ts`, never a silent `undefined`
   * fallthrough into `createX402ServiceRoute`. See
   * `continuation/envelope.ts`'s `importContinuationEnvelopeKey`. */
  PAYMENT_CONTINUATION_ENCRYPTION_KEY?: string;
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

/**
 * SUN-1205 checkpoint K (§2) -- `PRODUCTION_BINDING_VALIDATOR_ROOT_CAUSE`:
 *
 * This function (and its only caller, `createControlPlaneConfig`) has zero
 * callers anywhere in the real request path -- `index.ts` imports only the
 * `Env`/`ControlPlaneConfig` *types* from this module, never the
 * `createControlPlaneConfig` function. It is exercised exclusively by
 * `apps/edge-api/tests/env-nevermined-credential.test.ts`.
 *
 * Its `requiredBindings` list was stale, independent of the dead-code
 * question: `ARTIFACTS` has been commented out in `wrangler.toml` since the
 * SUN-0800B checkpoint 3 decision to defer R2 provisioning ("R2 bucket
 * commented out - needs dashboard enablement first") and has zero source
 * references anywhere (`grep -rln "env.ARTIFACTS" apps/edge-api/src`
 * returns nothing) -- requiring it would make this function reject a
 * genuinely valid, fully-functional production Worker the instant anyone
 * wired it into a real path. `JOBS` and `EVENTS` are declared as Queue
 * producer bindings in `wrangler.toml` but likewise have zero source
 * references anywhere in the codebase (no code has ever sent or consumed a
 * message on either queue). `CATALOG` (KV) is declared and bound but also
 * has zero source references. The only binding any live request-handling
 * code actually dereferences is `DB` (14 references in `index.ts` alone).
 *
 * Production configuration validation belongs at two different layers,
 * both real and already correct or fixed here: (1) request-time secret
 * presence for the payment-specific credentials, already correctly handled
 * by this same package's `production-payment.ts`'s `checkProductionBindingsPresent`
 * (narrow, accurate, actually wired into `resolveProductionCdpEvidenceProvider`,
 * fails closed to fixture mode rather than throwing); (2) a preflight/
 * release-gate check of binding *presence* (not secret values) against
 * what `wrangler.toml` declares and what source code actually dereferences
 * -- this is what SUN-1205 §3 wires this function into for real, via
 * `pnpm production:preflight` (`scripts/production-preflight.mts`).
 *
 * Fix applied: narrowed `requiredBindings` to `['DB']` -- the only binding
 * with a real dependency -- and exported the function so the new preflight
 * script can call it directly rather than duplicating the check. Left
 * un-wired into `createControlPlaneConfig`'s runtime call path deliberately
 * (wiring dead code into a live path is a behavior change out of this
 * checkpoint's minimal-fix scope, and is unnecessary: `index.ts` already
 * returns a graceful `configuration_error` 500 per-route when `c.env.DB`
 * is absent, which is the actual production-facing binding-presence gate
 * today).
 */
export function validateProductionBindings(env: Env): void {
  const requiredBindings: (keyof Env)[] = ['DB'];
  const missing = requiredBindings.filter((b) => !env[b]);
  if (missing.length > 0) {
    throw new Error(`Missing required production bindings: ${missing.join(', ')}`);
  }

  const requiredSecrets: (keyof Env)[] = [
    'SELLER_WALLET_ADDRESS',
    'CDP_API_KEY_ID',
    'CDP_API_KEY_SECRET',
    // SUN-1200 checkpoint E: CDP_WALLET_SECRET deliberately no longer
    // required -- see production-payment.ts's checkProductionBindingsPresent
    // doc comment for the full reconciliation.
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
