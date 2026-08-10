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

/** Repo-root-relative — this package lives at packages/pricing/src, so
 * governance/ is three levels up. */
const RISK_LIMITS_PATH = fileURLToPath(
  new URL('../../../governance/RISK_LIMITS.yaml', import.meta.url)
);

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
    cachedLimits = parse(readFileSync(RISK_LIMITS_PATH, 'utf-8')) as RiskLimitsDocument;
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
  const micro = usdToMicro(usd); // integer, 6 decimals of USD precision
  if (assetDecimals === 6) return String(micro);
  if (assetDecimals > 6) {
    return String(micro * 10 ** (assetDecimals - 6));
  }
  // Fewer than 6 decimals: truncate remaining micro-USD precision by
  // integer division (never a float division) — deliberately floors
  // rather than rounds, so a converted amount is never overstated.
  const divisor = 10 ** (6 - assetDecimals);
  return String(Math.floor(micro / divisor));
}
