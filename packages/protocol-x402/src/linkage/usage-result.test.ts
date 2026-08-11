import { describe, expect, it } from 'vitest';
import { buildUsageResult, UsageExceedsAuthorizationError } from './usage-result';
import type { UsageResultInput } from './usage-result';

function baseInput(overrides: Partial<UsageResultInput> = {}): UsageResultInput {
  return {
    quote_id: 'qte_' + '1'.repeat(24),
    requirement_id: 'req_' + '1'.repeat(24),
    payment_identifier: 'pay_' + '1'.repeat(28),
    service_id: 'document_evidence_json.v1',
    service_version: 'v1',
    request_input_hash: 'sha256:' + '1'.repeat(64),
    service_output_hash: 'sha256:' + '2'.repeat(64),
    verification_receipt_id: 'rcpt_' + '1'.repeat(24),
    verification_receipt_hash: 'sha256:' + '4'.repeat(64),
    resource_metrics_hash: 'sha256:' + '3'.repeat(64),
    pricing_source_version: '1.0.0',
    actual_amount: '100000',
    authorized_maximum: '190000',
    ...overrides,
  };
}

describe('buildUsageResult', () => {
  it('produces a `usg_` prefixed deterministic ID', async () => {
    const result = await buildUsageResult(baseInput());
    expect(result.usage_result_id).toMatch(/^usg_[a-f0-9]{24}$/);
  });

  it('is deterministic for identical input', async () => {
    const a = await buildUsageResult(baseInput());
    const b = await buildUsageResult(baseInput());
    expect(a.usage_result_hash).toBe(b.usage_result_hash);
  });

  it('allows actual_amount === authorized_maximum', async () => {
    const result = await buildUsageResult(baseInput({ actual_amount: '190000' }));
    expect(result.usage_result_id).toBeDefined();
  });

  it('throws UsageExceedsAuthorizationError when actual exceeds the maximum', async () => {
    await expect(
      buildUsageResult(baseInput({ actual_amount: '999999', authorized_maximum: '190000' }))
    ).rejects.toThrow(UsageExceedsAuthorizationError);
  });

  it.each([
    ['request_input_hash', 'sha256:' + '9'.repeat(64)],
    ['service_output_hash', 'sha256:' + '9'.repeat(64)],
    ['verification_receipt_id', 'rcpt_' + '9'.repeat(24)],
    ['verification_receipt_hash', 'sha256:' + '9'.repeat(64)],
    ['resource_metrics_hash', 'sha256:' + '9'.repeat(64)],
    ['actual_amount', '50000'],
  ] as const)('mutating %s changes the usage_result_hash', async (field, value) => {
    const original = await buildUsageResult(baseInput());
    const mutated = await buildUsageResult(
      baseInput({ [field]: value } as Partial<UsageResultInput>)
    );
    expect(mutated.usage_result_hash).not.toBe(original.usage_result_hash);
  });
});
