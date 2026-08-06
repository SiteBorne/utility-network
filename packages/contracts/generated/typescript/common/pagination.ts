// Generated from schemas/proof-carrying-context.schema.json
// DO NOT EDIT MANUALLY — regenerate from canonical schema

/**
 * Standard pagination controls for list-based service outputs.
 */
export interface Pagination {
  /**
   * Opaque cursor for cursor-based pagination.
   */
  cursor?: string;
  /**
   * Whether a next page exists.
   */
  has_next?: boolean;
  /**
   * Whether a previous page exists.
   */
  has_previous?: boolean;
  /**
   * Page number (1-indexed).
   */
  page?: number;
  /**
   * Number of items per page.
   */
  page_size?: number;
  /**
   * Total number of items across all pages.
   */
  total_items?: number;
  /**
   * Total number of pages.
   */
  total_pages?: number;
}
