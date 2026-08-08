import { detectPromptInjectionSignals, shouldBlockByPolicy } from '@siteborne/provider-adapters';
import type { CandidateResult, VerificationContext, VerificationResult, Verifier } from '../types';
import { buildResult } from './base';

export const PROMPT_INJECTION_VERIFIER_ID = 'prompt_injection_verifier';
export const PROMPT_INJECTION_VERIFIER_VERSION = '1.0.0';

/**
 * Scans all string-valued evidence/claim content for prompt-injection
 * signals, reusing the same deterministic rule set already implemented and
 * tested in packages/provider-adapters/src/html/injection-signals.ts
 * rather than a second, divergent implementation.
 */
export class PromptInjectionVerifier implements Verifier {
  readonly verifierId = PROMPT_INJECTION_VERIFIER_ID;
  readonly verifierVersion = PROMPT_INJECTION_VERIFIER_VERSION;
  readonly capabilities = ['prompt_injection_detection'] as const;
  readonly dependsOn: readonly string[] = ['schema_verifier'];
  readonly mandatory = true;

  async verify(
    candidate: CandidateResult,
    context: VerificationContext
  ): Promise<VerificationResult> {
    const startedAt = context.clock.nowMs();

    const textPieces: string[] = [];
    for (const claim of candidate.claims) {
      if (typeof claim.value === 'string') textPieces.push(claim.value);
    }
    const outputText =
      typeof candidate.output === 'string'
        ? candidate.output
        : JSON.stringify(candidate.output ?? {});
    textPieces.push(outputText);

    const allSignals = textPieces.flatMap((text) =>
      detectPromptInjectionSignals(text, `candidate:${candidate.job_id}`)
    );
    const blocked = shouldBlockByPolicy(allSignals, 'moderate');

    const result: 'clean' | 'suspected' | 'confirmed' = blocked
      ? 'confirmed'
      : allSignals.length > 0
        ? 'suspected'
        : 'clean';

    return buildResult(candidate, context, startedAt, {
      verifierId: this.verifierId,
      verifierVersion: this.verifierVersion,
      ruleId: 'prompt_injection_scan',
      subject: candidate.job_id,
      status: blocked ? 'fail' : 'pass',
      severity: blocked ? 'blocking' : allSignals.length > 0 ? 'warning' : 'info',
      findings: allSignals.slice(0, 50).map((s) => ({
        code: `injection_${s.type}`,
        message: `${s.type} (${s.severity}): ${s.excerpt.slice(0, 100)}`,
        severity:
          s.policyRecommendation === 'block'
            ? 'blocking'
            : s.policyRecommendation === 'quarantine'
              ? 'warning'
              : 'info',
      })),
      failureCodes: blocked ? ['prompt_injection_confirmed'] : [],
      limitations: [`prompt_injection_result=${result}`, `signals_detected=${allSignals.length}`],
    });
  }
}
