-- RESULT-AUTHORIZATION-ENFORCEMENT-01
-- Additive, local-first result ownership and finalized-resource authority.
-- Historical result/payment rows are neither rewritten nor inferred.

CREATE TABLE IF NOT EXISTS result_subject_bindings (
  binding_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE,
  operation_scope_ref TEXT NOT NULL,
  owner_subject_ref TEXT NOT NULL,
  binding_policy_version TEXT NOT NULL,
  creation_authority TEXT NOT NULL,
  created_at TEXT NOT NULL,
  authority_context_id TEXT NOT NULL,
  policy_evaluation_id TEXT NOT NULL,
  FOREIGN KEY (operation_id) REFERENCES jobs(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_result_subject_bindings_owner
  ON result_subject_bindings(owner_subject_ref);

CREATE TABLE IF NOT EXISTS result_resources (
  result_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE,
  artifact_id TEXT NOT NULL UNIQUE,
  pcc_document_hash TEXT NOT NULL UNIQUE,
  service_id TEXT NOT NULL,
  service_version TEXT NOT NULL,
  contract_release TEXT NOT NULL,
  confidentiality_class TEXT NOT NULL CHECK (confidentiality_class IN ('PUBLIC', 'BUYER_AUTHORIZED')),
  binding_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  FOREIGN KEY (operation_id) REFERENCES jobs(id) ON DELETE RESTRICT,
  FOREIGN KEY (binding_id) REFERENCES result_subject_bindings(binding_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_result_resources_service
  ON result_resources(service_id, service_version);
