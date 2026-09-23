#!/usr/bin/env -S npx tsx
/**
 * Verifies the runtime registry projection used by catalog/A2A/Worker seed
 * paths against the governed pricing resolver. Frozen registry JSON remains
 * contract-history input and is guarded by contracts:compat:check; it is not
 * allowed to override current settlement or discovery economics.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SiteborneServiceId } from '../packages/protocol-x402/src/types.ts';
import { withGovernedRegistryPrice } from '../packages/protocol-x402/src/bazaar/registry-pricing.ts';
import {
  resolveServiceMaxPriceUsd,
  type PricingKey,
} from '../packages/pricing/src/service-prices.ts';

export interface RegistryPriceKeyEntry {
  baseKey: PricingKey;
  maxKey?: PricingKey;
  checkMax?: boolean;
  /** True when registry-source.ts serves this id via
   * `withGovernedRegistryPrice(raw, resolveServiceMaxPriceUsd(baseKey))`
   * rather than the raw frozen JSON as-is -- this check must validate
   * exactly what is actually served, not the untouched frozen file. */
  projected?: boolean;
}

export const PRICE_KEY_MAP: Readonly<Record<SiteborneServiceId, RegistryPriceKeyEntry>> = {
  // The historical v1 registry advertises an unwired `upto` ceiling with no
  // corresponding governance tier. Preserve it in this bounded v2 change;
  // its exact charged/base price is still checked here.
  'company_evidence_graph.v1': { baseKey: 'company_evidence_graph', checkMax: false },
  // registry-source.ts (SUN-1000 checkpoint 1M / SUN-1222C-R3) projects this
  // family's governed v2 price onto the frozen registry contract JSON at
  // runtime via `withGovernedRegistryPrice`, rather than serving the
  // frozen v1-era registry JSON as-is. `projected: true` here mirrors that
  // same projection so this check validates what is actually served, not
  // the untouched frozen file.
  'company_evidence_graph.v2': { baseKey: 'company_evidence_graph_v2', projected: true },
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
  // Was previously mapped to the v1 authority key (`verify_agent_output_standard`,
  // 0.019), which coincidentally equalled the frozen v2 registry JSON's own
  // v1-era `base_price` (also 0.019) and so passed without ever checking
  // the governed v2 price. registry-source.ts actually serves this service
  // via `withGovernedRegistryPrice(..., resolveServiceMaxPriceUsd('verify_agent_output_standard_v2'))`
  // (0.017), which also overwrites `maximum_price` to that same projected
  // value -- `projected: true` and omitting `maxKey` mirrors that.
  'verify_agent_output.v2': { baseKey: 'verify_agent_output_standard_v2', projected: true },
  // v3 candidate registry files (contracts/releases/3.0.0, not yet
  // production-admitted) are served unprojected/raw by registry-source.ts --
  // their JSON already declares the v2-generation governed price directly,
  // since v3 inherits its economic contract from v2
  // (packages/pricing/src/economic-contract.ts: `'verify_agent_output.v3':
  // { ...EXISTING_DEFINITIONS['verify_agent_output.v2'], generation: 'v3', ... }`,
  // same pattern for the other three families). These four entries were
  // previously entirely absent from this map, so drift in any of them went
  // undetected -- and, before the coverage check below existed, so did a
  // registry file being added without a corresponding map entry at all.
  'company_evidence_graph.v3': { baseKey: 'company_evidence_graph_v2' },
  'web_context_verified.v3': { baseKey: 'web_context_verified_direct_v2' },
  'document_evidence_json.v3': {
    baseKey: 'document_evidence_json_native_v2',
    maxKey: 'document_evidence_json_max_job',
  },
  'verify_agent_output.v3': {
    baseKey: 'verify_agent_output_standard_v2',
    maxKey: 'verify_agent_output_reproduction',
  },
};

export interface DriftCheckDeps {
  repoRoot: string;
  priceKeyMap?: Readonly<Record<string, RegistryPriceKeyEntry>>;
  readRegistryEntry?: (serviceId: string) => {
    base_price: { amount: string; currency: string };
    maximum_price: { amount: string; currency: string };
  };
  resolvePrice?: (key: PricingKey) => string;
}

export interface DriftCheckResult {
  problems: string[];
  discovered: string[];
  validated: string[];
  uncovered: string[];
}

function defaultReadRegistryEntry(repoRoot: string, serviceId: string) {
  return JSON.parse(
    readFileSync(join(repoRoot, 'registry', 'services', `${serviceId}.json`), 'utf8')
  ) as {
    base_price: { amount: string; currency: string };
    maximum_price: { amount: string; currency: string };
  };
}

/** The real drift-check logic, parameterized so tests can exercise it
 * end-to-end (map lookup, projection, comparison, and fails-closed
 * coverage discovery) against injected registry/pricing data, without
 * re-implementing or asserting on `PRICE_KEY_MAP` directly. */
export function runRegistryPricingDriftCheck(deps: DriftCheckDeps): DriftCheckResult {
  const { repoRoot } = deps;
  const priceKeyMap = deps.priceKeyMap ?? PRICE_KEY_MAP;
  const readRegistryEntry =
    deps.readRegistryEntry ?? ((id: string) => defaultReadRegistryEntry(repoRoot, id));
  const resolvePrice = deps.resolvePrice ?? resolveServiceMaxPriceUsd;

  const problems: string[] = [];
  const validated: string[] = [];

  for (const [serviceId, keys] of Object.entries(priceKeyMap)) {
    const raw = readRegistryEntry(serviceId);
    const entry = keys.projected
      ? withGovernedRegistryPrice(raw, resolvePrice(keys.baseKey))
      : raw;
    const expectedBase = resolvePrice(keys.baseKey);
    const expectedMax = resolvePrice(keys.maxKey ?? keys.baseKey);
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
    validated.push(serviceId);
  }

  // Fails closed: every registry/services/*.json file on disk must be
  // covered by priceKeyMap. A file present on disk but absent from the map
  // (a new/renamed service, or an id this checker doesn't recognize) is
  // reported as a problem rather than silently skipped -- this is what
  // previously let all four .v3 files go completely unchecked.
  let discovered: string[];
  try {
    discovered = readdirSync(join(repoRoot, 'registry', 'services'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -'.json'.length))
      .sort();
  } catch {
    discovered = [];
  }
  const known = new Set(Object.keys(priceKeyMap));
  const uncovered = discovered.filter((id) => !known.has(id));
  for (const id of uncovered) {
    problems.push(
      `${id}: registry/services/${id}.json exists but has no entry in the pricing-drift checker's coverage map (unknown registry identity)`
    );
  }

  return { problems, discovered, validated, uncovered };
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const { problems, discovered, validated, uncovered } = runRegistryPricingDriftCheck({
    repoRoot,
  });

  if (problems.length > 0) {
    console.error('[pricing:registry:check] runtime registry price drift detected:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  console.log(
    `[pricing:registry:check] runtime registry prices match governed pricing. ` +
      `discovered=${discovered.length} validated=${validated.length} uncovered=${uncovered.length}.`
  );
}
