/**
 * SUN-1221E6R-H2B2-R4 — durable receipt persistence.
 *
 * H2B2-R3A proved a real production gap: the signed PCC/receipt document
 * (`PccValidationResult.pcc`) was never durably persisted anywhere.
 * `D1ResultReceiptPersistence.persistReceipt` only wrote a completion
 * marker (`{kind, receipt_persisted, receipt_id}`), and the Workflow
 * instance's own step-history output -- the only place the real signed
 * document existed -- gets truncated by Cloudflare's own
 * `workflows instances describe` API before the signature field, with no
 * flag able to raise that limit (server-side, not a CLI display
 * artifact). A receipt that is signed but never durably retrievable is,
 * for verification/audit purposes, indistinguishable from one that was
 * never signed at all.
 *
 * This file drives the REAL `D1ResultReceiptPersistence` class (exported
 * for this test, mocking nothing else) against a minimal in-memory D1
 * fake that only implements the two query shapes
 * `X402ServiceResultRepository` actually issues.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { D1ResultReceiptPersistence } from './production-dependencies';
import { X402ServiceResultRepository } from '../repositories/d1/x402-quotes';

/** Minimal in-memory D1 fake -- one row per `job_id`, matching
 * `x402_service_results`'s real shape closely enough to drive
 * `X402ServiceResultRepository` unmodified. Not a general D1 emulator;
 * only implements the two statement shapes that repository issues. */
class FakeD1 {
  private rows = new Map<string, { result_json: string; created_at: string }>();

  prepare(sql: string) {
    const trimmed = sql.trim();
    return {
      bind: (...args: unknown[]) => ({
        run: async () => {
          if (trimmed.startsWith('INSERT INTO x402_service_results')) {
            const [jobId, , resultJson, createdAt] = args as [string, string, string, string];
            this.rows.set(jobId, { result_json: resultJson, created_at: createdAt });
          } else if (trimmed.startsWith('UPDATE x402_service_results')) {
            const [resultJson, createdAt, jobId] = args as [string, string, string];
            this.rows.set(jobId, { result_json: resultJson, created_at: createdAt });
          } else {
            throw new Error(`FakeD1: unsupported statement for .run(): ${trimmed}`);
          }
          return { success: true };
        },
        all: async () => {
          if (!trimmed.startsWith('SELECT result_json FROM x402_service_results')) {
            throw new Error(`FakeD1: unsupported statement for .all(): ${trimmed}`);
          }
          const [jobId] = args as [string];
          const row = this.rows.get(jobId);
          return { success: true, results: row ? [row] : [] };
        },
      }),
    };
  }

  /** Test-only inspection hook -- not part of the D1Database surface. */
  rawRow(jobId: string) {
    return this.rows.get(jobId);
  }
}

const REAL_PCC = {
  receipt_version: '1.0.0',
  job_id: 'job_78299eef2e8609dbf53d01cf',
  request_id: '296fe53e-693b-4d2d-8d28-9dc423b23cf1',
  service_id: 'web_context_verified.v2',
  decision: 'pass',
  completeness: 1,
  signing_key_id: 'kid_0ea0e04e294f20fc78b2b155',
  canonical_hash: 'sha256:deadbeef',
  signature: 'AAAA-base64url-signature-bytes-BBBB',
};

const CANONICAL_CACHED_RESPONSE = {
  status: 200,
  body: {
    service_id: 'web_context_verified.v2',
    result_class: 'success',
    output: { title: 'example' },
    receipt_id: 'rcpt_paid_result',
    link_id: 'link_paid_result',
    link_hash: 'sha256:' + 'a'.repeat(64),
  },
  settleResponse: {
    success: true,
    transaction: '0xsettled',
    network: 'eip155:8453',
    amount: '9000',
  },
};

