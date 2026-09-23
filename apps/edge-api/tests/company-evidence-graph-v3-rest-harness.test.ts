/**
 * company_evidence_graph.v3 — real production-path local REST vertical
 * slice (COMPANY_V3_LOCAL_VERTICAL_SLICE).
 *
 * Scope, deliberately narrow (per this checkpoint's own authorization):
 * ONE v3 service, exercised end to end through the REAL REST route
 * handler (`createX402ServiceRoute`, built from the REAL production
 * composition `buildCompanyEvidenceGraphV2CdpProductionRouteConfig`),
 * against real Miniflare D1 and real Miniflare R2, with a real signer
 * (`buildProductionSigner`), the REAL `company_evidence_graph.v3`
 * production executor (`buildCompanyEvidenceGraphV2ProductionExecutor` —
 * unmodified, same code the real route uses), and the real governed vNext
 * PCC schema/crypto validator (`validateGovernedVNextPcc` — never
 * mocked). Never web_context_verified.v3, document_evidence_json.v3,
 * verify_agent_output.v3, MCP, or buyer authorization.
 *
 * Request shape: `requested_field_groups: ['identity']` with only
 * `company_name` supplied. `CompanyEvidenceGraphService`'s `identity`
 * field group resolves synchronously from the input alone (see
 * `packages/service-runtime/src/services/company-evidence/service.ts`)
 * and never calls `deps.httpClient` — confirmed by this file's own
 * `neverCalledHttpClient`, which throws on any invocation. This keeps the
 * executor invocation fully real (real signer, real PCC construction,
 * real schema validator, real Ed25519 signature) while making zero
 * outbound network calls (no SEC EDGAR, no Federal Register, no
 * buyer-URL fetch) — a deliberate, honest scope boundary, not a
 * fixture/mock of the executor itself.
 *
 * WORKFLOW SEAM — the one deliberately simplified piece, and the reason
 * this harness is NOT a claim that `runPaidContinuationWorkflow`'s own
 * internal CAS/settlement-repository/reconciliation machinery was
 * exercised. This file's fake `WorkflowBindingLike` (built by the shared
 * `buildWorkflowBinding` helper in `./support/v3-rest-harness-support`)
 * mirrors the existing, already-established pattern in
 * `x402-workflow-integration.test.ts` and
 * `result-authorization-real-rest-flow.test.ts`: `create()` performs one
 * real executor invocation, one real R2 PCC staging
 * (`PccResultArtifactStore.stage`), one real settlement call against
 * `FixturePaymentEvidenceProvider.settle` (spied for counting), and one
 * real D1 write of the resulting `SELF_VERIFYING_PCC_VNEXT` result
 * reference — then reports the instance `complete`. The route's own
 * dispatch/wait/translate wiring (`createOrJoinPaidContinuation`,
 * `waitForWorkflowResult`, cached-result reconstruction via
 * `reconstructFromJob`/`resolveStoredResultBody`/`validateGovernedVNextPcc`)
 * is real and is what this harness actually proves end to end.
 *
 * CANDIDATE SELECTOR — `companyEvidenceGraphV3CandidateRoute` (the real,
 * selector-gated production entry point in
 * `production-public-v3-candidate-routes.ts`) is used directly for every
 * selector-negative case (missing/empty/near-miss/wrong selector): those
 * requests 404 before the route ever resolves payment evidence, so no CDP
 * credentials are needed. The positive full-lifecycle path is driven
 * through the SAME underlying composition function
 * (`buildCompanyEvidenceGraphV2CdpProductionRouteConfig`) called directly
 * with `explicitTestEvidenceOverride: { evidenceMode: 'fixture' }` — the
 * one sanctioned test-only escape hatch that composition module exposes
 * (see its own doc comment) — because
 * `companyEvidenceGraphV3CandidateRoute` itself hardcodes `undefined` for
 * that override and therefore always requires real CDP production
 * evidence, which this local, no-live-payment session must not use. Both
 * paths share the identical composition/executor/schema-hash logic, so
 * this does not weaken the "real production path" claim for pricing,
 * schema hashes, or contract release — only for the outer selector-gate
 * wrapper's own few lines of env-flag checks, which the negative tests
 * exercise directly and for real.
 *
 * NOTE: the local D1/R2 setup, workflow/payment seam, and REST
 * request-construction plumbing this file uses live in
 * `./support/v3-rest-harness-support.ts`, shared verbatim with
 * `web-context-verified-v3-rest-harness.test.ts`. This is a mechanical
 * extraction only -- no behavior changed versus the original inline code.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { Hono } from 'hono';
import type { PaymentRequired } from '@siteborne/protocol-x402';
import { buildProductionSigner } from '@siteborne/service-runtime';
import type { InjectedHttpClient } from '@siteborne/provider-adapters';
import { createX402ServiceRoute } from '../src/control-plane/routes/x402-service';
import { R2ArtifactStoreAdapter } from '../src/control-plane/artifacts/store';
import {
  PccResultArtifactStore,
  validateGovernedVNextPcc,
} from '../src/control-plane/results/pcc-result-artifact';
import { buildCompanyEvidenceGraphV2CdpProductionRouteConfig } from '../src/control-plane/production/company-evidence-graph-v2-cdp-composition';
import { buildCompanyEvidenceGraphV2ProductionExecutor } from '../src/control-plane/production/company-evidence-graph-v2-production-executor';
import { companyEvidenceGraphV3CandidateRoute } from '../src/control-plane/routes/production-public-v3-candidate-routes';
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

const SERVICE_ID = 'company_evidence_graph.v3';
const PATH = '/v3/company/evidence-graph';
const NOW = '2026-09-23T00:00:00.000Z';

const REQUEST_BODY = {
  company_name: 'Apple Inc.',
  identifiers: { cik: '0000320193' },
  requested_field_groups: ['identity'],
};

/** Proves the executor makes zero outbound calls for an `identity`-only
 * request: any invocation throws, failing the test loudly rather than
 * silently returning canned data. */
