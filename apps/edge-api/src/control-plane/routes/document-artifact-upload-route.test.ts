/**
 * SUN-1222B-S3-R2 — integration tests for `POST /v2/artifacts/documents`
 * against REAL Miniflare-backed D1 and R2 bindings (same fidelity
 * convention as `document-evidence-json-v2-cdp-composition.test.ts`'s own
 * D1 usage) — proves the route's flag gating, byte-limit enforcement (both
 * the Content-Length fast-path and the streamed bounded-read path),
 * media-type validation, and — critically (§34) — that the success
 * response NEVER leaks the R2 bucket name, the internal R2 object key, or
 * any D1/binding implementation detail; only the opaque buyer capability.
 */
import { readFileSync, readdirSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { Hono } from 'hono';
import type { Env } from '../config/env';
import {
  documentArtifactUploadRoute,
  isDocumentArtifactUploadRouteFlagEnabled,
} from './document-artifact-upload-route';
import { DOCUMENT_UPLOAD_MAX_BYTES } from '../artifacts/document-upload';
import {
  DOCUMENT_INGRESS_PER_SOURCE_LIMIT,
  DOCUMENT_INGRESS_ADMISSION_WINDOW_SECONDS,
} from '../artifacts/document-ingress-admission-control';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../../migrations', import.meta.url));

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

const REAL_PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // "%PDF-1.4"

function pdfBytes(extra = 'sun-1222b-s3-r2 route fixture'): Uint8Array {
  const body = new TextEncoder().encode(extra);
  const out = new Uint8Array(REAL_PDF_MAGIC.length + body.length);
  out.set(REAL_PDF_MAGIC, 0);
  out.set(body, REAL_PDF_MAGIC.length);
  return out;
}

function baseEnv(db: D1Database, bucket: R2Bucket, overrides: Partial<Env> = {}): Env {
  return {
    DB: db,
    ARTIFACTS: bucket,
    JOBS: {} as Env['JOBS'],
    EVENTS: {} as Env['EVENTS'],
    CATALOG: {} as Env['CATALOG'],
    AI: {} as Env['AI'],
    BROWSER: {} as Env['BROWSER'],
    ENVIRONMENT: 'production',
    LOG_LEVEL: 'info',
    PCC_VERSION: '1.0.0',
    ...overrides,
  } as Env;
}

function appWithRoute(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.post('/v2/artifacts/documents', documentArtifactUploadRoute);
  return app;
}

describe('isDocumentArtifactUploadRouteFlagEnabled', () => {
  it('requires BOTH PAID_ROUTES_ENABLED and DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED to be the exact string "true"', () => {
    expect(isDocumentArtifactUploadRouteFlagEnabled({})).toBe(false);
    expect(isDocumentArtifactUploadRouteFlagEnabled({ PAID_ROUTES_ENABLED: 'true' })).toBe(false);
    expect(
      isDocumentArtifactUploadRouteFlagEnabled({ DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED: 'true' })
    ).toBe(false);
    expect(
      isDocumentArtifactUploadRouteFlagEnabled({
        PAID_ROUTES_ENABLED: 'yes',
        DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED: 'true',
      })
    ).toBe(false);
    expect(
      isDocumentArtifactUploadRouteFlagEnabled({
        PAID_ROUTES_ENABLED: 'true',
        DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED: 'true',
      })
    ).toBe(true);
  });
});

describe('POST /v2/artifacts/documents', () => {
  let tempDir: string;
  let mf: Miniflare;
  let db: D1Database;
  let bucket: R2Bucket;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'siteborne-document-upload-route-'));
    mf = new Miniflare({
      modules: true,
      script: `export default { async fetch() { return new Response('OK'); } }`,
      d1Databases: ['DB'],
      r2Buckets: ['ARTIFACTS'],
      resourcePersistencePath: tempDir,
    });
    db = await mf.getD1Database('DB');
    // Miniflare's own R2Bucket type structurally disagrees with
    // `@cloudflare/workers-types`'s `Headers` (undici vs. workers-types)
    // on `writeHttpMetadata` alone -- a real, runtime-compatible R2Bucket,
    // just not nominally identical to the ambient type `R2ArtifactStoreAdapter`
    // is declared against. Same real-binding convention as `db` above.
    bucket = (await mf.getR2Bucket('ARTIFACTS')) as unknown as R2Bucket;
    await db.exec('PRAGMA foreign_keys = ON');
    await runMigrations(db);
  }, 30_000);

  afterAll(async () => {
    await mf.dispose();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns 404 when the flags are absent (current/default deployed state) -- never a 500, never a fixture fallback', async () => {
    const app = appWithRoute();
    const res = await app.request(
      '/v2/artifacts/documents',
      { method: 'POST', body: pdfBytes() },
      baseEnv(db, bucket)
    );
    expect(res.status).toBe(404);
  });

  it('returns 404 when PAID_ROUTES_ENABLED=true but DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED is absent', async () => {
    const app = appWithRoute();
    const res = await app.request(
      '/v2/artifacts/documents',
      { method: 'POST', body: pdfBytes() },
      baseEnv(db, bucket, { PAID_ROUTES_ENABLED: 'true' })
    );
    expect(res.status).toBe(404);
  });

  it('returns 404 when both flags are true but DB is missing (fails closed, never falls back to an in-memory store)', async () => {
    const app = appWithRoute();
    const res = await app.request(
      '/v2/artifacts/documents',
      { method: 'POST', body: pdfBytes() },
      baseEnv(db, bucket, {
        PAID_ROUTES_ENABLED: 'true',
        DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED: 'true',
        DB: undefined as unknown as Env['DB'],
      })
    );
    expect(res.status).toBe(404);
  });

  it('returns 404 when both flags are true but ARTIFACTS (R2) is missing', async () => {
    const app = appWithRoute();
    const res = await app.request(
      '/v2/artifacts/documents',
      { method: 'POST', body: pdfBytes() },
      baseEnv(db, bucket, {
        PAID_ROUTES_ENABLED: 'true',
        DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED: 'true',
        ARTIFACTS: undefined as unknown as Env['ARTIFACTS'],
      })
    );
    expect(res.status).toBe(404);
  });

  const enabledEnv = () =>
    baseEnv(db, bucket, {
      PAID_ROUTES_ENABLED: 'true',
      DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED: 'true',
    });

  it('rejects an oversized declared Content-Length BEFORE reading any body (413, cheapest-possible rejection path)', async () => {
    const app = appWithRoute();
    const res = await app.request(
      '/v2/artifacts/documents',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/pdf',
          'content-length': String(DOCUMENT_UPLOAD_MAX_BYTES + 1000),
        },
        // Body itself is small -- proves the declared-Content-Length
        // check alone triggers the 413, independent of actual bytes sent.
        body: pdfBytes(),
      },
      enabledEnv()
    );
    expect(res.status).toBe(413);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('byte_limit_exceeded');
  });

  it('rejects a genuinely oversized streamed body even with no (or an understated) Content-Length header', async () => {
    const oversized = new Uint8Array(DOCUMENT_UPLOAD_MAX_BYTES + 1);
    oversized.set(REAL_PDF_MAGIC, 0);
    const app = appWithRoute();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(oversized);
        controller.close();
      },
    });
    // undici's Request accepts a ReadableStream body with duplex:'half',
    // but the ambient RequestInit type used here doesn't declare `duplex`
    // -- cast only that one extra field rather than suppressing type
    // checking for the whole init object.
    const init = {
      method: 'POST',
      headers: { 'content-type': 'application/pdf', 'cf-connecting-ip': '203.0.113.10' },
      body: stream,
      duplex: 'half',
    } as unknown as RequestInit;
    const res = await app.request('/v2/artifacts/documents', init, enabledEnv());
    expect(res.status).toBe(413);
  });

  it('rejects a declared Content-Type not in the allowlist (415)', async () => {
    const app = appWithRoute();
    const res = await app.request(
      '/v2/artifacts/documents',
      {
        method: 'POST',
        headers: { 'content-type': 'application/zip', 'cf-connecting-ip': '203.0.113.11' },
        body: pdfBytes(),
      },
      enabledEnv()
    );
    expect(res.status).toBe(415);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('unsupported_media_type');
  });

  it('rejects a magic-byte / declared-Content-Type mismatch (415)', async () => {
    const app = appWithRoute();
    const notActuallyPdf = new TextEncoder().encode('this is not a real pdf file');
    const res = await app.request(
      '/v2/artifacts/documents',
      {
        method: 'POST',
        headers: { 'content-type': 'application/pdf', 'cf-connecting-ip': '203.0.113.12' },
        body: notActuallyPdf,
      },
      enabledEnv()
    );
    expect(res.status).toBe(415);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('media_type_mismatch');
  });

  it('rejects an empty body (400)', async () => {
    const app = appWithRoute();
    const res = await app.request(
      '/v2/artifacts/documents',
      {
        method: 'POST',
        headers: { 'content-type': 'application/pdf', 'cf-connecting-ip': '203.0.113.13' },
        body: new Uint8Array(0),
      },
      enabledEnv()
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('empty_body');
  });

  it('accepts a genuine PDF (201) and the response NEVER leaks the R2 bucket name, R2 object key, or D1 internals -- only the opaque capability (§34)', async () => {
    const app = appWithRoute();
    const bytes = pdfBytes('leak-test unique content');
    const res = await app.request(
      '/v2/artifacts/documents',
      {
        method: 'POST',
        headers: { 'content-type': 'application/pdf', 'cf-connecting-ip': '203.0.113.14' },
        body: bytes,
      },
      enabledEnv()
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.upload_id).toBe('string');
    expect(body.media_type).toBe('application/pdf');
    expect(body.size_bytes).toBe(bytes.length);
    expect(typeof body.content_hash).toBe('string');
    expect(typeof body.expires_at).toBe('string');
    expect(body.usage).toEqual({
      input_mode: 'upload_reference',
      example: { upload_reference: { upload_id: body.upload_id } },
    });
    const responseText = JSON.stringify(body);
    expect(responseText).not.toMatch(/siteborne-artifacts/); // bucket name
    expect(responseText).not.toMatch(/artifacts\//); // R2 key prefix
    const knownKeys = new Set([
      'upload_id',
      'media_type',
      'size_bytes',
      'content_hash',
      'expires_at',
      'usage',
    ]);
    for (const key of Object.keys(body)) {
      expect(knownKeys.has(key)).toBe(true);
    }
  });

  it('is content-addressed and idempotent: uploading the same bytes twice returns the same upload_id', async () => {
    const app = appWithRoute();
    const bytes = pdfBytes('idempotency-route-test');
    const first = await app.request(
      '/v2/artifacts/documents',
      {
        method: 'POST',
        headers: { 'content-type': 'application/pdf', 'cf-connecting-ip': '203.0.113.15' },
        body: bytes,
      },
      enabledEnv()
    );
    const second = await app.request(
      '/v2/artifacts/documents',
      {
        method: 'POST',
        headers: { 'content-type': 'application/pdf', 'cf-connecting-ip': '203.0.113.15' },
        body: bytes,
      },
      enabledEnv()
    );
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstBody = (await first.json()) as Record<string, unknown>;
    const secondBody = (await second.json()) as Record<string, unknown>;
    expect(secondBody.upload_id).toBe(firstBody.upload_id);
  });

  it('never imports x402/payment/PCC/service-registry machinery (structural, import-lines only -- §22 non-executing boundary)', () => {
    const path = fileURLToPath(new URL('./document-artifact-upload-route.ts', import.meta.url));
    const source = readFileSync(path, 'utf8');
    const importLines = source
      .split('\n')
      .filter((line) => /^\s*import\b/.test(line))
      .join('\n');
    expect(importLines).not.toMatch(
      /protocol-x402|service-runtime|x402-service|createX402ServiceRoute|ServiceRegistry/
    );
  });

  // -------------------------------------------------------------------
  // SUN-1222C0-R1 -- distributed admission control (storage-abuse fix).
  // -------------------------------------------------------------------

  async function countArtifactRows(): Promise<number> {
    const result = await db.prepare('SELECT COUNT(*) as c FROM job_artifacts').all();
    return (result.results[0] as { c: number }).c;
  }

  async function countR2Objects(): Promise<number> {
    const listed = await bucket.list();
    return listed.objects.length;
  }

  beforeEach(async () => {
    await db.exec('DELETE FROM job_artifacts');
    await db.exec('DELETE FROM document_ingress_admission_windows');
  });

  it('§7 fails closed (503) when CF-Connecting-IP is absent -- never falls back to X-Forwarded-For or an unlimited shared identity', async () => {
    const app = appWithRoute();
    const beforeArtifacts = await countArtifactRows();
    const beforeObjects = await countR2Objects();
    const res = await app.request(
      '/v2/artifacts/documents',
      {
        method: 'POST',
        headers: { 'content-type': 'application/pdf', 'x-forwarded-for': '9.9.9.9' },
        body: pdfBytes('no-source-identity'),
      },
      enabledEnv()
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('temporarily_unavailable');
    // §12: zero storage side effects on a rejected request.
    expect(await countArtifactRows()).toBe(beforeArtifacts);
    expect(await countR2Objects()).toBe(beforeObjects);
  });

  it('§21 admits a genuine upload once a trusted CF-Connecting-IP is present', async () => {
    const app = appWithRoute();
    const res = await app.request(
      '/v2/artifacts/documents',
      {
        method: 'POST',
        headers: { 'content-type': 'application/pdf', 'cf-connecting-ip': '203.0.113.50' },
        body: pdfBytes('admitted-with-real-source'),
      },
      enabledEnv()
    );
    expect(res.status).toBe(201);
  });

  it('§16/§17/§12 exceeding the per-source limit returns 429 with Retry-After and performs ZERO R2/D1 writes for the rejected request', async () => {
    const app = appWithRoute();
    const sourceIp = '198.51.100.77';
    // Exhaust the per-source window with distinct content each time (so
    // content-hash dedup never short-circuits admission accounting).
    for (let i = 0; i < DOCUMENT_INGRESS_PER_SOURCE_LIMIT; i++) {
      const res = await app.request(
        '/v2/artifacts/documents',
        {
          method: 'POST',
          headers: { 'content-type': 'application/pdf', 'cf-connecting-ip': sourceIp },
          body: pdfBytes(`quota-fill-${i}`),
        },
        enabledEnv()
      );
      expect(res.status).toBe(201);
    }

    const beforeArtifacts = await countArtifactRows();
    const beforeObjects = await countR2Objects();

    const rejected = await app.request(
      '/v2/artifacts/documents',
      {
        method: 'POST',
        headers: { 'content-type': 'application/pdf', 'cf-connecting-ip': sourceIp },
        body: pdfBytes('over-the-limit'),
      },
      enabledEnv()
    );
    expect(rejected.status).toBe(429);
    expect(rejected.headers.get('Retry-After')).toBe(
      String(DOCUMENT_INGRESS_ADMISSION_WINDOW_SECONDS)
    );
    const rejectedBody = (await rejected.json()) as Record<string, unknown>;
    expect(rejectedBody.error).toBe('rate_limited');
    // §13: the public error shape never reveals the internal scope
    // (per_source vs. global), the raw source key, or any infra detail.
    expect(JSON.stringify(rejectedBody)).not.toMatch(/198\.51\.100\.77/);
    expect(JSON.stringify(rejectedBody)).not.toMatch(/per_source|global|d1|r2|sqlite/i);

    // §12/§25: the rejected request minted no artifact and wrote nothing
    // to R2 or D1 -- structural proof, not just an assertion on intent.
    expect(await countArtifactRows()).toBe(beforeArtifacts);
    expect(await countR2Objects()).toBe(beforeObjects);

    // A different, independent source is unaffected by the first
    // source's exhausted quota.
    const otherSource = await app.request(
      '/v2/artifacts/documents',
      {
        method: 'POST',
        headers: { 'content-type': 'application/pdf', 'cf-connecting-ip': '198.51.100.200' },
        body: pdfBytes('independent-source'),
      },
      enabledEnv()
    );
    expect(otherSource.status).toBe(201);
  }, 30_000);

  it('two different textual representations of the same real address share one quota (IPv4 leading-zero normalization)', async () => {
    const app = appWithRoute();
    const canonical = '203.0.113.99';
    const leadingZeros = '203.000.113.099';
    for (let i = 0; i < DOCUMENT_INGRESS_PER_SOURCE_LIMIT; i++) {
      const ip = i % 2 === 0 ? canonical : leadingZeros;
      const res = await app.request(
        '/v2/artifacts/documents',
        {
          method: 'POST',
          headers: { 'content-type': 'application/pdf', 'cf-connecting-ip': ip },
          body: pdfBytes(`shared-quota-${i}`),
        },
        enabledEnv()
      );
      expect(res.status).toBe(201);
    }
    const overLimit = await app.request(
      '/v2/artifacts/documents',
      {
        method: 'POST',
        headers: { 'content-type': 'application/pdf', 'cf-connecting-ip': canonical },
        body: pdfBytes('shared-quota-over'),
      },
      enabledEnv()
    );
    expect(overLimit.status).toBe(429);
  }, 30_000);
});
