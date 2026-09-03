/**
 * Statically imports SITEBORNE's canonical `registry/services/*.json`
 * entries (directive §6/§7) — the single source of truth for each
 * service's title/description/capabilities/declared limitations/pricing
 * schemes this module composes from, never a second manually-maintained
 * list. Runtime economic amounts are projected from the governed pricing
 * resolver below; the frozen registry JSON is not an economic authority.
 * Static JSON import (`resolveJsonModule`), not a runtime
 * `fs.readFileSync` — see frozen-inputs.ts's module comment for why.
 */
import companyEvidenceGraph from '../../../../registry/services/company_evidence_graph.v1.json' with { type: 'json' };
import webContextVerified from '../../../../registry/services/web_context_verified.v1.json' with { type: 'json' };
import documentEvidenceJson from '../../../../registry/services/document_evidence_json.v1.json' with { type: 'json' };
import verifyAgentOutput from '../../../../registry/services/verify_agent_output.v1.json' with { type: 'json' };
// SUN-1000 checkpoint 1M: parallel v2 registry entries — same economics,
// same schemas, only service_id/service_version differ (checkpoint 1L
// section 9's SAME_ECONOMICS_NEW_SERVICE_MAJOR).
import companyEvidenceGraphV2 from '../../../../registry/services/company_evidence_graph.v2.json' with { type: 'json' };
import webContextVerifiedV2 from '../../../../registry/services/web_context_verified.v2.json' with { type: 'json' };
import documentEvidenceJsonV2 from '../../../../registry/services/document_evidence_json.v2.json' with { type: 'json' };
import verifyAgentOutputV2 from '../../../../registry/services/verify_agent_output.v2.json' with { type: 'json' };
import { resolveServiceMaxPriceUsd } from '../pricing/mapping';
import type { SiteborneServiceId } from '../types';
import { withGovernedRegistryPrice } from './registry-pricing';

export interface RegistryServiceEntry {
  service_id: SiteborneServiceId;
  service_version: string;
  title: string;
  description: string;
  capabilities: string[];
  input_schema_uri: string;
  input_schema_hash: string;
  output_schema_uri: string;
  output_schema_hash: string;
  pcc_version: string;
  pricing_schemes: string[];
  base_price: { amount: string; currency: string };
  maximum_price: { amount: string; currency: string };
  execution_mode: string;
  maximum_input_bytes: number;
  expected_latency_class: string;
  authorization_classification: string;
  promotion_state: string;
  production_enabled: boolean;
  declared_limitations: string[];
}

/** Keyed by `SiteborneServiceId` — the exact four services SUN-0700A
 * generates Bazaar discovery declarations for. */
export const REGISTRY_SERVICES: Readonly<Record<SiteborneServiceId, RegistryServiceEntry>> = {
  'company_evidence_graph.v1': companyEvidenceGraph as RegistryServiceEntry,
  'web_context_verified.v1': webContextVerified as RegistryServiceEntry,
  'document_evidence_json.v1': documentEvidenceJson as RegistryServiceEntry,
  'verify_agent_output.v1': verifyAgentOutput as RegistryServiceEntry,
  // SUN-1000 checkpoint 1M.
  'company_evidence_graph.v2': withGovernedRegistryPrice(
    companyEvidenceGraphV2 as RegistryServiceEntry,
    resolveServiceMaxPriceUsd('company_evidence_graph_v2')
  ),
  'web_context_verified.v2': webContextVerifiedV2 as RegistryServiceEntry,
  'document_evidence_json.v2': documentEvidenceJsonV2 as RegistryServiceEntry,
  'verify_agent_output.v2': verifyAgentOutputV2 as RegistryServiceEntry,
};

export const ALL_BAZAAR_SERVICE_IDS: readonly SiteborneServiceId[] = [
  'company_evidence_graph.v1',
  'web_context_verified.v1',
  'document_evidence_json.v1',
  'verify_agent_output.v1',
  'company_evidence_graph.v2',
  'web_context_verified.v2',
  'document_evidence_json.v2',
  'verify_agent_output.v2',
];
