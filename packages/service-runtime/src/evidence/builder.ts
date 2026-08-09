import { deterministicId } from '../pcc/ids';
import type {
  AccessibilityStatus,
  AuthorizationClassification,
  FreshnessStatus,
  PccEvidenceItem,
  PccLocator,
} from '../pcc/document-types';

export interface EvidenceInput {
  seed: string; // deterministic seed, e.g. `${provider}:${capability}:${sourceUri}`
  sourceUri: string;
  sourceTimestamp?: string;
  retrievedAtIso: string;
  contentHash: string;
  mediaType: string;
  /** Accepts any locator-shaped value (e.g. a richer
   * @siteborne/provider-adapters EvidenceLocator with extra fields) — only
   * `type`/`value` are ever copied through, since the frozen `locator`
   * definition has additionalProperties: false and no other fields. */
  locator: { type: PccLocator['type']; value: string; [extra: string]: unknown };
  accessibilityStatus?: AccessibilityStatus;
  transformationHistory?: Array<{ type: string; timestamp: string; tool_version: string }>;
  authorizationClassification?: AuthorizationClassification;
  freshnessStatus?: FreshnessStatus;
}

export function buildEvidence(input: EvidenceInput): PccEvidenceItem {
  return {
    evidence_id: deterministicId('evd', input.seed),
    source_uri: input.sourceUri,
    source_timestamp: input.sourceTimestamp,
    retrieved_at: input.retrievedAtIso,
    content_hash: input.contentHash,
    media_type: input.mediaType,
    locator: { type: input.locator.type, value: input.locator.value },
    accessibility_status: input.accessibilityStatus ?? 'accessible',
    transformation_history: input.transformationHistory ?? [],
    authorization_classification: input.authorizationClassification ?? 'public',
    freshness_status: input.freshnessStatus ?? 'fresh',
  };
}
