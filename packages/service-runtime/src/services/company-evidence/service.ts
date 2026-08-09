/**
 * company_evidence_graph.v1 — composes the SUN-0300 SEC and direct-HTTP
 * adapters (never reimplementing their fetch/parse/policy logic) into a
 * PCC document, verifies it through the SUN-0500 mesh, and signs a
 * receipt. See docs/decisions/0037-service-runtime-composition-boundary.md.
 */
import { createHash } from 'node:crypto';
import type { InjectedHttpClient } from '@siteborne/provider-adapters';
import type { SecSubmissionsAdapter } from '@siteborne/provider-adapters';
import type { PublicHttpAdapter } from '@siteborne/provider-adapters';
import { buildClaim } from '../../claims/builder';
import { buildEvidence } from '../../evidence/builder';
import { buildDraftDocument, defaultProvenance, verifyAndSign } from '../../pcc';
import type { Signer } from '@siteborne/verification';
import type { LocalService, ServiceExecutionContext, ServiceExecutionResult } from '../../types';
import { buildAdapterContext } from '../adapter-context';
import { resolveIdentity } from './identity';
import { IMPLEMENTED_FIELD_GROUPS } from './types';
import type { CompanyEvidenceExtension, CompanyEvidenceInput, FieldGroup } from './types';
import type { PccClaim, PccEvidenceItem } from '../../pcc/document-types';

export interface CompanyEvidenceServiceDeps {
  httpClient: InjectedHttpClient;
  secSubmissions: SecSubmissionsAdapter;
  publicHttp: PublicHttpAdapter;
  signer: Signer;
}

const DEFAULT_FIELD_GROUPS: FieldGroup[] = [
  'identity',
  'sec_submissions',
  'recent_filings',
  'website_evidence',
];

