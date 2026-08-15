/**
 * document_evidence_json.v1 — composes SUN-0400A's document worker through
 * DocumentWorkerBridge (never reimplementing PDF/OCR/table extraction in
 * TypeScript). Accepts only `artifact_reference` input mode in this
 * increment — `upload_reference`/`document_url` are recognized by the
 * frozen schema but not implemented here (dependency_unavailable, stated
 * truthfully, never faked).
 */
import { createHash } from 'node:crypto';
import type { KeyRegistry, Signer } from '@siteborne/verification';
import { buildClaim } from '../../claims/builder';
import { buildEvidence } from '../../evidence/builder';
import {
  buildDraftDocument,
  defaultProvenance,
  verifyAndSign,
  toVerificationSummary,
} from '../../pcc';
import type { PccClaim, PccEvidenceItem } from '../../pcc/document-types';
import type { LocalService, ServiceExecutionContext, ServiceExecutionResult } from '../../types';
import type { DocumentWorkerBridge } from './worker-bridge';
import type { DocumentEvidenceExtension, DocumentEvidenceInput } from './types';
import type { WorkerResult } from './worker-result-types';

export interface DocumentEvidenceServiceDeps {
  worker: DocumentWorkerBridge;
  signer: Signer;
  /** The registry `signer`'s key is registered in — verifyAndSign uses this
   * to cryptographically self-verify the receipt before this service can
   * report success (see ADR 0040). */
  keyRegistry: KeyRegistry;
}

const CLASSIFICATION_MAP: Record<string, string> = {
  native_text: 'native_text',
  ocr: 'ocr',
  table_heavy: 'table_heavy',
  image_only: 'image_only',
  unsupported: 'unsupported',
};

