/**
 * The one runtime-safe, typed API for resolving SITEBORNE's per-service
 * accepted prices. `governance/RISK_LIMITS.yaml`'s
 * `max_price_usd_per_service` remains the ultimate source of truth (the
 * same file `scripts/validate-governance.ts` already validates) — this
 * module is the single place that owns reading it. Callers outside this
 * package (e.g. `@siteborne/protocol-x402`) must go through this API
 * rather than parsing the governance YAML themselves, so there is exactly
 * one pricing source of truth and exactly one place that knows how to
 * reach it.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { usdToMicro } from './index';

/** Embedded pricing data from governance/RISK_LIMITS.yaml (version 1.0.0).
 * This is the source of truth for Workers and other environments without
 * filesystem access. The YAML file is the canonical source; this constant
 * must be kept in sync (validated by scripts/validate-governance.ts). */
const EMBEDDED_PRICING: Readonly<Record<string, number>> = {
  company_evidence_graph: 0.039,
  web_context_verified_direct: 0.009,
  web_context_verified_rendered: 0.029,
  document_evidence_json_native: 0.012,
  document_evidence_json_ocr: 0.019,
  document_evidence_json_table: 0.029,
  document_evidence_json_max_job: 0.19,
  verify_agent_output_standard: 0.019,
  verify_agent_output_reproduction: 0.049,
} as const;

const EMBEDDED_VERSION = '1.0.0';

/** Repo-root-relative — this package lives at packages/pricing/src, so
 * governance/ is three levels up. */
function getRiskLimitsPath(): string {
  try {
    return fileURLToPath(new URL('../../../governance/RISK_LIMITS.yaml', import.meta.url));
  } catch {
    return '';
  }
}

export type PricingKey =
  | 'company_evidence_graph'
  | 'web_context_verified_direct'
  | 'web_context_verified_rendered'
  | 'document_evidence_json_native'
  | 'document_evidence_json_ocr'
  | 'document_evidence_json_table'
  | 'document_evidence_json_max_job'
  | 'verify_agent_output_standard'
  | 'verify_agent_output_reproduction';

interface RiskLimitsDocument {
  version: string;
  financial_limits: {
    max_price_usd_per_service: Record<string, number>;
  };
}

let cachedLimits: RiskLimitsDocument | undefined;

function loadRiskLimits(): RiskLimitsDocument {
  if (!cachedLimits) {
    const path = getRiskLimitsPath();
    if (!path) {
      // Worker environment: use embedded data
      cachedLimits = {
        version: EMBEDDED_VERSION,
        financial_limits: { max_price_usd_per_service: { ...EMBEDDED_PRICING } },
      };
    } else {
      cachedLimits = parse(readFileSync(path, 'utf-8')) as RiskLimitsDocument;
    }
  }
  return cachedLimits;
}

/** Test-only seam: lets tests substitute a synthetic pricing document
 * instead of re-parsing the real governance file. No production code path
 * can reach this — it exists purely so callers (including other
 * packages' test suites) can assert behavior against a controlled price
 * table without depending on the real governance file's current values. */
export function __setRiskLimitsForTesting(doc: RiskLimitsDocument | undefined): void {
  cachedLimits = doc;
}

export class UnknownPricingKeyError extends Error {
  constructor(public readonly key: string) {
    super(`no max_price_usd_per_service entry for pricing key "${key}"`);
    this.name = 'UnknownPricingKeyError';
  }
}

/** The accepted ceiling price for a service (in USD, as a decimal string,
 * matching governance/RISK_LIMITS.yaml's own representation) — fails
 * closed (throws) rather than silently returning a fabricated price for
 * an unknown key. */
export function resolveServiceMaxPriceUsd(key: PricingKey): string {
  const limits = loadRiskLimits();
  const raw = limits.financial_limits.max_price_usd_per_service[key];
  if (raw === undefined || raw === null) {
    throw new UnknownPricingKeyError(key);
  }
  return String(raw);
}

/** The governance pricing document's own `version` field
 * (`governance/RISK_LIMITS.yaml`'s top-level `version:`) — lets a caller
 * (e.g. a payment quote) bind the pricing *rule version*, not just a
 * price value, so a governance repricing revision is itself a bound,
 * detectable change. */
export function resolvePricingSourceVersion(): string {
  return loadRiskLimits().version;
}

/** Converts a decimal USD string to the atomic-unit integer string a
 * payment protocol requires, given the payment asset's decimal precision
 * (e.g. 6 for USDC). Never uses binary floating point — routes through
 * this package's own decimal-safe `usdToMicro` (6-decimal micro-USD) and
 * then rescales by integer arithmetic on the micro-USD numerator. */
export function usdToAtomicUnits(usd: string, assetDecimals: number): string {
  if (!Number.isInteger(assetDecimals) || assetDecimals < 0 || assetDecimals > 255) {
    throw new TypeError('assetDecimals must be an integer between 0 and 255');
  }

  const micro = BigInt(usdToMicro(usd)); // integer, 6 decimals of USD precision
  if (assetDecimals === 6) return micro.toString();
  if (assetDecimals > 6) {
    return (micro * 10n ** BigInt(assetDecimals - 6)).toString();
  }
  // Fewer than 6 decimals: truncate remaining micro-USD precision by
  // integer division (never a float division) — deliberately floors
  // rather than rounds, so a converted amount is never overstated.
  const divisor = 10n ** BigInt(6 - assetDecimals);
  return (micro / divisor).toString();
}
