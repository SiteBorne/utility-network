# SITEBORNE Modal Worker (Foundation)

This is the **foundation** package for the Modal worker. In SUN-0001, only the
basic structure is implemented:

- Typed health model (`modal_worker.health`)
- Configuration validation (`modal_worker.config`)
- Deterministic local tests

## Not Yet Implemented (Future Increments)

- Modal deployment (`modal.App`, `modal.Function`)
- Document processing dependencies:
  - `docling` for PDF parsing
  - `pymupdf` / `pdfplumber` for PDF extraction
  - `tesseract` / `ocrmypdf` for OCR
  - `polars` / `duckdb` for data processing
- Heavy compute workers for:
  - Document evidence JSON
  - PDF rendering
  - Table extraction
  - Batch normalization

## Running Tests

```bash
cd services/modal-worker
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
python -m pytest
ruff .
mypy .
```

## Modal Deployment

Modal deployment is **not configured** in SUN-0001. The `wrangler.toml` and
GitHub Actions will be updated in later increments when:

1. Modal account is created and tokens obtained (blocked_external)
2. Document processing requirements are finalized
3. Integration tests with edge-api are written

## Configuration

Environment variables (not set in SUN-0001):

- `MODAL_TOKEN_ID` — Modal authentication token ID
- `MODAL_TOKEN_SECRET` — Modal authentication token secret

See `modal_worker.config.load_config()` and `validate_config()`.
