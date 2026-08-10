/**
 * SITEBORNE-facing domain types layered on top of @x402/core's official
 * V2 wire types (`PaymentRequirements`, `PaymentRequired`, `PaymentPayload`,
 * `SettleResponse`, `Network`, re-exported below) — never a parallel,
 * hand-maintained reimplementation of the wire shapes themselves.
 */
import type {
  Network,
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  SettleResponse,
} from '@x402/core/types';

export type { Network, PaymentPayload, PaymentRequired, PaymentRequirements, SettleResponse };

/** The four frozen v1 service IDs this package can bind a payment
 * requirement to — kept in sync with
 * @siteborne/service-runtime's ServiceId/ALL_SERVICE_IDS by convention,
 * not by a cross-package type import (service-runtime and protocol-x402
 * are independent packages; a payment can be quoted for a service before
 * that service ever executes). */
export type SiteborneServiceId =
  | 'company_evidence_graph.v1'
  | 'web_context_verified.v1'
  | 'document_evidence_json.v1'
  | 'verify_agent_output.v1';

/** Every payment-domain artifact this package produces binds these fields
 * (directive §7). `unknown` protocol version is handled separately by
 * version.ts and never reaches this binding. */
export interface PaymentContextBinding {
  x402_version: number;
  service_id: SiteborneServiceId;
  service_version: 'v1';
  contract_release: string;
  request_id: string;
  job_id?: string;
  quote_id: string;
  payment_requirement_id: string;
  pricing_key: string;
  resource_id: string;
  expires_at: string;
  network: Network;
  asset: string;
  scheme: 'exact' | 'upto';
  payee: string;
  /** payment-identifier extension value, when the buyer supplied one
   * (directive §14) — optional at this checkpoint, not yet enforced. */
  payment_identifier?: string;
}
