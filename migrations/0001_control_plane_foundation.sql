-- SITEBORNE Utility Network - D1 Migrations
-- Migration 0001: Control Plane Foundation Tables

-- Services table
CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  input_schema TEXT NOT NULL,
  output_schema TEXT NOT NULL,
  price_usd TEXT NOT NULL,
  production_enabled INTEGER NOT NULL DEFAULT 0,
  production_ready INTEGER NOT NULL DEFAULT 0,
  protocol_status TEXT NOT NULL DEFAULT 'preproduction',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_services_id ON services(id);

-- Service versions table
CREATE TABLE IF NOT EXISTS service_versions (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL,
  version TEXT NOT NULL,
  input_schema_hash TEXT NOT NULL,
  output_schema_hash TEXT NOT NULL,
  contract_release TEXT NOT NULL,
  pcc_dependency TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deprecated_at TEXT,
  FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_service_versions_service_version ON service_versions(service_id, version);
CREATE INDEX IF NOT EXISTS idx_service_versions_service_id ON service_versions(service_id);

-- Jobs table
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  service_version TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  input_schema_hash TEXT NOT NULL,
  output_schema_hash TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  contract_release TEXT NOT NULL,
  pcc_dependency TEXT NOT NULL,
  current_state TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_authorized_cost TEXT,
  production_enabled INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (service_id) REFERENCES services(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_idempotency_key ON jobs(idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_marketplace_external ON jobs(service_id, request_id);
CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs(current_state);
CREATE INDEX IF NOT EXISTS idx_jobs_expires ON jobs(expires_at);
CREATE INDEX IF NOT EXISTS idx_jobs_service ON jobs(service_id);
CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at);

-- Job attempts table
CREATE TABLE IF NOT EXISTS job_attempts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  state TEXT NOT NULL,
  input_artifact_ref TEXT,
  output_artifact_ref TEXT,
  error_code TEXT,
  error_message TEXT,
  dispatched_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  worker_id TEXT,
  trace_context TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_job_attempts_job_attempt ON job_attempts(job_id, attempt_number);
CREATE INDEX IF NOT EXISTS idx_job_attempts_job_id ON job_attempts(job_id);
CREATE INDEX IF NOT EXISTS idx_job_attempts_state ON job_attempts(state);

-- Job state events table
CREATE TABLE IF NOT EXISTS job_state_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor TEXT NOT NULL,
  evidence_ref TEXT,
  previous_state_hash TEXT,
  timestamp TEXT NOT NULL,
  attempt_hash TEXT,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_job_state_events_job_id ON job_state_events(job_id);
CREATE INDEX IF NOT EXISTS idx_job_state_events_attempt ON job_state_events(job_id, attempt_number);
CREATE INDEX IF NOT EXISTS idx_job_state_events_timestamp ON job_state_events(timestamp);

-- Idempotency records table
CREATE TABLE IF NOT EXISTS idempotency_records (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL,
  service_id TEXT NOT NULL,
  service_version TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  input_schema_hash TEXT NOT NULL,
  requester_identity_class TEXT,
  quote_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  original_job_id TEXT NOT NULL,
  original_result_ref TEXT,
  FOREIGN KEY (original_job_id) REFERENCES jobs(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_idempotency_key ON idempotency_records(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_records(expires_at);
CREATE INDEX IF NOT EXISTS idx_idempotency_service ON idempotency_records(service_id, service_version);
CREATE INDEX IF NOT EXISTS idx_idempotency_input ON idempotency_records(input_hash, input_schema_hash);

-- Payment quotes table (for future compatibility)
CREATE TABLE IF NOT EXISTS payment_quotes (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  service_version TEXT NOT NULL,
  amount_usd TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'pending',
  payment_method TEXT,
  facilitator TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  verified_at TEXT,
  settled_at TEXT,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_payment_quotes_job_id ON payment_quotes(job_id);
CREATE INDEX IF NOT EXISTS idx_payment_quotes_status ON payment_quotes(status);
CREATE INDEX IF NOT EXISTS idx_payment_quotes_expires ON payment_quotes(expires_at);

-- Quota reservations table
CREATE TABLE IF NOT EXISTS quota_reservations (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  resource_class TEXT NOT NULL,
  requested_units INTEGER NOT NULL,
  remaining_units INTEGER NOT NULL,
  reserved_units INTEGER NOT NULL,
  replacement_cost TEXT NOT NULL,
  scarcity_multiplier TEXT NOT NULL,
  failure_risk_multiplier TEXT NOT NULL,
  max_authorized_cost TEXT NOT NULL,
  paid_overflow_enabled INTEGER NOT NULL DEFAULT 0,
  reserved_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  released_at TEXT,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_quota_job_id ON quota_reservations(job_id);
CREATE INDEX IF NOT EXISTS idx_quota_resource_class ON quota_reservations(resource_class);
CREATE INDEX IF NOT EXISTS idx_quota_expires ON quota_reservations(expires_at);

-- Job artifacts table
CREATE TABLE IF NOT EXISTS job_artifacts (
  id TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL,
  media_type TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  authorization_class TEXT NOT NULL DEFAULT 'private',
  retention_class TEXT NOT NULL DEFAULT 'standard',
  job_id TEXT,
  artifact_type TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_artifacts_content_hash ON job_artifacts(content_hash);
CREATE INDEX IF NOT EXISTS idx_artifacts_job_id ON job_artifacts(job_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_expires ON job_artifacts(expires_at);
CREATE INDEX IF NOT EXISTS idx_artifacts_type ON job_artifacts(artifact_type);

-- Queue dispatches table
CREATE TABLE IF NOT EXISTS queue_dispatches (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  service_id TEXT NOT NULL,
  service_version TEXT NOT NULL,
  input_artifact_ref TEXT NOT NULL,
  contract_hash TEXT NOT NULL,
  trace_context TEXT NOT NULL,
  dispatched_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dispatches_job_attempt ON queue_dispatches(job_id, attempt_number);
CREATE INDEX IF NOT EXISTS idx_dispatches_job_id ON queue_dispatches(job_id);
CREATE INDEX IF NOT EXISTS idx_dispatches_expires ON queue_dispatches(expires_at);
CREATE INDEX IF NOT EXISTS idx_dispatches_retry ON queue_dispatches(retry_count);

-- Audit events table
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  job_id TEXT,
  attempt_number INTEGER,
  service_id TEXT,
  actor TEXT NOT NULL,
  details TEXT NOT NULL,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  correlation_id TEXT,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_job_id ON audit_events(job_id);
CREATE INDEX IF NOT EXISTS idx_audit_correlation ON audit_events(correlation_id);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_type ON audit_events(event_type);

-- Security events table
CREATE TABLE IF NOT EXISTS security_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  job_id TEXT,
  attempt_number INTEGER,
  service_id TEXT,
  details TEXT NOT NULL,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  correlation_id TEXT,
  severity TEXT NOT NULL DEFAULT 'medium',
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_security_job_id ON security_events(job_id);
CREATE INDEX IF NOT EXISTS idx_security_correlation ON security_events(correlation_id);
CREATE INDEX IF NOT EXISTS idx_security_timestamp ON security_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_security_type ON security_events(event_type);
CREATE INDEX IF NOT EXISTS idx_security_severity ON security_events(severity);