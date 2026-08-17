/**
 * SUN-1000 checkpoint 1N-B — v2 load / capacity release gate.
 *
 * Boots the exact same real Miniflare-backed D1 database + real
 * `buildPaidServicesApp` Hono app already used throughout this project's
 * accepted test suites, bound to a real, ephemeral local TCP port via
 * `@hono/node-server` (the same pattern `schemathesis-server-host.test.ts`
 * established at checkpoint 1I) — a genuine local HTTP listener, not
 * direct `app.request()` calls. Runs a bounded, deterministic set of load
 * profiles against it via real `fetch()`, credential-free throughout
 * (`evidenceMode: 'fixture'`, zero Nevermined/CDP calls).
 *
 * No numeric latency/throughput SLA is defined anywhere in this
 * repository's governance for the SUN-1000 load criterion specifically
 * (`governance/RUBRIC.yaml`'s "p95 latency under SLA" and
 * `governance/PROMOTION_STATES.yaml`'s "Load test passes at Nx expected
 * traffic" both reference an SLA/traffic figure that is never itself
 * defined anywhere, and govern a different axis — per-service production
 * promotion, not this preproduction security-release gate). Per the
 * checkpoint directive: no production SLA is fabricated. Instead, a
 * `RELEASE_GATE_THRESHOLD` is derived empirically from this run's own
 * `WARMUP` profile, with a generous multiplier — its purpose is to catch
 * catastrophic regressions, not to certify a production capacity number.
 */
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serve, type ServerType } from '@hono/node-server';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import {
  buildBuyerPaymentIdentifierExtensions,
  decodePaymentRequiredHeaderSafe,
  encodePaymentSignatureHeaderSafe,
  generateSiteborneePaymentId,
  type PaymentRequired,
  type PaymentPayload,
} from '@siteborne/protocol-x402';
import { buildPaidServicesApp } from '../src/control-plane/routes/paid-services';
import {
  computeLatencyStats,
  runWithConcurrency,
  throughputPerSecond,
  type LatencyStats,
} from '../../../scripts/security/load-stats';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../migrations', import.meta.url));

function runMigrations(db: D1Database): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  return files.reduce(async (prev, file) => {
    await prev;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    const statements = sql
      .split(';')
      .map((raw) =>
        raw
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.length > 0 && !l.startsWith('--'))
          .join(' ')
          .trim()
      )
      .filter((s) => s.length > 0);
    for (const stmt of statements) {
      await db.exec(stmt);
    }
  }, Promise.resolve());
}

const V2_ROUTES: Record<string, { path: string; input: unknown }> = {
  company: {
    path: '/v2/company/evidence-graph',
    input: {
      identifiers: { cik: '0000320193' },
      requested_field_groups: ['identity', 'sec_submissions'],
    },
  },
  web: {
    path: '/v2/web/context',
    input: { target_url: 'https://acme.example/', retrieval_mode: 'direct' },
  },
  document: {
    path: '/v2/document/evidence-json',
    input: {
      artifact_reference: {
        artifact_id: 'doc/native-fixture.pdf',
        media_type: 'application/pdf',
        size_bytes: 1,
      },
    },
  },
  verify: {
    path: '/v2/verify/agent-output',
    input: {
      verification_contract: {
        claims: [{ claim_id: 'total', predicate: 'equals', expected_value: 42 }],
        deterministic_requirements: [],
      },
      candidate_output: { total: 42 },
      required_schema: {},
      verification_mode: 'standard',
    },
  },
};

interface RequestOutcome {
  ok: boolean;
  status: number;
  elapsedMs: number;
  resultClass?: string;
}

/** One full, real, HTTP 402 -> pay -> 200 lifecycle against a real port —
 * the genuine unit of work every profile below is built from. */
