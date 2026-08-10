import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parse } from 'yaml';
import { z } from 'zod';

const PROJECT_STATE_PATH = resolve(__dirname, '../PROJECT_STATE.yaml');

const ProjectStateSchema = z.object({
  project: z.object({
    name: z.string(),
    repository_status: z.enum(['foundation', 'development', 'staging', 'production']),
    production_ready: z.boolean(),
  }),
  source_directive: z.object({
    path: z.string(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  execution: z.object({
    mode: z.literal('serial'),
    active_mutation_tasks: z.number().int().min(0).max(1),
    // Nullable, not just `z.string()`: when the execution frontier is
    // legitimately blocked (SUN-0700A blocked-frontier governance fix —
    // see scripts/lib/task-frontier.ts), there is no active increment to
    // name truthfully. `null` here must never be silently coerced into a
    // task ID that isn't actually active.
    current_increment: z.string().nullable(),
    current_phase: z.string(),
    last_completed_increment: z.string(),
    // Mirrors scripts/lib/task-frontier.ts's `FrontierValidationResult
    // .frontierStatus` — the authoritative computation lives in
    // TASKS.yaml/validate-tasks.ts; this is PROJECT_STATE.yaml's own
    // truthful record of the same fact, cross-checked below.
    frontier_status: z.enum(['executable', 'blocked_external']),
    blocked_on: z.array(z.string()).optional(),
    reason: z.string().optional(),
  }),
  implemented: z.array(z.string()),
  not_implemented: z.array(z.string()),
  blocked_external: z.array(z.string()),
  frozen_decisions: z.object({
    product: z.object({
      public_name: z.string(),
      human_domain: z.string(),
      machine_domain: z.string(),
      production_origin: z.string(),
    }),
    standard: z.object({
      name: z.string(),
      abbreviation: z.string(),
      version: z.string(),
    }),
    service_ids: z.array(z.string()),
    privacy: z.object({
      initial_classification: z.string(),
      sensitive_data_processing: z.string(),
    }),
    market_integrity: z.object({
      unknown_external_customer_required: z.boolean(),
      self_purchase: z.string(),
      related_wallet_purchase: z.string(),
      compensated_purchase: z.string(),
      precommitted_purchase: z.string(),
      artificial_volume: z.string(),
      free_invocation_as_market_proof: z.string(),
    }),
    pricing: z.object({
      company_evidence_graph_usd: z.string(),
      web_context_direct_usd: z.string(),
      web_context_rendered_usd: z.string(),
      document_native_page_usd: z.string(),
      document_ocr_page_usd: z.string(),
      document_table_page_usd: z.string(),
      document_job_maximum_usd: z.string(),
      verification_standard_usd: z.string(),
      verification_independent_usd: z.string(),
      target_gross_margin: z.string(),
      minimum_accepted_margin: z.string(),
    }),
  }),
  last_updated: z.string().datetime({ offset: true }),
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

console.log('Validating PROJECT_STATE.yaml...\n');

const content = readFileSync(PROJECT_STATE_PATH, 'utf-8');
const data = parse(content);

const result = ProjectStateSchema.safeParse(data);
if (!result.success) {
  console.error('Schema validation failed:');
  for (const issue of result.error.issues) {
    console.error(`  ✗ ${issue.path.join('.')}: ${issue.message}`);
    failed++;
  }
} else {
  assert(true, 'PROJECT_STATE.yaml matches schema');
  passed++;
}

// Check production_ready is false when required systems not implemented
const requiredSystems = [
  'pcc_normative_schema',
  'company_evidence_graph',
  'web_context_verified',
  'document_evidence_json',
  'verify_agent_output',
  'd1_persistence',
  'r2_artifacts',
  'queue_orchestration',
  'x402',
  'mcp',
  'a2a',
  'nevermined',
];

const missingRequired = requiredSystems.filter((s) => !data.implemented.includes(s));
if (missingRequired.length > 0 && data.project.production_ready === true) {
  assert(
    false,
    `production_ready is true but required systems not implemented: ${missingRequired.join(', ')}`
  );
  failed++;
} else {
  assert(
    true,
    `production_ready correctly false (${missingRequired.length} required systems not implemented)`
  );
  passed++;
}

// Check active_mutation_tasks <= 1
assert(
  data.execution.active_mutation_tasks <= 1,
  `Active mutation tasks: ${data.execution.active_mutation_tasks} (max 1)`
);

// Execution-frontier self-consistency (SUN-0700A blocked-frontier
// governance fix): a blocked frontier must never simultaneously claim an
// active increment, and an executable frontier must always name one.
// The authoritative frontier computation itself lives in
// scripts/lib/task-frontier.ts against TASKS.yaml — this only checks
// that PROJECT_STATE.yaml's own record is not self-contradictory.
if (data.execution.frontier_status === 'blocked_external') {
  assert(
    data.execution.active_mutation_tasks === 0,
    'Blocked-frontier execution record has active_mutation_tasks === 0'
  );
  assert(
    data.execution.current_increment === null,
    'Blocked-frontier execution record has current_increment === null (never a false active-task name)'
  );
  assert(
    Array.isArray(data.execution.blocked_on) && data.execution.blocked_on.length > 0,
    'Blocked-frontier execution record names at least one blocked_on task'
  );
  assert(
    typeof data.execution.reason === 'string' && data.execution.reason.trim().length > 0,
    'Blocked-frontier execution record has a non-empty reason'
  );
} else {
  assert(
    data.execution.active_mutation_tasks === 1,
    'Executable-frontier execution record has active_mutation_tasks === 1'
  );
  assert(
    typeof data.execution.current_increment === 'string' &&
      data.execution.current_increment.length > 0,
    'Executable-frontier execution record names a non-empty current_increment'
  );
}

// Check source directive hash matches
const expectedHash = '03ccdebd57ab228502606c7fabdac57443267e66ab85bb6497a22dcd8f1f3af4';
assert(data.source_directive.sha256 === expectedHash, `Source directive SHA-256 matches manifest`);

// Check frozen decisions pricing are strings (decimal-safe)
const pricing = data.frozen_decisions.pricing;
for (const [key, value] of Object.entries(pricing)) {
  assert(typeof value === 'string', `Pricing ${key} is string (decimal-safe): "${value}"`);
  // Validate it's a valid decimal string
  assert(/^\d+(\.\d+)?$/.test(value), `Pricing ${key} is valid decimal: "${value}"`);
}

console.log(`\n--- Validation Summary ---`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
}
console.log('\n✓ PROJECT_STATE.yaml validation passed');