export class CompanyEvidenceGraphService
  implements LocalService<CompanyEvidenceInput, CompanyEvidenceExtension>
{
  readonly serviceId = 'company_evidence_graph.v1' as const;
  readonly serviceVersion = 'v1' as const;

  constructor(private readonly deps: CompanyEvidenceServiceDeps) {}

  async execute(
    input: CompanyEvidenceInput,
    context: ServiceExecutionContext
  ): Promise<ServiceExecutionResult<CompanyEvidenceExtension>> {
    const startedMs = context.clock.nowMs();
    let dependencyCalls = 0;

    if (!input.company_name && !input.ticker && !input.domain && !input.identifiers?.cik) {
      return rejected(
        context,
        startedMs,
        'at least one identity signal (company_name, ticker, domain, or identifiers.cik) is required'
      );
    }

    const identity = resolveIdentity(input);
    const requestedGroups = input.requested_field_groups?.length
      ? input.requested_field_groups
      : DEFAULT_FIELD_GROUPS;

    const claims: PccClaim[] = [];
    const evidence: PccEvidenceItem[] = [];
    const fieldGroups: CompanyEvidenceExtension['field_groups'] = {};
    const limitations: string[] = [];
    const filingSummaries: NonNullable<CompanyEvidenceExtension['filing_summaries']> = [];
    const websiteObservations: NonNullable<CompanyEvidenceExtension['website_observations']> = [];
    let secCovered = false;
    let websiteCovered = false;

    const canonicalName = identity.companyName ?? identity.domain ?? identity.cik ?? 'unknown';

    for (const group of requestedGroups) {
      if (!IMPLEMENTED_FIELD_GROUPS.includes(group)) {
        fieldGroups[group] = { status: 'unavailable', source_count: 0 };
        limitations.push(
          `field group "${group}" is not implemented in this increment (SUN-0600) — recognized but unavailable, not fabricated`
        );
        continue;
      }

      if (group === 'identity') {
        // "identity" is reported via canonical_identity/resolved_identifiers
        // in the extension payload, not as a PCC claim — a claim with no
        // evidence_ids would be an unsupported material claim per the mesh's
        // claim_evidence_verifier, and identity resolution here is not
        // itself sourced from a fetched, hashable piece of evidence (it is
        // a deterministic function of the *input*, not an external claim
        // needing evidentiary support).
        fieldGroups.identity = {
          status: identity.confidence === 'exact' ? 'complete' : 'partial',
          source_count: 0,
        };
        continue;
      }

      if (group === 'sec_submissions' || group === 'recent_filings') {
        if (secCovered || !identity.cik) {
          if (!identity.cik) {
            fieldGroups[group] = { status: 'unavailable', source_count: 0 };
            limitations.push(
              `field group "${group}" requires an authoritative CIK; none was resolved for this input`
            );
          } else {
            fieldGroups[group] = fieldGroups.sec_submissions ?? { status: 'unavailable' };
          }
          continue;
        }
        dependencyCalls++;
        const adapterContext = buildAdapterContext(context, this.deps.httpClient);
        const result = await this.deps.secSubmissions.execute(
          { cik: identity.cik, forms: [], maxFilings: 10 },
          adapterContext
        );

        if (result.resultClass !== 'success' || !result.observations?.length) {
          fieldGroups.sec_submissions = {
            status: result.resultClass === 'policy_blocked' ? 'unavailable' : 'empty',
            source_count: 0,
          };
          fieldGroups.recent_filings = fieldGroups.sec_submissions;
          limitations.push(
            `sec-edgar company_submissions returned ${result.resultClass} for CIK ${identity.cik}`
          );
          secCovered = true;
          continue;
        }

        const observation = result.observations[0]!;
        const normalized = observation.normalized_value as {
          entity: { entityName: string; cik: string };
          filings: Array<Record<string, unknown>>;
        };
        const secEvidence = buildEvidence({
          seed: `sec-edgar:company_submissions:${identity.cik}`,
          sourceUri: observation.source_uri,
          retrievedAtIso: observation.retrieved_at,
          contentHash: observation.contentHash,
          mediaType: observation.media_type,
          locator: observation.evidence_locators[0] ?? { type: 'json_pointer', value: '/filings' },
          authorizationClassification: observation.authorization_classification,
          freshnessStatus: observation.freshness_status,
        });
        evidence.push(secEvidence);

        claims.push(
          buildClaim({
            seed: `company_evidence_graph.v1:legal_name:${identity.cik}`,
            predicate: 'legal_name',
            value: normalized.entity.entityName,
            confidence: 0.97,
            evidenceIds: [secEvidence.evidence_id],
          })
        );

        for (const filing of normalized.filings.slice(0, 10)) {
          filingSummaries.push({
            accession_number: filing.accessionNumber as string | undefined,
            filing_type: filing.form as string | undefined,
            filing_date: filing.filingDate as string | undefined,
            evidence_ids: [secEvidence.evidence_id],
          });
        }

        fieldGroups.sec_submissions = {
          status: 'complete',
          source_count: 1,
          evidence_ids: [secEvidence.evidence_id],
        };
        fieldGroups.recent_filings = {
          status: filingSummaries.length > 0 ? 'complete' : 'empty',
          source_count: 1,
          evidence_ids: [secEvidence.evidence_id],
        };
        secCovered = true;
        continue;
      }

      if (group === 'website_evidence') {
        const urls = input.buyer_urls?.length ? input.buyer_urls : [];
        if (websiteCovered || urls.length === 0) {
          fieldGroups.website_evidence = { status: 'unavailable', source_count: 0 };
          if (urls.length === 0)
            limitations.push(
              'field group "website_evidence" requires at least one buyer_urls entry'
            );
          continue;
        }
        dependencyCalls++;
        const adapterContext = buildAdapterContext(context, this.deps.httpClient);
        const result = await this.deps.publicHttp.execute({ url: urls[0]! }, adapterContext);
        if (result.resultClass !== 'success' || !result.observations?.length) {
          fieldGroups.website_evidence = { status: 'empty', source_count: 0 };
          limitations.push(`direct-public-http returned ${result.resultClass} for ${urls[0]}`);
          websiteCovered = true;
          continue;
        }
        const observation = result.observations[0]!;
        const webEvidence = buildEvidence({
          seed: `direct-public-http:website_evidence:${urls[0]}`,
          sourceUri: observation.source_uri,
          retrievedAtIso: observation.retrieved_at,
          contentHash: observation.contentHash,
          mediaType: observation.media_type,
          locator: observation.evidence_locators[0] ?? { type: 'text_quote', value: '' },
          authorizationClassification: observation.authorization_classification,
          freshnessStatus: observation.freshness_status,
        });
        evidence.push(webEvidence);
        websiteObservations.push({
          url: observation.source_uri,
          extracted_at: observation.retrieved_at,
          content_hash: observation.contentHash,
          evidence_ids: [webEvidence.evidence_id],
        });
        fieldGroups.website_evidence = {
          status: 'complete',
          source_count: 1,
          evidence_ids: [webEvidence.evidence_id],
        };
        websiteCovered = true;
        continue;
      }
    }

    const requestedCount = requestedGroups.length;
    const populatedCount = requestedGroups.filter(
      (g) => fieldGroups[g]?.status === 'complete' || fieldGroups[g]?.status === 'partial'
    ).length;
    const supportedCount = requestedGroups.filter(
      (g) => fieldGroups[g]?.status === 'complete'
    ).length;
    const missingFields = requestedGroups
      .filter((g) => fieldGroups[g]?.status !== 'complete')
      .map((g) => g);

    const extension: CompanyEvidenceExtension = {
      canonical_identity: {
        legal_name: claims.find((c) => c.predicate === 'legal_name')?.value as string | undefined,
        common_name: identity.companyName,
        ticker: identity.ticker,
        domain: identity.domain,
        resolved_identifiers: identity.cik ? { cik: identity.cik } : undefined,
      },
      resolved_identifiers: identity.cik ? { cik: identity.cik } : undefined,
      field_groups: fieldGroups,
      filing_summaries: filingSummaries.length ? filingSummaries : undefined,
      website_observations: websiteObservations.length ? websiteObservations : undefined,
      limitations: limitations.length ? limitations : undefined,
      source_coverage_summary: {
        sec: secCovered,
        website: websiteCovered,
        regulatory: false,
        repositories: false,
      },
    };

    const nowIso = new Date(context.clock.nowMs()).toISOString();
    const inputHash = 'sha256:' + hashOf(JSON.stringify(input));

    const draft = buildDraftDocument({
      seed: `company_evidence_graph.v1:${inputHash}:${context.job_id}`,
      serviceId: 'company_evidence_graph.v1',
      serviceVersion: 'v1',
      inputHash,
      inputSchemaHash: 'sha256:' + '1'.repeat(64),
      outputSchemaHash: 'sha256:' + '2'.repeat(64),
      contractMode: 'offline_verification',
      freshnessSeconds: input.freshness_seconds ?? 86400,
      issuedAtIso: nowIso,
      expiresAtIso: new Date(context.clock.nowMs() + 86_400_000).toISOString(),
      subject: {
        type: 'organization',
        canonical_name: canonicalName,
        identifiers: identity.cik ? { cik: identity.cik } : undefined,
      },
      claims,
      evidence,
      completeness: {
        requested_fields: requestedCount,
        populated_fields: populatedCount,
        supported_fields: supportedCount,
        score: requestedCount === 0 ? 1 : supportedCount / requestedCount,
        missing_fields: missingFields,
        unsupported_fields: [],
        stale_fields: [],
        vector: [
          {
            dimension: 'field_groups',
            requested: requestedCount,
            populated: populatedCount,
            supported: supportedCount,
            score: requestedCount === 0 ? 1 : supportedCount / requestedCount,
          },
        ],
      },
      provenance: defaultProvenance('service-runtime:company-evidence-graph', '0.1.0'),
      extensionKey: 'net.siteborne.company-evidence.v1',
      extensionPayload: extension,
    });

    const signed = await verifyAndSign({ draft, context, signer: this.deps.signer });

    const resultClass =
      signed.verdict.decision === 'pass'
        ? supportedCount === requestedCount
          ? 'success'
          : 'partial'
        : signed.verdict.decision === 'quarantined'
          ? 'internal_verification_failed'
          : 'internal_verification_failed';

    return {
      result_class:
        signed.verdict.decision === 'pass' ? resultClass : 'internal_verification_failed',
      service_id: 'company_evidence_graph.v1',
      service_version: 'v1',
      contract_release: context.contract_release,
      request_id: context.request_id,
      job_id: draft.job_id,
      input_hash: inputHash,
      output:
        signed.verdict.decision === 'pass'
          ? signed.document.extensions['net.siteborne.company-evidence.v1']
          : undefined,
      output_hash: signed.outputHash,
      pcc_hash: signed.outputHash,
      receipt_id: signed.receiptId,
      warnings: [],
      limitations,
      completeness: {
        requested_fields: requestedCount,
        populated_fields: populatedCount,
        supported_fields: supportedCount,
        missing_fields: missingFields,
      },
      audit_references: [context.request_id],
      metrics: {
        elapsed_ms: context.clock.nowMs() - startedMs,
        dependency_calls: dependencyCalls,
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
  message: string
): ServiceExecutionResult<CompanyEvidenceExtension> {
  return {
    result_class: 'rejected',
    service_id: 'company_evidence_graph.v1',
    service_version: 'v1',
    contract_release: context.contract_release,
    request_id: context.request_id,
    job_id: context.job_id,
    input_hash: 'sha256:' + '0'.repeat(64),
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

function hashOf(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
