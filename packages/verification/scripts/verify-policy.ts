/**
 * Loads and Zod-validates governance/VERIFICATION_POLICY.yaml, cross-checks
 * its `required_verifiers` lists against the actual verifier IDs exported
 * by buildStandardVerifiers()/buildReproductionVerifiers() (so the policy
 * document and the code can never silently diverge), and prints its
 * canonical hash.
 */
import { loadPolicy, hashPolicy } from '../src/policy';
import { buildStandardVerifiers, buildReproductionVerifiers } from '../src/index';

async function main(): Promise<void> {
  const policy = loadPolicy();
  console.log(`Loaded policy_version: ${policy.policy_version}`);

  const standardIds = buildStandardVerifiers()
    .map((v) => v.verifierId)
    .sort();
  const reproductionIds = buildReproductionVerifiers(null)
    .map((v) => v.verifierId)
    .sort();

  const policyStandard = [...policy.required_verifiers.standard].sort();
  const policyReproduction = [...policy.required_verifiers.independent_reproduction].sort();

  let ok = true;
  if (JSON.stringify(policyStandard) !== JSON.stringify(standardIds)) {
    ok = false;
    console.error(
      `MISMATCH: policy.required_verifiers.standard ${JSON.stringify(policyStandard)} != code verifier set ${JSON.stringify(standardIds)}`
    );
  }
  if (JSON.stringify(policyReproduction) !== JSON.stringify(reproductionIds)) {
    ok = false;
    console.error(
      `MISMATCH: policy.required_verifiers.independent_reproduction ${JSON.stringify(policyReproduction)} != code verifier set ${JSON.stringify(reproductionIds)}`
    );
  }

  const hash = await hashPolicy(policy);
  console.log(`Canonical policy hash: ${hash}`);

  if (!ok) {
    console.error('\nVERIFICATION_POLICY.yaml has drifted from the verifier code.');
    process.exit(1);
  }
  console.log('\nPolicy is Zod-valid and matches the code-defined verifier set.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
