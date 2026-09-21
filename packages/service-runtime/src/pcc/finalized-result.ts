/**
 * INTERNAL finalized-result artifact (RESULT-FINALIZATION-INTERNAL-ARTIFACT-01).
 *
 * One shared artifact for all four executors. It separates
 *
 *   SEMANTIC RESULT STATE  (serviceOutput, finalExtension, pccDocument,
 *                           verifierResults, governed metadata, vNext preimage)
 * from
 *   PUBLIC WIRE REPRESENTATION (wireBody — still the current flat receipt).
 *
 * Runtime and persistence logic consume the typed state; nothing reverse-parses
 * wireBody. This module is NOT part of any public contract: it is exported for
 * in-repo runtime use only and is never serialized onto a response.
 *
 * Lifecycle (enforced by types + freezing, see freezeSemanticSnapshot):
 *
 *   final service extension -> Unicode-scalar validation -> semantic snapshot
 *   (deep-frozen, hashed) -> proof phase (vNext preimage, legacy receipt link
 *   inputs). A SemanticSnapshot can only be produced by freezeSemanticSnapshot,
 *   and the proof phase re-hashes it and refuses a snapshot whose bytes drifted.
 *
 * The vNext preimage built here is UNSIGNED and unpublished. Public vNext
 * signing and the public proof namespace are a later cutover checkpoint.
 */
import {
  canonicalize,
  contentHash,
  type MeshVerdict,
  type VerificationMode,
  type VerificationReceipt,
  type VerificationResult,
} from '@siteborne/verification';
import {
  assertKnownFindingCode,
  assertKnownServiceFailureCode,
  assertKnownVerifierFailureCode,
} from './code-vocabulary';
import type { PccDocument } from './document-types';
import {
  getGovernedMetadata,
  isPlaceholderHash,
  type GovernedResultMetadata,
} from './governed-metadata';
import { assertFiniteNumbers, assertUnicodeScalarValues } from './unicode-scalar';
import type { ServiceFailureCode, ServiceId } from '../types';

export type DeepReadonly<T> = T extends (infer U)[]
  ? ReadonlyArray<DeepReadonly<U>>
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

/** Domain separator of the (future) vNext receipt preimage. */
export const VNEXT_PROOF_DOMAIN = 'SITEBORNE-PCC-VERIFICATION-PROOF-V1' as const;

export type SemanticPccDocument<K extends string, E> = Omit<PccDocument<K, E>, 'receipt'>;

export interface GovernedVerifierResult {
  verifier_id: string;
  status: string;
  findings: Array<{ code: string; severity: string }>;
  failure_codes: string[];
}

export interface ReceiptPreimageVNext {
  domain: typeof VNEXT_PROOF_DOMAIN;
  proof_version: '1.0.0';
  receipt_version: '2.0.0';
  job_id: string;
  request_id: string;
  service_id: string;
  service_version: string;
  contract_release: string;
  pcc_schema_release: string;
  pcc_schema_hash: string;
  input_hash: string;
  output_schema_hash: string;
  output_hash: string;
  pcc_document_hash: string;
  evidence_hash: string;
  policy_hash: string;
  verifier_set_hash: string;
  decision: string;
  completeness: number;
  verification_mode: VerificationMode;
  limitations: string[];
  signing_key_id: string;
  canonicalization_algorithm: 'RFC8785-JCS';
  signature_algorithm: 'Ed25519';
  issued_at: string;
}

/** Exactly what persistLinkEvidence needs from proof state — never read off wireBody. */
export interface LinkEvidenceInputs {
  readonly receiptId: string;
  readonly signingKeyId: string;
  readonly signature: string;
  /** Hash of the representation delivered to the buyer (today: the flat receipt). */
  readonly buyerReceiptHash: string;
}

const SNAPSHOT_BRAND: unique symbol = Symbol('SemanticSnapshot');

export interface SemanticSnapshot<K extends string, E> {
  readonly [SNAPSHOT_BRAND]: true;
  readonly serviceOutput: DeepReadonly<E>;
  readonly finalExtension: DeepReadonly<E>;
  readonly pccDocument: DeepReadonly<SemanticPccDocument<K, E>>;
  readonly governed: GovernedResultMetadata;
  readonly finalExtensionHash: string;
  readonly pccDocumentHash: string;
}

