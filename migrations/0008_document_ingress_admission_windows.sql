-- SITEBORNE Utility Network - D1 Migrations
-- Migration 0008: document-ingress distributed admission-control windows
-- (SUN-1222C0-R1)
--
-- Closes the storage-abuse gap SUN-1222C0 identified and deliberately left
-- open (UNBOUNDED_UNPAID_STORAGE_PATHS=1): `POST /v2/artifacts/documents`
-- had no distributed per-source or aggregate admission limit, so an
-- anonymous, unpaid caller could accumulate unbounded R2/D1 storage.
--
-- One row per (scope, fixed window) pair -- `scope` is either `"source"`
-- (per-caller, keyed further by `window_key`'s own normalized-source
-- suffix) or the fixed literal `"global"`. See
-- `apps/edge-api/src/control-plane/artifacts/document-ingress-admission-
-- control.ts` for the window-bucketing/key-construction logic, and
-- `apps/edge-api/src/control-plane/repositories/d1/document-ingress-
-- admission.ts` for why the single `INSERT ... ON CONFLICT DO UPDATE ...
-- WHERE count < ?` statement against this table is genuinely atomic under
-- concurrent callers (SQLite's single-writer serialization for the
-- underlying D1 database), not merely "eventually consistent".
--
-- Deliberately NOT reusing `job_artifacts` or any existing table: this
-- data has a completely different lifecycle (tiny rows, high write
-- frequency, opportunistic self-cleanup every request) from every other
-- table in this schema, and mixing concerns would make both harder to
-- reason about. Rows are self-cleaned by the application (never
-- unbounded) -- see that module's `deleteWindowsOlderThan` doc comment.
CREATE TABLE IF NOT EXISTS document_ingress_admission_windows (
  window_key TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  window_start_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_document_ingress_admission_windows_start
  ON document_ingress_admission_windows (window_start_ms);
