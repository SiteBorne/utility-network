/**
 * The closed scheme/network support matrix. Per the current official x402
 * documentation (docs.x402.org, retrieved for
 * fixtures/x402-spec-baseline.json): `exact` "works on all supported
 * networks"; `upto` is "currently available on EVM networks only
 * (Permit2)". This module encodes that restriction as data, not as a
 * comment someone has to remember — `isSchemeSupportedOnNetwork` is the
 * single place every other module in this package must call before
 * accepting a scheme+network combination.
 */
import type { Network } from '@x402/core/types';

export type SupportedScheme = 'exact' | 'upto';

/** CAIP-2 namespaces this package recognizes at all (checkpoint 1: EVM and
 * Solana, matching the two ecosystems the upstream docs discuss). Anything
 * outside this set is `unsupported_network`, not silently accepted. */
const RECOGNIZED_CAIP2_NAMESPACES = new Set(['eip155', 'solana']);

/** `upto` is EVM-only in the current official implementation (Permit2) —
 * every other namespace, even if recognized for `exact`, is unsupported
 * for `upto`. Revisit this set only when the upstream spec baseline
 * (fixtures/x402-spec-baseline.json) is updated to reflect a real support
 * change, not speculatively. */
const UPTO_SUPPORTED_CAIP2_NAMESPACES = new Set(['eip155']);

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
  if (!RECOGNIZED_CAIP2_NAMESPACES.has(parsed.namespace)) {
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
