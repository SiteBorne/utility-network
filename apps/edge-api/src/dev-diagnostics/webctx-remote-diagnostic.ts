/**
 * SUN-1221E5Q — dev-only Cloudflare-network reproduction seam for
 * `web_context_verified.v2`'s premature-EOF investigation (SUN-1221E5/E5P).
 *
 * NEVER imported by `apps/edge-api/src/index.ts` or any production
 * composition/route file. NEVER bundled into a deployed or uploaded Worker
 * version — `wrangler.toml`'s `main` still points at the real production
 * entry point and is untouched by this file's existence. Reachable only via
 *
 *   pnpm exec wrangler dev --remote \
 *     apps/edge-api/src/dev-diagnostics/webctx-remote-diagnostic.ts \
 *     --var DIAGNOSTIC_SEAM_ENABLED:true --port <port>
 *
 * SUN-1221E5Q4: the plain invocation above (auto-discovering the
 * repo-root `wrangler.toml` because this file lives under the repo
 * tree) reliably returns HTTP 525 with the handler never reached --
 * NOT a defect in this file or its imports. Bisection proved two
 * independent `wrangler dev --remote`-only config interactions, neither
 * present in real production deploys:
 *   - `routes` (the zone-scoped MCP-registry-auth Worker Route in the
 *     root `wrangler.toml`) is BY ITSELF sufficient to reproduce the
 *     exact 525 signature, even against a zero-import static-200
 *     handler with none of this file's own imports involved.
 *   - `[queues]` producers are BY THEMSELVES sufficient to reproduce a
 *     separate HTTP 503 / error 1105, matching wrangler's own explicit
 *     "Queues are not yet supported in wrangler dev remote mode."
 * This file reads no D1/KV/Queues/Browser/AI binding anywhere, so for
 * remote-preview diagnostic sessions use an override config that omits
 * `routes` and `[queues]` (and, for simplicity, the other real-resource
 * bindings this file never touches) instead of the repo-root
 * `wrangler.toml`, e.g.:
 *
 *   pnpm exec wrangler dev --remote \
 *     apps/edge-api/src/dev-diagnostics/webctx-remote-diagnostic.ts \
 *     --config <routes-and-queues-free-override>.toml \
 *     --var DIAGNOSTIC_SEAM_ENABLED:true --port <port>
 *
 * See docs/reports/SUN-1221E5Q4-remote-bundle-delta-debugging.md for the
 * full bisection evidence. Real production deploys are unaffected --
 * this is exclusively a `wrangler dev --remote` preview-tooling
 * interaction with a legitimate, working production `routes` entry, not
 * a bug in that entry or in any SITEBORNE source.
 *
 * which runs the bundle on Cloudflare's real network (confirmed empirically,
 * SUN-1221E5Q design-approval evidence: "Starting remote preview...", a real
 * multi-MB upload) but binds only to http://localhost:<port> on the
 * operator's own machine — no public route, no tunnel, no persisted Worker
 * version, no deployment, zero effect on `wrangler deployments status` or
 * normal production traffic (all confirmed empirically the same way).
 *
 * Bypasses the entire x402/payment path structurally, not just by
 * discipline: this file has no import of `x402-service.ts`, no facilitator
 * client, no EIP-3009/signing material, no D1 payment tables. Its one route
 * invokes the SAME executor boundary production uses —
 * `WebContextVerifiedService` -> `PublicHttpAdapter` -> `SafeSocketHttpClient`
 * -> real `cloudflare:sockets` `connect()`, the real `TermsGuard`
 * `direct-public-http` / `operator_risk_acceptance` path (SUN-1221E2T/E2T1),
 * the real DNS-rebinding/SSRF checks — via the exact same
 * `buildWebContextV2SafeHttpClient` the production composition already
 * exports and tests (`web-context-v2-cdp-composition.ts`). No transport code
 * is duplicated here.
 *
 * `WebContextVerifiedService.execute()` unconditionally calls
 * `verifyAndSign(...)` (success OR failure) to self-sign a PCC document — it
 * needs *a* structurally valid Ed25519 signer/registry pair to complete, not
 * real payment-receipt signing material (traced and confirmed during this
 * checkpoint; see the SUN-1221E5Q chat approval). The keypair below reuses
 * `@siteborne/verification`'s own `generateTestKeypair` — the same
 * genuinely-random, in-memory, per-invocation primitive `createFixtureSigner`
 * uses everywhere else in this repository's test suites (never a hardcoded
 * literal, never derived from any secret) — so this file never imports
 * `@noble/ed25519` directly and never reads `PAID_RECEIPT_SIGNING_PRIVATE_KEY`,
 * any Worker secret, or any other persisted source. Registered with
 * `environment: 'test'` (the
 * only non-production value `KeyRecord` allows) and a `purpose` string that
 * says plainly this is a diagnostic self-check, never real receipt material.
 * The private key bytes are never returned, logged, or persisted anywhere.
 * The resulting PCC/receipt is returned directly in the diagnostic HTTP
 * response and is never written to D1, never treated as a real paid-service
 * result, and carries no economic meaning.
 *
 * `DIAGNOSTIC_SEAM_ENABLED` gates the one route below. It is never set in
 * `wrangler.toml`, never a persisted Worker secret, never present on any
 * deployed or uploaded Worker version — it exists only as a `--var` flag on
 * the one-off `wrangler dev --remote` CLI invocation that runs this exact
 * file, so the gate is unreachable everywhere except that ephemeral session
 * by construction, not by discipline.
 */
