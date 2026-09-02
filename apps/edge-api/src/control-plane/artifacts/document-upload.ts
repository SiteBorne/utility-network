/**
 * SUN-1222B-S3-R2 — buyer-facing document artifact ingestion.
 *
 * The commercial defect this closes: `document_evidence_json.v2`'s only
 * implemented input mode (`artifact_reference`) requires an `artifact_id`
 * that already exists in the artifact store, but nothing lets an external
 * buyer create one (SUN-1222C-R1 evidence). `upload_reference` is the
 * frozen schema's second mode (`schemas/services/document-evidence-input.
 * schema.json`) and is the natural public capability per ADR's own
 * "truthful underimplementation" note in `service.ts`'s file header. This
 * module is the storage/validation half; `service.ts` itself is NOT
 * modified (see `document-evidence-json-v2-production-executor.ts`'s own
 * doc comment for why resolution happens at the edge-api layer instead).
 *
 * Buyer input NEVER becomes an R2 key or D1 row id anywhere in this file
 * (§9 BUYER_CONTROLLED_OBJECT_KEYS=NO) — `id` is always
 * `deps.randomId()` (a fresh UUID), and the R2 object key is always
 * derived from the SERVER-COMPUTED SHA-256 (`ArtifactStore.put`'s own
 * content-hash-keyed convention in `../artifacts/store.ts`), never from
 * anything the buyer sent.
 *
 * Deliberately does NOT parse PDF/PNG/JPEG structure beyond the 3-byte/
 * 8-byte magic-number signatures below. Full document-structure validation
 * (page count, corrupt xref, encryption, decompression bounds) is already
 * proven, real, and duplicated nowhere else — it lives in
 * `services/modal-worker/src/modal_worker/document/validation.py`
 * (`detect_media_type`, byte-for-byte identical signatures to
 * `sniffMediaType` below) and runs again, independently, when the paid
 * request actually executes. This module's job ends at: is this container
 * plausibly what it claims to be, and is it within the frozen size bound.
 */
import type { ArtifactStore } from './store';
import type { ArtifactsRepository } from '../repositories/interfaces';
import type { ArtifactRecord } from '../types';

/** Matches `services/modal-worker/.../document/models.py::MAX_DOCUMENT_BYTES`
 * and `schemas/common/authorized-artifact-reference.schema.json`'s
 * `size_bytes.maximum` exactly — the frozen contract bound, not a locally
 * invented number. */
export const DOCUMENT_UPLOAD_MAX_BYTES = 10_485_760;

/** How long an unclaimed upload stays resolvable. Short enough to bound
 * free anonymous storage meaningfully (§33); long enough for a legitimate
 * buyer to upload and then immediately submit the paid request. Physical
 * R2/D1 reclamation after expiry is NOT wired to a scheduled trigger in
 * this checkpoint (no `scheduled` export exists anywhere in `index.ts` —
 * confirmed by trace, not assumed) — `expires_at` is enforced at
 * *read* time only (`resolveUploadReference` in the production executor).
 * Flagged as a follow-up, not silently implied complete. */
export const DOCUMENT_UPLOAD_TTL_SECONDS = 900;

export const DOCUMENT_UPLOAD_ALLOWED_MEDIA_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
] as const;
export type DocumentUploadMediaType = (typeof DOCUMENT_UPLOAD_ALLOWED_MEDIA_TYPES)[number];

export interface DocumentUploadDeps {
  artifactStore: ArtifactStore;
  artifactsRepository: ArtifactsRepository;
  /** Real `crypto.randomUUID` in production; injected so tests can assert
   * "buyer input never reaches this" without depending on real entropy. */
  randomId: () => string;
  nowIso: () => string;
  hash: (bytes: Uint8Array) => Promise<string>;
}

export type DocumentUploadRejectionCode =
  | 'unsupported_media_type'
  | 'media_type_mismatch'
  | 'empty_body'
  | 'byte_limit_exceeded'
  | 'storage_failure';

export interface DocumentUploadRejection {
  ok: false;
  code: DocumentUploadRejectionCode;
  message: string;
  /** Present only for byte_limit_exceeded; never echoes bytes back. */
  declaredOrObservedBytes?: number;
}

export interface DocumentUploadAccepted {
  ok: true;
  upload_id: string;
  media_type: DocumentUploadMediaType;
  size_bytes: number;
  content_hash: string;
  expires_at: string;
}

export type DocumentUploadResult = DocumentUploadAccepted | DocumentUploadRejection;

const MAGIC_PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"
const MAGIC_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAGIC_JPEG = new Uint8Array([0xff, 0xd8, 0xff]);

function startsWith(bytes: Uint8Array, sig: Uint8Array): boolean {
  if (bytes.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (bytes[i] !== sig[i]) return false;
  }
  return true;
}

/** Byte-for-byte the same three signatures as the Modal worker's own
 * `detect_media_type` (`document/validation.py`) — deliberately kept in
 * sync rather than reinvented, so "declared vs. sniffed" never disagrees
 * between the two independent layers for the same real file. */
export function sniffMediaType(bytes: Uint8Array): DocumentUploadMediaType | null {
  if (startsWith(bytes, MAGIC_PDF)) return 'application/pdf';
  if (startsWith(bytes, MAGIC_PNG)) return 'image/png';
  if (startsWith(bytes, MAGIC_JPEG)) return 'image/jpeg';
  return null;
}

export function isAllowedMediaType(value: string): value is DocumentUploadMediaType {
  return (DOCUMENT_UPLOAD_ALLOWED_MEDIA_TYPES as readonly string[]).includes(value);
}

