/**
 * The shared verify-and-sign step every service runs after building a
 * draft PCC document (directive §4's conceptual boundary: PCC construction
 * → verification mesh → signed receipt → frozen schema validation). No
 * service re-implements mesh invocation, receipt issuance, or final schema
 * validation individually.
 */
import {
  buildContext as buildVerificationContext,
  buildReproductionVerifiers,
  buildStandardVerifiers,
  getAjv,
  getOutputSchemaId,
  getPrecompiledOutputValidator,
  issueReceipt,
  runMesh,
  type CandidateResult,
  type KeyRegistry,
  type MeshVerdict,
  type ReproductionInput,
  type Signer,
  type VerificationMode,
  type VerificationReceipt,
} from '@siteborne/verification';
import type { ValidateFunction } from 'ajv';
import { toVerificationAuditSink, toVerificationClock } from '../context';
import { toCandidateClaims, toCandidateEvidence } from './candidate-conversion';
import type { PccDocument } from './document-types';
import {
  buildInternalResultArtifact,
  freezeSemanticSnapshot,
  type InternalResultArtifact,
} from './finalized-result';
import { toPccReceiptBlock } from './receipt-mapping';
import { verifyServiceReceipt } from './receipt-verification';
import type { ServiceExecutionContext } from '../types';
import { verifySelfVerifyingPcc, type SelfVerifyingPcc } from './vnext-proof';

export interface VerifyAndSignParams<TExtensionKey extends string, TExtension> {
  draft: PccDocument<TExtensionKey, TExtension>;
  context: ServiceExecutionContext;
  signer: Signer;
  /** The registry `signer`'s key is (or should be) registered in. Used
   * immediately after receipt issuance to cryptographically self-verify
   * the receipt this step is about to hand back to the caller — this is
   * the runtime enforcement boundary, not merely a test-time postcondition.
   * See docs/decisions/0040-runtime-receipt-verification-boundary.md. */
  keyRegistry: KeyRegistry;
  reproduction?: ReproductionInput | null;
  /** claim_ids that should be treated as verified-absent by the mesh; see
   * pcc/document-types.ts's PccClaim doc comment. */
  verifiedAbsentClaimIds?: ReadonlySet<string>;
  /**
   * SEMANTIC FINALIZATION HOOK. Runs after the verification mesh verdict and
   * BEFORE the semantic snapshot is frozen and any proof/hash/signature is
   * produced, so every verdict-dependent field of the service extension
   * (e.g. verify_agent_output's `outcome`/`score`) is final before proof
   * construction. It must return a new extension value; the draft is never
   * mutated. Omit for services whose extension does not depend on the verdict.
   */
  finalizeSemantics?: (verdict: MeshVerdict) => TExtension;
}

export interface VerifyAndSignResult<TExtensionKey extends string, TExtension> {
  document: PccDocument<TExtensionKey, TExtension>;
  verdict: MeshVerdict;
  outputHash: string;
  receiptId: string;
  /** The full signed receipt object — callers that need real cryptographic
   * verification (not just pattern-matching receipt_id) use this with
   * @siteborne/verification's verifyReceipt() directly, never a
   * service-runtime-local reimplementation of Ed25519 verification. */
  receipt: VerificationReceipt;
  schemaValidAfterFinalization: boolean;
  schemaErrors: string[];
  /** Whether the receipt this step just issued cryptographically
   * self-verified against `keyRegistry` (signature valid, key known and
   * not revoked, service_id/contract_release match the candidate this
   * receipt was issued for). When this is false, `verdict.decision` has
   * already been forced to `'fail'` — every service's result_class
   * computation derives from `verdict.decision`, so a service can never
   * report `success` off the back of a receipt that doesn't actually
   * verify. See the runtime-boundary ADR referenced above. */
  receiptCryptographicallyValid: boolean;
  receiptVerificationStatus: string;
  /** Mutable copy of the FINAL service extension (post semantic finalization).
   * Detached from the frozen semantic snapshot: mutating it cannot change the
   * proof-bearing state in `artifact`. */
  finalExtension: TExtension;
  /** The internal finalized-result artifact. Absent when the runtime receipt
   * self-verification failed, or when the finalized result failed its own
   * registered output schema (no proof-bearing state is produced for a
   * result whose receipt doesn't verify or whose schema rejects it). Never
   * serialized onto a response. */
  artifact?: InternalResultArtifact<TExtensionKey, TExtension>;
}