describe('SUN-1221E6R-H2B2-R4: D1ResultReceiptPersistence durable PCC persistence', () => {
  let d1: FakeD1;
  let results: X402ServiceResultRepository;
  let persistence: D1ResultReceiptPersistence;

  beforeEach(() => {
    d1 = new FakeD1();
    results = new X402ServiceResultRepository(d1 as never);
    persistence = new D1ResultReceiptPersistence(results);
  });

  it('RED-proof (documents the pre-fix defect): a receipt persisted without `pcc` durably stores null, never the signed document -- this is what H2B2-R2/R3 actually persisted', async () => {
    await persistence.persistReceipt({
      jobId: 'job-legacy-no-pcc',
      paymentIdentifier: 'pay_legacy',
    });
    const raw = d1.rawRow('job-legacy-no-pcc');
    const parsed = JSON.parse(raw!.result_json);
    expect(parsed.pcc).toBeNull();
  });

  it('GREEN: persistReceipt durably stores the full signed PCC/receipt document verbatim in result_json', async () => {
    const outcome = await persistence.persistReceipt({
      jobId: 'job-with-pcc',
      paymentIdentifier: 'pay_with_pcc',
      pcc: REAL_PCC,
    });
    expect(outcome.status).toBe('written');

    const raw = d1.rawRow('job-with-pcc');
    const parsed = JSON.parse(raw!.result_json);
    expect(parsed.kind).toBe('workflow_receipt');
    expect(parsed.receipt_persisted).toBe(true);
    expect(parsed.pcc).toEqual(REAL_PCC);
  });

  it('preserves the canonical reconstructable HTTP result when adding the durable signed receipt', async () => {
    await persistence.persistResult({
      jobId: 'job-canonical-result',
      paymentIdentifier: 'pay_canonical_result',
      settlementTransactionReference: '0xsettled',
      // RED against the pre-fix adapter, which silently ignores this
      // canonical response and later overwrites the row with a receipt-
      // only marker.
      cachedResult: CANONICAL_CACHED_RESPONSE,
    } as never);
    await persistence.persistReceipt({
      jobId: 'job-canonical-result',
      paymentIdentifier: 'pay_canonical_result',
      pcc: REAL_PCC,
    });

    const persisted = await results.getByJobId<Record<string, unknown>>('job-canonical-result');
    expect(persisted).toMatchObject(CANONICAL_CACHED_RESPONSE);
    expect(persisted?.pcc).toEqual(REAL_PCC);
  });

  it('WORKFLOW_OUTPUT_INDEPENDENCE: the persisted receipt is retrievable and byte-exact via getByJobId alone, with no dependence on Workflow step-history output', async () => {
    await persistence.persistReceipt({
      jobId: 'job-independence',
      paymentIdentifier: 'pay_independence',
      pcc: REAL_PCC,
    });

    // Retrieval path a verifier would actually use -- getByJobId, the
    // same D1 read every other consumer of this table uses. No access
    // to any Workflow instance/step object anywhere in this test.
    const retrieved = await results.getByJobId<{ pcc: unknown }>('job-independence');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.pcc).toEqual(REAL_PCC);
  });

  it('IDEMPOTENCY: calling persistReceipt twice for the same identity leaves exactly one row with the same signed document, never overwritten by a second call', async () => {
    const first = await persistence.persistReceipt({
      jobId: 'job-idempotent',
      paymentIdentifier: 'pay_idempotent',
      pcc: REAL_PCC,
    });
    expect(first.status).toBe('written');

    const differentPcc = { ...REAL_PCC, signature: 'DIFFERENT-SIGNATURE-should-never-be-stored' };
    const second = await persistence.persistReceipt({
      jobId: 'job-idempotent',
      paymentIdentifier: 'pay_idempotent',
      pcc: differentPcc,
    });
    expect(second.status).toBe('already_written');
    expect(second.receiptId).toBe(first.receiptId);

    const raw = d1.rawRow('job-idempotent');
    const parsed = JSON.parse(raw!.result_json);
    expect(parsed.pcc).toEqual(REAL_PCC);
    expect(parsed.pcc.signature).not.toBe('DIFFERENT-SIGNATURE-should-never-be-stored');
  });

  it('mutation-proof: if `input.pcc` is silently dropped (regressing to the pre-fix defect), this test catches it', async () => {
    await persistence.persistReceipt({
      jobId: 'job-mutation-check',
      paymentIdentifier: 'pay_mutation_check',
      pcc: REAL_PCC,
    });
    const raw = d1.rawRow('job-mutation-check');
    const parsed = JSON.parse(raw!.result_json);
    // A regression that stops writing `pcc` at all makes this fail.
    expect(parsed.pcc).not.toBeNull();
    expect(parsed.pcc.signature).toBe(REAL_PCC.signature);
  });
});