export class DocumentEvidenceJsonService
  implements LocalService<DocumentEvidenceInput, DocumentEvidenceExtension>
{
  readonly serviceId = 'document_evidence_json.v1' as const;
  readonly serviceVersion = 'v1' as const;

  constructor(private readonly deps: DocumentEvidenceServiceDeps) {}

  async execute(
    input: DocumentEvidenceInput,
    context: ServiceExecutionContext
  ): Promise<ServiceExecutionResult<DocumentEvidenceExtension>> {
    const startedMs = context.clock.nowMs();
    const inputHash = 'sha256:' + createHash('sha256').update(JSON.stringify(input)).digest('hex');

    if (!input.artifact_reference) {
      return dependencyUnavailable(
        context,
        startedMs,
        inputHash,
        'only artifact_reference input mode is implemented in this increment — upload_reference/document_url are recognized by the frozen schema but not yet supported'
      );
    }

    const artifactBytes = await context.artifact_store.getContent(
      input.artifact_reference.artifact_id
    );
    if (!artifactBytes) {
      return artifactUnavailable(
        context,
        startedMs,
        inputHash,
        `artifact "${input.artifact_reference.artifact_id}" was not found in the artifact store`
      );
    }

    const worker = await this.deps.worker.run({
      bytes: artifactBytes,
      mediaType: input.artifact_reference.media_type,
      ocrPolicy: input.ocr_permission ? 'if_needed' : 'never',
      tablePolicy: input.extraction_request?.extract_tables === false ? 'skip' : 'extract',
    });

    if (worker.status === 'failed' || !worker.document) {
      return workerFailed(context, startedMs, inputHash, worker);
    }

    if (
      !input.ocr_permission &&
      worker.pages.some(
        (page) =>
          (page.classification === 'scanned_image' || page.classification === 'mixed') &&
          !page.ocr_used &&
          page.extraction_method === 'none'
      )
    ) {
      return ocrPermissionRequired(context, startedMs, inputHash);
    }

    const claims: PccClaim[] = [];
    const evidence: PccEvidenceItem[] = [];
    const pageClassifications: NonNullable<DocumentEvidenceExtension['page_classifications']> = [];
    const textBlocks: NonNullable<DocumentEvidenceExtension['text_blocks']> = [];
    const tables: NonNullable<DocumentEvidenceExtension['tables']> = [];
    const ocrConfidence: NonNullable<DocumentEvidenceExtension['ocr_confidence']> = [];
    const pageWarnings: NonNullable<DocumentEvidenceExtension['page_warnings']> = [];

    for (const page of worker.pages) {
      pageClassifications.push({
        page_number: page.page_number,
        classification: CLASSIFICATION_MAP[page.classification] ?? 'unsupported',
        extraction_method: page.extraction_method,
      });

      const pageEvidence = buildEvidence({
        seed: `document-worker:page:${worker.document.sha256}:${page.page_number}`,
        sourceUri: `artifact://${input.artifact_reference.artifact_id}`,
        retrievedAtIso: new Date(context.clock.nowMs()).toISOString(),
        contentHash: page.page_hash,
        mediaType: input.artifact_reference.media_type,
        locator: { type: 'page_region', value: `page:${page.page_number}` },
        authorizationClassification: 'buyer_authorized',
      });
      evidence.push(pageEvidence);

      if (page.normalized_text) {
        claims.push(
          buildClaim({
            seed: `document_evidence_json.v1:page_text:${worker.document.sha256}:${page.page_number}`,
            predicate: `page_${page.page_number}_text`,
            value: page.normalized_text.slice(0, 4000),
            confidence: page.ocr_used ? 0.85 : 0.99,
            evidenceIds: [pageEvidence.evidence_id],
          })
        );
        textBlocks.push({ page: page.page_number, text: page.normalized_text.slice(0, 4000) });
      }

      for (const warning of page.warnings) pageWarnings.push({ page: page.page_number, warning });

      for (const table of page.tables.slice(0, 10)) {
        const tableEvidence = buildEvidence({
          seed: `document-worker:table:${table.table_hash}`,
          sourceUri: `artifact://${input.artifact_reference.artifact_id}`,
          retrievedAtIso: new Date(context.clock.nowMs()).toISOString(),
          contentHash: table.table_hash,
          mediaType: input.artifact_reference.media_type,
          locator: {
            type: 'page_region',
            value: `page:${table.page}:table:${table.table_ordinal}`,
          },
          authorizationClassification: 'buyer_authorized',
        });
        evidence.push(tableEvidence);
        tables.push({
          page: table.page,
          table_index: table.table_ordinal,
          headers: table.headers,
          rows: table.rows.slice(0, 50),
        });
        claims.push(
          buildClaim({
            seed: `document_evidence_json.v1:table:${table.table_hash}`,
            predicate: `page_${table.page}_table_${table.table_ordinal}`,
            value: { headers: table.headers, row_count: table.rows.length },
            confidence: 0.95,
            evidenceIds: [tableEvidence.evidence_id],
          })
        );
      }

      if (page.ocr_used) ocrConfidence.push({ page: page.page_number });
    }

    claims.push(
      buildClaim({
        seed: `document_evidence_json.v1:page_count:${worker.document.sha256}`,
        predicate: 'page_count',
        value: worker.document.page_count,
        confidence: 1,
        evidenceIds: evidence.length > 0 ? [evidence[0]!.evidence_id] : [],
      })
    );

    const extension: DocumentEvidenceExtension = {
      media_type_confirmed: worker.document.media_type,
      size_bytes_confirmed: worker.document.byte_length,
      total_pages: worker.document.page_count,
      processed_pages: worker.pages.length,
      page_classifications: pageClassifications,
      text_blocks: textBlocks.length ? textBlocks : undefined,
      tables: tables.length ? tables : undefined,
      ocr_confidence: ocrConfidence.length ? ocrConfidence : undefined,
      page_warnings: pageWarnings.length ? pageWarnings : undefined,
      limitations: worker.limitations.length ? worker.limitations : undefined,
    };

    const requestedFields = worker.document.page_count;
    const populatedFields = worker.pages.length;

    const nowIso = new Date(context.clock.nowMs()).toISOString();
    const draft = buildDraftDocument({
      seed: `document_evidence_json.v1:${inputHash}:${context.job_id}`,
      serviceId: 'document_evidence_json.v1',
      serviceVersion: 'v1',
      inputHash,
      inputSchemaHash: 'sha256:' + '1'.repeat(64),
      outputSchemaHash: 'sha256:' + '2'.repeat(64),
      contractMode: 'offline_verification',
      freshnessSeconds: 86400,
      issuedAtIso: nowIso,
      expiresAtIso: new Date(context.clock.nowMs() + 86_400_000).toISOString(),
      subject: {
        type: 'document',
        canonical_name: input.artifact_reference.artifact_id,
        identifiers: { artifact_id: input.artifact_reference.artifact_id },
      },
      claims,
      evidence,
      completeness: {
        requested_fields: requestedFields,
        populated_fields: populatedFields,
        supported_fields: populatedFields,
        score: requestedFields === 0 ? 1 : populatedFields / requestedFields,
        missing_fields:
          requestedFields > populatedFields
            ? [`pages_${populatedFields + 1}_to_${requestedFields}`]
            : [],
        unsupported_fields: [],
        stale_fields: [],
        vector: [
          {
            dimension: 'pages',
            requested: requestedFields,
            populated: populatedFields,
            supported: populatedFields,
            score: requestedFields === 0 ? 1 : populatedFields / requestedFields,
          },
        ],
      },
      provenance: defaultProvenance('service-runtime:document-evidence-json', '0.1.0'),
      extensionKey: 'net.siteborne.document-evidence.v1',
      extensionPayload: extension,
    });

    const signed = await verifyAndSign({
      draft,
      context,
      signer: this.deps.signer,
      keyRegistry: this.deps.keyRegistry,
    });
    const resultClass =
      signed.verdict.decision !== 'pass'
        ? 'internal_verification_failed'
        : populatedFields < requestedFields
          ? 'partial'
          : 'success';

    return {
      result_class: resultClass,
      service_id: 'document_evidence_json.v1',
      service_version: 'v1',
      contract_release: context.contract_release,
      request_id: context.request_id,
      job_id: draft.job_id,
      input_hash: inputHash,
      output:
        signed.verdict.decision === 'pass'
          ? signed.document.extensions['net.siteborne.document-evidence.v1']
          : undefined,
      output_hash: signed.outputHash,
      pcc_hash: signed.outputHash,
      receipt_id: signed.receiptId,
      receipt: signed.receipt,
      verification: toVerificationSummary(signed.verdict),
      warnings: worker.warnings,
      limitations: worker.limitations,
      completeness: {
        requested_fields: requestedFields,
        populated_fields: populatedFields,
        supported_fields: populatedFields,
        missing_fields:
          requestedFields > populatedFields
            ? [`pages_${populatedFields + 1}_to_${requestedFields}`]
            : [],
      },
      audit_references: [context.request_id],
      metrics: {
        elapsed_ms: context.clock.nowMs() - startedMs,
        dependency_calls: 1,
        claims_produced: claims.length,
        evidence_produced: evidence.length,
        output_bytes: JSON.stringify(signed.document).length,
      },
      failure:
        signed.verdict.decision === 'pass'
          ? undefined
          : {
              code: 'verification_failed',
              message: `verification mesh decision was "${signed.verdict.decision}"`,
              retryable: false,
              details: signed.verdict.verification.deterministic_failures,
            },
    };
  }
}

