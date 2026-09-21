/**
 * SECURITY-AUTHORITY-SA1-RESULT-BODY-INTEGRITY-READONLY-AUDIT-01 --
 * characterization of what is ALREADY persisted about the released result body.
 *
 * Read-only audit. These tests assert existing behavior only; nothing here adds
 * or changes production behavior. Everything is produced by production code (the
 * real Workflow orchestration, the real production executor + signer, the real
 * `validateExecutorPcc`, the real `D1ResultReceiptPersistence`, the real
 * `D1PaymentFinalizationRepository.persistLinkEvidence`) over a tiny D1 fake.
 * Expected hash values are computed by an INDEPENDENT canonicalizer + node:crypto,
 * never by the helper under test.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildProductionSigner, verifyServiceReceipt } from '@siteborne/service-runtime';
import type { VerificationReceipt } from '@siteborne/verification';
import { hashPaymentObject } from '@siteborne/protocol-x402';
import { runPaidContinuationWorkflow } from '../src/control-plane/workflows/paid-continuation-workflow';
import {
  D1ResultReceiptPersistence,
  validateExecutorPcc,
} from '../src/control-plane/workflows/production-dependencies';
import { X402ServiceResultRepository } from '../src/control-plane/repositories/d1/x402-quotes';
import { D1PaymentFinalizationRepository } from '../src/control-plane/repositories/d1/payment-finalization';
import { buildVerifyAgentOutputV2ProductionExecutor } from '../src/control-plane/production/verify-agent-output-v2-production-executor';
import { FakeWorkflowStep } from './support/fake-workflow-step';
import {
  buildDecryptedPayload,
  buildTestDependencies,
  buildTestMetadata,
  sealTestInput,
  TEST_JOB_ID,
  TEST_PAYMENT_IDENTIFIER,
} from './support/paid-continuation-workflow-fixtures';

/** Independent JCS-style canonicalizer for the flat, string/number/array shapes
 * the receipt uses: sorted keys, no whitespace. Deliberately not the repo's. */
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

/** Fake for `x402_service_results` (the two statement shapes the repo issues). */
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

/** Fake for the three statements `persistLinkEvidence` issues. Models
 * `ON CONFLICT(payment_attempt_id) DO NOTHING`: the FIRST insert is retained and
 * the read-back returns the stored row, so the repository's conflict guard is
 * genuinely exercised (a second, different insert must be detected). */
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
          if (this.insertArgs === null) this.insertArgs = a; // DO NOTHING on conflict
          return { success: true };
        },
      }),
    };
  }
}

