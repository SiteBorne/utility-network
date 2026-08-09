import type { VerificationReceipt } from '@siteborne/verification';
import type { PccReceiptBlock } from './document-types';

/**
 * Maps a @siteborne/verification VerificationReceipt (SUN-0500, ADR 0032 —
 * a superset binding job/service/verifier-set identity) onto the frozen
 * PCC `receipt` block (schemas/proof-carrying-context.schema.json#/definitions/receipt),
 * which only wants the 8 fields relevant to a standalone signature check.
 * The two field renames (`pcc_schema_hash` -> `schema_hash`,
 * `issued_at` -> `signed_at`) are the only difference; nothing here signs
 * or re-derives anything — this is a pure, lossy projection for embedding.
 */
export function toPccReceiptBlock(receipt: VerificationReceipt): PccReceiptBlock {
  return {
    output_hash: receipt.output_hash,
    canonicalization_algorithm: receipt.canonicalization_algorithm,
    policy_hash: receipt.policy_hash,
    schema_hash: receipt.pcc_schema_hash,
    signature_algorithm: receipt.signature_algorithm,
    signing_key_id: receipt.signing_key_id,
    signature: receipt.signature,
    signed_at: receipt.issued_at,
  };
}
