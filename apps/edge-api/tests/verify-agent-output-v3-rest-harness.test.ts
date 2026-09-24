/**
 * verify_agent_output.v3 — real production-path local REST vertical slice
 * (VERIFY_AGENT_OUTPUT_V3_LOCAL_VERTICAL_SLICE).
 *
 * Follows the same pattern as `company-evidence-graph-v3-rest-harness.test.ts`,
 * `web-context-verified-v3-rest-harness.test.ts`, and
 * `document-evidence-json-v3-rest-harness.test.ts`: real Miniflare D1 + R2, a
 * real signer (`buildProductionSigner`), the REAL `verify_agent_output.v3`
 * production executor (`buildVerifyAgentOutputV2ProductionExecutor` —
 * unmodified, same code the real route uses), and the real governed vNext
 * PCC schema/crypto validator (`validateGovernedVNextPcc` — never mocked).
 *
 * BUYER-AUTHORIZED, like document_evidence_json.v3 (`governedResultConfidentiality`
 * in `../src/control-plane/security/result-authorization.ts` maps
 * `verify_agent_output.v3` to `BUYER_AUTHORIZED`): this harness drives the
 * REAL production authentication seam end to end — `authenticateResultPrincipal`
 * / `createOidcPrincipalVerifier` performing a genuine RS256 JWT signature
 * verification against a locally generated RSA keypair — never a
 * hand-fabricated `owner_subject_ref`/`ResultSubjectBindingV1` injected
 * directly into persistence. No network call is made (the OIDC "issuer" is a
 * local, in-process configuration array; the verifier is handed keys
 * directly, it never fetches JWKS over HTTP), but every byte of JWT
 * parsing, claim validation, and RSA-SHA256 signature verification is the
 * real production code path.
 *
 * SCHEME: unlike `document_evidence_json.v3` (`scheme: 'upto'`, measured
 * usage-based settlement), `verify_agent_output.v3` is `scheme: 'exact'`
 * (see `buildVerifyAgentOutputV2CdpProductionRouteConfig`,
 * `pricingKey: 'verify_agent_output_standard_v2'`) — fixed-amount
 * settlement, the same shape company/web already prove. This harness's own
 * local `WorkflowBindingLike` mirrors the shared `buildWorkflowBinding`
 * helper's 'exact'-scheme logic (not reused verbatim because this file also
 * needs the buyer-authorization subject-binding-durability instrumentation
 * `document-evidence-json-v3-rest-harness.test.ts` added, which the shared
 * helper does not have), settling the QUOTED `amount_atomic` exactly, with
 * no worker/document seam at all: `VerifyAgentOutputService.execute` is a
 * pure, synchronous, in-process computation over `verification_contract` /
 * `candidate_output` / `required_schema` — it never touches
 * `context.artifact_store` (the production executor's own
 * `unreachableArtifactStore()` throws on any call, structurally proving
 * this), so this harness needs no R2 input-artifact staging, no injected
 * HTTP client, and no document-worker bridge fixture.
 *
 * PASS vs NON-PASS OUTCOME: `VerifyAgentOutputService.execute` computes
 * `outcome` ('pass' | 'fail' | 'conditional') and `score` from the mesh
 * verdict plus per-claim / per-deterministic-requirement evaluation (see
 * `packages/service-runtime/src/services/agent-verification/service.ts`'s
 * `finalizeSemantics`). This harness drives BOTH a PASS case (candidate
 * output that satisfies every claim/requirement — mirrors the existing
 * `verify-agent-output-v2-production-executor.test.ts` fixture input
 * exactly) and a governed NON-PASS case (candidate output that fails one
 * `equals` claim while still matching `required_schema`, producing
 * `outcome: 'conditional'`, `result_class: 'partial'` — the mesh still
 * reaches a deterministic verdict and the executor still produces a fully
 * signed, released governed PCC; it is not an execution error) — proving
 * both `score` AND `outcome` are present in the signed PCC extension, not a
 * flat field bolted on afterward.
 *
 * Two separate harness instances are built against the SAME shared
 * Miniflare D1/R2 (one per REQUEST_BODY / outcome), each with its own Hono
 * app/signer/workflow binding — mirroring how every other v3 harness in
 * this repository ties one fixed REQUEST_BODY to one app instance; jobs are
 * looked up by `payment_identifier`, which is independent per app/payment,
 * so both can safely share one underlying D1 database and R2 bucket.
 */
