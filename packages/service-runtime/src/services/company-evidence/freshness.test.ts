/**
 * End-to-end freshness tests for company_evidence_graph.v1 — proves stale
 * evidence is scored as stale by the real mesh (through the actual
 * service pipeline) without ever being confused with verified absence,
 * and that the freshness_seconds threshold genuinely changes service
 * behavior. See docs/decisions/0038 and the freshness trace in
 * docs/reports/SUN-0600-local-services-report.md.
 *
 * Freshness path (traced): CompanyEvidenceInput.freshness_seconds ->
 * buildDraftDocument({freshnessSeconds}) -> draft.contract.freshness_seconds
 * -> verifyAndSign() sets candidate.freshness_requirement_ms =
 * draft.contract.freshness_seconds * 1000 -> runMesh's FreshnessVerifier
 * compares each evidence item's retrieved_at against that requirement.
 *
 * Deterministic stale injection: the Federal Register adapter itself
 * stamps evidence `retrieved_at` from a real `new Date()` at call time (not
 * from the injected ServiceExecutionContext clock — a pre-existing
 * SUN-0300 characteristic, unrelated to this package). To make evidence
 * appear stale without sleeping, mutating the system clock, or touching a
 * `stale` flag after the fact, this file injects an *offset* clock for
 * ServiceExecutionContext: its nowMs() always returns real wall-clock time
 * plus a fixed, test-chosen offset. The adapter's real-time retrieved_at is
 * therefore always in the *past* relative to the mesh's nowMs() by exactly
 * that offset — deterministic regardless of the actual wall-clock value at
 * run time, and derived entirely by the service's own freshness_verifier
 * call, not asserted externally.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import {
  SecSubmissionsAdapter,
  PublicHttpAdapter,
  FederalRegisterAdapter,
} from '@siteborne/provider-adapters';
import type {
  AuditEventSink as AdapterAuditEventSink,
  InjectedClock as AdapterClock,
} from '@siteborne/provider-adapters';
import type { KeyRegistry } from '@siteborne/verification';
import { verifyReceipt, type Signer, type VerificationReceipt } from '@siteborne/verification';
import { CompanyEvidenceGraphService } from './service';
import {
  buildServiceContext,
  createTestArtifactStore,
  createTestServiceAuditSink,
} from '../../context';
import { createFixtureSigner, jsonHttpClient } from '../../tests/support';
import type { CompanyEvidenceExtension } from './types';
import type { ServiceExecutionContext } from '../../types';

const noopAdapterAudit: AdapterAuditEventSink = { async log() {}, getEvents: () => [], clear() {} };

/** Real wall-clock time plus a fixed offset, applied consistently to every
 * call — never sleeps, never mutates the system clock. Any adapter code
 * that stamps `retrieved_at` from its own `new Date()` call therefore
 * always looks `offsetMs` older than this clock's `nowMs()`. */
function buildOffsetClock(offsetMs: number): AdapterClock {
  return {
    now: () => new Date(Date.now() + offsetMs),
    nowMs: () => Date.now() + offsetMs,
    setTimeout: (cb: () => void, delay: number) => setTimeout(cb, delay),
    clearTimeout: (id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>),
    advance: () => {},
    getCurrentTime: () => Date.now() + offsetMs,
    setTime: () => {},
  };
}

function buildContext(clock: AdapterClock): ServiceExecutionContext {
  return buildServiceContext('company_evidence_graph.v1', {
    clock,
    artifact_store: createTestArtifactStore(),
    audit: createTestServiceAuditSink(),
    execution_mode: 'fixture',
  });
}

const FEDERAL_REGISTER_DOCUMENT = {
  document_number: '2024-01234',
  title: 'Cybersecurity Requirements for Financial Institutions',
  publication_date: '2024-01-15',
};

