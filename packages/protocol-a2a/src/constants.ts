import { A2A_PROTOCOL_VERSION as SDK_A2A_PROTOCOL_VERSION } from '@a2a-js/sdk';
import type { SiteborneServiceId } from '@siteborne/protocol-x402';

export const A2A_PROTOCOL_VERSION = SDK_A2A_PROTOCOL_VERSION;

export const SITEBORNE_A2A_ORIGIN = 'https://utility.siteborne.net';
export const SITEBORNE_A2A_INTERFACE_URL = `${SITEBORNE_A2A_ORIGIN}/a2a`;
export const SITEBORNE_AGENT_CARD_URL = `${SITEBORNE_A2A_ORIGIN}/.well-known/agent-card.json`;
export const SITEBORNE_A2A_JWKS_URL = `${SITEBORNE_A2A_ORIGIN}/.well-known/jwks.json`;

/**
 * SITEBORNE's product-specific A2A extension identifier. The corresponding
 * contract is recorded in ADR 0052; this is not presented as an upstream
 * x402-owned extension URI.
 */
export const SITEBORNE_X402_EXTENSION_URI = 'https://siteborne.net/extensions/a2a/x402/v1';

/**
 * SUN-1222C-AGENT-TRUST-100 (slice A): the `securitySchemes` map key under
 * which SITEBORNE declares native A2A `mutualTLS` caller-identity support.
 * This declares capability only -- it does not by itself gate any operation.
 * Root `securityRequirements` stays `[]` (see card.ts) so the anonymous A2A
 * probe SITEBORNE's own external conformance monitor performs is unaffected;
 * a future, separately authorized checkpoint may add mTLS to
 * `AgentSkill.securityRequirements` for specific skills without touching
 * this declaration.
 */
export const SITEBORNE_MTLS_SECURITY_SCHEME_KEY = 'mtls';
export const SITEBORNE_MTLS_SECURITY_SCHEME_DESCRIPTION =
  'Optional mutual TLS: callers presenting a client certificate that ' +
  "Cloudflare validates against SITEBORNE's trusted CA are recognized as " +
  'a strongly attributed caller identity. mTLS is never required to reach ' +
  'the public A2A endpoint or its skills, and never itself authorizes ' +
  'paid execution -- x402 payment remains the sole economic authorization ' +
  'mechanism for every service.';

// SUN-1000 checkpoint 1M: v2 identities added alongside v1 (checkpoint 1L
// PREPRODUCTION_V2_REPLACEMENT decision — v1 remains frozen historical
// evidence, v2 is additive here; nothing is removed).
export const SITEBORNE_SERVICE_IDS = [
  'company_evidence_graph.v1',
  'web_context_verified.v1',
  'document_evidence_json.v1',
  'verify_agent_output.v1',
  'company_evidence_graph.v2',
  'web_context_verified.v2',
  'document_evidence_json.v2',
  'verify_agent_output.v2',
] as const satisfies readonly SiteborneServiceId[];
