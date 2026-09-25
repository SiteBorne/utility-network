-- RESULT-AUTHORIZATION-REVOCATION-01
-- Additive, local-first persisted subject revocation for the existing
-- Result Authorization release gate. A revoked subject reference is
-- global to that canonical subject (the same reference the release
-- evaluator already compares both the caller and the binding owner
-- against -- see `evaluateResultReleaseAuthorization`'s
-- `revoked_subject_refs` check), not scoped to a single operation or
-- tenant. Historical result/binding rows are neither rewritten nor
-- inferred. No raw credential, token, or other secret material is
-- stored here -- only the canonical, keyed HMAC subject reference
-- already produced by `canonicalSubjectReference`.

CREATE TABLE IF NOT EXISTS result_subject_revocations (
  subject_ref TEXT PRIMARY KEY,
  revoked_at TEXT NOT NULL,
  reason_code TEXT,
  revoking_authority TEXT
);