function baseFailureResult(
  context: ServiceExecutionContext,
  startedMs: number,
  inputHash: string,
  resultClass: ServiceExecutionResult['result_class']
): ServiceExecutionResult<DocumentEvidenceExtension> {
  return {
    result_class: resultClass,
    service_id: 'document_evidence_json.v1',
    service_version: 'v1',
    contract_release: context.contract_release,
    request_id: context.request_id,
    job_id: context.job_id,
    input_hash: inputHash,
    warnings: [],
    limitations: [],
    audit_references: [],
    metrics: {
      elapsed_ms: context.clock.nowMs() - startedMs,
      dependency_calls: 0,
      claims_produced: 0,
      evidence_produced: 0,
      output_bytes: 0,
    },
  };
}

function dependencyUnavailable(
  context: ServiceExecutionContext,
  startedMs: number,
  inputHash: string,
  message: string
): ServiceExecutionResult<DocumentEvidenceExtension> {
  return {
    ...baseFailureResult(context, startedMs, inputHash, 'dependency_unavailable'),
    limitations: [message],
    failure: { code: 'dependency_unavailable', message, retryable: false },
  };
}

function artifactUnavailable(
  context: ServiceExecutionContext,
  startedMs: number,
  inputHash: string,
  message: string
): ServiceExecutionResult<DocumentEvidenceExtension> {
  return {
    ...baseFailureResult(context, startedMs, inputHash, 'rejected'),
    failure: { code: 'artifact_unavailable', message, retryable: false },
  };
}

function ocrPermissionRequired(
  context: ServiceExecutionContext,
  startedMs: number,
  inputHash: string
): ServiceExecutionResult<DocumentEvidenceExtension> {
  return {
    ...baseFailureResult(context, startedMs, inputHash, 'rejected'),
    limitations: ['OCR-required document content was not processed without explicit permission'],
    failure: {
      code: 'ocr_permission_required',
      message: 'explicit ocr_permission=true is required for OCR-only document content',
      retryable: false,
    },
  };
}

function workerFailed(
  context: ServiceExecutionContext,
  startedMs: number,
  inputHash: string,
  worker: WorkerResult
): ServiceExecutionResult<DocumentEvidenceExtension> {
  const code = worker.failure?.code ?? 'unknown';
  return {
    ...baseFailureResult(context, startedMs, inputHash, 'permanent_failure'),
    warnings: worker.warnings,
    limitations: worker.limitations,
    failure: {
      code: 'document_processing_failed',
      message: worker.failure?.message ?? `document worker failed (${code})`,
      retryable: worker.failure?.retryable ?? false,
      details: { worker_failure_code: code },
    },
  };
}
