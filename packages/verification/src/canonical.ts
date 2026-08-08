/**
 * Canonicalization and hashing. Reuses the frozen JCS canonicalization and
 * SHA-256 hashing already implemented and tested in @siteborne/pcc-schema
 * (docs/decisions/0007-pcc-canonicalization-and-signing.md) rather than
 * reimplementing it — one canonicalization algorithm for the whole repo.
 */
import {
  canonicalize as pccCanonicalize,
  hashCanonical as pccHashCanonical,
  loadCanonicalJson,
} from '@siteborne/pcc-schema';

// pcc-schema's synchronous `canonicalize()` requires `loadCanonicalJson()`
// to have completed first (it dynamically imports the `canonical-json`
// package). A top-level await here guarantees it is loaded before any
// module that imports this one can call canonicalize() synchronously,
// without every call site having to know about pcc-schema's init step.
await loadCanonicalJson();

export function canonicalize(data: unknown): string {
  return pccCanonicalize(data);
}

export async function hashCanonical(data: unknown): Promise<string> {
  return pccHashCanonical(data);
}

export async function sha256Hex(text: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(text).digest('hex');
}

export async function contentHash(text: string): Promise<string> {
  return `sha256:${await sha256Hex(text)}`;
}
