#!/usr/bin/env tsx

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { RECONCILIATION_CLASSIFICATIONS } from '../apps/edge-api/src/control-plane/repositories/d1/lifecycle-reconciliation';

type PlanRow = {
  payment_attempt_id: string;
  classification: (typeof RECONCILIATION_CLASSIFICATIONS)[number];
  job_id: string;
  reason_code: string;
};

const args = new Set(process.argv.slice(2));
const valueAfter = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const planPath = resolve(
  valueAfter('--plan') ?? 'scripts/data/sun1222c-legacy-17-model-c-plan.json'
);
const database = valueAfter('--database') ?? 'siteborne-utility';
const apply = args.has('--apply');
const remote = args.has('--remote');
if (apply && !remote) throw new Error('--apply requires --remote');
if (!apply && !args.has('--dry-run')) throw new Error('choose --dry-run or --apply explicitly');

const plan = JSON.parse(readFileSync(planPath, 'utf8')) as PlanRow[];
if (plan.length !== 17) throw new Error(`expected exactly 17 plan rows, found ${plan.length}`);
const ids = new Set<string>();
for (const row of plan) {
  if (ids.has(row.payment_attempt_id))
    throw new Error(`duplicate attempt ${row.payment_attempt_id}`);
  ids.add(row.payment_attempt_id);
  if (!RECONCILIATION_CLASSIFICATIONS.includes(row.classification)) {
    throw new Error(`unsupported classification ${row.classification}`);
  }
  if (!row.classification.startsWith('legacy_'))
    throw new Error('backfill accepts legacy classes only');
}

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const evidenceRef = (row: PlanRow) =>
  `docs/reports/SUN-1222C-pcc-lifecycle-backlog-reconciliation.md#attempt-${row.payment_attempt_id};d1:jobs/${row.job_id}`;
const sql = plan
  .map(
    (row, index) => `INSERT INTO payment_attempt_reconciliations (
  id, payment_attempt_id, classification, actionability, owner_kind, reason_code,
  evidence_ref, source, operator_checkpoint, metadata_json, dedupe_key, created_at
) SELECT ${quote(`recon_sun1222c_legacy_${String(index + 1).padStart(2, '0')}`)}, id,
  ${quote(row.classification)}, 'non_actionable', 'none', ${quote(row.reason_code)},
  ${quote(evidenceRef(row))}, 'operator', 'SUN-1222C-PCC-LIFECYCLE-MODEL-PRODUCTION-MIGRATION-AND-LEGACY-CLASSIFICATION',
  ${quote(JSON.stringify({ job_id: row.job_id }))},
  ${quote(`${row.payment_attempt_id}:sun1222c-model-c-v1`)}, datetime('now')
FROM payment_attempts WHERE id = ${quote(row.payment_attempt_id)}
ON CONFLICT(dedupe_key) DO NOTHING;`
  )
  .join('\n');

const preimageSql = `WITH latest_reconciliation AS (
  SELECT r.payment_attempt_id, r.classification, r.actionability, r.owner_kind,
         r.reason_code, r.evidence_ref, r.sequence
  FROM payment_attempt_reconciliations r
  JOIN (
    SELECT payment_attempt_id, MAX(sequence) AS sequence
    FROM payment_attempt_reconciliations
    GROUP BY payment_attempt_id
  ) latest ON latest.payment_attempt_id = r.payment_attempt_id
          AND latest.sequence = r.sequence
)
SELECT p.id AS payment_attempt_id, p.payment_identifier, p.lifecycle_stage,
       p.settlement_transaction_reference,
       r.classification AS effective_reconciliation_classification,
       r.actionability AS effective_reconciliation_actionability,
       r.owner_kind AS effective_reconciliation_owner_kind,
       r.reason_code AS effective_reconciliation_reason_code,
       r.evidence_ref AS effective_reconciliation_evidence_ref
FROM payment_attempts p
LEFT JOIN latest_reconciliation r ON r.payment_attempt_id = p.id
WHERE p.id IN (${plan.map((row) => quote(row.payment_attempt_id)).join(', ')})
ORDER BY p.id`;

if (remote) {
  const preimage = spawnSync(
    'npx',
    ['wrangler', 'd1', 'execute', database, '--remote', '--json', '--command', preimageSql],
    { encoding: 'utf8', shell: false }
  );
  if (preimage.status !== 0) {
    process.stderr.write(preimage.stderr || 'preimage query failed\n');
    process.exit(preimage.status ?? 1);
  }
  const payload = JSON.parse(preimage.stdout) as Array<{
    success?: boolean;
    results?: Array<Record<string, unknown>>;
  }>;
  const rows = payload.flatMap((entry) => entry.results ?? []);
  if (rows.length !== 17) {
    throw new Error(`preimage must contain exactly 17 payment attempts, found ${rows.length}`);
  }
  process.stdout.write(JSON.stringify({ preimage: rows }, null, 2) + '\n');
}

process.stdout.write(
  JSON.stringify(
    {
      mode: apply ? 'apply' : 'dry-run',
      database,
      rows: plan.map((row) => ({
        payment_attempt_id: row.payment_attempt_id,
        classification: row.classification,
        actionability: 'non_actionable',
        owner_kind: 'none',
        evidence_ref: evidenceRef(row),
      })),
    },
    null,
    2
  ) + '\n'
);

if (apply) {
  const result = spawnSync(
    'npx',
    ['wrangler', 'd1', 'execute', database, '--remote', '--command', sql],
    {
      stdio: 'inherit',
      shell: false,
    }
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
} else {
  process.stdout.write('DRY_RUN_ONLY: no D1 statement executed\n');
}