const EXECUTOR_INPUT = {
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

async function runRealChain() {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const { signer, registry } = await buildProductionSigner(hex, 'kid_prod0123456789abcdefghij');
  const executor = buildVerifyAgentOutputV2ProductionExecutor(signer, registry);
  const base = await buildTestDependencies({ executor, validatePcc: validateExecutorPcc });

  const resultsD1 = new FakeResultsD1();
  const linkD1 = new FakeLinkD1();
  const realResults = new D1ResultReceiptPersistence(
    new X402ServiceResultRepository(resultsD1 as never)
  );
  const realLinks = new D1PaymentFinalizationRepository(linkD1 as never);
  let afterPersistResult: string | undefined;
  let linkInput: Parameters<typeof realLinks.persistLinkEvidence>[0] | undefined;

  const deps = {
    ...base,
    persistence: {
      job: base.persistence.job,
      resultReceipt: {
        persistResult: async (i: Parameters<typeof realResults.persistResult>[0]) => {
          const r = await realResults.persistResult(i);
          afterPersistResult = resultsD1.rows.get(TEST_JOB_ID);
          return r;
        },
        persistReceipt: (i: Parameters<typeof realResults.persistReceipt>[0]) =>
          realResults.persistReceipt(i),
      },
      finalization: {
        recordProviderFailure: (i: never) => base.finalizationPersistence.recordProviderFailure(i),
        recordSettlementFinalizationUnresolved: (i: never) =>
          base.finalizationPersistence.recordSettlementFinalizationUnresolved(i),
        persistLinkEvidence: (i: Parameters<typeof realLinks.persistLinkEvidence>[0]) => {
          linkInput = i;
          return realLinks.persistLinkEvidence(i);
        },
        finalizeSettled: (p: string) => base.finalizationPersistence.finalizeSettled(p),
      },
    },
  };
  const metadata = buildTestMetadata();
  const input = await sealTestInput(metadata, {
    key: base.envelopeKey,
    payload: buildDecryptedPayload(metadata, { executorInput: EXECUTOR_INPUT as never }),
  });
  const result = await runPaidContinuationWorkflow(
    { payload: input },
    new FakeWorkflowStep(),
    deps as never
  );
  const raw = resultsD1.rows.get(TEST_JOB_ID) as string;
  return {
    result,
    raw,
    afterPersistResult,
    insertArgs: linkD1.insertArgs as unknown[],
    resultsD1,
    registry,
    realLinks,
    linkInput: linkInput as Parameters<typeof realLinks.persistLinkEvidence>[0],
  };
}

describe('RESULT-BODY-INTEGRITY-READONLY-AUDIT-01: persisted anchors vs the released body (Workflow path)', () => {
  it('runs the real chain to a settled result and persists one row and one link-evidence record', async () => {
    const { result, raw, insertArgs } = await runRealChain();
    expect(result.status).toBe('settled');
    expect(typeof raw).toBe('string');
    expect(insertArgs).not.toBeNull();
    expect(insertArgs[1]).toBe(TEST_PAYMENT_IDENTIFIER);
  });

  it('buyer_receipt_hash and verification_receipt_hash both equal an independent hash of the released body', async () => {
    const { raw, insertArgs } = await runRealChain();
    const released = (JSON.parse(raw) as { body: unknown }).body; // what reconstructFromJob releases
    const expected = indepHash(released);
    const verificationReceiptHash = insertArgs[10]; // column order in persistLinkEvidence INSERT
    const buyerReceiptHash = insertArgs[13];
    expect(buyerReceiptHash).toBe(expected);
    expect(verificationReceiptHash).toBe(expected);
    expect(expected).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('the released body is the flat signed VerificationReceipt: it carries no service output and no PCC document fields', async () => {
    const { raw } = await runRealChain();
    const body = (JSON.parse(raw) as { body: Record<string, unknown> }).body;
    expect(Object.keys(body).sort()).toEqual([
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
    ]);
    for (const k of ['output', 'contract', 'pcc_version', 'claims', 'evidence', 'extensions']) {
      expect(k in body).toBe(false);
    }
  });

  it('service_output_hash is not a hash of the released body: the anchor and the output hash are different values', async () => {
    const { raw, insertArgs } = await runRealChain();
    const body = (JSON.parse(raw) as { body: { output_hash: string } }).body;
    // Both originate from the same executor result, so equality here is a wiring
    // fact (the signed output_hash is what the link stores), not independent proof.
    expect(insertArgs[8]).toBe(body.output_hash);
    // The independent point: it is a different value from the body anchor.
    expect(insertArgs[8]).not.toBe(indepHash(body));
    expect(insertArgs[8]).not.toBe(insertArgs[13]);
  });

  it('the body is unchanged by the post-persist rewrite (persistReceipt): no TOCTOU between persistResult and finalize', async () => {
    const { raw, afterPersistResult } = await runRealChain();
    const before = JSON.parse(afterPersistResult as string) as { body: unknown; pcc?: unknown };
    const after = JSON.parse(raw) as {
      body: unknown;
      pcc: unknown;
      durableEvidence: { pcc: unknown };
    };
    expect(before.pcc).toBeUndefined(); // the rewrite really did add fields...
    expect(after.pcc).toBeDefined();
    expect(indepCanonical(after.body)).toBe(indepCanonical(before.body)); // ...but not to body
    expect(indepCanonical(after.pcc)).toBe(indepCanonical(after.body));
    expect(indepCanonical(after.durableEvidence.pcc)).toBe(indepCanonical(after.body));
  });

  it('the anchor matches an independent hash of the stored body, and a one-field change no longer matches (sanity)', async () => {
    const { raw, insertArgs } = await runRealChain();
    const body = (JSON.parse(raw) as { body: Record<string, unknown> }).body;
    expect(indepHash(body)).toBe(insertArgs[13]);
    for (const k of [
      'decision',
      'output_hash',
      'signature',
      'job_id',
      'completeness',
      'limitations',
    ]) {
      const mutated = {
        ...body,
        [k]: k === 'limitations' ? [...(body[k] as string[]), 'x'] : `${String(body[k])}!`,
      };
      expect(indepHash(mutated)).not.toBe(insertArgs[13]);
    }
  });

  it('the production hash function reproduces the same value from the row read back (persist-time vs release-time)', async () => {
    const { raw, insertArgs } = await runRealChain();
    const released = (JSON.parse(raw) as { body: unknown }).body;
    expect(await hashPaymentObject(released)).toBe(insertArgs[13]);
  });
});

describe('RESULT-BODY-INTEGRITY-READONLY-AUDIT-01: limits of the existing anchors', () => {
  it('the anchor is unkeyed (a forged body has a freely recomputable hash) but the Ed25519 signature rejects the forgery', async () => {
    const { raw, insertArgs, registry } = await runRealChain();
    const body = (JSON.parse(raw) as { body: Record<string, unknown> }).body;
    const forged = { ...body, decision: 'forged' };
    // No secret is needed to recompute the anchor for a forged body.
    expect(indepHash(forged)).not.toBe(insertArgs[13]);
    expect(indepHash(forged)).toMatch(/^sha256:[0-9a-f]{64}$/);
    // The real signature verification is the only asymmetric protection.
    const genuine = await verifyServiceReceipt({
      receipt: body as unknown as VerificationReceipt,
      keyRegistry: registry,
      expectedServiceId: 'verify_agent_output.v2',
    });
    const tampered = await verifyServiceReceipt({
      receipt: forged as unknown as VerificationReceipt,
      keyRegistry: registry,
      expectedServiceId: 'verify_agent_output.v2',
    });
    expect(genuine.valid).toBe(true);
    expect(tampered.valid).toBe(false);
  });

  it('persistLinkEvidence rejects a second, different receipt for the same attempt (the only place the anchor is compared)', async () => {
    const { linkInput, realLinks } = await runRealChain();
    const changed = {
      ...linkInput,
      linkEvidenceInputs: {
        ...linkInput.linkEvidenceInputs!,
        buyerReceiptHash: indepHash({ forged: true }),
      },
    };
    await expect(realLinks.persistLinkEvidence(changed)).rejects.toThrow(
      'conflicting durable link/receipt evidence'
    );
    // Idempotent re-persist of the identical receipt is accepted.
    await expect(realLinks.persistLinkEvidence(linkInput)).resolves.toBeUndefined();
  });

  it('X402ServiceResultRepository.finalize replaces the whole row: a pending draft (output_hash, receipt_hash) is not retained', async () => {
    const d1 = new FakeResultsD1();
    const repo = new X402ServiceResultRepository(d1 as never);
    await repo.create(
      'job_n',
      'pay_n',
      {
        kind: 'nevermined_settlement_pending_draft',
        output_hash: 'sha256:' + 'a'.repeat(64),
        receipt_hash: 'sha256:' + 'b'.repeat(64),
      },
      't0'
    );
    await repo.finalize(
      'job_n',
      {
        status: 200,
        body: { output: { x: 1 }, link_hash: 'sha256:' + 'c'.repeat(64) },
        settleResponse: {},
      },
      't1'
    );
    const after = JSON.parse(d1.rows.get('job_n') as string) as Record<string, unknown>;
    expect(Object.keys(after).sort()).toEqual(['body', 'settleResponse', 'status']);
    expect(JSON.stringify(after)).not.toContain('receipt_hash');
    expect('durableEvidence' in after).toBe(false);
  });

  it('the governed canonicalizer collapses an own __proto__ key: structurally different values share one hash', async () => {
    const hostile = JSON.parse('{"__proto__":{"x":1},"a":1}') as unknown;
    expect(Object.keys(hostile as object)).toContain('__proto__');
    expect(await hashPaymentObject(hostile)).toBe(await hashPaymentObject({ a: 1 }));
  });
});
