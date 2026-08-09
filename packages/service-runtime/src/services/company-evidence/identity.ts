import type { CompanyEvidenceInput, IdentityConfidence } from './types';

export interface ResolvedIdentity {
  confidence: IdentityConfidence;
  cik?: string;
  ticker?: string;
  domain?: string;
  companyName?: string;
}

/**
 * Deterministic identity resolution (directive §11). Priority: explicit CIK
 * (exact) > normalized domain (corroborated — a domain claim is not itself
 * authoritative, but is a stronger signal than a bare name) > company name
 * alone (unresolved — no fuzzy merge is performed; a name-only input never
 * becomes "exact"). This increment does not implement a ticker→CIK mapping
 * database, so a ticker alone resolves no better than a name (never treated
 * as a globally unique identifier, per directive §11's explicit warning).
 */
export function resolveIdentity(input: CompanyEvidenceInput): ResolvedIdentity {
  const cik = input.identifiers?.cik;
  if (cik) {
    return {
      confidence: 'exact',
      cik,
      ticker: input.ticker,
      domain: input.domain,
      companyName: input.company_name,
    };
  }
  if (input.domain) {
    return {
      confidence: 'corroborated',
      ticker: input.ticker,
      domain: input.domain,
      companyName: input.company_name,
    };
  }
  if (input.company_name) {
    return { confidence: 'unresolved', ticker: input.ticker, companyName: input.company_name };
  }
  return { confidence: 'unresolved' };
}
