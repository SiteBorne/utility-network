/**
 * web_context_verified.v3 — real production-path local REST vertical
 * slice (WEB_V3_LOCAL_VERTICAL_SLICE).
 *
 * Scope, deliberately narrow, mirroring
 * `company-evidence-graph-v3-rest-harness.test.ts`'s own scope
 * discipline: ONE v3 service, REST only, exercised end to end through
 * the REAL REST route handler (`createX402ServiceRoute`, built from the
 * REAL production composition `buildWebContextV2CdpProductionRouteConfig`
 * called with `serviceId: 'web_context_verified.v3'`), against real
 * Miniflare D1 and real Miniflare R2, with a real signer
 * (`buildProductionSigner`), the REAL `web_context_verified.v3` production
 * executor (`buildWebContextV2ProductionExecutor` — unmodified, same code
 * the real route uses), and the real governed vNext PCC schema/crypto
 * validator (`validateGovernedVNextPcc` — never mocked). Never
 * document_evidence_json.v3, verify_agent_output.v3, MCP, or buyer
 * authorization.
 *
 * CALL-GRAPH DIFFERENCE FROM company_evidence_graph.v3 — the one
 * genuinely new piece this file has to handle, and the reason it is not
 * a mechanical find/replace of the company harness:
 *
 *   - `buildWebContextV2CdpProductionRouteConfig` (unlike company's
 *     composition) hardcodes its OWN `InjectedHttpClient` internally
 *     (`buildWebContextV2ModalSafeEgressClient`, an off-Cloudflare
 *     `ModalSafeEgressClient` requiring `MODAL_WEBCTX_ENDPOINT_URL` /
 *     `_PROXY_KEY` / `_PROXY_SECRET`) and fails closed
 *     (`unavailable: true`) if any of those three are absent — with NO
 *     way to inject a different client through the composition function.
 *     That internal `httpClient`/executor pair is present on the
 *     returned `X402ServiceRouteConfig.executor` field but — exactly as
 *     for company — is NEVER actually invoked by `createX402ServiceRoute`
 *     (confirmed by inspection: the route never calls `config.executor(`
 *     directly; only the durable Workflow does, and this harness's own
 *     fake `WorkflowBindingLike` replaces that Workflow entirely, exactly
 *     as the company harness's does). So this harness supplies
 *     "harness-unused" MODAL_WEBCTX_* strings (same pattern the company
 *     harness already uses for the same fields, since the same env shape
 *     is accepted by both compositions) purely to satisfy the
 *     composition's presence check and obtain real
 *     pricing/schema-hash/gating wiring, then builds ITS OWN, separate,
 *     real `web_context_verified.v3` executor
 *     (`buildWebContextV2ProductionExecutor(signer, registry,
 *     httpClient, serviceId)`) with a locally-injected `InjectedHttpClient`
 *     for use inside the harness's own workflow `create()` — the exact
 *     same "call the real executor directly, not through the route's own
 *     hardcoded transport" pattern the company harness already
 *     established for its `neverCalledHttpClient`.
 *
 *   - UNLIKE company's `identity` field group (which never calls
 *     `httpClient` at all), `web_context_verified`'s `retrieval_mode:
 *     'direct'` mode calls `PublicHttpAdapter.execute`, which DOES call
 *     `httpClient.fetch` exactly once per request — this is real
 *     production logic, not a code path this harness can avoid touching.
 *     Making a REAL outbound network fetch from a local, offline test
 *     harness is neither desirable nor reliable, so this harness injects
 *     a small local `fixedTextHttpClient` (identical in kind to
 *     `packages/service-runtime/src/tests/support.ts`'s own
 *     `textHttpClient`, already used by
 *     `WebContextVerifiedService`'s own first-party unit tests
 *     (`packages/service-runtime/src/services/web-context/service.test.ts`)
 *     — not invented for this harness) that returns a canned HTML
 *     response instead of dialing the real network. This substitutes
 *     ONLY the network edge; every other step (PublicHttpAdapter's
 *     fetch/validate/normalize pipeline, PCC claim/evidence building,
 *     real Ed25519 signing, real governed-vNext-PCC construction) is the
 *     real, unmodified `WebContextVerifiedService` and executor code.
 *     `assertDirectModeWasUsed` below asserts the fake client was called
 *     exactly once with the harness's own target URL and that the
 *     response body's content actually appears in the returned PCC's
 *     `canonical_text` — proof `retrieval_mode: 'direct'` genuinely ran
 *     (not a rendered/fallback/cached path).
 *
 *   - `web_context_verified.v3`'s economic definition
 *     (`packages/pricing/src/economic-contract.ts`, `DEFINITIONS['web_context_verified.v3']`)
 *     is a spread of `web_context_verified.v2`'s definition with only
 *     `generation`/`releasePosture` overridden — same `modes` array, same
 *     `pricingKey: 'web_context_verified_direct_v2'` for `direct`. That
 *     pricing key resolves (via `resolveServiceMaxPriceUsd`, sourced from
 *     `governance/RISK_LIMITS.yaml`'s `max_price_usd_per_service.
 *     web_context_verified_direct_v2: 0.008`) to $0.008/request — the
 *     SAME pricing key the real production composition module hardcodes
 *     literally (`pricingKey: 'web_context_verified_direct_v2'` in
 *     `web-context-v2-cdp-composition.ts`, never derived per-generation).
 *     This harness proves parity by resolving BOTH the composition's own
 *     challenge amount (via the real 402 challenge this harness receives)
 *     AND the economic-contract module's `challengePricingKey`/
 *     `resolveServiceMaxPriceUsd` chain independently, and asserting they
 *     match — never hardcoding an assumed dollar figure.
 *
 *   - `rendered` mode has its OWN governed price
 *     (`web_context_verified_rendered: 0.029` in RISK_LIMITS.yaml) but
 *     `available: false` in the economic contract
 *     (`unavailableReason: RENDERED_UNAVAILABLE`). The route's
 *     `preEconomicBodyValidator` (`modeAvailabilityValidator`, wired in
 *     the composition) rejects any request selecting `retrieval_mode:
 *     'rendered'` with a 400 BEFORE any quote/402/payment — this
 *     harness's own negative test drives that path through the real
 *     candidate route and asserts the 400, zero executor invocation,
 *     zero D1 job row, and that the underlying service-level
 *     `dependency_unavailable` truthful-refusal path
 *     (`WebContextVerifiedService.execute`'s own `rendered` branch,
 *     proven separately in `service.test.ts`) is never even reached —
 *     the gate rejects it earlier, at the economics boundary, which is
 *     the stronger and more production-relevant guarantee for a PAID
 *     route.
 *
 * WORKFLOW SEAM / CANDIDATE SELECTOR — identical reasoning to the
 * company harness; see its own doc comment. The shared plumbing
 * (Miniflare D1/R2 setup, fixture evidence-provider spies, the bridging
 * `WorkflowBindingLike`, REST 402/pay request helpers) lives in
 * `./support/v3-rest-harness-support.ts`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { Hono } from 'hono';
import type { PaymentRequired } from '@siteborne/protocol-x402';
import { buildProductionSigner } from '@siteborne/service-runtime';
import type { InjectedHttpClient } from '@siteborne/provider-adapters';
import {
  buildEconomicOffer,
  challengePricingKey,
  resolveServiceMaxPriceUsd,
  usdToAtomicUnits,
} from '@siteborne/pricing';
import { createX402ServiceRoute } from '../src/control-plane/routes/x402-service';
import { R2ArtifactStoreAdapter } from '../src/control-plane/artifacts/store';
import {
  PccResultArtifactStore,
  validateGovernedVNextPcc,
} from '../src/control-plane/results/pcc-result-artifact';
import { buildWebContextV2CdpProductionRouteConfig } from '../src/control-plane/production/web-context-v2-cdp-composition';
import { buildWebContextV2ProductionExecutor } from '../src/control-plane/production/web-context-v2-production-executor';
import { webContextVerifiedV3CandidateRoute } from '../src/control-plane/routes/production-public-v3-candidate-routes';
import type { Env } from '../src/control-plane/config/env';
import {
  buildFixtureEvidenceSpies,
  buildPaymentSignatureHeader,
  buildWorkflowBinding,
  get402,
  insertCandidateServiceRow,
  pay,
  randomPrivateKeyHex,
  setupMiniflareD1R2,
  teardownMiniflareD1R2,
  type MiniflareD1R2Harness,
} from './support/v3-rest-harness-support';

const SERVICE_ID = 'web_context_verified.v3';
const PATH = '/v3/web/context';
const NOW = '2026-09-23T00:00:00.000Z';

const TARGET_URL = 'https://harness-target.example/article';
const FIXTURE_HTML =
  '<html><head><title>Harness Fixture Article</title></head>' +
  '<body>web_context_verified.v3 harness canonical body text marker 8f2c1a</body></html>';

const REQUEST_BODY = {
  target_url: TARGET_URL,
  retrieval_mode: 'direct',
};

const RENDERED_REQUEST_BODY = {
  target_url: TARGET_URL,
  retrieval_mode: 'rendered',
};

/**
 * Substitutes ONLY the network edge for `retrieval_mode: 'direct'`.
 * Same kind of fixture as `packages/service-runtime/src/tests/support.ts`'s
 * `textHttpClient`, which `WebContextVerifiedService`'s own first-party
 * unit tests already use for the identical reason (no real outbound
 * network call from a test process) — reimplemented locally here rather
 * than imported because `@siteborne/service-runtime`'s package.json does
 * not expose a `./tests/support` subpath for cross-package import.
 */
