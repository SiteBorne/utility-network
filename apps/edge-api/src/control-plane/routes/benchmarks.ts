import { Hono } from 'hono';
import { z } from 'zod';

// SUN-1100 checkpoint 1: `GET /benchmarks` was listed as a required free
// endpoint (docs/source/SITEBORNE_UTILITY_NETWORK_MASTER_DIRECTIVE.md
// section 5) but never implemented — confirmed 404 both locally and against
// the live deployment before this fix. Per that section's own scope ("Free
// endpoints may reveal schemas, fixed fixtures, health and price
// information"), this exposes real, already-disclosed local measurement
// evidence as static fixtures — never a live per-request benchmark run
// (which would be a real customer job performed for free, prohibited by the
// same section), and never a fabricated production SLA/throughput number.
// Source data is copied from the checked-in, human-reviewed reports below;
// update this file's fixtures if those reports change, do not compute fresh
// numbers here.
export const benchmarksRoute = new Hono();

const DocumentWorkerBenchmarkCaseSchema = z.object({
  case: z.string(),
  median_ms: z.number(),
  notes: z.string(),
});

const LoadProfileSchema = z.object({
  profile_id: z.string(),
  services: z.string(),
  concurrency: z.string(),
  requests: z.string(),
  expected_responses: z.string(),
});

const BenchmarksResponseSchema = z.object({
  disclosure: z.string(),
  document_worker_local_benchmarks: z.object({
    source: z.string(),
    methodology: z.string(),
    cases: z.array(DocumentWorkerBenchmarkCaseSchema),
  }),
  v2_load_capacity_baseline: z.object({
    source: z.string(),
    disclosure: z.string(),
    total_requests: z.number(),
    total_wall_time_seconds_approx: z.number(),
    profiles: z.array(LoadProfileSchema),
  }),
  generated_at: z.string().datetime({ offset: true }),
});

benchmarksRoute.get('/', (c) => {
  const response = {
    disclosure:
      'Fixed, human-reviewed local measurement evidence only — never a live per-request benchmark, never a production SLA or capacity guarantee. See linked source documents for full methodology and caveats.',
    document_worker_local_benchmarks: {
      source: 'docs/operations/DOCUMENT_BENCHMARKS.md',
      methodology:
        'Each fixture case run 5x in the same warm process (OCR model-load cost paid once, matching a warm container). Local development evidence only, not Modal production performance, not a CI gate (host-dependent).',
      cases: [
        { case: 'Native-text PDF, 1 page', median_ms: 2, notes: 'pdfplumber, no OCR' },
        { case: 'Small table PDF, 1 page', median_ms: 4, notes: 'pdfplumber table detection' },
        {
          case: 'OCR image (PNG)',
          median_ms: 635,
          notes: 'RapidOCR inference, warm engine',
        },
        {
          case: 'Scanned PDF page (OCR)',
          median_ms: 880,
          notes: 'includes page-to-image render + OCR',
        },
      ],
    },
    v2_load_capacity_baseline: {
      source: 'security/load/LOAD_MATRIX.md',
      disclosure:
        'LOCAL_PREPRODUCTION_CAPACITY_BASELINE — real local measurement (Miniflare D1 + real Ed25519 signing), disclosed as-is, not remediated, not a customer-facing capacity guarantee. No governed numeric production SLA exists in this repository for this axis.',
      total_requests: 118,
      total_wall_time_seconds_approx: 57,
      profiles: [
        {
          profile_id: 'WARMUP',
          services: 'all 4 v2 services',
          concurrency: '2',
          requests: '8',
          expected_responses: '100% 200/202',
        },
        {
          profile_id: 'STEADY_CONCURRENCY',
          services: 'all 4 v2 services (even split)',
          concurrency: '8',
          requests: '40',
          expected_responses: '100% 200/202',
        },
        {
          profile_id: 'BURST',
          services: 'company_evidence_graph.v2',
          concurrency: '16',
          requests: '16',
          expected_responses: '100% 200/202',
        },
        {
          profile_id: 'D1_CONTENTION',
          services: 'company_evidence_graph.v2',
          concurrency: '15',
          requests: '20',
          expected_responses: '100% 200/202, single result class',
        },
        {
          profile_id: 'MIXED_SERVICE',
          services: 'all 4 v2 services (6 each)',
          concurrency: '8',
          requests: '24',
          expected_responses: '100% 200/202, even distribution',
        },
        {
          profile_id: 'DUPLICATE_ID_CONTENTION',
          services: 'company_evidence_graph.v2',
          concurrency: '10',
          requests: '10',
          expected_responses: '100% 200/202, <=1 distinct success class',
        },
        {
          profile_id: 'RESOURCE_STABILITY',
          services: 'n/a (process RSS)',
          concurrency: 'n/a',
          requests: 'n/a',
          expected_responses: 'RSS growth < 5x across campaign',
        },
      ],
    },
    generated_at: new Date().toISOString(),
  };

  return c.json(BenchmarksResponseSchema.parse(response));
});
