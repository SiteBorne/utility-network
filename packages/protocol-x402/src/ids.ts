/**
 * Deterministic ID generation for payment-domain artifacts, mirroring the
 * same `^prefix_[a-z0-9]{24}$` convention and SHA-256 primitive already
 * used by @siteborne/service-runtime's pcc/ids.ts and
 * @siteborne/verification — identical logical inputs always produce the
 * same ID (required for quote/requirement determinism tests).
 */
import { createHash } from 'node:crypto';

function hex24(seed: string): string {
  return createHash('sha256').update(seed).digest('hex').slice(0, 24);
}

export function deterministicId(prefix: 'qte' | 'req' | 'pid', seed: string): string {
  return `${prefix}_${hex24(seed)}`;
}
