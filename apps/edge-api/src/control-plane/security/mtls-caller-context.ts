import type {
  IncomingRequestCfPropertiesTLSClientAuth,
  IncomingRequestCfPropertiesTLSClientAuthPlaceholder,
} from '@cloudflare/workers-types';

/**
 * SUN-1222C-AGENT-TRUST-100-IMPLEMENTATION-A: canonical, trusted mTLS caller
 * state, derived *only* from Cloudflare's own edge-verified
 * `request.cf.tlsClientAuth` -- never from any client-supplied header. A
 * request cannot forge this object: it is populated by the Cloudflare
 * network from the actual TLS handshake before the Worker ever runs, so
 * (unlike a header such as `X-Client-Cert` or `Client-Cert`) nothing in the
 * HTTP request body or header set can influence it. This module accepts
 * only that object -- no `Request`/`Headers` parameter exists on any
 * exported function -- so a caller cannot even accidentally wire a
 * client-controlled header into it (see `mtls-caller-context.test.ts`
 * "spoofed header immunity").
 *
 * `revoked` is checked independently of, and takes priority over,
 * `certVerified` -- a chain-trusted certificate that has since been revoked
 * must never be treated as valid regardless of `certVerified`'s value.
 *
 * See docs/reports/SUN-1222C-agent-trust-100-design.md §5-7.
 */
export type MtlsCallerState = 'not_presented' | 'valid' | 'invalid' | 'revoked' | 'unknown';

/** A stable, non-secret identity for a caller with a `valid` mTLS state.
 * The SHA-256 fingerprint is the certificate's own cryptographic digest --
 * collision-resistant and safe to use as an authorization/audit key. The
 * issuer DN is carried alongside it so a future policy can additionally
 * scope trust to a specific issuing CA. Neither field is secret; the raw
 * certificate/key material is never captured here or anywhere downstream. */
export interface MtlsCallerIdentity {
  readonly fingerprintSha256: string;
  readonly issuerDN: string;
}

export interface MtlsCallerContext {
  readonly state: MtlsCallerState;
  /** Present only when `state === 'valid'`. */
  readonly identity: MtlsCallerIdentity | null;
}

type TlsClientAuth =
  | IncomingRequestCfPropertiesTLSClientAuth
  | IncomingRequestCfPropertiesTLSClientAuthPlaceholder
  | undefined
  | null;

const NOT_PRESENTED: MtlsCallerContext = { state: 'not_presented', identity: null };

/**
 * Derives the canonical mTLS caller context from Cloudflare's own
 * `request.cf.tlsClientAuth`. Pass `request.cf?.tlsClientAuth` directly --
 * nothing else.
 */
export function deriveMtlsCallerContext(tlsClientAuth: TlsClientAuth): MtlsCallerContext {
  if (!tlsClientAuth || tlsClientAuth.certPresented !== '1') {
    return NOT_PRESENTED;
  }
  // TypeScript narrows `tlsClientAuth` to IncomingRequestCfPropertiesTLSClientAuth here.
  if (tlsClientAuth.certRevoked === '1') {
    return { state: 'revoked', identity: null };
  }
  if (tlsClientAuth.certVerified === 'SUCCESS') {
    return {
      state: 'valid',
      identity: {
        fingerprintSha256: tlsClientAuth.certFingerprintSHA256,
        issuerDN: tlsClientAuth.certIssuerDN,
      },
    };
  }
  if (tlsClientAuth.certVerified.startsWith('FAILED')) {
    return { state: 'invalid', identity: null };
  }
  // Cloudflare's CertVerificationStatus is a closed enum in the pinned
  // @cloudflare/workers-types, so this branch is unreachable for real
  // traffic; it exists as a fail-closed default rather than an assumption
  // that every future Cloudflare value has been enumerated above.
  return { state: 'unknown', identity: null };
}

/**
 * A policy primitive for a future, separately authorized route or A2A skill
 * that wants to *require* a valid mTLS caller. Not wired to any route today
 * (SUN-1222C-AGENT-TRUST-100-IMPLEMENTATION-A §12/§13: "smallest reusable
 * policy primitive... do not activate it in production").
 *
 * This function has no knowledge of payment, x402, settlement, or PCC --
 * it answers exactly one question ("does this caller satisfy the transport
 * -identity policy?") and nothing else. It must never be treated as
 * authorizing paid execution by itself: see
 * `MTLS_WITHOUT_X402_PAID_EXECUTION=DENIED` in the design report and the
 * corresponding test in `mtls-caller-context.test.ts`.
 */
export interface MtlsAuthorizationPolicy {
  /** When `false` (the only value any current route uses), every caller
   * passes regardless of mTLS state -- mTLS is optional identity
   * enrichment only, never a gate. */
  readonly required: boolean;
}

export interface MtlsAuthorizationDecision {
  readonly authorized: boolean;
  readonly reason?: string;
}

export function evaluateMtlsAuthorization(
  context: MtlsCallerContext,
  policy: MtlsAuthorizationPolicy
): MtlsAuthorizationDecision {
  if (!policy.required) {
    return { authorized: true };
  }
  if (context.state === 'valid') {
    return { authorized: true };
  }
  return { authorized: false, reason: `mtls_required_but_state_is_${context.state}` };
}
