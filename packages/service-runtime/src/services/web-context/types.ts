export interface WebContextInput {
  target_url: string;
  retrieval_mode: 'direct' | 'rendered';
  output_mode?: 'clean_text' | 'markdown' | 'structured';
  freshness_seconds?: number;
  max_content_size?: number;
  redirect_policy?: 'follow' | 'follow_first' | 'manual';
  max_redirects?: number;
}

export interface WebContextExtension {
  requested_url?: string;
  final_url?: string;
  retrieval_mode_requested?: 'direct' | 'rendered';
  retrieval_mode_used?: 'direct' | 'rendered';
  http_metadata?: {
    status_code?: number;
    content_type?: string;
    content_length?: number;
    headers?: Record<string, string>;
  };
  canonical_text?: string;
  extraction_warnings?: string[];
  /** Frozen shape requires a per-hop status_code the direct-public-http
   * adapter does not currently capture — never populated by this service
   * (see service.ts); kept in the type only to document that omission. */
  redirect_chain?: Array<{ url: string; status_code: number }>;
  content_hash?: string;
  truncation_status?: { truncated?: boolean; original_bytes?: number; returned_bytes?: number };
  character_count?: number;
  byte_count?: number;
  limitations?: string[];
  prompt_injection_findings?: Array<{
    type: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    location?: string;
  }>;
}
