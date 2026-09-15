/**
 * Canonicalization and hashing. Reuses the frozen JCS canonicalization and
 * SHA-256 hashing already implemented and tested in @siteborne/pcc-schema
 * (docs/decisions/0007-pcc-canonicalization-and-signing.md) rather than
 * reimplementing it -- one canonicalization algorithm for the whole repo.
 * This mirrors packages/verification/src/canonical.ts's own reuse pattern
 * exactly (Master Reference Part II §XIII requires reusing the existing
 * path, not introducing a second one).
 */
import {
  canonicalize as pccCanonicalize,
  hashCanonical as pccHashCanonical,
  loadCanonicalJson,
} from '@siteborne/pcc-schema';

// pcc-schema's synchronous `canonicalize()` requires `loadCanonicalJson()`
// to have completed first (it dynamically imports the `canonical-json`
// package). A top-level await here guarantees it is loaded before any
// module that imports this one can call canonicalize() synchronously.
await loadCanonicalJson();

export function canonicalize(data: unknown): string {
  return pccCanonicalize(data);
}

export async function hashCanonical(data: unknown): Promise<string> {
  return pccHashCanonical(data);
}
