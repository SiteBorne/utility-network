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
 */
import type { Context } from 'hono';
import type { Env } from '../config/env';
import { R2ArtifactStoreAdapter } from '../artifacts/store';
import { D1ArtifactsRepository } from '../repositories/d1/artifacts';
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
