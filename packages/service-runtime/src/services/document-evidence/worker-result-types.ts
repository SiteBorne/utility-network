/** Loosely-typed mirror of services/modal-worker's WorkerResult
 * (document/models.py) — the TS side of the SUN-0400A composition
 * boundary. Not the source of truth; the Python model is. */
export interface WorkerLocator {
  locator_type: string;
  page?: number | null;
  ordinal?: number | null;
  quote?: string | null;
  table_ordinal?: number | null;
  row?: number | null;
  column?: number | null;
}

export interface WorkerTable {
  page: number;
  table_ordinal: number;
  headers: string[];
  rows: string[][];
  table_hash: string;
  truncated: boolean;
  locator: WorkerLocator;
}

export interface WorkerPage {
  page_number: number;
  page_hash: string;
  classification: string;
  extraction_method: string;
  normalized_text: string;
  tables: WorkerTable[];
  ocr_used: boolean;
  truncated: boolean;
  warnings: string[];
}

export interface WorkerFailure {
  code: string;
  message: string;
  retryable: boolean;
  stage: string;
  partial_result_available: boolean;
}

export interface WorkerResult {
  worker_result_version: string;
  job_id: string;
  status: 'success' | 'partial' | 'failed';
  document: { sha256: string; byte_length: number; media_type: string; page_count: number } | null;
  pages: WorkerPage[];
  warnings: string[];
  limitations: string[];
  failure: WorkerFailure | null;
}
