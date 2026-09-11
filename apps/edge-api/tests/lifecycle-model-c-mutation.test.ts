import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type Sources = {
  ownerIntent: string;
  ownerRecovery: string;
  handoff: string;
  route: string;
  workflow: string;
  finalization: string;
  reconciliation: string;
};

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const baseline: Sources = {
  ownerIntent: read('../src/control-plane/repositories/d1/workflow-owner-intents.ts'),
  ownerRecovery: read('../src/control-plane/continuation/owner-recovery.ts'),
  handoff: read('../src/control-plane/continuation/handoff.ts'),
  route: read('../src/control-plane/routes/x402-service.ts'),
  workflow: read('../src/control-plane/workflows/paid-continuation-workflow.ts'),
  finalization: read('../src/control-plane/repositories/d1/payment-finalization.ts'),
  reconciliation: read('../src/control-plane/repositories/d1/lifecycle-reconciliation.ts'),
};

function requireText(source: string, text: string, invariant: string): void {
  if (!source.includes(text)) throw new Error(invariant);
}

function forbidText(source: string, text: string, invariant: string): void {
  if (source.includes(text)) throw new Error(invariant);
}

/**
 * Source-level mutation oracle for the cross-module invariants that cannot be
 * inferred from one unit in isolation. Runtime and D1 behavior are covered by
 * lifecycle-model-c.test.ts and lifecycle-model-c-workflow.test.ts; this oracle
 * proves each explicitly governed structural mutant is detected as well.
 */
function assertModelCInvariants(sources: Sources): void {
  requireText(sources.ownerIntent, 'this.db.batch([', 'verified and intent must share D1 batch');
  requireText(
    sources.ownerIntent,
    'INSERT INTO payment_workflow_owner_intents',
    'owner-intent insert is required'
  );
  requireText(
    sources.ownerIntent,
    "SET lifecycle_stage = 'verified'",
    'verified transition is required'
  );
  requireText(
    sources.handoff,
    'deriveWorkflowInstanceId(input.paymentIdentifier)',
    'Workflow ID must derive from payment identifier'
  );
  forbidText(sources.ownerRecovery, '.verify(', 'owner repair must not reverify payment');
  requireText(
    sources.ownerRecovery,
    'const instance = await workflow.get(intent.workflowInstanceId);',
    'ambiguous create must resolve by deterministic get'
  );
  requireText(
    sources.workflow,
    "existing.lifecycleStage === 'settled_external'",
    'settled_external must resume without settle replay'
  );
  requireText(
    sources.workflow,
    'recordSettledExternal(',
    'external settlement must be durably persisted'
  );
  requireText(
    sources.finalization,
    "classification: 'current_execution_failed_unsettled'",
    'provider failure needs Model C classification'
  );
  requireText(
    sources.finalization,
    "actionability: 'non_actionable'",
    'completed provider failure must not remain actionable'
  );
  requireText(
    sources.finalization,
    'SELECT payment_attempt_id FROM payment_service_link_evidence',
    'settled requires link evidence readback'
  );
  requireText(
    sources.finalization,
    "'link_verified',\n        'settled'",
    'settled transition must originate from link_verified'
  );
  requireText(sources.reconciliation, 'classification IS NULL', 'unreconciled rows must block');
  requireText(
    sources.reconciliation,
    'classification NOT IN (',
    'unknown/current classes must block by allowlist'
  );
  requireText(
    sources.reconciliation,
    'INSERT INTO payment_attempt_reconciliations',
    'reconciliation is append-only insert'
  );
  forbidText(
    sources.reconciliation,
    'UPDATE payment_attempt_reconciliations',
    'reconciliation events cannot be overwritten'
  );
  forbidText(
    sources.reconciliation,
    'DELETE FROM payment_attempts',
    'payment history cannot be deleted'
  );
  forbidText(
    sources.route,
    'evidenceProvider.verify(verificationContext);\n      const ownerIntent',
    'owner repair cannot reverify'
  );
}

function mutate<K extends keyof Sources>(key: K, needle: string, replacement: string): Sources {
  if (!baseline[key].includes(needle)) throw new Error(`mutation precondition absent: ${key}`);
  return { ...baseline, [key]: baseline[key].replaceAll(needle, replacement) };
}

describe('Model C lifecycle mutation matrix', () => {
  it('accepts the unmutated source architecture', () => {
    expect(() => assertModelCInvariants(baseline)).not.toThrow();
  });

  const mutants: ReadonlyArray<{ name: string; sources: () => Sources }> = [
    {
      name: 'remove owner-intent insert',
      sources: () =>
        mutate('ownerIntent', 'INSERT INTO payment_workflow_owner_intents', 'INSERT INTO removed'),
    },
    {
      name: 'move owner intent outside verified transaction',
      sources: () => mutate('ownerIntent', 'this.db.batch([', 'Promise.all(['),
    },
    {
      name: 'allow same-payment owner repair to reverify payment',
      sources: () =>
        mutate(
          'ownerRecovery',
          'const intent = await',
          'await provider.verify();\n  const intent = await'
        ),
    },
    {
      name: 'use random Workflow ID',
      sources: () =>
        mutate(
          'handoff',
          'deriveWorkflowInstanceId(input.paymentIdentifier)',
          'crypto.randomUUID()'
        ),
    },
    {
      name: 'create Workflow twice after ambiguous timeout',
      sources: () =>
        mutate(
          'ownerRecovery',
          'const instance = await workflow.get(intent.workflowInstanceId);',
          'const instance = await workflow.create({ id: intent.workflowInstanceId, params: intent.workflowInput });'
        ),
    },
    {
      name: 'make provider failure remain actionable forever',
      sources: () =>
        mutate('finalization', "actionability: 'non_actionable'", "actionability: 'actionable'"),
    },
    {
      name: 'skip settled_external persistence',
      sources: () => mutate('workflow', 'recordSettledExternal(', 'skipSettledExternal('),
    },
    {
      name: 'call settle again from settled_external recovery',
      sources: () =>
        mutate(
          'workflow',
          "existing.lifecycleStage === 'settled_external'",
          "existing.lifecycleStage === 'never_settled_external'"
        ),
    },
    {
      name: 'mark settled without link proof',
      sources: () =>
        mutate(
          'finalization',
          'SELECT payment_attempt_id FROM payment_service_link_evidence',
          'SELECT id FROM payment_attempts'
        ),
    },
    {
      name: 'let unreconciled historical row pass gate',
      sources: () =>
        mutate('reconciliation', 'classification IS NULL', 'classification IS NOT NULL'),
    },
    {
      name: 'let unknown new row pass gate',
      sources: () => mutate('reconciliation', 'classification NOT IN (', 'classification IN ('),
    },
    {
      name: 'overwrite reconciliation event',
      sources: () =>
        mutate(
          'reconciliation',
          'INSERT INTO payment_attempt_reconciliations',
          'UPDATE payment_attempt_reconciliations'
        ),
    },
    {
      name: 'delete payment history',
      sources: () => ({
        ...baseline,
        reconciliation: `${baseline.reconciliation}\nDELETE FROM payment_attempts`,
      }),
    },
  ];

  it.each(mutants)('kills mutant: $name', ({ sources }) => {
    expect(() => assertModelCInvariants(sources())).toThrow();
  });
});
