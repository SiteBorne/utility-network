#!/usr/bin/env -S npx tsx
/**
 * Verifies the runtime registry projection used by catalog/A2A/Worker seed
 * paths against the governed pricing resolver. Frozen registry JSON remains
 * contract-history input and is guarded by contracts:compat:check; it is not
 * allowed to override current settlement or discovery economics.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SiteborneServiceId } from '../packages/protocol-x402/src/types.ts';
import { withGovernedRegistryPrice } from '../packages/protocol-x402/src/bazaar/registry-pricing.ts';
import {
  resolveServiceMaxPriceUsd,
  type PricingKey,
} from '../packages/pricing/src/service-prices.ts';

const PRICE_KEY_MAP: Readonly<
  Record<SiteborneServiceId, { baseKey: PricingKey; maxKey?: PricingKey; checkMax?: boolean }>
> = {
  // The historical v1 registry advertises an unwired `upto` ceiling with no
  // corresponding governance tier. Preserve it in this bounded v2 change;
  // its exact charged/base price is still checked here.
  'company_evidence_graph.v1': { baseKey: 'company_evidence_graph', checkMax: false },
  'company_evidence_graph.v2': { baseKey: 'company_evidence_graph_v2' },
  'web_context_verified.v1': {
    baseKey: 'web_context_verified_direct',
    maxKey: 'web_context_verified_rendered',
  },
  'web_context_verified.v2': {
    baseKey: 'web_context_verified_direct',
    maxKey: 'web_context_verified_rendered',
  },
  'document_evidence_json.v1': {
    baseKey: 'document_evidence_json_native',
    maxKey: 'document_evidence_json_max_job',
  },
  'document_evidence_json.v2': {
    baseKey: 'document_evidence_json_native',
    maxKey: 'document_evidence_json_max_job',
  },
  'verify_agent_output.v1': {
    baseKey: 'verify_agent_output_standard',
    maxKey: 'verify_agent_output_reproduction',
  },
  'verify_agent_output.v2': {
    baseKey: 'verify_agent_output_standard',
    maxKey: 'verify_agent_output_reproduction',
  },
};

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const problems: string[] = [];

for (const [serviceId, keys] of Object.entries(PRICE_KEY_MAP) as Array<
  [SiteborneServiceId, { baseKey: PricingKey; maxKey?: PricingKey; checkMax?: boolean }]
>) {
  const raw = JSON.parse(
    readFileSync(join(repoRoot, 'registry', 'services', `${serviceId}.json`), 'utf8')
  ) as {
    base_price: { amount: string; currency: string };
    maximum_price: { amount: string; currency: string };
  };
  const entry =
    serviceId === 'company_evidence_graph.v2'
      ? withGovernedRegistryPrice(raw, resolveServiceMaxPriceUsd('company_evidence_graph_v2'))
      : raw;
  const expectedBase = resolveServiceMaxPriceUsd(keys.baseKey);
  const expectedMax = resolveServiceMaxPriceUsd(keys.maxKey ?? keys.baseKey);
  if (entry.base_price.amount !== expectedBase) {
    problems.push(
      `${serviceId}: runtime base_price=${entry.base_price.amount} but governance ${keys.baseKey}=${expectedBase}`
    );
  }
  if (keys.checkMax !== false && entry.maximum_price.amount !== expectedMax) {
    problems.push(
      `${serviceId}: runtime maximum_price=${entry.maximum_price.amount} but governance ${keys.maxKey ?? keys.baseKey}=${expectedMax}`
    );
  }
}

if (problems.length > 0) {
  console.error('[pricing:registry:check] runtime registry price drift detected:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  `[pricing:registry:check] runtime registry prices match governed pricing for all ${Object.keys(PRICE_KEY_MAP).length} service entries.`
);
