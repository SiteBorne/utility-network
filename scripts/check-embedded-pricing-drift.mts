#!/usr/bin/env -S npx tsx
/**
 * SUN-1203 checkpoint I — closes a real, previously-unguarded drift risk
 * found during the release-readiness pricing audit: `packages/pricing/
 * src/service-prices.ts`'s `EMBEDDED_PRICING` constant (the ACTUAL price
 * table the real production Worker uses -- `getRiskLimitsPath()`'s
 * `import.meta.url`-relative path computation does not survive esbuild's
 * single-file bundling, the same `UNPROVEN_BUNDLE_PATH_DEPENDENCY` class
 * of issue `schema-registry.ts` had, so the real bundled Worker always
 * falls through to `EMBEDDED_PRICING`, never a live read of
 * `governance/RISK_LIMITS.yaml`) had NO automated check proving it stays
 * in sync with `governance/RISK_LIMITS.yaml` -- despite that file's own
 * doc comment claiming "validated by scripts/validate-governance.ts",
 * which does not actually check this. A future edit to the YAML alone
 * (the file a human would naturally edit, being the documented
 * governance source of truth) would silently NOT reach production
 * pricing.
 *
 * This script parses the real YAML and compares it key-for-key against
 * the embedded constant. Wired into `pnpm check` (`pnpm pricing:check`).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const YAML_PATH = join(REPO_ROOT, 'governance', 'RISK_LIMITS.yaml');
const EMBEDDED_SOURCE_PATH = join(REPO_ROOT, 'packages', 'pricing', 'src', 'service-prices.ts');

function extractEmbeddedPricing(source: string): {
  version: string;
  prices: Record<string, number>;
} {
  const versionMatch = source.match(/const EMBEDDED_VERSION = '([^']+)'/);
  if (!versionMatch) {
    throw new Error('could not locate EMBEDDED_VERSION in service-prices.ts');
  }
  const blockMatch = source.match(
    /const EMBEDDED_PRICING: Readonly<Record<string, number>> = \{([\s\S]*?)\} as const;/
  );
  if (!blockMatch) {
    throw new Error('could not locate EMBEDDED_PRICING block in service-prices.ts');
  }
  const prices: Record<string, number> = {};
  const entryPattern = /(\w+):\s*([\d.]+),?/g;
  let m: RegExpExecArray | null;
  while ((m = entryPattern.exec(blockMatch[1])) !== null) {
    prices[m[1]] = Number(m[2]);
  }
  return { version: versionMatch[1], prices };
}

function main() {
  const yamlDoc = parse(readFileSync(YAML_PATH, 'utf-8')) as {
    version: string;
    financial_limits: { max_price_usd_per_service: Record<string, number> };
  };
  const source = readFileSync(EMBEDDED_SOURCE_PATH, 'utf-8');
  const embedded = extractEmbeddedPricing(source);

  const problems: string[] = [];

  if (yamlDoc.version !== embedded.version) {
    problems.push(
      `version drift: governance/RISK_LIMITS.yaml version="${yamlDoc.version}" but EMBEDDED_VERSION="${embedded.version}"`
    );
  }

  const yamlKeys = new Set(Object.keys(yamlDoc.financial_limits.max_price_usd_per_service));
  const embeddedKeys = new Set(Object.keys(embedded.prices));

  for (const key of yamlKeys) {
    if (!embeddedKeys.has(key)) {
      problems.push(`"${key}" is in governance/RISK_LIMITS.yaml but missing from EMBEDDED_PRICING`);
      continue;
    }
    const yamlValue = yamlDoc.financial_limits.max_price_usd_per_service[key];
    const embeddedValue = embedded.prices[key];
    if (yamlValue !== embeddedValue) {
      problems.push(
        `"${key}" drift: governance/RISK_LIMITS.yaml=${yamlValue} EMBEDDED_PRICING=${embeddedValue}`
      );
    }
  }
  for (const key of embeddedKeys) {
    if (!yamlKeys.has(key)) {
      problems.push(`"${key}" is in EMBEDDED_PRICING but missing from governance/RISK_LIMITS.yaml`);
    }
  }

  if (problems.length > 0) {
    console.error('[pricing:check] EMBEDDED_PRICING drift detected:');
    for (const p of problems) console.error(`  - ${p}`);
    console.error(
      "\nFix: update packages/pricing/src/service-prices.ts's EMBEDDED_PRICING/EMBEDDED_VERSION " +
        'to exactly match governance/RISK_LIMITS.yaml (the real production Worker uses EMBEDDED_PRICING, ' +
        "never a live read of the YAML file -- see this script's own header comment)."
    );
    process.exit(1);
  }

  console.log(
    `[pricing:check] EMBEDDED_PRICING matches governance/RISK_LIMITS.yaml exactly (version ${yamlDoc.version}, ${yamlKeys.size} price keys).`
  );
}

main();
