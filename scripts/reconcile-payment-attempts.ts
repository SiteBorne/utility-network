#!/usr/bin/env tsx

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  loadGovernedPlan,
  runOperator,
  type OperatorDatabase,
} from './reconcile-payment-attempts-core';

const argv = process.argv.slice(2);
const has = (name: string) => argv.includes(name);
const valueAfter = (name: string): string | undefined => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};

const apply = has('--apply');
const dryRun = has('--dry-run');
const remote = has('--remote');
const local = has('--local');
if (apply === dryRun) throw new Error('choose exactly one of --dry-run or --apply');
if (remote === local) throw new Error('choose exactly one explicit target: --remote or --local');
if (apply && !remote) throw new Error('--apply is production-remote only');
if (apply && !has('--acknowledge-sun1222c-production-backfill')) {
  throw new Error('--apply requires --acknowledge-sun1222c-production-backfill');
}

const database = valueAfter('--database');
if (!database) throw new Error('--database is required');
const planPath = resolve(
  valueAfter('--plan') ?? 'scripts/data/sun1222c-legacy-17-model-c-plan.json'
);
const repositoryRoot = resolve(import.meta.dirname, '..');
const plan = loadGovernedPlan(planPath);

type D1Payload = Array<{
  success?: boolean;
  results?: Array<Record<string, unknown>>;
  meta?: { changes?: number };
}>;

function executeWrangler(sql: string): D1Payload {
  const target = remote ? '--remote' : '--local';
  const result = spawnSync(
    'npx',
    ['wrangler', 'd1', 'execute', database, target, '--json', '--command', sql],
    { cwd: repositoryRoot, encoding: 'utf8', shell: false, maxBuffer: 16 * 1024 * 1024 }
  );
  if (result.status !== 0) {
    throw new Error(
      result.stdout.trim() ||
        result.stderr.trim() ||
        `wrangler d1 execute exited ${result.status ?? 1}`
    );
  }
  const payload = JSON.parse(result.stdout) as D1Payload;
  if (!Array.isArray(payload) || payload.some((entry) => entry.success === false)) {
    throw new Error('Wrangler returned an unsuccessful D1 result');
  }
  return payload;
}

const adapter: OperatorDatabase = {
  async query(sql) {
    return executeWrangler(sql).flatMap((entry) => entry.results ?? []);
  },
  async batch(statements) {
    const payload = executeWrangler(statements.map((statement) => `${statement};`).join('\n'));
    const changes = payload.map((entry) => {
      const value = entry.meta?.changes;
      if (!Number.isInteger(value) || Number(value) < 0) {
        throw new Error('D1 result omitted trustworthy per-statement change metadata');
      }
      return Number(value);
    });
    if (changes.length !== statements.length) {
      throw new Error(
        `D1 result count ${changes.length} did not equal statement count ${statements.length}`
      );
    }
    return { changes };
  },
};

if (apply) {
  process.stderr.write(
    `${JSON.stringify({
      database_name: database,
      remote: true,
      mode: 'apply',
      rows_expected: 17,
    })}\n`
  );
}

async function main(): Promise<void> {
  try {
    const summary = await runOperator({
      database: adapter,
      plan,
      repositoryRoot,
      databaseName: database,
      remote,
      mode: apply ? 'apply' : 'dry-run',
    });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (
      summary.whole_plan_state === 'CONFLICT' &&
      summary.reconciliation_apply_ready !== 'NO_SCHEMA_MISSING'
    ) {
      process.exitCode = 2;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ error: message })}\n`);
    process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ error: message })}\n`);
  process.exitCode = 1;
});
