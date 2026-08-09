/**
 * End-to-end verified-absence tests for company_evidence_graph.v1 — the
 * full service pipeline (adapter observation → service orchestration →
 * PCC builder → verification mesh → receipt → schema validation), not
 * just the shared claim-builder guard (see claims/builder.test.ts for
 * that unit-level test). See docs/decisions/0038 and
 * docs/operations/VERIFIED_ABSENCE.md.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import {
  SecSubmissionsAdapter,
  PublicHttpAdapter,
  FederalRegisterAdapter,
} from '@siteborne/provider-adapters';
import type {
  AuditEventSink as AdapterAuditEventSink,
  AdapterResult,
} from '@siteborne/provider-adapters';
import type { Signer } from '@siteborne/verification';
import { CompanyEvidenceGraphService } from './service';
import { buildTestServiceContext, createFixtureSigner, jsonHttpClient } from '../../tests/support';
import type { CompanyEvidenceExtension } from './types';

const noopAdapterAudit: AdapterAuditEventSink = { async log() {}, getEvents: () => [], clear() {} };

const FEDERAL_REGISTER_DOCUMENT = {
  document_number: '2024-01234',
  title: 'Cybersecurity Requirements for Financial Institutions',
  publication_date: '2024-01-15',
};

/** A stub matching FederalRegisterAdapter's execute() surface, used only
 * for the failure-class scenarios below where forcing the real adapter
 * through its retry/backoff machinery to reach a given AdapterResultClass
 * would be slow and indirect. Every success-path scenario in this file
 * (bounded absence, positive result) runs through the real
 * FederalRegisterAdapter — see the "real adapter" describe block. */
function stubFederalRegister(result: AdapterResult): FederalRegisterAdapter {
  return {
    async execute() {
      return result;
    },
  } as unknown as FederalRegisterAdapter;
}

function baseResult(resultClass: AdapterResult['resultClass']): AdapterResult {
  return {
    resultClass,
    provider_id: 'federal-register',
    capability: 'federal_register_search',
    cache_status: 'miss',
    freshness_status: 'unknown',
    warnings: [],
    limitations: [],
  };
}

describe('company_evidence_graph.v1 — verified-absence end-to-end (real adapter)', () => {
  let signer: Signer;
  beforeAll(async () => {
    ({ signer } = await createFixtureSigner());
  });

  it('a genuine bounded absence (authoritative search, explicit scope, zero matches) produces a schema-valid, mesh-passing, receipt-signed result', async () => {
    const context = await buildTestServiceContext('company_evidence_graph.v1');
    const httpClient = jsonHttpClient({
      results: [],
      meta: { count: 0, page: 1, per_page: 20, total_pages: 0 },
    });
    const service = new CompanyEvidenceGraphService({
      httpClient,
      secSubmissions: new SecSubmissionsAdapter(
        httpClient,
        context.clock,
        context.artifact_store,
        noopAdapterAudit
      ),
      publicHttp: new PublicHttpAdapter(
        httpClient,
        context.clock,
        context.artifact_store,
        noopAdapterAudit
      ),
      federalRegister: new FederalRegisterAdapter(
        httpClient,
        context.clock,
        context.artifact_store,
        noopAdapterAudit
      ),
      signer,
    });

    const result = await service.execute(
      { company_name: 'Fictional NoMatch Corp', requested_field_groups: ['regulatory_mentions'] },
      context
    );

    expect(result.result_class).toBe('success');
    expect(result.receipt_id).toMatch(/^rcpt_[a-f0-9]{24}$/);
    const output = result.output as CompanyEvidenceExtension;
    expect(output.verified_absences).toHaveLength(1);
    const absence = output.verified_absences![0]!;
    // The statement must stay bounded to the actual search performed — never
    // a broad claim the finite search cannot support.
    expect(absence.claim).toContain('Fictional NoMatch Corp');
    expect(absence.claim).not.toMatch(/no regulatory issues/i);
    expect(absence.scope).toContain('federal-register');
    expect(absence.search_window).toMatch(/^\d{4}-\d{2}-\d{2}\/\d{4}-\d{2}-\d{2}$/);
    expect(absence.sources_checked).toEqual(['federal-register']);
    expect(absence.evidence_ids?.length).toBeGreaterThan(0);
    expect(result.completeness?.supported_fields).toBe(1);
  });

  it('a positive regulatory search result produces regulatory_references, not an absence claim', async () => {
    const context = await buildTestServiceContext('company_evidence_graph.v1');
    const httpClient = jsonHttpClient({
      results: [FEDERAL_REGISTER_DOCUMENT],
      meta: { count: 1, page: 1, per_page: 20, total_pages: 1 },
    });
    const service = new CompanyEvidenceGraphService({
      httpClient,
      secSubmissions: new SecSubmissionsAdapter(
        httpClient,
        context.clock,
        context.artifact_store,
        noopAdapterAudit
      ),
      publicHttp: new PublicHttpAdapter(
        httpClient,
        context.clock,
        context.artifact_store,
        noopAdapterAudit
      ),
      federalRegister: new FederalRegisterAdapter(
        httpClient,
        context.clock,
        context.artifact_store,
        noopAdapterAudit
      ),
      signer,
    });

    const result = await service.execute(
      { company_name: 'Acme Regulated Corp', requested_field_groups: ['regulatory_mentions'] },
      context
    );

    expect(result.result_class).toBe('success');
    const output = result.output as CompanyEvidenceExtension;
    expect(output.verified_absences).toBeUndefined();
    expect(output.regulatory_references).toHaveLength(1);
    expect(output.regulatory_references![0]!.reference_id).toBe('2024-01234');
  });

  it('requesting regulatory_mentions without a wired Federal Register dependency is truthfully unavailable, never fabricated', async () => {
    const context = await buildTestServiceContext('company_evidence_graph.v1');
    const httpClient = jsonHttpClient({});
    const service = new CompanyEvidenceGraphService({
      httpClient,
      secSubmissions: new SecSubmissionsAdapter(
        httpClient,
        context.clock,
        context.artifact_store,
        noopAdapterAudit
      ),
      publicHttp: new PublicHttpAdapter(
        httpClient,
        context.clock,
        context.artifact_store,
        noopAdapterAudit
      ),
      signer,
    });
    const result = await service.execute(
      { company_name: 'Acme', requested_field_groups: ['regulatory_mentions'] },
      context
    );
    expect(
      result.limitations.some(
        (l) => l.includes('regulatory_mentions') && l.includes('Federal Register dependency')
      )
    ).toBe(true);
  });
});

