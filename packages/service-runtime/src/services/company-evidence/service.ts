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
import type { FederalRegisterAdapter } from '@siteborne/provider-adapters';
import { buildClaim, buildVerifiedAbsentClaim } from '../../claims/builder';
import { buildEvidence } from '../../evidence/builder';
import {
  buildDraftDocument,
  defaultProvenance,
  verifyAndSign,
  toVerificationSummary,
} from '../../pcc';
import type { KeyRegistry, Signer } from '@siteborne/verification';
import type { LocalService, ServiceExecutionContext, ServiceExecutionResult } from '../../types';
import { serviceVersionOf } from '../../types';
import { buildAdapterContext } from '../adapter-context';
import { resolveIdentity } from './identity';
import { IMPLEMENTED_FIELD_GROUPS } from './types';
import type { CompanyEvidenceExtension, CompanyEvidenceInput, FieldGroup } from './types';
import type { PccClaim, PccEvidenceItem } from '../../pcc/document-types';

export interface CompanyEvidenceServiceDeps {
  httpClient: InjectedHttpClient;
  secSubmissions: SecSubmissionsAdapter;
  publicHttp: PublicHttpAdapter;
  /** Optional: powers the `regulatory_mentions` field group (Federal
   * Register search). Existing callers that never request that field
   * group don't need to supply it — requesting it without a wired
   * dependency is reported `unavailable`, never fabricated. */
  federalRegister?: FederalRegisterAdapter;
  signer: Signer;
  /** The registry `signer`'s key is registered in — verifyAndSign uses this
   * to cryptographically self-verify the receipt before this service can
   * report success (see ADR 0040). */
  keyRegistry: KeyRegistry;
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
    const regulatoryReferences: NonNullable<CompanyEvidenceExtension['regulatory_references']> = [];
    const verifiedAbsences: NonNullable<CompanyEvidenceExtension['verified_absences']> = [];
    const verifiedAbsentClaimIds = new Set<string>();
    let secCovered = false;
    let websiteCovered = false;
    let regulatoryCovered = false;

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
          // SUN-1222C-R10: `result.error.code`/`.message` are already the
          // safe, status-code-derived classification `SecureHttpClient`/
          // `SecSubmissionsAdapter` computed (e.g. "HTTP 403: forbidden or
          // unauthorized") -- never a raw response body, never a secret.
          // Discarding them here (keeping only `resultClass`) was a proven
          // observability gap: every real SEC rejection collapsed to the
          // same indistinguishable "... returned permanent_failure ..."
          // text regardless of which specific status SEC actually
          // returned (docs/reports/SUN-1222C-R10-*.md).
          limitations.push(
            `sec-edgar company_submissions returned ${result.resultClass} for CIK ${identity.cik}` +
              (result.error ? ` (${result.error.code}: ${result.error.message})` : '')
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

      if (group === 'regulatory_mentions') {
        if (regulatoryCovered) continue;
        if (!this.deps.federalRegister) {
          fieldGroups.regulatory_mentions = { status: 'unavailable', source_count: 0 };
          limitations.push(
            'field group "regulatory_mentions" requires a Federal Register dependency, which was not supplied to this service instance'
          );
          regulatoryCovered = true;
          continue;
        }
        const searchTerm = identity.companyName ?? canonicalName;
        // Bounded search window: the trailing 730 days from the injected
        // clock — deterministic given a fixed clock, and an explicit,
        // reportable scope (never an unbounded "ever" search).
        const nowMs = context.clock.nowMs();
        const startDate = new Date(nowMs - 730 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const endDate = new Date(nowMs).toISOString().slice(0, 10);

        dependencyCalls++;
        const adapterContext = buildAdapterContext(context, this.deps.httpClient);
        const result = await this.deps.federalRegister.execute(
          { mode: 'search', searchTerm, startDate, endDate },
          adapterContext
        );

        if (result.resultClass !== 'success' || !result.observations?.length) {
          // A source failure (retryable_failure/policy_blocked/source_changed/
          // rate_limited/...) is never treated as absence — see
          // docs/decisions/0038-verified-absence-and-partial-result-policy.md.
          fieldGroups.regulatory_mentions = {
            status: result.resultClass === 'policy_blocked' ? 'unavailable' : 'empty',
            source_count: 0,
          };
          limitations.push(
            `federal-register search returned ${result.resultClass} for "${searchTerm}" (${startDate}..${endDate})`
          );
          regulatoryCovered = true;
          continue;
        }

        const observation = result.observations[0]!;
        const normalized = observation.normalized_value as {
          results: Array<Record<string, unknown>>;
          meta: { count: number };
        };
        const searchEvidence = buildEvidence({
          seed: `federal-register:search:${searchTerm}:${startDate}:${endDate}`,
          sourceUri: observation.source_uri,
          retrievedAtIso: observation.retrieved_at,
          contentHash: observation.contentHash,
          mediaType: observation.media_type,
          locator: observation.evidence_locators[0] ?? { type: 'json_pointer', value: '/results' },
          authorizationClassification: observation.authorization_classification,
          freshnessStatus: observation.freshness_status,
        });
        evidence.push(searchEvidence);

        if (normalized.results.length === 0) {
          // A genuine bounded-absence finding: an authoritative source
          // (Federal Register), an explicit search term, an explicit date
          // range, a successful (not failed) query, zero matches. The
          // claim states exactly this bounded scope — never a broad
          // proposition like "company has no regulatory issues", which a
          // finite search can never actually support.
          const absentClaim = buildVerifiedAbsentClaim({
            seed: `company_evidence_graph.v1:no_federal_register_match:${searchTerm}:${startDate}:${endDate}`,
            predicate: 'no_federal_register_match_in_window',
            absenceEvidenceIds: [searchEvidence.evidence_id],
          });
          claims.push(absentClaim);
          verifiedAbsentClaimIds.add(absentClaim.claim_id);
          verifiedAbsences.push({
            claim: `No Federal Register document matched search term "${searchTerm}" within ${startDate}..${endDate}`,
            scope: `federal-register search, term="${searchTerm}"`,
            sources_checked: ['federal-register'],
            search_window: `${startDate}/${endDate}`,
            confidence: 0.9,
            limitations:
              'Search results do not imply enforcement or adverse regulatory events; absence is bounded to the stated term and window only.',
            evidence_ids: [searchEvidence.evidence_id],
          });
          fieldGroups.regulatory_mentions = {
            status: 'complete',
            source_count: 1,
            evidence_ids: [searchEvidence.evidence_id],
          };
        } else {
          for (const doc of normalized.results.slice(0, 5)) {
            regulatoryReferences.push({
              source: 'federal-register',
              reference_id: doc.document_number as string | undefined,
              date: (doc.publication_date as string | undefined) ?? undefined,
              description: (doc.title as string | undefined)?.slice(0, 256),
              evidence_ids: [searchEvidence.evidence_id],
            });
          }
          claims.push(
            buildClaim({
              seed: `company_evidence_graph.v1:federal_register_match_count:${searchTerm}:${startDate}:${endDate}`,
              predicate: 'federal_register_match_count_in_window',
              value: normalized.results.length,
              confidence: 0.9,
              evidenceIds: [searchEvidence.evidence_id],
            })
          );
          fieldGroups.regulatory_mentions = {
            status: 'complete',
            source_count: 1,
            evidence_ids: [searchEvidence.evidence_id],
          };
        }
        regulatoryCovered = true;
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
      regulatory_references: regulatoryReferences.length ? regulatoryReferences : undefined,
      verified_absences: verifiedAbsences.length ? verifiedAbsences : undefined,
      limitations: limitations.length ? limitations : undefined,
      source_coverage_summary: {
        sec: secCovered,
        website: websiteCovered,
        regulatory: regulatoryCovered,
        repositories: false,
      },
    };

    const nowIso = new Date(context.clock.nowMs()).toISOString();
    const inputHash = 'sha256:' + hashOf(JSON.stringify(input));

    // SUN-1000 checkpoint 1M: derived from context.service_id rather than
    // hardcoded literals — the receipt's own contract.service_id/
    // serviceVersion must match whichever major actually invoked this
    // (both .v1 and .v2 now register the same service instance).
    const draft = buildDraftDocument({
      seed: `${context.service_id}:${inputHash}:${context.job_id}`,
      idempotencyKey: context.idempotency_key,
      serviceId: context.service_id,
      serviceVersion: serviceVersionOf(context.service_id),
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

    const signed = await verifyAndSign({
      draft,
      context,
      signer: this.deps.signer,
      keyRegistry: this.deps.keyRegistry,
      verifiedAbsentClaimIds,
    });

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
      // SUN-1000 checkpoint 1M: derived from the invocation context's own
      // service_id rather than a hardcoded v1 literal — the same class is
      // now registered under both the .v1 and .v2 registry keys (identical
      // business logic, per checkpoint 1L's frozen decision), so the
      // result must faithfully report whichever identity actually invoked
      // it.
      service_id: context.service_id,
      service_version: serviceVersionOf(context.service_id),
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
      receipt: signed.receipt,
      finalized: signed.artifact,
      verification: toVerificationSummary(signed.verdict),
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
    service_id: context.service_id,
    service_version: serviceVersionOf(context.service_id),
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
