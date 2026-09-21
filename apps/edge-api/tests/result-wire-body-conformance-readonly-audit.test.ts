/**
 * RESULT-WIRE-BODY-CONFORMANCE-READONLY-AUDIT-01 -- characterization of the
 * body SITEBORNE actually persists and releases, for ALL FOUR real production
 * executors, against the governed/public contract.
 *
 * Read-only: asserts existing behavior; adds and changes no production code.
 * The representation-producing components are all real: the four production
 * executors (real services, real Ed25519 signer, real verifyAndSign), the real
 * Workflow orchestration, the real `validateExecutorPcc`, the real
 * `D1ResultReceiptPersistence`, the real `persistLinkEvidence`, the real MCP
 * boundary adapter and the real MCP SDK server/client. Only infrastructure at
 * the edges is faked (HTTP fetch, D1 statements, document worker fixture).
 *
 * Expected structures come from the canonical schema artifacts under
 * contracts/releases/2.0.0 and from an independent canonicalizer + node:crypto,
 * never from the object under test.
 */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { describe, expect, it, vi } from 'vitest';
import type { Context } from 'hono';
import { parse as parseYaml } from 'yaml';
import {
  FixtureDocumentWorkerBridge,
  buildProductionSigner,
  registerFixtureScenario,
  verifyServiceReceipt,
  type WorkerResult,
} from '@siteborne/service-runtime';
import {
  hashPolicy,
  loadPolicy,
  type KeyRegistry,
  type VerificationReceipt,
} from '@siteborne/verification';
import { MCP_PROTOCOL_VERSION, createSiteborneMcpHonoApp } from '@siteborne/protocol-mcp';
import { MCP_SERVICE_OUTPUT_SCHEMAS } from '@siteborne/protocol-mcp';
import {
  frozenInputExample,
  frozenOutputExample,
  type SiteborneServiceId,
} from '@siteborne/protocol-x402';
import { runPaidContinuationWorkflow } from '../src/control-plane/workflows/paid-continuation-workflow';
import {
  D1ResultReceiptPersistence,
  validateExecutorPcc,
} from '../src/control-plane/workflows/production-dependencies';
import { X402ServiceResultRepository } from '../src/control-plane/repositories/d1/x402-quotes';
import { D1PaymentFinalizationRepository } from '../src/control-plane/repositories/d1/payment-finalization';
import { createMcpX402ServiceBoundary } from '../src/control-plane/mcp/x402-mcp-adapter';
import { buildVerifyAgentOutputV2ProductionExecutor } from '../src/control-plane/production/verify-agent-output-v2-production-executor';
import { buildWebContextV2ProductionExecutor } from '../src/control-plane/production/web-context-v2-production-executor';
import { buildCompanyEvidenceGraphV2ProductionExecutor } from '../src/control-plane/production/company-evidence-graph-v2-production-executor';
import { buildDocumentEvidenceJsonV2ProductionExecutor } from '../src/control-plane/production/document-evidence-json-v2-production-executor';
import { FakeWorkflowStep } from './support/fake-workflow-step';
import type {
  VerifyAndSignParams,
  VerifyAndSignResult,
} from '../../../packages/service-runtime/src/pcc/verify-and-sign';
import {
  buildDecryptedPayload,
  buildTestDependencies,
  buildTestMetadata,
  sealTestInput,
  TEST_JOB_ID,
} from './support/paid-continuation-workflow-fixtures';
import {
  GOVERNED_CONTRACT_RELEASE,
  GOVERNED_OUTPUT_SCHEMA_HASHES,
  GOVERNED_PCC_SCHEMA_HASH,
  GOVERNED_PCC_SCHEMA_RELEASE,
  PCC_PROOF_NAMESPACE,
  buildSelfVerifyingPcc,
  canonicalHash,
  classifyStoredResult,
  pccDocumentProjection,
  receiptPreimage,
  replayWireBody,
  serviceOutputProjection,
  verifySelfVerifyingPcc,
  type PublicVerifierResult,
  type ReferenceReceipt,
  type SelfVerifyingPccArtifact,
} from './support/result-wire-body-reference-model';

// Test-only observation point: capture the exact finalized document returned by
// the real shared verifyAndSign implementation while leaving its behavior and
// every production caller unchanged. Vitest hoists this mock before the service
// modules load; importOriginal delegates all work to the production function.
const capturedSignedResults = vi.hoisted(() => new Map<string, unknown>());
vi.mock('../../../packages/service-runtime/src/pcc/verify-and-sign', async (importOriginal) => {
  type VerifyAndSignModule = Record<string, unknown> & {
    verifyAndSign: (
      params: VerifyAndSignParams<string, unknown>
    ) => Promise<VerifyAndSignResult<string, unknown>>;
  };
  const actual = await importOriginal<VerifyAndSignModule>();
  return {
    ...actual,
    verifyAndSign: async (
      params: Parameters<typeof actual.verifyAndSign>[0]
    ): ReturnType<typeof actual.verifyAndSign> => {
      const signed = await actual.verifyAndSign(params);
      capturedSignedResults.set(signed.document.contract.service_id, {
        ...signed,
        signer: params.signer,
      });
      return signed;
    },
  };
});

