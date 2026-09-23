/**
 * Shared, generic plumbing for the "real production-path local REST
 * vertical slice" harnesses (`company-evidence-graph-v3-rest-harness.test.ts`,
 * `web-context-verified-v3-rest-harness.test.ts`, and any future one).
 *
 * This is a MECHANICAL EXTRACTION of the pieces of
 * `company-evidence-graph-v3-rest-harness.test.ts` that are genuinely
 * generic across v3 candidate services: local Miniflare D1/R2 setup, the
 * fixture `PaymentEvidenceProvider` + spy wiring, the bridging
 * `WorkflowBindingLike` (stage PCC in real R2 -> real fixture
 * verify/settle -> real D1 result write -> mark job DELIVERED), and the
 * REST 402/pay request helpers. Nothing here changes behavior versus the
 * original inline company-harness code; it is the same logic, parameterized
 * over `serviceId`/`executor` instead of hardcoding `company_evidence_graph.v3`.
 *
 * Deliberately NOT extracted (stays service-specific in each harness file):
 * the executor construction itself, the request body shape, and any
 * service-specific assertions (PCC extension shape, schema hashes, etc).
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { Hono } from 'hono';
import {
  FixturePaymentEvidenceProvider,
  buildBuyerPaymentIdentifierExtensions,
  decodePaymentRequiredHeaderSafe,
  encodePaymentSignatureHeaderSafe,
} from '@siteborne/protocol-x402';
import type {
  ExternalSettlementEvidence,
  ExternalVerificationEvidence,
  PaymentEvidenceProvider,
  PaymentRequired,
  PaymentSettlementContext,
  PaymentVerificationContext,
} from '@siteborne/protocol-x402';
import type {
  WorkflowBindingLike,
  WorkflowInstanceLike,
} from '../../src/control-plane/continuation/handoff';
import type { PccResultArtifactStore } from '../../src/control-plane/results/pcc-result-artifact';
import { X402ServiceResultRepository } from '../../src/control-plane/repositories/d1/x402-quotes';
import type { ServiceExecutor } from '../../src/control-plane/routes/x402-service';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../migrations', import.meta.url));

/** Runs every `.sql` file in `/migrations` against a fresh Miniflare D1
 * database, in filename order -- identical logic to the original
 * company-harness `runMigrations`. */
export async function runMigrations(db: D1Database): Promise<void> {
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const statement of sql
      .split(';')
      .map((raw) =>
        raw
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.length > 0 && !l.startsWith('--'))
          .join(' ')
          .trim()
      )
      .filter((s) => s.length > 0)) {
      await db.exec(statement);
    }
  }
}

