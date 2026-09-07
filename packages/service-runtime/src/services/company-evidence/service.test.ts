import { describe, expect, it, beforeAll } from 'vitest';
import { SecSubmissionsAdapter, PublicHttpAdapter } from '@siteborne/provider-adapters';
import type {
  AuditEventSink as AdapterAuditEventSink,
  InjectedHttpClient,
} from '@siteborne/provider-adapters';
import type { KeyRegistry } from '@siteborne/verification';
import { verifyReceipt, type Signer, type VerificationReceipt } from '@siteborne/verification';
import { CompanyEvidenceGraphService } from './service';
import {
  buildTestServiceContext,
  createFixtureSigner,
  jsonHttpClient,
  loadAdapterFixture,
  textHttpClient,
} from '../../tests/support';
import type { ServiceExecutionContext } from '../../types';

const noopAdapterAudit: AdapterAuditEventSink = { async log() {}, getEvents: () => [], clear() {} };

async function buildService(
  httpClient: InjectedHttpClient,
  context: ServiceExecutionContext,
  signer: Signer,
  keyRegistry: KeyRegistry
): Promise<CompanyEvidenceGraphService> {
  return new CompanyEvidenceGraphService({
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
    keyRegistry,
  });
}

describe('CompanyEvidenceGraphService', () => {
  let signer: Signer;
  let registry: KeyRegistry;

  beforeAll(async () => {
    ({ signer, registry } = await createFixtureSigner());
  });

  it('rejects an input with no identity signal at all', async () => {
    const context = await buildTestServiceContext('company_evidence_graph.v1');
    const service = await buildService(jsonHttpClient({}), context, signer, registry);
    const result = await service.execute({}, context);
    expect(result.result_class).toBe('rejected');
    expect(result.failure?.code).toBe('invalid_request');
  });

  it('resolves exact identity and SEC submissions for a CIK, producing a schema-valid, mesh-passing PCC document', async () => {
    const fixture = loadAdapterFixture('sec-edgar/submissions-success.json');
    const httpClient = jsonHttpClient(fixture);
    const context = await buildTestServiceContext('company_evidence_graph.v1');
    const service = await buildService(httpClient, context, signer, registry);

    const result = await service.execute(
      {
        identifiers: { cik: '0000320193' },
        requested_field_groups: ['identity', 'sec_submissions'],
      },
      context
    );

    expect(result.result_class).toBe('success');
    expect(result.output).toBeDefined();
    expect(result.receipt_id).toMatch(/^rcpt_[a-f0-9]{24}$/);
    expect(result.completeness?.supported_fields).toBe(2);
    expect(httpClient.callCount).toBeGreaterThan(0);

    // Real cryptographic receipt verification for this "complete" fixture
    // — not just receipt_id pattern matching.
    const verification = await verifyReceipt(result.receipt as VerificationReceipt, registry, {
      service_id: 'company_evidence_graph.v1',
      contract_release: '1.0.0',
      output_hash: result.output_hash,
    });
    expect(verification.status).toBe('valid');
  });

  // SUN-1222C-R10: `SecSubmissionsAdapter.execute()` already classifies a
  // rejected SEC response into a specific `error.code`/`error.message`
  // (e.g. "HTTP 403: forbidden or unauthorized" from `SecureHttpClient`'s
  // `classifyTerminalHttpStatus`) — but this call site previously read
  // only `result.resultClass` when building the `limitations` entry,
  // silently discarding that detail. The only surviving trace of a real
  // rejected SEC call was then the generic string "... returned
  // permanent_failure for CIK ...", indistinguishable from every other
  // possible rejection reason (401 vs 403 vs an unrecognized status vs a
  // network-classified generic error) — a genuine, proven observability
  // gap discovered while diagnosing five identical-looking real SEC
  // rejections in production (docs/reports/SUN-1222C-R10-*.md).
  it('preserves the adapter-classified error code/message in the SEC-submissions limitation, not just resultClass', async () => {
    const httpClient = jsonHttpClient({}, { status: 403 });
    const context = await buildTestServiceContext('company_evidence_graph.v1');
    const service = await buildService(httpClient, context, signer, registry);

    const result = await service.execute(
      {
        identifiers: { cik: '0000320193' },
        requested_field_groups: ['identity', 'sec_submissions'],
      },
      context
    );

    const limitation = result.limitations.find((l) => l.includes('sec-edgar company_submissions'));
    expect(limitation).toContain('permanent_failure');
    // The precise, safe (status-code-derived, never-raw-body) detail must
    // survive into the limitation text so a real rejection is diagnosable
    // from persisted/returned state alone, without Modal/Workflow log
    // archaeology.
    expect(limitation).toContain('HTTP 403');
  });

  it('produces a truthful limitation when website_evidence is requested without buyer_urls', async () => {
    const context = await buildTestServiceContext('company_evidence_graph.v1');
    const service = await buildService(jsonHttpClient({}), context, signer, registry);

    const result = await service.execute(
      { company_name: 'Partial Corp', requested_field_groups: ['identity', 'website_evidence'] },
      context
    );

    expect(result.limitations.some((l) => l.includes('website_evidence'))).toBe(true);
  });

  it('reports an unimplemented field group as unavailable rather than fabricating data', async () => {
    const context = await buildTestServiceContext('company_evidence_graph.v1');
    const service = await buildService(jsonHttpClient({}), context, signer, registry);

    const result = await service.execute(
      {
        company_name: 'Repo Corp',
        requested_field_groups: ['identity', 'public_repository_signals'],
      },
      context
    );
    expect(
      result.limitations.some(
        (l) => l.includes('public_repository_signals') && l.includes('not implemented')
      )
    ).toBe(true);
  });

  it('resolves website_evidence via the direct-public-http adapter', async () => {
    const httpClient = textHttpClient(
      '<html><head><title>Acme</title></head><body>Hello</body></html>'
    );
    const context = await buildTestServiceContext('company_evidence_graph.v1');
    const service = await buildService(httpClient, context, signer, registry);

    const result = await service.execute(
      {
        company_name: 'Acme',
        buyer_urls: ['https://acme.example/'],
        requested_field_groups: ['identity', 'website_evidence'],
      },
      context
    );
    expect(result.result_class === 'success' || result.result_class === 'partial').toBe(true);
    expect(result.metrics.evidence_produced).toBeGreaterThan(0);
  });
});
