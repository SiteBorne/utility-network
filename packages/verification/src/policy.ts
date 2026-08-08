import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { z } from 'zod';
import { canonicalize, contentHash } from './canonical';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const DEFAULT_POLICY_PATH = join(REPO_ROOT, 'governance', 'VERIFICATION_POLICY.yaml');

export const VerificationPolicySchema = z.object({
  policy_version: z.string(),
  required_verifiers: z.record(z.string(), z.array(z.string())),
  blocking_severities: z.array(z.enum(['info', 'warning', 'blocking'])),
  timeout_ms: z.object({
    total: z.number().int().positive(),
    per_verifier: z.number().int().positive(),
  }),
  completeness_requirement: z.object({
    minimum_score: z.number().min(0).max(1),
  }),
  freshness_requirement: z.object({
    default_max_age_ms: z.number().int().positive(),
  }),
  verified_absent_requires_evidence: z.boolean(),
  independent_reproduction: z.object({
    required_for: z.array(z.string()),
  }),
  receipt: z.object({
    signature_algorithm: z.literal('Ed25519'),
    canonicalization_algorithm: z.string(),
  }),
  limits: z.object({
    max_claims: z.number().int().positive(),
    max_evidence_items: z.number().int().positive(),
    max_artifacts: z.number().int().positive(),
    max_locator_resolutions: z.number().int().positive(),
    max_receipt_bytes: z.number().int().positive(),
  }),
});
export type VerificationPolicy = z.infer<typeof VerificationPolicySchema>;

export function loadPolicy(path: string = DEFAULT_POLICY_PATH): VerificationPolicy {
  const raw = readFileSync(path, 'utf-8');
  const parsed = parse(raw);
  return VerificationPolicySchema.parse(parsed);
}

export async function hashPolicy(policy: VerificationPolicy): Promise<string> {
  return contentHash(canonicalize(policy));
}
