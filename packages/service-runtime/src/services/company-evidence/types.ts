export interface CompanyEvidenceInput {
  company_name?: string;
  ticker?: string;
  domain?: string;
  identifiers?: { cik?: string; [k: string]: string | undefined };
  requested_field_groups?: FieldGroup[];
  buyer_urls?: string[];
  freshness_seconds?: number;
}

export type FieldGroup =
  | 'identity'
  | 'sec_submissions'
  | 'xbrl_facts'
  | 'recent_filings'
  | 'website_evidence'
  | 'regulatory_mentions'
  | 'public_repository_signals';

/** Field groups this increment actually implements against a real
 * dependency. The rest are recognized (schema-valid to request) but
 * reported `unavailable` with a truthful limitation — never silently
 * dropped, never fabricated (directive §12: "do not collect unrequested
 * expensive data" and the repo-wide no-fabrication discipline). */
export const IMPLEMENTED_FIELD_GROUPS: readonly FieldGroup[] = [
  'identity',
  'sec_submissions',
  'recent_filings',
  'website_evidence',
  'regulatory_mentions',
];

export type IdentityConfidence = 'exact' | 'corroborated' | 'ambiguous' | 'unresolved';

export interface CompanyEvidenceExtension {
  canonical_identity?: {
    legal_name?: string;
    common_name?: string;
    ticker?: string;
    domain?: string;
    resolved_identifiers?: Record<string, string>;
  };
  resolved_identifiers?: Record<string, string>;
  field_groups?: Record<
    string,
    {
      status: 'complete' | 'partial' | 'empty' | 'unavailable';
      items?: unknown[];
      source_count?: number;
      evidence_ids?: string[];
    }
  >;
  filing_summaries?: Array<{
    accession_number?: string;
    filing_type?: string;
    filing_date?: string;
    period_end?: string;
    xbrl_available?: boolean;
    evidence_ids?: string[];
  }>;
  website_observations?: Array<{
    url?: string;
    extracted_at?: string;
    content_hash?: string;
    evidence_ids?: string[];
  }>;
  regulatory_references?: Array<{
    source?: string;
    reference_id?: string;
    date?: string;
    description?: string;
    evidence_ids?: string[];
  }>;
  /** A bounded, scoped absence finding — never a broad claim like "company
   * has no regulatory issues" (see docs/operations/VERIFIED_ABSENCE.md).
   * Matches the frozen `verified_absences` extension shape exactly. */
  verified_absences?: Array<{
    claim: string;
    scope: string;
    sources_checked: string[];
    search_window?: string;
    confidence: number;
    limitations?: string;
    evidence_ids?: string[];
  }>;
  limitations?: string[];
  source_coverage_summary?: {
    sec?: boolean;
    website?: boolean;
    regulatory?: boolean;
    repositories?: boolean;
  };
}
