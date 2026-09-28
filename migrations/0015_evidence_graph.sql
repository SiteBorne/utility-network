-- R3-A4-PROVENANCE-EVIDENCE-PRODUCTION-QUALIFICATION-55
-- Constitutional Evidence Graph storage (packages/evidence-graph).
--
-- Additive only: two new tables, their indexes and triggers. No existing
-- table, column, index or trigger is touched, and no runtime (edge or host)
-- reads or writes these tables. Old runtimes are unaffected.
--
-- Identity is content-addressed. node_id / edge_id = 'ev:' + sha256 of the
-- canonical JSON (JCS) body, computed by the writer and re-verified by every
-- reader. The body is stored verbatim in body_jcs. The projected columns are
-- CHECKed against the body so a row cannot say one thing in an indexed
-- column and another in its body.
--
-- Append-only: UPDATE and DELETE raise. Inserting an identical row again is
-- an idempotent no-op when written as INSERT ... ON CONFLICT(id) DO NOTHING.
-- Inserting a different body under an existing id raises (fail closed).
--
-- Authority: evidence never grants execution, result-release, settlement or
-- payment authority. Nodes must declare authority NONE. There is no status,
-- permit, grant or flag column, and no foreign key into any control-plane
-- table. Subjects are opaque keys.
--
-- Every object uses IF NOT EXISTS, like 0001-0012, so re-running the file
-- against an already-migrated database is a no-op.
--
-- Rollback: stop writing. Dropping the tables destroys evidence and needs
-- separate authorization.
--
-- Statement format: trigger bodies keep their inner terminator directly
-- before END so the test loaders' statement splitter can keep each trigger
-- whole. Comment lines contain no statement terminators.

CREATE TABLE IF NOT EXISTS evidence_nodes (
  node_id TEXT PRIMARY KEY CHECK (node_id GLOB 'ev:[0-9a-f]*' AND length(node_id) = 67),
  node_type TEXT NOT NULL CHECK (length(node_type) > 0),
  environment TEXT NOT NULL CHECK (environment IN ('production', 'staging', 'local')),
  subject_key TEXT NOT NULL CHECK (length(subject_key) > 0),
  recorded_at TEXT NOT NULL,
  binding TEXT NOT NULL CHECK (binding IN ('CRYPTOGRAPHICALLY_BOUND', 'PLATFORM_ATTESTED', 'OPERATOR_ATTESTED', 'INFERRED', 'UNVERIFIED', 'UNKNOWN')),
  authority TEXT NOT NULL CHECK (authority = 'NONE'),
  body_jcs TEXT NOT NULL CHECK (
    json_valid(body_jcs)
    AND json_extract(body_jcs, '$.node_type') = node_type
    AND json_extract(body_jcs, '$.environment') = environment
    AND json_extract(body_jcs, '$.subject_key') = subject_key
    AND json_extract(body_jcs, '$.recorded_at') = recorded_at
    AND json_extract(body_jcs, '$.proof.binding') = binding
    AND json_extract(body_jcs, '$.authority') = 'NONE'
    AND json_extract(body_jcs, '$.node_id') IS NULL
  ),
  inserted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS evidence_nodes_subject ON evidence_nodes (node_type, environment, subject_key);

CREATE TABLE IF NOT EXISTS evidence_edges (
  edge_id TEXT PRIMARY KEY CHECK (edge_id GLOB 'ev:[0-9a-f]*' AND length(edge_id) = 67),
  edge_type TEXT NOT NULL CHECK (length(edge_type) > 0),
  from_id TEXT NOT NULL REFERENCES evidence_nodes (node_id),
  to_id TEXT NOT NULL REFERENCES evidence_nodes (node_id),
  recorded_at TEXT NOT NULL,
  binding TEXT NOT NULL CHECK (binding IN ('CRYPTOGRAPHICALLY_BOUND', 'PLATFORM_ATTESTED', 'OPERATOR_ATTESTED', 'INFERRED', 'UNVERIFIED', 'UNKNOWN')),
  body_jcs TEXT NOT NULL CHECK (
    json_valid(body_jcs)
    AND json_extract(body_jcs, '$.edge_type') = edge_type
    AND json_extract(body_jcs, '$.from_id') = from_id
    AND json_extract(body_jcs, '$.to_id') = to_id
    AND json_extract(body_jcs, '$.recorded_at') = recorded_at
    AND json_extract(body_jcs, '$.proof.binding') = binding
    AND json_extract(body_jcs, '$.edge_id') IS NULL
  ),
  inserted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS evidence_edges_from ON evidence_edges (from_id, edge_type);

CREATE INDEX IF NOT EXISTS evidence_edges_to ON evidence_edges (to_id, edge_type);

CREATE TRIGGER IF NOT EXISTS evidence_nodes_conflict BEFORE INSERT ON evidence_nodes
WHEN EXISTS (SELECT 1 FROM evidence_nodes WHERE node_id = NEW.node_id AND body_jcs <> NEW.body_jcs)
BEGIN SELECT RAISE(ABORT, 'evidence conflict: node_id already holds different content'); END;

CREATE TRIGGER IF NOT EXISTS evidence_edges_conflict BEFORE INSERT ON evidence_edges
WHEN EXISTS (SELECT 1 FROM evidence_edges WHERE edge_id = NEW.edge_id AND body_jcs <> NEW.body_jcs)
BEGIN SELECT RAISE(ABORT, 'evidence conflict: edge_id already holds different content'); END;

CREATE TRIGGER IF NOT EXISTS evidence_edges_endpoints BEFORE INSERT ON evidence_edges
WHEN NOT EXISTS (SELECT 1 FROM evidence_nodes WHERE node_id = NEW.from_id)
  OR NOT EXISTS (SELECT 1 FROM evidence_nodes WHERE node_id = NEW.to_id)
BEGIN SELECT RAISE(ABORT, 'evidence edge references a missing node'); END;

CREATE TRIGGER IF NOT EXISTS evidence_nodes_no_update BEFORE UPDATE ON evidence_nodes
BEGIN SELECT RAISE(ABORT, 'evidence is append-only'); END;

CREATE TRIGGER IF NOT EXISTS evidence_nodes_no_delete BEFORE DELETE ON evidence_nodes
BEGIN SELECT RAISE(ABORT, 'evidence is append-only'); END;

CREATE TRIGGER IF NOT EXISTS evidence_edges_no_update BEFORE UPDATE ON evidence_edges
BEGIN SELECT RAISE(ABORT, 'evidence is append-only'); END;

CREATE TRIGGER IF NOT EXISTS evidence_edges_no_delete BEFORE DELETE ON evidence_edges
BEGIN SELECT RAISE(ABORT, 'evidence is append-only'); END;
