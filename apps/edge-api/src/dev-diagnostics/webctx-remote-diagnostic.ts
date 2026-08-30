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
  lifecycle: Q6BLifecycle,
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
    return wrapSocketForDiagnostics(socket, 'initial', lifecycle);
  };
}

/**
 * SUN-1221E5Q6B — non-gating socket/stream lifecycle facts, populated
 * without adding a single new `await` to the sequence
 * `SafeSocketHttpClient.fetch()` already performs (read-only lifecycle
 * map, this checkpoint's §1: connect -> [startTls] -> writer.write ->
 * writer.close -> reader.read* -> reader.releaseLock; `.opened`/`.closed`
 * are never awaited by that code today, confirmed by direct source
 * inspection, so this file doesn't start awaiting them either — only
 * attaches non-consuming `.then()/.catch()` side observers, per this
 * checkpoint's OBSERVER_EFFECT_RULE).
 */
export interface Q6BLifecycle {
  initialSocketOpenedResolved?: boolean;
  initialSocketOpenedRejected?: boolean;
  secureSocketCreated: boolean;
  secureSocketIsDistinctObject?: boolean;
  secureSocketOpenedResolved?: boolean;
  secureSocketOpenedRejected?: boolean;
  socketClosedResolvedBeforeEof?: boolean;
  socketClosedRejectedBeforeEof?: boolean;
  requestWriteResolved?: boolean;
  explicitLocalSocketCloseBeforeEof?: boolean;
  firstResponseByteObserved: boolean;
  statusLineComplete: boolean;
  headerTerminatorSeen: boolean;
  totalResponseBytesAtEof?: number;
  eofObserved: boolean;
}

export function newQ6BLifecycle(): Q6BLifecycle {
  return {
    secureSocketCreated: false,
    firstResponseByteObserved: false,
    statusLineComplete: false,
    headerTerminatorSeen: false,
    eofObserved: false,
  };
}

const Q6B_CR = 13;
const Q6B_LF = 10;

function q6bFindCrlf(buf: Uint8Array): number {
  for (let i = 0; i + 1 < buf.length; i++) {
    if (buf[i] === Q6B_CR && buf[i + 1] === Q6B_LF) return i;
  }
  return -1;
}

function q6bFindCrlfCrlf(buf: Uint8Array): number {
  for (let i = 0; i + 3 < buf.length; i++) {
    if (buf[i] === Q6B_CR && buf[i + 1] === Q6B_LF && buf[i + 2] === Q6B_CR && buf[i + 3] === Q6B_LF) return i;
  }
  return -1;
}

/**
 * A manual pass-through `ReadableStream`: every `pull()` performs exactly
 * the one `await realReader.read()` the real consumer
 * (`socket-http-client.ts`'s `readResponse`/`readChunkedBody`) would
 * itself perform, and forwards `{done, value}` unchanged — never buffers,
 * withholds, or reorders a chunk the real stream didn't produce, so
 * `PARSER_STATE_MACHINE_IDENTICAL` and `AWAITED_OPERATION_SEQUENCE_IDENTICAL`
 * both hold. Records only byte-count/CRLF-position facts, never header or
 * body content.
 */
function wrapReadableForDiagnostics(
  readable: ReadableStream<Uint8Array>,
  lifecycle: Q6BLifecycle
): ReadableStream<Uint8Array> {
  const realReader = readable.getReader();
  let running = new Uint8Array(0);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await realReader.read();
      if (done) {
        lifecycle.eofObserved = true;
        lifecycle.totalResponseBytesAtEof = running.length;
        controller.close();
        return;
      }
      if (value.length > 0) lifecycle.firstResponseByteObserved = true;
      const merged = new Uint8Array(running.length + value.length);
      merged.set(running, 0);
      merged.set(value, running.length);
      running = merged;
      if (!lifecycle.statusLineComplete && q6bFindCrlf(running) !== -1) lifecycle.statusLineComplete = true;
      if (!lifecycle.headerTerminatorSeen && q6bFindCrlfCrlf(running) !== -1) lifecycle.headerTerminatorSeen = true;
      controller.enqueue(value);
    },
    cancel(reason) {
      return realReader.cancel(reason);
    },
  });
}

/**
 * A manual pass-through `WritableStream`: `write()`/`close()` forward to
 * the real writer and are awaited at exactly the point
 * `socket-http-client.ts`'s `writeRequest` already awaits them — this only
 * records success AFTER that same await settles, never adding a new one.
 */
function wrapWritableForDiagnostics(
  writable: WritableStream<Uint8Array>,
  lifecycle: Q6BLifecycle
): WritableStream<Uint8Array> {
  const realWriter = writable.getWriter();
  return new WritableStream<Uint8Array>({
    async write(chunk) {
      await realWriter.write(chunk);
      lifecycle.requestWriteResolved = true;
    },
    async close() {
      await realWriter.close();
      lifecycle.explicitLocalSocketCloseBeforeEof = !lifecycle.eofObserved;
    },
    async abort(reason) {
      await realWriter.abort(reason);
    },
  });
}