const REPO = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const readJson = (p: string) =>
  JSON.parse(readFileSync(REPO(p), 'utf8')) as Record<string, unknown>;

// ---- independent hashing (not the repo's canonicalizer) -------------------
function indepCanonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(indepCanonical).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${indepCanonical(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}
const indepHash = (v: unknown) =>
  `sha256:${createHash('sha256').update(indepCanonical(v)).digest('hex')}`;
const fileHash = (p: string) =>
  `sha256:${createHash('sha256')
    .update(readFileSync(REPO(p)))
    .digest('hex')}`;

// ---- infrastructure fakes (edges only) ------------------------------------
class FakeResultsD1 {
  rows = new Map<string, string>();
  prepare(sql: string) {
    const s = sql.trim();
    return {
      bind: (...a: unknown[]) => ({
        run: async () => {
          if (s.startsWith('INSERT INTO x402_service_results'))
            this.rows.set(a[0] as string, a[2] as string);
          else if (s.startsWith('UPDATE x402_service_results'))
            this.rows.set(a[2] as string, a[0] as string);
          else throw new Error(`unsupported: ${s}`);
          return { success: true };
        },
        all: async () => {
          const r = this.rows.get(a[0] as string);
          return { success: true, results: r === undefined ? [] : [{ result_json: r }] };
        },
      }),
    };
  }
}
class FakeLinkD1 {
  insertArgs: unknown[] | null = null;
  prepare(sql: string) {
    const s = sql.trim();
    return {
      bind: (...a: unknown[]) => ({
        first: async () => {
          if (s.startsWith('SELECT id FROM payment_attempts')) return { id: 'attempt_1' };
          if (s.includes('FROM payment_service_link_evidence')) {
            const b = this.insertArgs as unknown[];
            return {
              link_hash: b[4],
              settlement_transaction_reference: b[6],
              buyer_receipt_hash: b[13],
            };
          }
          throw new Error(`unsupported first: ${s}`);
        },
        run: async () => {
          if (!s.startsWith('INSERT INTO payment_service_link_evidence'))
            throw new Error(`unsupported: ${s}`);
          if (this.insertArgs === null) this.insertArgs = a;
          return { success: true };
        },
      }),
    };
  }
}
/** SEC rate coordinator D1: admits every request (one statement pair per call). */
const admitAllD1 = {
  prepare: () => ({ bind: () => ({}) }),
  batch: async () => [
    { success: true, meta: { changes: 0 } },
    { success: true, meta: { changes: 1 } },
  ],
};
const htmlHttp = (body: string) => ({
  fetch: async () => new Response(body, { status: 200, headers: { 'content-type': 'text/html' } }),
});
const jsonHttp = (body: unknown) => ({
  fetch: async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
});

type Executor = Parameters<typeof buildTestDependencies>[0] extends infer O
  ? O extends { executor?: infer E }
    ? NonNullable<E>
    : never
  : never;

interface ExecutorCase {
  readonly serviceId: SiteborneServiceId;
  readonly schemaFile: string;
  readonly build: (
    signer: never,
    registry: KeyRegistry
  ) => { executor: Executor; input: Record<string, unknown> };
}

const DOC_SCENARIO = 'wire-conformance-doc';
const docWorkerResult = JSON.parse(
  readFileSync(
    REPO('packages/service-runtime/fixtures/document-worker-results/native-text-success.json'),
    'utf8'
  )
) as WorkerResult;

const CASES: readonly ExecutorCase[] = [
  {
    serviceId: 'verify_agent_output.v2',
    schemaFile: 'agent-verification-output.schema.json',
    build: (signer, registry) => ({
      executor: buildVerifyAgentOutputV2ProductionExecutor(signer, registry) as Executor,
      input: {
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
      },
    }),
  },
  {
    serviceId: 'web_context_verified.v2',
    schemaFile: 'web-context-output.schema.json',
    build: (signer, registry) => ({
      executor: buildWebContextV2ProductionExecutor(
        signer,
        registry,
        htmlHttp(
          '<html><head><title>Wire Conformance Marker Title</title></head><body>Hello marker body</body></html>'
        ) as never
      ) as Executor,
      input: { target_url: 'https://acme.example/article', retrieval_mode: 'direct' },
    }),
  },
  {
    serviceId: 'company_evidence_graph.v2',
    schemaFile: 'company-evidence-output.schema.json',
    build: (signer, registry) => ({
      executor: buildCompanyEvidenceGraphV2ProductionExecutor(
        signer,
        registry,
        jsonHttp(
          JSON.parse(
            readFileSync(
              REPO('packages/provider-adapters/fixtures/sec-edgar/submissions-success.json'),
              'utf8'
            )
          )
        ) as never,
        admitAllD1 as never
      ) as Executor,
      input: {
        identifiers: { cik: '0000320193' },
        requested_field_groups: ['identity', 'sec_submissions'],
      },
    }),
  },
  {
    serviceId: 'document_evidence_json.v2',
    schemaFile: 'document-evidence-output.schema.json',
    build: (signer, registry) => {
      const bytes = registerFixtureScenario(new Uint8Array([1, 2, 3]), DOC_SCENARIO);
      const worker = new FixtureDocumentWorkerBridge(new Map([[DOC_SCENARIO, docWorkerResult]]));
      const store = { getContent: async (id: string) => (id === 'doc/native.pdf' ? bytes : null) };
      return {
        executor: buildDocumentEvidenceJsonV2ProductionExecutor(
          signer,
          registry,
          worker,
          store as never,
          {} as never
        ) as Executor,
        input: {
          artifact_reference: {
            artifact_id: 'doc/native.pdf',
            media_type: 'application/pdf',
            size_bytes: bytes.length,
          },
        },
      };
    },
  },
];

interface Chain {
  readonly settled: boolean;
  readonly raw: string;
  readonly body: Record<string, unknown>;
  readonly outputCaptured: unknown;
  readonly resultMetrics: Record<string, unknown> | undefined;
  readonly insertArgs: unknown[];
  readonly registry: KeyRegistry;
}

async function runChain(c: ExecutorCase): Promise<Chain> {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const { signer, registry } = await buildProductionSigner(hex, 'kid_prod0123456789abcdefghij');
  const { executor, input } = c.build(signer as never, registry);
  let captured: Awaited<ReturnType<Executor>> | undefined;
  const wrapped = (async (i: never, ctx: never) => {
    captured = await (executor as (a: never, b: never) => ReturnType<Executor>)(i, ctx);
    return captured;
  }) as unknown as Executor;

  const base = await buildTestDependencies({ executor: wrapped, validatePcc: validateExecutorPcc });
  const resultsD1 = new FakeResultsD1();
  const linkD1 = new FakeLinkD1();
  const realResults = new D1ResultReceiptPersistence(
    new X402ServiceResultRepository(resultsD1 as never)
  );
  const realLinks = new D1PaymentFinalizationRepository(linkD1 as never);
  const deps = {
    ...base,
    persistence: {
      job: base.persistence.job,
      resultReceipt: {
        persistResult: (i: Parameters<typeof realResults.persistResult>[0]) =>
          realResults.persistResult(i),
        persistReceipt: (i: Parameters<typeof realResults.persistReceipt>[0]) =>
          realResults.persistReceipt(i),
      },
      finalization: {
        recordProviderFailure: (i: never) => base.finalizationPersistence.recordProviderFailure(i),
        recordSettlementFinalizationUnresolved: (i: never) =>
          base.finalizationPersistence.recordSettlementFinalizationUnresolved(i),
        persistLinkEvidence: (i: Parameters<typeof realLinks.persistLinkEvidence>[0]) =>
          realLinks.persistLinkEvidence(i),
        finalizeSettled: (p: string) => base.finalizationPersistence.finalizeSettled(p),
      },
    },
  };
  const metadata = buildTestMetadata();
  const sealed = await sealTestInput(metadata, {
    key: base.envelopeKey,
    payload: buildDecryptedPayload(metadata, { executorInput: input as never }),
  });
  const result = await runPaidContinuationWorkflow(
    { payload: sealed },
    new FakeWorkflowStep(),
    deps as never
  );
  const raw = resultsD1.rows.get(TEST_JOB_ID) as string;
  const cap = captured as unknown as {
    result?: { output?: unknown };
    resourceMetrics?: Record<string, unknown>;
  };
  return {
    settled: result.status === 'settled',
    raw,
    body: (JSON.parse(raw) as { body: Record<string, unknown> }).body,
    outputCaptured: cap.result?.output,
    resultMetrics: cap.resourceMetrics,
    insertArgs: linkD1.insertArgs as unknown[],
    registry,
  };
}

const leafStrings = (v: unknown, out: string[] = []): string[] => {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => leafStrings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => leafStrings(x, out));
  return out;
};

