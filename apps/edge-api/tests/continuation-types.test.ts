/**
 * SUN-1221E6R-H2AWI-1a -- continuation domain types.
 *
 * These are pure structural types with no runtime behavior, so the "RED"
 * for this file is a TypeScript compile failure (module not found) before
 * `continuation/types.ts` exists, captured by running `pnpm typecheck`
 * per the plan's Task 1.1 checklist. This file's own runtime assertions
 * are a thin smoke test: each interface's exact shape type-checks via
 * `satisfies`, and a literal object of that shape round-trips through
 * JSON.stringify/JSON.parse unchanged (proving the shapes are plain JSON-
 * serializable data, matching their role as Workflow params / D1 clear
 * fields).
 */
import { describe, expect, it } from 'vitest';
import type {
  ContinuationEnvelopeMetadata,
  ContinuationEnvelopeV1,
  WorkflowContinuationInput,
  WorkflowContinuationResult,
  SettlementReconciliationResult,
} from '../src/control-plane/continuation/types';

describe('continuation domain types (SUN-1221E6R-H2AWI-1a)', () => {
  it('ContinuationEnvelopeMetadata: literal type-checks and round-trips through JSON unchanged', () => {
    const metadata = {
      job_id: 'job_1',
      payment_identifier: 'pay_1',
      service: 'web_context_verified.v2',
      network: 'eip155:8453',
      asset: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      pay_to: '0x0000000000000000000000000000000000dead',
      amount_atomic: '9000',
      valid_before_unix: 2000000000,
    } satisfies ContinuationEnvelopeMetadata;

    expect(JSON.parse(JSON.stringify(metadata))).toEqual(metadata);
  });

  it('ContinuationEnvelopeV1: literal type-checks and round-trips through JSON unchanged', () => {
    const envelope = {
      v: 1,
      key_id: 'v1',
      iv_b64: 'AAAAAAAAAAAAAAAA',
      ciphertext_b64: 'AAAA',
      aad_fingerprint: 'deadbeef',
    } satisfies ContinuationEnvelopeV1;

    expect(JSON.parse(JSON.stringify(envelope))).toEqual(envelope);
  });

  it('WorkflowContinuationInput: literal type-checks and round-trips through JSON unchanged', () => {
    const input = {
      envelope: {
        v: 1,
        key_id: 'v1',
        iv_b64: 'AAAAAAAAAAAAAAAA',
        ciphertext_b64: 'AAAA',
        aad_fingerprint: 'deadbeef',
      },
      metadata: {
        job_id: 'job_1',
        payment_identifier: 'pay_1',
        service: 'web_context_verified.v2',
        network: 'eip155:8453',
        asset: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
        pay_to: '0x0000000000000000000000000000000000dead',
        amount_atomic: '9000',
        valid_before_unix: 2000000000,
      },
      request_id: 'req_1',
    } satisfies WorkflowContinuationInput;

    expect(JSON.parse(JSON.stringify(input))).toEqual(input);
  });

  it('WorkflowContinuationResult: literal type-checks (minimal, optional fields omitted) and round-trips through JSON', () => {
    const minimal = {
      status: 'settled',
      job_id: 'job_1',
    } satisfies WorkflowContinuationResult;

    expect(JSON.parse(JSON.stringify(minimal))).toEqual(minimal);
  });

  it('WorkflowContinuationResult: literal type-checks (all fields present) and round-trips through JSON', () => {
    const full = {
      status: 'settlement_ambiguous',
      job_id: 'job_1',
      receipt_id: 'rcpt_1',
      settlement_transaction_reference: '0xtransactionhash',
      error_code: 'E_AMBIGUOUS',
    } satisfies WorkflowContinuationResult;

    expect(JSON.parse(JSON.stringify(full))).toEqual(full);
  });

  it('every WorkflowTerminalStatus literal from the frozen union is assignable to WorkflowContinuationResult.status', () => {
    const statuses: WorkflowContinuationResult['status'][] = [
      'settled',
      'executor_rejected',
      'executor_timeout',
      'pcc_failed',
      'authorization_expired',
      'settlement_rejected',
      'settlement_ambiguous',
      'persistence_failed_after_settlement',
      'workflow_internal_error',
    ];

    expect(statuses).toHaveLength(9);
    expect(new Set(statuses).size).toBe(9);
  });

  it('SettlementReconciliationResult: literal type-checks for each outcome and round-trips through JSON', () => {
    const confirmed = {
      outcome: 'confirmed',
      settlement_transaction_reference: '0xtransactionhash',
      checked_at_unix: 2000000000,
    } satisfies SettlementReconciliationResult;
    expect(JSON.parse(JSON.stringify(confirmed))).toEqual(confirmed);

    const notFound = {
      outcome: 'not_found',
      checked_at_unix: 2000000000,
    } satisfies SettlementReconciliationResult;
    expect(JSON.parse(JSON.stringify(notFound))).toEqual(notFound);

    const inconclusive = {
      outcome: 'inconclusive',
      checked_at_unix: 2000000000,
    } satisfies SettlementReconciliationResult;
    expect(JSON.parse(JSON.stringify(inconclusive))).toEqual(inconclusive);
  });
});