export function randomPrivateKeyHex(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface MiniflareD1R2Harness {
  tempDir: string;
  mf: Miniflare;
  db: D1Database;
  r2: R2Bucket;
}

/** Real local Miniflare D1 + R2, with migrations applied. Caller is
 * responsible for calling `teardownMiniflareD1R2` in `afterAll`. */
export async function setupMiniflareD1R2(dirPrefix: string): Promise<MiniflareD1R2Harness> {
  const tempDir = mkdtempSync(join(tmpdir(), dirPrefix));
  const mf = new Miniflare({
    modules: true,
    script: `export default { async fetch() { return new Response('OK'); } }`,
    d1Databases: ['DB'],
    r2Buckets: ['ARTIFACTS'],
    resourcePersistencePath: tempDir,
  });
  const db = await mf.getD1Database('DB');
  const r2 = (await mf.getR2Bucket('ARTIFACTS')) as unknown as R2Bucket;
  await db.exec('PRAGMA foreign_keys = ON');
  await runMigrations(db);
  return { tempDir, mf, db, r2 };
}

export async function teardownMiniflareD1R2(harness: MiniflareD1R2Harness): Promise<void> {
  await harness.mf.dispose();
  rmSync(harness.tempDir, { recursive: true, force: true });
}

/** Inserts the minimal `services` catalog row a candidate service needs to
 * exist for foreign-key-constrained tables (jobs, x402_service_results). */
export async function insertCandidateServiceRow(db: D1Database, serviceId: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO services (id, version, title, description, input_schema, output_schema, price_usd)
       VALUES (?, 'v3', 'candidate', 'candidate', '{}', '{}', '0')`
    )
    .bind(serviceId)
    .run();
}

export class CompletedInstance implements WorkflowInstanceLike {
  constructor(
    readonly id: string,
    private readonly output: unknown
  ) {}
  async status() {
    return { status: 'complete' as const, output: this.output };
  }
}

export function buyerPayload(challenge: PaymentRequired) {
  return {
    x402Version: 2 as const,
    resource: challenge.resource,
    accepted: challenge.accepts[0]!,
    payload: { synthetic_signature: 'synthetic:buyer-fixture' },
    extensions: buildBuyerPaymentIdentifierExtensions(challenge.extensions ?? {}),
  };
}

export async function get402(app: Hono, path: string, body: unknown): Promise<PaymentRequired> {
  const res = await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status !== 402) {
    const errBody = await res.clone().text();
    throw new Error(`expected 402 got ${res.status}: ${errBody}`);
  }
  const decoded = decodePaymentRequiredHeaderSafe(res.headers.get('PAYMENT-REQUIRED')!);
  if (!decoded.ok) throw new Error('failed to decode PAYMENT-REQUIRED header');
  return decoded.value;
}

/** Builds the PAYMENT-SIGNATURE header exactly once per logical payment so
 * a caller can replay the identical request (same payment_identifier, same
 * header) rather than accidentally minting a fresh payment_identifier on
 * every call -- `buildBuyerPaymentIdentifierExtensions` generates a new
 * random identifier each time it's invoked without an explicit id. */
export function buildPaymentSignatureHeader(challenge: PaymentRequired): string {
  return encodePaymentSignatureHeaderSafe(buyerPayload(challenge));
}

export function pay(app: Hono, path: string, header: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': header },
    body: JSON.stringify(body),
  });
}

export interface FixtureEvidenceSpies {
  settleSpy: ReturnType<typeof vi.fn>;
  verifySpy: ReturnType<typeof vi.fn>;
  evidenceProvider: PaymentEvidenceProvider;
}

/** A real `FixturePaymentEvidenceProvider`, wrapped in spies so a harness
 * can assert invocation counts (replay must never re-invoke verify/settle). */
export function buildFixtureEvidenceSpies(): FixtureEvidenceSpies {
  const settleSpy = vi.fn(
    (
      context: PaymentSettlementContext,
      verificationEvidence: ExternalVerificationEvidence,
      actualAmount: string
    ): Promise<ExternalSettlementEvidence> =>
      new FixturePaymentEvidenceProvider().settle(context, verificationEvidence, actualAmount)
  );
  const verifySpy = vi.fn((context: PaymentVerificationContext) =>
    new FixturePaymentEvidenceProvider().verify(context)
  );
  const evidenceProvider: PaymentEvidenceProvider = {
    providerKind: 'fixture',
    verify: verifySpy,
    settle: settleSpy,
  };
  return { settleSpy, verifySpy, evidenceProvider };
}

export interface WorkflowBindingHarness {
  workflow: WorkflowBindingLike;
  getCreateCalls: () => number;
  getGetCalls: () => number;
}

/**
 * Builds the bridging fake `WorkflowBindingLike` common to every v3 REST
 * harness: `create()` invokes the caller-supplied real executor exactly
 * once, stages the resulting vNext PCC in real R2
 * (`PccResultArtifactStore.stage`), performs one real fixture
 * verify+settle call, writes the resulting `SELF_VERIFYING_PCC_VNEXT`
 * result reference to real D1, and marks the job `DELIVERED` -- then
 * reports the instance `complete`. See the top-of-file doc comment (and
 * each harness's own doc comment) for why this workflow seam is
 * deliberately simplified rather than exercising the real Cloudflare
 * Workflow's own CAS/settlement-repository/reconciliation machinery.
 */
export function buildWorkflowBinding(params: {
  db: D1Database;
  serviceId: string;
  nowIso: string;
  resultArtifacts: PccResultArtifactStore;
  evidenceProvider: PaymentEvidenceProvider;
  runExecutor: (args: { job_id: string; request_id: string }) => ReturnType<ServiceExecutor>;
  harnessLabel: string;
}): WorkflowBindingHarness {
  const { db, serviceId, nowIso, resultArtifacts, evidenceProvider, runExecutor, harnessLabel } =
    params;
  const instances = new Map<string, CompletedInstance>();
  const createCalls: string[] = [];
  const getCalls: string[] = [];

  async function createImpl(
    id: string,
    createParams: {
      metadata: {
        payment_identifier: string;
        network: string;
        amount_atomic: string;
        pay_to: string;
        asset: string;
      };
      request_id: string;
    }
  ): Promise<CompletedInstance> {
    createCalls.push(id);
    if (instances.has(id)) throw new Error(`Workflow instance ${id} already exists`);
    const jobRow = await db
      .prepare('SELECT id FROM jobs WHERE idempotency_key = ?')
      .bind(createParams.metadata.payment_identifier)
      .first<{ id: string }>();
    if (!jobRow) throw new Error(`${harnessLabel}: job row missing for payment`);
    const jobId = jobRow.id;

    const outcome = await runExecutor({ job_id: jobId, request_id: createParams.request_id });
    if (outcome.result.result_class !== 'success') {
      throw new Error(`${harnessLabel}: executor did not succeed (${outcome.result.result_class})`);
    }
    const representation = outcome.resultRepresentation;
    if (!representation || !('body' in representation)) {
      throw new Error(`${harnessLabel}: no vNext PCC body on executor outcome`);
    }
    const reference = await resultArtifacts.stage({
      jobId,
      serviceId,
      pcc: representation.body,
      createdAt: nowIso,
    });

    const verificationEvidence = await evidenceProvider.verify({
      x402Version: 2,
      scheme: 'exact',
      network: createParams.metadata.network as PaymentVerificationContext['network'],
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
        service_id: serviceId as PaymentSettlementContext['service_id'],
        service_version: 'v3',
        scheme: 'exact',
        network: createParams.metadata.network as PaymentSettlementContext['network'],
        asset: createParams.metadata.asset,
        payee: createParams.metadata.pay_to,
        quote_id: 'quote_harness',
        requirement_id: 'requirement_harness',
        payment_identifier: createParams.metadata.payment_identifier,
        amount: createParams.metadata.amount_atomic,
        nowIso,
        expiresAt: nowIso,
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
      nowIso
    );
    await db
      .prepare("UPDATE jobs SET current_state = 'DELIVERED', updated_at = ? WHERE id = ?")
      .bind(nowIso, jobId)
      .run();

    const instance = new CompletedInstance(id, {
      status: 'settled',
      job_id: jobId,
      receipt_id: reference.content_hash,
    });
    instances.set(id, instance);
    return instance;
  }

  const workflow: WorkflowBindingLike = {
    async create({ id, params }) {
      try {
        return await createImpl(id, params as never);
      } catch (err) {
        console.error(`${harnessLabel}: workflow.create() failed:`, err);
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

  return {
    workflow,
    getCreateCalls: () => createCalls.length,
    getGetCalls: () => getCalls.length,
  };
}