const DRAFT7_META = JSON.parse(
  readFileSync(
    createRequire(import.meta.url).resolve('ajv/dist/refs/json-schema-draft-07.json'),
    'utf8'
  )
) as object;
const PCC_SCHEMA = readJson('contracts/releases/2.0.0/schemas/proof-carrying-context.schema.json');
const PCC_REQUIRED = PCC_SCHEMA.required as string[];
const PCC_ID = PCC_SCHEMA.$id as string;

function serviceValidator(schemaFile: string) {
  const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: true });
  // The PCC base schema is draft-07; the per-service schemas are 2020-12.
  ajv.addMetaSchema(DRAFT7_META);
  ajv.addSchema(PCC_SCHEMA);
  for (const f of readdirSync(REPO('contracts/releases/2.0.0/schemas/common'))) {
    ajv.addSchema(readJson(`contracts/releases/2.0.0/schemas/common/${f}`));
  }
  return ajv.compile(readJson(`contracts/releases/2.0.0/schemas/services/${schemaFile}`));
}

// Run each real executor once and share the result across assertions.
const chains = new Map<string, Promise<Chain>>();
const chainFor = (c: ExecutorCase) => {
  if (!chains.has(c.serviceId)) chains.set(c.serviceId, runChain(c));
  return chains.get(c.serviceId) as Promise<Chain>;
};