/**
 * Validates and stores one already-fully-read, already-bounded byte
 * buffer. Callers (the route handler) are responsible for never buffering
 * past `DOCUMENT_UPLOAD_MAX_BYTES + 1` bytes in the first place (§12 —
 * enforced before this function is even called, via the route's bounded
 * stream reader); this function still re-checks the length defensively
 * (defense in depth, and it is what makes this function's own unit tests
 * meaningful without needing a real streaming request).
 */
export async function storeDocumentUpload(
  bytes: Uint8Array,
  declaredContentType: string | undefined,
  deps: DocumentUploadDeps
): Promise<DocumentUploadResult> {
  const declared = (declaredContentType ?? '').trim().toLowerCase();
  if (!isAllowedMediaType(declared)) {
    return {
      ok: false,
      code: 'unsupported_media_type',
      message:
        `unsupported or missing Content-Type "${declaredContentType ?? ''}" — must be exactly ` +
        `one of ${DOCUMENT_UPLOAD_ALLOWED_MEDIA_TYPES.join(', ')}`,
    };
  }

  if (bytes.length === 0) {
    return { ok: false, code: 'empty_body', message: 'upload body was empty (0 bytes)' };
  }
  if (bytes.length > DOCUMENT_UPLOAD_MAX_BYTES) {
    return {
      ok: false,
      code: 'byte_limit_exceeded',
      message: `upload of ${bytes.length} bytes exceeds the ${DOCUMENT_UPLOAD_MAX_BYTES}-byte limit`,
      declaredOrObservedBytes: bytes.length,
    };
  }

  const sniffed = sniffMediaType(bytes);
  if (sniffed === null || sniffed !== declared) {
    return {
      ok: false,
      code: 'media_type_mismatch',
      message:
        `declared Content-Type "${declared}" does not match the file's actual signature ` +
        `(detected: ${sniffed ?? 'unrecognized'})`,
    };
  }

  const contentHash = await deps.hash(bytes);

  // Content-addressed dedup: if this exact hash was uploaded before (by
  // this buyer or any other — content, not identity, is what's being
  // deduplicated), reuse that upload_id rather than minting a redundant
  // D1 row for byte-identical content. R2's own `put()` already no-ops
  // on an existing hash-keyed object; this mirrors that at the D1 layer.
  const existing = await deps.artifactsRepository.getByContentHash(contentHash);
  if (existing.ok && existing.value) {
    return {
      ok: true,
      upload_id: existing.value.id,
      media_type: existing.value.media_type as DocumentUploadMediaType,
      size_bytes: existing.value.byte_length,
      content_hash: existing.value.content_hash,
      expires_at: existing.value.expires_at ?? deps.nowIso(),
    };
  }

  const id = deps.randomId();
  const nowIso = deps.nowIso();
  const expiresAt = new Date(
    new Date(nowIso).getTime() + DOCUMENT_UPLOAD_TTL_SECONDS * 1000
  ).toISOString();

  const record: ArtifactRecord = {
    id,
    content_hash: contentHash,
    media_type: declared,
    byte_length: bytes.length,
    created_at: nowIso,
    expires_at: expiresAt,
    authorization_class: 'buyer_authorized',
    retention_class: 'ephemeral',
    artifact_type: 'input',
  };

  try {
    await deps.artifactStore.put(record, bytes);
  } catch (e) {
    return {
      ok: false,
      code: 'storage_failure',
      message: `R2 write failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const created = await deps.artifactsRepository.create(record);
  if (!created.ok) {
    // A concurrent identical-content upload could race us between the
    // getByContentHash check above and this create — handle that
    // specific, expected race by re-reading rather than surfacing a
    // storage failure for a perfectly successful upload.
    if (created.error.code === 'DUPLICATE_ARTIFACT') {
      const raced = await deps.artifactsRepository.getByContentHash(contentHash);
      if (raced.ok && raced.value) {
        return {
          ok: true,
          upload_id: raced.value.id,
          media_type: raced.value.media_type as DocumentUploadMediaType,
          size_bytes: raced.value.byte_length,
          content_hash: raced.value.content_hash,
          expires_at: raced.value.expires_at ?? nowIso,
        };
      }
    }
    return {
      ok: false,
      code: 'storage_failure',
      message: `D1 artifact metadata write failed: ${created.error.message}`,
    };
  }

  return {
    ok: true,
    upload_id: id,
    media_type: declared,
    size_bytes: bytes.length,
    content_hash: contentHash,
    expires_at: expiresAt,
  };
}

/**
 * Bounded stream reader — reads at most `limit + 1` bytes from `body`,
 * returning early (without draining the rest of the stream) the instant
 * the limit is exceeded. This is what makes §12 ("enforce max bytes
 * BEFORE full uncontrolled buffering") true for a caller with no
 * Content-Length header (chunked/streaming), not just the fast-path
 * Content-Length pre-check the route handler also does.
 */
export async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  limit: number
): Promise<{ bytes: Uint8Array; exceeded: boolean }> {
  if (!body) return { bytes: new Uint8Array(0), exceeded: false };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let exceeded = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.length;
        chunks.push(value);
        if (total > limit) {
          exceeded = true;
          break;
        }
      }
    }
  } finally {
    // Stop the producer promptly on early exit rather than letting an
    // oversized upload keep streaming into nothing.
    await reader.cancel().catch(() => undefined);
  }
  const out = new Uint8Array(Math.min(total, limit + 1));
  let offset = 0;
  for (const chunk of chunks) {
    const room = out.length - offset;
    if (room <= 0) break;
    out.set(chunk.subarray(0, Math.min(room, chunk.length)), offset);
    offset += Math.min(room, chunk.length);
  }
  return { bytes: out.subarray(0, offset), exceeded };
}