import { Hono } from 'hono';
import {
  generateTestKeypair,
  KeyRegistry,
  setPrecompiledOutputValidators,
  type Signer,
} from '@siteborne/verification';
import { outputValidatorsById } from '../generated/output-validators.generated.js';
import {
  buildServiceContext,
  DEFAULT_SERVICE_BUDGET,
  executeLocalService,
  ServiceRegistry,
  WebContextVerifiedService,
  type ServiceAuditEventSink,
} from '@siteborne/service-runtime';
import { PublicHttpAdapter } from '@siteborne/provider-adapters';
import type {
  ArtifactStore,
  AuditEventSink,
  InjectedClock,
  ConnectFn,
  SocketLike,
} from '@siteborne/provider-adapters';
import { buildWebContextV2SafeHttpClient } from '../control-plane/production/web-context-v2-cdp-composition';
import { connect as realCloudflareConnect } from '../cloudflare-sockets-ambient';

// SUN-1221E5Q5 §3/§9 — the real, proven root cause of this checkpoint's
// `internal_verification_failed`/`EvalError: Code generation from strings
// disallowed for this context`: `WebContextVerifiedService.execute()`'s
// unconditional post-finalization schema check (verify-and-sign.ts) prefers
// `getPrecompiledOutputValidator(schemaId)` but falls through to
// `getAjv().getSchema(schemaId)` -- runtime AJV compilation via
// `new Function(...)` -- whenever nothing has registered a precompiled
// validator for that schema id yet. Every real production route module
// (`production-web-context-v2-cdp-route.ts`,
// `production-verify-v2-cdp-route.ts`, `paid-services.ts`) calls
// `setPrecompiledOutputValidators(outputValidatorsById)` as a module-load
// side effect, so real production traffic (proven clean by
// `scripts/test-worker-runtime.mts`'s own PHASE 1/2 EvalError guards, and
// by SUN-1201 checkpoint G's identical earlier fix) never falls through to
// AJV. This file deliberately never imports those route modules (the whole
// point of this diagnostic seam is bypassing the real x402/payment
// composition) -- so it never got that side effect either, until now.
// Registering the SAME shared, already-production-tested validators here
// (never inventing new ones) is dev-diagnostic-seam-only, idempotent, and
// side-effect-free on every other call site (exactly the property
// `production-web-context-v2-cdp-route.ts`'s own doc comment already
// documents for calling this more than once). RED/GREEN proof: see
// docs/reports/SUN-1221E5Q5-remote-diagnostic-pretransport-forensics.md.
setPrecompiledOutputValidators(outputValidatorsById);

/** The one and only diagnostic target for this seam — a source-level
 * constant, never accepted from the request (no query string, body,
 * header, or redirect override). SUN-1221E5Q "Target rule". The executor
 * may still follow redirects, but only per its normal production
 * SSRF/revalidation behavior — nothing about that path is touched here. */
export const FIXED_DIAGNOSTIC_TARGET = 'https://example.com/';

/** `^kid_[a-z0-9]{24}$` (see `production-signer.ts`) — an unmistakably
 * diagnostic id within that required charset; not a production key id and
 * never will collide with one (`buildProductionSigner`'s real ids are
 * provisioned key material, never this literal string). */
export const DIAGNOSTIC_KEY_ID = 'kid_diagnosticwebctxe5qnonpr';