const referenceArtifacts = new Map<string, Promise<SelfVerifyingPccArtifact>>();
const referenceFor = async (c: ExecutorCase) => {
  if (!referenceArtifacts.has(c.serviceId)) {
    referenceArtifacts.set(
      c.serviceId,
      (async () => {
        await chainFor(c);
        return buildSelfVerifyingPcc(capturedSignedResults.get(c.serviceId) as never);
      })()
    );
  }
  return referenceArtifacts.get(c.serviceId) as Promise<SelfVerifyingPccArtifact>;
};

async function publicKeyForAsync(
  c: ExecutorCase,
  artifact: SelfVerifyingPccArtifact
): Promise<Uint8Array> {
  const chain = await chainFor(c);
  const record = chain.registry.get(artifact.verificationReceipt.signing_key_id);
  if (!record) throw new Error(`missing_public_key:${artifact.verificationReceipt.signing_key_id}`);
  return record.public_key;
}

describe.each(CASES)(
  'RESULT-WIRE-BODY-CONFORMANCE: $serviceId (real executor -> real Workflow)',
  (c) => {
    it('runs to a settled, persisted result', async () => {
      const chain = await chainFor(c);
      expect(chain.settled).toBe(true);
      expect(typeof chain.raw).toBe('string');
    }, 60_000);

    it('the released body is the flat signed VerificationReceipt: exact key set, no PCC document fields', async () => {
      const { body } = await chainFor(c);
      const expectedFlatKeys = [
        'canonicalization_algorithm',
        'completeness',
        'contract_release',
        'decision',
        'evidence_hash',
        'input_hash',
        'issued_at',
        'job_id',
        'limitations',
        'output_hash',
        'pcc_schema_hash',
        'pcc_schema_release',
        'policy_hash',
        'receipt_id',
        'receipt_version',
        'request_id',
        'service_id',
        'service_version',
        'signature',
        'signature_algorithm',
        'signing_key_id',
        'verification_mode',
        'verifier_set_hash',
      ];
      expect(Object.keys(body).sort()).toEqual(expectedFlatKeys);
      // Which governed-PCC required fields (from the canonical schema, not from the
      // body) are missing at the top level:
      const missing = PCC_REQUIRED.filter((k) => !(k in body));
      expect(missing).toEqual([
        'pcc_version',
        'contract',
        'subject',
        'claims',
        'evidence',
        'provenance',
        'verification',
        'receipt',
      ]);
      // `completeness` exists in both, with a different TYPE (number vs object).
      expect(typeof body.completeness).toBe('number');
      expect('extensions' in body).toBe(false);
      expect('output' in body).toBe(false);
    }, 60_000);

    it('the receipt stamps the context builder DEFAULTS, not the v2 service contract (finding CB-1)', async () => {
      const { body } = await chainFor(c);
      expect(body.service_id).toBe(c.serviceId);
      expect(body.service_version).toBe('v2');
      expect(body.contract_release).toBe('1.0.0'); // the service contract is 2.0.0
      expect(body.pcc_schema_release).toBe('1.0.1');
      expect(body.policy_hash).toBe('sha256:' + '0'.repeat(64)); // all-zero placeholder
      expect(body.verification_mode).toBe('standard');
    }, 60_000);

    it('the service output is produced and returned to the Workflow, but appears nowhere in the persisted row', async () => {
      const chain = await chainFor(c);
      expect(chain.outputCaptured).toBeDefined();
      // Leaves ALSO legitimately present in the released receipt (e.g. "standard")
      // prove nothing; keep only leaves unique to the service output.
      const bodyText = JSON.stringify(chain.body);
      const leaves = leafStrings(chain.outputCaptured).filter(
        (s) => s.length >= 4 && !bodyText.includes(s)
      );
      expect(leaves.length).toBeGreaterThan(0);
      for (const leaf of leaves) expect(chain.raw).not.toContain(leaf);
    }, 60_000);

    it('the released body does NOT satisfy the governed output schema (contracts/2.0.0) or the public MCP outputSchema', async () => {
      const { body } = await chainFor(c);
      const contractValidate = serviceValidator(c.schemaFile);
      expect(contractValidate(body)).toBe(false);
      const missingRequired = (contractValidate.errors ?? [])
        .filter((e) => e.keyword === 'required')
        .flatMap((e) => (e.params as { missingProperty: string }).missingProperty);
      expect(missingRequired).toEqual(
        expect.arrayContaining(['pcc_version', 'contract', 'extensions'])
      );

      const mcp = new Ajv2020({ strict: false, validateFormats: false });
      const mcpValidate = mcp.compile(MCP_SERVICE_OUTPUT_SCHEMAS[c.serviceId] as object);
      expect(mcpValidate(body)).toBe(false);
      // Positive control: the same validators accept the governed example, so the
      // rejection above is about the body, not a broken validator.
      expect(mcpValidate(frozenOutputExample(c.serviceId))).toBe(true);
      expect(PCC_ID).toContain('proof-carrying-context');
    }, 60_000);

    it('the signature is real: the real verifier accepts the released body and rejects a mutated one', async () => {
      const { body, registry } = await chainFor(c);
      const verify = (receipt: unknown) =>
        verifyServiceReceipt({
          receipt: receipt as VerificationReceipt,
          keyRegistry: registry,
          expectedServiceId: c.serviceId,
          expectedContractRelease: body.contract_release as string,
        });
      expect((await verify(body)).valid).toBe(true);
      expect((await verify({ ...body, decision: 'forged' })).valid).toBe(false);
      expect((await verify({ ...body, output_hash: 'sha256:' + 'f'.repeat(64) })).valid).toBe(
        false
      );
      expect((await verify({ ...body, service_id: 'other.v2' })).valid).toBe(false);
      // receipt_id is derived from the preimage and re-checked: every body field is covered.
      expect(await verify({ ...body, receipt_id: 'rcpt_' + '0'.repeat(24) })).toMatchObject({
        valid: false,
        status: 'receipt_id_mismatch',
      });
    }, 60_000);

    it('the persisted anchor equals an independent hash of the released body; replay reads the same bytes', async () => {
      const { raw, body, insertArgs } = await chainFor(c);
      expect(insertArgs[13]).toBe(indepHash(body)); // buyer_receipt_hash
      expect(insertArgs[10]).toBe(indepHash(body)); // verification_receipt_hash
      expect(JSON.parse(raw).body).toEqual(body); // release-time read == persist-time body
      // The receipt's own output_hash is a different value: a hash of the service's
      // draft document, which is never persisted or released.
      expect(body.output_hash).not.toBe(indepHash(body));
    }, 60_000);
  }
);

