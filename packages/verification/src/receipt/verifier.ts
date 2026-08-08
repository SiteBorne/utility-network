import { canonicalize } from '../canonical';
import type { KeyRegistry } from './key-registry';
import { computeReceiptId } from './identity';
import type { ReceiptPreimage, VerificationReceipt } from './models';
import { verifyBytes } from './signer';

export type ReceiptVerificationStatus =
  | 'valid'
  | 'invalid_signature'
  | 'unknown_key'
  | 'revoked_key'
  | 'expired_key_policy_failure'
  | 'receipt_id_mismatch'
  | 'context_mismatch'
  | 'malformed_receipt'
  | 'unsupported_algorithm';

export interface ExpectedContext {
  service_id?: string;
  contract_release?: string;
  output_hash?: string;
  policy_hash?: string;
}

export interface ReceiptVerificationResult {
  status: ReceiptVerificationStatus;
  detail?: string;
}

/**
 * Pure local receipt verification — no network access. Checks structure,
 * algorithm, key validity, canonical preimage reconstruction, signature,
 * receipt ID, and optional expected-context binding.
 */
export async function verifyReceipt(
  receipt: VerificationReceipt,
  registry: KeyRegistry,
  expectedContext?: ExpectedContext
): Promise<ReceiptVerificationResult> {
  if (receipt.signature_algorithm !== 'Ed25519') {
    return { status: 'unsupported_algorithm', detail: receipt.signature_algorithm };
  }
  if (!receipt.receipt_id || !receipt.signature || !receipt.signing_key_id) {
    return { status: 'malformed_receipt' };
  }

  const keyRecord = registry.get(receipt.signing_key_id);
  if (!keyRecord) return { status: 'unknown_key', detail: receipt.signing_key_id };
  if (keyRecord.status === 'revoked')
    return { status: 'revoked_key', detail: receipt.signing_key_id };
  if (!registry.canVerifyWith(receipt.signing_key_id)) {
    return { status: 'expired_key_policy_failure', detail: receipt.signing_key_id };
  }

  const { signature, receipt_id, ...preimage } = receipt;
  const typedPreimage = preimage as ReceiptPreimage;

  const expectedId = await computeReceiptId(typedPreimage);
  if (expectedId !== receipt_id) {
    return { status: 'receipt_id_mismatch', detail: `expected ${expectedId}, got ${receipt_id}` };
  }

  if (expectedContext) {
    if (expectedContext.service_id && expectedContext.service_id !== receipt.service_id) {
      return { status: 'context_mismatch', detail: 'service_id' };
    }
    if (
      expectedContext.contract_release &&
      expectedContext.contract_release !== receipt.contract_release
    ) {
      return { status: 'context_mismatch', detail: 'contract_release' };
    }
    if (expectedContext.output_hash && expectedContext.output_hash !== receipt.output_hash) {
      return { status: 'context_mismatch', detail: 'output_hash' };
    }
    if (expectedContext.policy_hash && expectedContext.policy_hash !== receipt.policy_hash) {
      return { status: 'context_mismatch', detail: 'policy_hash' };
    }
  }

  const message = new TextEncoder().encode(canonicalize(typedPreimage));
  let sigBytes: Uint8Array;
  try {
    sigBytes = Uint8Array.from(Buffer.from(signature, 'base64url'));
  } catch {
    return { status: 'malformed_receipt', detail: 'signature not valid base64url' };
  }

  const valid = await verifyBytes(sigBytes, message, keyRecord.public_key);
  if (!valid) return { status: 'invalid_signature' };

  return { status: 'valid' };
}
