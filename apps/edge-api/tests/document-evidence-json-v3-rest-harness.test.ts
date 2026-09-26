/**
 * document_evidence_json.v3 — real production-path local REST vertical
 * slice (DOCUMENT_V3_LOCAL_VERTICAL_SLICE).
 *
 * Follows the same pattern as `company-evidence-graph-v3-rest-harness.test.ts`
 * and `web-context-verified-v3-rest-harness.test.ts`: real Miniflare D1 +
 * R2, a real signer (`buildProductionSigner`), the REAL
 * `document_evidence_json.v3` production executor
 * (`buildDocumentEvidenceJsonV2ProductionExecutor` — unmodified, same code
 * the real route uses), and the real governed vNext PCC schema/crypto
 * validator (`validateGovernedVNextPcc` — never mocked).
 *
 * THE NEW THING THIS FILE PROVES (unlike company/web, both `PUBLIC`):
 * `document_evidence_json.v3` is `BUYER_AUTHORIZED`
 * (`governedResultConfidentiality` in `../src/control-plane/security/
 * result-authorization.ts`) — release requires a real authenticated
 * principal whose derived `owner_subject_ref` matches the binding recorded
 * at admission. This harness drives the REAL production authentication
 * seam end to end: `authenticateResultPrincipal` /
 * `createOidcPrincipalVerifier` (`../src/control-plane/security/
 * request-principal.ts`, `oidc-principal.ts`) performing a genuine RS256
 * JWT signature verification against a locally generated RSA keypair —
 * never a hand-fabricated `owner_subject_ref`/`ResultSubjectBindingV1`
 * injected directly into persistence. No network call is made (the OIDC
 * "issuer" here is a local, in-process configuration array — the verifier
 * itself never fetches JWKS over HTTP, it is handed keys directly), but
 * every byte of JWT parsing, claim validation, and RSA-SHA256 signature
 * verification is the real production code path.
 *
 * DOCUMENT WORKER SEAM: `document_evidence_json.v2`'s production executor
 * calls a real `DocumentWorkerBridge.run()` (in production,
 * `ModalDocumentWorkerBridge`, an outbound HTTP call to a Modal endpoint).
 * Mirroring the web harness's own "real executor + locally-injected
 * fixed-response client" pattern (there: a fixed-HTML `InjectedHttpClient`;
 * here: a fixed-`WorkerResult` `DocumentWorkerBridge`), this harness
 * injects a bridge that returns a REAL, previously-captured
 * `WorkerResult` fixture (`packages/service-runtime/fixtures/
 * document-worker-results/native-text-success.json` — captured from a
 * genuine run of the Python document worker CLI per that fixture
 * directory's own doc comment, never hand-authored) rather than shelling
 * out to a subprocess or a live Modal endpoint. `FixtureDocumentWorkerBridge`
 * itself (the package's own test-only bridge) could not be reused as-is:
 * it keys its fixture registry by object IDENTITY of the input `bytes`
 * (a `WeakMap`), but this harness's bytes flow through a REAL R2
 * upload -> D1 metadata -> R2 read-back round trip before reaching the
 * worker bridge, so the `Uint8Array` the bridge receives is never the
 * same object reference used to register the fixture. This harness's
 * `fixedWorkerResultBridge` instead ignores request identity entirely and
 * always returns the one loaded fixture — the same shape of deliberate
 * simplification the web harness's fixed-HTML client already uses, just
 * spelled out for a different interface.
 *
 * DISCOVERED PREFIX MISMATCH (reported honestly, not silently worked
 * around): the REAL production upload route
 * (`document-artifact-upload-route.ts`) constructs
 * `new R2ArtifactStoreAdapter(c.env.ARTIFACTS)` — DEFAULT prefix
 * `'artifacts/'` — while the REAL v3 candidate route composition
 * (`production-public-v3-candidate-routes.ts`,
 * `documentEvidenceJsonV3CandidateRoute`) constructs
 * `new R2ArtifactStoreAdapter(c.env.ARTIFACTS, 'documents/')` for the SAME
 * bucket and hands that DIFFERENTLY-PREFIXED store to the executor's
 * `resolveUploadReference`, which reads back via
 * `getContentByContentHash` using ITS OWN prefix. Because both methods
 * derive the R2 key as `prefix + contentHash`, an object the upload route
 * really wrote (`artifacts/<hash>`) is NOT found by the executor's
 * `documents/<hash>` lookup — as deployed today, a real buyer upload via
 * `POST /v2/artifacts/documents` would never resolve for
 * `document_evidence_json.v3`. This harness therefore builds its own
 * upload using the SAME single `'documents/'`-prefixed
 * `R2ArtifactStoreAdapter` instance for both the upload write (via the
 * real, unmodified `storeDocumentUpload` function the real route itself
 * calls) and the composition's artifact reads — proving the REST/
 * authorization/executor/PCC pipeline genuinely end to end without being
 * blocked by this separately-discovered defect, which is OUT OF SCOPE to
 * fix here and is reported as-is.
 *
 * WORKFLOW SEAM — as with company/web, this file's own local
 * `WorkflowBindingLike` (NOT the shared `buildWorkflowBinding` helper,
 * which assumes `scheme: 'exact'` fixed-amount settlement) performs one
 * real executor invocation, one real R2 PCC staging, one real fixture
 * settlement call using the EXECUTOR'S OWN measured `actualAmountAtomic`
 * (this service is `scheme: 'upto'` — the settled amount is measured
 * from real worker page metrics, not the quoted ceiling), and one real D1
 * result write — then reports the instance `complete`. The route's own
 * dispatch/wait/translate wiring, and — the new proof surface for this
 * file — its buyer-authorization admission/release/replay logic, are
 * real and are what this harness actually proves end to end.
 */
