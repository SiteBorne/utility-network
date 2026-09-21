import {
  canonicalize,
  contentHash,
  signBytes,
  verifyBytes,
  type KeyRegistry,
  type Signer,
} from '@siteborne/verification';
import { assertKnownFindingCode, assertKnownVerifierFailureCode } from './code-vocabulary';
import { assertUnicodeScalarValues } from './unicode-scalar';
import { getGovernedMetadata } from './governed-metadata';
import type {
  DeepReadonly,
  GovernedVerifierResult,
  ReceiptPreimageVNext,
  SemanticPccDocument,
} from './finalized-result';

export const PCC_PROOF_NAMESPACE = 'net.siteborne.verification-proof.v1' as const;

export interface VNextReceipt extends ReceiptPreimageVNext {
  receipt_id: string;
  signature: string;
}

export interface VNextProof {
  proof_version: '1.0.0';
  receipt: VNextReceipt;
  verification_material: { verifier_results: GovernedVerifierResult[] };
}

export type SelfVerifyingPcc = Record<string, unknown> & {
  pcc_version: string;
  contract: {
    service_id: string;
    service_version: string;
    input_hash: string;
    output_schema_hash: string;
  };
  verification: { decision: string; completeness: number; score: number };
  evidence: Array<{ content_hash?: string }>;
  receipt: Record<string, unknown>;
  extensions: Record<string, unknown> & { [PCC_PROOF_NAMESPACE]: VNextProof };
};

