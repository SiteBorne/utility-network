/**
 * LOCAL-ONLY executable reference model for RESULT-WIRE-BODY-DELIVERY-DESIGN-01.
 *
 * This module is intentionally under tests/support. It is not imported by any
 * Worker/runtime entrypoint and must never be treated as production wiring.
 */
import {
  canonicalize,
  contentHash,
  hashPolicy,
  loadPolicy,
  signBytes,
  verifyBytes,
  type Signer,
  type VerificationResult,
} from '@siteborne/verification';

export const PCC_PROOF_NAMESPACE = 'net.siteborne.verification-proof.v1' as const;
export const PCC_PROOF_DOMAIN = 'SITEBORNE-PCC-VERIFICATION-PROOF-V1' as const;
export const GOVERNED_PCC_SCHEMA_RELEASE = '1.1.0' as const;
export const GOVERNED_PCC_SCHEMA_HASH =
  'sha256:d32a8e25eba7a7ae4d7d7f7a14c565c1b92c8d8e10810ff885698ed102fdbcc0' as const;
export const GOVERNED_CONTRACT_RELEASE = '2.0.0' as const;

export const GOVERNED_OUTPUT_SCHEMA_HASHES = {
  'company_evidence_graph.v2':
    'sha256:5593736dfc60089aa3f01de664eb67ccba3a58e03449a66e91f477324e24861b',
  'web_context_verified.v2':
    'sha256:7d4882e997ec3a3bd97b746de36ed99dfe430d59b4d1c8adc7d9fa83a274b4e0',
  'document_evidence_json.v2':
    'sha256:df91ed115ae0e29d8f4c211d95462ddd96e9714bc5f5e0ce0b820b370e0d5dde',
  'verify_agent_output.v2':
    'sha256:a9a462b89b290ecba1aa62ec6d2fd030572f326ed79f498a43690244b38ad679',
} as const;

type JsonRecord = Record<string, unknown>;

interface CapturedSignedResult {
  document: JsonRecord;
  verdict: { decision: string; results: VerificationResult[] };
  receipt: JsonRecord;
  signer: Signer;
}

export interface PublicVerifierResult {
  verifier_id: string;
  status: string;
  findings: Array<{ code: string; severity: string }>;
  failure_codes: string[];
}

export interface ReferenceReceiptPreimage {
  domain: typeof PCC_PROOF_DOMAIN;
  proof_version: '1.0.0';
  receipt_version: '2.0.0';
  job_id: string;
  request_id: string;
  service_id: string;
  service_version: string;
  contract_release: typeof GOVERNED_CONTRACT_RELEASE;
  pcc_schema_release: typeof GOVERNED_PCC_SCHEMA_RELEASE;
  pcc_schema_hash: typeof GOVERNED_PCC_SCHEMA_HASH;
  input_hash: string;
  output_schema_hash: string;
  output_hash: string;
  pcc_document_hash: string;
  evidence_hash: string;
  policy_hash: string;
  verifier_set_hash: string;
  decision: string;
  completeness: number;
  verification_mode: string;
  limitations: string[];
  signing_key_id: string;
  canonicalization_algorithm: 'RFC8785-JCS';
  signature_algorithm: 'Ed25519';
  issued_at: string;
}

export interface ReferenceReceipt extends ReferenceReceiptPreimage {
  receipt_id: string;
  signature: string;
}

export interface ReferenceProof {
  proof_version: '1.0.0';
  receipt: ReferenceReceipt;
  verification_material: { verifier_results: PublicVerifierResult[] };
}

export interface SelfVerifyingPccArtifact {
  serviceOutput: JsonRecord;
  finalExtension: JsonRecord;
  pccDocument: JsonRecord;
  verificationReceipt: ReferenceReceipt;
  linkEvidenceInputs: {
    receiptId: string;
    signingKeyId: string;
    signature: string;
    receiptHash: string;
  };
  wireBody: JsonRecord;
}