import { generateKeyPairSync, sign as signRs256, type KeyObject } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { PaymentRequired } from '@siteborne/protocol-x402';
import { buildProductionSigner } from '@siteborne/service-runtime';
import { resolveServiceMaxPriceUsd, usdToAtomicUnits } from '@siteborne/pricing';
import { createX402ServiceRoute } from '../src/control-plane/routes/x402-service';
import { R2ArtifactStoreAdapter } from '../src/control-plane/artifacts/store';
import {
  PccResultArtifactStore,
  validateGovernedVNextPcc,
} from '../src/control-plane/results/pcc-result-artifact';
import { buildVerifyAgentOutputV2CdpProductionRouteConfig } from '../src/control-plane/production/verify-agent-output-v2-cdp-composition';
import { buildVerifyAgentOutputV2ProductionExecutor } from '../src/control-plane/production/verify-agent-output-v2-production-executor';
import { verifyAgentOutputV3CandidateRoute } from '../src/control-plane/routes/production-public-v3-candidate-routes';
import { D1ResultAuthorizationRepository } from '../src/control-plane/repositories/d1/result-authorization';
import { buildResultAuthorizationRuntime } from '../src/control-plane/security/request-principal';
import { consumeVerifiedPrincipal } from '../src/control-plane/security/verified-principal-context';
import { X402ServiceResultRepository } from '../src/control-plane/repositories/d1/x402-quotes';
import type {
  WorkflowBindingLike,
  WorkflowInstanceLike,
} from '../src/control-plane/continuation/handoff';
import type { Env } from '../src/control-plane/config/env';
import {
  buildFixtureEvidenceSpies,
  buildPaymentSignatureHeader,
  insertCandidateServiceRow,
  randomPrivateKeyHex,
  setupMiniflareD1R2,
  teardownMiniflareD1R2,
  type MiniflareD1R2Harness,
} from './support/v3-rest-harness-support';

const SERVICE_ID = 'verify_agent_output.v3';
const PATH = '/v3/verify/agent-output';
const NOW = '2026-09-23T00:00:00.000Z';

// PASS request body — identical shape/content to the existing
// `verify-agent-output-v2-production-executor.test.ts`'s own `TEST_INPUT`,
// which that file independently proves resolves to `outcome: 'pass'`.
const PASS_REQUEST_BODY = {
  verification_contract: {
    claims: [{ claim_id: 'total', predicate: 'equals', expected_value: 42 }],
    deterministic_requirements: [{ requirement_id: 'schema_check', check: 'schema_valid' }],
  },
  candidate_output: { total: 42 },
  required_schema: {
    type: 'object',
    properties: { total: { type: 'number' } },
    required: ['total'],
  },
  verification_mode: 'standard',
};

// Governed NON-PASS request body: `candidate_output.total` (41) fails the
// `equals: 42` claim while still structurally satisfying `required_schema`
// (schema_valid passes) — the mesh still reaches a deterministic decision,
// so this is `outcome: 'conditional'` / `result_class: 'partial'`, not an
// execution error.
const NONPASS_REQUEST_BODY = {
  verification_contract: {
    claims: [{ claim_id: 'total', predicate: 'equals', expected_value: 42 }],
    deterministic_requirements: [{ requirement_id: 'schema_check', check: 'schema_valid' }],
  },
  candidate_output: { total: 41 },
  required_schema: {
    type: 'object',
    properties: { total: { type: 'number' } },
    required: ['total'],
  },
  verification_mode: 'standard',
};

// ---------------------------------------------------------------------
// Real OIDC RS256 principal verification material (SUBJECT_A / SUBJECT_B)
// — identical pattern to document-evidence-json-v3-rest-harness.test.ts.
// ---------------------------------------------------------------------

const OIDC_ISSUER = 'https://identity.siteborne.test';
const OIDC_AUDIENCE = 'siteborne-utility-network';
const OIDC_KID = 'harness-oidc-kid-1';

function base64url(input: Buffer): string {
  return input.toString('base64url');
}

function buildRsaKeyMaterial() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' }) as JsonWebKeyLike;
  return { privateKey, jwk };
}

interface JsonWebKeyLike {
  kty: string;
  n: string;
  e: string;
}

function signRs256Jwt(privateKey: KeyObject, claims: Record<string, unknown>): string {
  const header = { alg: 'RS256', typ: 'JWT', kid: OIDC_KID };
  const encodedHeader = base64url(Buffer.from(JSON.stringify(header)));
  const encodedClaims = base64url(Buffer.from(JSON.stringify(claims)));
  const signingInput = `${encodedHeader}.${encodedClaims}`;
  const signature = signRs256(null, Buffer.from(signingInput), { key: privateKey });
  return `${signingInput}.${base64url(signature)}`;
}

async function get402Verify(app: Hono, body: unknown, authorization: string) {
  const res = await app.request(PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: authorization },
    body: JSON.stringify(body),
  });
  if (res.status !== 402) {
    const errBody = await res.clone().text();
    throw new Error(`expected 402 got ${res.status}: ${errBody}`);
  }
  const { decodePaymentRequiredHeaderSafe } = await import('@siteborne/protocol-x402');
  const decoded = decodePaymentRequiredHeaderSafe(res.headers.get('PAYMENT-REQUIRED')!);
  if (!decoded.ok) throw new Error('failed to decode PAYMENT-REQUIRED header');
  return decoded.value as PaymentRequired;
}

