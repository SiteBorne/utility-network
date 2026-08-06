// Generated from /Users/meta4ickal/SITEBORNE Utility Network/schemas/common/authorized-artifact-reference.schema.json
// DO NOT EDIT MANUALLY — regenerate from canonical schema

/**
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
export type Authorization = 'public' | 'buyer_authorized';

/**
 * Declared MIME type of the artifact.
 */
export type MediaType = 'application/pdf' | 'image/png' | 'image/jpeg';
