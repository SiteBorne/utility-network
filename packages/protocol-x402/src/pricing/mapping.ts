/**
 * Binds x402 payment requirement amounts to SITEBORNE's existing accepted
 * pricing source (`governance/RISK_LIMITS.yaml`'s `max_price_usd_per_service`)
 * rather than duplicating price constants in this package. Converts through
 * `@siteborne/pricing`'s decimal-safe `usdToMicro` — never binary floating
 * point — and then to the asset's atomic-unit integer string x402 requires.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { usdToMicro, MICRO_USD_PER_USD } from '@siteborne/pricing';

/** Repo-root-relative — read directly from the governance source of
 * truth, the same discipline scripts/validate-governance.ts already
 * follows, rather than a package-local copy that can drift. */
const RISK_LIMITS_PATH = fileURLToPath(
  new URL('../../../../governance/RISK_LIMITS.yaml', import.meta.url)
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
  financial_limits: {
    max_price_usd_per_service: Record<string, number>;
  };
}

let cachedLimits: RiskLimitsDocument | undefined;

/** Reads and parses governance/RISK_LIMITS.yaml once per process — a pure
 * accessor over a version-controlled, already-validated (see
 * scripts/validate-governance.ts) source file, not a network call. */
function loadRiskLimits(): RiskLimitsDocument {
  if (!cachedLimits) {
    cachedLimits = parse(readFileSync(RISK_LIMITS_PATH, 'utf-8')) as RiskLimitsDocument;
  }
  return cachedLimits;
}

/** Test-only seam: lets fixtures/tests substitute a synthetic pricing
 * document instead of re-parsing the real governance file, without any
 * production code path being able to reach it. */
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

/** Converts a decimal USD string to the atomic-unit integer string x402
 * payment requirements require, given the payment asset's decimal
 * precision (e.g. 6 for USDC). Never uses binary floating point — routes
 * through @siteborne/pricing's usdToMicro (6-decimal micro-USD) and then
 * rescales by integer arithmetic on the micro-USD numerator. */
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

export const MICRO_USD_PRECISION = MICRO_USD_PER_USD;