export interface ReferenceBuildObservers {
  /** Test-only proof that the semantic snapshot is frozen before hashing/signing. */
  onSemanticFreeze?: (semanticPcc: JsonRecord) => void;
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as JsonRecord)) deepFreeze(child);
  }
  return value;
}

/**
 * RFC 8785 operates on Unicode scalar values. JavaScript strings can also
 * contain unpaired UTF-16 surrogates, which the repository's Python RFC 8785
 * implementation rejects. Reject them explicitly so signed bytes are portable
 * across the two governed verifier runtimes.
 */
export function assertUnicodeScalarValues(value: unknown, path = '$'): void {
  if (typeof value === 'string') {
    for (let index = 0; index < value.length; index += 1) {
      const codeUnit = value.charCodeAt(index);
      if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
        const trailing = value.charCodeAt(index + 1);
        if (index + 1 >= value.length || trailing < 0xdc00 || trailing > 0xdfff) {
          throw new Error(`non_unicode_scalar:${path}`);
        }
        index += 1;
      } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
        throw new Error(`non_unicode_scalar:${path}`);
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertUnicodeScalarValues(child, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as JsonRecord)) {
      assertUnicodeScalarValues(key, `${path}.<key>`);
      assertUnicodeScalarValues(child, `${path}.${key}`);
    }
  }
}

