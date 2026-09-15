/**
 * The registry parity law (Master Reference Part II §XIX):
 *
 *   canonicalize(vcmToLegacyRegistry(legacyRegistryToVCM(files)))
 *   ==
 *   canonicalize(files)
 *
 * JCS-normalized structural equality, not raw-file byte equality -- the
 * frozen design chose this deliberately for the initial transition because
 * today's registry files were never run through the canonicalizer (their
 * on-disk formatting is not itself canonical JSON). A follow-on hardening
 * step can re-serialize the files through the canonicalizer once (a single
 * reviewed diff), after which byte equality becomes the permanent, stronger
 * law -- not done in this checkpoint.
 */
import { canonicalize } from '../canonical';
import type { LegacyRegistryServiceFile } from './types';

export interface ParityResult {
  readonly serviceId: string;
  readonly pass: boolean;
  readonly diffPath?: string;
}

/** Per-key structural diff for a single failing service pair -- reported
 * for debugging, never used to decide pass/fail (canonicalized-string
 * equality is the sole authority). */
function firstDifferingKey(
  a: LegacyRegistryServiceFile,
  b: LegacyRegistryServiceFile
): string | undefined {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const av = canonicalize((a as unknown as Record<string, unknown>)[key]);
    const bv = canonicalize((b as unknown as Record<string, unknown>)[key]);
    if (av !== bv) return key;
  }
  return undefined;
}

export function checkRegistryParity(
  original: readonly LegacyRegistryServiceFile[],
  roundTripped: readonly LegacyRegistryServiceFile[]
): ParityResult[] {
  const originalById = new Map(original.map((f) => [f.service_id, f]));
  const roundTrippedById = new Map(roundTripped.map((f) => [f.service_id, f]));
  const allIds = new Set([...originalById.keys(), ...roundTrippedById.keys()]);

  const results: ParityResult[] = [];
  for (const serviceId of [...allIds].sort()) {
    const orig = originalById.get(serviceId);
    const rt = roundTrippedById.get(serviceId);
    if (!orig || !rt) {
      results.push({
        serviceId,
        pass: false,
        diffPath: !orig ? '(missing from original)' : '(missing from round-trip)',
      });
      continue;
    }
    const pass = canonicalize(orig) === canonicalize(rt);
    results.push({
      serviceId,
      pass,
      diffPath: pass ? undefined : firstDifferingKey(orig, rt),
    });
  }
  return results;
}
