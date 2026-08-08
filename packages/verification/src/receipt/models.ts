/**
 * Verification receipt. The signed fields are exactly the frozen PCC
 * `receipt` block (schemas/proof-carrying-context.schema.json#/definitions/receipt)
 * plus the additional bindings SUN-0500 requires (job/service/contract
 * identity, verifier-set hash, decision) — so this receipt is directly
 * usable as a PCC document's `receipt` block by a later composition layer,
 * not a parallel, incompatible format.
 */
import type { VerificationDecision } from '../types';

export interface ReceiptPreimage {
  receipt_version: string;
  job_id: string;
  request_id: string;
  service_id: string;
  service_version: string;
  contract_release: string;
  pcc_schema_release: string;
  pcc_schema_hash: string;
  input_hash: string;
  output_hash: string;
  evidence_hash: string; // canonical hash of the sorted evidence-hash list (see identity.ts)
  policy_hash: string;
  verifier_set_hash: string; // canonical hash of the sorted per-verifier result hashes
  decision: VerificationDecision;
  completeness: number;
  verification_mode: 'standard' | 'independent_reproduction';
  limitations: string[];
  signing_key_id: string;
  canonicalization_algorithm: 'RFC8785-JCS';
  signature_algorithm: 'Ed25519';
  issued_at: string;
}

export interface VerificationReceipt extends ReceiptPreimage {
  receipt_id: string;
  signature: string; // base64url, 64-byte Ed25519 signature
}