function asRecord(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}_must_be_object`);
  }
  return value as JsonRecord;
}

export function serviceExtensionKey(pcc: JsonRecord): string {
  const extensions = asRecord(pcc.extensions, 'extensions');
  const keys = Object.keys(extensions).filter((key) => key !== PCC_PROOF_NAMESPACE);
  if (keys.length !== 1) throw new Error(`expected_one_service_extension_got_${keys.length}`);
  return keys[0];
}

export function serviceOutputProjection(pcc: JsonRecord): JsonRecord {
  const extensions = asRecord(pcc.extensions, 'extensions');
  return jsonClone(asRecord(extensions[serviceExtensionKey(pcc)], 'service_extension'));
}

/** Every semantic PCC field except the receipt and proof that carry this hash. */
export function pccDocumentProjection(pcc: JsonRecord): JsonRecord {
  const projected = jsonClone(pcc);
  delete projected.receipt;
  const extensions = asRecord(projected.extensions, 'extensions');
  delete extensions[PCC_PROOF_NAMESPACE];
  return projected;
}

export async function canonicalHash(value: unknown): Promise<string> {
  assertUnicodeScalarValues(value);
  return contentHash(canonicalize(value));
}

async function computeEvidenceHash(pcc: JsonRecord): Promise<string> {
  const evidence = Array.isArray(pcc.evidence) ? pcc.evidence : [];
  const hashes = evidence
    .map((entry) => (entry as JsonRecord).content_hash)
    .filter((hash): hash is string => typeof hash === 'string')
    .sort();
  return canonicalHash(hashes);
}

function publicVerifierResults(results: readonly VerificationResult[]): PublicVerifierResult[] {
  return results.map((result) => ({
    verifier_id: result.verifier_id,
    status: result.status,
    findings: result.findings.map((finding) => ({
      code: finding.code,
      severity: finding.severity,
    })),
    failure_codes: [...result.failure_codes],
  }));
}

async function computeVerifierSetHash(results: readonly PublicVerifierResult[]): Promise<string> {
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
  hashes.sort();
  return canonicalHash(hashes);
}

export function receiptPreimage(receipt: ReferenceReceipt): ReferenceReceiptPreimage {
  const preimage = { ...receipt } as Partial<ReferenceReceipt>;
  delete preimage.receipt_id;
  delete preimage.signature;
  return preimage as ReferenceReceiptPreimage;
}

async function receiptId(preimage: ReferenceReceiptPreimage): Promise<string> {
  const digest = await canonicalHash(preimage);
  return `rcpt_${digest.slice('sha256:'.length, 'sha256:'.length + 24)}`;
}

function topLevelReceiptProjection(receipt: ReferenceReceipt): JsonRecord {
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

export async function buildSelfVerifyingPcc(
  captured: CapturedSignedResult,
  observers: ReferenceBuildObservers = {}
): Promise<SelfVerifyingPccArtifact> {
  const pcc = jsonClone(captured.document);
  const legacyReceipt = asRecord(captured.receipt, 'legacy_receipt');
  const mutableContract = asRecord(pcc.contract, 'contract');
  const serviceId = String(mutableContract.service_id);
  const outputSchemaHash =
    GOVERNED_OUTPUT_SCHEMA_HASHES[serviceId as keyof typeof GOVERNED_OUTPUT_SCHEMA_HASHES];
  if (!outputSchemaHash) throw new Error(`unknown_service:${serviceId}`);

  mutableContract.output_schema_hash = outputSchemaHash;
  const semanticPcc = deepFreeze(pccDocumentProjection(pcc));
  observers.onSemanticFreeze?.(semanticPcc);
  const contract = asRecord(semanticPcc.contract, 'contract');
  const verification = asRecord(semanticPcc.verification, 'verification');
  const finalExtension = serviceOutputProjection(semanticPcc);
  const verifierResults = publicVerifierResults(captured.verdict.results);
  const preimage: ReferenceReceiptPreimage = {
    domain: PCC_PROOF_DOMAIN,
    proof_version: '1.0.0',
    receipt_version: '2.0.0',
    job_id: String(semanticPcc.job_id),
    request_id: String(legacyReceipt.request_id),
    service_id: serviceId,
    service_version: String(contract.service_version),
    contract_release: GOVERNED_CONTRACT_RELEASE,
    pcc_schema_release: GOVERNED_PCC_SCHEMA_RELEASE,
    pcc_schema_hash: GOVERNED_PCC_SCHEMA_HASH,
    input_hash: String(contract.input_hash),
    output_schema_hash: outputSchemaHash,
    output_hash: await canonicalHash(finalExtension),
    pcc_document_hash: await canonicalHash(semanticPcc),
    evidence_hash: await computeEvidenceHash(semanticPcc),
    policy_hash: await hashPolicy(loadPolicy()),
    verifier_set_hash: await computeVerifierSetHash(verifierResults),
    decision: String(verification.decision),
    completeness: Number(verification.completeness),
    verification_mode: String(legacyReceipt.verification_mode),
    // Public governed codes only. Raw verifier limitation prose can contain
    // operational or buyer material and is intentionally not copied.
    limitations: [...new Set(verifierResults.flatMap((result) => result.failure_codes))].sort(),
    signing_key_id: captured.signer.keyId,
    canonicalization_algorithm: 'RFC8785-JCS',
    signature_algorithm: 'Ed25519',
    issued_at: String(legacyReceipt.issued_at),
  };
  assertUnicodeScalarValues(preimage);
  const signature = Buffer.from(
    await signBytes(new TextEncoder().encode(canonicalize(preimage)), captured.signer.privateKey)
  ).toString('base64url');
  const receipt: ReferenceReceipt = {
    ...preimage,
    receipt_id: await receiptId(preimage),
    signature,
  };
  const deliveredPcc = jsonClone(semanticPcc);
  const extensions = asRecord(deliveredPcc.extensions, 'extensions');
  extensions[PCC_PROOF_NAMESPACE] = {
    proof_version: '1.0.0',
    receipt,
    verification_material: { verifier_results: verifierResults },
  } satisfies ReferenceProof;
  deliveredPcc.receipt = topLevelReceiptProjection(receipt);

  const frozenPcc = deepFreeze(deliveredPcc);
  const typedReceipt = deepFreeze(jsonClone(receipt));
  return deepFreeze({
    serviceOutput: jsonClone(finalExtension),
    finalExtension: jsonClone(finalExtension),
    pccDocument: frozenPcc,
    verificationReceipt: typedReceipt,
    linkEvidenceInputs: {
      receiptId: typedReceipt.receipt_id,
      signingKeyId: typedReceipt.signing_key_id,
      signature: typedReceipt.signature,
      receiptHash: await canonicalHash(typedReceipt),
    },
    wireBody: frozenPcc,
  });
}

export interface ReferenceVerificationResult {
  valid: boolean;
  errors: string[];
}

/** Buyer-side verification using only the delivered PCC and a public key. */
export async function verifySelfVerifyingPcc(
  deliveredInput: JsonRecord,
  publicKey: Uint8Array
): Promise<ReferenceVerificationResult> {
  const delivered = jsonClone(deliveredInput);
  const errors: string[] = [];
  const extensions = asRecord(delivered.extensions, 'extensions');
  const proof = asRecord(extensions[PCC_PROOF_NAMESPACE], 'proof') as unknown as ReferenceProof;
  const receipt = proof.receipt;
  const preimage = receiptPreimage(receipt);
  const contract = asRecord(delivered.contract, 'contract');
  const verification = asRecord(delivered.verification, 'verification');

  try {
    assertUnicodeScalarValues(delivered);
  } catch {
    errors.push('non_unicode_scalar');
    return { valid: false, errors };
  }

  if (proof.proof_version !== receipt.proof_version) errors.push('proof_version_mismatch');
  if (receipt.domain !== PCC_PROOF_DOMAIN) errors.push('domain_mismatch');
  if (receipt.service_id !== contract.service_id) errors.push('service_id_mismatch');
  if (receipt.service_version !== contract.service_version) errors.push('service_version_mismatch');
  if (receipt.input_hash !== contract.input_hash) errors.push('input_hash_mismatch');
  if (receipt.output_schema_hash !== contract.output_schema_hash)
    errors.push('output_schema_hash_mismatch');
  if (receipt.decision !== verification.decision) errors.push('decision_mismatch');
  if (receipt.completeness !== verification.completeness) errors.push('completeness_mismatch');
  if ((await canonicalHash(serviceOutputProjection(delivered))) !== receipt.output_hash)
    errors.push('output_hash_mismatch');
  if ((await canonicalHash(pccDocumentProjection(delivered))) !== receipt.pcc_document_hash)
    errors.push('pcc_document_hash_mismatch');
  if ((await computeEvidenceHash(delivered)) !== receipt.evidence_hash)
    errors.push('evidence_hash_mismatch');
  if (
    (await computeVerifierSetHash(proof.verification_material.verifier_results)) !==
    receipt.verifier_set_hash
  )
    errors.push('verifier_set_hash_mismatch');
  if ((await receiptId(preimage)) !== receipt.receipt_id) errors.push('receipt_id_mismatch');
  if (canonicalize(delivered.receipt) !== canonicalize(topLevelReceiptProjection(receipt)))
    errors.push('receipt_projection_mismatch');
  if (
    !(await verifyBytes(
      Uint8Array.from(Buffer.from(receipt.signature, 'base64url')),
      new TextEncoder().encode(canonicalize(preimage)),
      publicKey
    ))
  )
    errors.push('invalid_signature');
  return { valid: errors.length === 0, errors };
}

export function replayWireBody(artifact: SelfVerifyingPccArtifact): JsonRecord {
  return jsonClone(artifact.wireBody);
}

export type HistoricalResultClassification =
  | { kind: 'LEGACY_RECEIPT_ONLY'; body: JsonRecord }
  | { kind: 'SELF_VERIFYING_PCC_VNEXT'; body: JsonRecord };

export function classifyStoredResult(body: JsonRecord): HistoricalResultClassification {
  const isPcc =
    typeof body.pcc_version === 'string' &&
    body.extensions !== null &&
    typeof body.extensions === 'object' &&
    PCC_PROOF_NAMESPACE in (body.extensions as JsonRecord);
  return {
    kind: isPcc ? 'SELF_VERIFYING_PCC_VNEXT' : 'LEGACY_RECEIPT_ONLY',
    body: jsonClone(body),
  };
}