function payVerify(
  app: Hono,
  body: unknown,
  header: string | null,
  authorization: string | null,
  extraHeaders: Record<string, string> = {}
) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...extraHeaders,
  };
  if (header) headers['PAYMENT-SIGNATURE'] = header;
  if (authorization) headers.Authorization = authorization;
  return app.request(PATH, { method: 'POST', headers, body: JSON.stringify(body) });
}

class CompletedInstance implements WorkflowInstanceLike {
  constructor(
    readonly id: string,
    private readonly output: unknown
  ) {}
  async status() {
    return { status: 'complete' as const, output: this.output };
  }
}

interface OidcRuntimeMaterial {
  runtime: NonNullable<ReturnType<typeof buildResultAuthorizationRuntime>>;
  SUBJECT_A_AUTH: string;
  SUBJECT_B_AUTH: string;
  refA: string;
  refB: string;
  nowSeconds: number;
  privateKey: KeyObject;
}

async function buildOidcRuntimeMaterial(): Promise<OidcRuntimeMaterial> {
  const { privateKey, jwk } = buildRsaKeyMaterial();
  const oidcIssuerConfig = {
    issuer: OIDC_ISSUER,
    audience: OIDC_AUDIENCE,
    allowed_algorithms: ['RS256'] as const,
    keys: [{ ...jwk, kid: OIDC_KID, alg: 'RS256' as const, use: 'sig' as const }],
    subject_type: 'human' as const,
    assurance_level: 'verified_single_factor' as const,
  };
  const subjectReferenceKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  const runtime = buildResultAuthorizationRuntime({
    RESULT_AUTH_OIDC_ISSUERS_JSON: JSON.stringify([oidcIssuerConfig]),
    RESULT_SUBJECT_REFERENCE_KEY: Buffer.from(subjectReferenceKeyBytes).toString('base64url'),
    RESULT_SUBJECT_REFERENCE_KEY_VERSION: 'k1',
  });
  if (!runtime) throw new Error('unreachable: runtime should build from valid config');

  const nowSeconds = Math.floor(Date.now() / 1000);
  function bearerFor(subjectId: string): string {
    return `Bearer ${signRs256Jwt(privateKey, {
      iss: OIDC_ISSUER,
      aud: OIDC_AUDIENCE,
      sub: subjectId,
      iat: nowSeconds - 5,
      exp: nowSeconds + 3600,
    })}`;
  }
  const SUBJECT_A_AUTH = bearerFor('buyer-owner-a');
  const SUBJECT_B_AUTH = bearerFor('buyer-attacker-b');

  const principalA = await runtime.authenticate(
    new Request('https://harness.test/', { headers: { Authorization: SUBJECT_A_AUTH } })
  );
  const principalB = await runtime.authenticate(
    new Request('https://harness.test/', { headers: { Authorization: SUBJECT_B_AUTH } })
  );
  expect(principalA?.verification_status).toBe('VERIFIED');
  expect(principalB?.verification_status).toBe('VERIFIED');
  expect(principalA?.subject.subject_id).toBe('buyer-owner-a');
  expect(principalB?.subject.subject_id).toBe('buyer-attacker-b');
  const { canonicalSubjectReference } = await import(
    '../src/control-plane/security/result-authorization'
  );
  const refA = canonicalSubjectReference(principalA!.subject, runtime.subjectReferenceKey);
  const refB = canonicalSubjectReference(principalB!.subject, runtime.subjectReferenceKey);
  expect(refA).not.toBe(refB);

  return { runtime, SUBJECT_A_AUTH, SUBJECT_B_AUTH, refA, refB, nowSeconds, privateKey };
}

interface VerifyHarness {
  app: Hono;
  registry: Awaited<ReturnType<typeof buildProductionSigner>>['registry'];
  resultArtifacts: PccResultArtifactStore;
  resultAuthorizationRepo: D1ResultAuthorizationRepository;
  getExecutorInvocations: () => number;
  getSettleCalls: () => number;
  getVerifyCalls: () => number;
  getCreateCalls: () => number;
  wasBindingObservedBeforeExecutor: () => boolean | null;
}

/** Builds one fully-wired real harness (real signer, real production
 * composition + executor, a buyer-authorization-instrumented fake
 * `WorkflowBindingLike`) bound to one fixed REQUEST_BODY. */