export interface InternalResultArtifact<K extends string = string, E = unknown> {
  readonly artifactVersion: 1;
  /** Extension exactly as the service produced it, before verdict-dependent finalization. */
  readonly serviceOutput: DeepReadonly<E>;
  /** Final service extension (outcome/score/etc. included). Proof-bearing. */
  readonly finalExtension: DeepReadonly<E>;
  /** Semantic PCC projection: no top-level receipt, no proof namespace. */
  readonly pccDocument: DeepReadonly<SemanticPccDocument<K, E>>;
  /** The receipt as issued for the current (legacy) wire representation. */
  readonly verificationReceipt: DeepReadonly<VerificationReceipt>;
  readonly verifierResults: ReadonlyArray<DeepReadonly<GovernedVerifierResult>>;
  readonly governed: GovernedResultMetadata;
  /** Unsigned vNext preimage, its JCS text, and the receipt_id it would yield. */
  readonly proofPreimage: {
    readonly preimage: DeepReadonly<ReceiptPreimageVNext>;
    readonly canonicalPreimage: string;
    readonly futureReceiptId: string;
  };
  readonly serviceFailureCode?: ServiceFailureCode;
  readonly linkEvidenceInputs: LinkEvidenceInputs;
  /** Current public successful representation, unchanged this checkpoint. */
  readonly wireBody: DeepReadonly<VerificationReceipt>;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value as DeepReadonly<T>;
}

async function canonicalHash(value: unknown): Promise<string> {
  return contentHash(canonicalize(value));
}

export class SemanticSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SemanticSnapshotError';
  }
}

export interface FreezeSemanticSnapshotParams<K extends string, E> {
  draft: PccDocument<K, E>;
  finalExtension: E;
  verification: PccDocument<K, E>['verification'];
  serviceId: ServiceId;
}

/**
 * Semantic-finalization boundary. Everything whose meaning is part of the
 * result must be final before this is called; afterwards the state is deep-
 * frozen and hashed and only the proof phase may consume it.
 */
export async function freezeSemanticSnapshot<K extends string, E>(
  params: FreezeSemanticSnapshotParams<K, E>
): Promise<SemanticSnapshot<K, E>> {
  const governed = getGovernedMetadata(params.serviceId);
  const extensionKey = Object.keys(params.draft.extensions)[0] as K;
  if (Object.keys(params.draft.extensions).length !== 1) {
    throw new SemanticSnapshotError('expected_exactly_one_service_extension');
  }

  assertFiniteNumbers(params.draft, '$.draft');
  assertFiniteNumbers(params.finalExtension, '$.finalExtension');
  const serviceOutput = cloneJson(params.draft.extensions[extensionKey]) as E;
  const finalExtension = cloneJson(params.finalExtension);
  const { receipt: _legacyReceipt, ...withoutReceipt } = cloneJson(params.draft);
  void _legacyReceipt;
  const pccDocument = {
    ...withoutReceipt,
    contract: {
      ...withoutReceipt.contract,
      input_schema_hash: governed.inputSchemaHash,
      output_schema_hash: governed.outputSchemaHash,
    },
    verification: cloneJson(params.verification),
    extensions: { [extensionKey]: finalExtension } as { [P in K]: E },
  } as SemanticPccDocument<K, E>;

  assertUnicodeScalarValues(serviceOutput, '$.serviceOutput');
  assertUnicodeScalarValues(pccDocument, '$.pccDocument');

  const finalExtensionHash = await canonicalHash(finalExtension);
  const pccDocumentHash = await canonicalHash(pccDocument);

  return Object.freeze({
    [SNAPSHOT_BRAND]: true as const,
    serviceOutput: deepFreeze(serviceOutput),
    finalExtension: deepFreeze(finalExtension),
    pccDocument: deepFreeze(pccDocument),
    governed,
    finalExtensionHash,
    pccDocumentHash,
  }) as SemanticSnapshot<K, E>;
}

export function projectVerifierResults(
  results: readonly VerificationResult[]
): GovernedVerifierResult[] {
  return results.map((result) => {
    for (const finding of result.findings) assertKnownFindingCode(finding.code);
    for (const code of result.failure_codes) assertKnownVerifierFailureCode(code);
    return {
      verifier_id: result.verifier_id,
      status: result.status,
      findings: result.findings.map((finding) => ({
        code: finding.code,
        severity: finding.severity,
      })),
      failure_codes: [...result.failure_codes],
    };
  });
}