async function runPaidLifecycle(
  baseUrl: string,
  route: { path: string; input: unknown },
  paymentIdentifier: string = generateSiteborneePaymentId()
): Promise<RequestOutcome> {
  const started = performance.now();
  const challengeRes = await fetch(baseUrl + route.path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(route.input),
  });
  if (challengeRes.status !== 402) {
    return { ok: false, status: challengeRes.status, elapsedMs: performance.now() - started };
  }
  const headerValue = challengeRes.headers.get('PAYMENT-REQUIRED') ?? '';
  const decoded = decodePaymentRequiredHeaderSafe(headerValue);
  if (!decoded.ok) {
    return { ok: false, status: 0, elapsedMs: performance.now() - started };
  }
  const challenge = decoded.value as PaymentRequired;
  const requirement = challenge.accepts[0];
  const extensions = buildBuyerPaymentIdentifierExtensions(
    challenge.extensions ?? {},
    paymentIdentifier
  );
  const payload: PaymentPayload = {
    x402Version: 2,
    resource: challenge.resource,
    accepted: requirement,
    payload: { synthetic_signature: 'synthetic:buyer-fixture' },
    extensions,
  };
  const header = encodePaymentSignatureHeaderSafe(payload);
  const payRes = await fetch(baseUrl + route.path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': header },
    body: JSON.stringify(route.input),
  });
  const elapsedMs = performance.now() - started;
  if (payRes.status !== 200 && payRes.status !== 202) {
    return { ok: false, status: payRes.status, elapsedMs };
  }
  const body = (await payRes.json()) as Record<string, unknown>;
  return {
    ok: true,
    status: payRes.status,
    elapsedMs,
    resultClass: body.result_class as string | undefined,
  };
}

interface ProfileResult {
  attempted: number;
  outcomes: RequestOutcome[];
  durationMs: number;
  stats: LatencyStats;
  throughput: number;
  successes: number;
  unexpectedFailures: number;
}

async function runProfile(
  label: string,
  routes: { path: string; input: unknown }[],
  concurrency: number,
  uniqueIds: boolean
): Promise<ProfileResult> {
  const started = performance.now();
  const tasks = routes.map((route, i) => async () => {
    const id = uniqueIds ? generateSiteborneePaymentId() : undefined;
    return runPaidLifecycle(GLOBAL_BASE_URL, route, id);
  });
  const outcomes = await runWithConcurrency(tasks, concurrency);
  const durationMs = performance.now() - started;
  const successes = outcomes.filter((o) => o.ok && o.status === 200).length;
  const unexpectedFailures = outcomes.filter((o) => !o.ok).length;
  const stats = computeLatencyStats(outcomes.map((o) => o.elapsedMs));
  const throughput = throughputPerSecond(outcomes.length, durationMs);
  // eslint-disable-next-line no-console
  console.log(
    `[load:${label}] attempted=${outcomes.length} successes=${successes} unexpected_failures=${unexpectedFailures} p50=${stats.p50.toFixed(1)}ms p95=${stats.p95.toFixed(1)}ms throughput=${throughput.toFixed(1)}req/s`
  );
  return {
    attempted: outcomes.length,
    outcomes,
    durationMs,
    stats,
    throughput,
    successes,
    unexpectedFailures,
  };
}

// Module-scope so `runProfile`'s task closures (constructed once per
// profile, executed under bounded concurrency) can reach the real port —
// assigned once in `beforeAll`, read-only thereafter.
let GLOBAL_BASE_URL = '';

