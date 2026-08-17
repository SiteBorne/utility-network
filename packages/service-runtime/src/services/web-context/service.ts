/**
 * web_context_verified.v1 — composes the SUN-0300 direct-public-http
 * adapter for `retrieval_mode: 'direct'`. `retrieval_mode: 'rendered'`
 * truthfully returns dependency_unavailable rather than faking a rendered
 * fetch with direct HTTP (directive §16 — Browser Rendering is blocked_external,
 * not implemented in this increment).
 */
import { createHash } from 'node:crypto';
import type { InjectedHttpClient, PublicHttpAdapter } from '@siteborne/provider-adapters';
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
import { buildAdapterContext } from '../adapter-context';
import type { WebContextExtension, WebContextInput } from './types';

export interface WebContextServiceDeps {
  httpClient: InjectedHttpClient;
  publicHttp: PublicHttpAdapter;
  signer: Signer;
  /** The registry `signer`'s key is registered in — verifyAndSign uses this
   * to cryptographically self-verify the receipt before this service can
   * report success (see ADR 0040). */
  keyRegistry: KeyRegistry;
}

function extractTitle(html: string): string | undefined {
  const match = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  return match?.[1]?.trim();
}

export class WebContextVerifiedService
  implements LocalService<WebContextInput, WebContextExtension>
{
  readonly serviceId = 'web_context_verified.v1' as const;
  readonly serviceVersion = 'v1' as const;

  constructor(private readonly deps: WebContextServiceDeps) {}

  async execute(
    input: WebContextInput,
    context: ServiceExecutionContext
  ): Promise<ServiceExecutionResult<WebContextExtension>> {
    const startedMs = context.clock.nowMs();
    const inputHash = 'sha256:' + createHash('sha256').update(JSON.stringify(input)).digest('hex');

    if (!input.target_url || !input.retrieval_mode) {
      return rejected(context, startedMs, inputHash, 'target_url and retrieval_mode are required');
    }

    if (input.retrieval_mode === 'rendered') {
      return dependencyUnavailable(
        context,
        startedMs,
        inputHash,
        input,
        'rendered retrieval requires Browser Rendering, which is blocked_external (no live credentials) in this increment — not implemented, not faked via direct HTTP'
      );
    }

    const adapterContext = buildAdapterContext(context, this.deps.httpClient);
    const result = await this.deps.publicHttp.execute(
      {
        url: input.target_url,
        maxResponseBytes: input.max_content_size,
        maxRedirects: input.max_redirects,
      },
      adapterContext
    );

    const claims: PccClaim[] = [];
    const evidence: PccEvidenceItem[] = [];
    const limitations: string[] = [];
    let extension: WebContextExtension = {
      requested_url: input.target_url,
      retrieval_mode_requested: 'direct',
    };
    let resultClass: 'success' | 'partial' | 'source_changed' | 'internal_verification_failed' =
      'success';

    if (result.resultClass !== 'success' || !result.observations?.length) {
      limitations.push(`direct-public-http returned ${result.resultClass} for ${input.target_url}`);
      resultClass =
        result.resultClass === 'source_changed' ? 'source_changed' : 'internal_verification_failed';
      extension = { ...extension, limitations };
    } else {
      const observation = result.observations[0]!;
      const normalized = observation.normalized_value as {
        content: string | Uint8Array;
        mediaType: string;
        finalUrl: string;
        status: number;
        headers: Record<string, string>;
        redirectChain: string[];
        truncated: boolean;
      };
      const contentStr =
        typeof normalized.content === 'string'
          ? normalized.content
          : new TextDecoder().decode(normalized.content);

      const webEvidence = buildEvidence({
        seed: `direct-public-http:web_context:${input.target_url}`,
        sourceUri: observation.source_uri,
        retrievedAtIso: observation.retrieved_at,
        contentHash: observation.contentHash,
        mediaType: observation.media_type,
        locator: observation.evidence_locators[0] ?? {
          type: 'byte_range',
          value: `0-${contentStr.length}`,
        },
        authorizationClassification: observation.authorization_classification,
        freshnessStatus: observation.freshness_status,
      });
      evidence.push(webEvidence);

      const title = normalized.mediaType.includes('html') ? extractTitle(contentStr) : undefined;
      if (title) {
        claims.push(
          buildClaim({
            seed: `web_context_verified.v1:title:${input.target_url}`,
            predicate: 'title',
            value: title,
            confidence: 0.9,
            evidenceIds: [webEvidence.evidence_id],
          })
        );
      }
      claims.push(
        buildClaim({
          seed: `web_context_verified.v1:canonical_text:${input.target_url}`,
          predicate: 'canonical_text',
          value: contentStr.slice(0, 2000),
          confidence: 0.95,
          evidenceIds: [webEvidence.evidence_id],
        })
      );

      extension = {
        ...extension,
        final_url: normalized.finalUrl,
        retrieval_mode_used: 'direct',
        http_metadata: {
          status_code: normalized.status,
          content_type: normalized.mediaType,
          content_length: contentStr.length,
        },
        canonical_text: contentStr.slice(0, 2000),
        // The frozen schema's redirect_chain items require a per-hop
        // status_code, which the direct-public-http adapter's
        // PublicHttpAdapterResult.redirectChain (a bare string[] of URLs)
        // does not capture — omitted rather than fabricated.
        content_hash: observation.contentHash,
        truncation_status: { truncated: normalized.truncated, returned_bytes: contentStr.length },
        character_count: contentStr.length,
        byte_count: contentStr.length,
      };
    }

    const nowIso = new Date(context.clock.nowMs()).toISOString();
    const populated = resultClass === 'success' ? 1 : 0;

    const draft = buildDraftDocument({
      // SUN-1000 checkpoint 1M: derived from context.service_id.
      seed: `${context.service_id}:${inputHash}:${context.job_id}`,
      serviceId: context.service_id,
      serviceVersion: context.service_id.endsWith('.v2') ? 'v2' : 'v1',
      inputHash,
      inputSchemaHash: 'sha256:' + '1'.repeat(64),
      outputSchemaHash: 'sha256:' + '2'.repeat(64),
      contractMode: 'offline_verification',
      freshnessSeconds: input.freshness_seconds ?? 3600,
      issuedAtIso: nowIso,
      expiresAtIso: new Date(context.clock.nowMs() + 3_600_000).toISOString(),
      subject: {
        type: 'webpage',
        canonical_name: input.target_url,
        identifiers: { url: input.target_url },
      },
      claims,
      evidence,
      completeness: {
        requested_fields: 1,
        populated_fields: populated,
        supported_fields: populated,
        score: populated,
        missing_fields: populated ? [] : ['canonical_text'],
        unsupported_fields: [],
        stale_fields: [],
        vector: [
          { dimension: 'content', requested: 1, populated, supported: populated, score: populated },
        ],
      },
      provenance: defaultProvenance('service-runtime:web-context-verified', '0.1.0'),
      extensionKey: 'net.siteborne.web-context.v1',
      extensionPayload: extension,
    });

    const signed = await verifyAndSign({
      draft,
      context,
      signer: this.deps.signer,
      keyRegistry: this.deps.keyRegistry,
    });

    return {
      result_class:
        signed.verdict.decision === 'pass' ? resultClass : 'internal_verification_failed',
      service_id: context.service_id,
      service_version: context.service_id.endsWith('.v2') ? 'v2' : 'v1',
      contract_release: context.contract_release,
      request_id: context.request_id,
      job_id: draft.job_id,
      input_hash: inputHash,
      output:
        signed.verdict.decision === 'pass'
          ? signed.document.extensions['net.siteborne.web-context.v1']
          : undefined,
      output_hash: signed.outputHash,
      pcc_hash: signed.outputHash,
      receipt_id: signed.receiptId,
      receipt: signed.receipt,
      verification: toVerificationSummary(signed.verdict),
      warnings: [],
      limitations,
      completeness: {
        requested_fields: 1,
        populated_fields: populated,
        supported_fields: populated,
        missing_fields: populated ? [] : ['canonical_text'],
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

function rejected(
  context: ServiceExecutionContext,
  startedMs: number,
  inputHash: string,
  message: string
): ServiceExecutionResult<WebContextExtension> {
  return {
    result_class: 'rejected',
    service_id: context.service_id,
    service_version: context.service_id.endsWith('.v2') ? 'v2' : 'v1',
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
    failure: { code: 'invalid_request', message, retryable: false },
  };
}

function dependencyUnavailable(
  context: ServiceExecutionContext,
  startedMs: number,
  inputHash: string,
  input: WebContextInput,
  message: string
): ServiceExecutionResult<WebContextExtension> {
  return {
    result_class: 'dependency_unavailable',
    service_id: context.service_id,
    service_version: context.service_id.endsWith('.v2') ? 'v2' : 'v1',
    contract_release: context.contract_release,
    request_id: context.request_id,
    job_id: context.job_id,
    input_hash: inputHash,
    warnings: [],
    limitations: [message],
    audit_references: [],
    metrics: {
      elapsed_ms: context.clock.nowMs() - startedMs,
      dependency_calls: 0,
      claims_produced: 0,
      evidence_produced: 0,
      output_bytes: 0,
    },
    failure: {
      code: 'dependency_unavailable',
      message,
      retryable: false,
      details: { retrieval_mode: input.retrieval_mode },
    },
  };
}