/**
 * SUN-1221E5Q6B's STARTTLS DISCIPLINE: `readable`/`writable` are LAZY
 * getters, only constructing (and therefore only calling
 * `.getReader()`/`.getWriter()` on) the real stream at the exact moment
 * real code accesses them — for the pre-TLS `'initial'` socket in the
 * `https:` path that is NEVER (`SafeSocketHttpClient.fetch()` goes
 * straight from `connect()` to `.startTls()`, confirmed by direct source
 * inspection, never touching the pre-TLS socket's streams at all), so no
 * new interaction with the pre-TLS socket is introduced. `startTls()`
 * itself always returns the REAL secure socket's own distinct wrapper —
 * never reuses the pre-TLS socket's streams for secure I/O.
 */
export function wrapSocketForDiagnostics(
  socket: SocketLike,
  label: 'initial' | 'secure',
  lifecycle: Q6BLifecycle
): SocketLike {
  // Non-gating, non-consuming side-effect observers only — `.then()`
  // returns a NEW derived promise; `socket.opened`/`socket.closed`
  // themselves are handed back completely unconsumed below, exactly as
  // `SafeSocketHttpClient` would see the real, unwrapped socket (it never
  // reads either property today).
  socket.opened.then(
    () => {
      if (label === 'initial') lifecycle.initialSocketOpenedResolved = true;
      else lifecycle.secureSocketOpenedResolved = true;
    },
    () => {
      if (label === 'initial') lifecycle.initialSocketOpenedRejected = true;
      else lifecycle.secureSocketOpenedRejected = true;
    }
  );
  socket.closed.then(
    () => {
      if (!lifecycle.eofObserved) lifecycle.socketClosedResolvedBeforeEof = true;
    },
    () => {
      if (!lifecycle.eofObserved) lifecycle.socketClosedRejectedBeforeEof = true;
    }
  );

  let wrappedReadable: ReadableStream<Uint8Array> | undefined;
  let wrappedWritable: WritableStream<Uint8Array> | undefined;

  return {
    get readable(): ReadableStream<Uint8Array> {
      if (!wrappedReadable) wrappedReadable = wrapReadableForDiagnostics(socket.readable, lifecycle);
      return wrappedReadable;
    },
    get writable(): WritableStream<Uint8Array> {
      if (!wrappedWritable) wrappedWritable = wrapWritableForDiagnostics(socket.writable, lifecycle);
      return wrappedWritable;
    },
    opened: socket.opened,
    closed: socket.closed,
    close: () => socket.close(),
    startTls: (options) => {
      const secure = socket.startTls(options);
      lifecycle.secureSocketCreated = true;
      lifecycle.secureSocketIsDistinctObject = secure !== socket;
      return wrapSocketForDiagnostics(secure, 'secure', lifecycle);
    },
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

  const lifecycle = newQ6BLifecycle();
  const wrappedConnect = wrapConnectForDiagnostics(trace, lifecycle, realCloudflareConnect);
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
    // SUN-1221E5Q6B — socket/stream lifecycle facts. Byte counts and
    // CRLF-position booleans only, never header/body content itself; see
    // `wrapSocketForDiagnostics`/`wrapReadableForDiagnostics`.
    socket_lifecycle: {
      initial_socket_opened_resolved: lifecycle.initialSocketOpenedResolved ?? false,
      initial_socket_opened_rejected: lifecycle.initialSocketOpenedRejected ?? false,
      secure_socket_created: lifecycle.secureSocketCreated,
      secure_socket_is_distinct_object: lifecycle.secureSocketIsDistinctObject ?? false,
      secure_socket_opened_resolved: lifecycle.secureSocketOpenedResolved ?? false,
      secure_socket_opened_rejected: lifecycle.secureSocketOpenedRejected ?? false,
      socket_closed_resolved_before_eof: lifecycle.socketClosedResolvedBeforeEof ?? false,
      socket_closed_rejected_before_eof: lifecycle.socketClosedRejectedBeforeEof ?? false,
      request_write_resolved: lifecycle.requestWriteResolved ?? false,
      explicit_local_socket_close_before_eof: lifecycle.explicitLocalSocketCloseBeforeEof ?? false,
      remote_first_response_byte_observed: lifecycle.firstResponseByteObserved,
      remote_status_line_complete: lifecycle.statusLineComplete,
      remote_header_terminator_seen: lifecycle.headerTerminatorSeen,
      remote_total_response_bytes: lifecycle.totalResponseBytesAtEof ?? null,
      remote_eof_observed: lifecycle.eofObserved,
      header_eof_byte_class:
        lifecycle.totalResponseBytesAtEof === undefined
          ? null
          : lifecycle.totalResponseBytesAtEof === 0
            ? 'ZERO_RESPONSE_BYTES'
            : 'PARTIAL_RESPONSE_HEADERS',
    },
    note:
      'error_detail/diagnostic_reason_code/diagnostic_stage/eof_branch_id/socket_lifecycle are ' +
      'sanitized adapter-classified fields or byte-count/CRLF-position booleans (SUN-1221E2D/' +
      'E4P/E5Q6A/E5Q6B discipline) — never response body/headers/credentials, never a raw ' +
      'adapter error-message passthrough. SUN-1221E5Q5: previously always undefined on failure ' +
      '(extraction-path defect fixed this checkpoint, dev-diagnostic-seam-only, see SUN-1221E5Q5 ' +
      'report). This route never touches payment orchestration, settlement, or receipt ' +
      'persistence; it signs only an in-memory diagnostic self-check.',
  });
});