describe('RESULT-WIRE-BODY-CONFORMANCE: cross-executor consistency', () => {
  it('reference model starts from the actual finalized in-memory PCC', async () => {
    const c = CASES[0];
    await chainFor(c);
    const captured = capturedSignedResults.get(c.serviceId);
    await expect(buildSelfVerifyingPcc(captured as never)).resolves.toBeDefined();
  }, 60_000);

  it('captures the actual in-memory signed.document from all four real production executors', async () => {
    await Promise.all(CASES.map((c) => chainFor(c)));
    expect([...capturedSignedResults.keys()].sort()).toEqual(CASES.map((c) => c.serviceId).sort());
  }, 120_000);

  it.each(CASES)(
    'the actual in-memory signed.document for $serviceId validates against its governed Release-2 output schema',
    async (c) => {
      await chainFor(c);
      const captured = capturedSignedResults.get(c.serviceId) as { document: unknown } | undefined;
      expect(captured).toBeDefined();
      const validate = serviceValidator(c.schemaFile);
      const valid = validate(captured?.document);
      expect(validate.errors ?? [], JSON.stringify(validate.errors, null, 2)).toEqual([]);
      expect(valid).toBe(true);
    },
    60_000
  );

  it('all four executors release the identical flat-receipt key set', async () => {
    const keySets = await Promise.all(
      CASES.map(async (c) =>
        Object.keys((await chainFor(c)).body)
          .sort()
          .join(',')
      )
    );
    expect(new Set(keySets).size).toBe(1);
  }, 120_000);

  it('the receipt output_hash differs per service and is not the hash of the persisted output (which is absent)', async () => {
    const hashes = await Promise.all(CASES.map(async (c) => (await chainFor(c)).body.output_hash));
    expect(new Set(hashes).size).toBe(CASES.length);
  }, 120_000);
});