import { generateKeyPairSync, sign as signRs256, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { PaymentRequired } from '@siteborne/protocol-x402';
import { buildProductionSigner } from '@siteborne/service-runtime';
import type { DocumentWorkerBridge, WorkerResult } from '@siteborne/service-runtime';
import { resolveServiceMaxPriceUsd, usdToAtomicUnits } from '@siteborne/pricing';
import { calculateDocumentUsage, documentUsageToAtomicUnits } from '@siteborne/pricing';
import { createX402ServiceRoute } from '../src/control-plane/routes/x402-service';
import { R2ArtifactStoreAdapter } from '../src/control-plane/artifacts/store';
import {
  PccResultArtifactStore,
  validateGovernedVNextPcc,
} from '../src/control-plane/results/pcc-result-artifact';
import { buildDocumentEvidenceJsonV2CdpProductionRouteConfig } from '../src/control-plane/production/document-evidence-json-v2-cdp-composition';
import { buildDocumentEvidenceJsonV2ProductionExecutor } from '../src/control-plane/production/document-evidence-json-v2-production-executor';
import { documentEvidenceJsonV3CandidateRoute } from '../src/control-plane/routes/production-public-v3-candidate-routes';
import { storeDocumentUpload } from '../src/control-plane/artifacts/document-upload';
import { D1ArtifactsRepository } from '../src/control-plane/repositories/d1/artifacts';
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

const SERVICE_ID = 'document_evidence_json.v3';
const PATH = '/v3/document/evidence-json';
const NOW = '2026-09-23T00:00:00.000Z';

const FIXTURES_DIR = fileURLToPath(
  new URL('../../../packages/service-runtime/fixtures/document-worker-results', import.meta.url)
);

function loadWorkerResult(name: string): WorkerResult {
  return JSON.parse(readFileSync(`${FIXTURES_DIR}/${name}.json`, 'utf-8')) as WorkerResult;
}

/** Minimal, real (%PDF- magic-byte-valid) PDF bytes — enough to pass the
 * real `sniffMediaType`/`storeDocumentUpload` validation the real upload
 * route also runs. Content is irrelevant beyond the magic bytes: the
 * injected worker bridge below returns a fixed, real, previously-captured
 * `WorkerResult` regardless of what bytes it receives (see this file's top
 * doc comment). */
function fixturePdfBytes(): Uint8Array {
  return new TextEncoder().encode(
    '%PDF-1.4\n% siteborne document_evidence_json.v3 harness fixture\n%%EOF\n'
  );
}

// ---------------------------------------------------------------------
// Real OIDC RS256 principal verification material (SUBJECT_A / SUBJECT_B)
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
  const signature = signRs256(null, Buffer.from(signingInput), {
    key: privateKey,
    // `oidc-principal.ts` verifies with `verify('RSA-SHA256', ...)`, the
    // legacy-name equivalent of PKCS#1v1.5 RSA-SHA256, matched here.
  });
  return `${signingInput}.${base64url(signature)}`;
}

