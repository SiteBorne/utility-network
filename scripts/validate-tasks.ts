import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parse } from 'yaml';
import { z } from 'zod';
import { validateExecutionFrontier } from './lib/task-frontier';

const TASKS_PATH = resolve(__dirname, '../TASKS.yaml');

const TaskSchema = z.object({
  // Trailing single uppercase letter (e.g. SUN-0400A) is allowed for a
  // coarse increment split into dependency-linked sub-increments (e.g.
  // credential-independent implementation vs. external-deployment gate)
  // without renumbering the whole downstream sequence.
  id: z.string().regex(/^SUN-\d{4}[A-Z]?$/),
  title: z.string().min(1),
  phase: z.string().min(1),
  state: z.enum([
    'pending',
    'active',
    'in_progress',
    'completed',
    'accepted',
    'blocked_external',
    'cancelled',
    'rejected',
    'superseded',
  ]),
  owner_agent: z.string().min(1),
  dependencies: z.array(z.string()),
  rubric_target: z.number().int().min(0).max(100),
  acceptance_tests: z.array(z.string()).min(1),
  evidence: z.array(z.string()),
  next_action: z.string().min(1),
  blocker: z.union([z.string(), z.null()]),
  commit_ref: z.union([z.string(), z.null()]),
});

const TasksFileSchema = z.object({
  version: z.string(),
  last_updated: z.string().datetime({ offset: true }),
  tasks: z.array(TaskSchema),
});

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

console.log('Validating TASKS.yaml...\n');

const content = readFileSync(TASKS_PATH, 'utf-8');
const data = parse(content);

const result = TasksFileSchema.safeParse(data);
if (!result.success) {
  console.error('Schema validation failed:');
  for (const issue of result.error.issues) {
    console.error(`  ✗ ${issue.path.join('.')}: ${issue.message}`);
    failed++;
  }
} else {
  assert(true, 'TASKS.yaml matches schema');
  passed++;
}

// Execution-frontier validation (governance-model fix, SUN-0700A
// blocked-frontier closure — see scripts/lib/task-frontier.ts). Exactly
// two legitimate frontier shapes: one active dependency-ready task, or
// zero active tasks where every dependency-ready unfinished task is
// explicitly blocked_external with a genuine blocker. Anything else
// (2+ active, an active task that's also blocked, unclaimed executable
// work while zero tasks are active, a blocked_external task with no real
// reason) fails closed — this does NOT simply relax "exactly one active"
// to "zero or one active" unconditionally.
const frontier = validateExecutionFrontier(data.tasks);
if (frontier.failures.length === 0) {
  assert(true, `Execution frontier is legitimate (${frontier.frontierStatus})`);
} else {
  for (const failure of frontier.failures) {
    assert(false, failure);
  }
}

// Check SUN-0001 is accepted
const sun0001 = data.tasks.find((t: any) => t.id === 'SUN-0001');
assert(sun0001?.state === 'accepted', "SUN-0001 state is 'accepted'");

// Check dependencies exist
const allIds = new Set(data.tasks.map((t: any) => t.id));
for (const task of data.tasks) {
  for (const dep of task.dependencies) {
    assert(allIds.has(dep), `Task ${task.id} dependency exists: ${dep}`);
  }
}

// Check no circular dependencies (simple check: no task depends on itself directly)
for (const task of data.tasks) {
  assert(!task.dependencies.includes(task.id), `Task ${task.id} does not depend on itself`);
}

// Check acceptance_tests not empty
for (const task of data.tasks) {
  assert(task.acceptance_tests.length > 0, `Task ${task.id} has acceptance tests`);
}

// Check evidence array exists (can be empty for pending)
for (const task of data.tasks) {
  assert(Array.isArray(task.evidence), `Task ${task.id} has evidence array`);
}

// Check blocker is string or null
for (const task of data.tasks) {
  assert(
    task.blocker === null || typeof task.blocker === 'string',
    `Task ${task.id} blocker is string or null`
  );
}

// Check commit_ref is string or null
for (const task of data.tasks) {
  assert(
    task.commit_ref === null || typeof task.commit_ref === 'string',
    `Task ${task.id} commit_ref is string or null`
  );
}

// External tasks marked blocked_external
const externalTasks = data.tasks.filter((t: any) => t.state === 'blocked_external');
assert(externalTasks.length > 0, `External dependencies tracked: ${externalTasks.length} tasks`);

// Check next credential-independent task after SUN-0001 is pending/active
const nextTask = data.tasks.find(
  (t: any) => t.dependencies?.includes('SUN-0001') && t.state !== 'blocked_external'
);
assert(nextTask !== undefined, 'Next credential-independent task after SUN-0001 exists');

console.log(`\n--- Validation Summary ---`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
}
console.log('\n✓ TASKS.yaml validation passed');