interface DiagnosticEnv {
  DIAGNOSTIC_SEAM_ENABLED?: string;
}

// SUN-1221E5Q5 §8 — every builder below is exported (in addition to being
// used by the route handler further down) solely so
// `webctx-remote-diagnostic.construction.test.ts` can exercise the EXACT
// diagnostic-seam construction pattern (ephemeral signer, stub audit/
// artifact-store, execution_mode: 'live') against a fake, non-network
// `InjectedHttpClient` -- no real socket, no `wrangler dev`, fully
// deterministic. Exporting more symbols from a file that is never imported
// by any production composition/route/entrypoint changes nothing about
// this file's reachability or bundling (see the file-level doc comment).
export function realClock(): InjectedClock {
  const unsupported = (method: string) => (): never => {
    throw new Error(`real_clock_cannot_${method}: this is real platform time, not a fixture clock`);
  };
  return {
    now: () => new Date(),
    nowMs: () => Date.now(),
    setTimeout: (cb: () => void, delay: number) => globalThis.setTimeout(cb, delay),
    clearTimeout: (id: unknown) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
    advance: unsupported('advance'),
    setTime: unsupported('setTime'),
    getCurrentTime: () => Date.now(),
  };
}

export function unreachableArtifactStore(): ArtifactStore {
  const fail = (method: string) => (): never => {
    throw new Error(`unreachable_artifact_store: diagnostic seam never persists artifacts (${method})`);
  };
  return { put: fail('put'), getMetadata: fail('getMetadata'), getContent: fail('getContent'), exists: fail('exists') };
}

export function discardedAuditSink(): AuditEventSink {
  return {
    async log() {
      /* diagnostic seam: never persisted */
    },
    getEvents() {
      return [];
    },
    clear() {
      /* no-op */
    },
  };
}

export function requestScopedAuditSink(): ServiceAuditEventSink {
  const events: Array<{ type: string; details: Record<string, unknown>; correlation_id?: string; timestamp: number }> = [];
  return {
    emit(event) {
      events.push({ ...event, timestamp: Date.now() });
    },
    getEvents() {
      return events;
    },
  };
}

/** Ed25519 keypair generated fresh, in-memory, per request — never read
 * from any secret, env var, or persisted source. Registered with
 * `environment: 'test'` (the only non-production value the schema allows)
 * and an explicitly diagnostic `purpose`, so nothing downstream could ever
 * mistake this for a real production receipt signature even if the PCC
 * document were inspected out of context. Private key bytes never leave
 * this function. */
export async function buildEphemeralDiagnosticSigner(): Promise<{ signer: Signer; registry: KeyRegistry }> {
  const keypair = await generateTestKeypair(DIAGNOSTIC_KEY_ID);

  const registry = new KeyRegistry();
  registry.register({
    key_id: keypair.keyId,
    algorithm: 'Ed25519',
    public_key: keypair.publicKey,
    status: 'active',
    valid_from: new Date().toISOString(),
    purpose: 'SUN-1221E5Q diagnostic self-check only — NOT a real payment receipt signature',
    environment: 'test',
  });

  return { signer: { keyId: keypair.keyId, privateKey: keypair.privateKey }, registry };
}

/**
 * SUN-1221E5Q5 §4/§5 — dev-only boundary telemetry. Each event carries only
 * a stage name, a boolean, and an elapsed-ms number (plus, for the one
 * connect event, a safe hostname/port pair copied from the fixed diagnostic
 * target constant — never from the response). No response body, no
 * headers, no secrets: DEV_TRACE_SECRET_REACHABILITY=0 by construction,
 * the same way `DIAGNOSTIC_SEAM_ENABLED` is unreachable outside this file
 * by construction rather than by discipline.
 */
interface DiagStageEvent {
  stage: string;
  success: boolean;
  elapsed_ms: number;
  detail?: { hostname: string; port: number };
}

function createStageTrace(startedAtMs: number) {
  const events: DiagStageEvent[] = [];
  return {
    record(stage: string, success: boolean, detail?: DiagStageEvent['detail']) {
      events.push({ stage, success, elapsed_ms: Date.now() - startedAtMs, detail });
    },
    events,
  };
}