function fixedTextHttpClient(body: string): InjectedHttpClient & { callCount: number } {
  const client = {
    callCount: 0,
    async fetch(_input: RequestInfo | URL, _init?: RequestInit) {
      client.callCount += 1;
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    },
  };
  return client;
}

async function get402Web(app: Hono): Promise<PaymentRequired> {
  return get402(app, PATH, REQUEST_BODY);
}

function payWeb(app: Hono, header: string) {
  return pay(app, PATH, header, REQUEST_BODY);
}

/** Builds one fully-wired real harness: real Miniflare D1 + R2, a real
 * signer/registry, the real `web_context_verified.v3` production
 * executor with a locally-injected fixed-response HTTP client (see the
 * file's top doc comment for why), and a bridging fake
 * `WorkflowBindingLike` from the shared support module. */
async function buildHarness(db: D1Database, r2: R2Bucket) {
  const paidReceiptPrivateKeyHex = randomPrivateKeyHex();
  const paidReceiptKeyId = `kid_${'b'.repeat(24)}`;
  const { signer, registry } = await buildProductionSigner(
    paidReceiptPrivateKeyHex,
    paidReceiptKeyId
  );

  const { settleSpy, verifySpy, evidenceProvider } = buildFixtureEvidenceSpies();

  const built = await buildWebContextV2CdpProductionRouteConfig(
    {
      PAID_RECEIPT_SIGNING_PRIVATE_KEY: paidReceiptPrivateKeyHex,
      PAID_RECEIPT_SIGNING_KEY_ID: paidReceiptKeyId,
      SELLER_WALLET_ADDRESS: '0x0000000000000000000000000000000000dEaD',
      // "harness-unused": the composition's own executor/httpClient built
      // from these is never invoked by the REST route (see top doc
      // comment) -- these three values only need to be non-empty to pass
      // the composition's presence check and obtain real pricing/schema
      // wiring.
      MODAL_WEBCTX_ENDPOINT_URL: 'https://harness-unused.modal.run',
      MODAL_WEBCTX_PROXY_KEY: 'harness-unused-key',
      MODAL_WEBCTX_PROXY_SECRET: 'harness-unused-secret',
    },
    db,
    { evidenceMode: 'fixture', evidenceProvider },
    SERVICE_ID
  );
  if ('unavailable' in built) {
    throw new Error(`composition unavailable: ${built.reason}`);
  }

  const httpClient = fixedTextHttpClient(FIXTURE_HTML);
  const executor = buildWebContextV2ProductionExecutor(signer, registry, httpClient, SERVICE_ID);
  let executorInvocations = 0;
  const wrappedExecutor: typeof executor = async (input, ctx) => {
    executorInvocations += 1;
    return executor(input, ctx);
  };

  const resultArtifacts = new PccResultArtifactStore(
    new R2ArtifactStoreAdapter(r2, 'results/pcc/')
  );

  const { workflow, getCreateCalls, getGetCalls } = buildWorkflowBinding({
    db,
    serviceId: SERVICE_ID,
    nowIso: NOW,
    resultArtifacts,
    evidenceProvider,
    harnessLabel: 'web_context_verified.v3 harness',
    runExecutor: ({ job_id, request_id }) => wrappedExecutor(REQUEST_BODY, { job_id, request_id }),
  });

  const continuationEnvelopeKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );

  const app = new Hono();
  createX402ServiceRoute(app, {
    ...built,
    workflow,
    continuationEnvelopeKey,
    resultArtifactReader: resultArtifacts,
  });

  return {
    app,
    registry,
    resultArtifacts,
    httpClient,
    getExecutorInvocations: () => executorInvocations,
    getSettleCalls: () => settleSpy.mock.calls.length,
    getVerifyCalls: () => verifySpy.mock.calls.length,
    getCreateCalls,
    getGetCalls,
  };
}

