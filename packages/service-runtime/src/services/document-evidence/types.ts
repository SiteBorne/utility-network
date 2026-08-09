export interface DocumentEvidenceInput {
  artifact_reference?: {
    artifact_id: string;
    media_type: 'application/pdf' | 'image/png' | 'image/jpeg';
    size_bytes: number;
    content_hash?: string;
  };
  upload_reference?: { upload_id: string; media_type: string; size_bytes: number };
  document_url?: string;
  extraction_request?: { extract_text?: boolean; extract_tables?: boolean };
  ocr_permission?: boolean;
}

export interface DocumentEvidenceExtension {
  document_classification?: string;
  media_type_confirmed?: string;
  size_bytes_confirmed?: number;
  total_pages?: number;
  processed_pages?: number;
  page_classifications?: Array<{
    page_number: number;
    classification: string;
    extraction_method?: string;
  }>;
  text_blocks?: Array<{ page?: number; text?: string }>;
  tables?: Array<{ page?: number; table_index?: number; headers?: string[]; rows?: string[][] }>;
  ocr_confidence?: Array<{ page: number; mean_confidence?: number }>;
  page_warnings?: Array<{ page?: number; warning?: string }>;
  limitations?: string[];
}