/**
 * SUN-1221E5Q5 §5 — wraps the REAL `cloudflare:sockets` `connect` (the same
 * one `buildWebContextV2SafeHttpClient` defaults to and production uses) so
 * this diagnostic seam can prove, not infer, whether `SafeSocketHttpClient`
 * ever reached the socket boundary. Never substitutes a fake socket for the
 * live remote test — every call is forwarded to the real platform
 * `connect()` and its real return value (or thrown error) is passed through
 * unchanged. This is the "decisive first boundary" the checkpoint calls
 * for: everything upstream of `connect()` (URL validation, TermsGuard, DoH
 * resolution) is proven instead by the already-real `diagnostic_reason_code`
 * this file now correctly surfaces from the service result (see the
 * `/__diag/webctx-remote` handler below) rather than by adding a second,
 * parallel wrapper around the DoH client that `buildWebContextV2SafeHttpClient`
 * does not expose as an injectable parameter.
 */
function wrapConnectForDiagnostics(
  trace: ReturnType<typeof createStageTrace>,
  real: ConnectFn
): ConnectFn {
  return (address, options) => {
    trace.record('socket_connect_called', true, { hostname: address.hostname, port: address.port });
    let socket: SocketLike;
    try {
      socket = real(address, options);
    } catch (err) {
      trace.record('socket_connect_returned', false, { hostname: address.hostname, port: address.port });
      throw err;
    }
    trace.record('socket_connect_returned', true, { hostname: address.hostname, port: address.port });
    return socket;
  };
}

const app = new Hono<{ Bindings: DiagnosticEnv }>();

/**
 * SUN-1221E5Q2 §4 — inert reachability probe. Touches nothing but the Hono
 * router and the same gate variable: no SafeSocket, no DNS, no outbound TLS,
 * no TermsGuard, no PCC signing. Exists solely to distinguish "the remote
 * preview transport itself is broken" from "the SafeSocket diagnostic path
 * is broken", per the 525 forensics checkpoint. Same gate, same
 * never-imported-by-production file; adds no new reachable surface beyond
 * what `/__diag/webctx-remote` already establishes.
 */
app.get('/__diag/health', (c) => {
  if (c.env?.DIAGNOSTIC_SEAM_ENABLED !== 'true') {
    return c.notFound();
  }
  return c.json({ diagnostic: 'SUN-1221E5Q2 inert-health', ok: true, ts: Date.now() });
});