describe('company_evidence_graph.v1 — verified-absence end-to-end (stubbed failure classes)', () => {
  let signer: Signer;
  beforeAll(async () => {
    ({ signer } = await createFixtureSigner());
  });

  async function runWith(resultClass: AdapterResult['resultClass']) {
    const context = await buildTestServiceContext('company_evidence_graph.v1');
    const httpClient = jsonHttpClient({});
    const service = new CompanyEvidenceGraphService({
      httpClient,
      secSubmissions: new SecSubmissionsAdapter(
        httpClient,
        context.clock,
        context.artifact_store,
        noopAdapterAudit
      ),
      publicHttp: new PublicHttpAdapter(
        httpClient,
        context.clock,
        context.artifact_store,
        noopAdapterAudit
      ),
      federalRegister: stubFederalRegister(baseResult(resultClass)),
      signer,
    });
    return service.execute(
      { company_name: 'Acme', requested_field_groups: ['regulatory_mentions'] },
      context
    );
  }

  it('a "not_found" search result never becomes verified absence without going through the real bounded-search path', async () => {
    const result = await runWith('not_found');
    const output = result.output as CompanyEvidenceExtension | undefined;
    expect(output?.verified_absences).toBeUndefined();
    expect(result.limitations.some((l) => l.includes('not_found'))).toBe(true);
  });

  it('a timeout/retryable_failure never becomes verified absence — the source was unavailable, not exhaustively searched', async () => {
    const result = await runWith('retryable_failure');
    const output = result.output as CompanyEvidenceExtension | undefined;
    expect(output?.verified_absences).toBeUndefined();
    expect(result.limitations.some((l) => l.includes('retryable_failure'))).toBe(true);
  });

  it('a policy_blocked result never becomes verified absence — the policy limitation is represented instead', async () => {
    const result = await runWith('policy_blocked');
    const output = result.output as CompanyEvidenceExtension | undefined;
    expect(output?.verified_absences).toBeUndefined();
    expect(result.limitations.some((l) => l.includes('policy_blocked'))).toBe(true);
  });

  it('a source_changed result never becomes verified absence — drift is represented, completeness is not overstated', async () => {
    const result = await runWith('source_changed');
    const output = result.output as CompanyEvidenceExtension | undefined;
    expect(output?.verified_absences).toBeUndefined();
    expect(result.limitations.some((l) => l.includes('source_changed'))).toBe(true);
    expect(result.completeness?.supported_fields).toBe(0);
  });
});
