/**
 * The fixture-vs-production evidence policy switch (directive §15). Exists
 * now, even though `production_enabled` is globally `false` throughout
 * SITEBORNE, so no future code can accidentally let synthetic fixture
 * evidence satisfy a production gate merely because nobody built the
 * distinction yet.
 */
import type { EvidenceTrustClass } from './types';

export type PaymentEvidenceMode = 'fixture' | 'production';

const TRUST_CLASSES_ALLOWED_BY_MODE: Record<
  PaymentEvidenceMode,
  ReadonlySet<EvidenceTrustClass>
> = {
  fixture: new Set(['synthetic_fixture', 'locally_derived_structure_only']),
  // Even in 'production' mode, SUN-0700A itself never PRODUCES
  // 'external_verified' evidence (that requires a real facilitator,
  // SUN-0700B) — this set exists so the gate is already correct the
  // day a real facilitator adapter starts producing that trust class.
  production: new Set(['external_verified']),
};

/** The single gate every verification/settlement guard in this package
 * calls before allowing evidence to advance state. */
export function isTrustClassAllowed(
  trustClass: EvidenceTrustClass,
  mode: PaymentEvidenceMode
): boolean {
  return TRUST_CLASSES_ALLOWED_BY_MODE[mode].has(trustClass);
}