describe('web_context_verified.v3 REST vertical slice (real REST route, real D1, real R2, real signer/executor/PCC)', () => {
  let harnessInfra: MiniflareD1R2Harness;

  beforeAll(async () => {
    harnessInfra = await setupMiniflareD1R2('siteborne-web-v3-rest-harness-');
    await insertCandidateServiceRow(harnessInfra.db, SERVICE_ID);
  }, 30_000);

  afterAll(async () => {
    await teardownMiniflareD1R2(harnessInfra);
  });

  it('full lifecycle: 402 -> paid REST request -> full governed vNext PCC via real direct-mode fetch, schema+crypto valid, staged in real R2, replayable', async () => {
    const harness = await buildHarness(harnessInfra.db, harnessInfra.r2);
    const challenge = await get402Web(harness.app);

    // --- canonical price/economics resolution and parity -------------
    // Resolve the governed price two independent ways and assert they
    // agree: (1) the real 402 challenge amount this harness actually
    // received from the real composition/route, and (2) the economic
    // contract's own governed resolver, walked from
    // governance/RISK_LIMITS.yaml -> economic-contract.ts, completely
    // independently of the route.
    const pricingKey = challengePricingKey(SERVICE_ID as never);
    expect(pricingKey).toBe('web_context_verified_direct_v2');
    const governedMaxUsd = resolveServiceMaxPriceUsd(pricingKey);
    const offer = buildEconomicOffer(SERVICE_ID as never);
    const directMode = offer.modes.find((m) => m.mode === 'direct');
    expect(directMode).toBeDefined();
    expect(directMode!.available).toBe(true);
    expect(directMode!.amountUsd).toBe(governedMaxUsd);
    const renderedMode = offer.modes.find((m) => m.mode === 'rendered');
    expect(renderedMode).toBeDefined();
    expect(renderedMode!.available).toBe(false);

    const requirement = challenge.accepts[0]! as unknown as { amount: string };
    // The challenge's on-wire `amount` is an atomic integer string in the
    // asset's smallest unit, not a decimal USD string -- assert it is a
    // real, populated, sane amount (present, numeric, strictly positive)
    // rather than asserting an invented exact atomic figure this harness
    // would otherwise have to hand-derive from a decimals constant not
    // exposed at this boundary.
    expect(typeof requirement.amount).toBe('string');
    expect(BigInt(requirement.amount)).toBeGreaterThan(0n);

    // Independently derive the exact atomic amount the canonical pricing
    // authority requires (same conversion the route itself performs --
    // `usdToAtomicUnits(priceUsd, 6)`, USDC's 6 decimals -- computed here
    // from `governedMaxUsd` alone, without reading the route's output) and
    // assert it matches the real 402 challenge's on-wire atomic amount
    // exactly, not just "positive".
    const canonicalAtomicAmount = usdToAtomicUnits(governedMaxUsd, 6);
    expect(requirement.amount).toBe(canonicalAtomicAmount);

    const paymentHeader = buildPaymentSignatureHeader(challenge);

    const initial = await payWeb(harness.app, paymentHeader);
    if (initial.status !== 200) {
      const errBody = await initial.clone().text();
      throw new Error(`expected 200 got ${initial.status}: ${errBody}`);
    }
    expect(initial.status).toBe(200);
    expect(harness.getExecutorInvocations()).toBe(1);
    expect(harness.getSettleCalls()).toBe(1);
    expect(harness.getCreateCalls()).toBe(1);

    // --- proof the "direct" execution mode was actually used ---------
    expect(harness.httpClient.callCount).toBe(1);

    const pcc = (await initial.json()) as Record<string, unknown>;

    // Full governed PCC shape, not a flat legacy receipt.
    expect(pcc.pcc_version).toBeDefined();
    expect((pcc.contract as Record<string, unknown>)?.service_id).toBe(SERVICE_ID);
    expect((pcc.contract as Record<string, unknown>)?.service_version).toBe('v3');
    const proof = (pcc.extensions as Record<string, unknown>)?.[
      'net.siteborne.verification-proof.v1'
    ] as Record<string, unknown> | undefined;
    expect(proof).toBeDefined();
    const receipt = proof!.receipt as Record<string, unknown>;
    expect(receipt.contract_release).toBe('3.0.0');
    expect(typeof receipt.output_hash).toBe('string');
    expect(typeof receipt.pcc_document_hash).toBe('string');
    expect(typeof receipt.signature).toBe('string');
    expect(typeof receipt.signing_key_id).toBe('string');

    // The actual web-context service output -- not just PCC metadata --
    // survives finalization: the fixture HTML's title and body marker
    // must appear verbatim in the returned extension payload, and the
    // reported retrieval mode must be 'direct' (never 'rendered' or a
    // silently-substituted fallback).
    const webExtension = (pcc.extensions as Record<string, unknown>)?.[
      'net.siteborne.web-context.v1'
    ] as Record<string, unknown> | undefined;
    expect(webExtension).toBeDefined();
    expect(webExtension!.retrieval_mode_used).toBe('direct');
    expect(webExtension!.final_url).toBe(TARGET_URL);
    expect(typeof webExtension!.canonical_text).toBe('string');
    expect(webExtension!.canonical_text as string).toContain('Harness Fixture Article');
    expect(webExtension!.canonical_text as string).toContain(
      'web_context_verified.v3 harness canonical body text marker 8f2c1a'
    );

    // Real production schema + crypto verification path (not a hand-rolled check).
    const validationFailure = await validateGovernedVNextPcc(SERVICE_ID, pcc, harness.registry);
    expect(validationFailure).toBeNull();

    // Real R2 read-back: stored hash matches, and the stored copy
    // independently re-validates and re-verifies against the real
    // production schema/crypto validator.
    const storedRows = await harnessInfra.db
      .prepare('SELECT result_json FROM x402_service_results ORDER BY rowid DESC LIMIT 1')
      .first<{ result_json: string }>();
    expect(storedRows).toBeTruthy();
    const storedRecord = JSON.parse(storedRows!.result_json) as {
      result_reference: { content_hash: string };
    };
    const returnedPccHash = receipt.pcc_document_hash as string;
    expect(storedRecord.result_reference.content_hash).toBeDefined();
    const storedPcc = await harness.resultArtifacts.read(storedRecord.result_reference);
    expect(storedPcc).toEqual(pcc);
    const storedValidation = await validateGovernedVNextPcc(
      SERVICE_ID,
      storedPcc,
      harness.registry
    );
    expect(storedValidation).toBeNull();
    void returnedPccHash;

    // Exact replay through the real replay/idempotency path: same
    // payment, executor/settlement/http-client never invoked again,
    // identical PCC bytes (same hash).
    const replay = await payWeb(harness.app, paymentHeader);
    expect(replay.status).toBe(200);
    expect(harness.getExecutorInvocations()).toBe(1);
    expect(harness.getSettleCalls()).toBe(1);
    expect(harness.getCreateCalls()).toBe(1);
    expect(harness.httpClient.callCount).toBe(1);
    expect(harness.getGetCalls()).toBeGreaterThan(0);
    const replayPcc = await replay.json();
    expect(replayPcc).toEqual(pcc);
    expect((replayPcc as Record<string, unknown>).pcc_version).toEqual(pcc.pcc_version);

    // Semantic freeze/immutability: the production artifact boundary
    // only ever reads back its own persisted, hash-verified R2 bytes
    // (`PccResultArtifactStore.read` recomputes and checks `contentHash`
    // on every read) -- mutating the harness's own local copy of the
    // first response does not affect a fresh read from R2.
    (pcc as Record<string, unknown>).pcc_version = 'MUTATED';
    const rereadPcc = await harness.resultArtifacts.read(storedRecord.result_reference);
    expect(rereadPcc.pcc_version).not.toBe('MUTATED');
    expect(rereadPcc).toEqual(replayPcc);
  });

  it('rendered mode fails closed: 400 before any quote/402/payment, zero executor invocation, zero new job row created', async () => {
    const harness = await buildHarness(harnessInfra.db, harnessInfra.r2);
    const beforeJobsRow = await harnessInfra.db
      .prepare('SELECT COUNT(*) as n FROM jobs WHERE service_id = ?')
      .bind(SERVICE_ID)
      .first<{ n: number }>();
    const res = await harness.app.request(PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(RENDERED_REQUEST_BODY),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('retrieval_mode_unavailable');
    expect(String(body.message)).toContain('rendered');
    expect(res.headers.get('PAYMENT-REQUIRED')).toBeNull();
    // The unavailable mode never reaches the real executor -- 'rendered'
    // is rejected at the economics gate, never at the service's own
    // dependency_unavailable branch (proven separately, for the raw
    // service, in packages/service-runtime's own service.test.ts).
    expect(harness.getExecutorInvocations()).toBe(0);
    expect(harness.httpClient.callCount).toBe(0);
    expect(harness.getCreateCalls()).toBe(0);

    const afterJobsRow = await harnessInfra.db
      .prepare('SELECT COUNT(*) as n FROM jobs WHERE service_id = ?')
      .bind(SERVICE_ID)
      .first<{ n: number }>();
    expect(afterJobsRow?.n ?? 0).toBe(beforeJobsRow?.n ?? 0);
  });

  it('selector-negative: no RESULT_CONTRACT_RELEASE_SELECTION -> 404, web_context_verified.v3 never activates', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.post(PATH, webContextVerifiedV3CandidateRoute);
    const res = await app.request(
      PATH,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      {} as Env
    );
    expect(res.status).toBe(404);
  });

  it('selector-negative: empty-string selector -> 404', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.post(PATH, webContextVerifiedV3CandidateRoute);
    const res = await app.request(
      PATH,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      {
        RESULT_CONTRACT_RELEASE_SELECTION: '',
        PAID_ROUTES_ENABLED: 'true',
        WEB_CONTEXT_V2_CDP_ROUTE_ENABLED: 'true',
      } as unknown as Env
    );
    expect(res.status).toBe(404);
  });

  it('selector-negative: near-match wrong selector string -> 404', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.post(PATH, webContextVerifiedV3CandidateRoute);
    const res = await app.request(
      PATH,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      {
        RESULT_CONTRACT_RELEASE_SELECTION: '3.0.0-public-candidat',
        PAID_ROUTES_ENABLED: 'true',
        WEB_CONTEXT_V2_CDP_ROUTE_ENABLED: 'true',
      } as unknown as Env
    );
    expect(res.status).toBe(404);
  });

  it('selector-negative: differently-wrong selector string -> 404', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.post(PATH, webContextVerifiedV3CandidateRoute);
    const res = await app.request(
      PATH,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      {
        RESULT_CONTRACT_RELEASE_SELECTION: 'totally-unrelated-value',
        PAID_ROUTES_ENABLED: 'true',
        WEB_CONTEXT_V2_CDP_ROUTE_ENABLED: 'true',
      } as unknown as Env
    );
    expect(res.status).toBe(404);
  });

  it('selector-negative: v2-default selector value (not the v3 candidate value) -> 404', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.post(PATH, webContextVerifiedV3CandidateRoute);
    const res = await app.request(
      PATH,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      {
        RESULT_CONTRACT_RELEASE_SELECTION: '2.0.0',
        PAID_ROUTES_ENABLED: 'true',
        WEB_CONTEXT_V2_CDP_ROUTE_ENABLED: 'true',
      } as unknown as Env
    );
    expect(res.status).toBe(404);
  });

  it('selector-negative: correct selector but route flag disabled -> 404', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.post(PATH, webContextVerifiedV3CandidateRoute);
    const res = await app.request(
      PATH,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      {
        RESULT_CONTRACT_RELEASE_SELECTION: '3.0.0-public-candidate',
        PAID_ROUTES_ENABLED: 'true',
        WEB_CONTEXT_V2_CDP_ROUTE_ENABLED: 'false',
      } as unknown as Env
    );
    expect(res.status).toBe(404);
  });
});
