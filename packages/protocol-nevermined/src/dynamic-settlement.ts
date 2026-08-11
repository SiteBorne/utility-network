import type { UsageResult } from '@siteborne/protocol-x402';

export type NeverminedUsageSettlementPreparation =
  | {
      ok: true;
      actualAmount: string;
      authorizedMaximum: string;
      settlementAmount: string;
      usageResultHash: string;
    }
  | { ok: false; code: 'authorization_exceeded' | 'invalid_usage_result' };

export function prepareNeverminedUsageSettlement(
  usageResult: UsageResult
): NeverminedUsageSettlementPreparation {
  if (
    usageResult.service_id !== 'document_evidence_json.v1' ||
    !/^\d+$/.test(usageResult.actual_amount) ||
    !/^\d+$/.test(usageResult.authorized_maximum)
  ) {
    return { ok: false, code: 'invalid_usage_result' };
  }
  if (BigInt(usageResult.actual_amount) > BigInt(usageResult.authorized_maximum)) {
    return { ok: false, code: 'authorization_exceeded' };
  }
  return {
    ok: true,
    actualAmount: usageResult.actual_amount,
    authorizedMaximum: usageResult.authorized_maximum,
    settlementAmount: usageResult.actual_amount,
    usageResultHash: usageResult.usage_result_hash,
  };
}
