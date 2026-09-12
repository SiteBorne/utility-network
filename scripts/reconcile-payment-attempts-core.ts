import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

export const OPERATOR_CHECKPOINT =
  'SUN-1222C-PCC-MODEL-C-PRODUCTION-MIGRATION-AND-LEGACY-CLASSIFICATION';

const legacyClassificationSchema = z.enum([
  'legacy_execution_failed_unsettled',
  'legacy_verified_unrouted_unsettled',
  'legacy_execution_outcome_unknown',
  'legacy_settled_external_finalization_incomplete',
]);

const evidenceRefSchema = z
  .string()
  .regex(/^git-evidence:v1:[0-9a-f]{40}:docs\/evidence\/[A-Za-z0-9._/-]+\.json#[A-Za-z0-9._-]+$/);

export const governedPlanRowSchema = z
  .object({
    sequence: z.number().int().min(1).max(17),
    payment_attempt_id: z.string().uuid(),
    expected_service_id: z.string().min(1),
    expected_lifecycle_stage: z.string().min(1),
    expected_payment_identifier_sha256: z.string().regex(/^[0-9a-f]{64}$/),
    expected_correlated_job_id: z.string().uuid(),
    expected_correlated_job_state: z.string().min(1),
    expected_settlement_reference_present: z.boolean(),
    expected_created_at: z.string().datetime({ offset: true }),
    classification: legacyClassificationSchema,
    reason_code: z.string().min(1),
    evidence_ref: evidenceRefSchema,
    actionability: z.literal('non_actionable'),
    owner_kind: z.literal('none'),
    cutover_blocking_after_review: z.literal(false),
    reconciliation_id: z.string().regex(/^recon_sun1222c_legacy_\d{2}$/),
    dedupe_key: z.string().regex(/^[0-9a-f-]{36}:sun1222c-model-c-v1$/),
  })
  .strict();

export type GovernedPlanRow = z.infer<typeof governedPlanRowSchema>;

const governedPlanSchema = z
  .array(governedPlanRowSchema)
  .length(17)
  .superRefine((rows, context) => {
    const uniqueFields: Array<keyof GovernedPlanRow> = [
      'sequence',
      'payment_attempt_id',
      'expected_payment_identifier_sha256',
      'expected_correlated_job_id',
      'evidence_ref',
      'reconciliation_id',
      'dedupe_key',
    ];
    for (const field of uniqueFields) {
      if (new Set(rows.map((row) => row[field])).size !== rows.length) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate ${field}` });
      }
    }
    for (const [index, row] of rows.entries()) {
      if (row.sequence !== index + 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `plan sequence must be canonical 1..17; row ${index + 1} is ${row.sequence}`,
        });
      }
      const expectsSettlement =
        row.classification === 'legacy_settled_external_finalization_incomplete';
      if (row.expected_settlement_reference_present !== expectsSettlement) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `contradictory settlement expectation for sequence ${row.sequence}`,
        });
      }
      if (row.dedupe_key !== `${row.payment_attempt_id}:sun1222c-model-c-v1`) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `dedupe key does not bind sequence ${row.sequence} to its attempt`,
        });
      }
      if (
        row.reconciliation_id !== `recon_sun1222c_legacy_${String(row.sequence).padStart(2, '0')}`
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `reconciliation id does not bind sequence ${row.sequence}`,
        });
      }
    }
  });

type EvidenceEntry = {
  evidence_id: string;
  payment_attempt_id: string;
  correlated_job_id: string;
  classification: string;
  reason_code: string;
};

const evidenceIndexSchema = z
  .object({
    schema_version: z.literal('sun1222c-legacy-evidence-v1'),
    source_forensic_commit: z.string().regex(/^[0-9a-f]{40}$/),
    source_report: z.string().min(1),
    entries: z.array(
      z
        .object({
          evidence_id: z.string().min(1),
          payment_attempt_id: z.string().uuid(),
          correlated_job_id: z.string().uuid(),
          classification: legacyClassificationSchema,
          reason_code: z.string().min(1),
        })
        .strict()
    ),
  })
  .strict();

export type EvidenceResolution = {
  ok: boolean;
  error?: string;
  entry?: EvidenceEntry;
};

export function resolveEvidenceReference(
  evidenceRef: string,
  row: GovernedPlanRow,
  repositoryRoot: string
): EvidenceResolution {
  const match =
    /^git-evidence:v1:([0-9a-f]{40}):(docs\/evidence\/[A-Za-z0-9._/-]+\.json)#([A-Za-z0-9._-]+)$/.exec(
      evidenceRef
    );
  if (!match) return { ok: false, error: 'malformed or unsupported evidence reference' };
  const [, commit, path, evidenceId] = match;
  if (path.includes('..')) return { ok: false, error: 'unsupported evidence location' };
  try {
    execFileSync('git', ['cat-file', '-e', `${commit}^{commit}`], {
      cwd: repositoryRoot,
      stdio: 'ignore',
    });
    const raw = execFileSync('git', ['show', `${commit}:${path}`], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const index = evidenceIndexSchema.parse(JSON.parse(raw));
    const matches = index.entries.filter((entry) => entry.evidence_id === evidenceId);
    if (matches.length !== 1) {
      return { ok: false, error: `evidence target count is ${matches.length}, expected 1` };
    }
    const entry = matches[0];
    if (
      entry.payment_attempt_id !== row.payment_attempt_id ||
      entry.correlated_job_id !== row.expected_correlated_job_id ||
      entry.classification !== row.classification ||
      entry.reason_code !== row.reason_code
    ) {
      return { ok: false, error: 'evidence content does not match governed row' };
    }
    return { ok: true, entry };
  } catch {
    return { ok: false, error: 'commit-pinned evidence object could not be resolved' };
  }
}

export function parseGovernedPlan(raw: unknown): GovernedPlanRow[] {
  return governedPlanSchema.parse(raw);
}

export function loadGovernedPlan(planPath: string): GovernedPlanRow[] {
  return parseGovernedPlan(JSON.parse(readFileSync(resolve(planPath), 'utf8')));
}

export type OperatorDatabase = {
  query(sql: string): Promise<Array<Record<string, unknown>>>;
  batch(sql: readonly string[]): Promise<{ changes: number[] }>;
};

export type PreimageStatus = {
  sequence: number;
  payment_attempt_id: string;
  attempt_exists: boolean;
  service_match: boolean;
  lifecycle_stage_match: boolean;
  payment_identifier_fingerprint_match: boolean;
  correlated_job_count: number;
  correlated_job_id_match: boolean;
  correlated_job_state_match: boolean;
  settlement_reference_presence_match: boolean;
  created_at_match: boolean;
  evidence_ref_resolves: boolean;
  expected_classification_valid: boolean;
  preexisting_reconciliation_status:
    | 'NONE'
    | 'EXACT_EXPECTED_EVENT_PRESENT'
    | 'CONFLICTING_EVENT_PRESENT'
    | 'MULTIPLE_OR_AMBIGUOUS_EFFECTIVE_STATE'
    | 'SCHEMA_MISSING';
  preimage_match: boolean;
};

export type OperatorSummary = {
  mode: 'dry-run' | 'apply';
  database: string;
  remote: boolean;
  whole_plan_state: 'FRESH_APPLY' | 'EXACT_IDEMPOTENT_NOOP' | 'CONFLICT';
  reconciliation_apply_ready: 'YES' | 'NO_SCHEMA_MISSING' | 'NO_PLAN_CONFLICT';
  rows_planned: 17;
  rows_to_insert: number;
  rows_already_reconciled: number;
  rows_with_preimage_match: number;
  preimage_conflicts: number;
  evidence_ref_failures: number;
  planned_mutations: number;
  actual_insert_count: number;
  post_apply_exact_expected_event_count: number;
  no_mutation_required: boolean;
  payment_attempt_updates_planned: 0;
  payment_attempt_deletions_planned: 0;
  owner_intents_planned: 0;
  workflow_creations_planned: 0;
  economic_actions_planned: 0;
  rows: PreimageStatus[];
};

type ObservedPreimage = {
  payment_identifier?: string;
  rows: Array<Record<string, unknown>>;
};

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const boolNumber = (value: boolean) => (value ? 1 : 0);
const paymentIdentifierHash = (value: string) =>
  createHash('sha256').update(value, 'utf8').digest('hex');

function schemaReadinessSql(): string {
  return `SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN ('payment_attempt_reconciliations', 'payment_workflow_owner_intents') ORDER BY name`;
}

export function buildPreimageSql(plan: readonly GovernedPlanRow[]): string {
  return `SELECT p.id AS payment_attempt_id,
       p.service_id,
       p.lifecycle_stage,
       p.payment_identifier,
       p.created_at,
       CASE WHEN p.settlement_transaction_reference IS NULL OR p.settlement_transaction_reference = '' THEN 0 ELSE 1 END AS settlement_reference_present,
       j.id AS correlated_job_id,
       j.current_state AS correlated_job_state
FROM payment_attempts p
LEFT JOIN jobs j ON j.idempotency_key = p.payment_identifier
WHERE p.id IN (${plan.map((row) => quote(row.payment_attempt_id)).join(', ')})
ORDER BY p.id, j.id`;
}

function buildReconciliationSql(plan: readonly GovernedPlanRow[]): string {
  return `SELECT sequence, id, payment_attempt_id, classification, actionability, owner_kind,
       owner_reference, reason_code, evidence_ref, source,
       supersedes_reconciliation_id, operator_checkpoint, metadata_json,
       dedupe_key, created_at
FROM payment_attempt_reconciliations
WHERE payment_attempt_id IN (${plan.map((row) => quote(row.payment_attempt_id)).join(', ')})
   OR id IN (${plan.map((row) => quote(row.reconciliation_id)).join(', ')})
   OR dedupe_key IN (${plan.map((row) => quote(row.dedupe_key)).join(', ')})
ORDER BY sequence`;
}

function expectedMetadata(row: GovernedPlanRow): string {
  return JSON.stringify({ job_id: row.expected_correlated_job_id });
}

function reconciliationMatches(row: GovernedPlanRow, observed: Record<string, unknown>): boolean {
  return (
    observed.id === row.reconciliation_id &&
    observed.payment_attempt_id === row.payment_attempt_id &&
    observed.classification === row.classification &&
    observed.actionability === row.actionability &&
    observed.owner_kind === row.owner_kind &&
    observed.owner_reference == null &&
    observed.reason_code === row.reason_code &&
    observed.evidence_ref === row.evidence_ref &&
    observed.source === 'operator' &&
    observed.supersedes_reconciliation_id == null &&
    observed.operator_checkpoint === OPERATOR_CHECKPOINT &&
    observed.metadata_json === expectedMetadata(row) &&
    observed.dedupe_key === row.dedupe_key
  );
}

async function analyze(
  database: OperatorDatabase,
  plan: readonly GovernedPlanRow[],
  repositoryRoot: string,
  mode: 'dry-run' | 'apply',
  databaseName: string,
  remote: boolean
): Promise<{ summary: OperatorSummary; observed: Map<string, ObservedPreimage> }> {
  const evidence = plan.map((row) =>
    resolveEvidenceReference(row.evidence_ref, row, repositoryRoot)
  );
  const evidenceFailures = evidence.filter((result) => !result.ok).length;
  const schemaRows = await database.query(schemaReadinessSql());
  const tableNames = new Set(schemaRows.map((row) => String(row.name)));
  const reconciliationSchemaReady = tableNames.has('payment_attempt_reconciliations');
  const preimageRows = await database.query(buildPreimageSql(plan));
  const observedByAttempt = new Map<string, ObservedPreimage>();
  for (const row of preimageRows) {
    const id = String(row.payment_attempt_id);
    const observed = observedByAttempt.get(id) ?? { rows: [] };
    observed.rows.push(row);
    if (typeof row.payment_identifier === 'string')
      observed.payment_identifier = row.payment_identifier;
    observedByAttempt.set(id, observed);
  }
  const reconciliationRows = reconciliationSchemaReady
    ? await database.query(buildReconciliationSql(plan))
    : [];

  const statuses: PreimageStatus[] = plan.map((row, index) => {
    const observed = observedByAttempt.get(row.payment_attempt_id);
    const attemptRows = observed?.rows ?? [];
    const attemptExists = attemptRows.length > 0;
    const first = attemptRows[0] ?? {};
    const correlatedJobCount = attemptRows.filter((item) => item.correlated_job_id != null).length;
    const serviceMatch = attemptExists && first.service_id === row.expected_service_id;
    const lifecycleMatch = attemptExists && first.lifecycle_stage === row.expected_lifecycle_stage;
    const paymentHashMatch =
      typeof observed?.payment_identifier === 'string' &&
      paymentIdentifierHash(observed.payment_identifier) === row.expected_payment_identifier_sha256;
    const jobIdMatch =
      correlatedJobCount === 1 && first.correlated_job_id === row.expected_correlated_job_id;
    const jobStateMatch =
      correlatedJobCount === 1 && first.correlated_job_state === row.expected_correlated_job_state;
    const settlementPresenceMatch =
      attemptExists &&
      Number(first.settlement_reference_present) ===
        boolNumber(row.expected_settlement_reference_present);
    const createdAtMatch = attemptExists && first.created_at === row.expected_created_at;
    const relevantReconciliations = reconciliationRows.filter(
      (item) =>
        item.payment_attempt_id === row.payment_attempt_id ||
        item.id === row.reconciliation_id ||
        item.dedupe_key === row.dedupe_key
    );
    let existingStatus: PreimageStatus['preexisting_reconciliation_status'];
    if (!reconciliationSchemaReady) existingStatus = 'SCHEMA_MISSING';
    else if (relevantReconciliations.length === 0) existingStatus = 'NONE';
    else if (
      relevantReconciliations.length === 1 &&
      reconciliationMatches(row, relevantReconciliations[0])
    ) {
      existingStatus = 'EXACT_EXPECTED_EVENT_PRESENT';
    } else if (relevantReconciliations.length === 1) existingStatus = 'CONFLICTING_EVENT_PRESENT';
    else existingStatus = 'MULTIPLE_OR_AMBIGUOUS_EFFECTIVE_STATE';
    const preimageMatch =
      attemptExists &&
      serviceMatch &&
      lifecycleMatch &&
      paymentHashMatch &&
      correlatedJobCount === 1 &&
      jobIdMatch &&
      jobStateMatch &&
      settlementPresenceMatch &&
      createdAtMatch &&
      evidence[index].ok;
    return {
      sequence: row.sequence,
      payment_attempt_id: row.payment_attempt_id,
      attempt_exists: attemptExists,
      service_match: serviceMatch,
      lifecycle_stage_match: lifecycleMatch,
      payment_identifier_fingerprint_match: paymentHashMatch,
      correlated_job_count: correlatedJobCount,
      correlated_job_id_match: jobIdMatch,
      correlated_job_state_match: jobStateMatch,
      settlement_reference_presence_match: settlementPresenceMatch,
      created_at_match: createdAtMatch,
      evidence_ref_resolves: evidence[index].ok,
      expected_classification_valid: true,
      preexisting_reconciliation_status: existingStatus,
      preimage_match: preimageMatch,
    };
  });

  const rowsWithPreimageMatch = statuses.filter((row) => row.preimage_match).length;
  const rowsAlreadyReconciled = statuses.filter(
    (row) => row.preexisting_reconciliation_status === 'EXACT_EXPECTED_EVENT_PRESENT'
  ).length;
  const fresh =
    reconciliationSchemaReady &&
    evidenceFailures === 0 &&
    rowsWithPreimageMatch === 17 &&
    statuses.every((row) => row.preexisting_reconciliation_status === 'NONE');
  const noop =
    reconciliationSchemaReady &&
    evidenceFailures === 0 &&
    rowsWithPreimageMatch === 17 &&
    rowsAlreadyReconciled === 17 &&
    statuses.every(
      (row) => row.preexisting_reconciliation_status === 'EXACT_EXPECTED_EVENT_PRESENT'
    );
  const wholePlanState = fresh ? 'FRESH_APPLY' : noop ? 'EXACT_IDEMPOTENT_NOOP' : 'CONFLICT';
  const preimageConflicts = statuses.filter((row) => !row.preimage_match).length;
  const summary: OperatorSummary = {
    mode,
    database: databaseName,
    remote,
    whole_plan_state: wholePlanState,
    reconciliation_apply_ready: !reconciliationSchemaReady
      ? 'NO_SCHEMA_MISSING'
      : wholePlanState === 'CONFLICT'
        ? 'NO_PLAN_CONFLICT'
        : 'YES',
    rows_planned: 17,
    rows_to_insert: fresh ? 17 : 0,
    rows_already_reconciled: rowsAlreadyReconciled,
    rows_with_preimage_match: rowsWithPreimageMatch,
    preimage_conflicts: preimageConflicts,
    evidence_ref_failures: evidenceFailures,
    planned_mutations: fresh ? 17 : 0,
    actual_insert_count: 0,
    post_apply_exact_expected_event_count: rowsAlreadyReconciled,
    no_mutation_required: noop,
    payment_attempt_updates_planned: 0,
    payment_attempt_deletions_planned: 0,
    owner_intents_planned: 0,
    workflow_creations_planned: 0,
    economic_actions_planned: 0,
    rows: statuses,
  };
  return { summary, observed: observedByAttempt };
}

function buildAssertedInsertSql(row: GovernedPlanRow, paymentIdentifier: string): string {
  const expectedSettlementPredicate = row.expected_settlement_reference_present
    ? `p.settlement_transaction_reference IS NOT NULL AND p.settlement_transaction_reference <> ''`
    : `(p.settlement_transaction_reference IS NULL OR p.settlement_transaction_reference = '')`;
  const precondition = `(SELECT COUNT(*)
    FROM payment_attempts p
    JOIN jobs j ON j.idempotency_key = p.payment_identifier
    WHERE p.id = ${quote(row.payment_attempt_id)}
      AND p.service_id = ${quote(row.expected_service_id)}
      AND p.lifecycle_stage = ${quote(row.expected_lifecycle_stage)}
      AND p.payment_identifier = ${quote(paymentIdentifier)}
      AND p.created_at = ${quote(row.expected_created_at)}
      AND j.id = ${quote(row.expected_correlated_job_id)}
      AND j.current_state = ${quote(row.expected_correlated_job_state)}
      AND ${expectedSettlementPredicate}) = 1
    AND (SELECT COUNT(*) FROM jobs WHERE idempotency_key = ${quote(paymentIdentifier)}) = 1
    AND (SELECT COUNT(*) FROM payment_attempt_reconciliations
         WHERE payment_attempt_id = ${quote(row.payment_attempt_id)}
            OR id = ${quote(row.reconciliation_id)}
            OR dedupe_key = ${quote(row.dedupe_key)}) = 0`;
  return `INSERT INTO payment_attempt_reconciliations (
  id, payment_attempt_id, classification, actionability, owner_kind,
  owner_reference, reason_code, evidence_ref, source,
  supersedes_reconciliation_id, operator_checkpoint, metadata_json,
  dedupe_key, created_at
) SELECT
  CASE WHEN ${precondition} THEN ${quote(row.reconciliation_id)} ELSE NULL END,
  ${quote(row.payment_attempt_id)}, ${quote(row.classification)}, ${quote(row.actionability)},
  ${quote(row.owner_kind)}, NULL, ${quote(row.reason_code)}, ${quote(row.evidence_ref)},
  'operator', NULL, ${quote(OPERATOR_CHECKPOINT)}, ${quote(expectedMetadata(row))},
  ${quote(row.dedupe_key)}, datetime('now')`;
}

export async function runOperator(options: {
  database: OperatorDatabase;
  plan: readonly GovernedPlanRow[];
  repositoryRoot: string;
  databaseName: string;
  remote: boolean;
  mode: 'dry-run' | 'apply';
}): Promise<OperatorSummary> {
  const plan = parseGovernedPlan(options.plan);
  const before = await analyze(
    options.database,
    plan,
    options.repositoryRoot,
    options.mode,
    options.databaseName,
    options.remote
  );
  if (options.mode === 'dry-run') return before.summary;
  if (before.summary.whole_plan_state === 'EXACT_IDEMPOTENT_NOOP') {
    return before.summary;
  }
  if (before.summary.whole_plan_state !== 'FRESH_APPLY') {
    throw new Error(
      `apply blocked: ${before.summary.reconciliation_apply_ready}; whole plan is ${before.summary.whole_plan_state}`
    );
  }
  const statements = plan.map((row) => {
    const identifier = before.observed.get(row.payment_attempt_id)?.payment_identifier;
    if (!identifier)
      throw new Error(`missing validated payment identifier for sequence ${row.sequence}`);
    return buildAssertedInsertSql(row, identifier);
  });
  const batchResult = await options.database.batch(statements);
  const actualInsertCount = batchResult.changes.reduce((sum, value) => sum + value, 0);
  const after = await analyze(
    options.database,
    plan,
    options.repositoryRoot,
    options.mode,
    options.databaseName,
    options.remote
  );
  if (
    actualInsertCount !== 17 ||
    after.summary.whole_plan_state !== 'EXACT_IDEMPOTENT_NOOP' ||
    after.summary.rows_already_reconciled !== 17
  ) {
    throw new Error(
      `post-apply assertion failed: changes=${actualInsertCount}, state=${after.summary.whole_plan_state}, exact=${after.summary.rows_already_reconciled}`
    );
  }
  return {
    ...after.summary,
    mode: 'apply',
    actual_insert_count: actualInsertCount,
    post_apply_exact_expected_event_count: 17,
  };
}
