/**
 * The one shared boundary every test (and, in the future, any real
 * dispatcher-level enforcement) uses to cryptographically verify a
 * service's signed receipt. Delegates entirely to
 * @siteborne/verification's own `verifyReceipt()` — Ed25519 verification,
 * receipt-id recomputation, and key-registry policy checks are never
 * reimplemented here.
 */
import { verifyReceipt, type KeyRegistry, type VerificationReceipt } from '@siteborne/verification';

export interface VerifyServiceReceiptParams {
  receipt: VerificationReceipt;
  keyRegistry: KeyRegistry;
  expectedServiceId?: string;
  expectedContractRelease?: string;
  expectedOutputHash?: string;
  expectedPolicyHash?: string;
}

export interface ServiceReceiptVerificationResult {
  valid: boolean;
  status: string;
  detail?: string;
}

/** Cryptographically verifies a service's receipt against the expected
 * service/contract/output/policy context. This is the boundary every
 * service test (and any future dispatcher-level enforcement) should call
 * — never a bespoke per-service reimplementation. */
export async function verifyServiceReceipt(
  params: VerifyServiceReceiptParams
): Promise<ServiceReceiptVerificationResult> {
  const result = await verifyReceipt(params.receipt, params.keyRegistry, {
    service_id: params.expectedServiceId,
    contract_release: params.expectedContractRelease,
    output_hash: params.expectedOutputHash,
    policy_hash: params.expectedPolicyHash,
  });
  return { valid: result.status === 'valid', status: result.status, detail: result.detail };
}
