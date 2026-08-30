/**
 * SUN-1221E5Q5 §8/§9 — local, deterministic proof for the exact
 * `webctx-remote-diagnostic.ts` construction pattern (ephemeral
 * `DIAGNOSTIC_KEY_ID` signer, `unreachableArtifactStore`,
 * `requestScopedAuditSink`/`discardedAuditSink`, `execution_mode: 'live'`),
 * wired against a FAKE `InjectedHttpClient` instead of `SafeSocketHttpClient`
 * -- no real socket, no DNS, no `wrangler dev`, no Cloudflare network.
 *
 * Two things this proves that no pre-existing test in this repository
 * proved:
 *
 * 1. DIAGNOSTIC_CONTEXT_LOCAL_SUCCESS — the diagnostic seam's OWN specific
 *    wiring (not just "some" ephemeral signer, but the literal
 *    `buildEphemeralDiagnosticSigner`/`DIAGNOSTIC_KEY_ID` construction the
 *    route handler uses) reaches a genuine, cryptographically-verified
 *    `result_class: 'success'` when the underlying fetch succeeds.
 *
 * 2. The RED/GREEN pair for the SUN-1221E5Q5 extraction-path defect: the
 *    previous route handler read `executed.output?.limitations?.[0]`,
 *    which is structurally undefined on every failure (`output` is only
 *    ever populated on `result_class: 'success'`,
 *    packages/service-runtime/src/services/web-context/service.ts:242-245).
 *    The real diagnostic detail was always on the sibling top-level
 *    `limitations` array and on `failure.details.diagnostic_reason_code`/
 *    `diagnostic_stage`. This test asserts directly against those fields
 *    using the diagnostic seam's own construction, so a regression back to
 *    the `output.limitations` extraction would leave this test's readable
 *    assertions describing a codepath that no longer matches the route.
 */
import { describe, expect, it } from 'vitest';
import { PublicHttpAdapter } from '@siteborne/provider-adapters';
import {
  buildServiceContext,
  DEFAULT_SERVICE_BUDGET,
  executeLocalService,
  ServiceRegistry,
  verifyServiceReceipt,
  WebContextVerifiedService,
} from '@siteborne/service-runtime';
import {
  buildEphemeralDiagnosticSigner,
  discardedAuditSink,
  FIXED_DIAGNOSTIC_TARGET,
  realClock,
  requestScopedAuditSink,
  unreachableArtifactStore,
} from './webctx-remote-diagnostic';

function fakeSuccessHttpClient(html: string) {
  let calls = 0;
  return {
    async fetch() {
      calls++;
      return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
    },
    get callCount() {
      return calls;
    },
  };
}

function fakeFailingHttpClient(message: string) {
  return {
    async fetch(): Promise<Response> {
      throw new Error(message);
    },
  };
}

/** Mirrors `webctx-remote-diagnostic.ts`'s `/__diag/webctx-remote` handler
 * construction exactly, swapping only the injected `httpClient` for a fake
 * (no `SafeSocketHttpClient`, no real `connect`, no DoH). */
async function runDiagnosticConstructionLocally(httpClient: {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}) {
  const clock = realClock();
  const { signer, registry: keyRegistry } = await buildEphemeralDiagnosticSigner();

  const context = buildServiceContext('web_context_verified.v2', {
    job_id: 'sun-1221e5q5-construction-test',
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

  const result = await executeLocalService(
    registry,
    'web_context_verified.v2',
    { target_url: FIXED_DIAGNOSTIC_TARGET, retrieval_mode: 'direct' },
    context
  );

  return { result, keyRegistry };
}

describe('SUN-1221E5Q5 §8 — diagnostic-seam construction, local/deterministic (no real socket)', () => {
  it('DIAGNOSTIC_CONTEXT_LOCAL_SUCCESS: the exact diagnostic wiring reaches a cryptographically-verified success', async () => {
    const httpClient = fakeSuccessHttpClient(
      '<html><head><title>Example Domain</title></head><body>fixture</body></html>'
    );
    const { result, keyRegistry } = await runDiagnosticConstructionLocally(httpClient);

    expect(result.result_class).toBe('success');
    expect(result.receipt_id).toMatch(/^rcpt_[a-f0-9]{24}$/);
    expect(httpClient.callCount).toBe(1);

    const verification = await verifyServiceReceipt({
      receipt: result.receipt!,
      keyRegistry,
      expectedServiceId: 'web_context_verified.v2',
      expectedOutputHash: result.output_hash,
    });
    expect(verification.valid).toBe(true);
  });

  it('SUN-1221E5Q5 §9 RED/GREEN: on failure, diagnostic detail lives at top-level `limitations` / `failure.details`, never at `output.limitations`', async () => {
    const httpClient = fakeFailingHttpClient(
      'DNS resolution failed safety policy: prohibited_or_mixed_dns_answer'
    );
    const { result } = await runDiagnosticConstructionLocally(httpClient);

    expect(result.result_class).toBe('internal_verification_failed');

    // The defect this checkpoint fixed: `output` is undefined on every
    // failure path, so a handler reading `output?.limitations?.[0]` (the
    // OLD webctx-remote-diagnostic.ts code) always got `undefined` here.
    expect(result.output).toBeUndefined();

    // The real diagnostic detail was always available at these two
    // locations — exactly what the FIXED route handler now reads.
    expect(result.limitations[0]).toContain('direct-public-http returned');
    expect(result.failure?.details).toMatchObject({
      diagnostic_reason_code: 'WEBCTX_DNS_RESOLUTION_FAILED',
      diagnostic_stage: 'direct_public_http_fetch',
    });

    // `verifyAndSign` still ran unconditionally (service.ts calls it
    // outside the success/failure branch) — a receipt/verification block
    // is real, direct proof this execution reached that stage, distinct
    // from dispatcher.ts's closedFailure wrapper (unknown_service /
    // execution_timeout / internal_error), which never sets either field.
    expect(result.receipt_id).toBeDefined();
    expect(result.verification).toBeDefined();
  });

  it('a dispatcher-level wrapper failure (unknown service) is structurally distinguishable: no receipt_id, no verification', async () => {
    const clock = realClock();
    const context = buildServiceContext('web_context_verified.v2', {
      job_id: 'sun-1221e5q5-construction-test-unknown-service',
      request_id: crypto.randomUUID(),
      clock,
      artifact_store: unreachableArtifactStore(),
      audit: requestScopedAuditSink(),
      budget: DEFAULT_SERVICE_BUDGET,
      execution_mode: 'live',
    });
    const emptyRegistry = new ServiceRegistry();

    const result = await executeLocalService(
      emptyRegistry,
      'web_context_verified.v2',
      { target_url: FIXED_DIAGNOSTIC_TARGET, retrieval_mode: 'direct' },
      context
    );

    expect(result.result_class).toBe('rejected');
    expect(result.receipt_id).toBeUndefined();
    expect(result.verification).toBeUndefined();
  });
});
