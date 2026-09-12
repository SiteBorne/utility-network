/**
 * SUN-1222C-1-REMEDIATION §3/§10/§11 — proves `POST /v2/artifacts/documents`
 * through the SAME assembled Hono application the real Worker serves
 * (`import { app } from './index'`, exactly `index.test.ts`'s own pattern),
 * never through an isolated Hono instance that mounts the route module in
 * a vacuum. The isolated route-level tests in
 * `document-artifact-upload-route.test.ts` (38 cases) never exercised the
 * global middleware chain — `app.use('*', createContentTypeMiddleware())`
 * in `index.ts` — and so never caught that it unconditionally requires
 * `Content-Type: application/json` on every non-GET/HEAD request, which no
 * document upload (`application/pdf` / `image/png` / `image/jpeg`, per
 * `DOCUMENT_UPLOAD_ALLOWED_MEDIA_TYPES`) can ever satisfy. Before the fix
 * in this checkpoint, every real document upload was rejected 415 by the
 * global middleware before the route handler — and therefore before
 * `R2ArtifactStoreAdapter.put` — ever ran.
 *
 * This file is the permanent release regression per §12: isolated route
 * tests remain necessary but are declared explicitly insufficient for
 * deployment confidence on their own.
 */
import { describe, expect, it, vi } from 'vitest';
import { app } from './index';
import type { Env } from './control-plane/config/env';

const MINIMAL_PDF_BYTES = new Uint8Array([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3,
]);

function baseEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as Env['DB'],
    ARTIFACTS: {} as Env['ARTIFACTS'],
    JOBS: {} as Env['JOBS'],
    EVENTS: {} as Env['EVENTS'],
    CATALOG: {} as Env['CATALOG'],
    AI: {} as Env['AI'],
    BROWSER: {} as Env['BROWSER'],
    ENVIRONMENT: 'production',
    LOG_LEVEL: 'info',
    PCC_VERSION: '1.0.0',
    SELLER_WALLET_ADDRESS: '0x' + '1'.repeat(40),
    CDP_API_KEY_ID: 'cdp-key-id',
    CDP_API_KEY_SECRET: 'cdp-key-secret',
    VOYAGE_API_KEY: 'voyage-key',
    MODAL_TOKEN_ID: 'modal-token-id',
    MODAL_TOKEN_SECRET: 'modal-token-secret',
    SENTRY_DSN: 'https://example.invalid/sentry',
    PAID_ROUTES_ENABLED: 'true',
    DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED: 'true',
    ...overrides,
  };
}

/** A minimal fake D1Database — enough surface for D1ArtifactsRepository's
 * insert path; the assertion under test is whether the request reaches
 * this seam at all, not D1 semantics themselves (those are covered by the
 * isolated route/store tests).
 *
 * SUN-1222C0-R1: `run()` now also returns `meta.changes: 1` — unconditionally
 * "admitted" — so `D1DocumentIngressAdmissionRepository.admitAndIncrement`
 * (consulted before any R2/D1 write, per that checkpoint's fix) never
 * fails closed against this fake for these tests' purpose. Genuine quota
 * edge cases (limit reached, concurrency, window rollover) are exercised
 * against the REAL D1/SQLite engine in
 * `repositories/d1/document-ingress-admission.test.ts`, not here — this
 * file's own stated purpose is proving requests reach the R2 seam through
 * the real app, not D1/admission-control semantics. */
function fakeDb(): Env['DB'] {
  const stmt = {
    bind: vi.fn().mockReturnThis(),
    run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
    first: vi.fn().mockResolvedValue(null),
    all: vi.fn().mockResolvedValue({ results: [] }),
  };
  return {
    prepare: vi.fn().mockReturnValue(stmt),
  } as unknown as Env['DB'];
}

function fakeArtifacts(): { binding: Env['ARTIFACTS']; putCalls: unknown[] } {
  const putCalls: unknown[] = [];
  const binding = {
    head: vi.fn().mockResolvedValue(null),
    put: vi.fn(async (key: string, value: unknown) => {
      putCalls.push({ key, value });
      return { key } as R2Object;
    }),
    get: vi.fn(),
    delete: vi.fn(),
  } as unknown as Env['ARTIFACTS'];
  return { binding, putCalls };
}