app.get('/__diag/webctx-remote', async (c) => {
  if (c.env?.DIAGNOSTIC_SEAM_ENABLED !== 'true') {
    return c.notFound();
  }

  const startedAtMs = Date.now();
  const trace = createStageTrace(startedAtMs);
  trace.record('diag_handler_entered', true);

  const wrappedConnect = wrapConnectForDiagnostics(trace, realCloudflareConnect);
  const httpClient = buildWebContextV2SafeHttpClient(wrappedConnect);
  const clock = realClock();
  const { signer, registry: keyRegistry } = await buildEphemeralDiagnosticSigner();

  const context = buildServiceContext('web_context_verified.v2', {
    job_id: 'sun-1221e5q-diagnostic',
    request_id: crypto.randomUUID(),
    clock,
    artifact_store: unreachableArtifactStore(),
    audit: requestScopedAuditSink(),
    budget: DEFAULT_SERVICE_BUDGET,
    execution_mode: 'live',
  });

  const publicHttp = new PublicHttpAdapter(httpClient, clock, unreachableArtifactStore(), discardedAuditSink());

  const registry = new ServiceRegistry();
  registry.register({
    serviceId: 'web_context_verified.v2',
    contractRelease: '2.0.0',
    productionEnabled: false,
    service: new WebContextVerifiedService({ httpClient, publicHttp, signer, keyRegistry }),
    implementationVersion: '0.1.0',
    inputSchemaHash: 'sha256:' + '3'.repeat(64),
    outputSchemaHash: 'sha256:' + '4'.repeat(64),
    implementationStatus: 'local_fixture_verified',
  });
  trace.record('executor_constructed', true);

  // SUN-1221E5Q5 §3/§9 — the previous version of this handler read
  // `executed.output?.limitations?.[0]`, but `WebContextVerifiedService`
  // (packages/service-runtime/src/services/web-context/service.ts) only
  // ever populates `output` when the result is a genuine success --
  // ANY failure (including the one this diagnostic exists to observe)
  // returns `output: undefined`, discarding that extraction path
  // entirely. The real diagnostic detail was always present as a SIBLING
  // field: the top-level `limitations` array, and — with more precision
  // — `failure.code` / `failure.details.diagnostic_reason_code` /
  // `failure.details.diagnostic_stage` (populated by the same file's
  // `httpDiagnosticDetails`). This was a dev-diagnostic-seam defect only:
  // no shared production code reads `output.limitations` this way, and
  // no production caller of `WebContextVerifiedService` was affected.
  let outcome: {
    resultClass: string;
    failureCode?: string;
    failureMessage?: string;
    diagnosticReasonCode?: string;
    diagnosticStage?: string;
    // SUN-1221E5Q6A — closed two-value enum, only set when
    // diagnosticReasonCode is WEBCTX_HTTP_PREMATURE_EOF.
    eofBranchId?: string;
    limitation?: string;
    threw: boolean;
    // Presence of a receipt_id/verification block is only possible once
    // `WebContextVerifiedService.execute()` has run all the way through
    // `buildDraftDocument` + `verifyAndSign` (service.ts calls
    // `verifyAndSign` unconditionally, success or failure) — so their
    // presence is direct, real proof this execution reached and
    // completed that stage, distinct from `dispatcher.ts`'s
    // `closedFailure` wrapper (unknown_service / execution_timeout /
    // internal_error), which never sets either field.
    serviceExecuteReachedVerifyAndSign: boolean;
  };
  trace.record('service_execute_entered', true);
  try {
    const executed = await executeLocalService(
      registry,
      'web_context_verified.v2',
      { target_url: FIXED_DIAGNOSTIC_TARGET, retrieval_mode: 'direct' },
      context
    );
    trace.record('service_execute_returned', true);
    outcome = {
      resultClass: executed.result_class,
      failureCode: executed.failure?.code,
      failureMessage: executed.failure?.message,
      diagnosticReasonCode: (executed.failure?.details as { diagnostic_reason_code?: string } | undefined)
        ?.diagnostic_reason_code,
      diagnosticStage: (executed.failure?.details as { diagnostic_stage?: string } | undefined)
        ?.diagnostic_stage,
      eofBranchId: (executed.failure?.details as { eof_branch_id?: string } | undefined)?.eof_branch_id,
      limitation: executed.limitations?.[0],
      threw: false,
      serviceExecuteReachedVerifyAndSign: Boolean(executed.receipt_id && executed.verification),
    };
  } catch (err) {
    trace.record('service_execute_returned', false);
    outcome = {
      resultClass: 'threw',
      failureMessage: err instanceof Error ? err.message : String(err),
      threw: true,
      serviceExecuteReachedVerifyAndSign: false,
    };
  }

  const elapsedMs = Date.now() - startedAtMs;
  const connectCalled = trace.events.some((e) => e.stage === 'socket_connect_called');
  const connectReturned = trace.events.some((e) => e.stage === 'socket_connect_returned' && e.success);

  return c.json({
    diagnostic: 'SUN-1221E5Q5 webctx-remote-diagnostic',
    target: FIXED_DIAGNOSTIC_TARGET,
    stage_trace: trace.events,
    safe_socket_connect_called: connectCalled,
    safe_socket_connect_returned: connectReturned,
    service_execute_reached_verify_and_sign: outcome.serviceExecuteReachedVerifyAndSign,
    failure_code: outcome.failureCode,
    diagnostic_reason_code: outcome.diagnosticReasonCode,
    diagnostic_stage: outcome.diagnosticStage,
    // SUN-1221E5Q6A — closed two-value enum (HEADER_PARSE_EOF |
    // CHUNKED_BODY_EOF), only present when diagnostic_reason_code is
    // WEBCTX_HTTP_PREMATURE_EOF; absent otherwise. Not a raw error-
    // message passthrough — see errors.ts's `deriveEofBranchId`.
    eof_branch_id: outcome.eofBranchId,
    limitation: outcome.limitation,
    result_class: outcome.resultClass,
    error_detail: outcome.failureMessage ?? outcome.limitation,
    elapsed_ms: elapsedMs,
    note:
      'error_detail/diagnostic_reason_code/diagnostic_stage/eof_branch_id are sanitized ' +
      'adapter-classified fields (SUN-1221E2D/E4P/E5Q6A discipline) — never response ' +
      'body/headers/credentials, never a raw adapter error-message passthrough. ' +
      'SUN-1221E5Q5: previously always undefined on failure (extraction-path defect fixed this ' +
      'checkpoint, dev-diagnostic-seam-only, see SUN-1221E5Q5 report). This route never touches ' +
      'payment orchestration, settlement, or receipt persistence; it signs only an in-memory ' +
      'diagnostic self-check.',
  });
});

export default app;