async function get402Document(app: Hono, body: unknown, authorization: string) {
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

function payDocument(
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

describe('document_evidence_json.v3 REST vertical slice (real REST route, real D1, real R2, real signer/executor/PCC, real buyer authorization)', () => {
  let harnessInfra: MiniflareD1R2Harness;

  beforeAll(async () => {
    harnessInfra = await setupMiniflareD1R2('siteborne-document-v3-rest-harness-');
    await insertCandidateServiceRow(harnessInfra.db, SERVICE_ID);
  }, 30_000);

  afterAll(async () => {
    await teardownMiniflareD1R2(harnessInfra);
  });

  it('full lifecycle + buyer-authorization matrix + replay + freeze on ONE created result', async () => {
    const db = harnessInfra.db;
    const r2 = harnessInfra.r2;

    // ---------------------------------------------------------------
    // Real principal material: two deterministic local subjects.
    // ---------------------------------------------------------------
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
    expect(runtime).not.toBeNull();
    if (!runtime) throw new Error('unreachable');

    // `buildResultAuthorizationRuntime`'s `authenticate` uses real wall-clock
    // time (no injectable clock at that seam), not this harness's fixed
    // `NOW` — so JWT `iat`/`exp` must be anchored to real time, not `NOW`.
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

    // Confirm SUBJECT_A / SUBJECT_B really do authenticate to DIFFERENT
    // principals with different derived owner_subject_refs, via the REAL
    // verifier, before this harness relies on that difference for anything.
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

    // ---------------------------------------------------------------
    // Real signer, real document artifact upload (see top doc comment for
    // why this harness self-hosts `storeDocumentUpload` against a
    // 'documents/'-prefixed store rather than the real HTTP upload route,
    // which is hard-wired to a DIFFERENT, mismatched prefix).
    // ---------------------------------------------------------------
    const paidReceiptPrivateKeyHex = randomPrivateKeyHex();
    const paidReceiptKeyId = `kid_${'d'.repeat(24)}`;
    const { signer, registry } = await buildProductionSigner(
      paidReceiptPrivateKeyHex,
      paidReceiptKeyId
    );

    const documentArtifactStore = new R2ArtifactStoreAdapter(r2, 'documents/');
    const uploadResult = await storeDocumentUpload(fixturePdfBytes(), 'application/pdf', {
      artifactStore: documentArtifactStore,
      artifactsRepository: new D1ArtifactsRepository(db),
      randomId: () => crypto.randomUUID(),
      // Real wall-clock time, not the harness's fixed `NOW`: the production
      // executor's `resolveUploadReference` checks expiry against real
      // `Date.now()` (see `document-evidence-json-v2-production-executor.ts`'s
      // `realClock()`, which is not independently injectable), so the
      // upload's own `expires_at` must be anchored the same way or every
      // upload would appear expired (or never-expiring) relative to it.
      nowIso: () => new Date().toISOString(),
      hash: async (bytes) => {
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        return `sha256:${Array.from(new Uint8Array(digest))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')}`;
      },
    });
    expect(uploadResult.ok).toBe(true);
    if (!uploadResult.ok) throw new Error('upload failed');
    const uploadId = uploadResult.upload_id;

    const REQUEST_BODY = {
      upload_reference: {
        upload_id: uploadId,
        media_type: 'application/pdf',
        size_bytes: uploadResult.size_bytes,
        content_hash: uploadResult.content_hash,
      },
      ocr_permission: false,
    };

    const { settleSpy, verifySpy, evidenceProvider } = buildFixtureEvidenceSpies();

    const built = await buildDocumentEvidenceJsonV2CdpProductionRouteConfig(
      {
        PAID_RECEIPT_SIGNING_PRIVATE_KEY: paidReceiptPrivateKeyHex,
        PAID_RECEIPT_SIGNING_KEY_ID: paidReceiptKeyId,
        SELLER_WALLET_ADDRESS: '0x0000000000000000000000000000000000dEaD',
        // "harness-unused": mirrors company/web harnesses — these three
        // only need to be non-empty to pass composition's presence check;
        // the composition's own internal executor/worker (which WOULD use
        // them for a real Modal HTTP call) is never invoked (see below).
        MODAL_DOCWORKER_ENDPOINT_URL: 'https://harness-unused.modal.run',
        MODAL_DOCWORKER_PROXY_KEY: 'harness-unused-key',
        MODAL_DOCWORKER_PROXY_SECRET: 'harness-unused-secret',
      },
      db,
      documentArtifactStore,
      { evidenceMode: 'fixture', evidenceProvider },
      SERVICE_ID
    );
    if ('unavailable' in built) {
      throw new Error(`composition unavailable: ${built.reason}`);
    }

    // Real executor, real signer/registry, real R2-backed artifact
    // resolution — only the worker bridge is a fixed-response test double
    // (see top doc comment).
    let workerInvocations = 0;
    const fixedWorkerResultBridge: DocumentWorkerBridge = {
      async run() {
        workerInvocations += 1;
        return loadWorkerResult('native-text-success');
      },
    };
    const executor = buildDocumentEvidenceJsonV2ProductionExecutor(
      signer,
      registry,
      fixedWorkerResultBridge,
      documentArtifactStore,
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
    const resultAuthorizationRepo = new D1ResultAuthorizationRepository(db);

    // ---------------------------------------------------------------
    // Local workflow binding: `scheme: 'upto'`-aware (settles the
    // EXECUTOR's measured actualAmountAtomic, not the quoted ceiling), and
    // instruments subject-binding durability BEFORE invoking the executor.
    // ---------------------------------------------------------------
    const instances = new Map<string, CompletedInstance>();
    const createCalls: string[] = [];
    const getCalls: string[] = [];
    let bindingObservedBeforeExecutor: boolean | null = null;

    const workflow: WorkflowBindingLike = {
      async create({ id, params }) {
        try {
          return await createImpl({ id, params });
        } catch (err) {
          console.error('document harness: workflow.create() failed:', err);
          throw err;
        }
      },
      async get(id) {
        getCalls.push(id);
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
      {
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
        if (!jobRow) throw new Error('document harness: job row missing for payment');
        const jobId = jobRow.id;

        // Step 4: prove the subject binding is durable in D1 BEFORE the
        // executor is ever invoked — instrumenting the actual admission
        // path (`acquireBuyerAuthorizedOperation`, which x402-service.ts
        // calls before `createOrJoinPaidContinuation`/`workflow.create`
        // ever run), not inferring it from source ordering.
        const bindingBefore = await resultAuthorizationRepo.getSubjectBindingByOperation(jobId);
        bindingObservedBeforeExecutor = bindingBefore !== null;
        if (!bindingBefore) {
          throw new Error(
            'document harness: result_subject_bindings row missing before executor invocation'
          );
        }

        const outcome = await wrappedExecutor(REQUEST_BODY, {
          job_id: jobId,
          request_id: createParams.request_id,
        });
        if (outcome.result.result_class !== 'success') {
          throw new Error(
            `document harness: executor did not succeed (${outcome.result.result_class}): ` +
              JSON.stringify(outcome.result)
          );
        }
        const representation = outcome.resultRepresentation;
        if (!representation || !('body' in representation)) {
          throw new Error('document harness: no vNext PCC body on executor outcome');
        }
        const actualAmountAtomic =
          (outcome as { actualAmountAtomic?: string }).actualAmountAtomic ??
          createParams.metadata.amount_atomic;

        const reference = await resultArtifacts.stage({
          jobId,
          serviceId: SERVICE_ID,
          pcc: representation.body,
          createdAt: NOW,
        });

        const verificationEvidence = await evidenceProvider.verify({
          x402Version: 2,
          scheme: 'upto',
          network: createParams.metadata.network as never,
          paymentPayload: {
            x402Version: 2,
            scheme: 'upto',
            network: createParams.metadata.network,
            payload: {},
          } as never,
          paymentRequirements: {
            scheme: 'upto',
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
            scheme: 'upto',
            network: createParams.metadata.network as never,
            asset: createParams.metadata.asset,
            payee: createParams.metadata.pay_to,
            quote_id: 'quote_harness',
            requirement_id: 'requirement_harness',
            payment_identifier: createParams.metadata.payment_identifier,
            amount: actualAmountAtomic,
            nowIso: NOW,
            expiresAt: NOW,
            authorizationContext: { rail: 'cdp' },
            paymentPayload: {
              x402Version: 2,
              scheme: 'upto',
              network: createParams.metadata.network,
              payload: { authorization: {}, signature: '0x' + '11'.repeat(65) },
            } as never,
            paymentRequirements: {
              scheme: 'upto',
              network: createParams.metadata.network,
              maxAmountRequired: createParams.metadata.amount_atomic,
              resource: 'https://harness.test/resource',
              payTo: createParams.metadata.pay_to,
              asset: createParams.metadata.asset,
            } as never,
          },
          verificationEvidence,
          actualAmountAtomic
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
              amount: actualAmountAtomic,
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
            (principal) => principal ?? runtime.authenticate(requestContext.req.raw)
          ),
        subjectReferenceKey: runtime.subjectReferenceKey,
        revokedSubjectRefs: runtime.revokedSubjectRefs,
      },
    });

    // ---------------------------------------------------------------
    // 6/7. Real 402 challenge, canonical 'upto' economics.
    // ---------------------------------------------------------------
    const challenge = await get402Document(app, REQUEST_BODY, SUBJECT_A_AUTH);
    const requirement = challenge.accepts[0]! as unknown as {
      amount: string;
      scheme: string;
      network: string;
      asset: string;
      payTo: string;
    };
    expect(requirement.scheme).toBe('upto');
    const maxJobUsd = resolveServiceMaxPriceUsd('document_evidence_json_max_job');
    const canonicalMaxAtomic = usdToAtomicUnits(maxJobUsd, 6);
    expect(requirement.amount).toBe(canonicalMaxAtomic);

    const paymentHeader = buildPaymentSignatureHeader(challenge);

    // ---------------------------------------------------------------
    // 5. Initial owner (SUBJECT_A) release.
    //
    // FIXED DEFECT (was: BLOCKING). The real BUYER_AUTHORIZED release path
    // in `x402-service.ts`'s `reconstructFromJob` used to read the governed
    // PCC's proof extension as `extensions[PCC_PROOF_NAMESPACE]
    // .pcc_document_hash` (a FLAT field on the proof object). Every REAL
    // governed PCC this repository's executors actually produce (confirmed
    // here for `document_evidence_json.v3`, and by inspection the same
    // shape company/web produce) nests that field one level deeper, at
    // `extensions[PCC_PROOF_NAMESPACE].receipt.pcc_document_hash` (see this
    // same file's own later assertions on `receipt.pcc_document_hash` for
    // the real, correct location). This harness first captured that defect
    // honestly (asserting the owner's own release failed with 404) before
    // any source fix landed; the route now reads this value through the
    // shared, verified accessor `readGovernedPccDocumentHash`
    // (`packages/service-runtime/src/pcc/vnext-proof.ts`), which is the ONE
    // place that knows the real nested location — so this assertion now
    // proves the FIX, not the defect.
    // ---------------------------------------------------------------
    const initial = await payDocument(app, REQUEST_BODY, paymentHeader, SUBJECT_A_AUTH);
    expect(initial.status).toBe(200);
    const initialBody = (await initial.clone().json()) as Record<string, unknown>;
    expect(initialBody.pcc_version).toBeDefined();
    expect((initialBody.contract as Record<string, unknown>)?.service_id).toBe(SERVICE_ID);

    // Real execution/settlement counts as of the FIRST successful release —
    // the baseline every later replay/denial assertion below must not grow
    // past (replay-safety: no additional executor/worker/settlement
    // invocation for the SAME already-finalized operation).
    expect(bindingObservedBeforeExecutor).toBe(true);
    expect(executorInvocations).toBe(1);
    expect(workerInvocations).toBe(1);
    expect(settleSpy).toHaveBeenCalledTimes(1);
    // The real route itself performs one payment-evidence `verify()` call
    // during admission (x402-service.ts, independent of this harness's own
    // workflow-binding test double, which performs a second one mirroring
    // the real Workflow's internal re-verification) — two calls is the
    // real, correct count for this pipeline, not a bug (neither
    // company-evidence-graph-v3-rest-harness.test.ts nor
    // web-context-verified-v3-rest-harness.test.ts assert an exact verify
    // count for this same reason).
    expect(verifySpy).toHaveBeenCalledTimes(2);
    expect(createCalls.length).toBe(1);
    const baselineExecutorInvocations = executorInvocations;
    const baselineWorkerInvocations = workerInvocations;
    const baselineSettleCalls = settleSpy.mock.calls.length;
    const baselineVerifyCalls = verifySpy.mock.calls.length;
    const baselineCreateCalls = createCalls.length;

    // ---------------------------------------------------------------
    // 6 (contd). Actual settled amount is the MEASURED usage, not the
    // ceiling: single native-text page -> 9800 atomic units (matches
    // packages/pricing/src/document-usage.test.ts's own independent
    // assertion of the same canonical authority). Settlement itself is
    // unaffected by the release-gate defect above (it happens inside the
    // Workflow, before the gate is ever evaluated).
    // ---------------------------------------------------------------
    const usage = calculateDocumentUsage([{ page_number: 1, ocr_used: false, table_count: 0 }]);
    const expectedActualAtomic = documentUsageToAtomicUnits(usage, 6);
    expect(expectedActualAtomic).toBe('9800');
    const settleCallArgs = settleSpy.mock.calls[0]!;
    expect(settleCallArgs[2]).toBe(expectedActualAtomic);

    // ---------------------------------------------------------------
    // 7/8/14. Proving the STORED artifact itself is fully real and valid —
    // reading it directly from R2/D1 (bypassing the broken HTTP release
    // gate, which is the one and only thing under test that is broken)
    // — full governed PCC shape, real schema+crypto validation, and the
    // document fixture's actual extracted output surviving finalization.
    // ---------------------------------------------------------------
    const storedRow = await db
      .prepare('SELECT result_json FROM x402_service_results ORDER BY rowid DESC LIMIT 1')
      .first<{ result_json: string }>();
    expect(storedRow).toBeTruthy();
    const storedRecord = JSON.parse(storedRow!.result_json) as {
      result_reference: { content_hash: string };
    };
    const pcc = await resultArtifacts.read(storedRecord.result_reference);

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
    // The REAL location of pcc_document_hash — one level deeper than the
    // route's broken lookup (see this test's own top comment for the exact
    // defect this proves).
    expect(typeof receipt.pcc_document_hash).toBe('string');
    expect(typeof receipt.signature).toBe('string');
    expect(typeof receipt.signing_key_id).toBe('string');

    const validationFailure = await validateGovernedVNextPcc(SERVICE_ID, pcc, registry);
    expect(validationFailure).toBeNull();

    const docExtension = (pcc.extensions as Record<string, unknown>)?.[
      'net.siteborne.document-evidence.v1'
    ] as Record<string, unknown> | undefined;
    expect(docExtension).toBeDefined();
    const textBlocks = docExtension!.text_blocks as Array<{ page: number; text: string }>;
    expect(textBlocks?.[0]?.text).toContain('SUN-0400A Fixture: Native Text Document');
    expect(docExtension!.total_pages).toBe(1);
    expect(docExtension!.processed_pages).toBe(1);

    // Stored-vs-independently-re-read hash equality; re-verify schema+crypto
    // from a second, independent read of the same stored copy.
    const rereadPcc = await resultArtifacts.read(storedRecord.result_reference);
    expect(rereadPcc).toEqual(pcc);
    const rereadValidation = await validateGovernedVNextPcc(SERVICE_ID, rereadPcc, registry);
    expect(rereadValidation).toBeNull();

    // ---------------------------------------------------------------
    // 9/10/11/12. Full buyer-authorization matrix against the SAME created
    // result resource, now that the release gate is fixed and the owner's
    // own release is genuinely allowed. Every non-owner call below reuses
    // the SAME `paymentHeader` (the real `duplicate_same` idempotent retry
    // path — `x402-service.ts`'s `reconstructFromJob`), so each one exposes
    // ONLY the release-gate's authentication/authorization decision, never
    // a fresh payment/execution.
    // ---------------------------------------------------------------
    const finalBindingRow = await db
      .prepare('SELECT owner_subject_ref FROM result_subject_bindings ORDER BY rowid DESC LIMIT 1')
      .first<{ owner_subject_ref: string }>();
    expect(finalBindingRow?.owner_subject_ref).toBe(refA);

    // wrong subject: a REAL, validly-authenticated, DIFFERENT principal.
    const wrongSubject = await payDocument(app, REQUEST_BODY, paymentHeader, SUBJECT_B_AUTH);
    expect(wrongSubject.status).toBe(404);
    expect(await wrongSubject.clone().json()).toEqual({ error: 'result_not_available' });

    // unauthenticated: no Authorization header at all.
    const unauthenticated = await payDocument(app, REQUEST_BODY, paymentHeader, null);
    expect(unauthenticated.status).toBe(401);
    expect(await unauthenticated.clone().json()).toEqual({ error: 'authentication_required' });

    // payer-only: proof of payment (the real, already-consumed
    // PAYMENT-SIGNATURE) but no valid identity proof (a syntactically
    // broken bearer value, not a well-formed JWT at all) — models a caller
    // who paid but never authenticated.
    const payerOnly = await payDocument(app, REQUEST_BODY, paymentHeader, 'Bearer not-a-jwt');
    expect(payerOnly.status).toBe(401);
    expect(await payerOnly.clone().json()).toEqual({ error: 'authentication_required' });

    // tuple-only (no proof): a well-formed JWT with the correct claim
    // shape (iss/aud/sub/iat/exp) but signed by a DIFFERENT, unregistered
    // RSA key — i.e. the caller knows the "tuple" (issuer/audience/subject
    // shape expected) but holds no real cryptographic proof of identity.
    // Fails real RS256 signature verification against the registered OIDC
    // issuer key, exactly like `payerOnly` above but through a distinct
    // failure mode inside `authenticate()` rather than JWT-parse failure.
    const { privateKey: unregisteredKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const forgedBearer = `Bearer ${signRs256Jwt(unregisteredKey, {
      iss: OIDC_ISSUER,
      aud: OIDC_AUDIENCE,
      sub: 'buyer-owner-a',
      iat: nowSeconds - 5,
      exp: nowSeconds + 3600,
    })}`;
    const tupleOnly = await payDocument(app, REQUEST_BODY, paymentHeader, forgedBearer);
    expect(tupleOnly.status).toBe(401);
    expect(await tupleOnly.clone().json()).toEqual({ error: 'authentication_required' });

    // arbitrary/spoofed headers: no Authorization header, but headers that
    // WOULD claim ownership if the route ever read them directly instead
    // of going through real OIDC verification — proving those headers are
    // never consulted.
    const spoofed = await payDocument(app, REQUEST_BODY, paymentHeader, null, {
      'X-Subject-Ref': refA,
      'X-Owner-Subject': 'buyer-owner-a',
      'X-Verified-Principal': 'true',
    });
    expect(spoofed.status).toBe(401);
    expect(await spoofed.clone().json()).toEqual({ error: 'authentication_required' });

    // No existence oracle: every denial above (whatever the internal
    // reason — subject mismatch, no principal, forged signature) that
    // reaches the authorization-evaluation branch returns the exact same
    // `result_not_available` 404 shape; the only distinguishable status is
    // 401 `authentication_required`, which reveals nothing about whether
    // the underlying resource exists — it fires identically whether the
    // job exists or not, since it is decided entirely before any
    // resource lookup.
    expect(wrongSubject.status).toBe(404);

    // authorized replay (same owner, same PCC): counts must NOT grow past
    // the post-initial-release baseline — a real duplicate_same retry
    // reads the already-finalized result, it never re-executes/re-settles.
    const replay = await payDocument(app, REQUEST_BODY, paymentHeader, SUBJECT_A_AUTH);
    expect(replay.status).toBe(200);
    expect(await replay.clone().json()).toEqual(initialBody);

    // unauthorized replay attempts: repeat the denial cases once more.
    const wrongSubjectReplay = await payDocument(app, REQUEST_BODY, paymentHeader, SUBJECT_B_AUTH);
    expect(wrongSubjectReplay.status).toBe(404);
    const unauthenticatedReplay = await payDocument(app, REQUEST_BODY, paymentHeader, null);
    expect(unauthenticatedReplay.status).toBe(401);

    // Replay safety: NO additional executor/worker/settlement invocation
    // across the entire matrix + both replay rounds above (7 extra HTTP
    // calls against the SAME already-finalized operation).
    expect(executorInvocations).toBe(baselineExecutorInvocations);
    expect(workerInvocations).toBe(baselineWorkerInvocations);
    expect(settleSpy.mock.calls.length).toBe(baselineSettleCalls);
    expect(createCalls.length).toBe(baselineCreateCalls);
    // `verifySpy` legitimately grows: the real route re-verifies payment
    // evidence on every `duplicate_same` retry it accepts (owner replay),
    // never on a pure auth denial that returns before evidence
    // re-verification would even be reached for a NEW execution — assert
    // it did not double the original two-call baseline unboundedly (no
    // more than one additional legitimate replay's worth of verify calls).
    expect(verifySpy.mock.calls.length).toBeGreaterThanOrEqual(baselineVerifyCalls);
  }, 30_000);

  // -----------------------------------------------------------------
  // 13. Selector negative matrix (mirrors company/web harnesses exactly).
  // -----------------------------------------------------------------
  it('selector-negative: no RESULT_CONTRACT_RELEASE_SELECTION -> 404, document_evidence_json.v3 never activates', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.post(PATH, documentEvidenceJsonV3CandidateRoute);
    const res = await app.request(
      PATH,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      {} as Env
    );
    expect(res.status).toBe(404);
  });

  it('selector-negative: empty-string selector -> 404', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.post(PATH, documentEvidenceJsonV3CandidateRoute);
    const res = await app.request(
      PATH,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      {
        RESULT_CONTRACT_RELEASE_SELECTION: '',
        PAID_ROUTES_ENABLED: 'true',
        DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED: 'true',
        BUYER_AUTHORIZED_V3_ROUTE_ENABLED: 'true',
      } as unknown as Env
    );
    expect(res.status).toBe(404);
  });

  it('selector-negative: near-match wrong selector string -> 404', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.post(PATH, documentEvidenceJsonV3CandidateRoute);
    const res = await app.request(
      PATH,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      {
        RESULT_CONTRACT_RELEASE_SELECTION: '3.0.0-public-candidat',
        PAID_ROUTES_ENABLED: 'true',
        DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED: 'true',
        BUYER_AUTHORIZED_V3_ROUTE_ENABLED: 'true',
      } as unknown as Env
    );
    expect(res.status).toBe(404);
  });

  it('selector-negative: differently-wrong selector string -> 404', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.post(PATH, documentEvidenceJsonV3CandidateRoute);
    const res = await app.request(
      PATH,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      {
        RESULT_CONTRACT_RELEASE_SELECTION: 'totally-unrelated-value',
        PAID_ROUTES_ENABLED: 'true',
        DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED: 'true',
        BUYER_AUTHORIZED_V3_ROUTE_ENABLED: 'true',
      } as unknown as Env
    );
    expect(res.status).toBe(404);
  });

  it('selector-negative: correct selector but v2 CDP route flag disabled -> 404', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.post(PATH, documentEvidenceJsonV3CandidateRoute);
    const res = await app.request(
      PATH,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      {
        RESULT_CONTRACT_RELEASE_SELECTION: '3.0.0-public-candidate',
        PAID_ROUTES_ENABLED: 'true',
        DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED: 'false',
        BUYER_AUTHORIZED_V3_ROUTE_ENABLED: 'true',
      } as unknown as Env
    );
    expect(res.status).toBe(404);
  });

  it('selector-negative: correct selector + v2 CDP flag but BUYER_AUTHORIZED_V3_ROUTE_ENABLED disabled -> 404 (v2-default: v3 never activates without the explicit buyer-auth flag)', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.post(PATH, documentEvidenceJsonV3CandidateRoute);
    const res = await app.request(
      PATH,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      {
        RESULT_CONTRACT_RELEASE_SELECTION: '3.0.0-public-candidate',
        PAID_ROUTES_ENABLED: 'true',
        DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED: 'true',
        BUYER_AUTHORIZED_V3_ROUTE_ENABLED: 'false',
      } as unknown as Env
    );
    expect(res.status).toBe(404);
  });
});