async function verifierSetHashOf(results: readonly GovernedVerifierResult[]): Promise<string> {
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

async function evidenceHashOf(evidence: ReadonlyArray<{ content_hash?: string }>): Promise<string> {
  const hashes = evidence
    .map((entry) => entry.content_hash)
    .filter((hash): hash is string => typeof hash === 'string')
    .sort();
  return canonicalHash(hashes);
}

export interface BuildInternalResultArtifactParams<K extends string, E> {
  snapshot: SemanticSnapshot<K, E>;
  receipt: VerificationReceipt;
  verdict: MeshVerdict;
  requestId: string;
  verificationMode: VerificationMode;
  serviceFailureCode?: ServiceFailureCode;
}

/** Proof phase: consumes a frozen snapshot; never mutates semantic state. */
export async function buildInternalResultArtifact<K extends string, E>(
  params: BuildInternalResultArtifactParams<K, E>
): Promise<InternalResultArtifact<K, E>> {
  const { snapshot, receipt } = params;
  if (!snapshot || snapshot[SNAPSHOT_BRAND] !== true) {
    throw new SemanticSnapshotError('proof_phase_requires_frozen_semantic_snapshot');
  }
  // Fail closed if the frozen snapshot no longer hashes to what was frozen.
  if (
    (await canonicalHash(snapshot.finalExtension)) !== snapshot.finalExtensionHash ||
    (await canonicalHash(snapshot.pccDocument)) !== snapshot.pccDocumentHash
  ) {
    throw new SemanticSnapshotError('semantic_snapshot_changed_after_freeze');
  }
  if (params.serviceFailureCode !== undefined) {
    assertKnownServiceFailureCode(params.serviceFailureCode);
  }

  const { governed } = snapshot;
  for (const hash of [
    governed.policyHash,
    governed.pccSchemaHash,
    governed.inputSchemaHash,
    governed.outputSchemaHash,
    snapshot.pccDocument.contract.input_schema_hash,
    snapshot.pccDocument.contract.output_schema_hash,
  ]) {
    if (isPlaceholderHash(hash))
      throw new SemanticSnapshotError('placeholder_hash_in_internal_state');
  }

  const verifierResults = projectVerifierResults(params.verdict.results);
  const contract = snapshot.pccDocument.contract;
  const preimage: ReceiptPreimageVNext = {
    domain: VNEXT_PROOF_DOMAIN,
    proof_version: '1.0.0',
    receipt_version: '2.0.0',
    job_id: snapshot.pccDocument.job_id,
    request_id: params.requestId,
    service_id: contract.service_id,
    service_version: contract.service_version,
    contract_release: governed.contractRelease,
    pcc_schema_release: governed.pccSchemaRelease,
    pcc_schema_hash: governed.pccSchemaHash,
    input_hash: contract.input_hash,
    output_schema_hash: governed.outputSchemaHash,
    output_hash: snapshot.finalExtensionHash,
    pcc_document_hash: snapshot.pccDocumentHash,
    evidence_hash: await evidenceHashOf(snapshot.pccDocument.evidence),
    policy_hash: governed.policyHash,
    verifier_set_hash: await verifierSetHashOf(verifierResults),
    decision: snapshot.pccDocument.verification.decision,
    completeness: snapshot.pccDocument.verification.completeness,
    verification_mode: params.verificationMode,
    // Governed failure codes only; raw verifier limitation prose can carry buyer material.
    limitations: [...new Set(verifierResults.flatMap((r) => r.failure_codes))].sort(),
    signing_key_id: receipt.signing_key_id,
    canonicalization_algorithm: 'RFC8785-JCS',
    signature_algorithm: 'Ed25519',
    issued_at: receipt.issued_at,
  };
  assertUnicodeScalarValues(preimage, '$.preimage');
  const canonicalPreimage = canonicalize(preimage);
  const futureReceiptId = `rcpt_${(await contentHash(canonicalPreimage)).slice('sha256:'.length, 'sha256:'.length + 24)}`;

  const wireBody = deepFreeze(cloneJson(receipt));
  return deepFreeze({
    artifactVersion: 1 as const,
    serviceOutput: snapshot.serviceOutput,
    finalExtension: snapshot.finalExtension,
    pccDocument: snapshot.pccDocument,
    verificationReceipt: cloneJson(receipt),
    verifierResults,
    governed,
    proofPreimage: { preimage, canonicalPreimage, futureReceiptId },
    ...(params.serviceFailureCode ? { serviceFailureCode: params.serviceFailureCode } : {}),
    linkEvidenceInputs: {
      receiptId: receipt.receipt_id,
      signingKeyId: receipt.signing_key_id,
      signature: receipt.signature,
      buyerReceiptHash: await canonicalHash(wireBody),
    },
    wireBody,
  }) as unknown as InternalResultArtifact<K, E>;
}

/** Runtime guard used at trust boundaries that receive an artifact as `unknown`. */
export function parseLinkEvidenceInputs(value: unknown): LinkEvidenceInputs {
  const record = value as Record<string, unknown> | null;
  if (
    !record ||
    typeof record !== 'object' ||
    typeof record.receiptId !== 'string' ||
    typeof record.signingKeyId !== 'string' ||
    record.signingKeyId.length === 0 ||
    typeof record.signature !== 'string' ||
    record.signature.length === 0 ||
    typeof record.buyerReceiptHash !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/.test(record.buyerReceiptHash)
  ) {
    throw new Error('settled requires typed link evidence inputs');
  }
  return {
    receiptId: record.receiptId,
    signingKeyId: record.signingKeyId,
    signature: record.signature,
    buyerReceiptHash: record.buyerReceiptHash,
  };
}