export async function verifyAndSign<TExtensionKey extends string, TExtension>(
  params: VerifyAndSignParams<TExtensionKey, TExtension>
): Promise<VerifyAndSignResult<TExtensionKey, TExtension>> {
  const { draft, context } = params;

  const candidate: CandidateResult = {
    job_id: draft.job_id,
    request_id: context.request_id,
    service_id: draft.contract.service_id,
    service_version: draft.contract.service_version,
    contract_release: context.contract_release,
    input_hash: draft.contract.input_hash,
    input_schema_hash: draft.contract.input_schema_hash,
    output_schema_hash: draft.contract.output_schema_hash,
    output: draft,
    claims: toCandidateClaims(draft.claims, params.verifiedAbsentClaimIds),
    evidence: toCandidateEvidence(draft.evidence),
    completeness: {
      requested_fields: draft.completeness.requested_fields,
      populated_fields: draft.completeness.populated_fields,
      supported_fields: draft.completeness.supported_fields,
      missing_fields: draft.completeness.missing_fields,
    },
    // Threads the contract's declared freshness_seconds into the mesh's
    // freshness_verifier, which otherwise defaults to 24h — without this,
    // a service's own freshness_seconds input would be silently ignored
    // by verification scoring.
    freshness_requirement_ms: draft.contract.freshness_seconds * 1000,
  };

  const mode: VerificationMode = context.mode;
  const verificationContext = buildVerificationContext({
    request_id: context.request_id,
    job_id: draft.job_id,
    service_id: draft.contract.service_id,
    service_version: draft.contract.service_version,
    contract_release: context.contract_release,
    pcc_schema_release: context.pcc_schema_release,
    pcc_schema_hash: context.pcc_schema_hash,
    policy_hash: context.policy_hash,
    mode,
    clock: toVerificationClock(context.clock),
    audit: toVerificationAuditSink(context.audit),
  });

  const verifiers =
    mode === 'independent_reproduction'
      ? buildReproductionVerifiers(params.reproduction ?? null)
      : buildStandardVerifiers();

  const verdict = await runMesh(verifiers, candidate, verificationContext, {
    policyId: context.policy_id,
  });

  // SEMANTIC FINALIZATION -> IMMUTABLE SNAPSHOT, strictly before any proof.
  const extensionKey = Object.keys(draft.extensions)[0] as TExtensionKey;
  const finalExtension: TExtension = params.finalizeSemantics
    ? params.finalizeSemantics(verdict)
    : (draft.extensions[extensionKey] as TExtension);
  const snapshot = await freezeSemanticSnapshot({
    draft,
    finalExtension,
    verification: verdict.verification,
    serviceId: context.service_id,
  });

  // PROOF PHASE. The legacy receipt below is issued over the legacy draft
  // basis so the externally released wire body stays byte-identical until the
  // governed wire cutover; it does not depend on, and cannot alter, the
  // frozen snapshot.
  const receipt = await issueReceipt(candidate, verificationContext, verdict, params.signer);

  // Runtime receipt-verification boundary: cryptographically self-verify
  // the receipt just issued, against the same shared boundary
  // (verifyServiceReceipt -> @siteborne/verification's verifyReceipt) every
  // test already uses — never a second Ed25519 implementation. If this
  // fails, the verdict itself is forced to 'fail' below, so no service can
  // derive a 'success' result_class from an invalid receipt: every service
  // computes result_class from verdict.decision, and this is the one
  // shared place all four services' finalization passes through.
  const receiptCheck = await verifyServiceReceipt({
    receipt,
    keyRegistry: params.keyRegistry,
    expectedServiceId: candidate.service_id,
    expectedContractRelease: candidate.contract_release,
  });

  const effectiveVerdict: MeshVerdict = receiptCheck.valid
    ? verdict
    : {
        ...verdict,
        decision: 'fail',
        verification: {
          ...verdict.verification,
          decision: 'fail',
          deterministic_failures: [
            ...verdict.verification.deterministic_failures,
            `receipt_cryptographic_verification_failed: ${receiptCheck.status}`,
          ],
        },
      };

  const finalized: PccDocument<TExtensionKey, TExtension> = {
    ...draft,
    verification: effectiveVerdict.verification,
    receipt: toPccReceiptBlock(receipt),
  };

  let artifact = receiptCheck.valid
    ? await buildInternalResultArtifact({
        snapshot,
        receipt,
        verdict,
        signer: params.signer,
        requestId: context.request_id,
        verificationMode: mode,
        serviceFailureCode: verdict.decision === 'pass' ? undefined : 'verification_failed',
      })
    : undefined;

  if (artifact?.artifactVersion === 2) {
    const vnextCheck = await verifySelfVerifyingPcc(
      artifact.wireBody as unknown as SelfVerifyingPcc,
      params.keyRegistry
    );
    if (!vnextCheck.valid) artifact = undefined;
  }

  const preSchemaDocument =
    artifact?.artifactVersion === 2
      ? (artifact.wireBody as unknown as PccDocument<TExtensionKey, TExtension>)
      : finalized;
  const schemaId = getOutputSchemaId(preSchemaDocument.contract.service_id);
  let schemaValidAfterFinalization = false;
  let schemaErrors: string[] = [];
  if (schemaId) {
    // SUN-1201 checkpoint G: a real, previously-missed second
    // request-time-eval call site, found live under real `workerd` while
    // building this checkpoint's post-settlement proof -- this
    // post-finalization re-check called `getAjv().getSchema(schemaId)`
    // directly and unconditionally, bypassing SUN-1200 checkpoint F
    // (P0-A)'s precompiled-validator override entirely (that fix only
    // covered `schema-verifier.ts`'s call site). Same fix, same
    // established pattern: prefer the build-time-precompiled validator,
    // falling through to `getAjv()` unchanged for every non-Worker
    // caller that never calls `setPrecompiledOutputValidators`.
    const validate =
      (getPrecompiledOutputValidator(schemaId) as ValidateFunction | undefined) ??
      getAjv().getSchema(schemaId);
    if (validate) {
      schemaValidAfterFinalization = Boolean(validate(preSchemaDocument));
      schemaErrors = (validate.errors ?? []).map(
        (e) => `${e.instancePath || '(root)'} ${e.message ?? 'invalid'}`
      );
    }
  }

  // Fail-closed finalization gate: a result that fails its own registered
  // output schema must never be delivered as a validly signed/passing
  // result, mirroring the receipt self-verification boundary above (a
  // service can never derive `success` off proof-bearing state built over
  // semantics its own schema rejects). Services with no registered output
  // schema (schemaId falsy) are unaffected — this only gates delivery once
  // a schema was actually checked and failed.
  const schemaGateFailed = Boolean(schemaId) && !schemaValidAfterFinalization;
  if (schemaGateFailed) {
    artifact = undefined;
  }
  const deliveredDocument = schemaGateFailed
    ? {
        ...finalized,
        verification: {
          ...finalized.verification,
          decision: 'fail' as const,
          deterministic_failures: [
            ...finalized.verification.deterministic_failures,
            `final_schema_validation_failed: ${schemaErrors.join('; ') || 'unknown'}`,
          ],
        },
      }
    : preSchemaDocument;

  return {
    document: deliveredDocument,
    finalExtension: JSON.parse(JSON.stringify(snapshot.finalExtension)) as TExtension,
    artifact,
    verdict: effectiveVerdict,
    outputHash:
      artifact?.artifactVersion === 2
        ? artifact.proofPreimage.preimage.output_hash
        : receipt.output_hash,
    receiptId: artifact?.linkEvidenceInputs.receiptId ?? receipt.receipt_id,
    receipt,
    schemaValidAfterFinalization,
    schemaErrors,
    receiptCryptographicallyValid: receiptCheck.valid,
    receiptVerificationStatus: receiptCheck.status,
  };
}

/** Builds the `ServiceExecutionResult.verification` summary from a mesh
 * verdict — shared by every service so the field is populated
 * identically everywhere. */
export function toVerificationSummary(verdict: MeshVerdict) {
  return {
    schema_valid: verdict.verification.schema_valid,
    material_claims_supported: verdict.verification.material_claims_supported,
    evidence_accessibility: verdict.verification.evidence_accessibility,
    freshness: verdict.verification.freshness,
    completeness: verdict.verification.completeness,
    cross_source_agreement: verdict.verification.cross_source_agreement,
    provenance_valid: verdict.verification.provenance_valid,
    decision: verdict.decision,
    score: verdict.verification.score,
  };
}