describe('RESULT-WIRE-BODY-DELIVERY-DESIGN-01: local-only self-verifying PCC reference model', () => {
  const verifyReference = async (c: ExecutorCase, pcc: Record<string, unknown>) => {
    const artifact = await referenceFor(c);
    return verifySelfVerifyingPcc(pcc, await publicKeyForAsync(c, artifact));
  };
  const cloned = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  type ProofView = {
    proof_version: '1.0.0';
    receipt: ReferenceReceipt;
    verification_material: { verifier_results: PublicVerifierResult[] };
  };

  it.each(CASES)('$serviceId freezes final service semantics before proof creation', async (c) => {
    let frozenBeforeProof = false;
    const artifact = await buildSelfVerifyingPcc(capturedSignedResults.get(c.serviceId) as never, {
      onSemanticFreeze: (semanticPcc) => {
        frozenBeforeProof =
          Object.isFrozen(semanticPcc) &&
          Object.isFrozen(semanticPcc.contract) &&
          Object.isFrozen(semanticPcc.extensions);
      },
    });
    expect(frozenBeforeProof).toBe(true);
    expect(Object.isFrozen(artifact.serviceOutput)).toBe(true);
    expect(Object.isFrozen(artifact.finalExtension)).toBe(true);
    expect(Object.isFrozen(artifact.pccDocument)).toBe(true);
    expect(() => {
      (artifact.finalExtension as { forbidden?: boolean }).forbidden = true;
    }).toThrow(TypeError);
  });

  it('verify_agent_output.v2 rejects a post-proof outcome/score mutation', async () => {
    const c = CASES.find((entry) => entry.serviceId === 'verify_agent_output.v2') as ExecutorCase;
    const artifact = await referenceFor(c);
    const changed = cloned(artifact.wireBody);
    const extension = (changed.extensions as Record<string, Record<string, unknown>>)[
      'net.siteborne.agent-verification.v1'
    ];
    extension.outcome = extension.outcome === 'pass' ? 'fail' : 'pass';
    extension.score = Number(extension.score) === 0 ? 1 : 0;
    const verified = await verifyReference(c, changed);
    expect(verified.valid).toBe(false);
    expect(verified.errors).toEqual(
      expect.arrayContaining(['output_hash_mismatch', 'pcc_document_hash_mismatch'])
    );
  });

  it.each(CASES)('$serviceId reconstructs the signed preimage from delivered PCC', async (c) => {
    const artifact = await referenceFor(c);
    const proof = (artifact.wireBody.extensions as Record<string, ProofView>)[PCC_PROOF_NAMESPACE];
    const reconstructed = receiptPreimage(proof.receipt);
    expect(Object.keys(reconstructed)).not.toContain('signature');
    expect(Object.keys(reconstructed)).not.toContain('receipt_id');
    expect(reconstructed.service_id).toBe(c.serviceId);
    expect(reconstructed.pcc_document_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it.each(CASES)('$serviceId verifies from delivered PCC plus public key', async (c) => {
    const artifact = await referenceFor(c);
    await expect(verifyReference(c, artifact.wireBody)).resolves.toEqual({
      valid: true,
      errors: [],
    });
  });

  it.each(CASES)(
    '$serviceId output_hash recomputes from its delivered service extension',
    async (c) => {
      const artifact = await referenceFor(c);
      expect(await canonicalHash(serviceOutputProjection(artifact.wireBody))).toBe(
        artifact.verificationReceipt.output_hash
      );
    }
  );

  it('modified service output fails verification', async () => {
    const c = CASES[1];
    const artifact = await referenceFor(c);
    const changed = cloned(artifact.wireBody);
    const extensionKey = Object.keys(changed.extensions as Record<string, unknown>).find(
      (key) => key !== PCC_PROOF_NAMESPACE
    ) as string;
    (changed.extensions as Record<string, Record<string, unknown>>)[extensionKey].tampered = true;
    const verified = await verifyReference(c, changed);
    expect(verified.valid).toBe(false);
    expect(verified.errors).toEqual(
      expect.arrayContaining(['output_hash_mismatch', 'pcc_document_hash_mismatch'])
    );
  });

  it.each([
    [
      'service_id',
      (pcc: Record<string, unknown>) => {
        (pcc.contract as Record<string, unknown>).service_id = 'other.v2';
      },
      'service_id_mismatch',
    ],
    [
      'decision',
      (pcc: Record<string, unknown>) => {
        (pcc.verification as Record<string, unknown>).decision = 'fail';
      },
      'decision_mismatch',
    ],
    [
      'proof_version',
      (pcc: Record<string, unknown>) => {
        const proof = (pcc.extensions as Record<string, ProofView>)[PCC_PROOF_NAMESPACE];
        proof.proof_version = 'forged' as '1.0.0';
      },
      'proof_version_mismatch',
    ],
    [
      'receipt_id',
      (pcc: Record<string, unknown>) => {
        const proof = (pcc.extensions as Record<string, ProofView>)[PCC_PROOF_NAMESPACE];
        proof.receipt.receipt_id = `rcpt_${'0'.repeat(24)}`;
      },
      'receipt_id_mismatch',
    ],
  ] as const)('modified %s fails verification', async (_field, mutate, expectedError) => {
    const c = CASES[0];
    const artifact = await referenceFor(c);
    const changed = cloned(artifact.wireBody);
    mutate(changed);
    const verified = await verifyReference(c, changed);
    expect(verified.valid).toBe(false);
    expect(verified.errors).toContain(expectedError);
  });

  it.each(CASES)('$serviceId fits the one PCC-native proof representation', async (c) => {
    const artifact = await referenceFor(c);
    expect(artifact.wireBody).toBe(artifact.pccDocument);
    expect(
      (artifact.wireBody.extensions as Record<string, unknown>)[PCC_PROOF_NAMESPACE]
    ).toBeDefined();
    expect('output' in artifact.wireBody).toBe(false);
    expect('pcc' in artifact.wireBody).toBe(false);
  });

  it.each(CASES)(
    '$serviceId proposed PCC validates under the governed Release-2 schema',
    async (c) => {
      const artifact = await referenceFor(c);
      const validate = serviceValidator(c.schemaFile);
      expect(validate(artifact.wireBody), JSON.stringify(validate.errors, null, 2)).toBe(true);
    }
  );

  it('typed link evidence is independent of the public wire shape', async () => {
    const artifact = await referenceFor(CASES[0]);
    const malformedWire = cloned(artifact.wireBody);
    delete (malformedWire.extensions as Record<string, unknown>)[PCC_PROOF_NAMESPACE];
    expect(artifact.linkEvidenceInputs).toMatchObject({
      receiptId: artifact.verificationReceipt.receipt_id,
      signingKeyId: artifact.verificationReceipt.signing_key_id,
      signature: artifact.verificationReceipt.signature,
    });
    expect(malformedWire).not.toEqual(artifact.wireBody);
  });

  it('legacy receipt-only storage is classified truthfully and never upgraded', async () => {
    const chain = await chainFor(CASES[0]);
    const classified = classifyStoredResult(chain.body);
    expect(classified.kind).toBe('LEGACY_RECEIPT_ONLY');
    expect(classified.body).toEqual(chain.body);
    expect(classified.body).not.toHaveProperty('pcc_version');
  });

  it.each(CASES)(
    '$serviceId initial and cached successful PCC are semantically identical',
    async (c) => {
      const artifact = await referenceFor(c);
      expect(replayWireBody(artifact)).toEqual(artifact.wireBody);
      expect(classifyStoredResult(replayWireBody(artifact)).kind).toBe('SELF_VERIFYING_PCC_VNEXT');
    }
  );

  it('receipt and PCC hashes use non-circular projections', async () => {
    const artifact = await referenceFor(CASES[0]);
    const changedProof = cloned(artifact.wireBody);
    (changedProof.extensions as Record<string, ProofView>)[PCC_PROOF_NAMESPACE].receipt.signature =
      'x'.repeat(86);
    changedProof.receipt = {};
    expect(await canonicalHash(pccDocumentProjection(changedProof))).toBe(
      artifact.verificationReceipt.pcc_document_hash
    );
    expect(await canonicalHash(serviceOutputProjection(changedProof))).toBe(
      artifact.verificationReceipt.output_hash
    );
  });

  it('contract_release derives from the normative contract release authority', async () => {
    const release = parseYaml(
      readFileSync(REPO('contracts/releases/2.0.0/CONTRACT_RELEASE.yaml'), 'utf8')
    ) as { release: { version: string } };
    expect(GOVERNED_CONTRACT_RELEASE).toBe(release.release.version);
    for (const c of CASES) {
      expect((await referenceFor(c)).verificationReceipt.contract_release).toBe(
        release.release.version
      );
    }
  });

  it('policy_hash derives from the canonical governed verification policy', async () => {
    const expected = await hashPolicy(loadPolicy());
    expect(expected).not.toBe(`sha256:${'0'.repeat(64)}`);
    for (const c of CASES)
      expect((await referenceFor(c)).verificationReceipt.policy_hash).toBe(expected);
  });

  it('pcc_schema_hash derives from the governed PCC artifact and release authority', async () => {
    const release = parseYaml(
      readFileSync(REPO('contracts/releases/2.0.0/CONTRACT_RELEASE.yaml'), 'utf8')
    ) as { pcc_dependency: { schema_release: string; schema_sha256: string } };
    expect(GOVERNED_PCC_SCHEMA_RELEASE).toBe(release.pcc_dependency.schema_release);
    expect(GOVERNED_PCC_SCHEMA_HASH).toBe(`sha256:${release.pcc_dependency.schema_sha256}`);
    expect(GOVERNED_PCC_SCHEMA_HASH).toBe(
      fileHash('contracts/releases/2.0.0/schemas/proof-carrying-context.schema.json')
    );
  });

  it.each(CASES)(
    '$serviceId output_schema_hash derives from its governed schema artifact',
    async (c) => {
      const expected = fileHash(`contracts/releases/2.0.0/schemas/services/${c.schemaFile}`);
      expect(GOVERNED_OUTPUT_SCHEMA_HASHES[c.serviceId]).toBe(expected);
      expect((await referenceFor(c)).verificationReceipt.output_schema_hash).toBe(expected);
    }
  );

  it.each(CASES)('$serviceId proof construction is deterministic', async (c) => {
    const first = await referenceFor(c);
    const second = await buildSelfVerifyingPcc(capturedSignedResults.get(c.serviceId) as never);
    expect(second.wireBody).toEqual(first.wireBody);
    expect(second.verificationReceipt.signature).toBe(first.verificationReceipt.signature);
  });

  it('rejects non-Unicode-scalar strings before canonical hashing or signing', async () => {
    await expect(canonicalHash({ value: '\ud800' })).rejects.toThrow('non_unicode_scalar:$.value');
    await expect(canonicalHash({ value: '\udc00' })).rejects.toThrow('non_unicode_scalar:$.value');
    await expect(canonicalHash({ nested: [{ value: 'a\ud800b' }] })).rejects.toThrow(
      'non_unicode_scalar'
    );
    await expect(canonicalHash({ ['k\ud800']: 1 })).rejects.toThrow('non_unicode_scalar');
    // a valid surrogate pair (one scalar value) remains accepted
    await expect(canonicalHash({ value: '😀' })).resolves.toMatch(/^sha256:/);
  });

  it('verification rejects a delivered PCC carrying a lone surrogate', async () => {
    const c = CASES[0];
    const artifact = await referenceFor(c);
    const changed = cloned(artifact.wireBody);
    const extensionKey = Object.keys(changed.extensions as Record<string, unknown>).find(
      (key) => key !== PCC_PROOF_NAMESPACE
    ) as string;
    (changed.extensions as Record<string, Record<string, unknown>>)[extensionKey].tampered =
      '\ud800';
    await expect(verifyReference(c, changed)).resolves.toEqual({
      valid: false,
      errors: ['non_unicode_scalar'],
    });
  });

  it.each(CASES)(
    '$serviceId output_hash and pcc_document_hash have distinct values and semantics',
    async (c) => {
      const receipt = (await referenceFor(c)).verificationReceipt;
      expect(receipt.output_hash).not.toBe(receipt.pcc_document_hash);
    }
  );

  it.each(CASES)(
    '$serviceId cached replay is the exact serialized-and-reparsed initial PCC',
    async (c) => {
      const artifact = await referenceFor(c);
      const reparsed = JSON.parse(JSON.stringify(artifact.wireBody));
      expect(reparsed).toEqual(artifact.wireBody);
      await expect(verifyReference(c, reparsed)).resolves.toEqual({ valid: true, errors: [] });
    }
  );

  it.each(CASES)('$serviceId publishes only verifier hash preimage fields', async (c) => {
    const artifact = await referenceFor(c);
    const proof = (artifact.wireBody.extensions as Record<string, ProofView>)[PCC_PROOF_NAMESPACE];
    for (const result of proof.verification_material.verifier_results) {
      expect(Object.keys(result).sort()).toEqual([
        'failure_codes',
        'findings',
        'status',
        'verifier_id',
      ]);
      expect(result).not.toHaveProperty('audit_reference');
      expect(result).not.toHaveProperty('input_hash');
      expect(result).not.toHaveProperty('started_at');
      for (const finding of result.findings) {
        expect(Object.keys(finding).sort()).toEqual(['code', 'severity']);
        expect(finding).not.toHaveProperty('message');
        expect(finding).not.toHaveProperty('subject');
      }
    }
    expect(JSON.stringify(artifact.wireBody)).not.toContain('privateKey');
  });
});

const MCP_TOOL_BY_SERVICE: Record<string, string> = {
  'verify_agent_output.v2': 'siteborne_verify_agent_output',
  'web_context_verified.v2': 'siteborne_retrieve_verified_web_context',
  'company_evidence_graph.v2': 'siteborne_build_company_evidence_graph',
  'document_evidence_json.v2': 'siteborne_extract_document_evidence_json',
};

describe('RESULT-WIRE-BODY-CONFORMANCE: the real MCP SDK against the real released body', () => {
  async function callViaMcp(serviceId: SiteborneServiceId, tool: string, body: unknown) {
    const handler = async (c: Context) => c.json(body as never, 200);
    const boundary = createMcpX402ServiceBoundary(
      {} as never,
      { [serviceId]: handler } as never,
      'https://mcp.test.local'
    );
    const app = createSiteborneMcpHonoApp({
      serviceBoundary: boundary,
      quote: {
        network: 'eip155:84532',
        asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7c',
        payee: '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1',
        now: () => new Date('2026-08-10T12:00:00.000Z'),
      },
      health: { production_ready: false, production_enabled: false },
      allowedHosts: ['test.local'],
      allowedOrigins: ['test.local'],
    });
    const client = new Client(
      { name: 'wire-conformance-audit', version: '1.0.0' },
      { versionNegotiation: { mode: { pin: MCP_PROTOCOL_VERSION } } }
    );
    await client.connect(
      new StreamableHTTPClientTransport(new URL('http://test.local/mcp'), {
        fetch: async (input, init) => {
          const headers = new Headers(init?.headers);
          headers.set('Host', 'test.local');
          return app.fetch(new Request(input, { ...init, headers }));
        },
      })
    );
    try {
      return await client.callTool({
        name: tool,
        arguments: frozenInputExample(serviceId) as Record<string, unknown>,
      });
    } finally {
      await client.close();
    }
  }

  it('control: a full governed PCC document passes the SDK output validation through the production adapter', async () => {
    const r = await callViaMcp(
      'verify_agent_output.v2',
      'siteborne_verify_agent_output',
      frozenOutputExample('verify_agent_output.v2')
    );
    expect(r.isError).not.toBe(true);
    expect(r.structuredContent).toEqual(frozenOutputExample('verify_agent_output.v2'));
  }, 60_000);

  it.each(CASES)(
    'the real MCP SDK accepts the proposed self-verifying PCC for $serviceId',
    async (c) => {
      const artifact = await referenceFor(c);
      const r = await callViaMcp(c.serviceId, MCP_TOOL_BY_SERVICE[c.serviceId], artifact.wireBody);
      expect(r.isError).not.toBe(true);
      expect(r.structuredContent).toEqual(artifact.wireBody);
    },
    60_000
  );

  it.each(CASES.map((c) => [c.serviceId, MCP_TOOL_BY_SERVICE[c.serviceId]] as const))(
    'the real released flat receipt of %s is REJECTED by the MCP SDK output validation (after the already-settled call)',
    async (serviceId, tool) => {
      const chain = await chainFor(CASES.find((c) => c.serviceId === serviceId) as ExecutorCase);
      const r = (await callViaMcp(serviceId, tool as string, chain.body)) as {
        isError?: boolean;
        content?: Array<{ type: string; text: string }>;
      };
      expect(r.isError).toBe(true);
      const text = r.content?.[0]?.text ?? '';
      expect(
        text.startsWith(`Output validation error: Invalid structured content for tool ${tool}: `)
      ).toBe(true);
      // The exact governed-PCC required fields the body lacks (from the SDK's own report):
      for (const f of [
        'pcc_version',
        'contract',
        'subject',
        'claims',
        'evidence',
        'provenance',
        'verification',
        'receipt',
      ]) {
        expect(text).toContain(`data must have required property '${f}'`);
      }
    },
    60_000
  );
});
