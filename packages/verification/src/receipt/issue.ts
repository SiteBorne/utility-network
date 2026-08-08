import { canonicalize, contentHash } from '../canonical';
import type { CandidateResult, VerificationContext } from '../types';
import type { MeshVerdict } from '../mesh';
import { computeReceiptId, evidenceSetHash, verifierSetHash } from './identity';
import type { ReceiptPreimage, VerificationReceipt } from './models';
import { signBytes } from './signer';

export interface Signer {
  keyId: string;
  privateKey: Uint8Array;
}

export async function issueReceipt(
  candidate: CandidateResult,
  context: VerificationContext,
  verdict: MeshVerdict,
  signer: Signer
): Promise<VerificationReceipt> {
  const outputHash = await contentHash(canonicalize(candidate.output));
  const evidenceHash = await evidenceSetHash(
    candidate.evidence.map((e) => e.content_hash).filter((h): h is string => Boolean(h))
  );
  const verifierHash = await verifierSetHash(verdict.results);

  const preimage: ReceiptPreimage = {
    receipt_version: '1.0.0',
    job_id: candidate.job_id,
    request_id: context.request_id,
    service_id: candidate.service_id,
    service_version: candidate.service_version,
    contract_release: candidate.contract_release,
    pcc_schema_release: context.pcc_schema_release,
    pcc_schema_hash: context.pcc_schema_hash,
    input_hash: candidate.input_hash,
    output_hash: outputHash,
    evidence_hash: evidenceHash,
    policy_hash: context.policy_hash,
    verifier_set_hash: verifierHash,
    decision: verdict.decision,
    completeness: verdict.verification.completeness,
    verification_mode: context.mode,
    limitations: verdict.results.flatMap((r) => r.limitations).slice(0, 20),
    signing_key_id: signer.keyId,
    canonicalization_algorithm: 'RFC8785-JCS',
    signature_algorithm: 'Ed25519',
    issued_at: context.clock.nowIso(),
  };

  const receiptId = await computeReceiptId(preimage);
  const message = new TextEncoder().encode(canonicalize(preimage));
  const sigBytes = await signBytes(message, signer.privateKey);
  const signature = Buffer.from(sigBytes).toString('base64url');

  context.audit.emit({
    type: 'receipt_created',
    details: { receipt_id: receiptId },
    correlation_id: context.request_id,
  });
  context.audit.emit({
    type: 'receipt_signed',
    details: { receipt_id: receiptId, key_id: signer.keyId },
    correlation_id: context.request_id,
  });

  return { ...preimage, receipt_id: receiptId, signature };
}