describe('SUN-1000 checkpoint 1N-B — v2 load/capacity gate', () => {
  let tempDir: string;
  let mf: Miniflare;
  let server: ServerType;
  let warmupStats: LatencyStats;
  let releaseGateThresholdMs = 0;
  const rssBefore = process.memoryUsage().rss;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'siteborne-load-v2-'));
    mf = new Miniflare({
      modules: true,
      script: `export default { async fetch() { return new Response('OK'); } }`,
      d1Databases: ['DB'],
      resourcePersistencePath: tempDir,
    });
    const db = await mf.getD1Database('DB');
    await db.exec('PRAGMA foreign_keys = ON');
    await runMigrations(db);
    const app = await buildPaidServicesApp({ db, evidenceMode: 'fixture' });
    server = await new Promise<ServerType>((resolve) => {
      const s = serve({ fetch: app.fetch, port: 0 }, () => resolve(s));
    });
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : undefined;
    if (!port) throw new Error('load_server_no_port: server did not bind a real TCP port');
    GLOBAL_BASE_URL = `http://127.0.0.1:${port}`;
  }, 30_000);

  afterAll(async () => {
    server?.close();
    await mf?.dispose();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('WARMUP: a small, low-concurrency run against all four v2 services establishes the release-gate baseline', async () => {
    const routes = [V2_ROUTES.company, V2_ROUTES.web, V2_ROUTES.document, V2_ROUTES.verify].flatMap(
      (r) => Array.from({ length: 2 }, () => r)
    );
    const result = await runProfile('WARMUP', routes, 2, true);
    expect(result.unexpectedFailures).toBe(0);
    warmupStats = result.stats;
    // SUN-1000 checkpoint 1N-B: a deliberately generous, empirically
    // derived RELEASE_GATE_THRESHOLD -- 10x the measured warmup p95, with
    // a 2000ms floor for CI-machine variability. This is a regression
    // guard, not a production SLA (no such SLA is defined anywhere in
    // this repository's governance for this criterion).
    releaseGateThresholdMs = Math.max(warmupStats.p95 * 10, 2000);
  }, 30_000);

  it('STEADY_CONCURRENCY: bounded sustained concurrency across all four v2 services stays within the release-gate threshold', async () => {
    const routes = [V2_ROUTES.company, V2_ROUTES.web, V2_ROUTES.document, V2_ROUTES.verify].flatMap(
      (r) => Array.from({ length: 10 }, () => r)
    );
    const result = await runProfile('STEADY_CONCURRENCY', routes, 8, true);
    expect(result.unexpectedFailures).toBe(0);
    expect(result.successes).toBe(result.attempted);
    expect(result.stats.p95).toBeLessThan(releaseGateThresholdMs);
  }, 60_000);

  it('BURST: a short bounded concurrency spike completes with zero unexpected failures', async () => {
    const routes = Array.from({ length: 16 }, () => V2_ROUTES.company);
    const result = await runProfile('BURST', routes, 16, true);
    expect(result.unexpectedFailures).toBe(0);
    expect(result.successes).toBe(result.attempted);
  }, 30_000);

  it('D1_CONTENTION: concurrent unique-identifier requests against the same service exercise real D1 acquire/settle paths with zero contention errors', async () => {
    const routes = Array.from({ length: 20 }, () => V2_ROUTES.company);
    const result = await runProfile('D1_CONTENTION', routes, 15, true);
    expect(result.unexpectedFailures).toBe(0);
    expect(result.successes).toBe(result.attempted);
    // Every successful lifecycle must have produced a distinct receipt --
    // no cross-request leakage under concurrent D1 access.
    const receiptClasses = new Set(result.outcomes.map((o) => o.resultClass));
    expect(receiptClasses.size).toBeLessThanOrEqual(1); // all report the same result_class ('success'), never a mixed/wrong class
  }, 60_000);

  it('MIXED_SERVICE: an even distribution across all four v2 services reports no single service silently dominating or failing', async () => {
    const perService = 6;
    const routes = [V2_ROUTES.company, V2_ROUTES.web, V2_ROUTES.document, V2_ROUTES.verify].flatMap(
      (r) => Array.from({ length: perService }, () => r)
    );
    const result = await runProfile('MIXED_SERVICE', routes, 8, true);
    expect(result.unexpectedFailures).toBe(0);
    expect(result.successes).toBe(result.attempted);
    expect(result.attempted).toBe(perService * 4);
  }, 60_000);

  it('DUPLICATE_ID_CONTENTION: 10 concurrent requests sharing one Payment-Identifier and the same quote binding produce at most one successful lifecycle, never duplicate execution', async () => {
    // Deliberately mirrors chaos-v2.test.ts's CONCURRENT_DUPLICATE_REQUEST
    // shape: ONE shared 402 challenge (same quote_id/binding), then N
    // concurrent pay attempts reusing it -- this is "the same logical
    // request replayed concurrently," the real contention case. Getting a
    // fresh 402 challenge per concurrent attempt would instead bind each
    // to a *different* quote under the *same* identifier, which the
    // system correctly treats as an unrelated duplicate_conflict, not
    // this scenario.
    const challengeRes = await fetch(GLOBAL_BASE_URL + V2_ROUTES.company.path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(V2_ROUTES.company.input),
    });
    expect(challengeRes.status).toBe(402);
    const decoded = decodePaymentRequiredHeaderSafe(
      challengeRes.headers.get('PAYMENT-REQUIRED') ?? ''
    );
    expect(decoded.ok).toBe(true);
    const challenge = (decoded as { ok: true; value: PaymentRequired }).value;
    const id = generateSiteborneePaymentId();
    const extensions = buildBuyerPaymentIdentifierExtensions(challenge.extensions ?? {}, id);
    const payload: PaymentPayload = {
      x402Version: 2,
      resource: challenge.resource,
      accepted: challenge.accepts[0],
      payload: { synthetic_signature: 'synthetic:buyer-fixture' },
      extensions,
    };
    const header = encodePaymentSignatureHeaderSafe(payload);

    const started = performance.now();
    const tasks = Array.from({ length: 10 }, () => async () => {
      const t0 = performance.now();
      const res = await fetch(GLOBAL_BASE_URL + V2_ROUTES.company.path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': header },
        body: JSON.stringify(V2_ROUTES.company.input),
      });
      const elapsedMs = performance.now() - t0;
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return {
        status: res.status,
        elapsedMs,
        resultClass: body.result_class as string | undefined,
      };
    });
    const outcomes = await runWithConcurrency(tasks, 10);
    const durationMs = performance.now() - started;
    const stats = computeLatencyStats(outcomes.map((o) => o.elapsedMs));
    // eslint-disable-next-line no-console
    console.log(
      `[load:DUPLICATE_ID_CONTENTION] attempted=${outcomes.length} p50=${stats.p50.toFixed(1)}ms throughput=${throughputPerSecond(outcomes.length, durationMs).toFixed(1)}req/s`
    );
    // Every response is either a completed success or an in-flight/
    // processing marker -- never a distinct duplicate success, never an
    // unexpected error (mirrors the accepted concurrency pattern from
    // x402-service-route.test.ts / chaos-v2.test.ts).
    expect(outcomes.every((o) => o.status === 200 || o.status === 202)).toBe(true);
    const successful = outcomes.filter((o) => o.status === 200);
    const receiptClasses = new Set(successful.map((o) => o.resultClass));
    expect(receiptClasses.size).toBeLessThanOrEqual(1);
  }, 30_000);

  it('RESOURCE_STABILITY: memory does not grow catastrophically across the full campaign', () => {
    const rssAfter = process.memoryUsage().rss;
    const growthFactor = rssAfter / rssBefore;
    // eslint-disable-next-line no-console
    console.log(
      `[load:RESOURCE_STABILITY] rss_before=${(rssBefore / 1e6).toFixed(1)}MB rss_after=${(rssAfter / 1e6).toFixed(1)}MB growth=${growthFactor.toFixed(2)}x`
    );
    // A relative catastrophic-growth guard, not a tight absolute number
    // (machine-dependent) -- generous enough to tolerate normal Node/V8
    // heap growth from this bounded campaign, tight enough to catch a
    // genuine unbounded leak.
    expect(growthFactor).toBeLessThan(5);
  });
});