/**
 * SUN-1221E5Q6B — ONE optional reference control, spent only because the
 * pre-fix evidence (`ZERO_RESPONSE_BYTES`, `request_write_resolved=true`,
 * `explicit_local_socket_close_before_eof=true`,
 * `socket_closed_resolved_before_eof=true`, 6ms elapsed — far faster than
 * a genuine round trip to `example.com`) all point at exactly ONE
 * discriminating causal hypothesis: `socket-http-client.ts`'s
 * `connect(..., { allowHalfOpen: false })` (line 112) coupled with its
 * unconditional `await writer.close()` BEFORE any read begins
 * (`writeRequest`, awaited in full before `readResponse` starts) tears
 * down the readable side of the connection before the remote response has
 * any chance to arrive — i.e. this client's own write-close, not the
 * remote peer, produces the "premature EOF".
 *
 * Isolates exactly that ONE variable — `allowHalfOpen: true` instead of
 * `false` — against the real Cloudflare network, keeping every other
 * variable IDENTICAL to `SafeSocketHttpClient.fetch()`'s real sequence:
 * same `secureTransport: 'starttls'` mode, same startTls call, same
 * write-then-close-before-read ordering, same fixed target, same request
 * text shape. Hand-rolled here (never through `SafeSocketHttpClient` or
 * any shared production module) specifically so this ONE variable can be
 * changed without touching, forking, or fixing any shared production
 * code — this route makes NO repository defect claim and NO fix; it only
 * answers whether flipping this one flag changes the observed outcome.
 * Discards the response body entirely; returns only byte counts and
 * booleans, gated behind the same `DIAGNOSTIC_SEAM_ENABLED` var, same
 * non-reachability-by-construction as every other diagnostic route in
 * this file. Bounded read loop (defense against an unexpected hang, not
 * expected to matter for this bounded, fixed, tiny target page).
 */
app.get('/__diag/webctx-remote-control', async (c) => {
  if (c.env?.DIAGNOSTIC_SEAM_ENABLED !== 'true') {
    return c.notFound();
  }

  const startedAtMs = Date.now();
  const CRLF = '\r\n';
  const CR = 13;
  const LF = 10;
  const findCrlfCrlf = (buf: Uint8Array): number => {
    for (let i = 0; i + 3 < buf.length; i++) {
      if (buf[i] === CR && buf[i + 1] === LF && buf[i + 2] === CR && buf[i + 3] === LF) return i;
    }
    return -1;
  };

  let socket = realCloudflareConnect(
    { hostname: 'example.com', port: 443 },
    // The ONE variable under test: `true` here vs. `false` in
    // socket-http-client.ts:112. Everything else below mirrors that
    // file's real sequence exactly.
    { secureTransport: 'starttls', allowHalfOpen: true }
  );
  socket = socket.startTls({ expectedServerHostname: 'example.com' });

  const writer = socket.writable.getWriter();
  const requestText =
    `GET / HTTP/1.1${CRLF}host: example.com${CRLF}connection: close${CRLF}` +
    `accept-encoding: identity${CRLF}${CRLF}`;
  await writer.write(new TextEncoder().encode(requestText));
  // Same close-before-read ordering as production's real writeRequest —
  // the ONLY thing this control changes is allowHalfOpen above.
  await writer.close();

  const reader = socket.readable.getReader();
  let running = new Uint8Array(0);
  let firstByteObserved = false;
  let headerTerminatorSeen = false;
  let eofObserved = false;
  for (let i = 0; i < 64; i++) {
    const { done, value } = await reader.read();
    if (done) {
      eofObserved = true;
      break;
    }
    if (value.length > 0) firstByteObserved = true;
    const merged = new Uint8Array(running.length + value.length);
    merged.set(running, 0);
    merged.set(value, running.length);
    running = merged;
    if (findCrlfCrlf(running) !== -1) {
      headerTerminatorSeen = true;
      break;
    }
  }
  reader.releaseLock();

  return c.json({
    diagnostic: 'SUN-1221E5Q6B webctx-remote-diagnostic-control',
    note:
      'ONE variable changed vs. the real SafeSocketHttpClient sequence: allowHalfOpen=true ' +
      'instead of false (socket-http-client.ts:112). Write-then-close-before-read ordering, ' +
      'request text, and target are otherwise identical. Makes no repository defect claim and ' +
      'no fix by itself — a single discriminating data point. Response body is discarded, never ' +
      'returned; only byte counts/booleans are. Never touches payment orchestration, settlement, ' +
      'or receipt persistence.',
    total_response_bytes: running.length,
    first_response_byte_observed: firstByteObserved,
    header_terminator_seen: headerTerminatorSeen,
    eof_observed: eofObserved,
    elapsed_ms: Date.now() - startedAtMs,
  });
});

export default app;
