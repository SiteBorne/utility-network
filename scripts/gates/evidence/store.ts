/**
 * Bounded, gitignored, candidate-neutral evidence storage. No evidence
 * database, no CI system — one small JSON file per dynamic gate.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EvidenceGateId, EvidenceRecord } from './types.js';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
export const EVIDENCE_DIR = join(REPO_ROOT, '.release-evidence');

function evidencePath(gateId: EvidenceGateId): string {
  return join(EVIDENCE_DIR, `${gateId}.json`);
}

export function writeEvidence(record: EvidenceRecord): void {
  if (!existsSync(EVIDENCE_DIR)) mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(evidencePath(record.gate_id), JSON.stringify(record, null, 2));
}

export function readEvidence(gateId: EvidenceGateId): unknown {
  const path = evidencePath(gateId);
  if (!existsSync(path)) return undefined;
  const raw = readFileSync(path, 'utf8');
  return JSON.parse(raw);
}
