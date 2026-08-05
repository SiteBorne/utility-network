import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parse } from 'yaml';
import { z } from 'zod';

const GOVERNANCE_DIR = resolve(__dirname, '../governance');

// Load YAML files
const rubric = parse(readFileSync(resolve(GOVERNANCE_DIR, 'RUBRIC.yaml'), 'utf-8'));
const hardGates = parse(readFileSync(resolve(GOVERNANCE_DIR, 'HARD_GATES.yaml'), 'utf-8'));
const promotionStates = parse(
  readFileSync(resolve(GOVERNANCE_DIR, 'PROMOTION_STATES.yaml'), 'utf-8')
);
const resourcePolicy = parse(
  readFileSync(resolve(GOVERNANCE_DIR, 'RESOURCE_POLICY.yaml'), 'utf-8')
);
const marketIntegrity = parse(
  readFileSync(resolve(GOVERNANCE_DIR, 'MARKET_INTEGRITY.yaml'), 'utf-8')
);
const privacyClasses = parse(
  readFileSync(resolve(GOVERNANCE_DIR, 'PRIVACY_CLASSES.yaml'), 'utf-8')
);
const riskLimits = parse(readFileSync(resolve(GOVERNANCE_DIR, 'RISK_LIMITS.yaml'), 'utf-8'));

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

console.log('Validating governance files...\n');

// 1. Rubric weights sum to exactly 100
console.log('1. Rubric validation:');
const weightsSum = rubric.criteria.reduce((sum: number, c: any) => sum + c.weight, 0);
assert(weightsSum === 100, `Rubric weights sum to exactly 100 (got ${weightsSum})`);

// All required criteria present
const requiredCriteria = [
  'existing_machine_demand',
  'composability',
  'objective_verifiability',
  'free_resource_feasibility',
  'replacement_cost_margin',
  'machine_discoverability',
  'reliability_latency',
  'defensibility',
  'terms_compliance',
  'implementation_simplicity',
];
for (const id of requiredCriteria) {
  const found = rubric.criteria.some((c: any) => c.id === id);
  assert(found, `Required criterion present: ${id}`);
}

// Thresholds present
assert(typeof rubric.thresholds.reject === 'number', "Threshold 'reject' defined");
assert(typeof rubric.thresholds.core_product === 'number', "Threshold 'core_product' defined");

// 2. Hard gates - all 11 required present
console.log('\n2. Hard gates validation:');
const requiredGates = [
  'machine_callable',
  'machine_payable',
  'bounded_input',
  'bounded_output',
  'acceptance_tests_defined',
  'commercial_use_permitted',
  'automated_access_permitted',
  'raw_account_resale',
  'quota_circumvention',
  'secret_exposure',
  'unbounded_backend_spend',
  'verification_available',
];
for (const id of requiredGates) {
  const found = hardGates.gates.some((g: any) => g.id === id);
  assert(found, `Required hard gate present: ${id}`);
}
assert(hardGates.gates.length >= 11, 'At least 11 hard gates defined');

// 3. Promotion states - 8 states, valid transitions
console.log('\n3. Promotion states validation:');
const validStates = [
  'DRAFT',
  'CASE_SUPPORTED',
  'MULTI_CASE_SUPPORTED',
  'VERIFIED_PATTERN',
  'EXECUTABLE_CANDIDATE',
  'EXECUTABLE_VERIFIED',
  'RETIRED',
  'TOMBSTONED',
];
const states = promotionStates.states.map((s: any) => s.id);
for (const s of validStates) {
  assert(states.includes(s), `Promotion state exists: ${s}`);
}

// Check transitions
const transitions = promotionStates.transition_rules;
const validTransitions = [
  ['DRAFT', 'CASE_SUPPORTED'],
  ['CASE_SUPPORTED', 'MULTI_CASE_SUPPORTED'],
  ['MULTI_CASE_SUPPORTED', 'VERIFIED_PATTERN'],
  ['VERIFIED_PATTERN', 'EXECUTABLE_CANDIDATE'],
  ['EXECUTABLE_CANDIDATE', 'EXECUTABLE_VERIFIED'],
  ['EXECUTABLE_VERIFIED', 'RETIRED'],
  ['RETIRED', 'TOMBSTONED'],
];
for (const [from, to] of validTransitions) {
  const found = transitions.some((t: any) => t.from === from && t.to === to);
  assert(found, `Valid transition defined: ${from} → ${to}`);
}

// TOMBSTONED is terminal (no outgoing)
const tombstonedOutgoing = transitions.filter((t: any) => t.from === 'TOMBSTONED');
assert(tombstonedOutgoing.length === 0, 'TOMBSTONED has no outgoing transitions (terminal)');

