#!/usr/bin/env tsx
/**
 * SITEBORNE-FINAL-LOCAL-CONVERGENCE-01 step 18 — deterministic, public-safe
 * expectation manifest for later external cutover verification. Every value
 * here is read directly from governed repo sources (registry + frozen
 * Release 3 metadata); nothing is invented, and no current D1/production
 * state is asserted (see CATALOG_RUNTIME_DATA_PARITY in
 * governance/RELEASE_GATE_MANIFEST.yaml — this manifest states what Catalog
 * *should* show once real rows exist, never that they exist today).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SERVICE_IDS = [
  'company_evidence_graph',
  'web_context_verified',
  'document_evidence_json',
  'verify_agent_output',
] as const;

function readJson<T>(rel: string): T {
  return JSON.parse(readFileSync(join(REPO_ROOT, rel), 'utf-8')) as T;
}

interface RegistryEntry {
  service_id: string;
  pcc_version: string;
  input_schema_hash: string;
  output_schema_hash: string;
  authorization_classification: string;
  promotion_state: string;
  production_enabled: boolean;
  base_price: { amount: string; currency: string };
  maximum_price: { amount: string; currency: string };
}

function main(): void {
  const services = SERVICE_IDS.map((id) => {
    const registry = readJson<RegistryEntry>(`registry/services/${id}.v3.json`);
    return {
      service_id: `${id}.v3`,
      release: '3.0.0',
      pcc_version: registry.pcc_version,
      input_schema_hash: registry.input_schema_hash,
      output_schema_hash: registry.output_schema_hash,
      authorization_classification: registry.authorization_classification,
      candidate_state: {
        promotion_state: registry.promotion_state,
        production_enabled: registry.production_enabled,
      },
      economics: {
        base_price: registry.base_price,
        maximum_price: registry.maximum_price,
      },
      expected_post_activation_production_state: {
        promotion_state: 'admitted_production',
        production_enabled: true,
      },
      surfaces: {
        mcp: 'live_candidate',
        a2a: 'skill_declared_no_authorization_field',
        openapi: 'live_candidate_extension',
        catalog: 'expected_row_not_verifiable_in_this_repo',
      },
    };
  });

  const manifest = {
    schema: 'siteborne.public_projection_expectation_manifest.v1',
    generated_from: 'registry/services/*.v3.json',
    release: '3.0.0',
    domain_topology: {
      canonical_domain: 'siteborne.net',
      edge_worker_host: 'siteborne-utility-edge.siteborneutilitynetwork.workers.dev',
    },
    security_reporting: {
      contact: 'security@alerts.siteborne.net',
      expires: '2027-08-31T23:59:59Z',
    },
    services,
  };

  writeFileSync(
    join(REPO_ROOT, 'governance/PUBLIC_PROJECTION_EXPECTATION_MANIFEST.json'),
    JSON.stringify(manifest, null, 2) + '\n'
  );
  // eslint-disable-next-line no-console
  console.log('PUBLIC_PROJECTION_EXPECTATION_MANIFEST_READY=YES');
}

main();
