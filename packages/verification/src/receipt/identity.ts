import { canonicalize, contentHash } from '../canonical';
import type { VerificationResult } from '../types';
import type { ReceiptPreimage } from './models';

/**
 * Canonical hash of a sorted list of per-verifier result hashes — chosen
 * over a Merkle tree (see ADR: verifier-result binding). At today's mesh
 * size (single digits of verifiers), a Merkle tree's partial-disclosure
 * benefit (proving one verifier's result without revealing the rest) has
 * no current consumer, while a Merkle implementation adds real complexity
 * (tree construction, proof serialization, proof verification) for no
 * exercised benefit. A sorted canonical-hash list still gives deterministic
 * order-independent binding and full tamper-evidence of the result set.
 */
export async function verifierSetHash(results: readonly VerificationResult[]): Promise<string> {
  const perVerifierHashes = await Promise.all(
    results.map((r) =>
      contentHash(
        canonicalize({
          verifier_id: r.verifier_id,
          status: r.status,
          findings: r.findings,
          failure_codes: r.failure_codes,
        })
      )
    )
  );
  perVerifierHashes.sort();
  return contentHash(canonicalize(perVerifierHashes));
}

export async function evidenceSetHash(evidenceHashes: readonly string[]): Promise<string> {
  const sorted = [...evidenceHashes].sort();
  return contentHash(canonicalize(sorted));
}

/**
 * Deterministic pre-signature receipt identity: a stable prefix plus a
 * digest of the canonical unsigned receipt material (everything except
 * `signature` itself, which cannot be part of its own identity). Identical
 * verification material always produces the same receipt_id; any mutation
 * to bound fields changes it; signer key rotation does not alter the
 * identity of already-issued receipt material.
 */
export async function computeReceiptId(preimage: ReceiptPreimage): Promise<string> {
  const digest = await contentHash(canonicalize(preimage));
  const short = digest.replace('sha256:', '').slice(0, 24);
  return `rcpt_${short}`;
}