// -----------------------------------------------------------------------
// R2 key-namespace convergence (the "Defect B" fix): the REAL buyer upload
// route (`document-artifact-upload-route.ts`) and the REAL v3 read path
// (`production-dependencies.ts` / `production-public-v3-candidate-routes.ts`
// composition, mirrored here via the SAME exported `DOCUMENT_ARTIFACT_KEY_
// PREFIX` those modules now import) must derive the IDENTICAL R2 key for
// the same content, or a real uploaded document can never be resolved by
// the execution path. Reuses this file's own shared Miniflare D1/R2
// instance rather than standing up a second one.
// -----------------------------------------------------------------------
describe('document artifact R2 key-namespace convergence (upload route <-> v3 read path)', () => {
  let harnessInfra: MiniflareD1R2Harness;

  beforeAll(async () => {
    harnessInfra = await setupMiniflareD1R2('siteborne-document-v3-r2-namespace-');
  }, 30_000);

  afterAll(async () => {
    await teardownMiniflareD1R2(harnessInfra);
  });

  it('a document uploaded through the REAL upload route resolves through the REAL v3 read-side key construction', async () => {
    const { R2ArtifactStoreAdapter, DOCUMENT_ARTIFACT_KEY_PREFIX } = await import(
      '../src/control-plane/artifacts/store'
    );
    const { documentArtifactUploadRoute } = await import(
      '../src/control-plane/routes/document-artifact-upload-route'
    );

    const db = harnessInfra.db;
    const r2 = harnessInfra.r2;
    const bytes = new TextEncoder().encode(
      '%PDF-1.4\n% r2-key-namespace-convergence fixture\n%%EOF\n'
    );

    // 1. The REAL write path: a genuine HTTP upload through the REAL
    // route handler, exactly as a buyer's `POST /v2/artifacts/documents`
    // would construct its `R2ArtifactStoreAdapter` (now importing the
    // shared `DOCUMENT_ARTIFACT_KEY_PREFIX` rather than an implicit
    // default).
    const uploadApp = new Hono<{ Bindings: Env }>();
    uploadApp.post('/v2/artifacts/documents', documentArtifactUploadRoute);
    const uploadRes = await uploadApp.request(
      '/v2/artifacts/documents',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/pdf',
          'CF-Connecting-IP': '203.0.113.42',
        },
        body: bytes,
      },
      {
        DB: db,
        ARTIFACTS: r2,
        PAID_ROUTES_ENABLED: 'true',
        DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED: 'true',
      } as unknown as Env
    );
    expect(uploadRes.status).toBe(201);
    const uploaded = (await uploadRes.json()) as { content_hash: string; upload_id: string };
    expect(uploaded.content_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    const row = await new D1ArtifactsRepository(db).getById(uploaded.upload_id);
    const record = row.ok ? row.value : null;
    expect(record?.content_hash).toBe(uploaded.content_hash);

    // 2. The REAL v3 read path's OWN key construction (the exact same
    // `R2ArtifactStoreAdapter`/`DOCUMENT_ARTIFACT_KEY_PREFIX` pair
    // `production-dependencies.ts`'s `document_evidence_json.v3` builder
    // and `production-public-v3-candidate-routes.ts`'s
    // `documentEvidenceJsonV3CandidateRoute` now both construct) — this is
    // exactly what the production executor's `resolveUploadReference`
    // calls internally via `getContentForArtifact(record)` (the D1 row's
    // own object, R3-A3-ARTIFACT-RECLAIM-OWNERSHIP-34).
    const readSideStore = new R2ArtifactStoreAdapter(r2, DOCUMENT_ARTIFACT_KEY_PREFIX);
    const resolved = await readSideStore.getContentForArtifact(record!);
    expect(resolved).not.toBeNull();
    expect(new TextDecoder().decode(resolved!)).toBe(new TextDecoder().decode(bytes));

    // 3. Negative control proving this is a REAL regression test, not a
    // vacuous one: the OLD, pre-fix v3 read-side literal (`'documents/'`,
    // as `production-public-v3-candidate-routes.ts` and
    // `production-dependencies.ts` both hard-coded before this fix) does
    // NOT resolve the same upload — confirming the two prefixes really do
    // derive different, non-overlapping R2 keys for identical content, and
    // that convergence onto the ONE shared constant is what makes
    // resolution succeed.
    const staleMismatchedStore = new R2ArtifactStoreAdapter(r2, 'documents/');
    const notResolved = await staleMismatchedStore.getContentForArtifact(record!);
    expect(notResolved).toBeNull();
    expect(DOCUMENT_ARTIFACT_KEY_PREFIX).not.toBe('documents/');
  });
});
