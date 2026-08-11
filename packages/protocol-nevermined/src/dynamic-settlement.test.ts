import { describe, expect, it, vi } from 'vitest';
import { buildUsageResult } from '@siteborne/protocol-x402';
import { prepareNeverminedUsageSettlement } from './index';

async function usage(actualAmount: string, maximum = '190000') {
  return buildUsageResult({
    quote_id: 'qte_' + '1'.repeat(24),
    requirement_id: 'req_' + '2'.repeat(24),
    payment_identifier: 'pay_' + '3'.repeat(28),
    service_id: 'document_evidence_json.v1',
    service_version: 'v1',
    request_input_hash: 'sha256:' + '4'.repeat(64),
    service_output_hash: 'sha256:' + '5'.repeat(64),
    verification_receipt_id: 'rcpt_' + '6'.repeat(24),
    verification_receipt_hash: 'sha256:' + '7'.repeat(64),
    resource_metrics_hash: 'sha256:' + '8'.repeat(64),
    pricing_source_version: '1.0.0',
    actual_amount: actualAmount,
    authorized_maximum: maximum,
  });
}

describe('Nevermined dynamic actual-amount contract', () => {
  it('settles measured one-native-page usage 12000, not the 190000 ceiling', async () => {
    expect(prepareNeverminedUsageSettlement(await usage('12000'))).toMatchObject({
      ok: true,
      actualAmount: '12000',
      authorizedMaximum: '190000',
      settlementAmount: '12000',
    });
  });

  it('rejects actual > maximum without invoking settlement or clipping', async () => {
    const settle = vi.fn();
    const valid = await usage('12000');
    const result = prepareNeverminedUsageSettlement({ ...valid, actual_amount: '190001' });
    if (result.ok) await settle(result.settlementAmount);
    expect(result).toEqual({ ok: false, code: 'authorization_exceeded' });
    expect(settle).not.toHaveBeenCalled();
  });

  it('fails closed if the UsageResult service is not the document service', async () => {
    const result = await usage('12000');
    expect(
      prepareNeverminedUsageSettlement({ ...result, service_id: 'web_context_verified.v1' })
    ).toMatchObject({ ok: false });
  });
});
