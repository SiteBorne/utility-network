export interface NeverminedLiveGuardInput {
  runLiveNevermined: string | undefined;
  environment: 'sandbox' | 'live' | undefined;
  apiKeyEnvironment: 'sandbox' | 'live' | 'unknown';
}

export type NeverminedLiveGuardResult =
  | { allowed: true }
  | {
      allowed: false;
      code: 'flag_disabled' | 'live_environment_disabled' | 'key_environment_mismatch';
    };

/** Pure future-live guard. The caller supplies only the key's already-derived
 * environment classification; this function never receives, serializes, or
 * reports credential material. */
export function evaluateNeverminedLiveGuard(
  input: NeverminedLiveGuardInput
): NeverminedLiveGuardResult {
  if (input.runLiveNevermined !== '1') return { allowed: false, code: 'flag_disabled' };
  if (input.environment !== 'sandbox') {
    return { allowed: false, code: 'live_environment_disabled' };
  }
  if (input.apiKeyEnvironment !== 'sandbox') {
    return { allowed: false, code: 'key_environment_mismatch' };
  }
  return { allowed: true };
}