describe('company_evidence_graph.v1 — freshness end-to-end (real service, real mesh)', () => {
  let signer: Signer;
  let registry: KeyRegistry;
  beforeAll(async () => {
    ({ signer, registry } = await createFixtureSigner());
  });

  it('stale evidence is recognized as stale by the mesh, but never becomes verified absence, unavailable, or a failure', async () => {
    // Offset far beyond the requested freshness window: evidence retrieved
    // "now" (real time) will appear this many ms old by the time the mesh
    // evaluates it.
    const context = buildContext(buildOffsetClock(60 * 60 * 1000)); // +1h
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
      {
        company_name: 'Acme Regulated Corp',
        requested_field_groups: ['regulatory_mentions'],
        freshness_seconds: 60,
      },
      context
    ); // 60s requirement, evidence ~1h "old"

    // 1. Provider invocation succeeded.
    expect(httpClient.callCount).toBeGreaterThan(0);
    // 2. Observation/evidence exists, positive result (not absence).
    const output = result.output as CompanyEvidenceExtension;
    expect(output.regulatory_references).toHaveLength(1);
    // 5. Not absence, not_found, timeout, policy_blocked, or source_changed.
    // 6. No verified_absences entry from stale evidence.
    expect(output.verified_absences).toBeUndefined();
    // 4. Freshness verifier recognizes it as stale — surfaced via the
    // service's verification summary (mesh's freshness score < 1).
    expect(result.verification).toBeDefined();
    expect(result.verification!.freshness).toBeLessThan(1);
    // 9/10/11. Frozen schema + PCC + mesh all still apply normally —
    // freshness is a score, not itself a blocking gate (per ADR/mesh design),
    // so the overall decision is still pass.
    expect(result.verification!.decision).toBe('pass');
    expect(result.result_class).toBe('success');
    // 7. Completeness stays truthful (not degraded by freshness alone, since
    // freshness is not a blocking gate in this policy).
    expect(result.completeness?.supported_fields).toBe(1);
    // 13/14. A signed receipt exists and cryptographically verifies.
    expect(result.receipt).toBeDefined();
    const verification = await verifyReceipt(result.receipt as VerificationReceipt, registry, {
      service_id: 'company_evidence_graph.v1',
    });
    expect(verification.status).toBe('valid');
  });

  it('repeated deterministic execution (same offset clock semantics) yields the same semantic staleness result', async () => {
    const run = async () => {
      const context = buildContext(buildOffsetClock(60 * 60 * 1000));
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
      return service.execute(
        {
          company_name: 'Acme Regulated Corp',
          requested_field_groups: ['regulatory_mentions'],
          freshness_seconds: 60,
        },
        context
      );
    };

    const a = await run();
    const b = await run();
    expect(a.result_class).toBe(b.result_class);
    expect(a.verification!.freshness).toBeLessThan(1);
    expect(b.verification!.freshness).toBeLessThan(1);
  });
});

describe('company_evidence_graph.v1 — freshness threshold regression (fresh vs stale, same observation)', () => {
  let signer: Signer;
  beforeAll(async () => {
    ({ signer } = await createFixtureSigner());
  });

  async function runWithFreshnessSeconds(freshnessSeconds: number) {
    // A small, fixed offset (5s) simulating a small amount of real elapsed
    // time between retrieval and verification — deterministic and tiny,
    // never a sleep.
    const context = buildContext(buildOffsetClock(5_000));
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
    return service.execute(
      {
        company_name: 'Acme Regulated Corp',
        requested_field_groups: ['regulatory_mentions'],
        freshness_seconds: freshnessSeconds,
      },
      context
    );
  }

  it('Case A: freshness_seconds sufficiently large than the elapsed offset → fresh (freshness score 1)', async () => {
    const result = await runWithFreshnessSeconds(3600); // 1h requirement >> 5s elapsed
    expect(result.verification!.freshness).toBe(1);
  });

  it('Case B: freshness_seconds sufficiently small relative to the elapsed offset → stale (freshness score 0)', async () => {
    const result = await runWithFreshnessSeconds(1); // 1s requirement << 5s elapsed
    expect(result.verification!.freshness).toBe(0);
  });
});

describe('company_evidence_graph.v1 — recent_filings regression (previously unreachable via IMPLEMENTED_FIELD_GROUPS)', () => {
  let signer: Signer;
  beforeAll(async () => {
    ({ signer } = await createFixtureSigner());
  });

  it('requesting recent_filings runs the SEC dependency and populates a contract-valid recent-filings result', async () => {
    const context = buildServiceContext('company_evidence_graph.v1', {
      artifact_store: createTestArtifactStore(),
      audit: createTestServiceAuditSink(),
      execution_mode: 'fixture',
    });
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const fixture = JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL(
            '../../../../provider-adapters/fixtures/sec-edgar/submissions-success.json',
            import.meta.url
          )
        ),
        'utf-8'
      )
    );
    const httpClient = jsonHttpClient(fixture);
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
      { identifiers: { cik: '0000320193' }, requested_field_groups: ['recent_filings'] },
      context
    );

    expect(result.result_class).toBe('success');
    const output = result.output as CompanyEvidenceExtension;
    expect(output.field_groups?.recent_filings?.status).toBe('complete');
    expect(output.filing_summaries?.length).toBeGreaterThan(0);
  });

  it('not requesting recent_filings never calls the SEC dependency for it', async () => {
    const context = buildServiceContext('company_evidence_graph.v1', {
      artifact_store: createTestArtifactStore(),
      audit: createTestServiceAuditSink(),
      execution_mode: 'fixture',
    });
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
      { identifiers: { cik: '0000320193' }, requested_field_groups: ['identity'] },
      context
    );

    const output = result.output as CompanyEvidenceExtension;
    expect(output.field_groups?.recent_filings).toBeUndefined();
    expect(httpClient.callCount).toBe(0);
  });
});
