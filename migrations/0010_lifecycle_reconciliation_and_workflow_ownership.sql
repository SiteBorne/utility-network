-- SUN-1222C Model C: additive reconciliation history, durable Workflow owner
-- intents, and durable PaymentServiceLink/receipt correlation evidence.
-- No existing payment_attempt row or lifecycle_stage is rewritten.

CREATE TABLE IF NOT EXISTS payment_attempt_reconciliations (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  payment_attempt_id TEXT NOT NULL,
  classification TEXT NOT NULL CHECK (classification IN (
    'legacy_execution_failed_unsettled',
    'legacy_verified_unrouted_unsettled',
    'legacy_execution_outcome_unknown',
    'legacy_settled_external_finalization_incomplete',
    'active_workflow_owned',
    'current_execution_failed_unsettled',
    'current_settlement_finalization_unresolved',
    'unreconciled'
  )),
  actionability TEXT NOT NULL CHECK (actionability IN ('actionable', 'non_actionable')),
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('workflow', 'owner_intent', 'none')),
  owner_reference TEXT,
  reason_code TEXT NOT NULL,
  evidence_ref TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('operator', 'workflow', 'owner_recovery')),
  supersedes_reconciliation_id TEXT,
  operator_checkpoint TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  dedupe_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  FOREIGN KEY (payment_attempt_id) REFERENCES payment_attempts(id),
  FOREIGN KEY (supersedes_reconciliation_id) REFERENCES payment_attempt_reconciliations(id)
);

CREATE INDEX IF NOT EXISTS idx_payment_attempt_reconciliations_effective
  ON payment_attempt_reconciliations(payment_attempt_id, sequence DESC);

CREATE TABLE IF NOT EXISTS payment_workflow_owner_intents (
  id TEXT PRIMARY KEY,
  payment_attempt_id TEXT NOT NULL UNIQUE,
  payment_identifier TEXT NOT NULL UNIQUE,
  workflow_instance_id TEXT NOT NULL UNIQUE,
  workflow_input_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'workflow_created', 'completed', 'retry_exhausted')),
  dispatch_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (dispatch_attempt_count >= 0),
  last_attempt_at TEXT,
  next_attempt_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (payment_attempt_id) REFERENCES payment_attempts(id)
);

CREATE INDEX IF NOT EXISTS idx_payment_workflow_owner_intents_recovery
  ON payment_workflow_owner_intents(status, next_attempt_at, created_at);

CREATE TABLE IF NOT EXISTS payment_service_link_evidence (
  payment_attempt_id TEXT PRIMARY KEY,
  payment_identifier TEXT NOT NULL UNIQUE,
  job_id TEXT NOT NULL,
  link_id TEXT NOT NULL UNIQUE,
  link_hash TEXT NOT NULL,
  payment_service_link_json TEXT NOT NULL,
  settlement_transaction_reference TEXT NOT NULL,
  settlement_evidence_hash TEXT NOT NULL,
  service_output_hash TEXT NOT NULL,
  verification_receipt_id TEXT NOT NULL,
  verification_receipt_hash TEXT NOT NULL,
  verification_evidence_hash TEXT NOT NULL,
  buyer_receipt_id TEXT NOT NULL,
  buyer_receipt_hash TEXT NOT NULL,
  signing_key_id TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  settled_at TEXT,
  FOREIGN KEY (payment_attempt_id) REFERENCES payment_attempts(id)
);
