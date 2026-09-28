/**
 * Canonicalization and hashing for evidence identity. Reuses the frozen JCS
 * canonicalization already used by @siteborne/pcc-schema and @siteborne/vcm
 * (docs/decisions/0007-pcc-canonicalization-and-signing.md) -- one
 * canonicalization algorithm for the whole repo.
 */
import {
  canonicalize as pccCanonicalize,
  hashCanonical as pccHashCanonical,
  loadCanonicalJson,
} from '@siteborne/pcc-schema';

await loadCanonicalJson();

export function canonicalize(data: unknown): string {
  return pccCanonicalize(data);
}

/** Returns `sha256:<64 lowercase hex>`. */
export async function hashCanonical(data: unknown): Promise<string> {
  return pccHashCanonical(data);
}

export const SHA256_HEX_RE = /^[a-f0-9]{64}$/;
export const GIT_SHA_RE = /^[a-f0-9]{40}$/;
