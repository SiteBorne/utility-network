export * from './types';
export * from './failures';
export * from './canonical';
export * from './context';
export * from './graph';
export * from './mesh';
export * from './policy';
export * from './schema-registry';

import { SchemaVerifier } from './verifiers/schema-verifier';
import { EvidenceAccessibilityVerifier } from './verifiers/evidence-accessibility-verifier';
import { ClaimEvidenceVerifier } from './verifiers/claim-evidence-verifier';
import { FreshnessVerifier } from './verifiers/freshness-verifier';
import { CompletenessVerifier } from './verifiers/completeness-verifier';
import { CrossSourceVerifier } from './verifiers/cross-source-verifier';
import { ProvenanceVerifier } from './verifiers/provenance-verifier';
import { PromptInjectionVerifier } from './verifiers/prompt-injection-verifier';
import { ReproductionVerifier, type ReproductionInput } from './verifiers/reproduction-verifier';
import type { Verifier } from './types';

export {
  SchemaVerifier,
  EvidenceAccessibilityVerifier,
  ClaimEvidenceVerifier,
  FreshnessVerifier,
  CompletenessVerifier,
  CrossSourceVerifier,
  ProvenanceVerifier,
  PromptInjectionVerifier,
  ReproductionVerifier,
};
export type { ReproductionInput };

export * from './receipt/models';
export * from './receipt/identity';
export * from './receipt/signer';
export * from './receipt/key-registry';
export * from './receipt/verifier';
export * from './receipt/issue';

/** The 8 mandatory standard-mode verifiers (master directive §21), in a
 * stable order. Use with mesh.ts::runMesh, which computes the actual
 * dependency-respecting execution order itself. */
export function buildStandardVerifiers(): Verifier[] {
  return [
    new SchemaVerifier(),
    new EvidenceAccessibilityVerifier(),
    new ClaimEvidenceVerifier(),
    new FreshnessVerifier(),
    new CompletenessVerifier(),
    new CrossSourceVerifier(),
    new ProvenanceVerifier(),
    new PromptInjectionVerifier(),
  ];
}

/** Standard verifiers plus the 9th (reproduction) verifier, for
 * independent_reproduction mode. */
export function buildReproductionVerifiers(reproduction: ReproductionInput | null): Verifier[] {
  return [...buildStandardVerifiers(), new ReproductionVerifier(reproduction)];
}