function neverCalledHttpClient(): InjectedHttpClient {
  return {
    fetch: () => {
      throw new Error(
        'neverCalledHttpClient: company_evidence_graph.v3 with requested_field_groups=["identity"] ' +
          'must never invoke the injected HTTP client'
      );
    },
  };
}

async function get402Company(app: Hono): Promise<PaymentRequired> {
  return get402(app, PATH, REQUEST_BODY);
}

function payCompany(app: Hono, header: string) {
  return pay(app, PATH, header, REQUEST_BODY);
}

/** Builds one fully-wired real harness: real Miniflare D1 + R2, a real
 * signer/registry, the real production executor, and a bridging fake
 * `WorkflowBindingLike` (from the shared support module) whose `create()`
 * performs exactly one real executor invocation + one real R2 PCC staging
 * + one real fixture settlement call + one real D1 result write — see
 * this file's own top doc comment for why the Workflow seam is
 * simplified this way. */
async function buildHarness(db: D1Database, r2: R2Bucket) {
  // Same signing key material used both to build the composition's own
  // `pccKeyRegistry` (what the route's cached-result read path verifies
  // against) AND this harness's standalone `signer`/`registry` used to
  // build the real executor -- both must derive from the identical key so
  // a PCC this executor signs verifies against the SAME route config that
  // serves it. `buildProductionSigner` is deterministic in its key
  // material, so reusing the identical hex/keyId for both calls yields
  // equivalent signer/registry pairs.
  const paidReceiptPrivateKeyHex = randomPrivateKeyHex();
  const paidReceiptKeyId = `kid_${'a'.repeat(24)}`;
  const { signer, registry } = await buildProductionSigner(
    paidReceiptPrivateKeyHex,
    paidReceiptKeyId
  );

  const { settleSpy, verifySpy, evidenceProvider } = buildFixtureEvidenceSpies();

  const built = await buildCompanyEvidenceGraphV2CdpProductionRouteConfig(
    {
      PAID_RECEIPT_SIGNING_PRIVATE_KEY: paidReceiptPrivateKeyHex,
      PAID_RECEIPT_SIGNING_KEY_ID: paidReceiptKeyId,
      SELLER_WALLET_ADDRESS: '0x0000000000000000000000000000000000dEaD',
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

  const executor = buildCompanyEvidenceGraphV2ProductionExecutor(
    signer,
    registry,
    neverCalledHttpClient(),
    db,
    SERVICE_ID
  );
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
    harnessLabel: 'company_evidence_graph.v3 harness',
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
    getExecutorInvocations: () => executorInvocations,
    getSettleCalls: () => settleSpy.mock.calls.length,
    getVerifyCalls: () => verifySpy.mock.calls.length,
    getCreateCalls,
    getGetCalls,
  };
}

describe('company_evidence_graph.v3 REST vertical slice (real REST route, real D1, real R2, real signer/executor/PCC)', () => {
  let harnessInfra: MiniflareD1R2Harness;

  beforeAll(async () => {
    harnessInfra = await setupMiniflareD1R2('siteborne-company-v3-rest-harness-');
    await insertCandidateServiceRow(harnessInfra.db, SERVICE_ID);
  }, 30_000);

  afterAll(async () => {
    await teardownMiniflareD1R2(harnessInfra);
  });

  it('full lifecycle: 402 -> paid REST request -> full governed vNext PCC, schema+crypto valid, staged in real R2, replayable', async () => {
    const harness = await buildHarness(harnessInfra.db, harnessInfra.r2);
    const challenge = await get402Company(harness.app);
    const paymentHeader = buildPaymentSignatureHeader(challenge);

    const initial = await payCompany(harness.app, paymentHeader);
    if (initial.status !== 200) {
      const errBody = await initial.clone().text();
      throw new Error(`expected 200 got ${initial.status}: ${errBody}`);
    }
    expect(initial.status).toBe(200);
    expect(harness.getExecutorInvocations()).toBe(1);
    expect(harness.getSettleCalls()).toBe(1);
    expect(harness.getCreateCalls()).toBe(1);

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

    // Real production schema + crypto verification path (not a hand-rolled check).
    const validationFailure = await validateGovernedVNextPcc(SERVICE_ID, pcc, harness.registry);
    expect(validationFailure).toBeNull();

    // Real R2 read-back: stored hash matches, and the stored copy independently validates.
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

    // Replay: same payment, executor/settlement never invoked again, identical PCC bytes.
    const replay = await payCompany(harness.app, paymentHeader);
    expect(replay.status).toBe(200);
    expect(harness.getExecutorInvocations()).toBe(1);
    expect(harness.getSettleCalls()).toBe(1);
    expect(harness.getCreateCalls()).toBe(1);
    expect(harness.getGetCalls()).toBeGreaterThan(0);
    const replayPcc = await replay.json();
    expect(replayPcc).toEqual(pcc);

    // Immutability: the production artifact boundary only ever reads back
    // its own persisted, hash-verified R2 bytes (`PccResultArtifactStore.read`
    // recomputes and checks `contentHash` on every read — see
    // `pcc-result-artifact.ts`) — there is no mutable in-memory reference to
    // the service output reachable from this REST-entry harness (the route
    // returns a freshly-parsed JSON object per request, and R2 storage is
    // content-addressed). Mutating the harness's own local `pcc` object here
    // proves nothing new is stored, but demonstrates the read path is
    // independent of caller-side mutation: a second read from R2 is
    // unaffected by mutating the FIRST read's returned object.
    (pcc as Record<string, unknown>).pcc_version = 'MUTATED';
    const rereadPcc = await harness.resultArtifacts.read(storedRecord.result_reference);
    expect(rereadPcc.pcc_version).not.toBe('MUTATED');
    expect(rereadPcc).toEqual(replayPcc);
  });

  it('selector-negative: no RESULT_CONTRACT_RELEASE_SELECTION -> 404, company_evidence_graph.v3 never activates', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.post(PATH, companyEvidenceGraphV3CandidateRoute);
    const res = await app.request(
      PATH,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      {} as Env
    );
    expect(res.status).toBe(404);
  });

  it('selector-negative: empty-string selector -> 404', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.post(PATH, companyEvidenceGraphV3CandidateRoute);
    const res = await app.request(
      PATH,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      {
        RESULT_CONTRACT_RELEASE_SELECTION: '',
        PAID_ROUTES_ENABLED: 'true',
        COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED: 'true',
      } as unknown as Env
    );
    expect(res.status).toBe(404);
  });

  it('selector-negative: near-match wrong selector string -> 404', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.post(PATH, companyEvidenceGraphV3CandidateRoute);
    const res = await app.request(
      PATH,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      {
        RESULT_CONTRACT_RELEASE_SELECTION: '3.0.0-public-candidat',
        PAID_ROUTES_ENABLED: 'true',
        COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED: 'true',
      } as unknown as Env
    );
    expect(res.status).toBe(404);
  });

  it('selector-negative: differently-wrong selector string -> 404', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.post(PATH, companyEvidenceGraphV3CandidateRoute);
    const res = await app.request(
      PATH,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      {
        RESULT_CONTRACT_RELEASE_SELECTION: 'totally-unrelated-value',
        PAID_ROUTES_ENABLED: 'true',
        COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED: 'true',
      } as unknown as Env
    );
    expect(res.status).toBe(404);
  });

  it('selector-negative: correct selector but route flag disabled -> 404', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.post(PATH, companyEvidenceGraphV3CandidateRoute);
    const res = await app.request(
      PATH,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      {
        RESULT_CONTRACT_RELEASE_SELECTION: '3.0.0-public-candidate',
        PAID_ROUTES_ENABLED: 'true',
        COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED: 'false',
      } as unknown as Env
    );
    expect(res.status).toBe(404);
  });
});
