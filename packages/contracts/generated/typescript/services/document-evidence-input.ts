// Generated from /Users/meta4ickal/SITEBORNE Utility Network/schemas/services/document-evidence-input.schema.json
  // DO NOT EDIT MANUALLY — regenerate from canonical schema
  
  /**
 * Input schema for document_evidence_json.v1 service. Exactly one document reference mode
 * required.
 */
export interface DocumentEvidenceInput {
    /**
     * Authorized artifact reference (mode 1).
     */
    artifact_reference?: AuthorizedArtifactReference;
    /**
     * Declared page count when known.
     */
    declared_page_count?: number;
    /**
     * Public document URL (mode 3).
     */
    document_url?: string;
    /**
     * Extraction configuration.
     */
    extraction_request?: ExtractionRequest;
    /**
     * Language hints for OCR/extraction (BCP 47).
     */
    language_hints?:             string[];
    maximum_authorized_price?:   DecimalMoney;
    minimum_verification_score?: number;
    /**
     * Whether OCR is permitted for image-based content.
     */
    ocr_permission?: boolean;
    /**
     * Page range to process (1-indexed, inclusive).
     */
    page_range?: PageRange;
    /**
     * Retention preference within policy limits.
     */
    retention_preference?: RetentionPreference;
    /**
     * Whether table extraction is requested.
     */
    table_extraction_request?: boolean;
    /**
     * Authorized upload reference (mode 2).
     */
    upload_reference?: UploadReference;
}

/**
 * Authorized artifact reference (mode 1).
 *
 * Reference to an authorized document artifact for processing. Used for document evidence
 * service.
 */
export interface AuthorizedArtifactReference {
    /**
     * Short-lived access token for private artifacts. Must not be logged.
     */
    access_token?: string;
    /**
     * Unique artifact identifier (e.g., R2 object key, artifact registry ID).
     */
    artifact_id: string;
    /**
     * Authorization classification.
     */
    authorization?: Authorization;
    /**
     * SHA-256 content hash for integrity verification.
     */
    content_hash?: string;
    /**
     * Declared MIME type of the artifact.
     */
    media_type: MediaType;
    /**
     * Declared page count when known.
     */
    page_count?: number;
    /**
     * Declared size in bytes.
     */
    size_bytes: number;
}

/**
 * Authorization classification.
 */
export type Authorization = "public" | "buyer_authorized";

/**
 * Declared MIME type of the artifact.
 */
export type MediaType = "application/pdf" | "image/png" | "image/jpeg";

/**
 * Extraction configuration.
 */
export interface ExtractionRequest {
    buyer_schema?:       { [key: string]: unknown };
    extract_key_values?: boolean;
    extract_tables?:     boolean;
    extract_text?:       boolean;
}

/**
 * Canonical decimal-safe money representation. No binary floating-point. Amount is a
 * canonical decimal string.
 */
export interface DecimalMoney {
    /**
     * Canonical decimal string. No scientific notation, no leading zeros (except single '0'),
     * no trailing zeros unless significant, no sign. Maximum 18 decimal places.
     */
    amount: string;
    /**
     * Payment asset identifier (e.g., 'USDC', 'ETH'). Optional for non-payment contexts.
     */
    asset?: string;
    /**
     * ISO 4217 currency code.
     */
    currency: Currency;
    /**
     * Payment network identifier (e.g., 'base-mainnet', 'base-sepolia'). Optional for
     * non-payment contexts.
     */
    network?: string;
    /**
     * Maximum decimal places supported by the asset/network. Metadata only.
     */
    precision?: number;
}

/**
 * ISO 4217 currency code.
 */
export type Currency = "USD";

/**
 * Page range to process (1-indexed, inclusive).
 */
export interface PageRange {
    end?:   number;
    start?: number;
}

/**
 * Retention preference within policy limits.
 */
export type RetentionPreference = "none" | "temporary" | "permanent";

/**
 * Authorized upload reference (mode 2).
 */
export interface UploadReference {
    content_hash?: string;
    media_type:    MediaType;
    size_bytes:    number;
    upload_id:     string;
}