// RETIRED cannot return to production states
const retiredToProduction = transitions.some(
  (t: any) =>
    t.from === 'RETIRED' &&
    [
      'EXECUTABLE_CANDIDATE',
      'EXECUTABLE_VERIFIED',
      'VERIFIED_PATTERN',
      'MULTI_CASE_SUPPORTED',
      'CASE_SUPPORTED',
      'DRAFT',
    ].includes(t.to)
);
assert(!retiredToProduction, 'RETIRED cannot transition back to production states');

// EXECUTABLE_VERIFIED required for production control
const executableVerified = promotionStates.states.find((s: any) => s.id === 'EXECUTABLE_VERIFIED');
assert(executableVerified?.controls_money === true, 'EXECUTABLE_VERIFIED controls money');
assert(executableVerified?.controls_providers === true, 'EXECUTABLE_VERIFIED controls providers');
assert(
  executableVerified?.controls_marketplace_metadata === true,
  'EXECUTABLE_VERIFIED controls marketplace metadata'
);

// 4. Resource policy - pricing formula correct
console.log('\n4. Resource policy validation:');
assert(
  resourcePolicy.pricing_formula?.expected_cost?.includes('resource_replacement_cost'),
  'expected_cost includes resource_replacement_cost'
);
assert(
  resourcePolicy.pricing_formula?.expected_cost?.includes('verification_cost'),
  'expected_cost includes verification_cost'
);
assert(
  resourcePolicy.pricing_formula?.expected_cost?.includes('facilitator_cost'),
  'expected_cost includes facilitator_cost'
);
assert(
  resourcePolicy.pricing_formula?.expected_cost?.includes('expected_retry_cost'),
  'expected_cost includes expected_retry_cost'
);
assert(
  resourcePolicy.pricing_formula?.expected_cost?.includes('refund_reserve'),
  'expected_cost includes refund_reserve'
);
assert(
  resourcePolicy.pricing_formula?.expected_cost?.includes('storage_cost'),
  'expected_cost includes storage_cost'
);
assert(
  resourcePolicy.pricing_formula?.minimum_price?.includes('expected_cost'),
  'minimum_price uses expected_cost'
);
assert(
  resourcePolicy.pricing_formula?.minimum_price?.includes('target_margin'),
  'minimum_price uses target_margin'
);
assert(resourcePolicy.paid_overflow_enabled === false, 'Paid overflow disabled at launch');
assert(
  resourcePolicy.paid_overflow_requires_operator_approval === true,
  'Paid overflow requires operator approval'
);

// 5. Market integrity - 7 forbidden practices
console.log('\n5. Market integrity validation:');
const forbiddenPractices = marketIntegrity.forbidden_practices.map((f: any) => f.id);
const requiredForbidden = [
  'self_purchase',
  'related_wallet_purchase',
  'compensated_buyer',
  'prior_purchase_commitment',
  'fake_rating',
  'manufactured_volume',
  'transaction_time_human_selection',
];
for (const id of requiredForbidden) {
  assert(forbiddenPractices.includes(id), `Forbidden practice defined: ${id}`);
}

// First purchase validator requirements
const fpv = marketIntegrity.first_purchase_validator;
assert(fpv?.requirements?.length >= 6, 'First purchase validator has at least 6 requirements');
assert(
  fpv?.evidence_required?.length >= 4,
  'First purchase validator has at least 4 evidence requirements'
);

// 6. Privacy classes - 6 classes
console.log('\n6. Privacy classes validation:');
const privacyIds = privacyClasses.classes.map((c: any) => c.id);
const requiredPrivacy = [
  'public_data',
  'buyer_provided_public',
  'buyer_provided_authorized',
  'operational_metadata',
  'payment_metadata',
  'secrets',
];
for (const id of requiredPrivacy) {
  assert(privacyIds.includes(id), `Privacy class defined: ${id}`);
}

// 7. Risk limits - key limits present
console.log('\n7. Risk limits validation:');
assert(
  typeof riskLimits.financial_limits?.max_job_price_usd === 'number',
  'max_job_price_usd defined'
);
assert(
  typeof riskLimits.financial_limits?.target_gross_margin === 'number',
  'target_gross_margin defined'
);
assert(
  typeof riskLimits.operational_limits?.max_concurrent_heavy_jobs === 'number',
  'max_concurrent_heavy_jobs defined'
);
assert(
  typeof riskLimits.rate_limits?.free_endpoints_rps === 'number',
  'free_endpoints_rps defined'
);
assert(
  riskLimits.financial_limits?.price_change_per_experiment_pct === 20,
  'Price change limit 20%'
);
assert(
  riskLimits.automatic_change_limits?.service_schema_changes === 'human_approval_required',
  'Schema changes require human approval'
);

// Summary
console.log(`\n--- Validation Summary ---`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
}
console.log('\n✓ All governance validations passed');
