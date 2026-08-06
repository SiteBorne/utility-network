// Generated from /Users/meta4ickal/SITEBORNE Utility Network/schemas/common/structured-error.schema.json
// DO NOT EDIT MANUALLY — regenerate from canonical schema

/**
 * Canonical structured error envelope for all SITEBORNE services. Machine-actionable, no
 * secrets, no stack traces.
 */
export interface StructuredError {
  /**
   * Closed error category.
   */
  category: Category;
  /**
   * Stable machine-actionable error code.
   */
  error_code: string;
  /**
   * Unique error instance identifier.
   */
  error_id: string;
  /**
   * Reverse-domain qualified extensions per PCC rules.
   */
  extensions?: Extensions;
  /**
   * Bounded field paths that failed validation (JSON Pointer format).
   */
  failed_field_paths?: string[];
  /**
   * Associated job identifier if assigned.
   */
  job_id?: string;
  /**
   * Known limitations related to this error.
   */
  limitations?: string[];
  /**
   * Human-readable descriptive message. Not authoritative for machine control.
   */
  message: string;
  /**
   * Error occurrence timestamp (RFC 3339 UTC).
   */
  occurred_at: string;
  /**
   * Original receipt reference for idempotent replay scenarios.
   */
  original_receipt_reference?: string;
  /**
   * Class of provider that failed (e.g., 'sec', 'web', 'document').
   */
  provider_class?: string;
  /**
   * Reason for quarantine if category is quarantined.
   */
  quarantine_reason?: string;
  /**
   * Associated quote identifier if applicable.
   */
  quote_id?: string;
  /**
   * Original request identifier.
   */
  request_id: string;
  /**
   * Seconds before retry is recommended. Only when meaningful.
   */
  retry_after_seconds?: number;
  /**
   * Whether the operation may succeed on retry without caller changes.
   */
  retryable: boolean;
  /**
   * Service that produced the error.
   */
  service_id: string;
}

/**
 * Closed error category.
 */
export type Category =
  | 'validation'
  | 'authorization'
  | 'payment_required'
  | 'payment_invalid'
  | 'rate_limited'
  | 'unsupported'
  | 'unavailable'
  | 'provider_failure'
  | 'verification_failure'
  | 'conflict'
  | 'duplicate'
  | 'internal'
  | 'quarantined';

/**
 * Reverse-domain qualified extensions per PCC rules.
 */
export interface Extensions {}
