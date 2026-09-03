/**
 * SUN-1222B-S3-R2 — `POST /v2/artifacts/documents`. The buyer-facing
 * upload endpoint that closes the `document_evidence_json.v2` ingress
 * gap (see `../artifacts/document-upload.ts`'s own doc comment for the
 * full architecture rationale).
 *
 * This handler is deliberately non-executing (§22): it never imports the
 * document worker, the x402/payment modules, PCC, or the service
 * registry. It validates, hashes, and stores — nothing else.
 *
 * Gated the same way every other paid-adjacent route in this file's
 * sibling files is gated: an explicit `'true'` flag AND both bindings
 * (`DB`, `ARTIFACTS`) present, else `c.notFound()` — never a 500, never a
 * fixture fallback.
 *
 * SUN-1222C0-R1 — distributed admission control (per-source + global,
 * see `../artifacts/document-ingress-admission-control.ts`) runs AFTER
 * the cheap declared-Content-Length pre-check (a guaranteed-413 request
 * costs the caller nothing and consumes no distributed state either) but
 * BEFORE any bounded body read, R2 write, or D1 artifact write. A
 * rejected request never reaches `storeDocumentUpload` at all —
 * structurally, not just by convention — so `R2_PUT_CALLS=0` and
 * `D1_ARTIFACT_INSERTS=0` hold for every admission-rejected request.
 */
import type { Context } from 'hono';
import type { Env } from '../config/env';
import { R2ArtifactStoreAdapter } from '../artifacts/store';
import { D1ArtifactsRepository } from '../repositories/d1/artifacts';
import { D1DocumentIngressAdmissionRepository } from '../repositories/d1/document-ingress-admission';
import {
  checkDocumentIngressAdmission,
  extractDocumentIngressSourceKey,
} from '../artifacts/document-ingress-admission-control';
import {
  storeDocumentUpload,
  readBoundedBody,
  DOCUMENT_UPLOAD_MAX_BYTES,
  type DocumentUploadRejectionCode,
} from '../artifacts/document-upload';

export function isDocumentArtifactUploadRouteFlagEnabled(
  env: Pick<Env, 'PAID_ROUTES_ENABLED' | 'DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED'>
): boolean {
  return (
    env.PAID_ROUTES_ENABLED === 'true' && env.DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED === 'true'
  );
}

const REJECTION_STATUS: Record<DocumentUploadRejectionCode, 400 | 413 | 415 | 502> = {
  unsupported_media_type: 415,
  media_type_mismatch: 415,
  empty_body: 400,
  byte_limit_exceeded: 413,
  storage_failure: 502,
};

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `sha256:${hex}`;
}

export async function documentArtifactUploadRoute(
  c: Context<{ Bindings: Env }>
): Promise<Response> {
  if (!c.env || !isDocumentArtifactUploadRouteFlagEnabled(c.env)) {
    return c.notFound();
  }
  if (!c.env.DB || !c.env.ARTIFACTS) {
    return c.notFound();
  }

  // §12: reject an oversized declared Content-Length BEFORE reading any
  // body at all — the cheapest possible rejection path.
  const declaredLength = c.req.header('content-length');
  if (declaredLength !== undefined) {
    const parsed = Number(declaredLength);
    if (Number.isFinite(parsed) && parsed > DOCUMENT_UPLOAD_MAX_BYTES) {
      return c.json(
        {
          error: 'byte_limit_exceeded',
          message: `declared Content-Length ${parsed} exceeds the ${DOCUMENT_UPLOAD_MAX_BYTES}-byte limit`,
        },
        413
      );
    }
  }

  // SUN-1222C0-R1 §7/§12: the only trusted source identity is
  // Cloudflare's own CF-Connecting-IP, never a caller-suppliable
  // forwarding header. Its absence should never happen through
  // Cloudflare's real edge; fail closed exactly like a limiter-
  // unavailable outcome rather than guessing at a shared identity.
  const sourceKey = extractDocumentIngressSourceKey((name) => c.req.header(name));
  if (sourceKey === null) {
    return c.json(
      { error: 'temporarily_unavailable', message: 'unable to verify request source' },
      503
    );
  }

  // SUN-1222C0-R1 §12/§14: admission control runs BEFORE any bounded body
  // read, R2 write, or D1 artifact write — a rejected request performs
  // none of those (structural proof, not just convention: the function
  // returns here). A repository failure fails closed (503), never open.
  const admission = await checkDocumentIngressAdmission(
    { repository: new D1DocumentIngressAdmissionRepository(c.env.DB), nowMs: () => Date.now() },
    sourceKey
  );
  if (!admission.allowed) {
    const unavailable = admission.scope === 'limiter_unavailable';
    const status = unavailable ? 503 : 429;
    // §13: never expose the internal quota scope, the raw source key, or
    // any infrastructure detail — the public shape is identical
    // regardless of which axis (per-source vs. global) rejected it.
    return c.json(
      {
        error: unavailable ? 'temporarily_unavailable' : 'rate_limited',
        message: unavailable
          ? 'document ingress is temporarily unavailable'
          : 'too many document uploads from this source; try again later',
      },
      status,
      admission.retryAfterSeconds !== undefined
        ? { 'Retry-After': String(admission.retryAfterSeconds) }
        : undefined
    );
  }

  // §12/§15: bounded read regardless of whether Content-Length was sent —
  // a chunked/absent-length request cannot buffer past limit+1 bytes here.
  const { bytes, exceeded } = await readBoundedBody(c.req.raw.body, DOCUMENT_UPLOAD_MAX_BYTES);
  if (exceeded) {
    return c.json(
      {
        error: 'byte_limit_exceeded',
        message: `upload exceeds the ${DOCUMENT_UPLOAD_MAX_BYTES}-byte limit`,
      },
      413
    );
  }

  const contentType = c.req.header('content-type');
  const artifactStore = new R2ArtifactStoreAdapter(c.env.ARTIFACTS);
  const artifactsRepository = new D1ArtifactsRepository(c.env.DB);

  const result = await storeDocumentUpload(bytes, contentType, {
    artifactStore,
    artifactsRepository,
    randomId: () => crypto.randomUUID(),
    nowIso: () => new Date().toISOString(),
    hash: sha256Hex,
  });

  if (!result.ok) {
    return c.json({ error: result.code, message: result.message }, REJECTION_STATUS[result.code]);
  }

  // §34: only the opaque capability and its own declared metadata — no
  // bucket name, no R2 key, no D1 internals, no Worker binding names.
  return c.json(
    {
      upload_id: result.upload_id,
      media_type: result.media_type,
      size_bytes: result.size_bytes,
      content_hash: result.content_hash,
      expires_at: result.expires_at,
      usage: {
        input_mode: 'upload_reference',
        example: { upload_reference: { upload_id: result.upload_id } },
      },
    },
    201
  );
}