async function buildHarness(
  db: D1Database,
  r2: R2Bucket,
  requestBody: unknown,
  oidc: OidcRuntimeMaterial,
  keySuffix: string
): Promise<VerifyHarness> {
  const paidReceiptPrivateKeyHex = randomPrivateKeyHex();
  const paidReceiptKeyId = `kid_${keySuffix.repeat(24)}`;
  const { signer, registry } = await buildProductionSigner(
    paidReceiptPrivateKeyHex,
    paidReceiptKeyId
  );

  const { settleSpy, verifySpy, evidenceProvider } = buildFixtureEvidenceSpies();

  const built = await buildVerifyAgentOutputV2CdpProductionRouteConfig(
    {
      PAID_RECEIPT_SIGNING_PRIVATE_KEY: paidReceiptPrivateKeyHex,
      PAID_RECEIPT_SIGNING_KEY_ID: paidReceiptKeyId,
      SELLER_WALLET_ADDRESS: '0x0000000000000000000000000000000000dEaD',
    },
    db,
    { evidenceMode: 'fixture', evidenceProvider },
    SERVICE_ID
  );
  if ('unavailable' in built) {
    throw new Error(`composition unavailable: ${built.reason}`);
  }

  const executor = buildVerifyAgentOutputV2ProductionExecutor(signer, registry, SERVICE_ID);
  let executorInvocations = 0;
  const wrappedExecutor: typeof executor = async (input, ctx) => {
    executorInvocations += 1;
    return executor(input, ctx);
  };

  const resultArtifacts = new PccResultArtifactStore(
    new R2ArtifactStoreAdapter(r2, `results/pcc/${keySuffix}/`)
  );
  const resultAuthorizationRepo = new D1ResultAuthorizationRepository(db);

  const instances = new Map<string, CompletedInstance>();
  const createCalls: string[] = [];
  let bindingObservedBeforeExecutor: boolean | null = null;

  const workflow: WorkflowBindingLike = {
    async create({ id, params }) {
      try {
        return await createImpl({ id, params });
      } catch (err) {
        console.error('verify-agent-output harness: workflow.create() failed:', err);
        throw err;
      }
    },
    async get(id) {
      const found = instances.get(id);
      if (!found) throw new Error(`no such Workflow instance ${id}`);
      return found;
    },
  };

  async function createImpl({
    id,
    params,
  }: {
    id: string;
    params: unknown;
  }): Promise<CompletedInstance> {
    createCalls.push(id);
    const createParams = params as {
      metadata: {
        payment_identifier: string;
        network: string;
        amount_atomic: string;
        pay_to: string;
        asset: string;
      };
      request_id: string;
    };
    const jobRow = await db
      .prepare('SELECT id FROM jobs WHERE idempotency_key = ?')
      .bind(createParams.metadata.payment_identifier)
      .first<{ id: string }>();
    if (!jobRow) throw new Error('verify-agent-output harness: job row missing for payment');
    const jobId = jobRow.id;

    // Prove the subject binding is durable in D1 BEFORE the executor is
    // ever invoked -- instrumenting the real admission path
    // (`acquireBuyerAuthorizedOperation`, which x402-service.ts calls
    // before `createOrJoinPaidContinuation`/`workflow.create` ever run).
    const bindingBefore = await resultAuthorizationRepo.getSubjectBindingByOperation(jobId);
    bindingObservedBeforeExecutor = bindingBefore !== null;
    if (!bindingBefore) {
      throw new Error(
        'verify-agent-output harness: result_subject_bindings row missing before executor invocation'
      );
    }

    const outcome = await wrappedExecutor(requestBody, {
      job_id: jobId,
      request_id: createParams.request_id,
    });
    // Both 'success' (PASS) and 'partial' (governed non-PASS, still a
    // real, released, finalized governed verdict -- not an execution
    // error) produce a real signed PCC. Any other result_class is a
    // genuine execution failure this harness does not expect.
    if (outcome.result.result_class !== 'success' && outcome.result.result_class !== 'partial') {
      throw new Error(
        `verify-agent-output harness: unexpected result_class (${outcome.result.result_class}): ` +
          JSON.stringify(outcome.result)
      );
    }
    const representation = outcome.resultRepresentation;
    if (!representation || !('body' in representation)) {
      throw new Error('verify-agent-output harness: no vNext PCC body on executor outcome');
    }

    const reference = await resultArtifacts.stage({
      jobId,
      serviceId: SERVICE_ID,
      pcc: representation.body,
      createdAt: NOW,
    });

    const verificationEvidence = await evidenceProvider.verify({
      x402Version: 2,
      scheme: 'exact',
      network: createParams.metadata.network as never,
      paymentPayload: {
        x402Version: 2,
        scheme: 'exact',
        network: createParams.metadata.network,
        payload: {},
      } as never,
      paymentRequirements: {
        scheme: 'exact',
        network: createParams.metadata.network,
        maxAmountRequired: createParams.metadata.amount_atomic,
        resource: 'https://harness.test/resource',
        payTo: createParams.metadata.pay_to,
        asset: createParams.metadata.asset,
      } as never,
      quoteId: 'quote_harness',
      requirementId: 'requirement_harness',
      paymentIdentifier: createParams.metadata.payment_identifier,
    });
    const settlement = await evidenceProvider.settle(
      {
        service_id: SERVICE_ID as never,
        service_version: 'v3',
        scheme: 'exact',
        network: createParams.metadata.network as never,
        asset: createParams.metadata.asset,
        payee: createParams.metadata.pay_to,
        quote_id: 'quote_harness',
        requirement_id: 'requirement_harness',
        payment_identifier: createParams.metadata.payment_identifier,
        amount: createParams.metadata.amount_atomic,
        nowIso: NOW,
        expiresAt: NOW,
        authorizationContext: { rail: 'cdp' },
        paymentPayload: {
          x402Version: 2,
          scheme: 'exact',
          network: createParams.metadata.network,
          payload: { authorization: {}, signature: '0x' + '11'.repeat(65) },
        } as never,
        paymentRequirements: {
          scheme: 'exact',
          network: createParams.metadata.network,
          maxAmountRequired: createParams.metadata.amount_atomic,
          resource: 'https://harness.test/resource',
          payTo: createParams.metadata.pay_to,
          asset: createParams.metadata.asset,
        } as never,
      },
      verificationEvidence,
      createParams.metadata.amount_atomic
    );

    await new X402ServiceResultRepository(db).create(
      jobId,
      createParams.metadata.payment_identifier,
      {
        status: 200,
        result_format: 'SELF_VERIFYING_PCC_VNEXT',
        result_reference: reference,
        settleResponse: {
          success: true,
          transaction: settlement.transaction_hash,
          network: createParams.metadata.network,
          amount: createParams.metadata.amount_atomic,
        },
      },
      NOW
    );
    await db
      .prepare("UPDATE jobs SET current_state = 'DELIVERED', updated_at = ? WHERE id = ?")
      .bind(NOW, jobId)
      .run();

    const instance = new CompletedInstance(id, {
      status: 'settled',
      job_id: jobId,
      receipt_id: reference.content_hash,
    });
    instances.set(id, instance);
    return instance;
  }

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
    resultAuthorization: {
      authenticate: (requestContext) =>
        Promise.resolve(consumeVerifiedPrincipal(requestContext.req.raw)).then(
          (principal) => principal ?? oidc.runtime.authenticate(requestContext.req.raw)
        ),
      subjectReferenceKey: oidc.runtime.subjectReferenceKey,
      revokedSubjectRefs: oidc.runtime.revokedSubjectRefs,
    },
  });

  return {
    app,
    registry,
    resultArtifacts,
    resultAuthorizationRepo,
    getExecutorInvocations: () => executorInvocations,
    getSettleCalls: () => settleSpy.mock.calls.length,
    getVerifyCalls: () => verifySpy.mock.calls.length,
    getCreateCalls: () => createCalls.length,
    wasBindingObservedBeforeExecutor: () => bindingObservedBeforeExecutor,
  };
}

