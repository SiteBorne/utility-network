/**
 * Deterministic ID generation for PCC-shaped documents (job_id, claim_id,
 * evidence_id all use the frozen `^prefix_[a-z0-9]{24}$` pattern). Reuses
 * SHA-256 (via node:crypto, matching the same hashing primitive already
 * selected repo-wide in @siteborne/pcc-schema and @siteborne/verification's
 * canonical.ts) rather than a random UUID, so identical logical inputs
 * always produce the same ID — required for the deterministic-output
 * invariant tested across this package (directive §35).
 */
import { createHash } from 'node:crypto';

function hex24(seed: string): string {
  return createHash('sha256').update(seed).digest('hex').slice(0, 24);
}

export function deterministicId(
  prefix: 'job' | 'clm' | 'evd' | 'req' | 'pol' | 'kid',
  seed: string
): string {
  return `${prefix}_${hex24(seed)}`;
}
