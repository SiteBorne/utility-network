#!/usr/bin/env -S npx tsx
/**
 * SUN-1222B-S3 — closes a second, previously-unguarded pricing-drift
 * risk found during the four-service commercial-readiness audit,
 * sibling to `check-embedded-pricing-drift.mts` (which only proves
 * `EMBEDDED_PRICING` matches `governance/RISK_LIMITS.yaml` -- it says
 * nothing about `registry/services/*.json`'s own `base_price`/
 * `maximum_price` fields, a FOURTH independent hand-maintained copy of
 * the same numbers). Those fields feed `paid-services.ts`'s `seedServices`
 * (the D1 `services.price_usd` column `/catalog` serves verbatim, with
 * no live-recompute overlay unlike `production_enabled`/`production_ready`
 * — see `catalog.ts`'s own `overlayEffectiveDiscoveryStatus` doc comment
 * for why that pattern exists for those two fields but not yet this one).
 *
 * The real charged amount is never at risk — every quote-minting call
 * site (`x402-service.ts`, `protocol-mcp/server.ts`,
 * `protocol-x402/bazaar/discovery.ts`) calls `resolveServiceMaxPriceUsd()`
 * live, never `REGISTRY_SERVICES[...].maximum_price`. This script guards
 * the DISPLAY-ONLY surface (catalog price, and any future consumer of
 * the registry JSON's own price fields) against silently drifting from
 * the same governance values everything else derives from.
 *
 * Confirmed by this script on first run: `company_evidence_graph`
 * (v1 AND v2) has no second governance price tier at all -- one flat
 * `company_evidence_graph` key in RISK_LIMITS.yaml -- yet its registry
 * JSON declares `maximum_price: 0.19`, matching neither its own
 * `base_price` (0.039) nor any real governance key for this service
 * (0.19 is `document_evidence_json_max_job`'s value, not this
 * service's). This looks like a copy/paste artifact, not an
 * intentional reserved ceiling — flagged here rather than silently
 * "corrected" to a guessed value, since only a governance decision can
 * say whether `company_evidence_graph` is meant to gain a real upto
 * ceiling (its `pricing_schemes` already lists 'upto', though no upto
 * route is actually wired for it anywhere in `paid-services.ts` today)
 * or whether `maximum_price` should simply equal `base_price`.
 *
 * Wired into `pnpm check` (`pnpm pricing:registry:check`).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const YAML_PATH = join(REPO_ROOT, 'governance', 'RISK_LIMITS.yaml');
const REGISTRY_DIR = join(REPO_ROOT, 'registry', 'services');

/** Maps each service family to the governance `max_price_usd_per_service`
 * key(s) its registry `base_price`/`maximum_price` fields must match.
 * `maxKey: undefined` means the family has no distinct governance
 * ceiling tier -- `maximum_price` is then required to equal
 * `base_price` exactly (a single-price service, never silently allowed
 * to display a higher "maximum" than anything governance actually
 * charges). Applies identically to both the .v1 and .v2 registry entry
 * for each family (SUN-1000 checkpoint 1M: "same economics, same
 * schemas, only service_id/service_version differ"). */
const PRICE_KEY_MAP: Record<string, { baseKey: string; maxKey?: string }> = {
  company_evidence_graph: { baseKey: 'company_evidence_graph' },
  web_context_verified: {
    baseKey: 'web_context_verified_direct',
    maxKey: 'web_context_verified_rendered',
  },
  document_evidence_json: {
    baseKey: 'document_evidence_json_native',
    maxKey: 'document_evidence_json_max_job',
  },
  verify_agent_output: {
    baseKey: 'verify_agent_output_standard',
    maxKey: 'verify_agent_output_reproduction',
  },
};

function main() {
  const yamlDoc = parse(readFileSync(YAML_PATH, 'utf-8')) as {
    financial_limits: { max_price_usd_per_service: Record<string, number> };
  };
  const limits = yamlDoc.financial_limits.max_price_usd_per_service;

  const problems: string[] = [];

  for (const [family, keys] of Object.entries(PRICE_KEY_MAP)) {
    for (const version of ['v1', 'v2']) {
      const fileBase = `${family}.${version}`;
      const path = join(REGISTRY_DIR, `${fileBase}.json`);
      let entry: { base_price?: { amount: string }; maximum_price?: { amount: string } };
      try {
        entry = JSON.parse(readFileSync(path, 'utf-8'));
      } catch {
        problems.push(`${fileBase}.json: could not read/parse`);
        continue;
      }

      const expectedBase = limits[keys.baseKey];
      if (expectedBase === undefined) {
        problems.push(`${fileBase}: governance key "${keys.baseKey}" does not exist`);
      } else {
        const actualBase = Number(entry.base_price?.amount);
        if (actualBase !== expectedBase) {
          problems.push(
            `${fileBase}: base_price=${entry.base_price?.amount} but governance "${keys.baseKey}"=${expectedBase}`
          );
        }
      }

      const expectedMax = keys.maxKey !== undefined ? limits[keys.maxKey] : expectedBase;
      if (keys.maxKey !== undefined && expectedMax === undefined) {
        problems.push(`${fileBase}: governance key "${keys.maxKey}" does not exist`);
      } else {
        const actualMax = Number(entry.maximum_price?.amount);
        if (actualMax !== expectedMax) {
          const expectedSource =
            keys.maxKey !== undefined
              ? `governance "${keys.maxKey}"=${expectedMax}`
              : `base_price (no distinct governance ceiling for this family)=${expectedMax}`;
          problems.push(
            `${fileBase}: maximum_price=${entry.maximum_price?.amount} but expected ${expectedSource}`
          );
        }
      }
    }
  }

  if (problems.length > 0) {
    console.error('[pricing:registry:check] registry/services/*.json price drift detected:');
    for (const p of problems) console.error(`  - ${p}`);
    console.error(
      '\nThe real charged amount is unaffected (every quote-minting call site reads ' +
        'governance/RISK_LIMITS.yaml live via resolveServiceMaxPriceUsd(), never these ' +
        'fields) -- but this is the exact data seedServices() writes into D1, which ' +
        '/catalog serves back verbatim with no live-recompute overlay. Either correct ' +
        'the registry JSON to match governance, or update PRICE_KEY_MAP in this script ' +
        'if the mismatch reflects a real, intentional new governance tier.'
    );
    process.exit(1);
  }

  console.log(
    `[pricing:registry:check] registry/services/*.json prices match governance/RISK_LIMITS.yaml for all ${Object.keys(PRICE_KEY_MAP).length * 2} entries.`
  );
}

main();
