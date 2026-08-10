/**
 * **SITEBORNE's own launch-scoped scheme/network support matrix** — a
 * deliberate subset SITEBORNE has chosen to support, not a description of
 * upstream x402's full capability surface. Current upstream x402 itself
 * implements `exact` on substantially more network families than the two
 * namespaces recognized here (docs.x402.org/schemes/exact), and `upto` is
 * documented upstream as EVM-only (docs.x402.org/faq;
 * getting-started/quickstart-for-sellers) — SITEBORNE's `upto` restriction
 * matches that upstream constraint, but the `exact` restriction to
 * `eip155`/`solana` below is entirely a SITEBORNE choice, not an upstream
 * limitation. See `SITEBORNE_SUPPORTED_X402_SCHEMES` and
 * fixtures/x402-spec-baseline.json. `isSchemeSupportedOnNetwork` is the
 * single place every other module in this package must call before
 * accepting a scheme+network combination — an unsupported combination
 * always fails closed.
 */
import type { Network } from '@x402/core/types';

export type SupportedScheme = 'exact' | 'upto';

/** CAIP-2 namespaces SITEBORNE has chosen to launch with (checkpoint 1:
 * EVM and Solana). This is **not** the set of namespaces upstream x402
 * itself supports for `exact` — it is SITEBORNE's own initial subset.
 * Anything outside this set is `unsupported_network` here, not silently
 * accepted; expanding it is a deliberate SITEBORNE product decision for a
 * later checkpoint, not a spec-compliance fix. */
const SITEBORNE_LAUNCH_CAIP2_NAMESPACES = new Set(['eip155', 'solana']);

/** `upto` is EVM-only in the current official x402 implementation (Permit2)
 * — this restriction mirrors an actual upstream constraint, not a
 * SITEBORNE-specific narrowing. Every other namespace, even if recognized
 * by SITEBORNE for `exact`, is unsupported for `upto`. Revisit this set
 * only when the upstream spec baseline (fixtures/x402-spec-baseline.json)
 * is updated to reflect a real upstream support change, not speculatively. */
const UPTO_SUPPORTED_CAIP2_NAMESPACES = new Set(['eip155']);

/** SITEBORNE's declared, launch-scoped scheme/network support — the
 * authoritative "what SITEBORNE currently accepts" table this module
 * derives its checks from, exposed for documentation/Bazaar-metadata use
 * (a later checkpoint) so that table has one canonical source rather than
 * being re-derived from the private Sets above. */
export const SITEBORNE_SUPPORTED_X402_SCHEMES = {
  exact: Array.from(SITEBORNE_LAUNCH_CAIP2_NAMESPACES),
  upto: Array.from(UPTO_SUPPORTED_CAIP2_NAMESPACES),
} as const;

export interface NetworkParseResult {
  valid: boolean;
  namespace?: string;
  reference?: string;
}

/** CAIP-2 network identifiers are `${namespace}:${reference}` with a
 * minimum total length of 3 (matching @x402/core's NetworkSchemaV2). Pure
 * syntactic validation — does not claim the network is supported, only
 * that it is well-formed. */
export function parseCaip2Network(network: string): NetworkParseResult {
  if (typeof network !== 'string' || network.length < 3) return { valid: false };
  const colonIndex = network.indexOf(':');
  if (colonIndex <= 0 || colonIndex === network.length - 1) return { valid: false };
  const namespace = network.slice(0, colonIndex);
  const reference = network.slice(colonIndex + 1);
  if (!namespace || !reference) return { valid: false };
  return { valid: true, namespace, reference };
}

export type SchemeNetworkSupport =
  | { supported: true }
  | {
      supported: false;
      reason:
        | 'malformed_network'
        | 'unrecognized_namespace'
        | 'upto_not_evm'
        | 'unrecognized_scheme';
    };

/** The one function every builder/validator in this package calls before
 * accepting a scheme+network combination. Fails closed on every axis: an
 * unrecognized scheme (not `exact`/`upto`), a malformed network, a
 * namespace this package has never heard of, and `upto` on a non-EVM
 * namespace are each rejected explicitly — none silently passed through. */
export function isSchemeSupportedOnNetwork(
  scheme: string,
  network: Network | string
): SchemeNetworkSupport {
  if (!isSupportedScheme(scheme)) {
    return { supported: false, reason: 'unrecognized_scheme' };
  }
  const parsed = parseCaip2Network(network);
  if (!parsed.valid || !parsed.namespace) return { supported: false, reason: 'malformed_network' };
  if (!SITEBORNE_LAUNCH_CAIP2_NAMESPACES.has(parsed.namespace)) {
    return { supported: false, reason: 'unrecognized_namespace' };
  }
  if (scheme === 'upto' && !UPTO_SUPPORTED_CAIP2_NAMESPACES.has(parsed.namespace)) {
    return { supported: false, reason: 'upto_not_evm' };
  }
  return { supported: true };
}

export function isSupportedScheme(scheme: string): scheme is SupportedScheme {
  return scheme === 'exact' || scheme === 'upto';
}

/** Shared by both requirements/exact.ts and requirements/upto.ts's
 * builders — a single error class rather than two near-identical ones, so
 * catching "a requirement builder rejected this scheme+network
 * combination" is one `instanceof` check regardless of which scheme was
 * being built. */
export class UnsupportedSchemeNetworkCombinationError extends Error {
  constructor(
    scheme: string,
    network: string,
    public readonly reason: string
  ) {
    super(`scheme "${scheme}" is not supported on network "${network}" (${reason})`);
    this.name = 'UnsupportedSchemeNetworkCombinationError';
  }
}