export interface BuiltVNextPcc {
  readonly receipt: DeepReadonly<VNextReceipt>;
  readonly wireBody: DeepReadonly<SelfVerifyingPcc>;
  readonly buyerReceiptHash: string;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function canonicalHash(value: unknown): Promise<string> {
  assertUnicodeScalarValues(value);
  return contentHash(canonicalize(value));
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}_must_be_object`);
  }
  return value as Record<string, unknown>;
}

function serviceExtensionKey(pcc: SelfVerifyingPcc): string {
  const keys = Object.keys(pcc.extensions).filter((key) => key !== PCC_PROOF_NAMESPACE);
  if (keys.length !== 1) throw new Error(`expected_one_service_extension_got_${keys.length}`);
  return keys[0];
}

export function projectVNextDocument(pcc: SelfVerifyingPcc): Record<string, unknown> {
  const { receipt: _receipt, ...projected } = clone(pcc);
  void _receipt;
  const extensions: Record<string, unknown> = clone(projected.extensions);
  delete extensions[PCC_PROOF_NAMESPACE];
  return { ...projected, extensions };
}

function receiptPreimage(receipt: VNextReceipt): ReceiptPreimageVNext {
  const { receipt_id: _receiptId, signature: _signature, ...preimage } = clone(receipt);
  void _receiptId;
  void _signature;
  return preimage;
}

async function receiptId(preimage: ReceiptPreimageVNext): Promise<string> {
  const digest = await canonicalHash(preimage);
  return `rcpt_${digest.slice('sha256:'.length, 'sha256:'.length + 24)}`;
}

function receiptProjection(receipt: VNextReceipt): Record<string, unknown> {
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

async function evidenceHash(pcc: SelfVerifyingPcc): Promise<string> {
  return canonicalHash(
    pcc.evidence
      .map((entry) => entry.content_hash)
      .filter((hash): hash is string => typeof hash === 'string')
      .sort()
  );
}

async function verifierSetHash(results: readonly GovernedVerifierResult[]): Promise<string> {
  const hashes = await Promise.all(
    results.map((result) =>
      canonicalHash({
        verifier_id: result.verifier_id,
        status: result.status,
        findings: result.findings,
        failure_codes: result.failure_codes,
      })
    )
  );
  return canonicalHash(hashes.sort());
}

export async function buildSelfVerifyingPcc<K extends string, E>(params: {
  semanticPcc: DeepReadonly<SemanticPccDocument<K, E>>;
  preimage: ReceiptPreimageVNext;
  verifierResults: GovernedVerifierResult[];
  signer: Signer;
}): Promise<BuiltVNextPcc> {
  assertUnicodeScalarValues(params.semanticPcc, '$.semanticPcc');
  assertUnicodeScalarValues(params.preimage, '$.preimage');
  const expectedReceiptId = await receiptId(params.preimage);
  const signature = Buffer.from(
    await signBytes(
      new TextEncoder().encode(canonicalize(params.preimage)),
      params.signer.privateKey
    )
  ).toString('base64url');
  const receipt: VNextReceipt = {
    ...clone(params.preimage),
    receipt_id: expectedReceiptId,
    signature,
  };
  const wire = clone(params.semanticPcc) as unknown as SelfVerifyingPcc;
  wire.extensions[PCC_PROOF_NAMESPACE] = {
    proof_version: '1.0.0',
    receipt,
    verification_material: { verifier_results: clone(params.verifierResults) },
  };
  wire.receipt = receiptProjection(receipt);
  assertUnicodeScalarValues(wire, '$.wireBody');
  return {
    receipt: Object.freeze(receipt),
    wireBody: wire,
    buyerReceiptHash: await canonicalHash(wire),
  };
}

export interface VNextVerificationResult {
  valid: boolean;
  errors: string[];
}

export async function verifySelfVerifyingPcc(
  input: SelfVerifyingPcc,
  keyRegistry: KeyRegistry
): Promise<VNextVerificationResult> {
  const pcc = clone(input);
  const errors: string[] = [];
  try {
    assertUnicodeScalarValues(pcc);
    const proof = pcc.extensions[PCC_PROOF_NAMESPACE];
    const receipt = proof.receipt;
    const preimage = receiptPreimage(receipt);
    const governed = getGovernedMetadata(
      receipt.service_id as Parameters<typeof getGovernedMetadata>[0]
    );

    for (const result of proof.verification_material.verifier_results) {
      for (const finding of result.findings) assertKnownFindingCode(finding.code);
      for (const code of result.failure_codes) assertKnownVerifierFailureCode(code);
    }
    if (proof.proof_version !== receipt.proof_version) errors.push('proof_version_mismatch');
    if (receipt.domain !== 'SITEBORNE-PCC-VERIFICATION-PROOF-V1') errors.push('domain_mismatch');
    if (receipt.service_id !== pcc.contract.service_id) errors.push('service_id_mismatch');
    if (receipt.service_version !== pcc.contract.service_version)
      errors.push('service_version_mismatch');
    if (receipt.input_hash !== pcc.contract.input_hash) errors.push('input_hash_mismatch');
    if (receipt.output_schema_hash !== pcc.contract.output_schema_hash)
      errors.push('output_schema_hash_mismatch');
    if (receipt.contract_release !== governed.contractRelease)
      errors.push('contract_release_mismatch');
    if (receipt.pcc_schema_release !== governed.pccSchemaRelease)
      errors.push('pcc_schema_release_mismatch');
    if (receipt.pcc_schema_hash !== governed.pccSchemaHash) errors.push('pcc_schema_hash_mismatch');
    if (receipt.policy_hash !== governed.policyHash) errors.push('policy_hash_mismatch');
    if (receipt.decision !== pcc.verification.decision) errors.push('decision_mismatch');
    if (receipt.completeness !== pcc.verification.completeness)
      errors.push('completeness_mismatch');
    if ((await canonicalHash(pcc.extensions[serviceExtensionKey(pcc)])) !== receipt.output_hash)
      errors.push('output_hash_mismatch');
    if ((await canonicalHash(projectVNextDocument(pcc))) !== receipt.pcc_document_hash)
      errors.push('pcc_document_hash_mismatch');
    if ((await evidenceHash(pcc)) !== receipt.evidence_hash) errors.push('evidence_hash_mismatch');
    if (
      (await verifierSetHash(proof.verification_material.verifier_results)) !==
      receipt.verifier_set_hash
    )
      errors.push('verifier_set_hash_mismatch');
    if ((await receiptId(preimage)) !== receipt.receipt_id) errors.push('receipt_id_mismatch');
    if (canonicalize(pcc.receipt) !== canonicalize(receiptProjection(receipt)))
      errors.push('receipt_projection_mismatch');
    const key = keyRegistry.get(receipt.signing_key_id);
    if (!key || !keyRegistry.canVerifyWith(receipt.signing_key_id)) {
      errors.push('unknown_or_unusable_key');
    } else if (
      !(await verifyBytes(
        Uint8Array.from(Buffer.from(receipt.signature, 'base64url')),
        new TextEncoder().encode(canonicalize(preimage)),
        key.public_key
      ))
    ) {
      errors.push('invalid_signature');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid_vnext_proof';
    if (message.startsWith('unknown_')) errors.push(message);
    else if (message.startsWith('non_unicode_scalar')) errors.push('non_unicode_scalar');
    else errors.push('invalid_vnext_proof');
  }
  return { valid: errors.length === 0, errors };
}
