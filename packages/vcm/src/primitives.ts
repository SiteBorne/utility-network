/**
 * Frozen closed primitive types (Master Reference Part II §VI). Runtime
 * validation rejects malformed values rather than trusting caller input --
 * these are the only constructors that may produce the branded types, and
 * every one fails closed (throws `VcmPrimitiveError`) on a malformed value.
 */

export class VcmPrimitiveError extends Error {
  constructor(
    public readonly primitive: string,
    public readonly value: unknown,
    reason: string
  ) {
    super(`invalid ${primitive}: ${reason} (received ${JSON.stringify(value)})`);
    this.name = 'VcmPrimitiveError';
  }
}

// ---------------------------------------------------------------------------
// Sha256Digest -- matches @siteborne/pcc-schema's HashZ regex exactly, so a
// digest produced anywhere in the repo is valid everywhere in the repo.
// ---------------------------------------------------------------------------
export type Sha256Digest = string & { readonly __brand: 'Sha256Digest' };
const SHA256_DIGEST_RE = /^sha256:[a-f0-9]{64}$/;

export function parseSha256Digest(value: string): Sha256Digest {
  if (!SHA256_DIGEST_RE.test(value)) {
    throw new VcmPrimitiveError('Sha256Digest', value, 'must match sha256:<64 lowercase hex>');
  }
  return value as Sha256Digest;
}

export function isSha256Digest(value: string): value is Sha256Digest {
  return SHA256_DIGEST_RE.test(value);
}

// ---------------------------------------------------------------------------
// IsoTimestamp -- a real, parseable ISO-8601 instant.
// ---------------------------------------------------------------------------
export type IsoTimestamp = string & { readonly __brand: 'IsoTimestamp' };
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export function parseIsoTimestamp(value: string): IsoTimestamp {
  if (!ISO_TIMESTAMP_RE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new VcmPrimitiveError('IsoTimestamp', value, 'must be a valid ISO-8601 instant');
  }
  return value as IsoTimestamp;
}

// ---------------------------------------------------------------------------
// GitSha -- a full 40-hex-character git commit SHA-1.
// ---------------------------------------------------------------------------
export type GitSha = string & { readonly __brand: 'GitSha' };
const GIT_SHA_RE = /^[0-9a-f]{40}$/;

export function parseGitSha(value: string): GitSha {
  if (!GIT_SHA_RE.test(value)) {
    throw new VcmPrimitiveError('GitSha', value, 'must be a 40-character lowercase hex SHA-1');
  }
  return value as GitSha;
}

// ---------------------------------------------------------------------------
// UriString -- must be parseable by the platform URL parser (https:, mailto:
// and other schemes SITEBORNE metadata actually uses).
// ---------------------------------------------------------------------------
export type UriString = string & { readonly __brand: 'UriString' };

export function parseUriString(value: string): UriString {
  try {
    new URL(value);
  } catch {
    throw new VcmPrimitiveError('UriString', value, 'must be a parseable absolute URI');
  }
  return value as UriString;
}

// ---------------------------------------------------------------------------
// EvmAddress -- a checksummed-format-agnostic 20-byte hex address.
// ---------------------------------------------------------------------------
export type EvmAddress = string & { readonly __brand: 'EvmAddress' };
const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export function parseEvmAddress(value: string): EvmAddress {
  if (!EVM_ADDRESS_RE.test(value)) {
    throw new VcmPrimitiveError('EvmAddress', value, 'must be a 0x-prefixed 40-hex-digit address');
  }
  return value as EvmAddress;
}

// ---------------------------------------------------------------------------
// SemVer -- a strict major.minor.patch triple (no prerelease/build metadata;
// no version field observed anywhere in the frozen baseline sources uses
// either).
// ---------------------------------------------------------------------------
export interface SemVer {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly raw: string;
}
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

export function parseSemVer(value: string): SemVer {
  const match = SEMVER_RE.exec(value);
  if (!match) {
    throw new VcmPrimitiveError('SemVer', value, 'must match major.minor.patch');
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    raw: value,
  };
}

export function semVerEquals(a: SemVer, b: SemVer): boolean {
  return a.major === b.major && a.minor === b.minor && a.patch === b.patch;
}

export function compareSemVer(a: SemVer, b: SemVer): -1 | 0 | 1 {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return 0;
}

// ---------------------------------------------------------------------------
// UsdAmount -- a decimal USD string, never a float. Comparison must route
// through @siteborne/pricing's BigInt-based usdToMicro (imported at the call
// site), never Number()/parseFloat().
// ---------------------------------------------------------------------------
export type UsdAmount = string & { readonly __brand: 'UsdAmount' };
const USD_AMOUNT_RE = /^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/;

export function parseUsdAmount(value: string): UsdAmount {
  if (!USD_AMOUNT_RE.test(value)) {
    throw new VcmPrimitiveError(
      'UsdAmount',
      value,
      'must be a non-negative decimal string with at most 6 fractional digits'
    );
  }
  return value as UsdAmount;
}
