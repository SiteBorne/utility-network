/**
 * Provenance, not the model digest (Master Reference Part II §IV): the
 * frozen design document this package implements, and its digest as
 * recorded by the Freeze Record appended to that document. Verified by
 * baseline.test.ts to exactly match
 * docs/reports/METADATA-VCM-MASTER-canonical-reference.md's own recorded
 * `DOCUMENT_DIGEST` -- the documented digest scope explicitly ends
 * immediately before the Freeze Record section, so this package does not
 * (and must not) recompute a different digest over that document.
 */
export const VCM_BASELINE = {
  document: 'docs/reports/METADATA-VCM-MASTER-canonical-reference.md',
  digest: 'sha256:32b61aa5ab940f27900a78ffa6b468b66621d1b3aab6759827dc7cb207a87096',
} as const;
