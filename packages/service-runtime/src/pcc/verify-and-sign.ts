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
  issueReceipt,
  runMesh,
  type CandidateResult,
  type MeshVerdict,
  type ReproductionInput,
  type Signer,
  type VerificationMode,
} from '@siteborne/verification';
import { toVerificationAuditSink, toVerificationClock } from '../context';
import { toCandidateClaims, toCandidateEvidence } from './candidate-conversion';
import type { PccDocument } from './document-types';
import { toPccReceiptBlock } from './receipt-mapping';
import type { ServiceExecutionContext } from '../types';

export interface VerifyAndSignParams<TExtensionKey extends string, TExtension> {
  draft: PccDocument<TExtensionKey, TExtension>;
  context: ServiceExecutionContext;
  signer: Signer;
  reproduction?: ReproductionInput | null;
  /** claim_ids that should be treated as verified-absent by the mesh; see
   * pcc/document-types.ts's PccClaim doc comment. */
  verifiedAbsentClaimIds?: ReadonlySet<string>;
}

export interface VerifyAndSignResult<TExtensionKey extends string, TExtension> {
  document: PccDocument<TExtensionKey, TExtension>;
  verdict: MeshVerdict;
  outputHash: string;
  receiptId: string;
  schemaValidAfterFinalization: boolean;
  schemaErrors: string[];
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

  const receipt = await issueReceipt(candidate, verificationContext, verdict, params.signer);

  const finalized: PccDocument<TExtensionKey, TExtension> = {
    ...draft,
    verification: verdict.verification,
    receipt: toPccReceiptBlock(receipt),
  };

  const ajv = getAjv();
  const schemaId = getOutputSchemaId(finalized.contract.service_id);
  let schemaValidAfterFinalization = false;
  let schemaErrors: string[] = [];
  if (schemaId) {
    const validate = ajv.getSchema(schemaId);
    if (validate) {
      schemaValidAfterFinalization = Boolean(validate(finalized));
      schemaErrors = (validate.errors ?? []).map(
        (e) => `${e.instancePath || '(root)'} ${e.message ?? 'invalid'}`
      );
    }
  }

  return {
    document: finalized,
    verdict,
    outputHash: receipt.output_hash,
    receiptId: receipt.receipt_id,
    schemaValidAfterFinalization,
    schemaErrors,
  };
}