describe('verify_agent_output.v3 REST vertical slice (real REST route, real D1, real R2, real signer/executor, real buyer authorization)', () => {
  let harnessInfra: MiniflareD1R2Harness;
  let oidc: OidcRuntimeMaterial;

  beforeAll(async () => {
    harnessInfra = await setupMiniflareD1R2('siteborne-verify-v3-rest-harness-');
    await insertCandidateServiceRow(harnessInfra.db, SERVICE_ID);
    oidc = await buildOidcRuntimeMaterial();
  }, 30_000);

  afterAll(async () => {
    await teardownMiniflareD1R2(harnessInfra);
  });

  it('canonical economics: 402 challenge amount matches governance -> economic-contract -> registry projection', async () => {
    const harness = await buildHarness(
      harnessInfra.db,
      harnessInfra.r2,
      PASS_REQUEST_BODY,
      oidc,
      'e'
    );
    const challenge = await get402Verify(harness.app, PASS_REQUEST_BODY, oidc.SUBJECT_A_AUTH);
    const requirement = challenge.accepts[0]! as unknown as {
      amount: string;
      scheme: string;
      network: string;
      asset: string;
      payTo: string;
    };
    expect(requirement.scheme).toBe('exact');
    // Derive the canonical price independently (never assumed): governance
    // RISK_LIMITS.yaml -> packages/pricing/src/service-prices.ts
    // (`resolveServiceMaxPriceUsd`) -> atomic units at 6 decimals -- the
    // exact chain `buildVerifyAgentOutputV2CdpProductionRouteConfig` itself
    // uses (`pricingKey: 'verify_agent_output_standard_v2'`).
    const canonicalUsd = resolveServiceMaxPriceUsd('verify_agent_output_standard_v2');
    const canonicalAtomic = usdToAtomicUnits(canonicalUsd, 6);
    expect(requirement.amount).toBe(canonicalAtomic);
  }, 30_000);

  it('PASS: full lifecycle + buyer-authorization matrix + replay on ONE created result', async () => {
    const db = harnessInfra.db;
    const harness = await buildHarness(db, harnessInfra.r2, PASS_REQUEST_BODY, oidc, 'a');
    const challenge = await get402Verify(harness.app, PASS_REQUEST_BODY, oidc.SUBJECT_A_AUTH);
    const paymentHeader = buildPaymentSignatureHeader(challenge);

    // ---------------------------------------------------------------
    // Initial owner (SUBJECT_A) release.
    // ---------------------------------------------------------------
    const initial = await payVerify(
      harness.app,
      PASS_REQUEST_BODY,
      paymentHeader,
      oidc.SUBJECT_A_AUTH
    );
    if (initial.status !== 200) {
      const errBody = await initial.clone().text();
      throw new Error(`expected 200 got ${initial.status}: ${errBody}`);
    }
    const initialBody = (await initial.clone().json()) as Record<string, unknown>;
    expect(initialBody.pcc_version).toBeDefined();
    expect((initialBody.contract as Record<string, unknown>)?.service_id).toBe(SERVICE_ID);

    expect(harness.wasBindingObservedBeforeExecutor()).toBe(true);
    expect(harness.getExecutorInvocations()).toBe(1);
    expect(harness.getSettleCalls()).toBe(1);
    expect(harness.getCreateCalls()).toBe(1);
    const baselineExecutorInvocations = harness.getExecutorInvocations();
    const baselineSettleCalls = harness.getSettleCalls();
    const baselineCreateCalls = harness.getCreateCalls();

    // ---------------------------------------------------------------
    // Full governed PCC: schema, crypto, output_hash, pcc_document_hash.
    // ---------------------------------------------------------------
    const storedRow = await db
      .prepare('SELECT result_json FROM x402_service_results ORDER BY rowid DESC LIMIT 1')
      .first<{ result_json: string }>();
    expect(storedRow).toBeTruthy();
    const storedRecord = JSON.parse(storedRow!.result_json) as {
      result_reference: { content_hash: string };
    };
    const pcc = await harness.resultArtifacts.read(storedRecord.result_reference);

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

    const validationFailure = await validateGovernedVNextPcc(SERVICE_ID, pcc, harness.registry);
    expect(validationFailure).toBeNull();

    // Score AND outcome both present in the signed PCC extension -- not a
    // flat field bolted on outside the governed proof.
    const agentVerificationExtension = (pcc.extensions as Record<string, unknown>)?.[
      'net.siteborne.agent-verification.v1'
    ] as Record<string, unknown> | undefined;
    expect(agentVerificationExtension).toBeDefined();
    expect(agentVerificationExtension!.outcome).toBe('pass');
    expect(typeof agentVerificationExtension!.score).toBe('number');
    expect(agentVerificationExtension!.score).toBe(1);

    // Content-addressed R2 staging: stored-vs-returned hash equality.
    const rereadPcc = await harness.resultArtifacts.read(storedRecord.result_reference);
    expect(rereadPcc).toEqual(pcc);
    const rereadValidation = await validateGovernedVNextPcc(
      SERVICE_ID,
      rereadPcc,
      harness.registry
    );
    expect(rereadValidation).toBeNull();

    // ---------------------------------------------------------------
    // Full buyer-authorization matrix against the SAME created result
    // resource.
    // ---------------------------------------------------------------
    const finalBindingRow = await db
      .prepare('SELECT owner_subject_ref FROM result_subject_bindings ORDER BY rowid DESC LIMIT 1')
      .first<{ owner_subject_ref: string }>();
    expect(finalBindingRow?.owner_subject_ref).toBe(oidc.refA);

    // wrong subject: a REAL, validly-authenticated, DIFFERENT principal.
    const wrongSubject = await payVerify(
      harness.app,
      PASS_REQUEST_BODY,
      paymentHeader,
      oidc.SUBJECT_B_AUTH
    );
    expect(wrongSubject.status).toBe(404);
    expect(await wrongSubject.clone().json()).toEqual({ error: 'result_not_available' });

    // unauthenticated: no Authorization header at all.
    const unauthenticated = await payVerify(harness.app, PASS_REQUEST_BODY, paymentHeader, null);
    expect(unauthenticated.status).toBe(401);
    expect(await unauthenticated.clone().json()).toEqual({ error: 'authentication_required' });

    // payer-only: real, already-consumed PAYMENT-SIGNATURE but a
    // syntactically broken bearer value (no valid identity proof at all).
    const payerOnly = await payVerify(
      harness.app,
      PASS_REQUEST_BODY,
      paymentHeader,
      'Bearer not-a-jwt'
    );
    expect(payerOnly.status).toBe(401);
    expect(await payerOnly.clone().json()).toEqual({ error: 'authentication_required' });

    // tuple-only (no proof): well-formed claim shape, signed by a
    // DIFFERENT, unregistered RSA key -- fails real RS256 signature
    // verification against the registered OIDC issuer key.
    const { privateKey: unregisteredKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const forgedBearer = `Bearer ${signRs256Jwt(unregisteredKey, {
      iss: OIDC_ISSUER,
      aud: OIDC_AUDIENCE,
      sub: 'buyer-owner-a',
      iat: oidc.nowSeconds - 5,
      exp: oidc.nowSeconds + 3600,
    })}`;
    const tupleOnly = await payVerify(harness.app, PASS_REQUEST_BODY, paymentHeader, forgedBearer);
    expect(tupleOnly.status).toBe(401);
    expect(await tupleOnly.clone().json()).toEqual({ error: 'authentication_required' });

    // arbitrary/spoofed headers: no Authorization header, but headers that
    // WOULD claim ownership if the route ever read them directly.
    const spoofed = await payVerify(harness.app, PASS_REQUEST_BODY, paymentHeader, null, {
      'X-Subject-Ref': oidc.refA,
      'X-Owner-Subject': 'buyer-owner-a',
      'X-Verified-Principal': 'true',
    });
    expect(spoofed.status).toBe(401);
    expect(await spoofed.clone().json()).toEqual({ error: 'authentication_required' });

    // No existence oracle: every denial above returns the same
    // `result_not_available` 404 shape (or 401 when authentication itself
    // never succeeded) -- neither reveals whether the underlying resource
    // exists.
    expect(wrongSubject.status).toBe(404);

    // ---------------------------------------------------------------
    // Replay: authorized replay returns identical PCC hash with zero
    // additional executor/settlement invocations; wrong-owner replay
    // denied.
    // ---------------------------------------------------------------
    const replay = await payVerify(
      harness.app,
      PASS_REQUEST_BODY,
      paymentHeader,
      oidc.SUBJECT_A_AUTH
    );
    expect(replay.status).toBe(200);
    expect(await replay.clone().json()).toEqual(initialBody);

    const wrongSubjectReplay = await payVerify(
      harness.app,
      PASS_REQUEST_BODY,
      paymentHeader,
      oidc.SUBJECT_B_AUTH
    );
    expect(wrongSubjectReplay.status).toBe(404);
    const unauthenticatedReplay = await payVerify(
      harness.app,
      PASS_REQUEST_BODY,
      paymentHeader,
      null
    );
    expect(unauthenticatedReplay.status).toBe(401);

    expect(harness.getExecutorInvocations()).toBe(baselineExecutorInvocations);
    expect(harness.getSettleCalls()).toBe(baselineSettleCalls);
    expect(harness.getCreateCalls()).toBe(baselineCreateCalls);
  }, 30_000);

  it('governed NON-PASS: candidate output failing a claim still produces a fully signed, released governed PCC (outcome != pass)', async () => {
    const db = harnessInfra.db;
    const harness = await buildHarness(db, harnessInfra.r2, NONPASS_REQUEST_BODY, oidc, 'b');
    const challenge = await get402Verify(harness.app, NONPASS_REQUEST_BODY, oidc.SUBJECT_A_AUTH);
    const paymentHeader = buildPaymentSignatureHeader(challenge);

    const initial = await payVerify(
      harness.app,
      NONPASS_REQUEST_BODY,
      paymentHeader,
      oidc.SUBJECT_A_AUTH
    );
    if (initial.status !== 200) {
      const errBody = await initial.clone().text();
      throw new Error(`expected 200 got ${initial.status}: ${errBody}`);
    }
    expect(harness.wasBindingObservedBeforeExecutor()).toBe(true);
    expect(harness.getExecutorInvocations()).toBe(1);

    const storedRow = await db
      .prepare('SELECT result_json FROM x402_service_results ORDER BY rowid DESC LIMIT 1')
      .first<{ result_json: string }>();
    const storedRecord = JSON.parse(storedRow!.result_json) as {
      result_reference: { content_hash: string };
    };
    const pcc = await harness.resultArtifacts.read(storedRecord.result_reference);

    const validationFailure = await validateGovernedVNextPcc(SERVICE_ID, pcc, harness.registry);
    expect(validationFailure).toBeNull();

    const proof = (pcc.extensions as Record<string, unknown>)?.[
      'net.siteborne.verification-proof.v1'
    ] as Record<string, unknown> | undefined;
    expect(proof).toBeDefined();
    const receipt = proof!.receipt as Record<string, unknown>;
    expect(typeof receipt.pcc_document_hash).toBe('string');
    expect(typeof receipt.signature).toBe('string');

    const agentVerificationExtension = (pcc.extensions as Record<string, unknown>)?.[
      'net.siteborne.agent-verification.v1'
    ] as Record<string, unknown> | undefined;
    expect(agentVerificationExtension).toBeDefined();
    expect(agentVerificationExtension!.outcome).not.toBe('pass');
    expect(['fail', 'conditional']).toContain(agentVerificationExtension!.outcome);
    expect(typeof agentVerificationExtension!.score).toBe('number');
    expect(agentVerificationExtension!.score).toBeLessThan(1);
    expect(agentVerificationExtension!.failed_requirements).toContain('claim:total');

    // Buyer authorization still applies identically to a non-PASS result:
    // owner can read it back, a wrong subject cannot.
    const ownerReplay = await payVerify(
      harness.app,
      NONPASS_REQUEST_BODY,
      paymentHeader,
      oidc.SUBJECT_A_AUTH
    );
    expect(ownerReplay.status).toBe(200);
    const wrongSubject = await payVerify(
      harness.app,
      NONPASS_REQUEST_BODY,
      paymentHeader,
      oidc.SUBJECT_B_AUTH
    );
    expect(wrongSubject.status).toBe(404);
    expect(harness.getExecutorInvocations()).toBe(1);
  }, 30_000);

  // -----------------------------------------------------------------
  // Selector negative matrix (mirrors company/web/document harnesses
  // exactly, including the extra BUYER_AUTHORIZED_V3_ROUTE_ENABLED flag
  // and the service-specific VERIFY_V2_CDP_ROUTE_ENABLED flag).
  // -----------------------------------------------------------------
  it('selector-negative: no RESULT_CONTRACT_RELEASE_SELECTION -> 404, verify_agent_output.v3 never activates', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.post(PATH, verifyAgentOutputV3CandidateRoute);
    const res = await app.request(
      PATH,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      {} as Env
    );
    expect(res.status).toBe(404);
  });

  it('selector-negative: empty-string selector -> 404', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.post(PATH, verifyAgentOutputV3CandidateRoute);
    const res = await app.request(
      PATH,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      {
        RESULT_CONTRACT_RELEASE_SELECTION: '',
        PAID_ROUTES_ENABLED: 'true',
        VERIFY_V2_CDP_ROUTE_ENABLED: 'true',
        BUYER_AUTHORIZED_V3_ROUTE_ENABLED: 'true',
      } as unknown as Env
    );
    expect(res.status).toBe(404);
  });

  it('selector-negative: near-match wrong selector string -> 404', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.post(PATH, verifyAgentOutputV3CandidateRoute);
    const res = await app.request(
      PATH,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      {
        RESULT_CONTRACT_RELEASE_SELECTION: '3.0.0-public-candidat',
        PAID_ROUTES_ENABLED: 'true',
        VERIFY_V2_CDP_ROUTE_ENABLED: 'true',
        BUYER_AUTHORIZED_V3_ROUTE_ENABLED: 'true',
      } as unknown as Env
    );
    expect(res.status).toBe(404);
  });

  it('selector-negative: differently-wrong selector string -> 404', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.post(PATH, verifyAgentOutputV3CandidateRoute);
    const res = await app.request(
      PATH,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      {
        RESULT_CONTRACT_RELEASE_SELECTION: 'totally-unrelated-value',
        PAID_ROUTES_ENABLED: 'true',
        VERIFY_V2_CDP_ROUTE_ENABLED: 'true',
        BUYER_AUTHORIZED_V3_ROUTE_ENABLED: 'true',
      } as unknown as Env
    );
    expect(res.status).toBe(404);
  });

  it('selector-negative: correct selector but v2 CDP route flag disabled -> 404', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.post(PATH, verifyAgentOutputV3CandidateRoute);
    const res = await app.request(
      PATH,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      {
        RESULT_CONTRACT_RELEASE_SELECTION: '3.0.0-public-candidate',
        PAID_ROUTES_ENABLED: 'true',
        VERIFY_V2_CDP_ROUTE_ENABLED: 'false',
        BUYER_AUTHORIZED_V3_ROUTE_ENABLED: 'true',
      } as unknown as Env
    );
    expect(res.status).toBe(404);
  });

  it('selector-negative: correct selector + v2 CDP flag but BUYER_AUTHORIZED_V3_ROUTE_ENABLED disabled -> 404 (v3 never activates without the explicit buyer-auth flag)', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.post(PATH, verifyAgentOutputV3CandidateRoute);
    const res = await app.request(
      PATH,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      {
        RESULT_CONTRACT_RELEASE_SELECTION: '3.0.0-public-candidate',
        PAID_ROUTES_ENABLED: 'true',
        VERIFY_V2_CDP_ROUTE_ENABLED: 'true',
        BUYER_AUTHORIZED_V3_ROUTE_ENABLED: 'false',
      } as unknown as Env
    );
    expect(res.status).toBe(404);
  });

  it('selector-negative: stale selector value (an old/retired release string) -> 404', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.post(PATH, verifyAgentOutputV3CandidateRoute);
    const res = await app.request(
      PATH,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      {
        RESULT_CONTRACT_RELEASE_SELECTION: '2.0.0-public-candidate',
        PAID_ROUTES_ENABLED: 'true',
        VERIFY_V2_CDP_ROUTE_ENABLED: 'true',
        BUYER_AUTHORIZED_V3_ROUTE_ENABLED: 'true',
      } as unknown as Env
    );
    expect(res.status).toBe(404);
  });
});