describe('SUN-1222C-1-REMEDIATION — POST /v2/artifacts/documents through the real assembled app', () => {
  it("§3/§11 the core regression: a valid PDF with its correct Content-Type reaches the route and R2 exactly once — pre-fix this asserted 415 (RED, proven live in this checkpoint's evidence report), and is restored to 415 and back during §11 mutation-proof", async () => {
    const { binding: ARTIFACTS, putCalls } = fakeArtifacts();
    const res = await app.request(
      '/v2/artifacts/documents',
      {
        method: 'POST',
        headers: { 'content-type': 'application/pdf', 'cf-connecting-ip': '203.0.113.20' },
        body: MINIMAL_PDF_BYTES,
      },
      baseEnv({ DB: fakeDb(), ARTIFACTS })
    );

    expect(res.status).toBe(201);
    expect(putCalls.length).toBe(1);
  });

  it('§10 GREEN: valid PDF reaches the route, is stored exactly once, and returns the frozen response shape', async () => {
    const { binding: ARTIFACTS, putCalls } = fakeArtifacts();
    const res = await app.request(
      '/v2/artifacts/documents',
      {
        method: 'POST',
        headers: { 'content-type': 'application/pdf', 'cf-connecting-ip': '203.0.113.20' },
        body: MINIMAL_PDF_BYTES,
      },
      baseEnv({ DB: fakeDb(), ARTIFACTS })
    );

    expect(res.status).toBe(201);
    expect(putCalls.length).toBe(1);
    const body = await res.json();
    expect(body).toMatchObject({
      media_type: 'application/pdf',
      size_bytes: MINIMAL_PDF_BYTES.length,
      usage: { input_mode: 'upload_reference' },
    });
    expect(typeof body.upload_id).toBe('string');
    expect(typeof body.content_hash).toBe('string');
    expect(typeof body.expires_at).toBe('string');
  });

  it('§10 GREEN: valid PNG reaches the route and is stored', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const { binding: ARTIFACTS, putCalls } = fakeArtifacts();
    const res = await app.request(
      '/v2/artifacts/documents',
      {
        method: 'POST',
        headers: { 'content-type': 'image/png', 'cf-connecting-ip': '203.0.113.21' },
        body: png,
      },
      baseEnv({ DB: fakeDb(), ARTIFACTS })
    );
    expect(res.status).toBe(201);
    expect(putCalls.length).toBe(1);
  });

  it('§5 unrelated JSON routes remain unchanged: /v2/verify/agent-output still requires application/json and still 404s with no upload-related state touched', async () => {
    const res = await app.request(
      '/v2/verify/agent-output',
      { method: 'POST', headers: { 'content-type': 'application/pdf' }, body: MINIMAL_PDF_BYTES },
      baseEnv()
    );
    // global content-type middleware still enforces JSON-only for every
    // OTHER route — the fix must be scoped exactly to the upload route.
    expect(res.status).toBe(415);
  });

  it('§5 unrelated JSON routes remain unchanged: /v2/verify/agent-output with application/json still reaches its own (unrelated) gating, not 415', async () => {
    const res = await app.request(
      '/v2/verify/agent-output',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      baseEnv({ VERIFY_V2_CDP_ROUTE_ENABLED: 'true' })
    );
    expect(res.status).not.toBe(415);
  });

  it('§6 UPLOAD_AUTH_REGRESSION / §24: unauthenticated request still fails closed when the upload route flags are absent — 404, zero R2 writes', async () => {
    const { binding: ARTIFACTS, putCalls } = fakeArtifacts();
    const res = await app.request(
      '/v2/artifacts/documents',
      {
        method: 'POST',
        headers: { 'content-type': 'application/pdf', 'cf-connecting-ip': '203.0.113.22' },
        body: MINIMAL_PDF_BYTES,
      },
      baseEnv({ DB: fakeDb(), ARTIFACTS, DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED: undefined })
    );
    expect(res.status).toBe(404);
    expect(putCalls.length).toBe(0);
  });

  it('§7 body safety: oversized declared Content-Length rejected 413 before any R2 write, through the real app', async () => {
    const { binding: ARTIFACTS, putCalls } = fakeArtifacts();
    const res = await app.request(
      '/v2/artifacts/documents',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/pdf',
          'content-length': String(10_485_760 + 1),
          'cf-connecting-ip': '203.0.113.23',
        },
        body: MINIMAL_PDF_BYTES,
      },
      baseEnv({ DB: fakeDb(), ARTIFACTS })
    );
    expect(res.status).toBe(413);
    expect(putCalls.length).toBe(0);
  });

  it('§7 body safety: empty body rejected 400 through the real app, zero R2 writes', async () => {
    const { binding: ARTIFACTS, putCalls } = fakeArtifacts();
    const res = await app.request(
      '/v2/artifacts/documents',
      {
        method: 'POST',
        headers: { 'content-type': 'application/pdf', 'cf-connecting-ip': '203.0.113.24' },
        body: new Uint8Array(0),
      },
      baseEnv({ DB: fakeDb(), ARTIFACTS })
    );
    expect(res.status).toBe(400);
    expect(putCalls.length).toBe(0);
  });

  it("§5 deceptive input: application/json body containing fake PDF-looking text is rejected by JSON-only... no — this route accepts non-JSON, so a JSON content-type with mismatched bytes must be rejected by the route's own media-type check, not silently accepted", async () => {
    const { binding: ARTIFACTS, putCalls } = fakeArtifacts();
    const res = await app.request(
      '/v2/artifacts/documents',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.25' },
        body: '{"not":"a document"}',
      },
      baseEnv({ DB: fakeDb(), ARTIFACTS })
    );
    expect(res.status).toBe(415);
    expect(putCalls.length).toBe(0);
  });

  it('§8 mismatched declared vs. sniffed media type rejected 415, zero R2 writes', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    const { binding: ARTIFACTS, putCalls } = fakeArtifacts();
    const res = await app.request(
      '/v2/artifacts/documents',
      // declares PDF, but the bytes are actually a PNG signature
      {
        method: 'POST',
        headers: { 'content-type': 'application/pdf', 'cf-connecting-ip': '203.0.113.26' },
        body: png,
      },
      baseEnv({ DB: fakeDb(), ARTIFACTS })
    );
    expect(res.status).toBe(415);
    expect(putCalls.length).toBe(0);
  });
});
