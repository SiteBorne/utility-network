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
import { generateTestKeypair, KeyRegistry, type Signer } from '@siteborne/verification';
import {
  buildServiceContext,
  DEFAULT_SERVICE_BUDGET,
  executeLocalService,
  ServiceRegistry,
  WebContextVerifiedService,
  type ServiceAuditEventSink,
} from '@siteborne/service-runtime';
import { PublicHttpAdapter } from '@siteborne/provider-adapters';
import type { ArtifactStore, AuditEventSink, InjectedClock } from '@siteborne/provider-adapters';
import { buildWebContextV2SafeHttpClient } from '../control-plane/production/web-context-v2-cdp-composition';

/** The one and only diagnostic target for this seam — a source-level
 * constant, never accepted from the request (no query string, body,
 * header, or redirect override). SUN-1221E5Q "Target rule". The executor
 * may still follow redirects, but only per its normal production
 * SSRF/revalidation behavior — nothing about that path is touched here. */
const FIXED_DIAGNOSTIC_TARGET = 'https://example.com/';

/** `^kid_[a-z0-9]{24}$` (see `production-signer.ts`) — an unmistakably
 * diagnostic id within that required charset; not a production key id and
 * never will collide with one (`buildProductionSigner`'s real ids are
 * provisioned key material, never this literal string). */
const DIAGNOSTIC_KEY_ID = 'kid_diagnosticwebctxe5qnonpr';

interface DiagnosticEnv {
  DIAGNOSTIC_SEAM_ENABLED?: string;
}

function realClock(): InjectedClock {
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

function unreachableArtifactStore(): ArtifactStore {
  const fail = (method: string) => (): never => {
    throw new Error(`unreachable_artifact_store: diagnostic seam never persists artifacts (${method})`);
  };
  return { put: fail('put'), getMetadata: fail('getMetadata'), getContent: fail('getContent'), exists: fail('exists') };
}

function discardedAuditSink(): AuditEventSink {
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

function requestScopedAuditSink(): ServiceAuditEventSink {
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
async function buildEphemeralDiagnosticSigner(): Promise<{ signer: Signer; registry: KeyRegistry }> {
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

const app = new Hono<{ Bindings: DiagnosticEnv }>();

app.get('/__diag/webctx-remote', async (c) => {
  if (c.env?.DIAGNOSTIC_SEAM_ENABLED !== 'true') {
    return c.notFound();
  }

  const startedAtMs = Date.now();
  const httpClient = buildWebContextV2SafeHttpClient();
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

  let outcome: { resultClass: string; errorCode?: string; errorMessage?: string };
  try {
    const executed = await executeLocalService(
      registry,
      'web_context_verified.v2',
      { target_url: FIXED_DIAGNOSTIC_TARGET, retrieval_mode: 'direct' },
      context
    );
    const output = executed.output as { limitations?: string[] } | undefined;
    outcome = {
      resultClass: executed.result_class,
      errorMessage: output?.limitations?.[0],
    };
  } catch (err) {
    outcome = {
      resultClass: 'threw',
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }

  const elapsedMs = Date.now() - startedAtMs;

  return c.json({
    diagnostic: 'SUN-1221E5Q webctx-remote-diagnostic',
    target: FIXED_DIAGNOSTIC_TARGET,
    result_class: outcome.resultClass,
    error_detail: outcome.errorMessage,
    elapsed_ms: elapsedMs,
    note:
      'error_detail is the sanitized adapter-classified message (SUN-1221E2D/E4P discipline) — ' +
      'never response body/headers/credentials. This route never touches payment orchestration, ' +
      'settlement, or receipt persistence; it signs only an in-memory diagnostic self-check.',
  });
});

export default app;
